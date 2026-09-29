/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — Animated Texture Particle Generator

   The second generator behind the Animated Texture modal, beside
   the animNoise field in js/animgen.js. `animNoise` makes a FIELD;
   this makes PARTICLES — rain, drizzle, snow, ash, sparks, embers,
   bubbles, drips. fBm cannot give straight streaks, an honest
   particle count, or a slant, and those three are the whole point.

   TWO GUARANTEES, both exact by construction rather than tuned:

   1. THE LOOP CLOSES. Every particle's velocity is a whole number
      of tiles per loop, and its position is wrapped with fract()
      before it is drawn. Position at t=1 is therefore position at
      t=0, so frame N equals frame 0 bit for bit. The optional sway
      and gust envelopes take INTEGER cycles per loop for the same
      reason. This is why the slant control offers a ladder of
      integer direction pairs and not an arbitrary angle: an
      arbitrary angle would have to quantise anyway to keep this
      property, just less legibly.

   2. THE TILE WRAPS, AT EVERY SLANT. Not by drawing each particle
      with a ring of neighbour copies — that needs a cull pad of
      ceil(streakLength / S) + 1 and silently breaks when the pad
      is short, which is the trap already documented for Build
      Pattern. Instead the WRITE INDEX wraps. There is no pad, no
      cull, and no way to get either wrong.

      Measured (see ANIMATED-OVERLAY-PLAN.md §1.2): with the copy
      ring at pad 1 the roll test failed at every diagonal slant
      (103-216 / 255) while the two AXIS-ALIGNED slants passed
      anyway, because an axis-aligned streak only overhangs one
      axis. A test that only tried vertical rain would have
      certified a broken implementation. Wrapping the write index
      scores 0.0000 across 11 slants x 2 streak lengths.

   Depends on TRLE.AnimGen for the shared clamps and the ramp
   builder only. No WebGL: this is CPU float maths into one
   ImageData, which is also what makes "same params, same pixels"
   hold without caring how a driver rasterises.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimParticles = (function () {
    'use strict';

    /* A high count is a real request (a downpour is thousands of drops at a
       distance), but cost is linear in it, so this is the guard against a typo
       stalling the tab. */
    const LIMITS = { MAX_COUNT: 2000 };

    const DEFAULTS = {
        generator: 'particles',
        size: 256,
        frames: 16,
        seed: 0,
        supersample: 1,

        count: 220,         // particles per tile
        dirX: 0, dirY: 1,   // INTEGER direction pair; tiles travelled per loop = dir * speed
        speed: 3,           // base whole-tiles-per-loop multiplier
        speedSpread: 2,     // per-particle extra in [0, speedSpread) -> parallax
        length: 1.5,        // motion blur: 1 = exactly the distance covered in one frame
        width: 1.6,         // half-width in px at a 256 tile; scales with size
        taper: 0.65,        // 0 = even along the streak, 1 = fades to nothing at the tail
        brightJitter: 0.55, // per-particle brightness spread
        depthScale: 0,      // 0 = every particle the same size; >0 sizes+dims by depth
        defocus: 0,          // 0 = all sharp; >0 blurs the far depth bands, in px at 256
        sway: 0,            // lateral drift amplitude in tiles (snow, ash)
        swayCycles: 1,      // INTEGER sway cycles per loop, or the loop stops closing
        gustCycles: 0,      // 0 = steady; >0 pulses the whole field's brightness
        gustDepth: 0,
        twinkle: 0,         // 0 = steady; >0 each particle flashes over the loop
        twinkleCycles: 2,   // INTEGER base flashes per loop (each particle: c to 2c-1)

        palette: null,
        colorAdjust: null
    };

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const fract = v => v - Math.floor(v);

    /* Own copy: atlas.js's mulberry32 lives inside its IIFE, and animgen.js is
       self-contained for the same reason. */
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* The direction ladder. Every entry is a pair of small integers, so the
       velocity stays whole tiles per loop and the loop closes (see the header).
       Angles are measured from straight down, which is how rain is described. */
    const DIRS = [
        { key: 'down',    dx: 0,  dy: 1, label: '↓ Straight down (0°)' },
        { key: 'd14r',    dx: 1,  dy: 4, label: '↘ Slight, right (14°)' },
        { key: 'd14l',    dx: -1, dy: 4, label: '↙ Slight, left (14°)' },
        { key: 'd18r',    dx: 1,  dy: 3, label: '↘ Light slant, right (18°)' },
        { key: 'd18l',    dx: -1, dy: 3, label: '↙ Light slant, left (18°)' },
        { key: 'd27r',    dx: 1,  dy: 2, label: '↘ Windy, right (27°)' },
        { key: 'd27l',    dx: -1, dy: 2, label: '↙ Windy, left (27°)' },
        { key: 'd34r',    dx: 2,  dy: 3, label: '↘ Strong wind, right (34°)' },
        { key: 'd34l',    dx: -2, dy: 3, label: '↙ Strong wind, left (34°)' },
        { key: 'd45r',    dx: 1,  dy: 1, label: '↘ Driving, right (45°)' },
        { key: 'd45l',    dx: -1, dy: 1, label: '↙ Driving, left (45°)' },
        { key: 'up',      dx: 0,  dy: -1, label: '↑ Rising (sparks, bubbles)' },
        { key: 'u18r',    dx: 1,  dy: -3, label: '↗ Rising, drifting right' },
        { key: 'u18l',    dx: -1, dy: -3, label: '↖ Rising, drifting left' },
        { key: 'right',   dx: 1,  dy: 0, label: '→ Sideways, right' },
        { key: 'left',    dx: -1, dy: 0, label: '← Sideways, left' }
    ];
    const dirByKey = k => DIRS.find(d => d.key === k) || DIRS[0];
    /* Inverse, for restoring a saved recipe onto the picker. Matches on the
       reduced pair so a legacy or hand-edited (2,6) still finds (1,3). */
    function dirKeyFor(dx, dy) {
        dx = dx | 0; dy = dy | 0;
        const g = (a, b) => (b ? g(b, a % b) : Math.abs(a)) || 1;
        const k = g(dx, dy);
        const rx = dx / k, ry = dy / k;
        const hit = DIRS.find(d => d.dx === rx && d.dy === ry);
        return hit ? hit.key : 'down';
    }

    /* Global brightness envelope over the loop — "downpour in waves". Same
       raised cosine as the Glow tab's pulse, and periodic in k for the same
       reason: it peaks at t=0 so the loop point is not a visible edge. */
    function gustFactor(p, t) {
        if (!p.gustCycles || !p.gustDepth) return 1;
        const depth = clamp(p.gustDepth, 0, 1);
        const cycles = Math.max(1, Math.round(p.gustCycles));
        const s = (Math.cos(2 * Math.PI * cycles * t) + 1) / 2;
        return (1 - depth) + depth * s;
    }

    /* Wrapped box blur over an intensity field, three passes (a good enough
       gaussian), running sum so it is O(1) per pixel whatever the radius.

       On the FIELD and not on a canvas, which is the same rule supersampling
       already follows here: a canvas stores premultiplied colour, so reading it
       back scales rounding noise toward white at low alpha — and a streak's
       edge is exactly that case. It is also why there is no apron: the field is
       toroidal already, so the window wraps with a modulo and the result stays
       toroidal by construction.

       Blur does not threaten either guarantee. It is applied identically to
       every frame, so if frame N equalled frame 0 it still does; and a wrapped
       blur of a toroidal field is toroidal. Both remain asserted exactly. */
    function boxBlurField(src, R, radius) {
        const r = Math.min(Math.floor((R - 1) / 2), Math.round(radius));
        if (r < 1) return src;
        const n = 2 * r + 1, inv = 1 / n;
        let a = src, b = new Float32Array(src.length);
        for (let pass = 0; pass < 3; pass++) {
            // horizontal
            for (let y = 0; y < R; y++) {
                const row = y * R;
                let sum = 0;
                for (let k = -r; k <= r; k++) sum += a[row + (((k % R) + R) % R)];
                for (let x = 0; x < R; x++) {
                    b[row + x] = sum * inv;
                    sum += a[row + ((x + r + 1) % R)] - a[row + ((((x - r) % R) + R) % R)];
                }
            }
            let t = a; a = b; b = t;
            // vertical
            for (let x = 0; x < R; x++) {
                let sum = 0;
                for (let k = -r; k <= r; k++) sum += a[(((k % R) + R) % R) * R + x];
                for (let y = 0; y < R; y++) {
                    b[y * R + x] = sum * inv;
                    sum += a[((y + r + 1) % R) * R + x] - a[((((y - r) % R) + R) % R) * R + x];
                }
            }
            t = a; a = b; b = t;
        }
        return a;
    }

    /* How many depth bands to rasterise into. One unless depth is actually in
       use, so the common path allocates exactly what it always did.

       The band count is `Depth spread` itself: that control already sorts
       particles into that many integer speed bands, and the band index IS the
       speed offset, so nothing new has to be decided or stored. Max-blending
       N bands and then taking the max is identical to max-blending one buffer
       — max is associative — so bands alone change no pixels. Only the blur
       and the size coupling do, and both are zero by default. */
    const depthBands = p => (p.defocus > 0 || p.depthScale > 0)
        ? Math.max(1, Math.round(p.speedSpread)) : 1;

    /* One streak: a CAPSULE, every pixel scored by its distance to the segment
       from the head (hx, hy) back along -(nx, ny) for L px.

       Until 2026-09-24 this stamped cones (1 - d/w) every w/2 px along the
       segment and max-blended them, so the centreline dipped to 75% of peak
       midway between stamps. At w <= 2.2 the stride is a pixel or less and the
       dip is invisible; at rain_glass's w = 4.5 it was a 2.25 px stride and the
       streaks came out visibly BEADED (ANIMATED-OVERLAY-PLAN.md, "Found in
       phase E"). Distance to the segment has no stride, so there is nothing to
       bead at any width, and it visits each pixel once instead of once per
       overlapping stamp. The author accepted that this moves the pixels of
       every saved particle animation.

       u is the pixel's projection onto the segment, 0 at the head and 1 at the
       tail, clamped, so `taper` keeps exactly its old meaning and the end caps
       are the same round discs the stamps drew.

       Rows are walked over the capsule's x-extent (the segment's x across the
       rows it can reach, +/- w), never its bounding box: a diagonal streak's
       box is ~97% empty (§1.2, 592 ms vs 126 ms). Max-blend, not additive:
       overlapping streaks cannot blow out to white, and the result does not
       depend on draw order, which is half of why the same params give the
       same pixels. The write index wraps, so the tile wraps at every slant. */
    function rasterCapsule(buf, R, hx, hy, nx, ny, L, w, bright, taper) {
        const w2 = w * w;
        const tx = hx - nx * L, ty = hy - ny * L;      // tail
        const yLo = Math.ceil(Math.min(hy, ty) - w), yHi = Math.floor(Math.max(hy, ty) + w);
        const dy = ty - hy;                             // segment y-extent (signed)
        const invL2 = L > 0 ? 1 / (L * L) : 0;
        for (let gy = yLo; gy <= yHi; gy++) {
            // The part of the segment within w of this row, as a u range.
            let u0 = 0, u1 = 1;
            if (Math.abs(dy) > 1e-9) {
                const a = (gy - w - hy) / dy, b = (gy + w - hy) / dy;
                u0 = Math.max(0, Math.min(a, b)); u1 = Math.min(1, Math.max(a, b));
                if (u0 > u1) continue;
            } else if (Math.abs(gy - hy) > w) continue;
            const xa = hx - nx * L * u0, xb = hx - nx * L * u1;
            const xLo = Math.ceil(Math.min(xa, xb) - w), xHi = Math.floor(Math.max(xa, xb) + w);
            const row = (((gy % R) + R) % R) * R;
            const qy = gy - hy;
            for (let gx = xLo; gx <= xHi; gx++) {
                const qx = gx - hx;
                // Projection onto the head->tail direction, as a fraction of L.
                let u = L > 0 ? -(qx * nx + qy * ny) * L * invL2 : 0;
                u = u < 0 ? 0 : u > 1 ? 1 : u;
                const ex = qx + nx * L * u, ey = qy + ny * L * u;
                const d2 = ex * ex + ey * ey;
                if (d2 >= w2) continue;
                const a = (1 - Math.sqrt(d2) / w) * bright * (1 - taper * u);
                if (a <= 0) continue;
                const k = row + (((gx % R) + R) % R);
                if (a > buf[k]) buf[k] = a;
            }
        }
    }

    /* One frame's intensity field at phase t, rendered at R x R. */
    function renderField(t, p, R) {
        const bands = depthBands(p);
        const bufs = [];
        for (let b = 0; b < bands; b++) bufs.push(new Float32Array(R * R));
        const rnd = mulberry32(((p.seed >>> 0) ^ 0x9e3779b9) >>> 0);
        /* Twinkle's own stream. The main one pulls exactly five draws per
           particle and that count is load-bearing (see below), so a sixth would
           re-roll every saved seed. A second stream seeded off the same seed, the
           way Build Pattern's deformation keeps `drng` apart from its layout rng,
           leaves positions, speeds and brightness bit for bit where they were. */
        const twk = clamp(+p.twinkle || 0, 0, 1);
        const trnd = twk > 0 ? mulberry32(((p.seed >>> 0) ^ 0x5bd1e995) >>> 0) : null;
        const tc = Math.max(1, Math.round(p.twinkleCycles || 1));
        const dl = Math.hypot(p.dirX, p.dirY) || 1;
        const nx = p.dirX / dl, ny = p.dirY / dl;
        const gust = gustFactor(p, t);
        const w0 = Math.max(0.5, p.width * (R / 256));
        const N = Math.max(1, p.frames);
        const spread = Math.max(1, Math.round(p.speedSpread));
        const count = clamp(Math.round(p.count), 0, LIMITS.MAX_COUNT);

        for (let i = 0; i < count; i++) {
            /* Five draws per particle, ALWAYS, whatever the params — the same
               discipline bpCell keeps. Pulling a different number when sway is
               off would re-roll every seed the moment someone touches it.

               The third draw is the DEPTH draw, and the UI has always called it
               that ("Depth spread"). It used to be consumed inline by the floor;
               naming the raw value costs nothing, leaves `sp` bit for bit what
               it was, and is what lets size, brightness and blur hang off depth
               without a sixth draw re-rolling every seed anyone has saved. */
            const x0 = rnd(), y0 = rnd();
            const zr = rnd();                                   // 0 = furthest, 1 = nearest
            const sp = p.speed + Math.floor(zr * spread);
            const bj = rnd(), phase = rnd();

            /* One factor for size and brightness both, so there is no second
               constant to justify: at depthScale 1 the furthest particle is
               half the size and half the brightness of the nearest, and at 0
               this is exactly 1 and the output is byte-identical. Brightness is
               capped at 1 so the near end stays where it was rather than
               getting a free boost. */
            const dz = 1 + p.depthScale * (2 * zr - 1);
            const w = Math.max(0.5, w0 * dz);
            const bi = bands > 1 ? Math.min(bands - 1, Math.floor(zr * spread)) : 0;
            const buf = bufs[bi];

            const vx = p.dirX * sp, vy = p.dirY * sp;          // whole tiles per loop
            let sx = 0, sy = 0;
            if (p.sway) {
                // Perpendicular to travel, integer cycles -> returns to 0 at t=1.
                const a = p.sway * Math.sin(2 * Math.PI * (Math.max(1, Math.round(p.swayCycles)) * t + phase));
                sx = -ny * a; sy = nx * a;
            }
            const hx = fract(x0 + vx * t + sx) * R;
            const hy = fract(y0 + vy * t + sy) * R;

            let bright = gust * ((1 - p.brightJitter) + p.brightJitter * bj)
                         * (p.depthScale ? Math.min(1, dz) : 1);
            /* Twinkle: each particle flashes an INTEGER number of times per loop
               (tc to 2*tc - 1, so they drift in and out of step), which is what
               keeps frame N equal to frame 0. The raised cosine is SQUARED so a
               particle spends most of the loop dim and flashes briefly; a plain
               cosine reads as a slow throb, not a sparkle. Two draws per particle
               whatever happens after, so the stream never goes out of step. */
            if (trnd) {
                const ci = tc + Math.floor(trnd() * tc), ph = trnd();
                const c = (1 + Math.cos(2 * Math.PI * (ci * t + ph))) / 2;
                bright *= (1 - twk) + twk * c * c;
            }
            if (bright <= 0) continue;
            // Motion blur follows speed, which is what makes the parallax read.
            const L = Math.hypot(vx, vy) * R * p.length / N;
            rasterCapsule(buf, R, hx, hy, nx, ny, L, w, bright, p.taper);
        }
        /* The radius is in R-space, so it scales with supersampling for free:
           at f=2 the field is twice the size and the blur twice as wide, and
           boxDownField halves both again. */
        const px = p.defocus * (R / 256);
        // Depth spread 1 is a single plane, so there is no near/far to grade
        // between — defocus then means "soften all of it", not nothing. A
        // control that silently does nothing at one setting of another control
        // is the dead-slider shape.
        if (bands === 1) return px > 0 ? boxBlurField(bufs[0], R, px) : bufs[0];
        // Furthest band takes the whole defocus, nearest none.
        const out = new Float32Array(R * R);
        for (let b = 0; b < bands; b++) {
            const f = boxBlurField(bufs[b], R, px * (bands - 1 - b) / (bands - 1));
            for (let i = 0; i < out.length; i++) if (f[i] > out[i]) out[i] = f[i];
        }
        return out;
    }

    /* Box-average the INTENSITY field from R² down to S², before it is coloured.

       Deliberately not AnimGen's boxDown, which averages a finished canvas.
       A canvas stores premultiplied colour, so getImageData un-premultiplies and
       at low alpha scales rounding noise toward white — the trap that has bitten
       Build Pattern's joint colours and the colour-tools measurements. A streak's
       edge is exactly that: low alpha. Averaging the scalar field first sidesteps
       premultiplication entirely, is cheaper, and still averages whole f x f
       blocks, so tiling and looping survive it as they do for the noise path. */
    function boxDownField(src, S, f) {
        if (f <= 1) return src;
        const R = S * f, out = new Float32Array(S * S), n = f * f;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                let acc = 0;
                for (let j = 0; j < f; j++) {
                    let p = (y * f + j) * R + x * f;
                    for (let i = 0; i < f; i++, p++) acc += src[p];
                }
                out[y * S + x] = acc / n;
            }
        }
        return out;
    }

    /* Intensity -> RGBA through the same 256-px ramp the noise path uses, so the
       Colour tab (gradient, stops, hue/sat/contrast/gamma/posterize) applies
       unchanged. A particle field is mostly zero, so stop 0's ALPHA is what
       decides whether the tile is transparent between the drops — which is the
       whole reason rain can go over a window. */
    function colorise(field, S, ramp) {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        const im = ctx.createImageData(S, S), d = im.data;
        for (let i = 0; i < field.length; i++) {
            const v = field[i];
            const q = (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)) * 4;
            const o = i * 4;
            d[o] = ramp[q]; d[o + 1] = ramp[q + 1]; d[o + 2] = ramp[q + 2]; d[o + 3] = ramp[q + 3];
        }
        ctx.putImageData(im, 0, 0);
        return c;
    }

    /* The 256x1 ramp as a flat byte array. Falls back to black->white so a
       particle preset with no palette still renders something sane. */
    function rampBytes(p) {
        const stops = (p.palette && p.palette.length)
            ? p.palette
            : [{ pos: 0, color: [0, 0, 0, 0] }, { pos: 1, color: [255, 255, 255, 255] }];
        const c = TRLE.AnimGen.buildRamp(stops, p.colorAdjust);
        return c.getContext('2d').getImageData(0, 0, 256, 1).data;
    }

    /* Generate the looping sequence. Same contract as AnimGen.generateFrames:
       N canvases of size², deterministic, spatially toroidal, exactly looping. */
    function generateFrames(params) {
        const p = Object.assign({}, DEFAULTS, params);
        const S = TRLE.AnimGen.clampSize(p.size);
        const N = TRLE.AnimGen.clampFrames(p.frames);
        const f = TRLE.AnimGen.ssFactor(S, p.supersample);
        p.frames = N;

        const ramp = rampBytes(p);
        const frames = [];
        for (let i = 0; i < N; i++) {
            frames.push(colorise(boxDownField(renderField(i / N, p, S * f), S, f), S, ramp));
        }
        return frames;
    }

    /* NO COST ESTIMATOR AND NO PROGRESS BAR LIVE HERE, and both absences were
       decided by measurement rather than taste.

       A closed-form estimator was written and scored against the real renderer
       over all eight presets at two sizes: it under-predicted by 2x to 10x
       (worst ratio 28x). Cost turns on how much consecutive stamps OVERLAP,
       which is not available in closed form, and a number that wrong is worse
       than no number when it is what decides whether to show a bar.

       The bar itself then turned out to be machinery for a case that does not
       exist. The modal preview is capped at 256 px (PREVIEW_CAP), and after the
       rasteriser was tightened the HEAVIEST preset renders 16 frames at 256 in
       ~64 ms — inside the existing 110 ms anScheduleRegen debounce. Adding to
       the atlas at 1024 is ~608 ms for that preset, which is a single click,
       not a drag.

       What remains is an ADVISORY, the way anResNote and heightEdgeBandFor are
       advisories: the modal times the preview frame it had to render anyway and
       says what the real tile size will cost. No chunking, no async, no bar. */

    return { generateFrames, DIRS, dirByKey, dirKeyFor, DEFAULTS, LIMITS,
             /* test-only surfaces, so a validator can score the field itself
                rather than inferring it back out of a coloured canvas. */
             _renderField: renderField, _boxDownField: boxDownField,
             _blurField: boxBlurField };
})();
