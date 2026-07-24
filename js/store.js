/* TRLE.Store — IndexedDB session storage for AtlasTool.
   ------------------------------------------------------------------------
   This is a CRASH-RECOVERY NET, not a project library. Exactly one session is
   ever stored (KEY_SESSION), overwritten in place. Projects live on disk as
   .atlasproj.json files — that's what's portable, shareable and backed up, and
   keeping one slot here means storage stays bounded by construction with no
   quota management, no eviction policy and no library UI to maintain.

   Why IndexedDB and not localStorage: localStorage caps around 5MB, is
   string-only (so every tile would pay ~33% base64 overhead) and is
   synchronous, which is the one thing guaranteed to cost us frames. IndexedDB
   is async, stores Blobs by structured clone with no text step, and scales
   with free disk.

   Everything here fails soft. Private-mode Firefox, a denied quota or a
   corrupt database must degrade to "no autosave", never to a broken tool —
   the file-based save path is the source of truth and always works. */
window.TRLE = window.TRLE || {};
TRLE.Store = (() => {
    'use strict';

    const DB_NAME = 'trle-atlastool';
    const DB_VERSION = 1;
    const STORE = 'sessions';
    const KEY_SESSION = 'session';     // the full project (tiles as Blobs)
    const KEY_META = 'session-meta';   // tiny header, read on boot

    let dbPromise = null;
    let broken = false;   // a failed open stays failed; don't retry every save

    function available() {
        try { return !!window.indexedDB; } catch { return false; }
    }

    function open() {
        if (broken || !available()) return Promise.resolve(null);
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(resolve => {
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); }
            catch { broken = true; resolve(null); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => { broken = true; resolve(null); };
            // Firefox private mode resolves neither; don't hang the boot path.
            req.onblocked = () => resolve(null);
        });
        return dbPromise;
    }

    /* Run one transaction, resolving to `fallback` on any failure. */
    async function tx(mode, fn, fallback) {
        const db = await open();
        if (!db) return fallback;
        return new Promise(resolve => {
            let t;
            try { t = db.transaction(STORE, mode); }
            catch { resolve(fallback); return; }
            const store = t.objectStore(STORE);
            let result = fallback;
            try { fn(store, v => { result = v; }); }
            catch { resolve(fallback); return; }
            t.oncomplete = () => resolve(result);
            t.onerror = t.onabort = () => resolve(fallback);
        });
    }

    /* Is this origin already exempt from eviction? Cheap and silent everywhere. */
    async function isPersisted() {
        try {
            if (!navigator.storage || !navigator.storage.persisted) return false;
            return await navigator.storage.persisted();
        } catch { return false; }
    }

    /* Ask the browser not to evict us under disk pressure.
       CALL THIS ONLY FROM A USER GESTURE. Chrome answers silently from its own
       engagement heuristics, but Firefox raises a "Allow site to store data in
       persistent storage?" permission doorhanger — so calling it on a timer (as
       an autosave completion once did) interrupts the user with a permission
       prompt they didn't ask for, mid-edit, with no context for what it's about.
       A `false` is normal, not an error: it only means the session stays
       evictable, which it already was. */
    async function requestPersistence() {
        try {
            if (!navigator.storage || !navigator.storage.persist) return false;
            if (await isPersisted()) return true;
            return await navigator.storage.persist();
        } catch { return false; }
    }

    /* Bytes currently used by this origin, or null if the browser won't say. */
    async function estimate() {
        try {
            if (!navigator.storage || !navigator.storage.estimate) return null;
            const { usage, quota } = await navigator.storage.estimate();
            return { usage: usage || 0, quota: quota || 0 };
        } catch { return null; }
    }

    /* Write the session plus its header. The header is a separate record so the
       boot path can answer "is there anything to restore?" without pulling every
       tile Blob back out of the database. */
    async function saveSession(project, meta) {
        const header = Object.assign({ savedAt: Date.now() }, meta);
        const ok = await tx('readwrite', (store, set) => {
            store.put(project, KEY_SESSION);
            store.put(header, KEY_META);
            set(true);
        }, false);
        return ok ? header : null;
    }

    const loadSession = () => tx('readonly', (store, set) => {
        const r = store.get(KEY_SESSION);
        r.onsuccess = () => set(r.result || null);
    }, null);

    const sessionMeta = () => tx('readonly', (store, set) => {
        const r = store.get(KEY_META);
        r.onsuccess = () => set(r.result || null);
    }, null);

    const clearSession = () => tx('readwrite', (store, set) => {
        store.delete(KEY_SESSION);
        store.delete(KEY_META);
        set(true);
    }, false);

    return { available, isPersisted, requestPersistence, estimate, saveSession, loadSession, sessionMeta, clearSession };
})();
