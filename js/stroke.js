/* TRLE.Stroke — the brush engine behind 🖌 Draw and the generated markings.
   ------------------------------------------------------------------------
   PUSH-MARKINGS-PLAN.md phases 1a-1e. The model is a photo editor's (D13):

     - a stroke paints into its OWN buffer, one dab at a time, each dab at
       FLOW, so paint builds up where dabs overlap;
     - the finished buffer is composited onto the layer ONCE, at OPACITY and
       with the stroke's blend mode, so a stroke never passes its opacity
       however often it crosses itself, and a second stroke builds on the first.

   That is the opposite of the shared mask editor, whose dabs land straight on
   the mask (`lighten` below Value 100). Right for a selection, wrong for paint;
   the two are deliberately separate (plan D11, D13).

   The stroke buffer is FLOAT, not a canvas (phase 1b.2). An 8-bit canvas rounds
   every faint dab, so low-flow paint stalled short of full coverage and drifted
   in colour: a red (200,30,30) scribbled at flow 2% ended at (184,0,0) with
   alpha 231. Photoshop paints at 16 bits for this reason. Measured against
   WebGL: half float still stalls (alpha 252); full float needs EXT_float_blend,
   a read-back per frame and rounds differently per GPU. Plain Float32Array
   arithmetic is exact, identical on every machine, and ~0.25 ms per dab even
   for a 300 px soft brush. The buffer is SPARSE, 64 px blocks allocated where
   paint lands, because a dense one is 64 MB at 2048 px and 256 MB at 4096.
   It is turned into pixels once, when shown or composited (`buffer`), which is
   the only 8-bit rounding a stroke goes through.

   Input is mouse-first (D12): no pen pressure, tilt or wheel. Dabs are placed
   along a centripetal Catmull-Rom spline through the (optionally smoothed)
   samples, `spacing x diameter` apart by arc length, the remainder carried
   across samples so dabs never bunch where the pointer happened to report.

   DETERMINISM is a contract, not a nicety: the same samples, brush and seed
   give the same pixels whether they arrive live (`begin` + `add` + `end`) or
   all at once (`render`). The plan's Q3 (store points or pixels) and every
   validator depend on it. So all randomness comes from the stroke's own seeded
   generator, and the live preview of the unfinished tail never advances it.
   Across browsers it holds for everything but a rotated tip, whose Math.cos /
   Math.sin may differ in the last bit between JS engines.

   Provenance (the MIT position, CLAUDE.md): written for this tool. The
   behaviour follows published descriptions (Photoshop's brush settings,
   Krita's "Opacity and Flow" page); the spline is the textbook centripetal
   Catmull-Rom (Barry-Goldman evaluation). No code was copied from anywhere. */
