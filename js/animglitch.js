/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — Animated Texture GLITCH stage
   A CPU pass that runs AFTER the animNoise field, selected by a
   `glitch` object on the params bag. fBm makes smooth fields; a
   corrupted image is made of hard rectangles, torn rows, swapped
   channels and stale blocks dragged across the frame, none of
   which a noise shader can produce. So it is a stage rather than
   a preset of the noise generator, and it can run with the noise
   turned all the way down (`noiseMix: 0`), which leaves a flat
   collage of blocks with no Perlin in it at all.

   Two guarantees, both exact by construction:

   SEAMLESS. Every coordinate this file reads or writes goes
   through `wrap()`. The collage grid is a partition of the TORUS
   (cut points rotated by a random phase), each corruption
   rectangle has an origin anywhere in [0,S) and wraps, a torn row
   reads its shifted pixels with a wrap, the colour split likewise,
   and the scanline count is a whole number of periods per tile.
   Nothing is aligned to x = 0, so the tile border is not an edge
   of anything and no column of the tile is special.

   LOOPS. Frame i depends only on its phase t = i/N: the burst it
   belongs to is floor(t * bursts), the scanline roll travels one
   whole tile per loop, and the noise underneath is periodic in
   time already. So frame 2i of a 2N-frame bake IS frame i of an
   N-frame bake, and the frame after the last is frame 0.

   Inert when absent: `isActive(null)` is false and AnimGen then
   runs its original path unchanged, so every saved project and
   every other preset renders byte-identical.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimGlitch = (function () {
    'use strict';

    const DEFAULTS = {
        amount: 0,      // 0..1 share of the frame corrupted during a burst
        blocks: 6,      // collage cells across the tile (also the corruption scale)
        bursts: 4,      // separate corruptions per loop (whole number, so it loops)
        calm: 0,        // 0..1 share of bursts that hold still instead
        split: 0,       // RGB channel split, fraction of the tile
        tear: 0,        // 0..1 horizontal row tearing
        scan: 0,        // 0..1 scanline darkness + a rolling bright band
        noiseMix: 1     // 1 = the noise field as is, 0 = flat collage only
    };

    function norm(g) {
        return Object.assign({}, DEFAULTS, g || {});
    }

    /* Anything that would change a pixel. All-defaults is the noise field
       exactly, so it must NOT route through here (a round trip through the CPU
       ramp lookup is not bit-identical to the shader's LINEAR ramp sample). */
    function isActive(g) {
        if (!g) return false;
        const q = norm(g);
        return q.amount > 0 || q.split > 0 || q.tear > 0 || q.scan > 0 || q.noiseMix < 1;
    }

    /* mulberry32 on a hashed key. Deterministic per (seed, stream, index), so a
       burst's layout does not depend on how many frames were asked for. */
    function rng(seed, stream, index) {
        let a = (Math.imul((seed * 1000 | 0) ^ 0x9e3779b9, 0x85ebca6b) ^
                 Math.imul(stream + 1, 0xc2b2ae35) ^ Math.imul(index + 7, 0x27d4eb2f)) >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const irand = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

    /* ---- The collage: a partition of the torus into leaves ------------------
       G columns of jittered width around the circle, each column cut into rows
       independently (its own phase, its own jitter), each cell then split once
       or twice along its longer side. A uniform G x G grid was tried first and
       read as a checkerboard; independent row cuts per column break the grid
       in one direction, which is what makes it read as cut-up rather than
       tiled. Leaves carry their origin and size in UNWRAPPED coordinates and
       are rasterised through wrap(), which is what makes a leaf straddling the
       tile border one leaf. */
    function cuts(r, S, G, phase) {
        // G jittered cut points round a circle of length S, strictly increasing.
        const c = [];
        for (let k = 0; k < G; k++) c.push(phase + Math.floor((k + (r() - 0.5) * 0.7) * S / G));
        c.push(c[0] + S);
        for (let k = 1; k < c.length; k++) if (c[k] <= c[k - 1]) c[k] = c[k - 1] + 1;
        return c;
    }
    function buildLeaves(S, G, seed) {
        const r = rng(seed, 1, 0);
        const leaves = [];
        const split = (x, y, w, h, depth) => {
            if (depth < 2 && w > 3 && h > 3 && r() < 0.55) {
                const f = 0.3 + r() * 0.4;
                if (w >= h) { const a = Math.max(1, Math.round(w * f)); split(x, y, a, h, depth + 1); split(x + a, y, w - a, h, depth + 1); }
                else        { const a = Math.max(1, Math.round(h * f)); split(x, y, w, a, depth + 1); split(x, y + a, w, h - a, depth + 1); }
                return;
            }
            leaves.push({ x, y, w, h, type: irand(r, 0, 4), stripes: irand(r, 2, 6), salt: leaves.length });
        };
        const xs = cuts(r, S, G, Math.floor(r() * S));
        for (let i = 0; i < G; i++) {
            const ys = cuts(r, S, Math.max(2, G + irand(r, -1, 1)), Math.floor(r() * S));
            for (let j = 0; j < ys.length - 1; j++) split(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j], 0);
        }
        return leaves;
    }

    /* Rasterise the leaves' values for one burst. A share of leaves re-rolls
       each burst (more with more corruption), so a noise-free collage still
       flickers between bursts rather than sitting still under the scanlines. */
    function collageField(S, leaves, seed, burst, amount, noiseMix) {
        const B = new Float32Array(S * S);
        const reroll = 0.12 + 0.5 * amount;
        for (const L of leaves) {
            const base = rng(seed, 2, L.salt);
            let v0 = base(), v1 = base();
            const e = rng(seed, 3, L.salt * 131 + burst);
            if (e() < reroll) { v0 = e(); v1 = e(); }
            for (let ly = 0; ly < L.h; ly++) {
                const row = ((L.y + ly) % S) * S;
                for (let lx = 0; lx < L.w; lx++) {
                    let v;
                    switch (L.type) {
                        case 1: v = v0 + (v1 - v0) * (lx / Math.max(1, L.w - 1)); break;
                        case 2: v = v0 + (v1 - v0) * (ly / Math.max(1, L.h - 1)); break;
                        case 3: v = (Math.floor(ly * L.stripes / L.h) & 1) ? v1 : v0; break;
                        // A window onto the noise underneath, or with the noise
                        // off, vertical stripes: Noise 0 must mean no noise anywhere.
                        case 4: v = noiseMix > 0 ? -1 : ((Math.floor(lx * L.stripes / L.w) & 1) ? v1 : v0); break;
                        default: v = v0;
                    }
                    B[row + ((L.x + lx) % S)] = v;
                }
            }
        }
        return B;
    }

    /* ---- One burst's corruption: a list of rectangle ops + torn rows ------- */
    const PERMS = [[1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2]];
    function burstOps(S, G, seed, burst, amount, tear) {
        const r = rng(seed, 4, burst);
        const cell = S / G;
        const rects = [];
        const n = Math.round(amount * G * G * 0.5);
        for (let k = 0; k < n; k++) {
            const w = Math.max(1, Math.min(S, Math.round(cell * (0.5 + r() * 3.5))));
            const h = Math.max(1, Math.min(S, Math.round(cell * (0.15 + r() * 1.1))));
            const pick = r();
            const op = pick < 0.34 ? 'shift' : pick < 0.49 ? 'smear' : pick < 0.64 ? 'macro'
                     : pick < 0.79 ? 'swap' : pick < 0.88 ? 'crush' : 'invert';
            rects.push({
                x: irand(r, 0, S - 1), y: irand(r, 0, S - 1), w, h, op,
                dx: irand(r, 0, S - 1), dy: irand(r, 0, S - 1),
                macro: Math.max(2, Math.round(cell / (2 + r() * 4))),
                perm: PERMS[irand(r, 0, PERMS.length - 1)],
                vertical: r() < 0.5
            });
        }
        const tears = [];
        const nt = Math.round(tear * 6 * (0.5 + r()));
        for (let k = 0; k < nt; k++) {
            tears.push({
                y: irand(r, 0, S - 1),
                h: Math.max(1, Math.round(S * (0.005 + r() * 0.06))),
                dx: Math.round((r() * 2 - 1) * tear * S * 0.3)
            });
        }
        return { rects, tears };
    }

    const wrap = (v, S) => ((v % S) + S) % S;

    function applyRects(src, dst, S, rects) {
        dst.set(src);
        for (const R of rects) {
            for (let ly = 0; ly < R.h; ly++) {
                const Y = wrap(R.y + ly, S);
                for (let lx = 0; lx < R.w; lx++) {
                    const X = wrap(R.x + lx, S);
                    const o = (Y * S + X) * 4;
                    let sx = X, sy = Y;
                    if (R.op === 'shift') { sx = X + R.dx; sy = Y + R.dy; }
                    else if (R.op === 'smear') { if (R.vertical) sy = R.y; else sx = R.x; }
                    else if (R.op === 'macro') { sx = R.x + Math.floor(lx / R.macro) * R.macro; sy = R.y + Math.floor(ly / R.macro) * R.macro; }
                    const s = (wrap(sy, S) * S + wrap(sx, S)) * 4;
                    let c0 = src[s], c1 = src[s + 1], c2 = src[s + 2];
                    if (R.op === 'swap') { const c = [c0, c1, c2]; c0 = c[R.perm[0]]; c1 = c[R.perm[1]]; c2 = c[R.perm[2]]; }
                    else if (R.op === 'invert') { c0 = 255 - c0; c1 = 255 - c1; c2 = 255 - c2; }
                    else if (R.op === 'crush') { c0 = c0 & 0xc0; c1 = c1 & 0xc0; c2 = c2 & 0xc0; }
                    dst[o] = c0; dst[o + 1] = c1; dst[o + 2] = c2; dst[o + 3] = src[s + 3];
                }
            }
        }
    }

    function applyTears(src, dst, S, tears) {
        dst.set(src);
        for (const T of tears) {
            for (let ly = 0; ly < T.h; ly++) {
                const row = wrap(T.y + ly, S) * S;
                for (let x = 0; x < S; x++) {
                    const o = (row + x) * 4, s = (row + wrap(x - T.dx, S)) * 4;
                    dst[o] = src[s]; dst[o + 1] = src[s + 1]; dst[o + 2] = src[s + 2]; dst[o + 3] = src[s + 3];
                }
            }
        }
    }

    function applySplit(src, dst, S, d) {
        for (let y = 0; y < S; y++) {
            const row = y * S;
            for (let x = 0; x < S; x++) {
                const o = (row + x) * 4;
                dst[o]     = src[(row + wrap(x + d, S)) * 4];
                dst[o + 1] = src[o + 1];
                dst[o + 2] = src[(row + wrap(x - d, S)) * 4 + 2];
                dst[o + 3] = src[o + 3];
            }
        }
    }

    /* Scanlines: a whole number of dark/light PAIRS per tile, so the pattern is
       periodic at any tile size, plus a bright band rolling down one whole tile
       per loop. */
    function applyScan(buf, S, scan, t) {
        const P = 2 * Math.max(1, Math.round(S / 4));
        for (let y = 0; y < S; y++) {
            let f = (Math.floor(y * P / S) & 1) ? 1 - 0.45 * scan : 1;
            let d = (y + 0.5) / S - t; d -= Math.round(d);
            f += 0.35 * scan * Math.exp(-(d * d) / 0.0025);
            const row = y * S * 4;
            for (let x = 0; x < S; x++) {
                const o = row + x * 4;
                buf[o] = Math.min(255, buf[o] * f); buf[o + 1] = Math.min(255, buf[o + 1] * f); buf[o + 2] = Math.min(255, buf[o + 2] * f);
            }
        }
    }

    /* The whole stage. `values` is one Uint8ClampedArray RGBA per frame whose
       RED channel is the noise value (AnimGen renders it through a mono ramp so
       Colour spread still applies); `ramp` is the 256x1 colour ramp's pixels.
       Returns S x S canvases. */
    function compose(values, S, ramp, params) {
        const g = norm(params.glitch);
        const N = values.length;
        const seed = params.seed || 0;
        const G = Math.max(2, Math.min(32, Math.round(g.blocks)));
        const K = Math.max(1, Math.round(g.bursts));
        const m = Math.max(0, Math.min(1, g.noiseMix));
        const leaves = m < 1 ? buildLeaves(S, G, seed) : null;
        const fields = new Map(), ops = new Map(), calm = new Map();
        const d = Math.round(g.split * S);
        const A = new Uint8ClampedArray(S * S * 4), Bf = new Uint8ClampedArray(S * S * 4);
        const out = [];

        for (let i = 0; i < N; i++) {
            const t = i / N;
            const burst = Math.floor(i * K / N);   // integer maths: 2i of 2N is i of N exactly
            if (!calm.has(burst)) calm.set(burst, rng(seed, 5, burst)() < g.calm);
            const still = calm.get(burst);

            // 1. value -> colour, through the collage when the noise is mixed down.
            let C = null;
            if (leaves && !fields.has(burst)) fields.set(burst, collageField(S, leaves, seed, burst, g.amount, m));
            if (leaves) C = fields.get(burst);
            const V = values[i];
            for (let p = 0, o = 0; p < S * S; p++, o += 4) {
                let v = V[o] / 255;
                if (C) { const c = C[p]; if (c >= 0) v = c * (1 - m) + v * m; }
                const k = Math.max(0, Math.min(255, Math.round(v * 255))) * 4;
                A[o] = ramp[k]; A[o + 1] = ramp[k + 1]; A[o + 2] = ramp[k + 2]; A[o + 3] = ramp[k + 3];
            }

            // 2. the burst's corruption, unless this burst holds still.
            let cur = A, nxt = Bf;
            if (!still && (g.amount > 0 || g.tear > 0)) {
                if (!ops.has(burst)) ops.set(burst, burstOps(S, G, seed, burst, g.amount, g.tear));
                const b = ops.get(burst);
                if (b.rects.length) { applyRects(cur, nxt, S, b.rects); [cur, nxt] = [nxt, cur]; }
                if (b.tears.length) { applyTears(cur, nxt, S, b.tears); [cur, nxt] = [nxt, cur]; }
            }
            // 3. colour split: full in a burst, a residue while calm.
            const dd = still ? Math.round(d * 0.35) : d;
            if (dd) { applySplit(cur, nxt, S, dd); [cur, nxt] = [nxt, cur]; }
            // 4. scanlines run in every frame.
            if (g.scan > 0) applyScan(cur, S, g.scan, t);

            const cv = document.createElement('canvas');
            cv.width = S; cv.height = S;
            const ctx = cv.getContext('2d');
            const id = ctx.createImageData(S, S);
            id.data.set(cur);
            ctx.putImageData(id, 0, 0);
            out.push(cv);
        }
        return out;
    }

    return { compose, isActive, DEFAULTS };
})();
