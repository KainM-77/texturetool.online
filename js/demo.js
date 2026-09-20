/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. MIT Licensed (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — demo course shell

   Owns the rail, the scrim and the lesson state. The frame is a REAL, complete
   AtlasTool (`index.html?demo`), not a clone and not a mock — so what a lesson
   spotlights is the shipped control, and there is nothing to keep in sync.

   Why a frame rather than a copy: this repo has lost the clone bet twice
   (`texturetool.html`, and AtlasTool's own fork of the root tool). A drifted
   demo does not crash; it teaches the wrong thing, silently. See
   docs/demo/feature-inventory.md §3.3.

   Why the sandbox is three storage keys and not a suppression flag: a frame
   shares its parent's ORIGIN, so IndexedDB and localStorage are the same stores
   whichever page opens them (measured, §3.1). `?demo` namespaces them.
   ============================================================ */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const PROGRESS_KEY = 'trle-demo-progress';   // demo-owned, never user data

    /* The course reads the USER's real prefs to match their theme, and pushes
       them into the frame — which cannot read them itself, because ?demo
       namespaces PREFS_KEY. That is the cost of the sandbox, paid here. */
    function userPrefs() {
        try { return JSON.parse(localStorage.getItem('trle-atlas-prefs')) || {}; }
        catch { return {}; }
    }

    const state = {
        gen: 0,               // bumped on every navigation; see playStep
        lessonIndex: 0,
        stepIndex: 0,
        runner: null,
        frameReady: false,
        running: false,
        handedOver: false,
        spotTarget: null,     // re-measured on resize / frame scroll
        resumeAge: Infinity,  // ms since progress was last written
        completed: []
    };

    const lessons = () => (window.TRLE && TRLE.DemoLessons) || [];
    const lesson = () => lessons()[state.lessonIndex];
    const step = () => { const l = lesson(); return l && l.steps[state.stepIndex]; };

    /* ---------- progress (demo-owned key) ---------- */
    /* How long saved progress stays warm enough to resume WITHOUT asking.
       Reported by alpha testers: opening the course and landing three lessons
       in, with no explanation, reads as the course having lost its place rather
       than kept it. Stepping out to the tool and back is the case that must stay
       silent, so the threshold is minutes, not seconds: 10. */
    const RESUME_ASK_AFTER = 10 * 60 * 1000;

    function loadProgress() {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { /* ignore */ }
        if (p.version !== 1) return;
        const li = lessons().findIndex(l => l.id === p.lesson);
        if (li >= 0) {
            state.lessonIndex = li;
            const max = lessons()[li].steps.length - 1;
            state.stepIndex = Math.max(0, Math.min(max, p.step | 0));
        }
        if (Array.isArray(p.completed)) state.completed = p.completed;
        state.resumeAge = typeof p.ts === 'number' ? Date.now() - p.ts : Infinity;
    }
    function saveProgress() {
        const l = lesson();
        if (!l) return;
        try {
            localStorage.setItem(PROGRESS_KEY, JSON.stringify({
                version: 1, lesson: l.id, step: state.stepIndex,
                completed: state.completed, ts: Date.now()
            }));
        } catch { /* private mode — the course still works, it just won't resume */ }
    }

    /* Ask only when the restored position is somewhere the user would not expect
       to arrive at cold. Step 1 of lesson 1 IS the cold start, so there is
       nothing to ask about. A missing `ts` (progress written before this
       existed) counts as old. */
    function shouldAskResume() {
        if (state.lessonIndex === 0 && state.stepIndex === 0) return false;
        return (state.resumeAge == null ? Infinity : state.resumeAge) > RESUME_ASK_AFTER;
    }

    function agoText(ms) {
        if (!isFinite(ms)) return 'last time';
        const m = Math.round(ms / 60000);
        if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
        const h = Math.round(m / 60);
        if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
        const d = Math.round(h / 24);
        return d + (d === 1 ? ' day ago' : ' days ago');
    }

    /* Resolves once the user has chosen. Nothing runs until they do: playStep
       would otherwise load a bench and animate a step they are being asked
       whether they want. */
    function askResume() {
        return new Promise(resolve => {
            const card = $('demo-resume');
            const l = lesson(), st = step();
            $('demo-resume-where').textContent =
                `You were on lesson ${state.lessonIndex + 1}, "${l.title}", step `
                + `${state.stepIndex + 1} of ${l.steps.length} (${st ? st.title : ''}), `
                + agoText(state.resumeAge) + '.';
            card.hidden = false;
            const nav = ['demo-next', 'demo-prev', 'demo-replay', 'demo-skip', 'demo-restart'];
            nav.forEach(id => { $(id).disabled = true; });
            const done = fresh => {
                card.hidden = true;
                nav.forEach(id => { $(id).disabled = false; });
                if (fresh) {
                    state.lessonIndex = 0;
                    state.stepIndex = 0;
                    renderLessonSelect();
                    saveProgress();
                }
                renderStep();
                resolve(fresh);
            };
            $('demo-resume-yes').addEventListener('click', () => done(false), { once: true });
            $('demo-resume-no').addEventListener('click', () => done(true), { once: true });
        });
    }

    /* ---------- the frame ---------- */
    function frame() { return $('demo-frame'); }

    /* The frame LAYS OUT at FRAME_W and is scaled to whatever the stage can give
       it, so the tool inside sees the same viewport at every window size.

       That is the whole point: every modal width tier is `min(px, vw)` and the
       3-zone breakpoint is 1366, so a frame whose width tracks the window folds
       modals on small screens and drops their previews below the fold. A 1300px
       tier that did exactly that shipped for a while (style.css has the numbers).
       Overlaying the rail instead just hides the right-hand 420px of the tool,
       which is what got reported with a screenshot at a 1725px window. Scaling
       costs size and nothing else, and the frame's own `dvh` grows to match, so
       modals get MORE vertical budget rather than less. */
    const FRAME_W = 1400;
    function fitFrame() {
        const st = $('demo-stage'), f = frame();
        if (!st || !f) return 1;
        const w = st.clientWidth, h = st.clientHeight;
        if (!w || !h) return 1;
        let k = Math.min(1, w / FRAME_W);
        /* Never resample the whole tool to recover a pixel or two. Anything
           within half a percent of 1:1 is laid out at the stage's own width
           and left untransformed, which keeps text crisp at the sizes where
           the frame very nearly fits. */
        if (k > 0.995) k = 1;
        f.style.width  = Math.round(w / k) + 'px';
        f.style.height = Math.round(h / k) + 'px';
        f.style.transform = k < 1 ? 'scale(' + k + ')' : 'none';
        return k;
    }

    /* Parent px per frame px. Read off the boxes rather than cached from
       `fitFrame`, so it cannot go stale against a layout that has already
       changed, and it is exactly 1 when nothing is scaled. */
    function frameScale() {
        const f = frame();
        const lw = f.offsetWidth;
        return lw ? f.getBoundingClientRect().width / lw : 1;
    }

    /* Can this page actually reach into the frame? Everything the course does
       goes through `contentWindow.TRLE._cap`, so if this is false there is no
       degraded mode to fall back to — only an honest explanation.

       It is false under `file://`, which is the case that matters: Chrome gives
       every local file its own OPAQUE origin, so reading `contentWindow.TRLE`
       throws SecurityError and `contentDocument` is null. The tool itself runs
       fine from a file, which is precisely why people open the course that way
       and then watch it say "Loading the tool…" forever. */
    function frameReachable() {
        try {
            const f = frame();
            if (!f.contentDocument) return false;   // null on an opaque origin
            void f.contentWindow.location.href;     // throws cross-origin
            return true;
        } catch { return false; }
    }

    /* Explain it where the tool would have been, with the command to fix it. */
    function showBlocked() {
        const panel = $('demo-blocked');
        if (!panel || !panel.hidden) return;
        veil(false);
        panel.hidden = false;

        const file = location.protocol === 'file:';
        $('demo-blocked-why').textContent = file
            ? 'This page was opened straight from a file. Browsers give every local file its own '
              + 'origin, so this page is not allowed to reach into the tool it loads, and driving '
              + 'the real tool is the whole mechanism of the course.'
            : 'This page cannot reach into the tool it loads, which usually means the two are being '
              + 'served from different origins. The course drives the real tool directly, so they '
              + 'have to come from the same one.';

        /* Name the folder the server must run from, and the URL that then works.
           In this repo that is the REPO ROOT, not AtlasTool/, because the
           validators and every in-page path assume /AtlasTool/... — CLAUDE.md
           says so outright. In the public export demo.html sits at the root and
           there is no AtlasTool/ segment, so both lines change together. */
        const path = decodeURIComponent(location.pathname);
        const inAtlas = /\/AtlasTool\/[^/]*$/.test(path);
        const ownDir = path.replace(/[^/]*$/, '');
        const serveDir = inAtlas ? ownDir.replace(/AtlasTool\/$/, '') : ownDir;
        const url = 'http://localhost:8080/' + (inAtlas ? 'AtlasTool/demo.html' : 'demo.html');
        $('demo-blocked-dir').textContent = serveDir || 'the folder holding this page';
        $('demo-blocked-cmd').textContent = 'python3 server.py';
        const a = $('demo-blocked-url');
        a.textContent = url;
        a.href = url;

        /* Dead controls read as a broken page — "if it looks clickable, it must
           be clickable" (CLAUDE.md). None of these can do anything now. */
        ['demo-next', 'demo-prev', 'demo-replay', 'demo-skip', 'demo-restart']
            .forEach(id => { const b = $(id); if (b) b.disabled = true; });
        $('demo-lesson-select').disabled = true;
        document.querySelectorAll('#demo-dots .demo-dot')
            .forEach(d => { d.disabled = true; });
        status('The course needs a local web server, see the panel on the left.', 'warn');
    }

    function pushChrome() {
        const w = frame().contentWindow;
        if (!w || !w.TRLE || !w.TRLE.Demo) return false;
        const p = userPrefs();
        w.TRLE.Demo.applyChrome({
            theme: p.theme === 'light' ? 'light' : 'dark',
            uiScale: typeof p.uiScale === 'number' ? p.uiScale : undefined
        });
        return true;
    }

    /* Show the tool's own side rails only where a lesson is teaching them.
       Hidden by default: Session + Messages and History cost 500px of the 1400px
       frame, and no step before lesson 1's last one mentions either. The frame
       loses the class on every reload, so this runs per step rather than once. */
    function applyRails(which) {
        try {
            const w = frame().contentWindow;
            const D = w && w.TRLE && w.TRLE.Demo;
            if (D && D.showRails) D.showRails(which || '');
        } catch { /* frame not reachable; showBlocked already said so */ }
    }

    /* `notDoc` is load-bearing on a RELOAD, and its absence cost an hour.
       `f.src = f.src` does not swap the document synchronously: for a beat the
       frame still holds the OUTGOING one, which already has a fully initialised
       TRLE on it. A plain "is TRLE there yet" poll therefore returns true
       immediately, against the document that is about to be thrown away — and
       the caller then reaches into `contentWindow.TRLE` a moment later and finds
       it undefined, because the new document is still parsing. Symptom: the
       course silently stops working after a backwards jump, with no error.
       Keying on document IDENTITY is what makes the wait mean what it says. */
    function waitForFrame(timeoutMs, notDoc) {
        const deadline = Date.now() + (timeoutMs || 20000);
        return new Promise(resolve => {
            const poll = () => {
                /* The try/catch is not decoration. On an opaque origin, touching
                   `contentWindow.TRLE` THROWS, and an uncaught throw in here
                   escapes the setTimeout chain — so the poll never runs again,
                   the deadline never fires, and the veil says "Loading the tool…"
                   for ever with no error anywhere the user can see. That is the
                   bug this whole branch exists to fix; keep the catch. */
                let ready = false;
                try {
                    const f = frame();
                    const w = f.contentWindow;
                    const fresh = !notDoc || f.contentDocument !== notDoc;
                    ready = fresh && !!(w && w.TRLE && w.TRLE._cap && w.TRLE.Demo);
                } catch { ready = false; }
                if (ready) { state.frameReady = true; pushChrome(); resolve(true); return; }
                if (Date.now() > deadline) { resolve(false); return; }
                setTimeout(poll, 120);
            };
            poll();
        });
    }

    /* A hard reset. Cheaper and more reliable than snapshot/restore, because it
       cannot half-succeed: the frame is simply a new document.

       `ifDirty` skips the reload when the frame is already pristine. Step 1 of
       every lesson asks for a clean sandbox, and on first load it already has
       one — without this the course reloads the tool a second time before the
       user has seen it, and sits on "Resetting the sandbox…" for a second and a
       half of its own first impression. */
    async function resetFrame(opts) {
        if (opts && opts.ifDirty && state.frameReady) {
            const w = frame().contentWindow;
            const cap = w && w.TRLE && w.TRLE._cap;
            try { if (cap && cap.count() === 0) return true; } catch { /* fall through */ }
        }
        state.frameReady = false;
        veil(true, 'Resetting the sandbox…');
        const f = frame();
        const oldDoc = f.contentDocument;     // see waitForFrame
        f.src = f.src;
        const ok = await waitForFrame(20000, oldDoc);
        veil(false);
        if (state.runner) { state.runner.clearDebounceCache(); state.runner.bindAbort(); }
        return ok;
    }

    function veil(on, msg) {
        const v = $('demo-frame-veil');
        v.hidden = !on;
        if (msg) v.querySelector('span').textContent = msg;
    }

    /* ---------- spotlight ---------- */
    function clearSpot() {
        state.spotTarget = null;
        ['top', 'bottom', 'left', 'right'].forEach(k => {
            $('demo-scrim-' + k).style.display = 'none';
        });
        $('demo-ring').style.display = 'none';
    }

    /* Resolve a step's `spotlight` to a rect in PARENT coordinates.
       The frame's own offset has to be added — without it everything lands at
       the top-left of the page, which is the one mistake this is worth a
       comment for. Verified at 0.00 px error against the modal's own rect. */
    /* `getBoundingClientRect` reports an element's full laid-out box and knows
       nothing about an ancestor clipping it, so a target inside an
       `overflow: hidden` column reports a width larger than the part you can
       actually see, and the ring is drawn over whatever sits next to it.

       Found from a screenshot: Build Pattern's middle zone was squeezed below
       its content between 1240 and ~1370 viewport px, `.at-modal-work`'s
       `overflow: hidden` cut the text off mid-word, and the ring carried on over
       the preview column. The squeeze is fixed in style.css, but the ring should
       never have been able to draw outside its target's visible area, so it
       intersects with every clipping ancestor on the way up. */
    function visibleRect(el, win) {
        let r = el.getBoundingClientRect();
        let p = el.parentElement;
        while (p) {
            const cs = win.getComputedStyle(p);
            if (/hidden|clip|auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
                const b = p.getBoundingClientRect();
                const left = Math.max(r.left, b.left), top = Math.max(r.top, b.top);
                const right = Math.min(r.right, b.right), bottom = Math.min(r.bottom, b.bottom);
                r = { left, top, right, bottom,
                      width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
            }
            p = p.parentElement;
        }
        return r;
    }

    /* Everything below converts a rect measured INSIDE the frame into parent
       coordinates, which is the frame's offset plus the inner rect times the
       frame's scale. `k` is 1 whenever the stage is wide enough to hold the
       frame at its natural size, so this is a no-op at 1720px and above. */
    function resolveRect(spec) {
        const f = frame();
        const fr = f.getBoundingClientRect();
        const k = frameScale();
        const d = f.contentDocument;
        const w = f.contentWindow;
        if (!d || !w) return null;
        let r = null;
        if (typeof spec === 'string') {
            const el = d.querySelector(spec);
            if (!el || !el.getBoundingClientRect) return null;
            if (el.checkVisibility && !el.checkVisibility()) return null;
            r = visibleRect(el, w);
        } else if (spec && spec.modal) {
            const cap = w.TRLE && w.TRLE._cap;
            if (!cap || !cap.modalRect) return null;
            const m = cap.modalRect(spec.modal);
            if (!m || !m.width) return null;
            r = { left: m.x, top: m.y, width: m.width, height: m.height };
        } else if (spec && typeof spec.grid === 'number') {
            const cells = d.querySelectorAll('#at-grid .at-cell');
            const el = cells[spec.grid];
            if (!el) return null;
            r = visibleRect(el, w);
        }
        if (!r || !r.width) return null;
        return { x: fr.left + r.left * k, y: fr.top + r.top * k,
                 w: r.width * k, h: r.height * k };
    }

    /* The scrim is bounded by the STAGE, not the viewport, so the lesson rail and
       the header never dim. Everything the spotlight can point at lives inside
       the frame, and the rail is the thing you are meant to be READING while it
       does — dimming it hides the explanation to highlight the control it is
       explaining, which is exactly backwards. */
    /* When a modal is open in the frame, the SCRIM's hole is the whole modal and
       the RING alone points at the control. Two different jobs: the scrim says
       "ignore the page behind this", the ring says "this control".

       Dimming inside the modal is the same mistake as dimming the rail, one
       level in — a step that sweeps Blend Radius and says "watch the preview"
       must not grey out the preview to highlight the slider. The modal is
       already visually separated from the page, so it needs no second scrim. */
    /* The topmost thing the frame currently has open: a modal, or the context
       menu. Returns null when neither. */
    function frameSurface() {
        try {
            const f = frame();
            const d = f.contentDocument;
            if (!d) return null;
            const fr = f.getBoundingClientRect();
            const k = frameScale();
            const box = el => {
                const r = el.getBoundingClientRect();
                return { x: fr.left + r.left * k, y: fr.top + r.top * k,
                         w: r.width * k, h: r.height * k, el };
            };
            const overlay = d.getElementById('at-overlay');
            if (overlay && overlay.style.display !== 'none') {
                const open = [...d.querySelectorAll('.at-modal')]
                    .find(m => m.style.display !== 'none' && m.checkVisibility && m.checkVisibility());
                if (open) return box(open);
            }
            const menu = d.getElementById('at-ctx');
            if (menu && menu.style.display !== 'none' && menu.checkVisibility && menu.checkVisibility()) {
                return box(menu);
            }
            return null;
        } catch { return null; }
    }

    function holeFor(ringRect) {
        const surf = frameSurface();
        return surf ? { x: surf.x, y: surf.y, w: surf.w, h: surf.h } : ringRect;
    }

    function paintSpot(ringRect) {
        if (!ringRect) { clearSpot(); return; }
        const rect = holeFor(ringRect);
        const pad = 6;
        const st = $('demo-stage').getBoundingClientRect();
        const sx = st.left, sy = st.top, sr = st.right, sb = st.bottom;

        // Clamp the hole to the stage: a target that hangs off the edge (a wide
        // context menu, a modal taller than the frame) must not punch a gap in
        // the scrim where there is no stage to see through.
        const x = Math.max(sx, rect.x - pad), y = Math.max(sy, rect.y - pad);
        const r = Math.min(sr, rect.x + rect.w + pad), b = Math.min(sb, rect.y + rect.h + pad);
        const w = Math.max(0, r - x), h = Math.max(0, b - y);

        const put = (k, css) => {
            const el = $('demo-scrim-' + k);
            el.style.display = 'block';
            Object.assign(el.style, css);
        };
        const px = v => Math.max(0, v) + 'px';
        put('top',    { left: px(sx), top: px(sy),    width: px(sr - sx), height: px(y - sy) });
        put('bottom', { left: px(sx), top: px(y + h), width: px(sr - sx), height: px(sb - (y + h)) });
        put('left',   { left: px(sx), top: px(y),     width: px(x - sx),  height: px(h) });
        put('right',  { left: px(x + w), top: px(y),  width: px(sr - (x + w)), height: px(h) });

        /* The ring is a PARENT element over an iframe, so it paints above
           everything the frame draws, whatever the frame's own z-index says.
           When the user opens a context menu or a modal that the step was not
           pointing at, the stale ring cuts straight across it and reads as two
           things fighting for the same pixels. It cannot be reordered across a
           document boundary, so it hides instead: whatever the frame has open
           on top is what the person is looking at. */
        const surf = frameSurface();
        const inside = !surf || (ringRect.x >= surf.x - 2 && ringRect.y >= surf.y - 2
            && ringRect.x + ringRect.w <= surf.x + surf.w + 2
            && ringRect.y + ringRect.h <= surf.y + surf.h + 2);
        const ring = $('demo-ring');
        if (!inside) { ring.style.display = 'none'; return; }
        const rx = Math.max(sx, ringRect.x - pad), ry = Math.max(sy, ringRect.y - pad);
        const rr = Math.min(sr, ringRect.x + ringRect.w + pad);
        const rb = Math.min(sb, ringRect.y + ringRect.h + pad);
        ring.style.display = 'block';
        Object.assign(ring.style, {
            left: px(rx), top: px(ry), width: px(rr - rx), height: px(rb - ry)
        });
    }

    function spotlight(spec) {
        state.spotTarget = spec || null;
        paintSpot(spec ? resolveRect(spec) : null);
    }
    function remeasure() {
        if (state.spotTarget) paintSpot(resolveRect(state.spotTarget));
    }

    /* ---------- rail ---------- */
    function renderLessonSelect() {
        const sel = $('demo-lesson-select');
        sel.innerHTML = '';
        lessons().forEach((l, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = `${l.icon} ${i + 1}. ${l.title}`;
            sel.appendChild(o);
        });
        // Lessons 2-8 are planned, not built. Say so rather than hiding it.
        const o = document.createElement('option');
        o.value = 'soon'; o.disabled = true;
        o.textContent = '(more lessons coming)';
        sel.appendChild(o);
        sel.value = String(state.lessonIndex);
    }

    function renderDots() {
        const wrap = $('demo-dots');
        wrap.innerHTML = '';
        const l = lesson();
        if (!l) return;
        l.steps.forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'demo-dot' + (i === state.stepIndex ? ' current' : (i < state.stepIndex ? ' done' : ''));
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(i === state.stepIndex));
            b.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`);
            b.title = `${i + 1}. ${s.title}`;
            b.addEventListener('click', () => goTo(i));
            wrap.appendChild(b);
        });
    }

    function renderStep() {
        const s = step();
        if (!s) return;
        $('demo-step-title').textContent = `${state.stepIndex + 1}. ${s.title}`;
        $('demo-step-say').innerHTML = s.say || '';
        const hand = $('demo-handoff');
        if (s.handoff) { hand.hidden = false; $('demo-handoff-text').innerHTML = s.handoff; }
        else hand.hidden = true;
        $('demo-prev').disabled = state.stepIndex === 0;
        $('demo-next').textContent =
            state.stepIndex >= lesson().steps.length - 1 ? 'Finish ✓' : 'Next →';
        $('demo-rail-body').scrollTop = 0;
        renderDots();
    }

    function status(msg, kind) {
        const el = $('demo-status');
        el.textContent = msg || '';
        el.className = 'demo-status' + (kind ? ' demo-status-' + kind : '');
    }

    /* ---------- running a step ----------
       GENERATION-GUARDED, and that is not defensive coding — it is the fix for
       a measured bug. A step's setup can take seconds (loading a 2 MB atlas,
       slicing it), and `goTo` does not and must not await the step it replaces.
       Without the guard the stale run carries on past every `await`: it paints
       ITS spotlight and status over the new step's, and keeps mutating the
       sandbox. On a fast machine with a warm cache it finishes before you can
       click; on a real one it reads as the course randomly changing pages and
       not responding to the dots. Every await is followed by a `stale()` check,
       and anything that navigates bumps `state.gen`. */
    async function playStep() {
        const s = step();
        if (!s) return;
        const gen = ++state.gen;
        const stale = () => gen !== state.gen;

        state.running = true;
        state.handedOver = false;
        status('');
        clearSpot();                 // never leave the last step's ring behind
        state.runner.begin();
        renderStep();

        try {
            if (s.requires) {
                // Preconditions can reload the frame, so say so rather than
                // looking frozen. This is also what the user sees instead of
                // "nothing happened" when they jump backwards.
                status('Setting up…');
                await state.runner.api.need(s.requires);
                if (stale()) return;
            }
            if (s.setup) { await s.setup(state.runner.api); if (stale()) return; }
            if (state.runner.isAborted()) return handover();
            status('');

            /* Before the spotlight: showing or hiding a rail reflows the grid,
               and the ring is a measured rect. */
            applyRails(s.rails);
            spotlight(s.spotlight || null);

            if (s.act) {
                await s.act(state.runner.api);
                if (stale()) return;
                if (state.runner.isAborted()) return handover();
                /* `spotlightAfter` exists because an action can DESTROY the thing
                   it was pointed at. Step 3 spotlights Slice Atlas, clicks it,
                   and the start card collapses — so the button fails
                   checkVisibility() and the ring silently disappears, which
                   reads as the spotlight being broken. Re-target at the result
                   instead: here is the button, now here are your sixteen tiles. */
                spotlight(s.spotlightAfter || s.spotlight || null);
            }

            if (s.sweep) {
                status('Watch the control…');
                const r = await state.runner.sweep(s.sweep, s.preview || null);
                if (stale()) return;
                if (state.runner.isAborted()) return handover();
                status(r.reduced
                    ? 'Motion reduced, jumped to the end value.'
                    : `Moved it for you (${r.dispatches} updates).`);
            }

            if (s.handoff) status('Your turn, the controls are live.', 'live');
            else status('');
        } catch (err) {
            // A step that throws used to vanish without trace, which is the
            // worst possible failure for something people are learning from.
            if (!stale()) {
                console.error('[demo] step failed:', err);
                status('This step could not set itself up. Try ⟲ Restart lesson.', 'warn');
            }
        } finally {
            if (!stale()) state.running = false;
        }
    }

    function handover() {
        state.handedOver = true;
        state.running = false;
        status('You took over, the script stopped. Use Next when you’re ready.', 'live');
        // Dim less, so the tool is fully usable while they explore.
        document.body.classList.add('demo-handed-over');
    }

    function goTo(i) {
        const l = lesson();
        if (!l) return;
        state.gen++;                 // strand any step still running
        state.stepIndex = Math.max(0, Math.min(l.steps.length - 1, i));
        document.body.classList.remove('demo-handed-over');
        if (state.runner) state.runner.stop();
        saveProgress();
        playStep();
    }

    async function selectLesson(i, opts) {
        state.gen++;                 // strand any step still running
        state.lessonIndex = i;
        state.stepIndex = (opts && opts.step) || 0;
        renderLessonSelect();
        document.body.classList.remove('demo-handed-over');
        if (state.runner) state.runner.stop();
        clearSpot();
        saveProgress();
        await playStep();
    }

    /* ---------- wiring ---------- */
    function wire() {
        $('demo-next').addEventListener('click', () => {
            const l = lesson();
            if (state.stepIndex >= l.steps.length - 1) {
                if (!state.completed.includes(l.id)) state.completed.push(l.id);
                saveProgress();
                status('Lesson complete. Pick another above, or open the real tool.', 'live');
                clearSpot();
                return;
            }
            goTo(state.stepIndex + 1);
        });
        $('demo-prev').addEventListener('click', () => goTo(state.stepIndex - 1));
        $('demo-replay').addEventListener('click', () => goTo(state.stepIndex));
        $('demo-skip').addEventListener('click', () => {
            if (state.runner) state.runner.stop();
            handover();
        });
        $('demo-restart').addEventListener('click', async () => {
            if (state.runner) state.runner.stop();
            await resetFrame({ ifDirty: false });   // Restart always means a real reset
            selectLesson(state.lessonIndex, { step: 0 });
        });
        $('demo-lesson-select').addEventListener('change', e => {
            const v = e.target.value;
            if (v === 'soon') { e.target.value = String(state.lessonIndex); return; }
            selectLesson(parseInt(v, 10), { step: 0 });
        });

        // The scrim hole is measured, so anything that moves the frame invalidates it.
        // Resizing also changes the frame's scale, so re-fit before re-measuring.
        const relayout = () => { fitFrame(); remeasure(); };
        window.addEventListener('resize', relayout);
        window.addEventListener('scroll', remeasure, true);
        const ro = window.ResizeObserver ? new ResizeObserver(relayout) : null;
        if (ro) ro.observe($('demo-stage'));
        // Re-measure while the frame's own content scrolls.
        setInterval(() => { if (state.spotTarget && !document.hidden) remeasure(); }, 400);

        document.addEventListener('keydown', e => {
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); $('demo-next').click(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); $('demo-prev').click(); }
            else if (e.key === 'Escape') { if (state.runner) state.runner.stop(); handover(); }
        });
    }

    async function boot() {
        if (!lessons().length) { status('No lessons are loaded.', 'warn'); return; }
        loadProgress();
        renderLessonSelect();
        renderStep();
        wire();

        fitFrame();   // before the first paint, or the tool lays out twice
        veil(true, 'Loading the tool…');
        // Check reachability FIRST. Waiting 20 s to tell someone their URL is
        // wrong is its own small insult, and on file:// the wait is pointless:
        // no amount of loading makes an opaque origin readable.
        if (location.protocol === 'file:') { showBlocked(); return; }
        const ok = await waitForFrame();
        veil(false);
        if (!ok) {
            if (!frameReachable()) { showBlocked(); return; }
            status('The tool did not load. Is WebGL 2.0 available in this browser?', 'warn');
            return;
        }

        state.runner = TRLE.DemoRunner.create({
            frame: frame(),
            stage: $('demo-stage'),
            onAbort: handover,
            onStatus: status,
            reset: resetFrame
        });

        // Expose a small surface for tools/validate-demo.mjs. Read-only probes,
        // same spirit as TRLE._cap: assert on the real thing, don't re-implement it.
        window.TRLE = window.TRLE || {};
        TRLE.DemoAPI = {
            state: () => ({ lesson: lesson().id, step: state.stepIndex,
                            stepId: step() && step().id,
                            running: state.running, handedOver: state.handedOver,
                            frameReady: state.frameReady }),
            rect: () => state.spotTarget ? resolveRect(state.spotTarget) : null,
            spotVisible: () => $('demo-ring').style.display === 'block',
            frameScale,
            frameLayoutWidth: () => frame().offsetWidth,
            goTo, selectLesson, resetFrame,
            runner: () => state.runner,
            frameKeys: () => {
                const w = frame().contentWindow;
                return w && w.TRLE && w.TRLE.Demo ? w.TRLE.Demo.storageKeys() : null;
            },
            progressKey: PROGRESS_KEY,
            resumeAsk: RESUME_ASK_AFTER,
            resumeVisible: () => !$('demo-resume').hidden
        };

        if (shouldAskResume()) await askResume();

        await playStep();
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
