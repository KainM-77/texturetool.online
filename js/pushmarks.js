/* TRLE.PushMarks — the tracks a pushed block leaves, as a 16-slot set.
   ------------------------------------------------------------------------
   PUSH-MARKINGS-PLAN phase 4: geometry and the stroke generator, pure
   functions over TRLE.Stroke (D6: the same renderer as a hand stroke). The
   modal, the element and the maps (reliefPaint) are phase 5. Drips (a leak
   down a wall, phase 9) are a second kind on the same set: renderDrips.

   Phase 11 (beta feedback: "feels too mathematical instead of strokey"):
   wobbleStrength decouples how far a line strays from Struggle (which still
   drives gaps / chatter / flow jitter alone); wobbleAmount is the FRACTION of
   lines that wobble at all, each drawing its own on/off from a fixed seed;
   grain roughens a line's own alpha edge via stroke.js's texture mechanism.
   All three default to the pre-phase-11 values, so an absent field renders
   byte for byte unchanged. A fourth option, filling the same stroke-shaped
   coverage with Surface Noise instead of a stroke, lives in atlas.js's
   pushCompose (both buildNoiseField and the push composition are in that one
   module already); nothing here needs to know about it.

   Slots are NESW bits, N=1 E=2 S=4 W=8, the Borders & Corners `lines`
   topology: an arm runs from the tile centre to an edge midpoint. Two
   opposite arms are a straight run, two adjacent ones a corner (a quarter arc
   or an L), three a T, four a cross, one an end with a cap, none the plain
   base.

   SEAMS (D4: border crossings canonical, interiors per slot). A stroke render
   is not a periodic field: where a dab lands and what random numbers it draws
   depend on everything drawn before it, so two slots that each "draw the same
   line to the edge" do not agree at the edge. So what crosses a border is ONE
   render per axis, the crossing strip: the set seed's lines drawn straight
   across a 2L-wide strip centred on the seam. A slot with an E arm takes the
   strip's left half, the slot to its right (a W arm) takes the right half:
   two halves of one render, continuous by construction and byte-identical in
   every slot that has that arm. Each slot then draws its OWN interior from its
   own seed (wobble, gaps, chatter, the cap), and the two are blended over the
   band: strip only within B of the edge, a smoothstep crossfade over the next
   F, interior only beyond L = B + F. Anything that moves a line sideways is
   windowed to zero before L, so the two renders coincide where they blend.
   Every strip also fades out within L of the two borders it does not cross,
   so a tile's corners are unmarked and diagonal neighbours meet too. The cost
   of that: the outermost lines of a full-tile-wide track fade near the corners.

   Colour is one per set, so the marks are an ALPHA field (plus that colour),
   and the blend above is exact arithmetic on alpha. */
