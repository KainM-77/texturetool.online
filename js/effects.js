/* TRLE.Effects: layer effects for content layers (LAYERS-PLAN D6, phase 10).

   Canvas in, rendered parts out. Pure CPU, no tool knowledge, no DOM beyond canvas creation.
   The set: Drop Shadow, Inner Shadow, Outer Glow, Inner Glow, Stroke, Colour Overlay, plus
   Bevel as a relief field (text layers only, F3: the caller decides).

   `render(src, fx, { wrap })` takes a content layer (RGBA, straight alpha = coverage) and an
   effects bag `{ dropShadow: { on, ... }, ... }` and returns
     image   the whole layer with its effects (behind + body)
     body    the content, its inner effects, its colour overlay and its stroke: what the layer's
             material region and relief are made from (D7)
     behind  drop shadow and outer glow only, or null: diffuse only, never a region
     glow    outer + inner glow colour alone, or null
     emit    the glows ticked "Also glow in game" (`emit: true`) alone, or null: what phase 12 adds to the emissive map
   With no effect on, every part is a byte-identical clone of the source.

   Wrap makes every blur, every distance and every offset toroidal, so a layer on a tiling
   area gives effects that tile; rolling the layer rolls its effects exactly.

   Distance is an EXACT Euclidean transform (Felzenszwalb and Huttenlocher 2012, O(N)), not the
   octagonal chamfer the tool uses elsewhere, which is 8 % out and shows as corners on a wide
   stroke or glow spread. Distances are measured from the pixel centres of a binary mask (alpha
   >= 0.5), and a stroke of width w covers the pixels whose distance is at most w, with a half
   pixel of anti-aliasing, which puts the stroked edge within 0.5 px of w at any width.

   Parts are composited in a fixed order, bottom to top:
     behind : drop shadow, outer glow
     body   : outside stroke, content, colour overlay, inner glow, inner shadow, inside stroke
   Offsets are whole pixels (angle and distance are rounded to a shift), so a shadow's offset is
   exact and a blur of 0 gives the shape's own shifted alpha. */
