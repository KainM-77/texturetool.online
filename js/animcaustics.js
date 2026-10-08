/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — Animated CAUSTICS generator
   The third generator beside the noise field (animgen.js) and the particles
   (animparticles.js), selected by `params.generator === 'caustics'` and
   dispatched from AnimGen.generateFrames. Classic TRLE water is a network of
   bright caustic lines on BLACK, laid in the level with Additive blending:
   black adds nothing, so the floor stays and only the light lands on it.
   The noise field cannot draw that (WATER-CAUSTICS-PLAN §3): its ridges are
   open curves, and its water gradients start at a blue, not at black.

   The maths is the `animCaustics` shader (js/shaders.js); this module turns a
   params bag into its uniforms and bakes the frames. Same contract as the
   other two generators: N canvases of size², deterministic, spatially
   toroidal, and frame N (were it rendered) is frame 0.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimCaustics = (function () {
    'use strict';

    /* Every key a caustics recipe can carry. A saved recipe is merged over
       these, so a key added later must default to "changes nothing". */
    const DEFAULTS = {
        generator: 'caustics',
        size: 256,
        frames: 16,
        seed: 0,
        cells: 6,          // cells across the tile
        stretch: 1,        // >1 taller cells, <-1 wider (|stretch| divides one axis)
        speed: 1,          // most orbit cycles per loop for any site
        flowX: 0,          // drift, whole tiles per loop
        flowY: 0,
        exposure: 1,
        width: 0.06,       // line width, fraction of a cell
        lineVary: 0,
        junctions: 0,
        wobble: 0.25,      // orbit radius, cells
        jitter: 0.2,       // static irregularity, cells
        lineBright: 1,
        // Underglow: off at 0 (not computed). The other four only act while on.
        glow: 0,
        glowScale: 0.75,   // its cells relative to Lines', snapped to whole cells
        glowSoft: 0.5,
        glowSpeed: 1,
        glowOffset: 0.25,  // in the glow's own cells
        // Ripple: warp, surface and shimmer are each off at 0 (not computed).
        warp: 0,
        warpScale: 2,      // spatial period of the warp; surface noise uses x2
        warpSpeed: 1,      // cycles per loop of the warp and the surface noise
        surface: 0,
        shimmer: 0,
        shimmerSpeed: 2,
        fringe: 0,         // colour fringe, off at 0 (not computed)
        /* 'black' (for Additive) or 'transparent' (light carried as alpha, to sit
           on Layer 2 over another animation; source-over then gives
           light + base * (1 - a), and over black the black frame exactly). */
        background: 'black',
        /* REFRACTION model (WATER-CAUSTICS-PLAN phase 5a). 'cells' when absent,
           so every recipe made before it renders as it did. */
        model: 'cells',
        depth: 0.03,       // RMS distance light lands from where it entered, in tiles
        waveMin: 1,        // the wave band, in whole waves across the tile
        waveMax: 5,
        slope: 3,          // spectrum falloff: amplitude ~ |k|^(-slope/2)
        waveSpeed: 1,      // whole cycles per loop, scaled by sqrt(|k|) per wave
        blur: 0.0025,      // softness, a Gaussian sigma as a fraction of the tile
        black: 0.6,        // light below this x the even level adds nothing
        toneGain: 0.6,     // how fast the rest saturates to white (not `gain`: that is the noise field's key)
        windX: 0,          // wind direction (a unit pair; 0,0 = none)
        windY: 0,
        wind: 0.6,         // 0..1 how strongly waves line up across the wind
        palette: null,
        colorAdjust: null,
        supersample: 1
    };

    /* The bounds that keep the shader's 5x5 search exact: a site is at most
       jitter + wobble = 0.75 cell from its cell's centre. */
    const LIMITS = { MIN_CELLS: 2, MAX_CELLS: 16, MAX_SPEED: 4, MAX_JITTER: 0.30, MAX_WOBBLE: 0.45,
                     MAX_WARP_SCALE: 8, MAX_SHIMMER_SPEED: 6,
                     MAX_WAVES: 64, MAX_WAVE_K: 10, MAX_DEPTH: 0.2, MAX_BLUR: 0.03 };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const num = (v, d) => (Number.isFinite(+v) ? +v : d);

    /* Cells per axis. Stretch divides ONE axis, so the features grow along it:
       positive = tall (fewer rows), negative = wide (fewer columns). */
    function cellsXY(p) {
        const n = clamp(Math.round(num(p.cells, DEFAULTS.cells)), LIMITS.MIN_CELLS, LIMITS.MAX_CELLS);
        const s = Math.round(num(p.stretch, 1));
        const k = Math.max(1, Math.abs(s));
        const short = Math.max(1, Math.round(n / k));
        return s < -1 ? [short, n] : s > 1 ? [n, short] : [n, n];
    }

    /* The Underglow lattice: Lines' cells times glowScale, per axis, whole
       cells and at least 2, so it tiles and still reads as cells. */
    function glowCellsXY(p) {
        const k = clamp(num(p.glowScale, DEFAULTS.glowScale), 0.5, 2);
        return cellsXY(p).map(n => Math.max(2, Math.round(n * k)));
    }

    function uniforms(p, t, S, ss) {
        const int = (k, lo, hi) => clamp(Math.round(num(p[k], DEFAULTS[k])), lo, hi);
        const unit = k => clamp(num(p[k], DEFAULTS[k]), 0, 1);
        return {
            u_time: t,
            u_seed: Math.floor(Math.abs(num(p.seed, 0))),
            u_cells: cellsXY(p),
            u_speed: clamp(Math.round(num(p.speed, 1)), 1, LIMITS.MAX_SPEED),
            u_flow: [Math.round(num(p.flowX, 0)), Math.round(num(p.flowY, 0))],
            u_exposure: Math.max(0, num(p.exposure, 1)),
            u_width: clamp(num(p.width, DEFAULTS.width), 0.005, 0.5),
            u_lineVary: clamp(num(p.lineVary, 0), 0, 1),
            u_junctions: clamp(num(p.junctions, 0), 0, 1),
            u_wobble: clamp(num(p.wobble, DEFAULTS.wobble), 0, LIMITS.MAX_WOBBLE),
            u_jitter: clamp(num(p.jitter, DEFAULTS.jitter), 0, LIMITS.MAX_JITTER),
            u_lineBright: clamp(num(p.lineBright, 1), 0, 1),
            u_glow: unit('glow'),
            u_glowCells: glowCellsXY(p),
            u_glowSoft: unit('glowSoft'),
            u_glowSpeed: int('glowSpeed', 1, LIMITS.MAX_SPEED),
            u_glowOffset: clamp(num(p.glowOffset, DEFAULTS.glowOffset), 0, 0.5),
            u_warp: unit('warp'),
            u_warpScale: int('warpScale', 1, LIMITS.MAX_WARP_SCALE),
            u_warpSpeed: int('warpSpeed', 1, LIMITS.MAX_SPEED),
            u_surface: unit('surface'),
            u_shimmer: unit('shimmer'),
            u_shimmerSpeed: int('shimmerSpeed', 1, LIMITS.MAX_SHIMMER_SPEED),
            u_fringe: unit('fringe'),
            u_transparent: p.background === 'transparent' ? 1 : 0,
            u_ss: ss,
            u_size: S,
            u_shift: p._shift || [0, 0]   // test only (validate-animcaustics)
        };
    }

    /* Render phases `ts` at S px. Every uniform the shader declares is passed
       on every call, the ramp sampler included (blit() keeps the last call's
       values, and an unbound sampler can land on the output's texture unit). */
    function render(p, ts) {
        const E = TRLE.Engine, AG = TRLE.AnimGen;
        if (!E || !E.programs || !E.programs().animCaustics) {
            throw new Error('TRLE.AnimCaustics: animCaustics shader unavailable (is the engine initialised?)');
        }
        const S = AG.clampSize(p.size);
        const ss = AG.ssFactor(S, p.supersample);
        const gl = E.gl();
        const useRamp = !!(p.palette && p.palette.length);
        const rampSrc = useRamp ? AG.buildRamp(p.palette, p.colorAdjust)
                                : AG.buildRamp([{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [255, 255, 255] }], null);
        const rampTex = E.createTextureFromImage(rampSrc, { wrap: gl.CLAMP_TO_EDGE, filter: gl.LINEAR });
        const fbo = E.createFBO(S, S);
        const out = [];
        try {
            for (const t of ts) {
                const u = uniforms(p, t, S, ss);
                u.u_useRamp = useRamp ? 1 : 0;
                u.u_ramp = rampTex;
                E.blit('animCaustics', u, fbo, S, S);
                out.push(E.fboToCanvas(fbo));
            }
        } finally {
            E.deleteFBO(fbo);
            E.deleteTexture(rampTex);
        }
        return out;
    }

    /* ---- REFRACTION: photon splatting through a periodic wave surface ----
       The surface is a sum of sine waves whose wave vectors are INTEGER pairs
       (so it tiles), each moving a whole number of cycles per loop (so it
       loops). Every lattice vector in the band [waveMin, waveMax] takes part
       (half plane, since k and -k are the same wave), with seeded amplitude and
       phase, amplitude falling as |k|^(-slope/2), and the set normalised to
       unit RMS slope, so `depth` is the RMS landing offset in tiles whatever
       the band. At most 64, the strongest kept. */
    function mulberry32(a) {
        return () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function waveList(p) {
        const kmax = clamp(Math.round(num(p.waveMax, DEFAULTS.waveMax)), 1, LIMITS.MAX_WAVE_K);
        const kmin = clamp(Math.round(num(p.waveMin, DEFAULTS.waveMin)), 1, kmax);
        const slope = clamp(num(p.slope, DEFAULTS.slope), 0, 6);
        const speed = clamp(num(p.waveSpeed, DEFAULTS.waveSpeed), 0, LIMITS.MAX_SPEED);
        const rng = mulberry32((Math.floor(Math.abs(num(p.seed, 0))) * 7919 + 0x51ED) | 0);
        /* Stretch, shared with Cells: features grow along one axis, so the
           spectrum is measured with that axis weighted (a wave varying fast
           along it counts as shorter). Wind: waves whose crests run ACROSS the
           wind keep their amplitude, the rest fade by `wind`. */
        const st = Math.round(num(p.stretch, 1)), sk = Math.max(1, Math.abs(st));
        const sx = st < -1 ? sk : 1, sy = st > 1 ? sk : 1;
        const wl = Math.hypot(num(p.windX, 0), num(p.windY, 0));
        const wx = wl ? num(p.windX, 0) / wl : 0, wy = wl ? num(p.windY, 0) / wl : 0;
        const wind = wl ? clamp(num(p.wind, DEFAULTS.wind), 0, 1) : 0;
        const waves = [];
        for (let ky = 0; ky <= kmax * sk; ky++) for (let kx = -kmax * sk; kx <= kmax * sk; kx++) {
            if (ky === 0 && kx <= 0) continue;           // half plane
            const r = Math.hypot(kx, ky), re = Math.hypot(kx * sx, ky * sy);
            if (re < kmin - 1e-9 || re > kmax + 1e-9) continue;
            const align = wind ? Math.abs(kx * wx + ky * wy) / r : 1;
            const amp = Math.pow(re, -slope / 2) * (0.25 + 0.75 * rng()) * ((1 - wind) + wind * align * align);
            const phase = rng();
            const cyc = Math.max(1, Math.round(speed * Math.sqrt(r)));
            waves.push({ kx, ky, r, amp, phase, cyc: speed > 0 ? cyc : 0 });
        }
        waves.sort((a, b) => b.amp - a.amp);
        const W = waves.slice(0, LIMITS.MAX_WAVES);
        let msq = 0;
        for (const w of W) msq += Math.pow(2 * Math.PI * w.amp * w.r, 2) / 2;
        const norm = msq > 0 ? 1 / Math.sqrt(msq) : 0;
        const A = new Float32Array(LIMITS.MAX_WAVES * 4), B = new Float32Array(LIMITS.MAX_WAVES * 4);
        W.forEach((w, i) => {
            A.set([w.kx, w.ky, 2 * Math.PI * w.amp * norm, w.phase], i * 4);
            B[i * 4] = w.cyc;
        });
        return { n: W.length, A, B };
    }

    /* Splat phase t into a float target: counts of light per pixel. */
    function splatInto(E, acc, p, t, S, sub, waves) {
        const g = S * sub, depth = clamp(num(p.depth, DEFAULTS.depth), 0, LIMITS.MAX_DEPTH);
        const fr = clamp(num(p.fringe, 0), 0, 1);
        const base = { u_grid: g, u_time: t, u_nWaves: waves.n,
                       u_wA: { vec4array: waves.A }, u_wB: { vec4array: waves.B },
                       u_shift: p._shift || [0, 0], u_out: S,
                       u_flow: [Math.round(num(p.flowX, 0)), Math.round(num(p.flowY, 0))] };   // same convention as Cells
        if (fr > 0) {
            // Dispersion: each channel lands at its own depth (red least bent).
            [[[1, 0, 0, 0], 1 - 0.15 * fr], [[0, 1, 0, 0], 1], [[0, 0, 1, 0], 1 + 0.15 * fr]].forEach(([m, k], i) =>
                E.splatPoints('causticSplat', Object.assign({}, base, { u_mask: m, u_depth: depth * k }), acc, g * g, { clear: i === 0 }));
        } else {
            E.splatPoints('causticSplat', Object.assign({}, base, { u_mask: [1, 1, 1, 1], u_depth: depth }), acc, g * g);
        }
    }

    function renderRefraction(p, ts) {
        const E = TRLE.Engine, AG = TRLE.AnimGen;
        const progs = E && E.programs ? E.programs() : {};
        if (!progs.causticSplat || !progs.causticBlur || !progs.causticFinish) {
            throw new Error('TRLE.AnimCaustics: refraction shaders unavailable (is the engine initialised?)');
        }
        const S = AG.clampSize(p.size);
        const sub = AG.ssFactor(S, p.supersample) > 1 ? 8 : 4;   // Crisp = more light per pixel
        const gl = E.gl();
        const useRamp = !!(p.palette && p.palette.length);
        const rampSrc = useRamp ? AG.buildRamp(p.palette, p.colorAdjust)
                                : AG.buildRamp([{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [255, 255, 255] }], null);
        const rampTex = E.createTextureFromImage(rampSrc, { wrap: gl.CLAMP_TO_EDGE, filter: gl.LINEAR });
        const acc = E.createFBO(S, S, { float: true }), tmp = E.createFBO(S, S, { float: true }), out8 = E.createFBO(S, S);
        const waves = waveList(p);
        const sigma = clamp(num(p.blur, DEFAULTS.blur), 0, LIMITS.MAX_BLUR) * S;
        const out = [];
        try {
            for (const t of ts) {
                splatInto(E, acc, p, t, S, sub, waves);
                if (sigma >= 0.05) {
                    E.blit('causticBlur', { u_accum: acc.texture, u_dir: [1, 0], u_sigma: sigma, u_size: S }, tmp, S, S);
                    E.blit('causticBlur', { u_accum: tmp.texture, u_dir: [0, 1], u_sigma: sigma, u_size: S }, acc, S, S);
                }
                E.blit('causticFinish', {
                    u_accum: acc.texture, u_perPx: sub * sub,
                    u_black: Math.max(0, num(p.black, DEFAULTS.black)), u_gain: Math.max(0, num(p.toneGain, DEFAULTS.toneGain)),
                    u_exposure: Math.max(0, num(p.exposure, 1)), u_fringe: clamp(num(p.fringe, 0), 0, 1),
                    u_transparent: p.background === 'transparent' ? 1 : 0,
                    u_useRamp: useRamp ? 1 : 0, u_ramp: rampTex
                }, out8, S, S);
                out.push(E.fboToCanvas(out8));
            }
        } finally {
            [acc, tmp, out8].forEach(f => E.deleteFBO(f));
            E.deleteTexture(rampTex);
        }
        return out;
    }

    function generateFrames(params) {
        const p = Object.assign({}, DEFAULTS, params);
        const N = TRLE.AnimGen.clampFrames(p.frames);
        const ts = [];
        for (let i = 0; i < N; i++) ts.push(i / N);
        return p.model === 'refraction' ? renderRefraction(p, ts) : render(p, ts);
    }

    /* Test only: the raw light counts of phase t (no blur, no tone), so a
       validator can check light is conserved: they sum to (S * sub)^2. */
    function accumStats(params, t) {
        const p = Object.assign({}, DEFAULTS, params), E = TRLE.Engine, AG = TRLE.AnimGen;
        const S = AG.clampSize(p.size), sub = AG.ssFactor(S, p.supersample) > 1 ? 8 : 4;
        const acc = E.createFBO(S, S, { float: true });
        try {
            splatInto(E, acc, Object.assign({}, p, { fringe: 0 }), t, S, sub, waveList(p));
            const px = E.readPixelsFloat(acc);
            let sum = 0, max = 0;
            for (let i = 0; i < px.length; i += 4) { sum += px[i]; if (px[i] > max) max = px[i]; }
            return { sum, max, expect: (S * sub) * (S * sub), perPx: sub * sub };
        } finally { E.deleteFBO(acc); }
    }

    return { generateFrames, DEFAULTS, LIMITS, cellsXY, glowCellsXY, waveList,
             /* test only: render arbitrary phases (t = 1 must equal t = 0) */
             _renderAt: (params, ts) => {
                 const p = Object.assign({}, DEFAULTS, params);
                 return p.model === 'refraction' ? renderRefraction(p, ts) : render(p, ts);
             },
             _accumStats: accumStats };
})();
