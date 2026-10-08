/* TRLE.Handles: transform handles on an oriented box, as in Photoshop's Free
   Transform. A PRIMITIVE: it knows nothing about text or tiles. The caller says
   where the box is (centre, size, rotation, in the canvas's own pixels) and gets
   a new box back as the user drags; what the box MEANS is the caller's business.

   The modern Photoshop convention (since 2019; STICKERS-PLAN D3, author
   2026-10-07), for every client:
     8 handles   corners and sides, resizing in the box's own (rotated) axes
     corner      keeps the proportions; Shift frees them
     side        stretches its one axis, always
     rotate      the zone just outside a corner; Shift snaps to 15 degrees
     move        a drag anywhere else (moveAnywhere, on by default)
     Alt         resize from the centre; Alt held when a drag STARTS inside
                 the box duplicates it first (onDuplicate, when the client has one)

   Pure maths (resize / rotate / hit) is exported for tests; attach() wires the
   pointer events of one canvas; draw() paints the frame. No dependencies. */
TRLE.Handles = (function () {
    const D2R = Math.PI / 180, SNAP = 15, MIN = 2;

    const rot = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
    /* a canvas point into the box's local frame (origin at its centre, axes turned with it) */
    const toLocal = (b, px, py) => rot(px - b.cx, py - b.cy, -b.rot * D2R);
    const toWorld = (b, lx, ly) => { const [x, y] = rot(lx, ly, b.rot * D2R); return [b.cx + x, b.cy + y]; };

    /* The eight handles, as [hx, hy] unit offsets from the centre. */
    const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

    /* `start` resized by dragging handle (hx, hy) to canvas point p. Anchor is the
       opposite handle, or the centre with Alt. A corner keeps the start's proportions
       unless Shift is held, following the larger of the two factors; a side changes
       its one axis. `mods.keep` (true / false) overrides the convention, for a caller
       that has to. A box never flips and never goes under MIN.
       Returns { cx, cy, w, h, rot, fx, fy, keep }: fx, fy are the size factors. */
    function resize(start, hx, hy, p, mods) {
        mods = mods || {};
        const keep = mods.keep !== undefined ? !!mods.keep : !!(hx && hy && !mods.shift);
        const [qx, qy] = toLocal(start, p[0], p[1]);
        const w0 = start.w, h0 = start.h;
        const ax = mods.alt ? 0 : -hx * w0 / 2, ay = mods.alt ? 0 : -hy * h0 / 2;
        const span = (q, a, h) => mods.alt ? Math.max(MIN, 2 * h * q) : Math.max(MIN, h * (q - a));
        let w = hx ? span(qx, ax, hx, w0) : w0, h = hy ? span(qy, ay, hy, h0) : h0;
        if (keep) {
            const f = hx && hy ? Math.max(w / w0, h / h0) : hx ? w / w0 : h / h0;
            w = Math.max(MIN, w0 * f); h = Math.max(MIN, h0 * f);
        }
        // Where the new centre sits, in the START frame.
        const lx = mods.alt || !hx ? 0 : ax + hx * w / 2, ly = mods.alt || !hy ? 0 : ay + hy * h / 2;
        const [cx, cy] = toWorld(start, lx, ly);
        return { cx, cy, w, h, rot: start.rot, fx: w / w0, fy: h / h0, keep };
    }

    /* `start` turned so the handle the drag began on follows the pointer. `from`
       is the canvas point the drag began at. Shift snaps the RESULT to 15 degrees.
       Result is in [-180, 180]. */
    function rotate(start, from, p, mods) {
        const a0 = Math.atan2(from[1] - start.cy, from[0] - start.cx), a1 = Math.atan2(p[1] - start.cy, p[0] - start.cx);
        let r = start.rot + (a1 - a0) / D2R;
        if (mods && mods.shift) r = Math.round(r / SNAP) * SNAP;
        r = ((r + 180) % 360 + 360) % 360 - 180;
        return Object.assign({}, start, { rot: r });
    }

    /* What a pointer at canvas point p is over. `hs` is the handle's half-size in
       canvas px; rotate zones reach `rz` past a corner handle.
       { kind: 'resize', hx, hy } | { kind: 'rotate', hx, hy } | { kind: 'move' } | null */
    function hit(b, p, hs, rz) {
        if (!b) return null;
        rz = rz || hs * 3;
        const [qx, qy] = toLocal(b, p[0], p[1]);
        // Side handles of a box too small to carry them would sit on the corners.
        const sides = b.w > hs * 6 && b.h > hs * 6;
        for (const [hx, hy] of HANDLES) {
            if (!sides && (!hx || !hy)) continue;
            if (Math.abs(qx - hx * b.w / 2) <= hs && Math.abs(qy - hy * b.h / 2) <= hs) return { kind: 'resize', hx, hy };
        }
        const inside = Math.abs(qx) <= b.w / 2 && Math.abs(qy) <= b.h / 2;
        if (!inside) {
            for (const [hx, hy] of HANDLES) {
                if (!hx || !hy) continue;
                if (Math.hypot(qx - hx * b.w / 2, qy - hy * b.h / 2) <= rz) return { kind: 'rotate', hx, hy };
            }
        }
        return { kind: 'move', inside };
    }

    /* The CSS cursor for a hit: a resize arrow turned to the handle's real direction. */
    function cursorFor(h, b) {
        if (!h) return 'default';
        if (h.kind === 'move') return 'move';
        if (h.kind === 'rotate') return 'grab';
        const ang = (Math.atan2(h.hy, h.hx) / D2R + b.rot + 360) % 180;   // an axis, not a direction
        const names = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
        return names[Math.round(ang / 45) % 4];
    }

    /* Paint the frame and handles. `ratio` is canvas px per CSS px, so handles
       stay the same size on screen however the canvas is scaled. */
    function draw(ctx, b, o) {
        if (!b) return;
        o = o || {};
        const ratio = o.ratio || 1, hs = (o.size || 4) * ratio, accent = o.color || '#e8852a';
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.rotate(b.rot * D2R);
        ctx.lineWidth = ratio;
        ctx.strokeStyle = accent;
        ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
        const sides = b.w > hs * 6 && b.h > hs * 6;
        ctx.fillStyle = '#fff';
        for (const [hx, hy] of HANDLES) {
            if (!sides && (!hx || !hy)) continue;
            const x = hx * b.w / 2, y = hy * b.h / 2;
            ctx.fillRect(x - hs, y - hs, 2 * hs, 2 * hs);
            ctx.strokeRect(x - hs, y - hs, 2 * hs, 2 * hs);
        }
        ctx.restore();
    }

    /* Wire one canvas. o:
         getBox()            the box now, or null for none
         point(e)            a pointer event into the box's coordinates
         ratio()             canvas px per CSS px (default 1)
         onStart(kind)       a drag began
         onChange(box, info) info = { kind, hx, hy, start, mods, dup }; box is the NEW box
         onEnd()
         onDuplicate()       Alt-drag inside the box: copy what the box frames, so the
                             drag then moves the copy (optional; without it Alt-drag moves)
         moveAnywhere        a drag off the handles moves the box (default true)
       Modifier keys pressed or released mid-drag re-apply it. A lone Alt is kept from
       the browser while the pointer is over the canvas or a drag runs (Firefox on
       Windows opens its menu bar on it). Returns { detach }. */
    function attach(canvas, o) {
        let drag = null, lastP = null, over = false;
        const hs = () => 4 * (o.ratio ? o.ratio() : 1), mods = e => ({ alt: !!e.altKey, shift: !!e.shiftKey });
        const apply = (p, m) => {
            const s = drag.start;
            let box;
            if (drag.kind === 'resize') box = resize(s, drag.hx, drag.hy, p, m);
            else if (drag.kind === 'rotate') box = rotate(s, drag.from, p, m);
            else box = Object.assign({}, s, { cx: s.cx + p[0] - drag.from[0], cy: s.cy + p[1] - drag.from[1] });
            o.onChange(box, { kind: drag.kind, hx: drag.hx, hy: drag.hy, start: s, mods: m, dup: drag.dup });
        };
        const down = e => {
            const b = o.getBox && o.getBox(), p = o.point(e);
            let h = hit(b, p, hs());
            if (!h) h = o.moveAnywhere === false ? null : { kind: 'move' };
            if (!h || (h.kind === 'move' && o.moveAnywhere === false && !h.inside)) return;
            canvas.setPointerCapture(e.pointerId);
            // Alt at the start of a drag INSIDE the box duplicates; on a handle Alt means "from the centre".
            const dup = !!(b && h.kind === 'move' && h.inside && e.altKey && o.onDuplicate);
            if (dup) o.onDuplicate();
            // A move with no box (nothing to frame yet) still reports a box, a zero one.
            drag = { kind: h.kind, hx: h.hx, hy: h.hy, from: p, dup, start: b ? Object.assign({}, b) : { cx: 0, cy: 0, w: 0, h: 0, rot: 0 } };
            lastP = p;
            if (o.onStart) o.onStart(h.kind);
            e.preventDefault();
        };
        const move = e => {
            if (drag) { lastP = o.point(e); apply(lastP, mods(e)); return; }
            const b = o.getBox && o.getBox();
            canvas.style.cursor = b ? cursorFor(hit(b, o.point(e), hs()), b) : '';
        };
        const end = () => { if (!drag) return; drag = null; if (o.onEnd) o.onEnd(); };
        const key = e => {
            if (e.key === 'Alt' && (drag || over)) e.preventDefault();
            if (drag && (e.key === 'Shift' || e.key === 'Alt')) apply(lastP, mods(e));
        };
        const enter = () => { over = true; }, leave = () => { over = false; };
        canvas.addEventListener('pointerenter', enter);
        canvas.addEventListener('pointerleave', leave);
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        window.addEventListener('keydown', key);
        window.addEventListener('keyup', key);
        return { detach() {
            canvas.removeEventListener('pointerenter', enter); canvas.removeEventListener('pointerleave', leave);
            canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end);
            window.removeEventListener('keydown', key); window.removeEventListener('keyup', key);
        } };
    }

    return { HANDLES, resize, rotate, hit, cursorFor, draw, attach, toLocal, toWorld };
})();
