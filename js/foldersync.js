/* TRLE.FolderSync: the file-system half of "Work in a folder" (FOLDER-SYNC-PLAN).
   ------------------------------------------------------------------------
   No UI and no atlas knowledge here: it takes the [{ name, blob, role }] list from
   buildExportFiles and a FileSystemDirectoryHandle, and writes. js/atlas.js owns the
   buttons, the confirms and the state. A handle from the real picker and one from
   navigator.storage.getDirectory() (what the validators hand in) are the same interface. */
window.TRLE = window.TRLE || {};
TRLE.FolderSync = (() => {
    'use strict';

    /* Detect the feature, never the browser (D10): Brave with its flag on, and any
       browser that ships it later, just work. */
    const supported = () => typeof window.showDirectoryPicker === 'function';

    /* The order a batch is written in. The project file first, so an interrupted batch
       leaves the JSON never older than the textures (D4); the manifest next (nothing
       watches it); the maps before the diffuse, because Tomb Editor watches the
       diffuse's path only and reads the sidecar maps at the next Build, so the reload
       the diffuse triggers must never run ahead of its maps. */
    const ROLE_ORDER = { project: 0, manifest: 1, map: 2, diffuse: 3 };
    const ordered = files => files
        .map((f, i) => [f, i])
        .sort((a, b) => (ROLE_ORDER[a[0].role] - ROLE_ORDER[b[0].role]) || (a[1] - b[1]))
        .map(p => p[0]);

    async function exists(dir, name) {
        try { await dir.getFileHandle(name); return true; }
        catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; }
    }
    async function existing(dir, names) {
        const out = [];
        for (const n of names) if (await exists(dir, n)) out.push(n);
        return out;
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* One file. `body` is a Blob, or a function taking the writable, so a big file (the project)
       can be written in chunks. Chrome writes to a swap file and swaps it in on close(), so Tomb Editor
       never sees half a file; the one collision left is our swap landing while it reads
       (a share violation on Windows), so a failed write retries with backoff. */
    async function writeOne(dir, name, body, retries = 3) {
        let err;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const fh = await dir.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                try { if (typeof body === 'function') await body(w); else await w.write(body); } catch (e) { try { await w.abort(); } catch {} throw e; }
                await w.close();
                return;
            } catch (e) {
                err = e;
                if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;   // permission: retrying cannot help
                if (attempt < retries) await sleep(40 * Math.pow(3, attempt));
            }
        }
        throw err;
    }

    /* Write the list in D4's order. Returns the names written. */
    async function writeAll(dir, files, opts = {}) {
        const names = [];
        for (const f of ordered(files)) {
            await writeOne(dir, f.name, f.write || f.blob, opts.retries);
            names.push(f.name);
            if (opts.onFile) opts.onFile(f.name, names.length, files.length);
        }
        return names;
    }

    /* 'granted' | 'prompt' | 'denied'. Asking is only ever done from a click. */
    async function permission(handle, ask) {
        if (!handle || typeof handle.queryPermission !== 'function') return 'granted';   // origin-private handles
        const opts = { mode: 'readwrite' };
        let p = await handle.queryPermission(opts);
        if (p !== 'granted' && ask) p = await handle.requestPermission(opts);
        return p;
    }

    /* A yield that a hidden page cannot throttle (D12). Chrome clamps timers on a page it
       considers hidden to about one a second (Tomb Editor maximised over the browser can
       occlude it), which would turn a 1 s batch into ~16 s at 32 tiles; a MessageChannel post
       is a task, not a timer. */
    const yieldNow = (() => {
        const ch = new MessageChannel();
        let pending = [];
        ch.port1.onmessage = () => { const r = pending; pending = []; r.forEach(f => f()); };
        return () => new Promise(res => { pending.push(res); ch.port2.postMessage(0); });
    })();

    /* When a sync batch runs (D11). Two triggers and nothing else:
         leave()  the tool lost focus (or went hidden) while dirty: a batch NOW, because that
                  is the moment the user goes to Tomb Editor;
         edit()   arms an idle backstop for Tomb Editor on a second monitor, where focus never
                  leaves the browser: it fires `idleMs` after the LAST edit but never sooner
                  than `gapMs` after the previous batch ended (then as soon as that has passed).
       One batch at a time: an edit during a batch only sets dirty, and the end of the batch
       re-arms, so it costs exactly one more. A run that returns false (paused) keeps dirty
       and arms nothing; the next edit, blur or a click resumes. Timers here only DECIDE when
       to start; the batch itself yields through yieldNow. */
    function createScheduler(o) {
        const now = o.now || (() => performance.now());
        const t = { idleMs: o.idleMs, gapMs: o.gapMs };
        let dirty = false, running = false, timer = null, lastEdit = 0, lastEnd = -Infinity;
        const api = {
            timing: t,
            get dirty() { return dirty; },
            get running() { return running; },
            edit() { dirty = true; lastEdit = now(); if (!running) arm(); },
            leave() { if (dirty && !running) { clearTimeout(timer); timer = null; fire(); } },
            cancel() { clearTimeout(timer); timer = null; dirty = false; },
            /* A manual write covers every edit made before it STARTED (`since`), and counts as a batch for the gap. */
            wrote(since) { lastEnd = now(); if (lastEdit <= since) { dirty = false; clearTimeout(timer); timer = null; } },
            stamp: () => now()
        };
        function arm() {
            clearTimeout(timer);
            const n = now();
            const delay = Math.max(lastEdit + t.idleMs - n, lastEnd + t.gapMs - n, 0);
            timer = setTimeout(fire, delay);
        }
        async function fire() {
            timer = null;
            if (running || !dirty) return;
            running = true;
            dirty = false;
            let ok = false;
            try { ok = await o.run(); } catch (e) { console.warn('Folder sync batch failed:', e); }
            running = false;
            lastEnd = now();
            if (!ok) dirty = true;           // paused or failed: nothing is on disk yet
            if (dirty && ok) arm();          // edited during the batch: exactly one more
            if (o.onIdle) o.onIdle(ok);
        }
        return api;
    }

    return { supported, ordered, exists, existing, writeOne, writeAll, permission, yieldNow, createScheduler };
})();
