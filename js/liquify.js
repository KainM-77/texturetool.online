/* TRLE.Liquify: the displacement field behind Transform > Liquify (FILTERS-PLAN phases 3 to 5).

   A tile's pixels are shown through a field of offsets: output pixel p shows the
   source at p + d(p), an inverse map, so it never leaves a hole. The field is a
   coarse N x N grid (a node every `cell` px), each node holding d in px at the
   tile size S. Brush strokes are plain data (tool, size, density, pressure, rate,
   points) applied in order; the same strokes on a fresh field give the same
   numbers, because nothing here is random.

   Every tool is written as "where does the new output at p come from in the
   current output": q = M(p), then d'(p) = q + d(q) - p, with d(q) read from the
   field as it was before the dab. Reconstruct scales d toward zero and Smooth
   relaxes it toward its local mean; Freeze and Thaw paint a mask that scales
   every other tool down.

   EVERYTHING WRAPS: node indices, the brush distance (the nearest copy of the dab
   centre) and every field read are toroidal, so a stroke across an edge continues
   on the other side and the result tiles when the texture does (a brush no wider
   than half the tile, see MAX_SIZE, cannot meet itself).

   The tools, falloff and dab spacing follow PhotoCraft's liquify.rs (MIT OR
   Apache-2.0, Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors,
   github.com/storytold/photocraft, commit 5896f0b), rewritten here with wrap-around,
   a tile-sized field instead of a document-sized one, and a saved form (encodeGrid).
   A field is saved as a grid of at most 128 x 128 (FILTERS-PLAN P3, changed from 64 on measurement),
   in fractions of the tile as Int16, so one saved grid serves every canvas size. */
