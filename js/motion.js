/* TRLE.Motion: the tool-wide animation switch (GRID-SLOT-PLAN phase 7, D22).

   One answer to "should this move?" for every page: the tool, the Learn pages,
   the demo and the Room View. The user's choice (the Animations button in the
   tool's accessibility bar) wins; with no choice made it follows the OS
   `prefers-reduced-motion`, live. It sets `html[data-motion="on"|"off"]`, which
   the stylesheet keys its "no motion" rules off, and answers JS tweens through
   `TRLE.Motion.reduced()`. Loaded first, in <head>, so the attribute is there
   before the first paint and no transition runs on load.

   It only READS the stored choice. atlas.js owns the prefs object and writes it
   (savePref), then calls `set()`, so the two never race over localStorage. The
   key matches atlas.js's, including the `-demo` namespace the demo frame uses. */
window.TRLE = window.TRLE || {};
(function () {
    const KEY = 'trle-atlas-prefs' + (/[?&]demo\b/i.test(location.search) ? '-demo' : '');
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let pref = null;   // 'on' | 'off' | null (follow the OS)
    try {
        const p = JSON.parse(localStorage.getItem(KEY)) || {};
        if (p.motion === 'on' || p.motion === 'off') pref = p.motion;
    } catch { /* storage blocked: follow the OS */ }
    const osReduced = () => !!(mq && mq.matches);
    const reduced = () => (pref ? pref === 'off' : osReduced());
    const apply = () => { document.documentElement.dataset.motion = reduced() ? 'off' : 'on'; };
    apply();
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (!pref) apply(); });
    TRLE.Motion = {
        reduced,
        pref: () => pref,
        osReduced,
        set(v) { pref = (v === 'on' || v === 'off') ? v : null; apply(); }
    };
})();
