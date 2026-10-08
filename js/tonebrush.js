/* TRLE.ToneBrush: the pixel maths of Edit > Dodge & Burn (FILTERS-PLAN phase 7), pure functions.

   Five operations, each applied to a picture THROUGH a coverage mask (0..1 per pixel, painted with
   the brush engine): Dodge and Burn (a tone curve weighted to the shadows, midtones or highlights,
   optionally on luma so hue and saturation stay), Sponge (more or less colour, with Vibrance),
   Blur (a Gaussian, mixed in by coverage) and Sharpen (an unsharp mask, optionally held inside the
   neighbourhood's range so it cannot make halos). Exposure scales with the coverage, so a faint
   or soft-edged stroke gives a faint effect.

   The tone curves, the luma-preserving gamut compression, the Sponge vibrance damping and the
   detail-protecting sharpen follow PhotoCraft's retouch.rs (MIT OR Apache-2.0, Copyright (c) 2026
   ArtCraft Team and the PhotoCraft contributors, github.com/storytold/photocraft, commit
   5896f0b), rewritten here. Blur and Sharpen wrap at the tile edges (edge: 'wrap'), so a stroke
   across an edge continues on the other side and a tiling texture still tiles.

   render({ data, width, height }, coverage Float32Array w*h, recipe) -> Uint8ClampedArray RGBA.
   Alpha is never changed. */