window.TRLE = window.TRLE || {};
TRLE.PushMarks = (() => {
    'use strict';
    const N = 1, E = 2, S_ = 4, W = 8;
    const EDGES = [['N', N, [0, -1]], ['E', E, [1, 0]], ['S', S_, [0, 1]], ['W', W, [-1, 0]]];
    const DEFAULTS = Object.freeze({
        size: 256,             // tile px
        seed: 1,               // the SET seed: what crosses every border
        footprint: 'square',   // 'square' | 'round' | 'diamond': line density and the end-cap outline
        width: 0.8,            // track width, fraction of the tile (1 = a full-tile block)
        lines: 9,              // scratches across the track
        lineWidth: 1.6,        // px at a 256 tile
        strength: 0.85,        // opacity of the strongest line
        corner: 'arc',         // 'arc' | 'L'
        cap: 'blunt',          // 'blunt' | 'fade' | 'fan' | 'curl'
        struggle: 0.35,        // Rigid 0 ... 1 Struggle (D7)
        ring: false,           // a resting outline where a one-armed track ends
        style: 'none',         // phase 8: 'none' | 'sand' | 'snow' | 'liquify' (styleField)
        styleAmount: 0,        // 0..1; 0 is no style at all
        kind: 'tracks',        // phase 9: 'tracks' | 'drips' (renderDrips)
        length: 0.6,           // drips: how far they run where they stop (0..1)
        // Phase 11 (beta feedback: "too mathematical"): wobble split off Struggle,
        // so a track can stray from its path independently of the gaps / chatter /
        // flow jitter Struggle also drives. null keeps the OLD coupled behaviour
        // (an absent field, from a recipe saved before this phase, must render
        // byte-identical): the amplitude then reads o.struggle, exactly as before.
        wobbleStrength: null,  // 0..1, how far a line strays sideways; null = follow struggle
        wobbleAmount: 1,       // 0..1, the FRACTION of lines that wobble at all; 1 = every line (old behaviour)
        grain: 0,              // 0..1, breaks the line's own alpha up (stroke.js texture); 0 = none (old behaviour)
        color: [226, 214, 190]
    });
    const opt = o => Object.assign({}, DEFAULTS, o || {});
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    const hash = (...v) => { let h = 2166136261; for (const x of v) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; };
    const rng = seed => TRLE.Stroke.rng(seed || 1);
    // Smooth 1D value noise in -1..1, from a seed.
    const vnoise = (seed, u) => { const i = Math.floor(u), f = u - i, t = f * f * (3 - 2 * f);
        const h = j => (hash(seed, j) / 4294967296) * 2 - 1; return h(i) + (h(i + 1) - h(i)) * t; };
    /* Band widths: strip only within B of an edge, crossfade over F, interior beyond L. */
    const bands = S => { const k = S / 256; return { B: 8 * k, F: 16 * k, L: 24 * k }; };
    const edgeW = (d, bd) => 1 - smooth((d - bd.B) / bd.F);

    /* ---- the canonical crossings --------------------------------------------
       Per axis ('h' = the lines that cross E/W borders, offsets along y; 'v' = N/S,
       offsets along x), the same count on both, sorted by offset. A square block's
       two edges always scratch; a round one's middle bears the weight; a diamond's
       point does. */
    function profile(fp, t) {
        if (fp === 'round') return 0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - t * t));
        if (fp === 'diamond') return 1 - 0.75 * Math.abs(t);
        return Math.abs(t) > 0.9 ? 1 : 0.75;
    }
    function crossing(o, axis) {
        const r = rng(hash(o.seed, axis === 'h' ? 0x68 : 0x76)), k = o.size / 256, half = o.width * o.size / 2;
        const n = Math.max(1, o.lines | 0), out = [];
        for (let i = 0; i < n; i++) {
            const edge = o.footprint === 'square' && n >= 2 && (i === 0 || i === n - 1);
            const t = edge ? (i === 0 ? -0.96 : 0.96) : -1 + 2 * (i + 0.2 + 0.6 * r()) / n;
            out.push({ d: t * half, width: Math.max(0.6, o.lineWidth * k * (0.6 + 0.8 * r())),
                       strength: clamp01(o.strength * (0.45 + 0.55 * r()) * profile(o.footprint, t)) });
        }
        return out.sort((a, b) => a.d - b.d);
    }

    /* ---- rendering helpers ---------------------------------------------------- */
    const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    // A polyline as stroke samples: a point every ~2 px, 16 ms apart (speed plays no part).
    function samplesOf(pts) {
        const out = [];
        let t = 0;
        for (let i = 0; i < pts.length; i++) {
            if (i > 0) {
                const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
                for (let j = 1; j <= n; j++) { t += 16; out.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n, t]); }
            } else out.push([pts[0][0], pts[0][1], 0]);
        }
        return out;
    }
    // The scratch brush: a thin hard line whose depth comes and goes (bite), more so
    // the more of a struggle it was. Zero wobble: sideways motion is in the geometry.
    const lineBrush = (o, ln, extra) => Object.assign({
        size: ln.width, hardness: 0.75, spacing: 0.12, flow: 1, color: o.color,
        bite: 0.25 + 0.6 * o.struggle, wobbleScale: 20, flowJitter: 0.1 + 0.3 * o.struggle,
        /* Grain (phase 11): 'grain' is a built-in stroke pattern (stroke.js
           getPattern), generated on first use, nothing to register here. It acts
           on ALPHA only (stroke.js putBlock: texture.mode 'multiply' thins
           coverage where the pattern is low), so it breaks the line's edge up
           without tinting it -- the colour is reapplied flat afterwards anyway
           (finish()/layers() keep only the alpha). 0 is the old path exactly:
           no texture key at all, asserted byte-identical. */
        ...(o.grain > 0 ? { texture: { id: 'grain', scale: Math.max(0.3, o.size / 256), depth: o.grain, mode: 'multiply' } } : {})
    }, extra || {});
    function drawStroke(ctx, pts, brush, seed, strength) {
        if (pts.length < 2) return;
        const W0 = ctx.canvas.width, H0 = ctx.canvas.height;
        const cv = TRLE.Stroke.render(samplesOf(pts), brush, { width: W0, height: H0, seed });
        ctx.globalAlpha = strength;
        ctx.drawImage(cv, 0, 0);
        ctx.globalAlpha = 1;
    }
    const alphaOf = cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, a = new Float32Array(cv.width * cv.height);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255; return a; };

    /* The crossing strip for an axis, cached per set: 'h' is 2L x S (lines across
       it horizontally), 'v' is S x 2L. */
    const stripCache = new Map();
    function strip(o, axis) {
        const drips = o.kind === 'drips';
        const key = JSON.stringify([o.size, o.seed, o.footprint, o.width, o.lines, o.lineWidth, o.strength, o.struggle, o.color, axis, drips]);
        if (stripCache.has(key)) return stripCache.get(key);
        const S = o.size, { L } = bands(S), two = Math.ceil(2 * L), lines = drips ? dripCrossing(o) : crossing(o, axis);
        const cv = axis === 'h' ? canvasOf(two, S) : canvasOf(S, two), ctx = cv.getContext('2d');
        lines.forEach((ln, i) => {
            const c = S / 2 + ln.d;
            const pts = axis === 'h' ? [[-4, c], [two + 4, c]] : [[c, -4], [c, two + 4]];
            drawStroke(ctx, pts, drips ? dripBrush(o, ln) : lineBrush(o, ln), hash(o.seed, axis === 'h' ? 1 : 2, i), ln.strength);
        });
        const out = { alpha: alphaOf(cv), w: cv.width, h: cv.height, lines };
        if (stripCache.size > 64) stripCache.delete(stripCache.keys().next().value);
        stripCache.set(key, out);
        return out;
    }

    /* ---- a slot's own interior ------------------------------------------------
       Paths are built along a centreline with each line at its canonical lateral
       offset; a per-slot drift (and fan / curl at a cap) is added only past L from
       every arm's edge, so near a border the interior lines sit exactly on the strip's. */
    function armsOf(bits) { return EDGES.filter(([, b]) => bits & b); }
    function interior(bits, o, slotSeed) {
        const S = o.size, k = S / 256, c = S / 2, { L } = bands(S);
        const H = crossing(o, 'h'), V = crossing(o, 'v');
        const arms = armsOf(bits);
        const lat = e => (e === 'E' || e === 'W') ? [0, 1] : [1, 0];     // lateral axis of an arm's offsets
        const setFor = e => (e === 'E' || e === 'W') ? H : V;
        const rs = rng(slotSeed);
        // Wobble strength: independent of Struggle when set (phase 11), so a track
        // can stray from its path without also raising the gaps / chatter / flow
        // jitter Struggle drives. wobbleAmount then decides how MANY lines wobble
        // at all: each line draws its own on/off from a fixed seed, so the choice
        // is stable across re-renders (idempotent: same i, same draw, every call).
        const wobbleStr = o.wobbleStrength == null ? o.struggle : o.wobbleStrength;
        const wobbleAmt = o.wobbleAmount == null ? 1 : o.wobbleAmount;
        const amp = (0.4 + 2.4 * wobbleStr) * k, lambda = S / 6;
        const wobbles = i => rng(hash(slotSeed, i, 0x7762))() < wobbleAmt;
        const paths = [];   // { pts, ln, i, brush? }
        const centres = []; // the track's own centreline per run, for chatter: { pts, edgeA, edgeB }
        // Drift along a path: s from its start, len its length; 0 within L of an end at an edge,
        // or for the whole line if it drew "does not wobble" (wobbleAmount).
        const drift = (i, s, fromEdgeA, fromEdgeB, len) => {
            if (!wobbles(i)) return 0;
            const dA = fromEdgeA ? s : Infinity, dB = fromEdgeB ? len - s : Infinity;
            const win = smooth((Math.min(dA, dB) - L) / (S / 8));
            return win * amp * vnoise(hash(slotSeed, i, 0x64), s / lambda);
        };
        // Sample a centreline function p(s) -> [point, normal] into a path for line i at offset d(s).
        const build = (len, at, dOf, i, edgeA, edgeB) => {
            const pts = [], n = Math.max(2, Math.ceil(len / 2));
            for (let j = 0; j <= n; j++) {
                const s = len * j / n, [p, nrm] = at(s), d = dOf(s) + drift(i, s, edgeA, edgeB, len);
                pts.push([p[0] + nrm[0] * d, p[1] + nrm[1] * d]);
            }
            return pts;
        };
        const straight = (from, u, nrm) => s => [[from[0] - u[0] * s, from[1] - u[1] * s], nrm];
        const has = b => !!(bits & b);
        const through = [];
        if (has(E) && has(W)) through.push(['E', 'W']);
        if (has(N) && has(S_)) through.push(['N', 'S']);
        const used = new Set(through.flat());
        // Straight runs, edge to edge (a hair past both so the ends are full width).
        for (const [a] of through) {
            const [, , u] = EDGES.find(x => x[0] === a), nrm = lat(a), from = [c + u[0] * (c + 2), c + u[1] * (c + 2)];
            setFor(a).forEach((ln, i) => paths.push({ pts: build(S + 4, straight(from, u, nrm), () => ln.d, i, true, true), ln, i }));
            centres.push({ pts: [from, [c - u[0] * (c + 2), c - u[1] * (c + 2)]], edgeA: true, edgeB: true });
        }
        const rest = arms.filter(([e]) => !used.has(e));
        if (rest.length === 2 && !through.length) {
            // A corner: pair lines by how far they sit toward the inside of the turn.
            const [[ea, , ua], [eb, , ub]] = rest;
            const la = lat(ea), lb = lat(eb);
            const inA = setFor(ea).map((ln, i) => ({ ln, i, inner: ln.d * (la[0] * ub[0] + la[1] * ub[1]) })).sort((p, q) => p.inner - q.inner);
            const inB = setFor(eb).map((ln, i) => ({ ln, i, inner: ln.d * (lb[0] * ua[0] + lb[1] * ua[1]) })).sort((p, q) => p.inner - q.inner);
            const m = Math.min(inA.length, inB.length);
            for (let j = 0; j < m; j++) {
                const A = inA[j], Bq = inB[j], ln = A.ln, i = A.i;
                let pts;
                if (o.corner === 'L') {
                    // In along A at its offset to the miter point, out along B at its offset.
                    const P = [c + A.inner * ub[0] + Bq.inner * ua[0], c + A.inner * ub[1] + Bq.inner * ua[1]];
                    pts = [[c + ua[0] * (c + 2) + ub[0] * A.inner, c + ua[1] * (c + 2) + ub[1] * A.inner], P,
                           [c + ub[0] * (c + 2) + ua[0] * Bq.inner, c + ub[1] * (c + 2) + ua[1] * Bq.inner]];
                } else {
                    // Straight stub over the band, a quarter arc (radius S/2 - L around the
                    // corner pivot), straight stub out; the offset eases from A's to B's.
                    const R = c - L, K = [c + R * (ua[0] + ub[0]), c + R * (ua[1] + ub[1])];
                    pts = [];
                    const stubA = [c + ua[0] * (c + 2) + ub[0] * A.inner, c + ua[1] * (c + 2) + ub[1] * A.inner];
                    pts.push(stubA);
                    const nA = Math.max(8, Math.ceil(R * Math.PI / 4));
                    for (let q = 0; q <= nA; q++) {
                        const ph = (Math.PI / 2) * q / nA, dd = A.inner + (Bq.inner - A.inner) * smooth(q / nA);
                        const r = Math.max(2 * k, R - dd), dir = [Math.cos(ph) * ub[0] + Math.sin(ph) * ua[0], Math.cos(ph) * ub[1] + Math.sin(ph) * ua[1]];
                        // Per-slot drift, away from the stubs (the arc starts L in from both edges).
                        const dr = amp * vnoise(hash(slotSeed, i, 0x64), q / nA * 3) * Math.sin(Math.PI * q / nA);
                        pts.push([K[0] - (r - dr) * dir[0], K[1] - (r - dr) * dir[1]]);
                    }
                    pts.push([c + ub[0] * (c + 2) + ua[0] * Bq.inner, c + ub[1] * (c + 2) + ua[1] * Bq.inner]);
                }
                paths.push({ pts, ln, i });
            }
            // The centreline of the turn: the same construction at offset 0.
            const R = c - L, K = [c + R * (ua[0] + ub[0]), c + R * (ua[1] + ub[1])], cp = [[c + ua[0] * (c + 2), c + ua[1] * (c + 2)]];
            if (o.corner === 'L') cp.push([c, c]);
            else for (let q = 0; q <= 24; q++) { const ph = (Math.PI / 2) * q / 24; cp.push([K[0] - R * (Math.cos(ph) * ub[0] + Math.sin(ph) * ua[0]), K[1] - R * (Math.cos(ph) * ub[1] + Math.sin(ph) * ua[1])]); }
            cp.push([c + ub[0] * (c + 2), c + ub[1] * (c + 2)]);
            centres.push({ pts: cp, edgeA: true, edgeB: true });
        } else {
            // Stubs: a T's third arm (to the centre), or a lone arm (to its cap).
            const lone = rest.length === 1 && arms.length === 1;
            for (const [e, , u] of rest) {
                const nrm = lat(e), from = [c + u[0] * (c + 2), c + u[1] * (c + 2)];
                const reach = lone ? Math.min(S - L - 4 * k, c + 2 + o.width * S / 2 * 0.6) : c + 2;
                centres.push({ pts: [from, [from[0] - u[0] * reach, from[1] - u[1] * reach]], edgeA: true, edgeB: false });
                const capSide = rs() < 0.5 ? -1 : 1;
                setFor(e).forEach((ln, i) => {
                    const half = o.width * S / 2;
                    let end = c + 2;           // to the centre
                    if (lone) {
                        const out = o.footprint === 'round' ? Math.sqrt(Math.max(0, half * half - ln.d * ln.d))
                                  : o.footprint === 'diamond' ? half - Math.abs(ln.d) : half;
                        end = Math.min(S - L - 4 * k, c + 2 + out * 0.6);
                    }
                    let pts = build(end, straight(from, u, nrm), s => {
                        if (!lone || o.cap !== 'fan') return ln.d;
                        const q = clamp01((s - (end - S / 5)) / (S / 5));
                        return ln.d * (1 + 0.8 * q * q);
                    }, i, true, false);
                    if (lone && o.cap === 'curl') pts = curl(pts, capSide, S / 4, k);
                    const extra = !lone ? { taperOut: 3 * k, taperMin: 0.3 }
                        : o.cap === 'fade' ? { taperOut: S / 4, taperMin: 0 }
                        : o.cap === 'fan' ? { taperOut: S / 8, taperMin: 0.2 } : { taperOut: 2 * k, taperMin: 0.4 };
                    paths.push({ pts, ln, i, extra });
                });
            }
            // A resting outline where the block stopped.
            if (lone && o.ring) paths.push({ ring: true });
        }
        return { paths, centres, arms, H, V };
    }
    // Bend the last `len` px of a path round to one side, tighter as it goes (the sketch's curl).
    function curl(pts, side, len, k) {
        if (pts.length < 3) return pts;
        const out = [pts[0]];
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        let s = 0, [x, y] = pts[0];
        let head = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
        const start = total - len;
        for (let i = 1; i < pts.length; i++) {
            const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            s += seg;
            if (s < start) { [x, y] = pts[i]; head = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]); out.push(pts[i]); continue; }
            const q = clamp01((s - start) / len);
            head += side * seg * (0.5 + 3.5 * q * q) * 2.1 / len;   // ~120 degrees over the curl
            x += Math.cos(head) * seg; y += Math.sin(head) * seg;
            out.push([x, y]);
        }
        return out;
    }

    /* ---- a slot ----------------------------------------------------------------
       variant: 0, 1, 2... the slot seed is the set seed, the bits and the variant, so
       clones of one slot differ inside and agree at every border. */
    function renderSlot(bits, options, variant) {
        const o = opt(options), S = o.size, k = S / 256, bd = bands(S), c = S / 2;
        if (o.kind === 'drips') return renderDrips(bits, o, variant);
        if (!bits) return finish(o, new Float32Array(S * S));
        const slotSeed = hash(o.seed, bits, variant | 0, 0x534c);
        const { paths, centres } = interior(bits, o, slotSeed);
        // 1. The interior: every path, gaps cut in per slot, chatter across the track.
        const cv = canvasOf(S, S), ctx = cv.getContext('2d');
        const rg = rng(hash(slotSeed, 0x6770));
        for (const p of paths) {
            if (p.ring) { drawRing(ctx, o, slotSeed); continue; }
            for (const part of gaps(p.pts, o, rg, bd, k)) drawStroke(ctx, part, lineBrush(o, p.ln, p.extra), hash(slotSeed, p.i, 0x6c6e), p.ln.strength);
        }
        if (o.struggle > 0.3) chatter(ctx, o, centres, slotSeed, bd);
        return finish(o, blendStrips(o, bits, alphaOf(cv), bd));
    }
    /* The interior blended into the crossing strips of the arms it has: strip only
       within B of an edge, a crossfade over F, interior only past L (see the top). */
    function blendStrips(o, bits, inner, bd) {
        const S = o.size, alpha = new Float32Array(S * S);
        const has = b => !!(bits & b);
        const sh = (has(E) || has(W)) ? strip(o, 'h') : null, sv = (has(N) || has(S_)) ? strip(o, 'v') : null;
        const two = sh ? sh.w : sv ? sv.h : 0, L = two / 2;
        for (let y = 0; y < S; y++) {
            const dN = y + 0.5, dS = S - (y + 0.5), wn = edgeW(dN, bd), ws = edgeW(dS, bd);
            for (let x = 0; x < S; x++) {
                const dW = x + 0.5, dE = S - (x + 0.5), ww = edgeW(dW, bd), we = edgeW(dE, bd);
                const i = y * S + x;
                let a = inner[i] * (1 - wn) * (1 - ws) * (1 - ww) * (1 - we);
                if (sh) {
                    if (has(E) && we > 0) a += sh.alpha[y * two + Math.floor(x - (S - L))] * we * (1 - wn) * (1 - ws);
                    if (has(W) && ww > 0) a += sh.alpha[y * two + Math.floor(x + L)] * ww * (1 - wn) * (1 - ws);
                }
                if (sv) {
                    if (has(S_) && ws > 0) a += sv.alpha[Math.floor(y - (S - L)) * S + x] * ws * (1 - ww) * (1 - we);
                    if (has(N) && wn > 0) a += sv.alpha[Math.floor(y + L) * S + x] * wn * (1 - ww) * (1 - we);
                }
                alpha[i] = a > 1 ? 1 : a;
            }
        }
        return alpha;
    }
    // Stop-start: a struggling push lifts off and bites again. Only well inside the tile.
    function gaps(pts, o, rg, bd, k) {
        const n = Math.round(o.struggle * 3 * rg());
        if (!n || pts.length < 4) return [pts];
        const S = o.size, inside = p => Math.min(p[0], p[1], S - p[0], S - p[1]) > bd.L + 6 * k;
        let parts = [pts];
        for (let g = 0; g < n; g++) {
            const at = Math.floor(rg() * pts.length), len = Math.round((2 + 5 * rg()) * (0.5 + o.struggle));
            const next = [];
            for (const part of parts) {
                const j = part.indexOf(pts[at]);
                if (j > 1 && j + len < part.length - 2 && inside(part[j]) && inside(part[j + len])) {
                    next.push(part.slice(0, j + 1), part.slice(j + len));
                } else next.push(part);
            }
            parts = next;
        }
        return parts;
    }
    // Chatter (D7): short ticks across the track, the stick-slip judder of a heavy
    // drag. ONE stroke per arm: a flat tip as wide as the track, turned across the
    // travel, spaced one tick period apart.
    function chatter(ctx, o, centres, slotSeed, bd) {
        const S = o.size, k = S / 256, w = o.width * S * 0.9;
        const period = (7 + 6 * (1 - o.struggle)) * k;
        // Irregular, not ruled: the spacing wanders (scatter along the travel), ticks
        // come short and skip, and it only grows in with the struggle.
        const tip = { size: w, roundness: Math.max(0.01, 0.9 * k / w), angle: 90, angleControl: 'direction', hardness: 0.6,
                      spacing: period / w, scatter: 0.35 * period / w, scatterBoth: true, flowJitter: 0.9, sizeJitter: 0.5,
                      angleJitter: 0.02, opacityJitter: 0.6, color: o.color };
        centres.forEach((cl, j) => {
            const pts = trim(cl.pts, cl.edgeA ? bd.L + 4 * k : 0, cl.edgeB ? bd.L + 4 * k : 0);
            drawStroke(ctx, pts, tip, hash(slotSeed, j, 0x6368), 0.4 * (o.struggle - 0.3) / 0.7);
        });
    }
    // A polyline with `a` px cut off its start and `b` off its end.
    function trim(pts, a, b) {
        const dense = [];
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
            for (let j = i === 1 ? 0 : 1; j <= n; j++) dense.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
        }
        let len = 0; const at = [0];
        for (let i = 1; i < dense.length; i++) { len += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]); at.push(len); }
        return dense.filter((p, i) => at[i] >= a && at[i] <= len - b);
    }
    function drawRing(ctx, o, seed) {
        const S = o.size, c = S / 2, r = o.width * S / 2 * 0.6, n = 64, pts = [];
        for (let i = 0; i <= n; i++) {
            const a = i / n * Math.PI * 2;
            let x = Math.cos(a), y = Math.sin(a);
            if (o.footprint === 'square') { const m = Math.max(Math.abs(x), Math.abs(y)); x /= m; y /= m; }
            else if (o.footprint === 'diamond') { const m = Math.abs(x) + Math.abs(y); x /= m; y /= m; }
            pts.push([c + x * r, c + y * r]);
        }
        drawStroke(ctx, pts, lineBrush(o, { width: o.lineWidth * S / 256 }), hash(seed, 0x7269), 0.5 * o.strength);
    }
    // The marks as a canvas (the set colour at this alpha) and a relief mask (grey = alpha).
    function finish(o, alpha) {
        const a8 = new Uint8ClampedArray(alpha.length);
        for (let i = 0; i < alpha.length; i++) a8[i] = Math.round(alpha[i] * 255);
        return Object.assign({ alpha }, layers(a8, o.size, o.color));
    }
    /* The canvases from 8-bit alpha, so a caller that keeps only `a8` (the atlas
       caches it per slot) can recolour without re-rendering. `mask` is only built
       when asked for (the relief route needs it, the diffuse does not).
       `tex` (phase 6), RGBA bytes at S x S: the marks take that texture, laid 1:1
       under them, instead of the flat colour; its alpha multiplies theirs.
       `painted` counts COVERAGE (a8), so a transparent texel still scratches. */
    function layers(a8, S, color, wantMask = true, tex = null) {
        const marks = canvasOf(S, S), mi = marks.getContext('2d').createImageData(S, S);
        const [r, g, b] = color || DEFAULTS.color;
        let painted = 0;
        for (let i = 0; i < a8.length; i++) {
            const a = a8[i];
            if (a) painted++;
            if (tex) {
                const j = i * 4;
                mi.data[j] = tex[j]; mi.data[j + 1] = tex[j + 1]; mi.data[j + 2] = tex[j + 2];
                mi.data[j + 3] = Math.round(a * tex[j + 3] / 255);
                continue;
            }
            mi.data[i * 4] = r; mi.data[i * 4 + 1] = g; mi.data[i * 4 + 2] = b; mi.data[i * 4 + 3] = a;
        }
        marks.getContext('2d').putImageData(mi, 0, 0);
        return { a8, marks, mask: wantMask ? maskOf(a8, S) : null, painted };
    }
    function maskOf(a8, S) {
        const mask = canvasOf(S, S), ki = mask.getContext('2d').createImageData(S, S);
        for (let i = 0; i < a8.length; i++) { ki.data[i * 4] = ki.data[i * 4 + 1] = ki.data[i * 4 + 2] = a8[i]; ki.data[i * 4 + 3] = 255; }
        mask.getContext('2d').putImageData(ki, 0, 0);
        return mask;
    }

    /* The marks laid on a base tile. A slot with nothing painted IS the base (a
       copy), so an empty slot is byte-identical to it. */
    function compose(base, slot, blend) {
        const S = base.width, out = canvasOf(S, base.height), ctx = out.getContext('2d');
        ctx.drawImage(base, 0, 0);
        if (!slot.painted) return out;
        ctx.globalCompositeOperation = blend || 'source-over';
        ctx.drawImage(slot.marks, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        return out;
    }

    /* ---- drips (phase 9) ----------------------------------------------------------
       A leak running down a wall, on the same set. Gravity is +y, so only the N and S
       arms mean anything and E / W are ignored: the four slots of the sheet's first
       column are a vertical run, top to bottom
         none   the tile above the leak (the base)
         S      the SOURCE: a smear across the tile that the drips run out of, down
                through the bottom edge, plus short ones that stop in the tile
         N + S  drips straight through, the odd bead sliding down one
         N      drips come in at the top and stop, each at its own length, on a drop.
       The seams are the tracks' rule: what crosses a border is ONE render (the 'v'
       crossing strip, cached per set) and each slot's own drips blend into it over
       the band, their sideways drift windowed to zero before L. Varying lengths live
       inside the tiles, where nothing has to agree with a neighbour. */
    const DRIP_SOURCE = 0.22;            // the source's height in the S slot, fraction of the tile
    function dripCrossing(o) {
        const r = rng(hash(o.seed, 0x6472)), S = o.size, k = S / 256, n = Math.max(1, o.lines | 0);
        // Keep every drip (and its drop) clear of the E / W bands, which fade the interior.
        const half = Math.max(0, Math.min(o.width * S / 2, S / 2 - bands(S).L - 3 * o.lineWidth * k)), out = [];
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0.4 * (r() - 0.5) : -1 + 2 * (i + 0.15 + 0.7 * r()) / n;
            out.push({ d: t * half, width: Math.max(0.8, o.lineWidth * k * (0.7 + 0.6 * r())),
                       strength: clamp01(o.strength * (0.8 + 0.2 * r())) });
        }
        return out.sort((a, b) => a.d - b.d);
    }
    // Liquid is smooth and even: no bite, no jitter, so a drip's strip and interior agree.
    const dripBrush = (o, ln, extra) => Object.assign({ size: ln.width, hardness: 0.9, spacing: 0.08, flow: 1, color: o.color }, extra || {});
    function renderDrips(bits, o, variant) {
        const S = o.size, k = S / 256, bd = bands(S), c = S / 2, L = bd.L;
        bits &= N | S_;
        if (!bits) return finish(o, new Float32Array(S * S));
        const slotSeed = hash(o.seed, bits, variant | 0, 0x6470), rs = rng(slotSeed), D = dripCrossing(o);
        const top = !!(bits & N), bot = !!(bits & S_), len = clamp01(o.length == null ? DEFAULTS.length : +o.length);
        const cv = canvasOf(S, S), ctx = cv.getContext('2d');
        // Same wobble-strength decoupling as interior() (phase 11); drips keep their
        // own per-drip length and position variety, so no wobbleAmount gate here.
        const wobbleStr = o.wobbleStrength == null ? o.struggle : o.wobbleStrength;
        const amp = (0.8 + 4 * wobbleStr) * k, lambda = S / 4;
        // A drip from y0 down to y1 at x, drifting sideways only past L from a crossed border.
        const path = (x, y0, y1, i) => {
            const pts = [], n = Math.max(2, Math.ceil((y1 - y0) / 2));
            for (let j = 0; j <= n; j++) {
                const y = y0 + (y1 - y0) * j / n, fromEdge = Math.min(top ? y : Infinity, bot ? S - y : Infinity);
                pts.push([x + smooth((fromEdge - L) / (S / 8)) * amp * vnoise(hash(slotSeed, i, 0x7764), y / lambda), y]);
            }
            return pts;
        };
        /* One drip with its drops ([index into pts, radius]): a teardrop swelling from
           the trail's width to the bulb. Trail and drops are one layer, laid at the
           drip's strength once, so a drop does not darken where it overlaps the trail. */
        const drip = (pts, ln, seed, drops) => {
            const one = canvasOf(S, S), g = one.getContext('2d');
            g.drawImage(TRLE.Stroke.render(samplesOf(pts), dripBrush(o, ln), { width: S, height: S, seed }), 0, 0);
            drops.forEach(([at, R], j) => {
                const [x, y] = pts[Math.max(0, Math.min(pts.length - 1, at))];
                const b = dripBrush(o, { width: 2 * R }, { taperIn: 2.4 * R, taperMin: Math.min(1, ln.width / (2 * R)) });
                g.drawImage(TRLE.Stroke.render(samplesOf([[x, y - 2.4 * R], [x, y]]), b, { width: S, height: S, seed: hash(seed, j, 0x6270) }), 0, 0);
            });
            ctx.globalAlpha = ln.strength;
            ctx.drawImage(one, 0, 0);
            ctx.globalAlpha = 1;
        };
        const bulb = ln => ln.width * (1.1 + 0.6 * rs());
        if (top && bot) {
            // Straight through; now and then a bead sliding down, well inside the tile.
            D.forEach((ln, i) => {
                const pts = path(c + ln.d, -2, S + 2, i), drops = [];
                if (rs() < 0.25 + 0.3 * o.struggle) {
                    const y = L + S / 8 + rs() * (S - 2 * L - S / 4);
                    drops.push([Math.round((y + 2) / (S + 4) * (pts.length - 1)), 0.8 * bulb(ln)]);
                }
                drip(pts, ln, hash(slotSeed, i, 0x6c6e), drops);
            });
        } else if (top) {
            // In at the top, each stopping at its own length on a drop, before the S band.
            const lo = L + 10 * k, span = S - 2 * L - 30 * k;
            D.forEach((ln, i) => {
                const end = lo + span * clamp01(len * (0.15 + 0.85 * rs()));
                const pts = path(c + ln.d, -2, end, i);
                drip(pts, ln, hash(slotSeed, i, 0x6c6e), [[pts.length - 1, bulb(ln)]]);
            });
        } else {
            /* The source: a smear across the drips, and every drip starts on it, so
               nothing lands above it. The canonical drips run out through S; a few
               short ones stop inside the tile. */
            const y0 = DRIP_SOURCE * S, lo = D[0].d, hi = D[D.length - 1].d, w0 = Math.max(4 * k, 3 * o.lineWidth * k);
            const sy = x => y0 + 0.5 * w0 * vnoise(hash(slotSeed, 0x7372), x / (S / 6));
            const src = [];
            for (let x = c + lo - 3 * w0; x <= c + hi + 3 * w0; x += 2) src.push([x, sy(x)]);
            if (src.length >= 2) drawStroke(ctx, src, dripBrush(o, { width: w0 }, { taperIn: 3 * w0, taperOut: 3 * w0, taperMin: 0.15 }),
                hash(slotSeed, 0x7372), clamp01(o.strength));
            /* Each drip leaves the source through a LIP, a teardrop hanging from it that
               narrows to the trail: a drawn-out drop, pointing down. Its widest dab is
               wider than the source, so it hangs with its top on the source's top edge
               (centred on the source line it bulged above it: 2.3 px at 256). */
            const lip = (ln, i, x) => {
                const R = 0.8 * w0 * (0.8 + 0.4 * rs()), y = sy(x) + Math.max(0, R - w0 / 2);
                drawStroke(ctx, [[x, y], [x, y + 3 * R]], dripBrush(o, { width: 2 * R }, { taperOut: 3 * R, taperMin: Math.min(1, ln.width / (2 * R)) }),
                    hash(slotSeed, i, 0x6c70), ln.strength);
            };
            D.forEach((ln, i) => { const pts = path(c + ln.d, sy(c + ln.d), S + 2, i); drip(pts, ln, hash(slotSeed, i, 0x6c6e), []); lip(ln, i, pts[0][0]); });
            const extra = Math.round(D.length * (0.3 + 0.4 * rs())), room = S - L - 16 * k - y0;
            for (let j = 0; j < extra; j++) {
                const ln = { d: lo + (hi - lo) * rs(), width: Math.max(0.8, o.lineWidth * k * (0.6 + 0.5 * rs())), strength: clamp01(o.strength * (0.7 + 0.3 * rs())) };
                const end = y0 + 8 * k + (room - 8 * k) * clamp01(len * (0.2 + 0.8 * rs()));
                const pts = path(c + ln.d, sy(c + ln.d), end, 100 + j);
                drip(pts, ln, hash(slotSeed, 100 + j, 0x6c6e), [[pts.length - 1, bulb(ln)]]);
                lip(ln, 100 + j, pts[0][0]);
            }
        }
        return finish(o, blendStrips(o, bits, alphaOf(cv), bd));
    }

    /* ---- displacement styles (phase 8) ------------------------------------------
       A FIELD over the tile from the track's own centrelines (interior()'s `centres`,
       so the styles follow exactly the geometry the marks do): for each pixel, the
       distance across the track `d` (0 on the centreline, 1 at the track's edge) and
       the position along it `u` (0 at the tile centre or the middle of a turn, 1 at
       every border the track crosses). Both are continuous everywhere (where two runs
       meet, the nearer one's d and u equal the other's on the switch line), and on a
       crossed border both tiles compute the same values, so any function of (d, u)
       that is EVEN at u = 1 meets its neighbour smoothly.
         sand     ripples across the track, cos(2 pi k u): crests at every border
         snow     a sunk channel with raised sides, a function of d alone
         liquify  the floor smeared along the track, windowed to zero within B of
                  every border (so the border band is the base byte for byte) and
                  near a junction (the tangent turns there)
       Everything is windowed to zero within L of a border the track does not cross.
       Per-slot variety (the D4 split) is windowed away from crossed borders too. */
    const STYLES = ['none', 'sand', 'snow', 'liquify'];
    const STYLE_LIFT = { sand: 0.22, snow: 0.22 };       // height at |h| = 1 (snow at 0.4 carved Stonetiles to black)
    const STYLE_SHADE = { sand: 0.12, snow: 0.2 };       // a little colour from the relief
    const RIPPLES = 4;                                   // sand crests per half tile (an integer: phase 0 at every border)
    const OVER = 2;                                      // interior() starts every centreline this far outside the tile
    const fieldCache = new Map();
    function styleField(bits, options, variant) {
        const o = opt(options), S = o.size, st = o.style, A = clamp01(+o.styleAmount || 0);
        // A floor style is about a floor; drips run down a wall (their controls hide it).
        if (!bits || !st || st === 'none' || A <= 0 || !STYLES.includes(st) || o.kind === 'drips') return null;
        const key = JSON.stringify([S, bits, variant | 0, o.seed, o.width, o.corner, o.cap, o.footprint, o.struggle, st, A]);
        if (fieldCache.has(key)) return fieldCache.get(key);
        const c = S / 2, { B, L } = bands(S), hw = Math.max(1, o.width * S / 2);
        const slotSeed = hash(o.seed, bits, variant | 0, 0x7374);
        const cls = interior(bits, o, 1).centres.map((cl, j) => {
            const segs = [];
            let len = 0;
            for (let i = 0; i + 1 < cl.pts.length; i++) {
                const [x0, y0] = cl.pts[i], [x1, y1] = cl.pts[i + 1], l = Math.hypot(x1 - x0, y1 - y0);
                if (l < 1e-6) continue;
                segs.push({ x0, y0, dx: (x1 - x0) / l, dy: (y1 - y0) / l, l, s0: len });
                len += l;
            }
            return { segs, len, edgeA: cl.edgeA, edgeB: cl.edgeB, j };
        });
        const arms = armsOf(bits), crossed = new Set(arms.map(([e]) => e)), junction = arms.length >= 3;
        const n = S * S, h = st === 'liquify' ? null : new Float32Array(n);
        const wx = st === 'liquify' ? new Float32Array(n) : null, wy = st === 'liquify' ? new Float32Array(n) : null;
        const lambda = S / 5;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const px = x + 0.5, py = y + 0.5;
            /* The global window: borders without a track. No corner window (the strips
               need one; a field does not): in the shipped sheet a border is crossed by
               both tiles or by neither, and a crossed border agrees along its whole
               length, corners included (a planted removal of one changed nothing). */
            let W = 1;
            if (!crossed.has('N')) W *= smooth(py / L);
            if (!crossed.has('S')) W *= smooth((S - py) / L);
            if (!crossed.has('W')) W *= smooth(px / L);
            if (!crossed.has('E')) W *= smooth((S - px) / L);
            if (W <= 0) continue;
            // The nearest centreline point.
            let best = Infinity, bs = 0, bc = null, bt = null;
            for (const cl of cls) for (const g of cl.segs) {
                let t = (px - g.x0) * g.dx + (py - g.y0) * g.dy;
                t = t < 0 ? 0 : t > g.l ? g.l : t;
                const qx = g.x0 + g.dx * t - px, qy = g.y0 + g.dy * t - py, dd = qx * qx + qy * qy;
                if (dd < best) { best = dd; bs = g.s0 + t; bc = cl; bt = g; }
            }
            if (!bc) continue;
            const d = Math.sqrt(best) / hw;
            if (d > 1.6) continue;
            /* Positions from the REAL border: every centreline starts (and a run ends)
               OVER = 2 px outside the tile, so measuring from the polyline's own ends
               would give each arm type a slightly different u at the same border. */
            const sb = bs - OVER, lb = bc.len - (bc.edgeB ? 2 * OVER : OVER);
            const u = bc.edgeB ? Math.abs(sb - lb / 2) / (lb / 2) : Math.abs(1 - sb / c);
            // Distance along the track from a crossed border, for the per-slot windows.
            const fromEdge = Math.min(bc.edgeA ? sb : Infinity, bc.edgeB ? lb - sb : Infinity);
            const inner = smooth((fromEdge - L) / L);
            const i = y * S + x;
            if (st === 'sand') {
                const env = 1 - smooth((d - 0.7) / 0.45);
                const vary = 1 + 0.3 * inner * vnoise(hash(slotSeed, bc.j, 0x736e), bs / lambda);
                h[i] = W * A * env * vary * Math.cos(2 * Math.PI * RIPPLES * u);
            } else if (st === 'snow') {
                const core = 1 - smooth(d), berm = Math.exp(-(((d - 1.1) / 0.28) ** 2));
                h[i] = W * A * (0.7 * berm - core);
            } else {
                const env = 1 - smooth((d - 0.5) / 0.6);
                /* Zero within B of EVERY border, not just along the track from a crossed
                   one: in a turn, a pixel by the border can be nearest the middle of the
                   arc (measured: 4155 px moved inside the band). */
                const wu = smooth((Math.min(px, py, S - px, S - py) - B) / L), wc = junction ? smooth(u / 0.3) : 1;
                const m = W * A * 0.12 * S * env * wu * wc * (0.55 + 0.45 * vnoise(hash(slotSeed, bc.j, 0x6c71), bs / lambda));
                wx[i] = bt.dx * m; wy[i] = bt.dy * m;
            }
        }
        const f = { kind: st, h, wx, wy, lift: STYLE_LIFT[st] || 0 };
        fieldCache.set(key, f);
        if (fieldCache.size > 48) fieldCache.delete(fieldCache.keys().next().value);
        return f;
    }
    /* The base with a style applied: shaded by the relief (sand, snow) or smeared
       (liquify). Pixels the field leaves at 0 are copied byte for byte. */
    function styleBase(base, f) {
        const S = base.width, out = canvasOf(S, S), g = out.getContext('2d');
        const src = base.getContext('2d').getImageData(0, 0, S, S).data, id = g.createImageData(S, S), o = id.data;
        o.set(src);
        if (f.h) {
            const k = STYLE_SHADE[f.kind] || 0;
            for (let i = 0; i < S * S; i++) {
                if (!f.h[i]) continue;
                const m = 1 + k * f.h[i], j = i * 4;
                o[j] = src[j] * m; o[j + 1] = src[j + 1] * m; o[j + 2] = src[j + 2] * m;
            }
        } else {
            const at = (x, y, ch) => src[((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4 + ch];
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
                const i = y * S + x;
                if (!f.wx[i] && !f.wy[i]) continue;
                // Sample the floor BEHIND the drag (toroidally: the floor tiles with itself).
                const sx = x - f.wx[i], sy = y - f.wy[i], x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
                for (let ch = 0; ch < 4; ch++) {
                    const a = at(x0, y0, ch) * (1 - fx) + at(x0 + 1, y0, ch) * fx, b = at(x0, y0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, ch) * fx;
                    o[i * 4 + ch] = a * (1 - fy) + b * fy;
                }
            }
        }
        g.putImageData(id, 0, 0);
        return out;
    }
    /* The relief of a sand / snow field for reliefPaint.field: { up, down, lift }. */
    function styleRelief(f, S) {
        if (!f || !f.h) return null;
        const mk = sign => { const c = canvasOf(S, S), g = c.getContext('2d'), id = g.createImageData(S, S);
            for (let i = 0; i < S * S; i++) { const v = Math.round(255 * Math.max(0, sign * f.h[i])); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
            g.putImageData(id, 0, 0); return c; };
        return { up: mk(1), down: mk(-1), lift: f.lift };
    }

    /* The shipped sheet: all 16 slots once in a 4 x 4 that tiles with itself.
       Column c has W / E = A[c] / A[c+1], row r has N / S = A[r] / A[r+1], A = 0 0 1 1. */
    const A4 = [0, 0, 1, 1];
    const SHEET = Array.from({ length: 16 }, (_, i) => {
        const r = Math.floor(i / 4), c = i % 4;
        return (A4[r] ? N : 0) | (A4[(r + 1) % 4] ? S_ : 0) | (A4[c] ? W : 0) | (A4[(c + 1) % 4] ? E : 0);
    });

    return { DEFAULTS, BITS: { N, E, S: S_, W }, SHEET, bands, crossing, renderSlot, compose, layers, maskOf,
             STYLES, styleField, styleBase, styleRelief, DRIP_SOURCE, dripCrossing,
             _stripCache: () => stripCache.size };
})();
