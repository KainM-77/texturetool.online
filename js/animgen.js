/* SPDX-License-Identifier: GPL-3.0-only
   TextureTool — Copyright (C) 2026 KainM-77. Licensed under GPL-3.0. See LICENSE. */
/* ============================================================
   TRLE Atlas Tool — Animated Texture Generator (Phase 1 core)
   Bakes a deterministic, seamlessly-looping sequence of frames
   from the `animNoise` shader. Each frame is a tileSize² canvas
   ready to drop into the atlas as a consecutive tile.

   Loop guarantee: frame i is sampled at phase t = i/N, and the
   noise is periodic in time over one period across t∈[0,1), so
   the frame after the last (t = N/N = 1.0) equals frame 0 —
   the sequence loops with no visible jump. Each frame is also
   spatially seamless (usable as a single UV-rotate tile).

   Depends only on TRLE.Engine (must be init'd) + TRLE.Shaders.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimGen = (function () {
    'use strict';

    /* Frame count: at least 2 (an animation needs two frames); the upper bound
       is a guard against runaway atlas size / memory — N frames become N atlas
       tiles, so a high count at a large tileSize balloons the export. 64 is a
       generous cap (e.g. 8×8 tiles) well past TRLE's typical 16-frame ranges. */
    const LIMITS = { MIN_FRAMES: 2, MAX_FRAMES: 64, MIN_SIZE: 16, MAX_SIZE: 1024 };

    const DEFAULTS = {
        size: 256,
        frames: 16,
        spatialPeriod: 4,   // lattice repeats across the tile (scale; = X period)
        stretch: 1,         // vertical stretch: Y period = round(spatialPeriod/stretch).
                            // >1 → taller features (vertical streaks for fire/waterfalls)
        timePeriod: 1,      // churn cycles over the loop (apparent speed)
        flowX: 0,           // directional scroll in whole tiles per loop (integer → loops)
        flowY: 0,
        octaves: 4,
        gain: 0.5,
        warp: 0,            // domain-warp swirl amount
        contrast: 1,
        seed: 0,
        style: 0,           // 0 fBm, 1 ridged, 2 billow
        palette: null,      // [{ pos:0..1, color:[r,g,b] | [r,g,b,a] (0-255) }]
        colorAdjust: null   // { hue°, sat, val, contrast, gamma, invert, posterize } over the ramp
    };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

    /* Snap a requested frame count into the allowed range. Exposed so the UI can
       reflect the clamp back to the user. */
    function clampFrames(n) {
        n = Math.round(Number(n) || 0);
        return clamp(n, LIMITS.MIN_FRAMES, LIMITS.MAX_FRAMES);
    }

    function clampSize(s) {
        s = Math.round(Number(s) || DEFAULTS.size);
        return clamp(s, LIMITS.MIN_SIZE, LIMITS.MAX_SIZE);
    }

    /* ---- HSV helpers (0..1 domain) ---- */
    function rgb2hsv(r, g, b) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6; if (h < 0) h += 1;
        }
        return [h, mx ? d / mx : 0, mx];
    }
    function hsv2rgb(h, s, v) {
        const i = Math.floor(h * 6), f = h * 6 - i;
        const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: return [v, t, p];
            case 1: return [q, v, p];
            case 2: return [p, v, t];
            case 3: return [p, q, v];
            case 4: return [t, p, v];
            default: return [v, p, q];
        }
    }

    function adjustIsIdentity(a) {
        return !a || ((a.hue || 0) === 0 && (a.sat == null || a.sat === 1) &&
            (a.val == null || a.val === 1) && (a.contrast == null || a.contrast === 1) &&
            (a.gamma == null || a.gamma === 1) && !a.invert && !(a.posterize > 1));
    }

    /* Apply Colour-tab adjustments to a 256-px ramp's pixel buffer in place.
       Hue/sat/val act in HSV; contrast/gamma per channel; invert reverses the
       ramp order; posterize quantises to N levels. Alpha is preserved. */
    function applyColorAdjust(data, a) {
        const hue = (a.hue || 0) / 360, sat = a.sat == null ? 1 : a.sat, val = a.val == null ? 1 : a.val;
        const contrast = a.contrast == null ? 1 : a.contrast, gamma = a.gamma == null ? 1 : a.gamma;
        const levels = a.posterize > 1 ? Math.round(a.posterize) : 0, invert = !!a.invert;
        const n = data.length / 4;
        if (invert) {
            for (let i = 0; i < Math.floor(n / 2); i++) {
                const j = n - 1 - i;
                for (let k = 0; k < 4; k++) { const t = data[i * 4 + k]; data[i * 4 + k] = data[j * 4 + k]; data[j * 4 + k] = t; }
            }
        }
        const chan = ch => {
            ch = clamp01((ch - 0.5) * contrast + 0.5);
            return clamp01(Math.pow(ch, 1 / gamma));
        };
        const quant = levels ? (x => Math.round(x * (levels - 1)) / (levels - 1)) : (x => x);
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            let [h, s, v] = rgb2hsv(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
            h = (h + hue) % 1; if (h < 0) h += 1; s = clamp01(s * sat); v = clamp01(v * val);
            let [r, g, b] = hsv2rgb(h, s, v);
            r = quant(chan(r)); g = quant(chan(g)); b = quant(chan(b));
            data[o] = Math.round(r * 255); data[o + 1] = Math.round(g * 255); data[o + 2] = Math.round(b * 255);
        }
    }

    /* Build a 256×1 RGBA gradient canvas from palette stops (then optional
       colour adjustments), sampled by the shader at the noise value.
       CLAMP_TO_EDGE on the GPU side avoids wrap bleed between first/last stop. */
    function buildRampCanvas(palette, adjust) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 1;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 256, 0);
        for (const stop of palette) {
            const col = stop.color;
            const a = col.length > 3 ? col[3] / 255 : 1;
            grad.addColorStop(clamp(stop.pos, 0, 1), `rgba(${col[0]|0},${col[1]|0},${col[2]|0},${a})`);
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 1);
        if (!adjustIsIdentity(adjust)) {
            const id = g.getImageData(0, 0, 256, 1);
            applyColorAdjust(id.data, adjust);
            g.putImageData(id, 0, 0);
        }
        return c;
    }

    function frameUniforms(p, t) {
        // Periods must be integers for the noise to stay tileable; stretch shrinks
        // the Y period (taller features). Flow is integer tiles/loop so the scroll
        // lands back on itself at t=1 — seamless and looping survive the motion.
        const periodX = Math.max(1, Math.round(p.spatialPeriod));
        const stretch = Math.max(1, Math.round(p.stretch || 1));
        const periodY = Math.max(1, Math.round(periodX / stretch));
        return {
            u_time: t,
            u_period: [periodX, periodY],
            u_flow: [Math.round(p.flowX || 0), Math.round(p.flowY || 0)],
            u_timePeriod: p.timePeriod,
            u_octaves: p.octaves,
            u_gain: p.gain,
            u_warp: p.warp,
            u_contrast: p.contrast,
            u_seed: p.seed,
            u_style: p.style
        };
    }

    /* Generate the full looping sequence. Returns an array of N canvases
       (tileSize²). Deterministic: same params → identical pixels. */
    function generateFrames(params) {
        const E = TRLE.Engine;
        if (!E || !E.programs || !E.programs().animNoise) {
            throw new Error('TRLE.AnimGen: animNoise shader unavailable (is the engine initialised?)');
        }
        const p = Object.assign({}, DEFAULTS, params);
        const S = clampSize(p.size);
        const N = clampFrames(p.frames);

        let rampTex = null;
        if (p.palette && p.palette.length) {
            const gl = E.gl();
            rampTex = E.createTextureFromImage(buildRampCanvas(p.palette, p.colorAdjust),
                { wrap: gl.CLAMP_TO_EDGE, filter: gl.LINEAR });
        }

        const frames = [];
        try {
            for (let i = 0; i < N; i++) {
                const fbo = E.createFBO(S, S);
                const u = frameUniforms(p, i / N);
                u.u_useRamp = rampTex ? 1 : 0;
                if (rampTex) u.u_ramp = rampTex;
                E.blit('animNoise', u, fbo, S, S);
                frames.push(E.fboToCanvas(fbo));
                E.deleteFBO(fbo);
            }
        } finally {
            if (rampTex) E.deleteTexture(rampTex);
        }
        return frames;
    }

    /* Single representative frame (t = 0) — handy for grid thumbnails / a quick
       static preview without baking the whole sequence. */
    function generatePoster(params) {
        return generateFrames(Object.assign({}, params, { frames: LIMITS.MIN_FRAMES }))[0];
    }

    return { generateFrames, generatePoster, buildRamp: buildRampCanvas, clampFrames, clampSize, LIMITS, DEFAULTS };
})();