(function () {
    'use strict';
    const TRLE = window.TRLE = window.TRLE || {};

    const TOOLS = Object.freeze([
        ['forward', 'Forward Warp'], ['twirlcw', 'Twirl Clockwise'], ['twirlccw', 'Twirl Counterclockwise'],
        ['pucker', 'Pucker'], ['bloat', 'Bloat'], ['pushleft', 'Push Left'],
        ['reconstruct', 'Reconstruct'], ['smooth', 'Smooth'], ['freeze', 'Freeze Mask'], ['thaw', 'Thaw Mask'],
    ].map(([id, label]) => Object.freeze({ id, label })));
    /* Tools that act while the brush is held still: each recorded point is a dab. */
    const STATIONARY = new Set(['twirlcw', 'twirlccw', 'pucker', 'bloat', 'reconstruct', 'smooth', 'freeze', 'thaw']);
    const SAVED_N = 128, SAVED_SIZES = [64, 128, 256], SAVED_SCALE = 32768;     // the saved grid: up to 128 x 128, fractions of the tile x 32768 as Int16
    const MAX_SIZE_FRAC = 0.5;                   // a brush's diameter, as a fraction of the tile

    /* The field for a tile of S px: N nodes a side, 2 px apart (4 beyond 512 px, N capped at 256). */
    function gridSize(S) { return Math.max(16, Math.min(256, Math.round(S / 2))); }
    function create(S) {
        const N = gridSize(S);
        return { S, N, cell: S / N, d: new Float32Array(N * N * 2), freeze: new Float32Array(N * N) };
    }
    function clone(f) { return { S: f.S, N: f.N, cell: f.cell, d: f.d.slice(), freeze: f.freeze.slice() }; }
    function isIdentity(f) { const d = f.d; for (let i = 0; i < d.length; i++) if (d[i] !== 0) return false; return true; }
    const maxSize = S => Math.max(1, Math.floor(S * MAX_SIZE_FRAC));
    const wrap = (i, n) => ((i % n) + n) % n;

    /* The field at grid coordinates (node i sits at gx = i), bilinear, wrapping. */
    function bilinear(d, N, gx, gy) {
        const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
        const i0 = wrap(i, N), i1 = wrap(i + 1, N), j0 = wrap(j, N) * N, j1 = wrap(j + 1, N) * N;
        const a = (j0 + i0) * 2, b = (j0 + i1) * 2, c = (j1 + i0) * 2, e = (j1 + i1) * 2;
        return [
            (d[a] * (1 - fx) + d[b] * fx) * (1 - fy) + (d[c] * (1 - fx) + d[e] * fx) * fy,
            (d[a + 1] * (1 - fx) + d[b + 1] * fx) * (1 - fy) + (d[c + 1] * (1 - fx) + d[e + 1] * fx) * fy,
        ];
    }

    /* One dab at c = [x, y] (px at S) with brush motion `delta`. */
    function dab(f, s, c, delta, pointPressure) {
        const N = f.N, cell = f.cell, S = f.S, d = f.d;
        const r = Math.max(0.5, s.size / 2);
        const strength = Math.max(0, Math.min(1, s.pressure / 100)) * pointPressure;
        const rate = Math.max(0, Math.min(1, s.rate / 100)), density = Math.max(0, Math.min(1, s.density / 100));
        if (strength <= 0) return;
        const i0 = Math.floor((c[0] - r) / cell - 0.5), i1 = Math.ceil((c[0] + r) / cell - 0.5);
        const j0 = Math.floor((c[1] - r) / cell - 0.5), j1 = Math.ceil((c[1] + r) / cell - 0.5);
        const writes = [];
        const frz = s.tool === 'freeze' || s.tool === 'thaw';
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const px = (i + 0.5) * cell, py = (j + 0.5) * cell;
            const dx = px - c[0], dy = py - c[1];
            const t2 = (dx * dx + dy * dy) / (r * r);
            if (t2 >= 1) continue;
            const soft = (1 - t2) * (1 - t2), fall = (1 - density) + density * soft;
            const idx = wrap(j, N) * N + wrap(i, N), kRaw = strength * fall;
            if (frz) {
                const fz = f.freeze[idx];
                writes.push([idx, null, s.tool === 'freeze' ? Math.min(1, fz + kRaw) : Math.max(0, fz - kRaw)]);
                continue;
            }
            const k = kRaw * (1 - f.freeze[idx]);
            if (k <= 0) continue;
            const cur0 = d[idx * 2], cur1 = d[idx * 2 + 1];
            let nd;
            if (s.tool === 'reconstruct') {
                const a = 1 - k * (0.1 + 0.4 * rate);
                nd = [cur0 * a, cur1 * a];
            } else if (s.tool === 'smooth') {
                let m0 = 0, m1 = 0;
                for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                    const q = (wrap(j + oy, N) * N + wrap(i + ox, N)) * 2;
                    m0 += d[q] / 8; m1 += d[q + 1] / 8;
                }
                const a = k * (0.1 + 0.4 * rate);
                nd = [cur0 + (m0 - cur0) * a, cur1 + (m1 - cur1) * a];
            } else {
                let q;
                if (s.tool === 'forward') q = [px - k * delta[0], py - k * delta[1]];
                else if (s.tool === 'pushleft') q = [px - k * delta[1], py + k * delta[0]];   // left of the stroke direction (y down)
                else if (s.tool === 'twirlcw' || s.tool === 'twirlccw') {
                    const th = k * rate * 0.12 * (s.tool === 'twirlcw' ? 1 : -1), sn = Math.sin(-th), cs = Math.cos(-th);
                    q = [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];                 // content turns by +th, so sample at the point turned by -th
                } else if (s.tool === 'pucker') { const a = 1 + k * rate * 0.06; q = [c[0] + dx * a, c[1] + dy * a]; }
                else { const a = 1 - k * rate * 0.06; q = [c[0] + dx * a, c[1] + dy * a]; }   // bloat
                const dq = bilinear(d, N, (q[0] - px) / cell + i, (q[1] - py) / cell + j);
                nd = [q[0] + dq[0] - px, q[1] + dq[1] - py];
            }
            writes.push([idx, nd, f.freeze[idx]]);
        }
        // Writes are applied after every read, so a dab never reads its own result.
        const lim = S;   // one tile is the most a node may move; keeps the saved form in range
        for (const [idx, nd, fz] of writes) {
            if (nd) { d[idx * 2] = Math.max(-lim, Math.min(lim, nd[0])); d[idx * 2 + 1] = Math.max(-lim, Math.min(lim, nd[1])); }
            f.freeze[idx] = fz;
        }
    }

    /* Start a stroke at p = [x, y, pressure]: a stationary tool dabs once there. */
    function strokeBegin(f, s, p) {
        if (STATIONARY.has(s.tool)) dab(f, s, [p[0], p[1]], [0, 0], Math.max(0, Math.min(1, p[2] == null ? 1 : p[2])));
    }
    /* Continue from a to b: a dab every fifth of the brush radius (a stationary tool held still dabs once at b). */
    function strokeSegment(f, s, a, b) {
        const pa = Math.max(0, Math.min(1, a[2] == null ? 1 : a[2])), pb = Math.max(0, Math.min(1, b[2] == null ? 1 : b[2]));
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len === 0) { if (STATIONARY.has(s.tool)) dab(f, s, [b[0], b[1]], [0, 0], pb); return; }
        const r = Math.max(0.5, s.size / 2), spacing = Math.max(0.5, r * 0.2), steps = Math.max(1, Math.ceil(len / spacing));
        for (let k = 1; k <= steps; k++) {
            const t0 = (k - 1) / steps, t1 = k / steps;
            const c = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
            const delta = [(b[0] - a[0]) * (t1 - t0), (b[1] - a[1]) * (t1 - t0)];
            const pr = pa + (pb - pa) * t1;
            // Forward Warp centres the dab where the brush was (it drags what is under it).
            const centre = STATIONARY.has(s.tool) ? c : [c[0] - delta[0], c[1] - delta[1]];
            dab(f, s, centre, delta, pr);
        }
    }
    function applyStroke(f, s) {
        const pts = (s.points || []).filter(p => p && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]));
        if (!pts.length) return;
        strokeBegin(f, s, pts[0]);
        for (let i = 1; i < pts.length; i++) strokeSegment(f, s, pts[i - 1], pts[i]);
    }
    /* Whole-field operations. */
    function reconstructAll(f, amount) {
        const k = Math.max(0, Math.min(1, amount == null ? 1 : amount));
        for (let n = 0; n < f.freeze.length; n++) {
            const m = 1 - k * (1 - f.freeze[n]);
            f.d[n * 2] *= m; f.d[n * 2 + 1] *= m;
        }
    }
    function freezeAll(f) { f.freeze.fill(1); }
    function thawAll(f) { f.freeze.fill(0); }
    function invertFreeze(f) { for (let n = 0; n < f.freeze.length; n++) f.freeze[n] = 1 - f.freeze[n]; }

    /* ---- what the GPU and the saved file see: fractions of the tile ----------
       RGBA32F texels (N x N, row 0 on top): r, g = offset as a fraction of the tile. */
    function toTexData(f) {
        const out = new Float32Array(f.N * f.N * 4), inv = 1 / f.S;
        for (let n = 0; n < f.N * f.N; n++) { out[n * 4] = f.d[n * 2] * inv; out[n * 4 + 1] = f.d[n * 2 + 1] * inv; }
        return out;
    }
    /* The saved form: a fixed 64 x 64 grid, sampled at its own node centres with the same Catmull-Rom the
       shader uses, Int16 x 32768 of a tile, base64. Identity gives null (nothing to save). */
    function cubicW(x) {
        x = Math.abs(x);
        if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
        if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
        return 0;
    }
    function sampleCubic(tex, N, gx, gy) {   // tex: RGBA32F-like (fractions), gx/gy in node units
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
        let r = 0, g = 0;
        for (let j = -1; j <= 2; j++) {
            const wy = cubicW(fy - j), row = wrap(iy + j, N) * N;
            for (let i = -1; i <= 2; i++) {
                const w = cubicW(fx - i) * wy, q = (row + wrap(ix + i, N)) * 4;
                r += tex[q] * w; g += tex[q + 1] * w;
            }
        }
        return [r, g];
    }
    /* The saved grid is the live field's own size up to 128 (so a 256 px tile is saved exactly), not a fixed 64: measured
       2026-10-08, a 64 grid drifts 7 px from a 49 px bend at 256 and 47 px from an 88 px twirl at 1024 (FILTERS-PLAN P3). */
    const savedSize = f => Math.min(128, f.N);
    function encodeGrid(f, n) {
        if (isIdentity(f)) return null;
        n = n || savedSize(f);
        const tex = toTexData(f), i16 = new Int16Array(n * n * 2);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const v = f.N === n ? [tex[(j * n + i) * 4], tex[(j * n + i) * 4 + 1]]
                : sampleCubic(tex, f.N, (i + 0.5) / n * f.N - 0.5, (j + 0.5) / n * f.N - 0.5);
            i16[(j * n + i) * 2] = Math.max(-32767, Math.min(32767, Math.round(v[0] * SAVED_SCALE)));
            i16[(j * n + i) * 2 + 1] = Math.max(-32767, Math.min(32767, Math.round(v[1] * SAVED_SCALE)));
        }
        const bytes = new Uint8Array(i16.buffer);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { n, data: btoa(s) };
    }
    /* A saved grid is untrusted: exactly n x n x 2 Int16, n a known size. Returns RGBA32F texels (fractions) or null. */
    function decodeGrid(g) {
        if (!g || !SAVED_SIZES.includes(g.n) || typeof g.data !== 'string' || g.data.length > g.n * g.n * 6) return null;
        let raw;
        try { raw = atob(g.data); } catch (e) { return null; }
        const n = g.n;
        if (raw.length !== n * n * 4) return null;
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const i16 = new Int16Array(bytes.buffer), out = new Float32Array(n * n * 4);
        for (let k = 0; k < n * n; k++) { out[k * 4] = i16[k * 2] / SAVED_SCALE; out[k * 4 + 1] = i16[k * 2 + 1] / SAVED_SCALE; }
        return out;
    }

    TRLE.Liquify = {
        TOOLS, STATIONARY, SAVED_N, MAX_SIZE_FRAC,
        create, clone, isIdentity, maxSize, gridSize,
        applyStroke, strokeBegin, strokeSegment,
        reconstructAll, freezeAll, thawAll, invertFreeze,
        toTexData, encodeGrid, decodeGrid, sampleCubic,
    };
})();
