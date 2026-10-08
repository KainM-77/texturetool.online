/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License. */
/* ============================================================
   TRLE.Text: lettering for 🔤 Text… (TEXT-PLAN.md).

   render(o) draws the text into a canvas just big enough for it, its outline
   and its shadow (TEXT-PLAN D1); stamp() lays that box onto an area, and with
   wrap at the 8 neighbouring offsets too, so whatever leaves one side comes in
   at the other, outline and shadow included. That is what lets strokeText and
   a blur be used at all: neither wraps by itself, but the box does.

   Canvas2D text is always antialiased, whatever textRendering says (measured
   in the research), so the antialias modes are curves on the coverage: None
   is a 0.5 threshold, Sharp / Crisp / Strong reshape the edge, Smooth renders
   at 4x and averages down in exact 2x steps.

   Everything here is pure Canvas2D and deterministic in one browser: the same
   options give the same bytes, which the validator holds it to.
   ============================================================ */
window.TRLE = window.TRLE || {};

TRLE.Text = (function () {
    'use strict';

    const AA = ['smooth', 'sharp', 'crisp', 'strong', 'none'];
    /* Coverage curves, 0..255 in, 0..255 out. */
    const CURVES = {
        sharp: a => (a - 127.5) * 2.0 + 127.5,
        crisp: a => (a - 127.5) * 1.5 + 127.5,
        strong: a => 255 * Math.sqrt(a / 255),
        none: a => (a >= 128 ? 255 : 0),
    };

    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

    /* The CSS font for a family name: quoted, with a generic fallback, so a
       missing family falls back predictably (which is also how fontAvailable
       detects it). */
    function fontCss(o, size) {
        const fam = String(o.family || 'sans-serif').replace(/["\\]/g, '');
        const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(fam);
        return `${o.italic ? 'italic ' : ''}${o.weight || 400} ${size}px ${generic ? fam : `"${fam}", sans-serif`}`;
    }

    /* Draw one line at (x, baseline y), honouring letter spacing even where the
       browser has no ctx.letterSpacing (then glyph by glyph). */
    function drawLine(ctx, line, x, y, ls, stroke) {
        if (!ls || 'letterSpacing' in ctx) {
            if (stroke) ctx.strokeText(line, x, y); else ctx.fillText(line, x, y);
            return;
        }
        let cx = x;
        for (const ch of line) {
            if (stroke) ctx.strokeText(ch, cx, y); else ctx.fillText(ch, cx, y);
            cx += ctx.measureText(ch).width + ls;
        }
    }
    function lineWidth(ctx, line, ls) {
        if (!ls || 'letterSpacing' in ctx) return ctx.measureText(line).width;
        let w = 0;
        for (const ch of line) w += ctx.measureText(ch).width + ls;
        return w;
    }

    /* Average a canvas down by 2 exactly (a 2x2 box), `n` times. */
    function halve(c, n) {
        let cur = c;
        for (let i = 0; i < n; i++) {
            const t = mk(cur.width / 2, cur.height / 2), x = t.getContext('2d');
            x.imageSmoothingEnabled = true;
            x.imageSmoothingQuality = 'low';   // an exact half: bilinear IS the 2x2 box
            x.drawImage(cur, 0, 0, t.width, t.height);
            cur = t;
        }
        return cur;
    }

    /* Alpha of a white-on-clear canvas, as a Uint8ClampedArray. */
    function alphaOf(c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const a = new Uint8ClampedArray(c.width * c.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
        return a;
    }
    function curve(a, aa) {
        const f = CURVES[aa];
        if (!f) return a;
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.min(255, Math.round(f(a[i]))));
        return a;
    }

    /* Separable box blur, three passes (close to a gaussian), on an alpha array.
       Our own rather than ctx.filter, which not every browser has on a canvas
       and whose edges differ between those that do. */
    function blurAlpha(a, w, h, radius) {
        const r = Math.max(0, Math.round(radius));
        if (!r) return a;
        let src = Float32Array.from(a), dst = new Float32Array(a.length);
        const pass = (horiz) => {
            const n = horiz ? w : h, m = horiz ? h : w, k = 2 * r + 1;
            for (let j = 0; j < m; j++) {
                let s = 0;
                const at = i => { const ii = Math.max(0, Math.min(n - 1, i)); return horiz ? src[j * w + ii] : src[ii * w + j]; };
                for (let i = -r; i <= r; i++) s += at(i);
                for (let i = 0; i < n; i++) {
                    if (horiz) dst[j * w + i] = s / k; else dst[i * w + j] = s / k;
                    s += at(i + r + 1) - at(i - r);
                }
            }
            [src, dst] = [dst, src];
        };
        for (let p = 0; p < 3; p++) { pass(true); pass(false); }
        const out = new Uint8ClampedArray(a.length);
        for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i]);
        return out;
    }

    function hexRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const n = m ? parseInt(m[1], 16) : 0;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    /* Render. o: { text, family, weight, italic, size, lineHeight, letterSpacing,
       kerning, align ('left' | 'center' | 'right'), rotation (degrees), aa,
       fill ('#rrggbb'), outline: { width, color } | null,
       shadow: { dx, dy, blur, color, opacity } | null }.
       Returns { canvas, fill, cover, w, h, ax, ay }: the coloured box, the
       letters' coverage and letters + outline coverage (alpha arrays, w x h),
       and where the text's centre sits in the box (the point stamp() places), plus
       tw x th, the text block's own size before it is turned, and its rotation in
       degrees: the frame the transform handles draw. */
    function render(o) {
        const aa = AA.includes(o.aa) ? o.aa : 'smooth';
        const size = Math.max(1, +o.size || 32);
        const lines = String(o.text == null ? '' : o.text).replace(/\r/g, '').split('\n');
        const ls = +o.letterSpacing || 0;
        const ow = o.outline && o.outline.width > 0 ? +o.outline.width : 0;
        const sh = o.shadow && (o.shadow.opacity > 0) ? o.shadow : null;

        // Measure at 1x.
        const meas = mk(1, 1).getContext('2d');
        meas.font = fontCss(o, size);
        if ('letterSpacing' in meas) meas.letterSpacing = ls + 'px';
        if ('fontKerning' in meas) meas.fontKerning = o.kerning === false ? 'none' : 'normal';
        const m = meas.measureText('Hgjy|ÁÉ');
        const asc = Math.ceil(m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || size * 0.8);
        const desc = Math.ceil(m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || size * 0.25);
        const adv = size * (o.lineHeight || 1.2);
        const widths = lines.map(l => lineWidth(meas, l, ls));
        const bw = Math.max(1, ...widths), bh = asc + desc + adv * (lines.length - 1);
        // Stretch (the transform handles' free resize): the block scaled along its own
        // axes before it is turned. 1 and 1 changes nothing, byte for byte.
        const sx = Math.max(0.05, +o.scaleX || 1), sy = Math.max(0.05, +o.scaleY || 1);

        // The rotated block's bounding box, plus room for the outline and shadow.
        const t = (+o.rotation || 0) * Math.PI / 180, cs = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
        const rw = bw * sx * cs + bh * sy * sn, rh = bw * sx * sn + bh * sy * cs;
        // Room for the outline, the shadow and a relief bevel (blurred out later by
        // the caller, so its reach must already be inside the box).
        const pad = Math.ceil(ow * Math.max(sx, sy) + 2 + (sh ? Math.max(Math.abs(sh.dx), Math.abs(sh.dy)) + 3 * Math.max(0, sh.blur) : 0) + 3 * Math.max(0, +o.bevel || 0));
        const w = Math.ceil(rw) + 2 * pad, h = Math.ceil(rh) + 2 * pad;
        const ax = w / 2, ay = h / 2;
        // Smooth's 4x, as far as a canvas side allows (a long line at a big size).
        let k = aa === 'smooth' ? 4 : 1;
        while (k > 1 && Math.max(w, h) * k > 8192) k /= 2;

        // Letters and outline as white coverage, at k x.
        const draw = (strokeIt) => {
            const c = mk(w * k, h * k), x = c.getContext('2d');
            x.font = fontCss(o, size * k);
            if ('letterSpacing' in x) x.letterSpacing = (ls * k) + 'px';
            if ('fontKerning' in x) x.fontKerning = o.kerning === false ? 'none' : 'normal';
            x.textBaseline = 'alphabetic';
            x.textAlign = 'left';
            x.fillStyle = '#fff'; x.strokeStyle = '#fff';
            x.lineJoin = 'round'; x.lineCap = 'round'; x.miterLimit = 2;
            x.lineWidth = 2 * ow * k;   // centred on the edge: ow outside it
            x.translate(ax * k, ay * k);
            x.rotate(t);
            x.scale(sx, sy);
            lines.forEach((line, i) => {
                const lw = widths[i];
                const lx = o.align === 'right' ? bw / 2 - lw : o.align === 'left' ? -bw / 2 : -lw / 2;
                const y = -bh / 2 + asc + adv * i;
                if (strokeIt) drawLine(x, line, lx * k, y * k, ls * k, true);
                drawLine(x, line, lx * k, y * k, ls * k, false);
            });
            return k > 1 ? halve(c, Math.log2(k)) : c;
        };
        const fill = curve(alphaOf(draw(false)), aa);
        const cover = ow ? curve(alphaOf(draw(true)), aa) : fill;
        for (let i = 0; i < cover.length; i++) if (cover[i] < fill[i]) cover[i] = fill[i];

        // Colour: shadow (cover, offset, blurred), then outline, then fill.
        const canvas = mk(w, h), cx = canvas.getContext('2d'), img = cx.createImageData(w, h), d = img.data;
        const put = (alpha, rgb, op) => {
            for (let i = 0; i < alpha.length; i++) {
                const a = alpha[i] / 255 * op;
                if (a <= 0) continue;
                const j = i * 4, da = d[j + 3] / 255, oa = a + da * (1 - a);
                for (let c = 0; c < 3; c++) d[j + c] = Math.round((rgb[c] * a + d[j + c] * da * (1 - a)) / oa);
                d[j + 3] = Math.round(oa * 255);
            }
        };
        if (sh) {
            const moved = new Uint8ClampedArray(cover.length), dx = Math.round(sh.dx), dy = Math.round(sh.dy);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const sx = x - dx, sy = y - dy;
                if (sx >= 0 && sy >= 0 && sx < w && sy < h) moved[y * w + x] = cover[sy * w + sx];
            }
            put(blurAlpha(moved, w, h, sh.blur), hexRgb(sh.color), Math.max(0, Math.min(1, sh.opacity)));
        }
        if (ow) put(cover, hexRgb(o.outline.color), 1);
        put(fill, hexRgb(o.fill), 1);
        cx.putImageData(img, 0, 0);
        return { canvas, fill, cover, w, h, ax, ay, tw: bw * sx, th: bh * sy, rot: t / (Math.PI / 180) };
    }

    /* Lay a box onto a W x H area so its centre lands on (x, y) (rounded to
       whole pixels, so hard-edged text stays hard), source-over. With wrap,
       every copy one area apart that reaches the area. `what` is the box's canvas or any
       same-size canvas made from it (a coverage mask). */
    function stamp(ctx, box, what, x, y, W, H, wrap) {
        let px = Math.round(x - box.ax), py = Math.round(y - box.ay);
        if (!wrap) { ctx.drawImage(what, px, py); return; }
        /* Reduced into the area first, so a position a whole tile (or several)
           off lands the same; then every copy that reaches the area, which is
           more than 3 x 3 when the text is wider or taller than the area. */
        px = ((px % W) + W) % W; py = ((py % H) + H) % H;
        for (let j = -Math.ceil((py + box.h) / H); j <= 0; j++)
            for (let i = -Math.ceil((px + box.w) / W); i <= 0; i++) ctx.drawImage(what, px + i * W, py + j * H);
    }

    /* A coverage array as a white-on-clear canvas (for stamping masks). */
    function maskCanvas(box, alpha) {
        const c = mk(box.w, box.h), x = c.getContext('2d'), img = x.createImageData(box.w, box.h);
        for (let i = 0; i < alpha.length; i++) { const j = i * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = 255; img.data[j + 3] = alpha[i]; }
        x.putImageData(img, 0, 0);
        return c;
    }

    /* Is a family installed (or loaded)? document.fonts.check() says yes even for
       a missing one, so measure: a real family changes the width against at
       least one of two different fallbacks. */
    function fontAvailable(family, weight, italic) {
        const fam = String(family || '').replace(/["\\]/g, '');
        if (!fam) return false;
        if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(fam)) return true;
        const x = mk(1, 1).getContext('2d'), probe = 'mmmmmmmmmmlli1WQ@#';
        const st = `${italic ? 'italic ' : ''}${weight || 400} 72px `;
        return ['monospace', 'serif'].some(fb => {
            x.font = st + fb; const base = x.measureText(probe).width;
            x.font = st + `"${fam}", ${fb}`; return x.measureText(probe).width !== base;
        });
    }

    return { AA, render, stamp, maskCanvas, blurAlpha, fontAvailable, fontCss };
})();
