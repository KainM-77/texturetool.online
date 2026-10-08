/* TRLE.OilPaint: Oil Paint (FILTERS-PLAN phase 6), a pure function from pixels to pixels.

   The structure tensor of the luminance (Brox et al.) gives a smooth stroke direction, a line
   integral convolution (Cabral & Leedom 1993) smears the colour along it, as in flow-based
   abstraction (Kyprianidis & Doellner 2008), and noise convolved along the same field gives the
   bristle streaks. With Lighting ON the smeared colour plus the bristles form a height map that a
   directional light shades. Lighting is OFF by default (the author's decision): the shading is
   baked into the diffuse, which is exactly what De-light removes for TEN.

   The steps, constants and parameter ranges follow PhotoCraft's oil.rs (MIT OR Apache-2.0,
   Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors,
   github.com/storytold/photocraft, commit 5896f0b), rewritten here in JavaScript with every
   neighbour lookup WRAPPED (edge: 'wrap'), so a texture that tiles still tiles; edge: 'clamp'
   stops at the border instead. The noise is a hash of the WRAPPED pixel position, so it repeats
   with the tile. Colour is smeared premultiplied and the layer's own alpha is kept, so a cutout
   keeps its holes.

   render(imageData-like { data, width, height }, opts) returns a Uint8ClampedArray RGBA. */