(function () {
    'use strict';
    const TRLE = window.TRLE = window.TRLE || {};

    const OPS = Object.freeze([
        ['dodge', 'Dodge'], ['burn', 'Burn'], ['sponge', 'Sponge'], ['blur', 'Blur'], ['sharpen', 'Sharpen'],
    ].map(([id, label]) => Object.freeze({ id, label })));
    /* A recipe's defaults: exposure and strength are 0..100 %. */
    const DEFAULTS = Object.freeze({ op: 'dodge', range: 'midtones', exposure: 50, protect: true, saturate: true, vibrance: false, radius: 3, protectDetail: true, edge: 'wrap', k: 1 });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

    /* The dodge / burn transfer for one value v (0..1) at strength e (0..1). */
    function toneCurve(v, e, range, burn) {
        v = Math.max(0, v); e = clamp(e, 0, 1);
        if (range === 'midtones') {
            const w = clamp(4 * v * (1 - v), 0, 1), vv = Math.min(v, 1);
            return v + w * (Math.pow(vv, burn ? 1 + e : 1 / (1 + e)) - v);
        }
        const vv = Math.min(v, 1);
        if (range === 'shadows') return burn ? v - e * Math.pow(1 - vv, 2) * v : v + e * Math.pow(1 - vv, 2) * (1 - vv);
        return burn ? v - e * vv * vv * v : v + e * vv * vv * (1 - vv);   // highlights
    }
    /* Back into 0..1 keeping the luma (mix toward grey) instead of clipping each channel, which would shift hue. */
    function compressGamut(c, l) {
        l = clamp(l, 0, 1);
        const lo = Math.min(c[0], c[1], c[2]), hi = Math.max(c[0], c[1], c[2]);
        let t = 1;
        if (hi > 1 && hi - l > 1e-9) t = Math.min(t, (1 - l) / (hi - l));
        if (lo < 0 && l - lo > 1e-9) t = Math.min(t, l / (l - lo));
        return [l + (c[0] - l) * t, l + (c[1] - l) * t, l + (c[2] - l) * t];
    }
    function dodgeBurn(c, e, range, burn, protect) {
        if (e <= 0) return c;
        if (protect) {
            const l = luma(c[0], c[1], c[2]), nl = toneCurve(l, e, range, burn);
            const out = l > 1e-6 ? [c[0] * nl / l, c[1] * nl / l, c[2] * nl / l] : [nl, nl, nl];
            return compressGamut(out, nl);
        }
        return [toneCurve(c[0], e, range, burn), toneCurve(c[1], e, range, burn), toneCurve(c[2], e, range, burn)];
    }
    const saturation = c => { const lo = Math.min(c[0], c[1], c[2]), hi = Math.max(c[0], c[1], c[2]); return hi <= 1e-6 ? 0 : clamp((hi - lo) / hi, 0, 1); };
    function sponge(c, amount, saturate, vibrance) {
        let a = clamp(amount, 0, 1);
        if (a <= 0) return c;
        const s = saturation(c);
        if (vibrance) a *= saturate ? 1 - s : 0.25 + 0.75 * s;
        const l = luma(c[0], c[1], c[2]), k = saturate ? 1 + a : 1 - a;
        return compressGamut([l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k], l);
    }

    function render(src, cov, recipe) {
        const o = Object.assign({}, DEFAULTS, recipe || {});
        const w = src.width, h = src.height, d = src.data, out = new Uint8ClampedArray(d.length);
        out.set(d);
        const e0 = clamp(o.exposure / 100, 0, 1);
        if (e0 <= 0) return out;
        if (o.op === 'dodge' || o.op === 'burn' || o.op === 'sponge') {
            const burn = o.op === 'burn', sp = o.op === 'sponge';
            for (let i = 0; i < w * h; i++) {
                const c = cov[i];
                if (c <= 0) continue;
                const col = [d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255];
                const r = sp ? sponge(col, e0 * c, o.saturate, o.vibrance) : dodgeBurn(col, e0 * c, o.range, burn, o.protect);
                out[i * 4] = Math.round(clamp(r[0], 0, 1) * 255); out[i * 4 + 1] = Math.round(clamp(r[1], 0, 1) * 255); out[i * 4 + 2] = Math.round(clamp(r[2], 0, 1) * 255);
            }
            return out;
        }
        // Blur and Sharpen: a wrapped Gaussian of the premultiplied picture, then mixed in by coverage.
        const sigma = Math.max(0.3, o.radius * Math.max(1, o.k)), wrap = o.edge !== 'clamp';
        const P = new Float32Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            const a = d[i * 4 + 3] / 255;
            P[i * 4] = d[i * 4] / 255 * a; P[i * 4 + 1] = d[i * 4 + 1] / 255 * a; P[i * 4 + 2] = d[i * 4 + 2] / 255 * a; P[i * 4 + 3] = a;
        }
        const B = TRLE.OilPaint.gauss(P, w, h, 4, sigma, wrap);
        const amount = o.op === 'sharpen' ? e0 * 3 : 0;
        const ix = x => wrap ? ((x % w) + w) % w : clamp(x, 0, w - 1), iy = y => wrap ? ((y % h) + h) % h : clamp(y, 0, h - 1);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, c = cov[i];
            if (c <= 0) continue;
            const a = d[i * 4 + 3] / 255;
            for (let ch = 0; ch < 3; ch++) {
                const v = d[i * 4 + ch] / 255;
                let r;
                if (o.op === 'blur') {
                    const bl = B[i * 4 + 3] > 1e-6 ? B[i * 4 + ch] / B[i * 4 + 3] : v;   // unpremultiplied by the blurred coverage
                    r = v + (bl - v) * e0 * c;
                } else {
                    const bl = B[i * 4 + 3] > 1e-6 ? B[i * 4 + ch] / B[i * 4 + 3] : v;
                    r = v + amount * c * (v - bl);
                    if (o.protectDetail) {
                        let lo = 1, hi = 0;
                        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = d[(iy(y + dy) * w + ix(x + dx)) * 4 + ch] / 255; if (n < lo) lo = n; if (n > hi) hi = n; }
                        r = clamp(r, lo, hi);
                    }
                }
                out[i * 4 + ch] = Math.round(clamp(r, 0, 1) * 255);
            }
            if (a === 0) { out[i * 4] = d[i * 4]; out[i * 4 + 1] = d[i * 4 + 1]; out[i * 4 + 2] = d[i * 4 + 2]; }   // a hole keeps its colour
        }
        return out;
    }

    /* A canvas through the recipe: the coverage is a canvas of any size (its red channel), scaled to the picture. */
    function renderCanvas(srcCanvas, maskCanvas, recipe) {
        const w = srcCanvas.width, h = srcCanvas.height;
        const id = srcCanvas.getContext('2d').getImageData(0, 0, w, h);
        let mc = maskCanvas;
        if (mc.width !== w || mc.height !== h) {
            mc = document.createElement('canvas'); mc.width = w; mc.height = h;
            const g = mc.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(maskCanvas, 0, 0, w, h);
        }
        const md = mc.getContext('2d').getImageData(0, 0, w, h).data, cov = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) cov[i] = md[i * 4] / 255;
        const px = render(id, cov, Object.assign({}, recipe, { k: Math.max(1, w / 256) }));
        const out = document.createElement('canvas'); out.width = w; out.height = h;
        out.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
        return out;
    }
    /* Anything painted at all? (the red channel of a mask canvas) */
    function maskIsEmpty(mc) {
        const d = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 0) return false;
        return true;
    }

    TRLE.ToneBrush = { OPS, DEFAULTS, toneCurve, dodgeBurn, sponge, render, renderCanvas, maskIsEmpty };
})();
