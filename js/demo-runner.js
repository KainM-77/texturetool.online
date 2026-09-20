/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. MIT Licensed (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — demo step runner

   Drives the real tool inside the frame, spotlights what it is talking about,
   and gets out of the way the moment the user touches anything.

   Three things here are load-bearing and were measured, not guessed
   (docs/demo/plan.md §1):

   1. THE DISPATCH CADENCE IS NOT THE FRAME RATE. A slider sweep that fires one
      `input` per animation frame re-renders the preview exactly ONCE, at the
      end. Build Pattern: 56 dispatches -> 1 render. Set Material: 62 -> 1. The
      cause is trailing-edge debouncing (`bpScheduleRegen` 80 ms,
      `matSchedulePreview` 250 ms) -- a timer reset every 16 ms never fires.
      Above the debounce, conversion is 100%: one render per dispatch.
      So `sweep()` moves the handle every frame for smooth motion and dispatches
      on a separate timer at `debounce + DISPATCH_MARGIN`.

   2. THE DEBOUNCE IS READ FROM THE TOOL, NOT HARDCODED. `probeDebounce()`
      measures it live: dispatch, watch the preview, time the gap to the first
      render. A hardcoded table would silently go stale the day someone retunes
      a debounce, and the failure is invisible -- the preview just stops moving.
      Measured values are cached per control and fall back to DEFAULT_DEBOUNCE.

   3. THE SCRIM HOLE IS PARENT-SIDE AND EXACT. The rect comes out of the frame's
      coordinate space and has the frame's own offset added. Verified at
      0.00 px error. A `z-index` promotion cannot work across a frame boundary,
      which is why this is four divs and not one raised element.
   ============================================================ */
window.TRLE = window.TRLE || {};

TRLE.DemoRunner = (function () {
    'use strict';

    /* How far past a measured debounce to dispatch. Small enough that a sweep
       still gets many renders, large enough to clear timer jitter. */
    const DISPATCH_MARGIN = 20;
    /* Used when a control's debounce cannot be measured (no preview changed, or
       the probe timed out). Slow, never wrong: above every debounce in the tool. */
    const DEFAULT_DEBOUNCE = 300;
    const PROBE_TIMEOUT = 700;

    function create(opts) {
        const frameEl = opts.frame;
        const onStatus = opts.onStatus || (() => {});
        const onAbort = opts.onAbort || (() => {});

        let aborted = false;
        let setKey = null;         // which declarative tile set is currently built
        let rafId = 0;
        let timers = [];
        const debounceCache = new Map();
        let abortBound = null;

        const win = () => frameEl.contentWindow;
        const doc = () => frameEl.contentDocument;
        const cap = () => { const w = win(); return w && w.TRLE && w.TRLE._cap; };

        const reduced = () => {
            const m = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
            // Check the FRAME too: the tool's global CSS block zeroes its own
            // transitions, but a JS tween out here is untouched by that.
            const f = win() && win().matchMedia
                ? win().matchMedia('(prefers-reduced-motion: reduce)') : null;
            return !!((m && m.matches) || (f && f.matches));
        };

        const sleep = ms => new Promise(res => { const t = setTimeout(res, ms); timers.push(t); });
        const raf = () => new Promise(res => { rafId = requestAnimationFrame(res); });

        function clearAll() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            timers.forEach(clearTimeout);
            timers = [];
        }

        /* ---- abort ----------------------------------------------------
           A single user gesture ends the script. No rewind: the gesture IS the
           new state, and putting a slider back where the animation wanted it
           would be the tool arguing with the person using it.

           BOUND ON BOTH DOCUMENTS, and that is not belt-and-braces. A real
           click inside the frame is seen by the frame's document, which is the
           path that matters in use. But it is NOT the path a test can reach:
           CDP's Input.dispatchMouseEvent delivers to the TOP document only —
           measured, a click at the centre of the frame scored 0 pointerdowns
           in contentDocument and 1 in the parent. So the parent listener is
           what a validator can exercise, and it is also genuinely needed for
           the moment before the frame takes focus.

           The parent listener is FILTERED to the stage. Without that, clicking
           Next or Replay in the rail would count as taking over, and the step
           would hand off at the exact moment the user asked for the next one. */
        function bindAbort() {
            unbindAbort();
            const hit = e => {
                if (!e.isTrusted) return;     // ignore what the runner dispatches
                if (aborted) return;
                aborted = true;
                clearAll();
                onAbort();
            };
            const stageHit = e => {
                const stage = opts.stage;
                if (stage && e.target && stage.contains(e.target)) hit(e);
            };
            const d = doc();
            if (d) {
                d.addEventListener('pointerdown', hit, true);
                d.addEventListener('keydown', hit, true);
                d.addEventListener('wheel', hit, true);
            }
            document.addEventListener('pointerdown', stageHit, true);
            abortBound = { d, hit, stageHit };
        }
        function unbindAbort() {
            if (!abortBound) return;
            const { d, hit, stageHit } = abortBound;
            try {
                if (d) {
                    d.removeEventListener('pointerdown', hit, true);
                    d.removeEventListener('keydown', hit, true);
                    d.removeEventListener('wheel', hit, true);
                }
            } catch { /* frame swapped under us */ }
            document.removeEventListener('pointerdown', stageHit, true);
            abortBound = null;
        }

        /* ---- measuring the preview ------------------------------------ */
        function previewSig(sel) {
            const d = doc();
            if (!d) return null;
            const cv = d.querySelector(sel);
            if (!cv || !cv.width) return null;
            try {
                const o = d.createElement('canvas');
                o.width = cv.width; o.height = cv.height;
                o.getContext('2d').drawImage(cv, 0, 0);
                const px = o.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
                let h = 2166136261;
                for (let i = 0; i < px.length; i += 997) { h ^= px[i]; h = Math.imul(h, 16777619); }
                return (h >>> 0).toString(16);
            } catch { return null; }
        }

        /* The live debounce of `controlId`, in ms, by measurement.
           Nudge the control once, poll the preview, report the delay to the
           first change. Cached — the answer is a property of the code, not of
           the moment. Returns DEFAULT_DEBOUNCE when nothing can be measured. */
        async function probeDebounce(controlId, previewSel) {
            if (debounceCache.has(controlId)) return debounceCache.get(controlId);
            let result = DEFAULT_DEBOUNCE;
            const d = doc();
            const el = d && d.getElementById(controlId);
            if (el && previewSel) {
                const before = previewSig(previewSel);
                const start = performance.now();
                const original = el.value;
                const min = parseFloat(el.min), max = parseFloat(el.max);
                const step = isFinite(min) && isFinite(max) ? (max - min) / 20 : 1;
                el.value = String(parseFloat(original) + (parseFloat(original) + step <= max ? step : -step));
                dispatch(el, 'input');
                while (performance.now() - start < PROBE_TIMEOUT) {
                    await sleep(16);
                    if (aborted) break;
                    if (previewSig(previewSel) !== before) {
                        result = Math.round(performance.now() - start);
                        break;
                    }
                }
                el.value = original;
                dispatch(el, 'input');
                await sleep(result + DISPATCH_MARGIN);
            }
            debounceCache.set(controlId, result);
            return result;
        }

        function dispatch(el, type) {
            const W = win();
            el.dispatchEvent(new W.Event(type || 'input', { bubbles: true }));
        }

        /* ---- the sweep -------------------------------------------------
           Handle moves every frame; the event fires on its own clock. */
        async function sweep(spec, previewSel) {
            const d = doc();
            const el = d && d.getElementById(spec.id);
            if (!el) return { renders: 0, dispatches: 0, skipped: 'no-control' };

            if (reduced()) {
                el.value = String(spec.to);   // the end value is authored, not interpolated
                dispatch(el, 'input');
                dispatch(el, 'change');
                return { renders: 1, dispatches: 1, reduced: true };
            }

            const gap = (previewSel ? await probeDebounce(spec.id, previewSel) : DEFAULT_DEBOUNCE)
                        + DISPATCH_MARGIN;
            if (aborted) return { renders: 0, dispatches: 0, aborted: true };

            const ms = spec.ms || 1200;
            /* Snap to the CONTROL's own step, not to whole numbers. Math.round
               was fine while every swept slider was an integer and silently
               useless the moment one was not: the material editor's Angularity,
               Tilt, Fine Detail, Large Scale, AO Depth and AO Curve are all
               0-to-1 at step 0.05, so a rounded sweep visits 0 and 1 and nothing
               between, which reads as a slider that snaps rather than moves.
               With step 1 this is byte-identical to the old line. */
            const stp = parseFloat(el.step) || 1;
            const dec = (String(stp).split('.')[1] || '').length;
            const t0 = performance.now();
            let dispatches = 0, renders = 0;
            let last = previewSel ? previewSig(previewSel) : null;
            let nextDispatch = t0;

            for (;;) {
                if (aborted) break;
                const now = performance.now();
                const t = Math.min(1, (now - t0) / ms);
                const v = (Math.round((spec.from + (spec.to - spec.from) * t) / stp) * stp).toFixed(dec);
                el.value = v;                               // visual: every frame
                if (now >= nextDispatch || t >= 1) {        // events: on the debounce
                    dispatch(el, 'input');
                    dispatches++;
                    nextDispatch = now + gap;
                    if (previewSel) {
                        const s = previewSig(previewSel);
                        if (s !== last) { renders++; last = s; }
                    }
                }
                if (t >= 1) break;
                await raf();
            }
            /* One `change` at the END, never per tick. That is what a real drag
               does -- `input` continuously, `change` on release -- and it is the
               only thing that drives the controls bound on `change` rather than
               `input`: `at-cols-input` is one, and a sweep of it moved the number
               and reflowed nothing until this was added. Per-tick `change` is not
               the fix: setColumns pushes an undo entry and a toast, so ten ticks
               would be ten of each. */
            if (!aborted) {
                dispatch(el, 'change');
                await sleep(gap);
                if (previewSel && previewSig(previewSel) !== last) renders++;
            }
            return { renders, dispatches, gap };
        }

        /* ---- scripted interaction -------------------------------------- */
        async function click(sel) {
            const d = doc();
            const el = d && d.querySelector(sel);
            if (!el) return false;
            el.click();
            return true;
        }

        /* ---- the step API handed to lesson content --------------------- */
        const api = {
            frame: () => frameEl,
            doc,
            win,
            aborted: () => aborted,
            /* Steps that animate by hand (rather than through `sweep` or
               `orbitLight`) have to honour the OS setting themselves, so they
               need to be able to ask. Lesson 9's parallax turn is the case. */
            reduced,
            wait: sleep,
            click,
            /* Waits briefly for `_cap` rather than returning null the instant it
               is missing: a frame reload leaves a window with no TRLE on it for
               a beat, and a step calling straight through would silently no-op. */
            async cap(fn, ...args) {
                let c = cap();
                for (let i = 0; i < 40 && !c && !aborted; i++) { await sleep(100); c = cap(); }
                if (!c || typeof c[fn] !== 'function') return null;
                return await c[fn](...args);
            },
            async tileId(index1) {
                const ids = await api.cap('ids');
                return ids && ids[index1] != null ? ids[index1] : (ids && ids[0]);
            },
            /* Bring the sandbox to an EXACT state, resetting if it has gone
               past it. Steps declare `requires` rather than writing setup code,
               because the progress dots let people arrive at any step from any
               other — forwards OR backwards — and a step that only works after
               its predecessors is a step that cannot be linked to.

               Backwards is the case that made this necessary. Step 3 is "click
               Slice Atlas", and steps 4-8 slice. Jump back to 3 with tiles
               already on screen and the start card is collapsed, so the button
               it spotlights fails checkVisibility() and the ring silently does
               not appear — measured, and it reads as the course being broken.
               "At least sliced" cannot express that; "exactly loaded" can.

                 pristine  start screen, nothing loaded
                 loaded    atlas image in, NOT yet sliced
                 sliced    tiles on the grid                                  */
            async need(want) {
                const atlas = (TRLE.DemoAssets || {}).atlas || 'Examples/ExampleAtlas.png';
                const count = () => { const c = cap(); return c ? c.count() : 0; };
                /* A lesson can ask for an exact tile SET rather than one of the
                   three atlas states: `{ tiles: [...] }`. Built once and then
                   left alone — rebuilding it on every step would throw away the
                   edits the previous steps just taught you to make, which is the
                   opposite of a lesson that builds on itself. `setKey` is what
                   lets a later step tell "already built" from "someone jumped in
                   from another lesson". */
                if (want && want.tiles) {
                    const key = JSON.stringify(want.tiles);
                    /* Count is deliberately NOT part of the test. A lesson that
                       teaches a generator ends up adding tiles to its own bench,
                       and an exact-count check would tear the bench down on the
                       very next step and throw away the thing you just made.
                       `setKey` answers the only question that matters: is this
                       lesson's bench the one currently loaded. */
                    if (setKey === key && count() > 0) return true;
                    await api.cap('setupFrom', want.tiles, want.size || 256);
                    setKey = key;
                    return count() > 0;
                }
                setKey = null;
                if (want === 'sliced') {
                    if (count() > 0) return true;
                    await api.cap('loadAtlas', atlas);
                    await api.click('#at-slice-btn');
                    for (let i = 0; i < 40 && !aborted; i++) {
                        await sleep(100);
                        if (count() > 0) break;
                    }
                    return count() > 0;
                }
                // Both remaining states need an EMPTY grid, so anything sliced
                // has to go. A frame reload is the only honest way back.
                if (count() > 0) await api.reset({ ifDirty: false });
                if (want === 'loaded') await api.cap('loadAtlas', atlas);
                return true;
            },
            /* Swing the 2D preview's light around a circle. This is the step that
               makes a normal map legible: a still frame of a lit surface is just a
               picture, and the relief only declares itself when the light moves
               and the shading follows it. Reduced motion jumps to one off-axis
               position instead of sweeping, which still shows relief without
               animating anything. */
            async orbitLight(opts) {
                const o = Object.assign({ turns: 1, ms: 2600, throughAxis: false }, opts || {});
                if (reduced()) {
                    await api.cap('matLight', o.throughAxis ? 0 : -0.55, o.throughAxis ? 0 : 0.45,
                                  o.throughAxis ? 1 : 0.7);
                    return 1;
                }
                const t0 = performance.now();
                let n = 0;
                for (;;) {
                    if (aborted) break;
                    const t = Math.min(1, (performance.now() - t0) / o.ms);
                    const a = t * Math.PI * 2 * o.turns - Math.PI / 2;
                    /* `throughAxis` swings the light from oblique up through
                       head-on and back out. It exists because the preview's
                       highlight is a Phong lobe against a FIXED view direction of
                       (0,0,1), so at an oblique light it is off screen entirely:
                       measured, specular contributes a mean delta of 0.00 at
                       L=(-0.8,0.5,0.6) and 4.21 at L=(0,0,1). An orbit at constant
                       z never shows a highlight at all. */
                    const r = o.throughAxis ? Math.abs(Math.cos(t * Math.PI)) * 0.55 : 0.8;
                    const z = o.throughAxis ? 1 - Math.abs(Math.cos(t * Math.PI)) * 0.35 : 0.6;
                    await api.cap('matLight', Math.cos(a) * r, Math.sin(a) * r, z);
                    n++;
                    if (t >= 1) break;
                    await raf();
                }
                return n;
            },
            /* Set a select or input and fire the events a real edit fires. Used
               for one-shot changes; a SWEEP goes through sweep() instead, which
               has to respect the target's debounce. */
            async setValue(id, value, evt) {
                const d = doc();
                const el = d && d.getElementById(id);
                if (!el) return false;
                el.value = String(value);
                dispatch(el, evt || 'input');
                if ((evt || 'input') !== 'change') dispatch(el, 'change');
                return el.value === String(value);
            },
            /* Tick a group of checkboxes addressed by a data attribute, e.g. the
               3D preview's `Show: Normal / AO / Roughness / Emissive` toggles.
               Only the keys named are touched, so a step can add one map to
               whatever the previous step left on. */
            async setChecks(selector, wanted) {
                const d = doc();
                if (!d) return 0;
                let n = 0;
                for (const el of d.querySelectorAll(selector)) {
                    /* `data-map` as well as `data-m3d`: the export card's map
                       checkboxes are addressed by the first and the 3D preview's
                       toggles by the second. Falling through to `el.value` is not a
                       safe default for either, because a checkbox with no explicit
                       value reports "on", so an unrecognised group silently matches
                       nothing instead of failing. */
                    const key = el.dataset ? (el.dataset.m3d || el.dataset.map || el.value || el.name) : null;
                    if (!key || !(key in wanted)) continue;
                    if (el.checked !== !!wanted[key]) {
                        el.checked = !!wanted[key];
                        dispatch(el, 'change');
                        n++;
                    }
                }
                return n;
            },
            /* A cadence-aware sweep from inside a step's `act`. Steps normally
               DECLARE `sweep`, which is what validate-demo.mjs reads and asserts
               on, so use that whenever a step has one demonstration. This is for
               the steps that genuinely need two in sequence: specular then
               roughness on the same tile, or strength then blur on the sand,
               where splitting them into two steps would separate a claim from
               its counter-example. */
            async sweep(spec, previewSel) { return sweep(spec, previewSel); },
            async closeMenu() {
                const d = doc();
                const m = d && d.getElementById('at-ctx');
                if (m) m.style.display = 'none';
                await api.cap('closeModal');
            },
            /* `{ ifDirty: true }` by default: a lesson's first step wants a clean
               sandbox, not necessarily a reload. See resetFrame in demo.js. */
            async reset(o) { return opts.reset ? opts.reset(o || { ifDirty: true }) : null; },
            status: onStatus
        };

        return {
            api,
            reduced,
            bindAbort,
            unbindAbort,
            /* test-only: prove the frame-side listener is attached, since CDP
               cannot deliver a trusted event into the frame to exercise it. */
            abortBoundTo: () => abortBound ? { frame: !!abortBound.d, parent: !!abortBound.stageHit } : null,
            probeDebounce,
            previewSig,
            sweep,
            click,
            isAborted: () => aborted,
            begin() { aborted = false; clearAll(); bindAbort(); },
            stop() { aborted = true; clearAll(); },
            cancel() { clearAll(); },
            clearDebounceCache() { debounceCache.clear(); }
        };
    }

    return { create, DISPATCH_MARGIN, DEFAULT_DEBOUNCE };
})();