(function () {
    'use strict';
    const TRLE = window.TRLE = window.TRLE || {};

    /* `k` is the tile size over 256: lengths and radii are written for a 256 px tile and scale with it, so a 256 px
       preview and a 1024 px Apply agree. The bristle noise is hashed per k x k block for the same reason. */
    const DEFAULTS = Object.freeze({ stylization: 4.2, cleanliness: 5, scale: 0.8, bristle: 4, lighting: false, angle: 120, shine: 4, edge: 'wrap', k: 1 });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const strokeLen = s => 1.5 + clamp(s, 0.1, 10) * 2;
    const tensorSigma = s => 0.8 + clamp(s, 0.1, 10) * 0.6;

    /* Deterministic [0, 1) from integer coordinates. */
    function hash01(x, y) {
        let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ 0x2545f491;
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /* A separable Gaussian over an interleaved `n`-channel float buffer, wrapping (or clamping) at the edges. */
    function gauss(buf, w, h, n, sigma, wrap) {
        if (sigma < 0.3) return buf;
        const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
        let sum = 0;
        for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
        for (let i = 0; i < k.length; i++) k[i] /= sum;
        const tmp = new Float32Array(buf.length), idx = (i, m) => wrap ? ((i % m) + m) % m : (i < 0 ? 0 : i >= m ? m - 1 : i);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = (y * w + x) * n;
            for (let c = 0; c < n; c++) {
                let a = 0;
                for (let i = -r; i <= r; i++) a += buf[(y * w + idx(x + i, w)) * n + c] * k[i + r];
                tmp[o + c] = a;
            }
        }
        const out = new Float32Array(buf.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = (y * w + x) * n;
            for (let c = 0; c < n; c++) {
                let a = 0;
                for (let i = -r; i <= r; i++) a += tmp[(idx(y + i, h) * w + x) * n + c] * k[i + r];
                out[o + c] = a;
            }
        }
        return out;
    }

    function render(src, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const w = src.width, h = src.height, n = 4, wrap = o.edge !== 'clamp';
        const ix = x => wrap ? ((x % w) + w) % w : (x < 0 ? 0 : x >= w ? w - 1 : x);
        const iy = y => wrap ? ((y % h) + h) % h : (y < 0 ? 0 : y >= h ? h - 1 : y);
        // 1. Premultiplied colour, cleaned (pre-smoothed) by Cleanliness.
        let p = new Float32Array(w * h * n);
        const d = src.data;
        for (let i = 0; i < w * h; i++) {
            const a = d[i * 4 + 3] / 255;
            p[i * n] = d[i * 4] / 255 * a; p[i * n + 1] = d[i * 4 + 1] / 255 * a; p[i * n + 2] = d[i * 4 + 2] / 255 * a; p[i * n + 3] = a;
        }
        const K = Math.max(1, o.k), hn = (x, y) => hash01(Math.floor(x / K), Math.floor(y / K));
        p = gauss(p, w, h, n, clamp(o.cleanliness, 0, 10) * 0.25 * K, wrap);
        // 2. The luminance-like intensity: the mean of the three colour channels.
        const lum = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) lum[i] = (p[i * n] + p[i * n + 1] + p[i * n + 2]) / 3;
        // 3. The smoothed structure tensor (E, F, G) from a Sobel gradient.
        let efg = new Float32Array(w * h * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const L = (dx, dy) => lum[iy(y + dy) * w + ix(x + dx)];
            const gx = (L(1, -1) + 2 * L(1, 0) + L(1, 1)) - (L(-1, -1) + 2 * L(-1, 0) + L(-1, 1));
            const gy = (L(-1, 1) + 2 * L(0, 1) + L(1, 1)) - (L(-1, -1) + 2 * L(0, -1) + L(1, -1));
            const q = (y * w + x) * 3;
            efg[q] = gx * gx; efg[q + 1] = gx * gy; efg[q + 2] = gy * gy;
        }
        efg = gauss(efg, w, h, 3, tensorSigma(o.scale) * K, wrap);
        // 4. The stroke direction: the minor eigenvector, along the edges.
        const tx = new Float32Array(w * h), ty = new Float32Array(w * h), R2 = Math.SQRT1_2;
        for (let i = 0; i < w * h; i++) {
            const e = efg[i * 3], f = efg[i * 3 + 1], g = efg[i * 3 + 2];
            const l1 = 0.5 * (e + g + Math.sqrt((e - g) * (e - g) + 4 * f * f));
            const vx = l1 - e, vy = -f, m = Math.hypot(vx, vy);
            if (m < 1e-6 || (l1 - (e + g - l1)) < 1e-6) { tx[i] = R2; ty[i] = R2; }   // near-isotropic: gentle diagonal strokes
            else { tx[i] = vx / m; ty[i] = vy / m; }
        }
        // 5. The line integral convolution: colour and bristle noise along the direction field.
        const len = strokeLen(o.stylization) * K, step = Math.max(len / 10, 1), steps = Math.ceil(len / step);
        const col = new Float32Array(w * h * n), bristle = new Float32Array(w * h);
        const acc = new Float32Array(n);
        const sample = (x, y, k) => {
            const xi = Math.floor(x), yi = Math.floor(y), ax = x - xi, ay = y - yi;
            const x0 = ix(xi), x1 = ix(xi + 1), y0 = iy(yi), y1 = iy(yi + 1);
            const i00 = (y0 * w + x0) * n, i10 = (y0 * w + x1) * n, i01 = (y1 * w + x0) * n, i11 = (y1 * w + x1) * n;
            const w00 = (1 - ax) * (1 - ay) * k, w10 = ax * (1 - ay) * k, w01 = (1 - ax) * ay * k, w11 = ax * ay * k;
            for (let c = 0; c < n; c++) acc[c] += p[i00 + c] * w00 + p[i10 + c] * w10 + p[i01 + c] * w01 + p[i11 + c] * w11;
        };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            acc.fill(0);
            let wsum = 1, nsum = hn(x, y);
            sample(x, y, 1);   // the pixel itself
            for (const dir of [1, -1]) {
                let qx = x, qy = y, px = 0, py = 0;
                for (let k = 1; k <= steps; k++) {
                    const ti = iy(Math.round(qy)) * w + ix(Math.round(qx));
                    let vx = tx[ti], vy = ty[ti];
                    if (k === 1) { vx *= dir; vy *= dir; }
                    else if (vx * px + vy * py < 0) { vx = -vx; vy = -vy; }
                    px = vx; py = vy;
                    qx += vx * step; qy += vy * step;
                    const wk = 1 - k / (steps + 1);
                    sample(qx, qy, wk);
                    wsum += wk;
                    nsum += wk * hn(ix(Math.round(qx)), iy(Math.round(qy)));
                }
            }
            const q = (y * w + x) * n;
            for (let c = 0; c < n; c++) col[q + c] = acc[c] / wsum;
            bristle[y * w + x] = nsum / wsum - 0.5;
        }
        // 6. Lighting (optional): the smeared colour and the bristles as a height map under a directional light.
        const out = new Uint8ClampedArray(w * h * 4);
        const amp = clamp(o.bristle, 0, 10) / 10, shine = clamp(o.shine, 0, 10) / 10;
        const ang = o.angle * Math.PI / 180, elev = Math.PI / 4;
        const light = [Math.cos(ang) * Math.cos(elev), -Math.sin(ang) * Math.cos(elev), Math.sin(elev)];
        const half0 = [light[0], light[1], light[2] + 1], hm = Math.hypot(half0[0], half0[1], half0[2]);
        const half = [half0[0] / hm, half0[1] / hm, half0[2] / hm], flatSpec = Math.pow(half[2], 40);
        const height = (x, y) => { const q = (iy(y) * w + ix(x)) * n; return ((col[q] + col[q + 1] + col[q + 2]) / 3) * 2 + bristle[iy(y) * w + ix(x)] * amp * 6; };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const q = (y * w + x) * n, a0 = d[(y * w + x) * 4 + 3] / 255;
            let r = col[q], g = col[q + 1], b = col[q + 2];
            const ca = col[q + 3];
            // Unpremultiply by the smeared coverage; the layer keeps its own alpha.
            if (ca > 1e-6) { r /= ca; g /= ca; b /= ca; } else { r = g = b = 0; }
            if (o.lighting) {
                const hx = height(x + 1, y) - height(x - 1, y), hy = height(x, y + 1) - height(x, y - 1);
                const nx = -hx * 0.5, ny = -hy * 0.5, m = Math.sqrt(nx * nx + ny * ny + 1);
                const ndl = (nx * light[0] + ny * light[1] + light[2]) / m;
                const ndh = Math.max(0, (nx * half[0] + ny * half[1] + half[2]) / m);
                const shade = 1 + (ndl - light[2]) * 1.2, spec = shine * Math.max(0, Math.pow(ndh, 40) - flatSpec) * 0.8;
                r = r * shade + spec; g = g * shade + spec; b = b * shade + spec;
            }
            out[(y * w + x) * 4] = Math.round(clamp(r, 0, 1) * 255);
            out[(y * w + x) * 4 + 1] = Math.round(clamp(g, 0, 1) * 255);
            out[(y * w + x) * 4 + 2] = Math.round(clamp(b, 0, 1) * 255);
            out[(y * w + x) * 4 + 3] = Math.round(a0 * 255);
        }
        return out;
    }

    TRLE.OilPaint = { DEFAULTS, render, hash01, strokeLen, tensorSigma, gauss };
})();