window.TRLE = window.TRLE || {};
TRLE.Stroke = (() => {
    'use strict';

    /* Brush settings. Units: size in surface px (diameter), spacing as a
       fraction of the diameter (Photoshop's 25% default), everything else 0..1
       except angle (degrees) and smoothing (the leash length in surface px;
       the UI converts its % into px at the current zoom). */
    const DEFAULTS = Object.freeze({
        size: 12, hardness: 1, angle: 0, roundness: 1, spacing: 0.25,
        flow: 1, opacity: 1, smoothing: 0, catchUpEnd: false,
        color: [0, 0, 0], blend: 'source-over', erase: false,
        /* ---- dynamics (phase 1c), Photoshop's panels by name. Every jitter is
           0..1 and every control 'off' by default, and at those values the
           stroke takes exactly the no-dynamics path (asserted byte-identical).
           A `...Fade` is Photoshop's Fade N steps: the value goes from full to
           its minimum over N dabs, counted per spacing position. */
        // Shape Dynamics
        sizeJitter: 0, sizeControl: 'off', sizeFade: 25, minDiameter: 0,
        angleJitter: 0, angleControl: 'off',            // 'direction' | 'initial'
        roundnessJitter: 0, roundnessControl: 'off', roundnessFade: 25, minRoundness: 0.1,
        flipX: false, flipY: false,
        // Scattering: offset in diameters, across the stroke or on both axes
        scatter: 0, scatterBoth: false, count: 1, countJitter: 0,
        // Transfer: opacity is a per-dab CEILING, flow a per-dab DEPOSIT
        opacityJitter: 0, opacityControl: 'off', opacityFade: 25, minOpacity: 0,
        flowJitter: 0, flowControl: 'off', flowFade: 25, minFlow: 0,
        // Color Dynamics
        bgColor: [255, 255, 255],
        fgbgJitter: 0, fgbgControl: 'off', fgbgFade: 25,
        hueJitter: 0, satJitter: 0, brightJitter: 0, purity: 0, colorPerTip: true,
        /* ---- tier B, path and time (phase 1d.1). A mouse has no pressure (D12),
           so thin ends come from here:
             taperIn / taperOut: px of arc length over which the size ramps from
               taperMin (0..1) up to full, at the start and at the end;
             speedThin 0..1: the faster the pointer, the thinner (pressure from
               speed: 0 = off, 1 = a fast flick thins to nothing), at full effect
               from speedRef px per ms (a length over time, so scaleBrush scales
               it: points re-rendered at 4x move 4x as far in the same time);
             buildUp: Photoshop's airbrush, dabs keep landing while the pointer
               holds still (driven by tick(), recorded like Stroke Catch-up);
             noise 0..1: grain on the soft edges only, fixed to surface position. */
        taperIn: 0, taperOut: 0, taperMin: 0, speedThin: 0, speedRef: 3, buildUp: false, noise: 0,
        /* ---- tier B, the tip (phase 1d.2), all off when null:
             tip: a registered tip id ('chalk', 'tile:5', ...) instead of the ellipse
               (hardness does not apply to it, as in Photoshop);
             texture: { id, scale, depth 0..1, mode 'multiply' | 'subtract' | 'height',
               invert } -- a registered PATTERN through the whole stroke, in surface
               coordinates, so it lines up across tiles;
             dual: { tip, size, spacing, scatter, scatterBoth, count, hardness } -- a
               second brush along the same path; the stroke shows only where both
               painted (Photoshop's Dual Brush in Multiply). */
        tip: null, texture: null, dual: null,
        /* ---- tier B, wet edges (phase 1d.3): 0..1. The stroke's interior thins to
           1 - wetEdges / 2 and its rim stays full, the watercolour / ink look. A rim
           belongs to the whole STROKE, not to each dab (per-dab rims would show every
           dab's edge inside the stroke), so it is computed where float becomes
           pixels, from a box blur of the stroke's solid region (alpha > 0.5). */
        wetEdges: 0,
        /* ---- tier C, the path itself (phase 1e): wobble 0..~1 moves the paint
           sideways by up to that many diameters, along a smooth seeded curve over
           the stroke's length, wobbleScale diameters per swing. It is what makes a
           dragged block's track look fought for rather than ruled (the Struggle end
           of Rigid <-> Struggle). A function of arc length and seed only, so it
           replays exactly and draws nothing from the dab stream. The tip turns
           with the wobble (Angle "Direction" follows the wobbled path).
           bite 0..1: the paint comes and goes in patches along the track, half a
           wobble swing long (the block biting in and skipping), by the same rule.
           It caps each dab's opacity (Transfer's ceiling), because a cut in flow
           is filled straight back in by the next thirty overlapping dabs. */
        wobble: 0, wobbleScale: 6, bite: 0
    });
    /* The stroke blend modes, with Photoshop's names. All are canvas
       `globalCompositeOperation` values, so nothing here needs a shader.
       validate-stroke composites every one and fails if any matches another
       or Normal, which is what an unsupported string silently does. */
    const BLEND_MODES = Object.freeze([
        ['source-over', 'Normal'],
        ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'],
        ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'],
        ['lighter', 'Linear Dodge (Add)'],
        ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'],
        ['difference', 'Difference'], ['exclusion', 'Exclusion'],
        ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
    ].map(([id, label]) => Object.freeze({ id, label })));
    const RANDS_PER_DAB = 16;   // fixed, so one control never reshuffles another's randomness
    const brushOf = b => Object.assign({}, DEFAULTS, b || {});

    /* Photoshop's "Stroke Catch-up": while the pointer holds still, the paint
       eases in to meet it. The caller drives it with `tick(t)` once a frame, and
       each tick that moves the leash is RECORDED in the samples (a 4th element of
       1), so a replay catches up exactly as the live stroke did.

       It used to be a jump applied when the NEXT move arrived after a pause. A
       held-still pointer sends no moves, so the paint sat short of the cursor
       and then leapt to it on release (reported 2026-09-25; measured 13 px short
       at Smoothing 50%, 26 px at 100%). The leap on release was "Catch-up on
       Stroke End", which Photoshop leaves off by default and so does this now. */
    const CATCHUP_DELAY_MS = 50;   // still for this long before the paint starts to follow
    const CATCHUP_TAU_MS = 90;     // then it closes the gap with this time constant
    const BUILD_DELAY_MS = 40;     // build-up starts after the pointer has held still this long
    const BUILD_MS = 40;           // then one dab every 40 ms (25 a second)
    /* Tips are baked at a quarter-pixel phase and stamped on the integer grid:
       resampling a crisp edge to a fractional position blurs it by a pixel,
       which is the one thing a hard brush must not do. Big soft tips cannot show
       a quarter pixel, so they use one phase and a quarter of the cache. */
    const PHASES = 4;
    const PHASE_MAX_SOFT = 32;   // px diameter above which a soft tip is phase-free
    const MIN_STEP = 0.2;        // px; the floor under spacing x diameter
    const BS = 64;               // buffer block size, px (power of two: see >> 6)
    const BSH = 6;

    /* ---- seeded randomness (mulberry32) ------------------------------ */
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        const next = () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        next.state = () => a;
        next.fork = () => rng(a);   // same sequence, independent cursor
        return next;
    }

    /* ---- sampled tips and patterns (phase 1d.2) --------------------------
       A SAMPLED tip is an image whose coverage stamps instead of the computed
       ellipse; a PATTERN is a tileable image that modulates the whole stroke
       (Photoshop's Texture). Both live in registries keyed by id, so a stroke
       stored as points names its tip rather than carrying it. The UI registers
       an atlas tile under its own id (`registerTip('tile:5', canvas)`).

       Coverage channel: 'luma-inv' (dark paints, the Photoshop brush-image
       convention and the default for tips), 'luma' (light paints, the default
       for patterns) or 'alpha'. Transparent pixels never paint.

       Tips keep a mip chain (2x2 box halvings) so a small dab from a large image
       is filtered, not aliased. Built-ins are generated from fixed seeds the
       first time they are asked for, so they are identical everywhere and need
       no image files in the export. */
    const tipReg = new Map(), patReg = new Map();
    let regVersion = 0;
    function toCoverage(src, channel) {
        if (src && src.cov) return src;                         // already {w, h, cov}
        let im = src;
        if (!(src instanceof ImageData)) {
            const w = src.width, h = src.height, cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const cx = cv.getContext('2d'); cx.drawImage(src, 0, 0);
            im = cx.getImageData(0, 0, w, h);
        }
        const { width: w, height: h, data: d } = im, cov = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const a = d[i * 4 + 3] / 255, L = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
            cov[i] = channel === 'alpha' ? a : channel === 'luma' ? L * a : (1 - L) * a;
        }
        return { w, h, cov };
    }
    function mipChain(c) {
        const out = [c];
        let m = c;
        while (Math.max(m.w, m.h) > 4) {
            const w = Math.max(1, m.w >> 1), h = Math.max(1, m.h >> 1), cov = new Float32Array(w * h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const x0 = Math.min(m.w - 1, x * 2), x1 = Math.min(m.w - 1, x * 2 + 1);
                const y0 = Math.min(m.h - 1, y * 2), y1 = Math.min(m.h - 1, y * 2 + 1);
                cov[y * w + x] = (m.cov[y0 * m.w + x0] + m.cov[y0 * m.w + x1] + m.cov[y1 * m.w + x0] + m.cov[y1 * m.w + x1]) / 4;
            }
            m = { w, h, cov };
            out.push(m);
        }
        return out;
    }
    function registerTip(id, src, opts = {}) {
        tipReg.set(id, { mips: mipChain(toCoverage(src, opts.channel || 'luma-inv')), v: ++regVersion });
    }
    function registerPattern(id, src, opts = {}) {
        const c = toCoverage(src, opts.channel || 'luma');
        patReg.set(id, { w: c.w, h: c.h, cov: c.cov, v: ++regVersion });
    }

    /* Built-ins, 128 px. Every random number comes from a fixed-seed stream. */
    const BUILTIN_TIPS = [['chalk', 'Chalk'], ['bristles', 'Bristles'], ['spatter', 'Spatter'],
                          ['scratch', 'Scratches'], ['square', 'Square']];
    const BUILTIN_PATTERNS = [['grain', 'Grain'], ['paper', 'Paper'], ['canvas', 'Canvas']];
    const TS = 128;
    function genCov(fn) { const cov = new Float32Array(TS * TS); for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) cov[y * TS + x] = clamp01(fn(x + 0.5, y + 0.5)); return { w: TS, h: TS, cov }; }
    // Tileable value noise on a lattice whose period divides TS.
    function periodicNoise(seed, period) {
        const r = rng(seed), g = Array.from({ length: period * period }, () => r());
        return (x, y) => {
            const fx = x / TS * period, fy = y / TS * period, x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
            const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
            return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
        };
    }
    const discAt = (cx, cy, r, soft) => (x, y) => clamp01((r - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))) / Math.max(0.5, soft) + 0.5);
    function builtinTip(id) {
        const r = rng(0x7a11 + id.length * 977), c = TS / 2;
        if (id === 'chalk') {
            const n = periodicNoise(0x51, 16), n2 = periodicNoise(0x52, 32), disc = discAt(c, c, 58, 3);
            return genCov((x, y) => disc(x, y) * clamp01((0.55 * n(x, y) + 0.45 * n2(x, y) - 0.3) * 3.2));
        }
        if (id === 'bristles') {
            const dots = Array.from({ length: 13 }, (_, i) => discAt(10 + i * 9 + (r() - 0.5) * 3, c + (r() - 0.5) * 14, 2.5 + r() * 3.5, 1.2));
            return genCov((x, y) => Math.max(...dots.map(f => f(x, y))));
        }
        if (id === 'spatter') {
            const dots = Array.from({ length: 24 }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 54;
                return discAt(c + Math.cos(a) * d, c + Math.sin(a) * d, 1.5 + r() * r() * 9, 1); });
            return genCov((x, y) => Math.max(...dots.map(f => f(x, y))));
        }
        if (id === 'scratch') {
            // Thin broken lines along the tip's x axis: with Angle "Direction" they lie
            // along the stroke, which is what a scrape is.
            const lines = Array.from({ length: 7 }, () => ({ y: 20 + r() * 88, t: 0.6 + r() * 1.2, a: 0.55 + r() * 0.45,
                gaps: Array.from({ length: 3 }, () => [r() * TS, 4 + r() * 18]) }));
            return genCov((x, y) => {
                let v = 0;
                for (const L of lines) {
                    if (L.gaps.some(([g, w]) => x > g && x < g + w)) continue;
                    v = Math.max(v, L.a * clamp01(L.t + 0.5 - Math.abs(y - L.y)));
                }
                return v * clamp01((60 - Math.abs(x - c)) / 6);
            });
        }
        if (id === 'square') return genCov((x, y) => (Math.abs(x - c) <= 56 && Math.abs(y - c) <= 56) ? 1 : 0);
        return null;
    }
    function builtinPattern(id) {
        if (id === 'grain') {
            const raw = new Float32Array(TS * TS);
            for (let i = 0; i < raw.length; i++) raw[i] = (noiseAt(i % TS, (i / TS) | 0) + 1) / 2;
            return genCov((x, y) => {        // a 3x3 wrap blur: grain, not static
                let s = 0; const ix = x | 0, iy = y | 0;
                for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += raw[((iy + j + TS) % TS) * TS + ((ix + i + TS) % TS)];
                return (s / 9 - 0.5) * 2.2 + 0.5;
            });
        }
        if (id === 'paper') {
            const a = periodicNoise(0x71, 8), b = periodicNoise(0x72, 16), c2 = periodicNoise(0x73, 32);
            return genCov((x, y) => 0.5 * a(x, y) + 0.3 * b(x, y) + 0.2 * c2(x, y));
        }
        if (id === 'canvas') {
            return genCov((x, y) => {
                const cx = Math.floor(x / 4), cy = Math.floor(y / 4);
                const along = ((cx + cy) & 1) ? Math.abs(Math.sin(Math.PI * y / 4)) : Math.abs(Math.sin(Math.PI * x / 4));
                return 0.25 + 0.7 * along;
            });
        }
        return null;
    }
    function getTip(id) {
        if (!tipReg.has(id)) { const b = builtinTip(id); if (b) registerTip(id, b); }
        return tipReg.get(id) || null;
    }
    function getPattern(id) {
        if (!patReg.has(id)) { const b = builtinPattern(id); if (b) registerPattern(id, b); }
        return patReg.get(id) || null;
    }

    /* ---- tips ----------------------------------------------------------
       A tip is a Float32Array of coverage, 0..1, for one diameter, hardness,
       angle, roundness and sub-pixel phase, centred at (c + fx, c + fy).
       Computed, not drawn, so it is exact and the same on every machine.
       Hard edges are supersampled 4x4 (a true antialiased edge for any
       ellipse); soft ones are smooth already, so one sample, except on small
       tips where the falloff spans only a pixel or two. Cached by bytes, since
       a 300 px tip is 370 KB. */
    const tipCache = new Map();
    let tipBytes = 0;
    const TIP_CACHE_BYTES = 48 * 1024 * 1024;
    function tipFor(d, hardness, angle, roundness, fx, fy, tipId) {
        const T = tipId ? getTip(tipId) : null;          // an unknown id falls back to the ellipse
        const key = `${T ? tipId + '@' + T.v : ''}|${d.toFixed(3)}|${hardness.toFixed(3)}|${angle.toFixed(2)}|${roundness.toFixed(3)}|${fx}|${fy}`;
        let t = tipCache.get(key);
        if (t) { tipCache.delete(key); tipCache.set(key, t); return t; }   // LRU touch
        if (T) return cacheTip(key, sampledTip(T, d, angle, roundness, fx, fy));
        const R = Math.max(0.25, d / 2);
        const n = Math.ceil(R * 2) + 5;
        const c = n >> 1;
        const cx = c + fx / PHASES, cy = c + fy / PHASES;
        const hard = hardness >= 0.999, h = Math.max(0, Math.min(0.999, hardness));
        const ss = (hard || d < 8) ? 4 : 1;
        const rnd = Math.max(0.01, roundness);
        const th = angle * Math.PI / 180, ca = Math.cos(th), sa = Math.sin(th);
        const cov = new Float32Array(n * n);
        const inv = 1 / (ss * ss);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                let a = 0;
                for (let sy = 0; sy < ss; sy++) {
                    for (let sx = 0; sx < ss; sx++) {
                        const px = x + (sx + 0.5) / ss - cx, py = y + (sy + 0.5) / ss - cy;
                        // into the tip's frame: undo the rotation, then the squash
                        const u = px * ca + py * sa, v = (-px * sa + py * ca) / rnd;
                        const r = Math.sqrt(u * u + v * v);
                        if (hard) { if (r <= R) a += 1; }
                        else if (r < R) {
                            const q = r / R;
                            if (q <= h) a += 1;
                            else { const s = (q - h) / (1 - h); a += 1 - s * s * (3 - 2 * s); }
                        }
                    }
                }
                cov[y * n + x] = a * inv;
            }
        }
        return cacheTip(key, { cov, n, c });
    }
    function cacheTip(key, t) {
        tipBytes += t.cov.byteLength;
        tipCache.set(key, t);
        while (tipBytes > TIP_CACHE_BYTES && tipCache.size > 1) {
            const k = tipCache.keys().next().value;
            tipBytes -= tipCache.get(k).cov.byteLength;
            tipCache.delete(k);
        }
        return t;
    }
    /* A sampled tip at diameter d: the image's longer side spans d, rotated and
       squashed like the ellipse, read bilinearly from the mip level nearest to
       d (never smaller). The box is widened to the rotated square's corners. */
    function sampledTip(T, d, angle, roundness, fx, fy) {
        let m = T.mips[0];
        for (const lvl of T.mips) if (Math.max(lvl.w, lvl.h) >= d) m = lvl;
        const scale = Math.max(0.25, d) / Math.max(m.w, m.h);   // mip px -> surface px
        const R = Math.max(0.5, d / 2) * Math.SQRT2;
        const n = Math.ceil(R * 2) + 5, c = n >> 1;
        const cx = c + fx / PHASES, cy = c + fy / PHASES;
        const rnd = Math.max(0.01, roundness), th = angle * Math.PI / 180, ca = Math.cos(th), sa = Math.sin(th);
        const ss = d < 24 ? 2 : 1, inv = 1 / (ss * ss), cov = new Float32Array(n * n);
        const at = (ix, iy) => (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) ? 0 : m.cov[iy * m.w + ix];
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            let a = 0;
            for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
                const px = x + (sx + 0.5) / ss - cx, py = y + (sy + 0.5) / ss - cy;
                const u = px * ca + py * sa, v = (-px * sa + py * ca) / rnd;
                const ix = u / scale + m.w / 2 - 0.5, iy = v / scale + m.h / 2 - 0.5;
                const x0 = Math.floor(ix), y0 = Math.floor(iy), tx = ix - x0, ty = iy - y0;
                a += (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
            }
            cov[y * n + x] = a * inv;
        }
        return { cov, n, c };
    }

    /* ---- the path --------------------------------------------------------
       Centripetal Catmull-Rom, evaluated Barry-Goldman style. Centripetal
       (alpha 0.5) is the variant that cannot cusp or loop inside a segment
       however unevenly the pointer reported, which uniform CR does on a fast
       flick. */
    function crPoint(p0, p1, p2, p3, u) {
        const tj = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return Math.max(1e-4, Math.sqrt(Math.sqrt(dx * dx + dy * dy))); };
        const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
        const t = t1 + (t2 - t1) * u;
        const L = (a, b, ta, tb) => [
            ((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta),
            ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
        const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
        const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
        return L(B1, B2, t1, t2);
    }
    const extrap = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];   // reflect b through a

    /* ---- colour helpers (0..1 RGB <-> HSV) ------------------------------ */
    function rgb2hsv(r, g, b) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d > 0) {
            if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h /= 6; if (h < 0) h += 1;
        }
        return [h, mx > 0 ? d / mx : 0, mx];
    }
    function hsv2rgb(h, s, v) {
        h = ((h % 1) + 1) % 1;
        const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
            case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
        }
    }
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    // Photoshop's Fade N steps: 1 at dab 0, `min` at dab N and after.
    const fadeF = (k, N, min) => 1 - (1 - min) * Math.min(k, Math.max(1, N)) / Math.max(1, N);
    // Taper: min at t = 0, full at t = 1, easing out so the point is rounded, not a spike.
    const taperF = (t, min) => { const u = 1 - clamp01(t); return min + (1 - min) * (1 - u * u); };
    // Per-pixel noise in -1..1, a pure function of the surface position (so it lines
    // up across tiles and replays exactly): an integer hash, no Math.random.
    const noiseAt = (x, y) => {
        let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
    };
    // Smooth 1D value noise in about -1..1 over `u`, two octaves, from the stroke seed.
    const hash1 = (seed, i) => {
        let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
    };
    const vnoise = (seed, u) => {
        const i = Math.floor(u), f = u - i, t = f * f * (3 - 2 * f);
        return hash1(seed, i) + (hash1(seed, i + 1) - hash1(seed, i)) * t;
    };
    const wobbleAt = (seed, u) => (vnoise(seed, u) + 0.5 * vnoise(seed ^ 0x3c6ef372, u * 2.3 + 17)) / 1.2;
    const quant = (v, q) => Math.round(v / q) * q;
    const dist = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); };

    /* ---- the float buffer -------------------------------------------------
       Premultiplied RGBA in 0..1, in 64 px blocks. `blocks[i]` is null until
       paint lands in it. An OVERLAY buffer (the live preview's tail) reads
       through to its base and copies a block on first write, so previewing
       never touches the committed stroke. */
    function makeFloatBuffer(W, H, base) {
        const nbx = Math.ceil(W / BS), nby = Math.ceil(H / BS);
        const blocks = new Array(nbx * nby).fill(null);
        const touched = new Set();            // block indices written since the last `take`
        const get = i => {
            let b = blocks[i];
            if (!b) {
                b = base && base.blocks[i] ? base.blocks[i].slice() : new Float32Array(BS * BS * 4);
                blocks[i] = b;
            }
            touched.add(i);
            return b;
        };
        const read = i => blocks[i] || (base ? base.blocks[i] : null);
        return { W, H, nbx, nby, blocks, touched, get, read,
                 clear() { blocks.fill(null); touched.clear(); } };
    }

    /* Float -> 8-bit, for one block, onto `ctx`. The single rounding a stroke
       goes through. ImageData is straight (un-premultiplied) alpha. */
    let blockImg = null;
    function patAt(tex, gx, gy) {
        const P = tex.pat, fx = gx / tex.scale, fy = gy / tex.scale;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const at = (x, y) => P.cov[(((y % P.h) + P.h) % P.h) * P.w + (((x % P.w) + P.w) % P.w)];
        const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
        return tex.invert ? 1 - v : v;
    }
    /* `post`: { noise, tex, dual }, everything tier B does at the point where float
       becomes pixels. Colour is un-premultiplied from the buffer's own alpha, then
       only the ALPHA is shaped, so texture and dual never tint the stroke. */
    /* Wet edges: the blurred solid mask for one block, reading its neighbours
       (and across the wrap, when the stroke wraps), so the rim is seamless across
       the 64 px blocks. Separable box blur by prefix sums over the block plus a
       margin of r. */
    function wetBlur(fb, bx, by, w, h, r, wrap) {
        const RW = w + 2 * r, RH = h + 2 * r, M = new Float32Array(RW * RH);
        for (let y = 0; y < RH; y++) {
            let gy = by - r + y;
            if (wrap) gy = ((gy % fb.H) + fb.H) % fb.H; else if (gy < 0 || gy >= fb.H) continue;
            for (let x = 0; x < RW; x++) {
                let gx = bx - r + x;
                if (wrap) gx = ((gx % fb.W) + fb.W) % fb.W; else if (gx < 0 || gx >= fb.W) continue;
                const blk = fb.read((gy >> BSH) * fb.nbx + (gx >> BSH));
                if (blk && blk[(((gy & (BS - 1)) << BSH) + (gx & (BS - 1))) * 4 + 3] > 0.5) M[y * RW + x] = 1;
            }
        }
        const Hs = new Float32Array(RW * h), out = new Float32Array(w * h), n = 2 * r + 1;
        for (let x = 0; x < RW; x++) {          // vertical sums over the block's rows
            let acc = 0;
            for (let y = 0; y < n; y++) acc += M[y * RW + x];
            for (let y = 0; y < h; y++) { Hs[y * RW + x] = acc; if (y + 1 < h) acc += M[(y + n) * RW + x] - M[y * RW + x]; }
        }
        for (let y = 0; y < h; y++) {           // then horizontal
            let acc = 0;
            for (let x = 0; x < n; x++) acc += Hs[y * RW + x];
            for (let x = 0; x < w; x++) { out[y * w + x] = acc / (n * n); if (x + 1 < w) acc += Hs[y * RW + x + n] - Hs[y * RW + x]; }
        }
        return out;
    }
    function putBlock(ctx, fb, i, post) {
        const noise = post ? post.noise : 0, tex = post && post.tex, dual = post && post.dual, wet = post && post.wet;
        const bx = (i % fb.nbx) * BS, by = Math.floor(i / fb.nbx) * BS;
        const w = Math.min(BS, fb.W - bx), h = Math.min(BS, fb.H - by);
        if (!blockImg || blockImg.width !== w || blockImg.height !== h) blockImg = new ImageData(w, h);
        const d = blockImg.data, src = fb.read(i), dsrc = dual ? dual.read(i) : null;
        if (!src || (dual && !dsrc)) { d.fill(0); ctx.putImageData(blockImg, bx, by); return; }
        const wb = wet ? wetBlur(fb, bx, by, w, h, wet.r, wet.wrap) : null;
        for (let y = 0; y < h; y++) {
            let si = (y << BSH) * 4, di = y * w * 4;
            for (let x = 0; x < w; x++, si += 4, di += 4) {
                const a = src[si + 3];
                if (a <= 0) { d[di] = d[di + 1] = d[di + 2] = d[di + 3] = 0; continue; }
                const k = 255 / a;
                d[di] = src[si] * k; d[di + 1] = src[si + 1] * k; d[di + 2] = src[si + 2] * k;
                let o = a;
                if (wb) {
                    // Deep inside the solid region the blur is 1 and paint thins to the
                    // interior level; toward its boundary, and in a soft fringe, it is full.
                    const rim = a > 0.5 ? clamp01((1 - wb[y * w + x]) * 2.5) : 1;
                    o *= wet.interior + (1 - wet.interior) * rim;
                }
                if (dsrc) o *= dsrc[si + 3];
                if (tex) {
                    const T = patAt(tex, bx + x, by + y), dip = tex.depth * (1 - T);
                    if (tex.mode === 'subtract') o = Math.max(0, o - dip);
                    else if (tex.mode === 'height') o *= clamp01((o - dip) * 4);    // paint sticks to the high points
                    else o *= 1 - dip;                                              // multiply
                }
                // Noise touches the partial alphas only: 4a(1-a) is 0 at 0 and at 1.
                if (noise > 0) o = clamp01(o + noiseAt(bx + x, by + y) * noise * 4 * o * (1 - o));
                d[di + 3] = o * 255;
            }
        }
        ctx.putImageData(blockImg, bx, by);
    }

    /* ---- a stroke --------------------------------------------------------
       opts: { width, height, seed, wrap }. `buffer` is a canvas of the stroke
       (synced from the float buffer on access); composite it with
       `Stroke.composite` when the stroke ends. */
    function begin(brush, opts) {
        const B = brushOf(brush);
        const W = opts.width, H = opts.height;
        const fb = makeFloatBuffer(W, H, null);
        const D = B.dual ? Object.assign({ tip: null, size: B.size, spacing: 0.25, scatter: 0, scatterBoth: false, count: 1, hardness: 1 }, B.dual) : null;
        const fb2 = D ? makeFloatBuffer(W, H, null) : null;      // the dual brush's coverage
        const texP = B.texture && B.texture.id ? getPattern(B.texture.id) : null;
        const tex = texP ? { pat: texP, scale: Math.max(0.05, B.texture.scale || 1), depth: clamp01(B.texture.depth == null ? 1 : B.texture.depth),
                             mode: B.texture.mode || 'multiply', invert: !!B.texture.invert } : null;
        const wet = B.wetEdges > 0 ? { interior: 1 - 0.5 * clamp01(B.wetEdges), r: Math.max(2, Math.min(32, Math.round(B.size * 0.12))), wrap: !!opts.wrap } : null;
        const post = { noise: B.noise, tex, dual: fb2, wet };
        /* With wet edges a block's pixels depend on its neighbours' alpha (the blur
           reaches r <= 32 px across), so a change re-converts the 8 around it too. */
        const nbx = Math.ceil(W / BS), nby = Math.ceil(H / BS);
        const grow = set => {
            if (!wet) return set;
            const out = new Set(set);
            for (const i of set) {
                const cx = i % nbx, cy = Math.floor(i / nbx);
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    let x = cx + dx, y = cy + dy;
                    if (opts.wrap) { x = (x + nbx) % nbx; y = (y + nby) % nby; }
                    else if (x < 0 || y < 0 || x >= nbx || y >= nby) continue;
                    out.add(y * nbx + x);
                }
            }
            return out;
        };
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const cctx = canvas.getContext('2d');
        const col = (B.erase ? [0, 0, 0] : B.color).map(v => v / 255);
        const bgc = (B.bgColor || [255, 255, 255]).map(v => v / 255);
        const seed = opts.seed == null ? 1 : opts.seed;
        const st = {
            B, W, H, wrap: !!opts.wrap,
            raw: [], pts: [], anchor: null, lastRaw: null,
            seg: 0,                          // next spline segment to commit
            walk: { carry: 0, started: false, k: 0, init: null, rand: rng(seed), len: 0, dir: null, pending: [] },
            walk2: { carry: 0, started: false, len: 0, rand: rng((seed ^ 0x2c1b3c6d) >>> 0) },
            dabs: 0, ended: false
        };
        const hasShape = B.sizeJitter > 0 || B.sizeControl !== 'off' || B.angleJitter > 0 ||
            B.angleControl !== 'off' || B.roundnessJitter > 0 || B.roundnessControl !== 'off' || B.flipX || B.flipY;
        const hasColor = !B.erase && (B.fgbgJitter > 0 || B.fgbgControl !== 'off' ||
            B.hueJitter > 0 || B.satJitter > 0 || B.brightJitter > 0 || B.purity !== 0);
        /* Colour jitter "per stroke" (Apply Per Tip off) draws its randoms once,
           from a stream of its own so it cannot shift the per-dab one. */
        const strokeRand = (() => { const r = rng((seed ^ 0x5bd1e995) >>> 0); return Array.from({ length: RANDS_PER_DAB }, r); })();

        /* The dab's colour, 0..1 RGB, from the per-dab randoms `r`. */
        const dabColor = (k, r) => {
            if (!hasColor) return col;
            const q = B.colorPerTip ? r : strokeRand;
            let t = B.fgbgControl === 'fade' ? 1 - fadeF(k, B.fgbgFade, 0) : 0;
            t = clamp01(t + B.fgbgJitter * q[10]);
            let c = [col[0] + (bgc[0] - col[0]) * t, col[1] + (bgc[1] - col[1]) * t, col[2] + (bgc[2] - col[2]) * t];
            if (B.hueJitter > 0 || B.satJitter > 0 || B.brightJitter > 0 || B.purity !== 0) {
                let [h, sv, v] = rgb2hsv(c[0], c[1], c[2]);
                h += (q[11] * 2 - 1) * B.hueJitter * 0.5;
                sv = clamp01(sv + (q[12] * 2 - 1) * B.satJitter + B.purity);
                v = clamp01(v + (q[13] * 2 - 1) * B.brightJitter);
                c = hsv2rgb(h, sv, v);
            }
            return c;
        };

        /* One dab into float buffer `F`: premultiplied source-over at `dep`
           (flow, per dab), building toward `ceil` (opacity, per dab; 1 = the
           stroke's own opacity decides alone). With wrap on, pixels past an
           edge land on the far side. */
        const stamp = (F, x, y, d, ang, rnd, dep, ceil, cc, tipId = B.tip, hardness = B.hardness) => {
            if (st.wrap) { x = ((x % W) + W) % W; y = ((y % H) + H) % H; }
            const ix = Math.floor(x), iy = Math.floor(y);
            const phased = hardness >= 0.999 || tipId || d <= PHASE_MAX_SOFT;
            const fx = phased ? Math.min(PHASES - 1, Math.floor((x - ix) * PHASES)) : 0;
            const fy = phased ? Math.min(PHASES - 1, Math.floor((y - iy) * PHASES)) : 0;
            const tip = tipFor(d, hardness, ang, rnd, fx, fy, tipId);
            const { cov, n, c } = tip;
            const ox = ix - c, oy = iy - c;
            const cr = cc[0], cg = cc[1], cb = cc[2];
            const capped = ceil < 1;
            const pr = cr * ceil, pg = cg * ceil, pb = cb * ceil;
            for (let ty = 0; ty < n; ty++) {
                let by = oy + ty;
                if (st.wrap) by = ((by % H) + H) % H; else if (by < 0 || by >= H) continue;
                const brow = (by >> BSH) * F.nbx, iny = (by & (BS - 1)) << BSH;
                let ti = ty * n;
                for (let tx = 0; tx < n; tx++, ti++) {
                    const a = cov[ti] * dep;
                    if (a <= 0) continue;
                    let bx = ox + tx;
                    if (st.wrap) bx = ((bx % W) + W) % W; else if (bx < 0 || bx >= W) continue;
                    const blk = F.get(brow + (bx >> BSH));
                    const i = (iny + (bx & (BS - 1))) * 4;
                    if (!capped) {
                        const k = 1 - a;
                        blk[i]     = cr * a + blk[i] * k;
                        blk[i + 1] = cg * a + blk[i + 1] * k;
                        blk[i + 2] = cb * a + blk[i + 2] * k;
                        blk[i + 3] = a + blk[i + 3] * k;
                    } else if (blk[i + 3] < ceil) {
                        // Build toward the dab's ceiling, never past it: Photoshop's
                        // Transfer opacity, which a lower-opacity dab cannot lighten.
                        blk[i]     += (pr - blk[i]) * a;
                        blk[i + 1] += (pg - blk[i + 1]) * a;
                        blk[i + 2] += (pb - blk[i + 2]) * a;
                        blk[i + 3] += (ceil - blk[i + 3]) * a;
                    }
                }
            }
            if (F === fb) st.dabs++;
        };

        /* One spacing position: the dynamics, then `count` dabs. `dir` is the
           direction of travel (radians); `w` carries the dab index for Fade,
           the initial direction and the random stream. */
        const place = (F, x, y, dir, w, sPos, pr) => {
            const k = w.k++;
            // Size from the path (1d.1): taper-in by arc length, thinning by speed.
            let sizeF = 1;
            if (B.taperIn > 0) sizeF *= taperF(sPos / B.taperIn, B.taperMin);
            if (B.speedThin > 0) sizeF *= Math.max(0.05, 1 - B.speedThin * (1 - (pr == null ? 1 : pr)));
            if (w.init == null && dir != null) w.init = dir;
            const nr = () => { const r = new Array(RANDS_PER_DAB); for (let j = 0; j < RANDS_PER_DAB; j++) r[j] = w.rand(); return r; };
            const pos = nr();
            const wl = Math.max(1, B.wobbleScale * B.size);
            if (B.wobble > 0 && dir != null) {
                const A = B.wobble * B.size, off = A * wobbleAt(seed, sPos / wl);
                const slope = (A * wobbleAt(seed, (sPos + 0.5) / wl) - A * wobbleAt(seed, (sPos - 0.5) / wl));
                x += -Math.sin(dir) * off; y += Math.cos(dir) * off;
                dir += Math.atan(slope);
            }
            const biteF = B.bite > 0 ? 1 - clamp01(B.bite) * (0.5 + 0.5 * wobbleAt(seed ^ 0x6a09e667, sPos * 2 / wl)) : 1;
            const count = Math.max(1, Math.round(B.count * (1 - B.countJitter * pos[0])));
            for (let j = 0; j < count; j++) {
                const r = j === 0 ? pos : nr();
                let d = B.size, ang = B.angle, rnd = B.roundness;
                if (hasShape) {
                    let sf = B.sizeControl === 'fade' ? fadeF(k, B.sizeFade, B.minDiameter) : 1;
                    sf *= 1 - B.sizeJitter * r[1];
                    if (B.sizeJitter > 0 || B.sizeControl !== 'off') sf = Math.max(sf, B.minDiameter);
                    d = quant(Math.max(0.5, B.size * sf), 0.25);
                    const dirDeg = (dir || 0) * 180 / Math.PI, initDeg = (w.init || 0) * 180 / Math.PI;
                    if (B.angleControl === 'direction') ang += dirDeg;
                    else if (B.angleControl === 'initial') ang += initDeg;
                    ang += (r[2] * 2 - 1) * B.angleJitter * 180;
                    if (B.flipX && r[4] < 0.5) ang = 180 - ang;
                    if (B.flipY && r[5] < 0.5) ang = -ang;
                    ang = quant(((ang % 360) + 360) % 360, 0.5);
                    let rf = B.roundnessControl === 'fade' ? fadeF(k, B.roundnessFade, B.minRoundness) : 1;
                    rf *= 1 - B.roundnessJitter * r[3];
                    rnd = B.roundness * rf;
                    if (B.roundnessJitter > 0 || B.roundnessControl !== 'off') rnd = Math.max(rnd, B.minRoundness);
                    rnd = quant(Math.max(0.01, rnd), 0.005);
                }
                let px = x, py = y;
                if (B.scatter > 0) {
                    const t = dir || 0, spread = B.scatter * B.size;
                    const nx = -Math.sin(t), ny = Math.cos(t);
                    const off = (r[6] * 2 - 1) * spread;
                    px += nx * off; py += ny * off;
                    if (B.scatterBoth) { const along = (r[7] * 2 - 1) * spread; px += Math.cos(t) * along; py += Math.sin(t) * along; }
                }
                let dep = B.flow;
                if (B.flowJitter > 0 || B.flowControl !== 'off') {
                    let f = (B.flowControl === 'fade' ? fadeF(k, B.flowFade, B.minFlow) : 1) * (1 - B.flowJitter * r[8]);
                    dep = B.flow * Math.max(f, B.minFlow);
                }
                let ceil = 1;
                if (B.opacityJitter > 0 || B.opacityControl !== 'off') {
                    const f = (B.opacityControl === 'fade' ? fadeF(k, B.opacityFade, B.minOpacity) : 1) * (1 - B.opacityJitter * r[9]);
                    ceil = Math.max(f, B.minOpacity);
                }
                ceil *= biteF;     // a ceiling, not a deposit: overlapping dabs cannot fill it back in
                if (ceil <= 0 || dep <= 0) continue;
                if (sizeF !== 1) d = quant(Math.max(0.5, d * sizeF), 0.25);
                /* Taper-out needs the distance to the END, unknown until the stroke
                   ends, so with it on every dab waits in `pending` (in arc-length
                   order, so the stamping order is unchanged) until it is further than
                   taperOut behind the committed path, or the stroke ends. */
                if (B.taperOut > 0) w.pending.push({ px, py, d, ang, rnd, dep, ceil, col: dabColor(k, r), s: sPos });
                else stamp(F, px, py, d, ang, rnd, dep, ceil, dabColor(k, r));
            }
        };

        /* Walk a polyline, placing a dab every `step` px of arc length. `w` is
           the walker state; the tail preview passes a copy so it cannot move
           the real one. */
        const prAt = (a, b, f) => { const pa = a[2] == null ? 1 : a[2], pb = b[2] == null ? 1 : b[2]; return pa + (pb - pa) * f; };
        const walkPoly = (F, poly, w) => {
            const step = Math.max(MIN_STEP, B.spacing * B.size);
            for (let i = 1; i < poly.length; i++) {
                const a = poly[i - 1], b = poly[i];
                const L = dist(a, b);
                if (!w.started) {
                    // The first dab faces the first direction the stroke actually moves.
                    let dir = null;
                    for (let j = i; j < poly.length && dir == null; j++) {
                        const p = poly[j - 1], q = poly[j];
                        if (dist(p, q) > 0) dir = Math.atan2(q[1] - p[1], q[0] - p[0]);
                    }
                    place(F, a[0], a[1], dir, w, w.len, prAt(a, a, 0)); w.started = true; w.carry = step;
                }
                if (L <= 0) continue;
                const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
                w.dir = dir;
                while (w.carry <= L) {
                    const f = w.carry / L;
                    place(F, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, dir, w, w.len + w.carry, prAt(a, b, f));
                    w.carry += step;
                }
                w.carry -= L;
                w.len += L;
            }
        };
        /* The dual brush: its own dabs along the same polylines, into its own buffer,
           from its own random stream (so turning it on does not reroll the main
           brush). Coverage only; the colour argument is unused. */
        const walkDual = (F2, poly, w) => {
            if (!D) return;
            const step = Math.max(MIN_STEP, D.spacing * D.size);
            const put = (x, y, dir) => {
                for (let j = 0; j < Math.max(1, D.count | 0); j++) {
                    let px = x, py = y;
                    const r1 = w.rand(), r2 = w.rand();
                    if (D.scatter > 0) {
                        const t = dir || 0, spread = D.scatter * D.size;
                        px += -Math.sin(t) * (r1 * 2 - 1) * spread; py += Math.cos(t) * (r1 * 2 - 1) * spread;
                        if (D.scatterBoth) { px += Math.cos(t) * (r2 * 2 - 1) * spread; py += Math.sin(t) * (r2 * 2 - 1) * spread; }
                    }
                    stamp(F2, px, py, quant(D.size, 0.25), 0, 1, 1, 1, [0, 0, 0], D.tip, D.hardness);
                }
            };
            // The main brush's wobble, by the same arc length, so the two stay together.
            const wob = (x, y, dir, s) => {
                if (!(B.wobble > 0)) return put(x, y, dir);
                const off = B.wobble * B.size * wobbleAt(seed, s / Math.max(1, B.wobbleScale * B.size));
                put(x - Math.sin(dir) * off, y + Math.cos(dir) * off, dir);
            };
            for (let i = 1; i < poly.length; i++) {
                const a = poly[i - 1], b = poly[i], L = dist(a, b);
                const dir = L > 0 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
                if (!w.started) { wob(a[0], a[1], dir, 0); w.started = true; w.carry = step; w.len = 0; }
                if (L <= 0) continue;
                while (w.carry <= L) { const f = w.carry / L; wob(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, dir, w.len + w.carry); w.carry += step; }
                w.carry -= L;
                w.len += L;
            }
        };

        /* Stamp the taper-out queue: everything at least taperOut behind `len`, or
           (final) all of it, tapered by its distance to `len`, the end. */
        const flush = (F, w, final) => {
            const q = w.pending;
            if (!q.length) return;
            let i = 0;
            for (; i < q.length; i++) {
                const e = q[i], toEnd = w.len - e.s;
                if (!final && toEnd < B.taperOut) break;
                const d = toEnd < B.taperOut ? quant(Math.max(0.5, e.d * taperF(toEnd / B.taperOut, B.taperMin)), 0.25) : e.d;
                stamp(F, e.px, e.py, d, e.ang, e.rnd, e.dep, e.ceil, e.col);
            }
            q.splice(0, i);
        };
        const segPoly = (p0, p1, p2, p3) => {
            const n = Math.max(2, Math.ceil(dist(p1, p2) / 0.25));
            const out = [];
            const pa = p1[2] == null ? 1 : p1[2], pb = p2[2] == null ? 1 : p2[2];
            for (let k = 0; k <= n; k++) { const q = crPoint(p0, p1, p2, p3, k / n); q.push(pa + (pb - pa) * k / n); out.push(q); }
            return out;
        };
        const segmentAt = i => {
            const P = st.pts;
            const p1 = P[i], p2 = P[i + 1];
            const p0 = i > 0 ? P[i - 1] : extrap(p1, p2);
            const p3 = (i + 2 < P.length) ? P[i + 2] : extrap(p2, p1);
            return segPoly(p0, p1, p2, p3);
        };

        /* Commit every segment whose far control point is known. */
        const commit = () => {
            while (st.seg + 2 < st.pts.length) { const poly = segmentAt(st.seg); walkPoly(fb, poly, st.walk); walkDual(fb2, poly, st.walk2); st.seg++; }
            flush(fb, st.walk, false);
        };

        /* The smoothing leash: the paint follows an anchor that only moves when
           the pointer pulls further than `smoothing` px away. */
        const pushSmoothed = p => {
            const last = st.pts[st.pts.length - 1];
            if (last && dist(p, last) < 0.01) return;
            st.pts.push(p);
        };
        const add = (x, y, t) => {
            if (st.ended) return;
            const raw = [x, y, t == null ? 0 : t];
            /* Pressure from speed (speedThin): px per ms between raw samples, eased
               so one jumpy event does not pinch the stroke. Timestamps come with the
               samples, so a replay computes the same values. */
            if (st.lastRaw) {
                const dt = raw[2] - st.lastRaw[2], dd = dist(raw, st.lastRaw);
                if (dt > 0) st.vel = st.vel == null ? dd / dt : st.vel * 0.6 + (dd / dt) * 0.4;
            }
            const pr = st.vel == null ? 1 : 1 - clamp01(st.vel / Math.max(1e-6, B.speedRef));
            if (!st.anchor) {
                st.anchor = [x, y];
                pushSmoothed([x, y, pr]);
            } else {
                const R = B.smoothing;
                if (R > 0) {
                    const dx = x - st.anchor[0], dy = y - st.anchor[1], dd = Math.sqrt(dx * dx + dy * dy);
                    if (dd > R) {
                        const k = (dd - R) / dd;
                        st.anchor = [st.anchor[0] + dx * k, st.anchor[1] + dy * k];
                        pushSmoothed([st.anchor[0], st.anchor[1], pr]);
                    }
                } else {
                    st.anchor = [x, y];
                    pushSmoothed([x, y, pr]);
                }
            }
            st.raw.push(raw);
            st.lastRaw = raw;
            st.lastTick = null;
            st.lastBuild = null;
            commit();
        };
        /* Stroke Catch-up (see CATCHUP_*): ease the anchor toward a still pointer.
           Returns true when it moved, which is also when it is recorded. */
        /* Also Build-up (1d.1): while the pointer holds still, a dab lands at the
           paint every BUILD_MS. Both are recorded as one tick sample when either
           does anything, so a replay does exactly the same. */
        const tick = t => {
            if (st.ended || !st.lastRaw || !st.anchor) return false;
            const lr = st.lastRaw;
            let did = false;
            if (B.smoothing > 0 && t - lr[2] >= CATCHUP_DELAY_MS) {
                const since = Math.max(lr[2] + CATCHUP_DELAY_MS, st.lastTick == null ? -Infinity : st.lastTick);
                const dt = t - since, gap = dist(st.anchor, lr);
                if (dt > 0 && gap >= 0.25) {
                    const k = 1 - Math.exp(-dt / CATCHUP_TAU_MS);
                    st.anchor = gap * (1 - k) < 0.25 ? [lr[0], lr[1]]
                        : [st.anchor[0] + (lr[0] - st.anchor[0]) * k, st.anchor[1] + (lr[1] - st.anchor[1]) * k];
                    pushSmoothed([st.anchor[0], st.anchor[1], 1]);
                    commit();
                    did = true;
                }
            }
            if (B.buildUp && t - lr[2] >= BUILD_DELAY_MS) {
                const from = Math.max(lr[2] + BUILD_DELAY_MS, st.lastBuild == null ? -Infinity : st.lastBuild);
                const n = Math.floor((t - from) / BUILD_MS);
                if (n > 0) {
                    for (let i = 0; i < n; i++) place(fb, st.anchor[0], st.anchor[1], st.walk.dir, st.walk, st.walk.len, 1);
                    flush(fb, st.walk, false);
                    st.lastBuild = from + n * BUILD_MS;
                    did = true;
                }
            }
            if (did) { st.lastTick = t; st.raw.push([lr[0], lr[1], t, 1]); }
            return did;
        };
        const end = () => {
            if (st.ended) return sync();
            // "Catch-up on Stroke End" (off by default, as in Photoshop): the leash
            // snaps to where the pointer let go.
            if (st.lastRaw && B.smoothing > 0 && B.catchUpEnd) pushSmoothed([st.lastRaw[0], st.lastRaw[1], 1]);
            commit();
            const P = st.pts;
            if (P.length === 1) { walkPoly(fb, [P[0], P[0]], st.walk); walkDual(fb2, [P[0], P[0]], st.walk2); }   // a click is one dab
            while (st.seg + 1 < P.length) { const poly = segmentAt(st.seg); walkPoly(fb, poly, st.walk); walkDual(fb2, poly, st.walk2); st.seg++; }
            flush(fb, st.walk, true);                                   // the taper-out, now the end is known
            st.ended = true;
            return sync();
        };

        /* The canvas mirrors the committed buffer, plus the preview's tail
           blocks while a preview is showing. Only blocks that changed since the
           last sync are converted. */
        let tailBlocks = [];
        // Blocks changed in either buffer since the last conversion (the dual brush
        // changes what a block shows without touching the main buffer).
        const takeChanged = () => {
            const ch = new Set(fb.touched);
            if (fb2) { for (const i of fb2.touched) ch.add(i); fb2.touched.clear(); }
            fb.touched.clear();
            return grow(ch);
        };
        const sync = () => {
            const ch = takeChanged();
            for (const i of tailBlocks) if (!ch.has(i)) putBlock(cctx, fb, i, post);   // restore
            tailBlocks = [];
            for (const i of ch) putBlock(cctx, fb, i, post);
            return canvas;
        };

        /* What the buffer would look like if the stroke ended at the anchor
           now: the committed buffer plus the provisional tail, drawn into an
           overlay that reads through to it. Consumes nothing from the real
           walker or generator. */
        const preview = () => {
            if (st.ended) return sync();
            const prevTail = tailBlocks;
            tailBlocks = [];
            const ov = makeFloatBuffer(W, H, fb);
            const W0 = st.walk;
            const w = { carry: W0.carry, started: W0.started, k: W0.k, init: W0.init, rand: W0.rand.fork(),
                        len: W0.len, dir: W0.dir, pending: W0.pending.slice() };
            const ov2 = fb2 ? makeFloatBuffer(W, H, fb2) : null;
            const w2 = { carry: st.walk2.carry, started: st.walk2.started, len: st.walk2.len, rand: st.walk2.rand.fork() };
            const P = st.pts;
            if (P.length === 1 && !w.started) { walkPoly(ov, [P[0], P[0]], w); walkDual(ov2, [P[0], P[0]], w2); }
            for (let i = st.seg; i + 1 < P.length; i++) { const poly = segmentAt(i); walkPoly(ov, poly, w); walkDual(ov2, poly, w2); }
            flush(ov, w, true);                        // shown as if the stroke ended here
            const ch = takeChanged();
            for (const i of ch) putBlock(cctx, fb, i, post);
            let shown = new Set(ov.touched);
            if (ov2) for (const i of ov2.touched) shown.add(i);
            shown = grow(shown);
            for (const i of prevTail) if (!shown.has(i) && !ch.has(i)) putBlock(cctx, fb, i, post);
            const postOv = { noise: B.noise, tex, dual: ov2, wet };
            for (const i of shown) putBlock(cctx, ov, i, postOv);
            tailBlocks = [...shown];
            return canvas;
        };

        return { add, tick, end, preview,
                 get anchor() { return st.anchor ? st.anchor.slice() : null; },
                 get lag() { return st.anchor && st.lastRaw ? dist(st.anchor, st.lastRaw) : 0; },
                 get buffer() { return st.ended ? canvas : sync(); },
                 get dabs() { return st.dabs; },
                 get blocks() { return fb.blocks.reduce((n, b) => n + (b ? 1 : 0), 0); },
                 /* [x0, y0, x1, y1]: the blocks the stroke painted, grown by one block
                    for the wet-edge rim; null when nothing was painted. Conservative:
                    Pushable Markings uses it to decide which tiles keep the points. */
                 get bounds() {
                     let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                     fb.blocks.forEach((b, i) => { if (!b) return; const bx = i % fb.nbx, by = (i / fb.nbx) | 0;
                         x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx); y1 = Math.max(y1, by); });
                     if (x0 === Infinity) return null;
                     return [Math.max(0, (x0 - 1) * BS), Math.max(0, (y0 - 1) * BS), Math.min(W, (x1 + 2) * BS), Math.min(H, (y1 + 2) * BS)];
                 },
                 get blockCount() { return fb.blocks.length; },
                 get samples() { return st.raw.map(r => r.slice()); }, brush: B };
    }

    /* The whole stroke at once. Byte-identical to feeding the same samples
       live through begin/add/end (asserted by validate-stroke). */
    function render(samples, brush, opts) {
        const s = begin(brush, opts);
        for (const p of samples) { if (p[3] === 1) s.tick(p[2]); else s.add(p[0], p[1], p[2]); }
        return s.end();
    }

    /* Lay a finished (or previewed) stroke canvas onto a layer: once, at the
       stroke's opacity, with its blend mode. The eraser removes at opacity. */
    function composite(ctx, strokeCanvas, brush) {
        const B = brushOf(brush);
        ctx.save();
        ctx.globalAlpha = B.opacity;
        ctx.globalCompositeOperation = B.erase ? 'destination-out' : (B.blend || 'source-over');
        ctx.drawImage(strokeCanvas, 0, 0);
        ctx.restore();
    }

    /* ---- presets (phase 1e, tier C) -----------------------------------------
       Named brushes on the engine, each a set of overrides on DEFAULTS. Like a
       photo editor's brush presets they carry no colour, blend or smoothing:
       those are the user's. Sizes are px at a 256 tile. */
    /* Rigid <-> Struggle, t in 0..1: the same dragged scrape, from a ruled line to
       a track that was fought for. Everything that grows with t grows linearly
       from 0, so t = 0 is exactly the plain scrape (no dynamics at all). */
    function struggle(t) {
        t = clamp01(+t || 0);
        const b = { tip: 'scratch', size: 18, spacing: 0.03, angleControl: 'direction', flow: 0.85,
                    taperIn: 6, taperOut: 10, taperMin: 0.4 };
        if (t > 0) Object.assign(b, {
            wobble: 0.5 * t, wobbleScale: 2,        // the block juddering sideways
            bite: 0.9 * t,                          // biting in and skipping
            flowJitter: 0.3 * t
        });
        return b;
    }
    const PRESETS = Object.freeze([
        ['hard-round', 'Hard round', 'Basic', { size: 12, hardness: 1 }],
        ['soft-round', 'Soft round', 'Basic', { size: 24, hardness: 0 }],
        ['airbrush', 'Airbrush', 'Basic', { size: 40, hardness: 0, flow: 0.08, spacing: 0.1, buildUp: true }],
        ['pencil', 'Pencil', 'Basic', { size: 3, hardness: 0.9, spacing: 0.15, noise: 0.3,
            texture: { id: 'paper', scale: 1, depth: 0.35, mode: 'multiply' } }],
        ['ink', 'Ink pen', 'Ink and liquid', { size: 10, hardness: 0.95, spacing: 0.08, speedThin: 0.7,
            taperIn: 20, taperOut: 30, taperMin: 0.1 }],
        // Blood, oil: pools where the hand slows or stops, the rim darker than the inside.
        ['liquid', 'Liquid', 'Ink and liquid', { size: 22, hardness: 0.85, spacing: 0.06, flow: 0.8,
            wetEdges: 0.7, speedThin: 0.5, buildUp: true, taperOut: 12, taperMin: 0.5 }],
        ['wash', 'Wet wash', 'Ink and liquid', { size: 36, hardness: 0.3, spacing: 0.08, flow: 0.5, wetEdges: 1,
            texture: { id: 'paper', scale: 1, depth: 0.35, mode: 'subtract' } }],
        ['chalk', 'Chalk', 'Dry', { tip: 'chalk', size: 18, spacing: 0.15, angleJitter: 1,
            texture: { id: 'grain', scale: 1, depth: 0.6, mode: 'multiply' } }],
        ['charcoal', 'Charcoal', 'Dry', { tip: 'chalk', size: 14, roundness: 0.5, spacing: 0.1, flow: 0.6, angleControl: 'direction',
            texture: { id: 'paper', scale: 1, depth: 0.9, mode: 'height' } }],
        // The bristle row lies along the tip's x axis, so Angle 90 + Direction puts it
        // across the stroke and each bristle drags a streak along it.
        ['dry-brush', 'Dry brush', 'Dry', { tip: 'bristles', size: 28, angle: 90, angleControl: 'direction',
            spacing: 0.03, flowJitter: 0.3, taperOut: 20, taperMin: 0.6 }],
        ['spray', 'Spray', 'Spray', { size: 3, hardness: 1, spacing: 1, count: 10, countJitter: 0.5,
            scatter: 4, scatterBoth: true, sizeJitter: 0.6 }],
        ['spatter', 'Spatter', 'Spray', { tip: 'spatter', size: 30, spacing: 0.35, count: 2, angleJitter: 1, sizeJitter: 0.5,
            scatter: 0.5, scatterBoth: true }],
        ['scratch', 'Scratches', 'Marks', { tip: 'scratch', size: 16, spacing: 0.12, angleControl: 'direction',
            angleJitter: 0.015, scatter: 0.15, flow: 0.8, flowJitter: 0.5, taperIn: 10, taperOut: 16, taperMin: 0.3 }],
        ['rigid', 'Rigid drag', 'Marks', struggle(0)],
        ['struggle', 'Struggle drag', 'Marks', struggle(1)]
    ].map(([id, label, group, brush]) => Object.freeze({ id, label, group, brush: Object.freeze(brush) })));
    const preset = id => { const p = PRESETS.find(q => q.id === id); return p ? Object.assign({}, p.brush) : null; };

    /* The brush at `k` times the size: every length in px scales (size, tapers,
       smoothing, the dual tip, the texture, the thinning speed), and everything in diameters follows
       by itself. What re-rendering a stroke kept as points at 4x uses. Per-pixel
       noise is the one thing that cannot scale: it is a property of the pixel. */
    function scaleBrush(brush, k) {
        const b = Object.assign({}, brush);
        for (const f of ['size', 'taperIn', 'taperOut', 'smoothing']) if (b[f] != null) b[f] *= k;
        b.speedRef = (b.speedRef == null ? DEFAULTS.speedRef : b.speedRef) * k;
        if (b.dual) b.dual = Object.assign({}, b.dual, b.dual.size != null ? { size: b.dual.size * k } : {});
        if (b.texture) b.texture = Object.assign({}, b.texture, { scale: (b.texture.scale || 1) * k });
        return b;
    }

    /* A sample stroke with `brush`, for the brush dropdown (D10): an S across
       the box, slow at the ends and fast in the middle (so speed thinning shows),
       then held still for a moment at the end (so build-up and pooling show).
       The brush is resized so its footprint (the tip plus its scatter and
       wobble) is ~0.4 of the box height, whatever its own size, the way a photo
       editor's brush list draws every brush at one size. Deterministic. opts: { width 160, height 48, color, background,
       seed }. Returns a canvas. */
    function thumb(brush, opts = {}) {
        const W = opts.width || 160, H = opts.height || 48;
        const B = brushOf(brush);
        const foot = B.size * (1 + 2 * B.scatter + 2 * B.wobble);
        const k = (H * 0.4) / Math.max(0.5, foot);
        const b = Object.assign(scaleBrush(B, k), { smoothing: 0, opacity: 1, erase: false, blend: 'source-over',
            color: opts.color || [230, 230, 230] });
        const n = 48, mx = W * 0.12, samples = [];
        let t = 0;
        for (let i = 0; i <= n; i++) {
            const u = i / n;
            const x = mx + (W - 2 * mx) * u, y = H / 2 - Math.sin(u * Math.PI * 2) * H * 0.22;
            samples.push([x, y, t]);
            t += 2 + 10 * Math.pow(Math.abs(u - 0.5) * 2, 2);   // ms: slow ends, fast middle
        }
        for (let h = 16; h <= 240; h += 16) samples.push([samples[n][0], samples[n][1], samples[n][2] + h, 1]);
        const sc = render(samples, b, { width: W, height: H, seed: opts.seed || 1 });
        const out = document.createElement('canvas');
        out.width = W; out.height = H;
        const ctx = out.getContext('2d');
        if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); }
        ctx.drawImage(sc, 0, 0);
        return out;
    }

    /* Bumped whenever a change moves the pixels a stored stroke replays to. A
       stroke kept as points is stamped with it; a different stamp means "use the
       pixels saved with it", not "re-render" (Pushable Markings, phase 7). */
    const VERSION = 1;
    return { VERSION, DEFAULTS, BLEND_MODES, begin, render, composite, rng,
             PRESETS, preset, struggle, scaleBrush, thumb,
             registerTip, registerPattern,
             hasTip: id => !!getTip(id), hasPattern: id => !!getPattern(id),
             TIPS: BUILTIN_TIPS.map(([id, label]) => ({ id, label })),
             PATTERNS: BUILTIN_PATTERNS.map(([id, label]) => ({ id, label })),
             _tipCache: () => ({ entries: tipCache.size, bytes: tipBytes }) };
})();