(function () {
    'use strict';
    const TRLE = window.TRLE = window.TRLE || {};

    const KINDS = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke', 'colourOverlay'];
    /* Angles are the DIRECTION of the offset in degrees, y down: 45 is down and to the right. */
    const DEFAULTS = {
        dropShadow:    { on: false, colour: '#000000', opacity: 0.75, angle: 45, distance: 6, size: 4, spread: 0 },
        innerShadow:   { on: false, colour: '#000000', opacity: 0.75, angle: 45, distance: 4, size: 3 },
        outerGlow:     { on: false, colour: '#ffd060', opacity: 0.8, size: 8, spread: 0, emit: false },
        innerGlow:     { on: false, colour: '#ffffff', opacity: 0.75, size: 6, spread: 0, emit: false },
        stroke:        { on: false, colour: '#000000', opacity: 1, width: 3, position: 'outside' },
        colourOverlay: { on: false, colour: '#ff0000', opacity: 1 },
    };
    const PREVIEW_LIMIT = 2048;   // above this an area previews at reduced size and applies at full size
    const INF = 1e9;

    const defaults = kind => Object.assign({}, DEFAULTS[kind]);
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const clone = c => { const o = mk(c.width, c.height); o.getContext('2d').drawImage(c, 0, 0); return o; };
    function hexRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const n = m ? parseInt(m[1], 16) : 0;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const wrapIx = (v, n) => ((v % n) + n) % n;

    /* ---- pixels <-> float alpha ---- */
    function alphaOf(c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, a = new Float32Array(c.width * c.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
        return a;
    }
    /* A solid colour with a per-pixel alpha, as a canvas. */
    function paint(w, h, rgb, a, mul) {
        const c = mk(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data;
        for (let i = 0; i < a.length; i++) {
            const v = a[i] * mul;
            if (v <= 0) continue;
            d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2];
            d[i * 4 + 3] = Math.round(clamp01(v) * 255);
        }
        g.putImageData(im, 0, 0);
        return c;
    }

    /* ---- blur: a Gaussian made of three box blurs, sigma in px; wrap or zero outside ----
       Integer arithmetic throughout (alpha scaled to 0..65535, every box a running sum rounded back to an integer), so a rolled layer
       gives exactly the rolled result: no float order of summation to flip a rounding. O(1) per pixel per pass, whatever the radius. */
    const Q = 65535;
    function boxWidths(sigma, n) {
        let wl = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
        if (wl % 2 === 0) wl--;
        const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
        return Array.from({ length: n }, (_, i) => Math.max(1, i < m ? wl : wu));
    }
    function boxPass(src, dst, w, h, width, wrap, horizontal) {
        const r = (width - 1) >> 1, n = width, half = n >> 1;
        if (horizontal) {
            for (let y = 0; y < h; y++) {
                const row = y * w;
                let sum = 0;
                for (let i = -r; i <= r; i++) { let x = i; if (x < 0 || x >= w) { if (!wrap) continue; x = wrapIx(x, w); } sum += src[row + x]; }
                for (let x = 0; x < w; x++) {
                    dst[row + x] = Math.floor((sum + half) / n);
                    let add = x + r + 1, sub = x - r;
                    if (add >= w) add = wrap ? wrapIx(add, w) : -1;
                    if (sub < 0) sub = wrap ? wrapIx(sub, w) : -1;
                    if (add >= 0) sum += src[row + add];
                    if (sub >= 0) sum -= src[row + sub];
                }
            }
        } else {
            const sums = new Int32Array(w);
            for (let i = -r; i <= r; i++) { let y = i; if (y < 0 || y >= h) { if (!wrap) continue; y = wrapIx(y, h); } const o = y * w; for (let x = 0; x < w; x++) sums[x] += src[o + x]; }
            for (let y = 0; y < h; y++) {
                const o = y * w;
                for (let x = 0; x < w; x++) dst[o + x] = Math.floor((sums[x] + half) / n);
                let add = y + r + 1, sub = y - r;
                if (add >= h) add = wrap ? wrapIx(add, h) : -1;
                if (sub < 0) sub = wrap ? wrapIx(sub, h) : -1;
                if (add >= 0) { const q = add * w; for (let x = 0; x < w; x++) sums[x] += src[q + x]; }
                if (sub >= 0) { const q = sub * w; for (let x = 0; x < w; x++) sums[x] -= src[q + x]; }
            }
        }
    }
    function blur(a, w, h, sigma, wrap) {
        if (!(sigma > 0.5)) return a;
        let cur = new Int32Array(a.length), tmp = new Int32Array(a.length);
        for (let i = 0; i < a.length; i++) cur[i] = Math.round(a[i] * Q);
        for (const width of boxWidths(sigma, 3)) {
            if (width <= 1) continue;
            boxPass(cur, tmp, w, h, width, wrap, true); [cur, tmp] = [tmp, cur];
            boxPass(cur, tmp, w, h, width, wrap, false); [cur, tmp] = [tmp, cur];
        }
        const out = new Float32Array(a.length);
        for (let i = 0; i < out.length; i++) out[i] = cur[i] / Q;
        return out;
    }
    /* A whole-pixel shift: a roll with wrap, else zero-filled. */
    function shift(a, w, h, dx, dy, wrap) {
        if (!dx && !dy) return a;
        const out = new Float32Array(a.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let sx = x - dx, sy = y - dy;
            if (sx < 0 || sx >= w) { if (!wrap) continue; sx = wrapIx(sx, w); }
            if (sy < 0 || sy >= h) { if (!wrap) continue; sy = wrapIx(sy, h); }
            out[y * w + x] = a[sy * w + sx];
        }
        return out;
    }

    /* ---- exact Euclidean distance transform ---- */
    /* One line of Felzenszwalb's lower envelope: f is the squared distance so far (0 at a site). */
    function edt1d(f, n, d, v, z) {
        let k = 0;
        v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < n; q++) {
            let s;
            for (;;) {
                const p = v[k];
                s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
                if (s <= z[k]) k--; else break;
            }
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            const dq = q - v[k];
            d[q] = dq * dq + f[v[k]];
        }
    }
    /* Distance in px from every pixel to the nearest pixel where `site` is 1 (0 on a site). With wrap the field is
       periodic: the mask is read modulo the area, with a pad of `cap` px so no site farther than that matters.
       Pixels with no site within the area read as INF. */
    function edt(site, w, h, wrap, cap) {
        const P = wrap ? Math.min(Math.ceil(cap) + 2, Math.max(w, h)) : 0, W = w + 2 * P, H = h + 2 * P;
        const f = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const sx = wrap ? wrapIx(x - P, w) : x, sy = wrap ? wrapIx(y - P, h) : y;
            f[y * W + x] = site[sy * w + sx] ? 0 : INF;
        }
        const n = Math.max(W, H), col = new Float32Array(n), dc = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) col[y] = f[y * W + x];
            edt1d(col, H, dc, v, z);
            for (let y = 0; y < H; y++) f[y * W + x] = dc[y];
        }
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) col[x] = f[y * W + x];
            edt1d(col, W, dc, v, z);
            for (let x = 0; x < W; x++) f[y * W + x] = dc[x];
        }
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const q = f[(y + P) * W + (x + P)];
            out[y * w + x] = q >= INF / 2 ? INF : Math.sqrt(q);
        }
        return out;
    }
    const solid = (a, w, h) => { const s = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) s[i] = a[i] >= 0.5 ? 1 : 0; return s; };
    const invert = s => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s[i] ? 0 : 1; return o; };

    /* Falloff of a glow: 1 within the spread, smooth to 0 at the size. */
    function falloff(d, size, spread) {
        if (!(size > 0)) return 0;
        const p = clamp01(spread / 100), t = d / size;
        if (t <= p) return 1;
        if (t >= 1) return 0;
        const u = (t - p) / (1 - p);
        return 1 - u * u * (3 - 2 * u);
    }
    const offsetOf = e => { const a = (e.angle || 0) * Math.PI / 180, d = e.distance || 0; return [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)]; };

    /* ---- render ---- */
    function render(src, fx, o) {
        const wrap = !!(o && o.wrap), w = src.width, h = src.height;
        const on = k => fx && fx[k] && fx[k].on ? Object.assign({}, DEFAULTS[k], fx[k]) : null;
        const E = {}; KINDS.forEach(k => { E[k] = on(k); });
        if (!KINDS.some(k => E[k])) return { image: clone(src), body: clone(src), behind: null, glow: null, emit: null };

        const srcA = alphaOf(src), sSolid = solid(srcA, w, h);
        let distIn = null, distOut = null;
        const dOut = cap => distOut || (distOut = edt(sSolid, w, h, wrap, cap));
        const dIn = cap => distIn || (distIn = edt(invert(sSolid), w, h, wrap, cap));

        // ---- body ----
        const body = clone(src), bg = body.getContext('2d');
        if (E.stroke && E.stroke.position !== 'inside') {   // outside and centre: under the content
            const st = E.stroke, wd = st.position === 'centre' ? st.width / 2 : st.width, d = dOut(wd + 1), a = new Float32Array(w * h);
            for (let i = 0; i < a.length; i++) a[i] = clamp01(wd + 1 - d[i]) * (1 - srcA[i]);   // a pixel centre at distance d is d - 0.5 px from the edge
            bg.save(); bg.globalCompositeOperation = 'destination-over';
            bg.drawImage(paint(w, h, hexRgb(st.colour), a, st.opacity), 0, 0); bg.restore();
        }
        /* Inner effects are painted with source-atop: they take the colour of what is under them and NEVER add coverage, so an anti-aliased
           edge keeps exactly its own alpha (the body's coverage is what the material region is made from). */
        bg.globalCompositeOperation = 'source-atop';
        if (E.colourOverlay) { const a = new Float32Array(w * h); for (let i = 0; i < a.length; i++) a[i] = srcA[i] > 0 ? 1 : 0; bg.drawImage(paint(w, h, hexRgb(E.colourOverlay.colour), a, E.colourOverlay.opacity), 0, 0); }
        if (E.innerGlow) {
            const g = E.innerGlow, d = dIn(g.size + 1), a = new Float32Array(w * h);
            for (let i = 0; i < a.length; i++) a[i] = srcA[i] > 0 ? falloff(sSolid[i] ? Math.max(0, d[i] - 0.5) : 0, g.size, g.spread) : 0;
            bg.drawImage(paint(w, h, hexRgb(g.colour), a, g.opacity), 0, 0);
        }
        if (E.innerShadow) {
            const s = E.innerShadow, [dx, dy] = offsetOf(s);
            const inv = new Float32Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = 1 - srcA[i];
            // The shadow is the OUTSIDE of the shape, moved and blurred, kept only where the shape is.
            const outside = blur(shift(inv, w, h, dx, dy, wrap), w, h, s.size / 2, wrap);
            const a = new Float32Array(w * h); for (let i = 0; i < a.length; i++) a[i] = srcA[i] > 0 ? outside[i] : 0;
            bg.drawImage(paint(w, h, hexRgb(s.colour), a, s.opacity), 0, 0);
        }
        if (E.stroke && E.stroke.position !== 'outside') {   // inside and centre: over the content
            const st = E.stroke, wd = st.position === 'centre' ? st.width / 2 : st.width, d = dIn(wd + 1), a = new Float32Array(w * h);
            for (let i = 0; i < a.length; i++) a[i] = srcA[i] > 0 ? clamp01(wd + 1 - (sSolid[i] ? d[i] : 0.5)) : 0;
            bg.drawImage(paint(w, h, hexRgb(st.colour), a, st.opacity), 0, 0);
        }
        bg.globalCompositeOperation = 'source-over';
        const bodyA = alphaOf(body), bSolid = solid(bodyA, w, h);

        // ---- behind: drop shadow, then outer glow, from the BODY's shape (a stroked letter casts a stroked shadow) ----
        let behind = null, glow = null, emit = null;
        if (E.dropShadow || E.outerGlow) {
            behind = mk(w, h);
            const bgc = behind.getContext('2d');
            if (E.dropShadow) {
                const s = E.dropShadow, [dx, dy] = offsetOf(s);
                let m = bodyA;
                if (s.spread > 0 && s.size > 0) {   // grow the shape first, by a share of the blur size
                    const r = s.spread / 100 * s.size, d = edt(bSolid, w, h, wrap, r + 1);
                    m = new Float32Array(w * h); for (let i = 0; i < m.length; i++) m[i] = Math.max(bodyA[i], clamp01(r + 1 - d[i]));
                }
                const a = blur(shift(m, w, h, dx, dy, wrap), w, h, s.size / 2, wrap);
                bgc.drawImage(paint(w, h, hexRgb(s.colour), a, s.opacity), 0, 0);
            }
            if (E.outerGlow) {
                const g = E.outerGlow, d = edt(bSolid, w, h, wrap, g.size + 1), a = new Float32Array(w * h);
                for (let i = 0; i < a.length; i++) a[i] = bSolid[i] ? 0 : falloff(Math.max(0, d[i] - 0.5), g.size, g.spread) * (1 - bodyA[i]);
                const gl = paint(w, h, hexRgb(g.colour), a, g.opacity);
                bgc.drawImage(gl, 0, 0);
                glow = clone(gl);
                if (g.emit) emit = clone(gl);
            }
        }
        if (E.innerGlow) {
            const g = E.innerGlow, d = dIn(g.size + 1), a = new Float32Array(w * h);
            for (let i = 0; i < a.length; i++) a[i] = srcA[i] * (sSolid[i] ? falloff(Math.max(0, d[i] - 0.5), g.size, g.spread) : 0);
            const gi = paint(w, h, hexRgb(g.colour), a, g.opacity);
            if (!glow) glow = mk(w, h);
            glow.getContext('2d').drawImage(gi, 0, 0);
            if (E.innerGlow.emit) { if (!emit) emit = mk(w, h); emit.getContext('2d').drawImage(gi, 0, 0); }
        }
        const image = mk(w, h), ig = image.getContext('2d');
        if (behind) ig.drawImage(behind, 0, 0);
        ig.drawImage(body, 0, 0);
        return { image, body, behind, glow, emit };
    }

    /* Bevel as a relief field (decision 3, text layers only): 0 outside the shape, rising to 1 at `size` px inside it with a smooth
       profile. Greyscale, opaque. The caller decides how it is used (raised or engraved) and what it multiplies. */
    function bevel(src, o) {
        const wrap = !!(o && o.wrap), size = Math.max(0.5, (o && o.size) || 3), w = src.width, h = src.height;
        const a = alphaOf(src), s = solid(a, w, h), d = edt(invert(s), w, h, wrap, size + 1);
        const c = mk(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), px = im.data;
        for (let i = 0; i < a.length; i++) {
            const t = s[i] ? clamp01(d[i] / size) : 0, v = Math.round(t * t * (3 - 2 * t) * 255);
            px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255;
        }
        g.putImageData(im, 0, 0);
        return c;
    }

    /* ---- the reduced preview (D6): above 2048 px an area previews smaller and applies at full size ---- */
    const previewFactor = (w, h, limit) => { const m = Math.max(w, h), L = limit || PREVIEW_LIMIT; return m > L ? L / m : 1; };
    function scaleFx(fx, k) {
        const out = {};
        for (const key of Object.keys(fx || {})) {
            const e = Object.assign({}, fx[key]);
            for (const p of ['distance', 'size', 'width']) if (e[p] != null) e[p] = e[p] * k;
            out[key] = e;
        }
        return out;
    }
    function renderPreview(src, fx, o) {
        const k = previewFactor(src.width, src.height, o && o.limit);
        if (k === 1) return Object.assign(render(src, fx, o), { scale: 1 });
        const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
        const small = mk(w, h), g = small.getContext('2d');
        g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
        return Object.assign(render(small, scaleFx(fx, k), o), { scale: k });
    }

    TRLE.Effects = { KINDS, DEFAULTS, PREVIEW_LIMIT, defaults, render, bevel, edt, previewFactor, scaleFx, renderPreview };
})();
