/* TRLE.Layers: the layer model (LAYERS-PLAN phase 1). No UI, no tool knowledge.

   A tile with layers carries `el.under` (the texture before its first layer, plus
   anything baked into it since) and `el.layers` (its pieces, bottom to top).
   `el.canvas` stays the flattened result and is DERIVED: a rebuild draws into it,
   never replaces it, because the grid and open modals hold the node.

   A layer is a shared DEFINITION (`defs[lid]`: kind, name, visible, opacity, blend,
   recipe, pixels copied from other tiles) plus one PIECE per tile
   (`{ lid, mask, px, data, xf }`). Rules the rest of the tool relies on:
   - Definitions are REPLACED, never mutated (`update`), so an undo snapshot holds
     the map's entries by reference and costs no clone.
   - Pixels (`under`, a piece's `mask` / `px`, a def's `pixels`) are immutable
     references: replaced, never drawn into. That is also what lets autosave encode
     each one once.
   - A kind is a PURE function of (input, def, piece): no writes to other fields.
   - Loading never rebuilds (the saved composite is shown); a rebuild happens on an
     edit, a hide, a delete or a transform.

   Kinds register with `register(kind, { zone, mode, apply, cost })`:
     zone  'texture' | 'content' | 'finish'  (the stack is drawn in that order)
     mode  'adjust'  apply(input, def, piece, ctx) -> the new composite
           'content' apply(...) -> the layer's pixels (default piece.px), which are
                     composited over the input with def.opacity and def.blend
     cost  ms, or (def, S) => ms: the rebuild's estimate, which decides the dim. */
(function () {
    'use strict';
    const TRLE = window.TRLE = window.TRLE || {};

    const ZONES = ['texture', 'content', 'finish'];
    const DIM_MS = 300;                      // above this estimate the screen dims (decision 20)
    const kinds = Object.create(null);
    const stats = { rebuilds: 0, strays: 0, invariantFailures: 0, dims: 0, unknownKinds: 0 };
    let seq = 0;

    const BLEND = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
                    lighten: 'lighten', darken: 'darken', add: 'lighter' };

    function register(kind, spec) { kinds[kind] = Object.assign({ zone: 'texture', mode: 'adjust', cost: 0 }, spec); }
    const kindOf = def => def && kinds[def.kind];
    /* A kind registered with `movable: false` stays where it is: the model refuses the move, so no path can make one. */
    const movable = def => { const k = kindOf(def); return !(k && k.movable === false); };
    const zoneOf = def => { const k = kindOf(def); return (def && def.zone) || (k && k.zone) || 'texture'; };
    const zoneRank = def => Math.max(0, ZONES.indexOf(zoneOf(def)));

    const newLid = () => 'l' + (++seq);
    const reserve = newLid;   // an id taken ahead of `add`, for a recipe that must name its own layer
    function seen(lid) { const n = parseInt(String(lid).slice(1), 10); if (n > seq) seq = n; }

    /* Marks a canvas as an immutable reference: autosave may cache its encoded Blob. */
    const imm = c => { if (c) c.__immutable = true; return c; };
    const hasLayers = el => !!(el && el.under && el.layers && el.layers.length);
    const clone = c => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; o.getContext('2d').drawImage(c, 0, 0); return o; };
    function drawReplace(dst, src) {
        const x = dst.getContext('2d');
        x.clearRect(0, 0, dst.width, dst.height);
        x.drawImage(src, 0, 0, dst.width, dst.height);
    }

    /* FNV-1a over every byte, 4 at a time. Used for the stray-write check, so it
       must see any change; it is not a security hash. */
    function hash(c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const u = new Uint32Array(d.buffer, d.byteOffset, d.byteLength >> 2);
        let h = 2166136261;
        for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function same(a, b) {
        if (a.width !== b.width || a.height !== b.height) return false;
        const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
        const y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
        return true;
    }

    /* One layer applied to the composite below it. */
    function applyOne(input, def, piece, S) {
        const k = kindOf(def);
        if (!k) { stats.unknownKinds++; return input; }
        const out = k.apply(input, def, piece, { S, defs: null });
        const a = def.opacity == null ? 1 : Math.max(0, Math.min(1, def.opacity));
        const res = document.createElement('canvas');
        res.width = input.width; res.height = input.height;
        const x = res.getContext('2d');
        x.drawImage(input, 0, 0);
        if (k.mode === 'content') {
            const layer = out || piece.px;
            if (!layer) return res;
            x.globalAlpha = a;
            x.globalCompositeOperation = BLEND[def.blend] || def.blend || 'source-over';   // a name above, or a raw canvas operation
            x.drawImage(layer, 0, 0, res.width, res.height);
            return res;
        }
        if (a >= 1) return out;
        // An adjustment at less than full opacity mixes with what it was given.
        x.globalAlpha = a;
        x.drawImage(out, 0, 0);
        return res;
    }

    /* The steps of one tile's rebuild: yields after each layer so a caller that
       wants to show progress can. `upTo` (a lid) stops BEFORE that layer, which is
       the layer's INPUT, what its modal previews on. Returns the composite. */
    function* steps(el, defs, upTo, upToIndex) {
        let cur = clone(el.under);
        const S = cur.width;
        for (let i = 0; i < el.layers.length; i++) {
            const p = el.layers[i];
            if (upTo && p.lid === upTo) return cur;
            if (upToIndex != null && i >= upToIndex) return cur;
            const def = defs[p.lid];
            if (!def || def.visible === false) continue;
            cur = applyOne(cur, def, p, S);
            yield cur;
        }
        return cur;
    }
    function run(g) { let r = g.next(); while (!r.done) r = g.next(); return r.value; }

    /* Rebuild one tile's el.canvas from its stack. */
    function rebuild(el, defs) {
        if (!hasLayers(el)) return;
        stats.rebuilds++;
        drawReplace(el.canvas, run(steps(el, defs)));
        el.edited = true;
        el.layerSig = hash(el.canvas);
    }
    const inputOf = (el, defs, lid) => run(steps(el, defs, lid));
    /* The composite below the layer at stack index `i` (what the map source of a Classic Look layer is). */
    const inputAt = (el, defs, i) => run(steps(el, defs, null, i));
    /* What a NEW layer shaped like `def` (its zone) would be given: the composite below the
       place it would be inserted. A tile with no layers gives its canvas itself. */
    function inputFor(el, defs, def) {
        if (!hasLayers(el)) return el.canvas;
        return run(steps(el, defs, null, insertIndex(el, def, defs)));
    }

    function estimate(els, defs) {
        let ms = 0;
        for (const el of els) {
            if (!hasLayers(el)) continue;
            const S = el.under.width;
            for (const p of el.layers) {
                const def = defs[p.lid], k = kindOf(def);
                if (!def || def.visible === false || !k) continue;
                const c = typeof k.cost === 'function' ? k.cost(def, S) : k.cost;
                ms += (def.recipe && def.recipe.estimateMs != null ? def.recipe.estimateMs : c) || 0;
            }
        }
        return ms;
    }

    /* ---- the dim: decision 20 ---- */
    let dimEl = null;
    function dimShow(text) {
        if (!dimEl) {
            dimEl = document.createElement('div');
            dimEl.id = 'at-rebuild-dim';
            dimEl.setAttribute('role', 'status');
            dimEl.innerHTML = '<div class="at-rebuild-box"><div class="at-rebuild-text"></div>'
                + '<div class="at-rebuild-bar"><i></i></div></div>';
            document.body.appendChild(dimEl);
        }
        dimEl.querySelector('.at-rebuild-text').textContent = text || 'Rebuilding texture…';
        dimEl.querySelector('i').style.width = '0%';
        dimEl.hidden = false;
        stats.dims++;
    }
    const dimProgress = f => { if (dimEl) dimEl.querySelector('i').style.width = Math.round(f * 100) + '%'; };
    const dimHide = () => { if (dimEl) dimEl.hidden = true; };
    const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    /* Rebuild several tiles. Cheap work runs synchronously inside the promise;
       above DIM_MS the screen dims and the work yields between layers and tiles,
       as the export does, so the bar moves. */
    async function rebuildMany(els, defs, opts) {
        const todo = els.filter(hasLayers);
        const est = estimate(todo, defs);
        const dim = est > ((opts && opts.dimMs) != null ? opts.dimMs : DIM_MS);
        if (!dim) { todo.forEach(el => rebuild(el, defs)); return { dimmed: false, estimate: est }; }
        dimShow((opts && opts.text) || 'Rebuilding texture…');
        try {
            await frame();
            const total = todo.reduce((n, el) => n + el.layers.length, 0) || 1;
            let done = 0;
            for (const el of todo) {
                const g = steps(el, defs);
                let r = g.next();
                while (!r.done) { done++; dimProgress(done / total); if (opts && opts.onStep) opts.onStep(done, total); await frame(); r = g.next(); }
                stats.rebuilds++;
                drawReplace(el.canvas, r.value);
                el.edited = true;
                el.layerSig = hash(el.canvas);
            }
            dimProgress(1);
        } finally { dimHide(); }
        return { dimmed: true, estimate: est };
    }

    /* ---- editing a stack ---- */
    function insertIndex(el, def, defs) {
        const r = zoneRank(def);
        let i = el.layers.length;
        while (i > 0 && zoneRank(defs[el.layers[i - 1].lid]) > r) i--;
        return i;
    }

    /* Put a piece into a tile that has a stack, in the right zone. */
    function insertPiece(el, def, piece, defs) {
        if (!el.under) { el.under = imm(clone(el.canvas)); el.layers = []; }
        el.layers.splice(insertIndex(el, def, defs), 0, piece);
    }

    /* One new layer across `els`: `def` is {kind, name?, recipe?, pixels?, ...},
       `pieces` is one piece (or null) per tile. A tile with no stack yet takes its
       current canvas as `under`. Returns the lid. No rebuild: the caller decides
       (rebuildMany), because it may already hold the finished composite. */
    function add(defs, els, def, pieces) {
        const lid = def.lid || newLid();
        const d = Object.assign({ visible: true, opacity: 1, blend: 'normal', name: def.kind, recipe: {} }, def, { lid });
        d.zone = zoneOf(d);
        defs[lid] = d;
        els.forEach((el, i) => {
            if (!el.under) { el.under = imm(clone(el.canvas)); el.layers = []; }
            if (!el.layers) el.layers = [];
            const p = Object.assign({}, pieces && pieces[i] || {}, { lid });
            imm(p.mask); imm(p.px);
            if (p.aux) for (const k of Object.keys(p.aux)) imm(p.aux[k]);
            el.layers.splice(insertIndex(el, d, defs), 0, p);
        });
        return lid;
    }

    /* Replace a definition (never mutate it). */
    function update(defs, lid, patch) {
        const d = Object.assign({}, defs[lid], patch, { lid });
        defs[lid] = d;
        return d;
    }

    const tilesOf = (lid, els) => els.filter(el => el.layers && el.layers.some(p => p.lid === lid));

    /* Take a layer off one tile and bring its canvas up to date. The last one
       leaves the tile with no stack: its canvas becomes `under`'s pixels.
       `defer`: a tile that still has layers is NOT rebuilt here; the caller
       rebuilds it through rebuildMany (the dim), once, with the rest. */
    function remove(el, lid, defs, defer) {
        if (!el.layers) return;
        el.layers = el.layers.filter(p => p.lid !== lid);
        if (el.layers.length) { if (!defer) rebuild(el, defs); return; }
        drawReplace(el.canvas, el.under);
        el.layers = null; el.under = null; el.layerSig = null;
    }

    /* Move a content layer to where another content layer sits (drag in the panel).
       Only the Content zone reorders; everything else is placed by the tool.
       Returns true when the order changed. */
    function reorder(el, defs, lid, overLid) {
        if (!el.layers || lid === overLid) return false;
        const isContent = l => { const p = el.layers.find(q => q.lid === l); return p && zoneOf(defs[l]) === 'content'; };
        if (!isContent(lid) || !isContent(overLid)) return false;
        const from = el.layers.findIndex(p => p.lid === lid), over = el.layers.findIndex(p => p.lid === overLid);
        const piece = el.layers.splice(from, 1)[0];
        const at = el.layers.findIndex(p => p.lid === overLid);
        el.layers.splice(from < over ? at + 1 : at, 0, piece);   // the dragged layer takes the other's place
        return true;
    }

    /* Where a layer crossing the text and drawings lands (phase 14): just over them, the
       first place in Finish, or just under them, the last place in Texture. The stack is
       kept sorted by zone, so that is a count of the pieces below the boundary. */
    function edgeIndex(el, defs, zone) {
        const below = zone === 'finish' ? 2 : 1;
        return el.layers.filter(p => zoneRank(defs[p.lid]) < below).length;
    }

    /* Move a picture edit over ('finish') or under ('texture') the text and drawings on
       `targets` (the tiles that carry it among them). All of its tiles: the definition
       changes zone in place. Some of them: they get a NEW definition (a copy in the new
       zone) and the rest keep the old one, so a batch can be split by a move. Content
       layers do not move this way. Returns the lid the moved tiles now carry, or null. */
    function moveToZone(defs, els, lid, zone, targets) {
        const def = defs[lid];
        if (!def || zoneOf(def) === 'content' || (zone !== 'finish' && zone !== 'texture')) return null;
        if (movable(def) === false) return null;   // a kind may opt out (HD Look, D10)
        const all = tilesOf(lid, els), tiles = all.filter(el => targets.includes(el));
        if (!tiles.length) return null;
        let to = lid;
        if (tiles.length === all.length) update(defs, lid, { zone });
        else { to = newLid(); defs[to] = Object.assign({}, def, { lid: to, zone }); }
        for (const el of tiles) {
            const p = el.layers.find(q => q.lid === lid);
            el.layers = el.layers.filter(q => q !== p);
            el.layers.splice(edgeIndex(el, defs, zone), 0, to === lid ? p : Object.assign(clonePiece(p), { lid: to }));
        }
        return to;
    }

    /* Drop definitions no tile uses. */
    function prune(defs, els) {
        const used = new Set();
        els.forEach(el => (el.layers || []).forEach(p => used.add(p.lid)));
        for (const lid of Object.keys(defs)) if (!used.has(lid)) delete defs[lid];
    }

    /* Bake the stack into the pixels: the fallback for a tool that writes el.canvas
       on a tile with layers and is not a kind yet. The tile is never inconsistent;
       it loses editability, the tools get converted phase by phase. */
    function flatten(el) {
        el.under = null; el.layers = null; el.layerSig = null;
    }

    /* Called before an undo snapshot: a layered tile whose canvas no longer matches
       what the last rebuild wrote has had a stray write. */
    function checkTiles(els, defs, capture) {
        for (const el of els) {
            if (!hasLayers(el)) continue;
            if (el.layerSig != null && hash(el.canvas) !== el.layerSig) {
                stats.strays++;
                flatten(el);
                continue;
            }
            if (capture) {
                const probe = { under: el.under, layers: el.layers, canvas: clone(el.canvas) };
                drawReplace(probe.canvas, run(steps(el, defs)));
                if (!same(probe.canvas, el.canvas)) stats.invariantFailures++;
            }
        }
    }

    /* ---- copy helpers for undo and Duplicate ---- */
    const clonePiece = p => {
        const q = Object.assign({}, p);        // mask / px stay references: immutable
        if (p.data != null) q.data = JSON.parse(JSON.stringify(p.data));
        if (p.xf != null) q.xf = JSON.parse(JSON.stringify(p.xf));
        return q;
    };
    const clonePieces = ls => ls ? ls.map(clonePiece) : null;

    /* An unlinked copy of a tile's layers for a duplicate: a new lid per layer. */
    function duplicate(defs, src, dupId, S) {
        if (!hasLayers(src)) return { under: null, layers: null };
        const layers = src.layers.map(p => {
            const old = defs[p.lid], lid = newLid();
            const d = Object.assign({}, old, { lid, recipe: JSON.parse(JSON.stringify(old.recipe || {})) });
            if (old.area) d.area = { W: S, H: S, S, cells: [{ id: dupId, x: 0, y: 0 }] };
            defs[lid] = d;
            return Object.assign(clonePiece(p), { lid });
        });
        return { under: src.under, layers, layerSig: src.layerSig };
    }

    /* A move (Rotate, Flip, Offset, ...) over a tile's stack: the move's own
       image / mask functions, so it is the same maths as for the flattened tile.
       `defer`: the caller rebuilds (rebuildMany, so a slow stack dims); until then
       el.canvas is stale, so it must rebuild before anything reads it. */
    function move(el, defs, mv, defer) {
        const img = mv.image, mask = mv.mask || img;
        el.under = imm(img(el.under));
        el.layers = el.layers.map(p => {
            const q = Object.assign({}, p);
            /* A kind that keeps its pixels as CROPS in `aux` (`crops: true`, the sticker kind: one crop per
               sticker, `k<i>`, because each has its own blend) is content too: its piece records the move's
               descriptor like a `px` piece, and its crops move as images, not as masks. */
            const ck = kindOf(defs[p.lid]), crops = !!(ck && ck.crops);
            if (p.mask) q.mask = imm(mask(p.mask));
            if (p.px) q.px = imm(img(p.px));
            if (p.px || crops) { if (mv.desc) q.xf = (p.xf || []).concat(mv.desc); else q.xfLost = true; }   // see XF_OPS in atlas.js
            // A crop kind's own canvases are images: `k<i>` (the sticker as drawn), `b<i>` (its body before effects), `e<i>`
            // (its effects' in-game glow) and `k<i><map>` (its own material maps; a normal map turns its vectors with the move).
            const cropFn = k => /^[kbe]\d+$/.test(k) ? img : /^k\d+normal$/.test(k) ? (mv.normal || img) : /^k\d+[a-z]+$/.test(k) ? img : mask;
            if (p.aux) { q.aux = {}; for (const k of Object.keys(p.aux)) if (k !== 'tcopy') q.aux[k] = imm((crops ? cropFn(k) : mask)(p.aux[k])); }   // extra pixel-registered canvases (a text layer's coverage and relief)
            // A copy of ANOTHER tile that the kind reads in register with this one (Slope Blur's driver tile): the definition's
            // copy is shared by every tile of a batch, so the moved copy is this piece's own, `aux.tcopy`, moved as an image.
            const k = kindOf(defs[p.lid]);
            const tc = (p.aux && p.aux.tcopy) || (k && k.tileCopy && k.tileCopy(defs[p.lid], p));
            if (tc) { q.aux = q.aux || {}; q.aux.tcopy = imm(img(tc)); }
            return q;
        });
        if (!defer) rebuild(el, defs);
    }

    TRLE.Layers = {
        ZONES, DIM_MS, BLEND, stats, register, kinds, kindOf, zoneOf, movable, newLid, reserve, seen, hasLayers,
        rebuild, rebuildMany, inputOf, inputAt, estimate, add, update, tilesOf, remove, prune, flatten,
        checkTiles, imm, reorder, moveToZone, edgeIndex, insertPiece, inputFor, insertIndex, clonePiece, clonePieces, duplicate, move, hash, same, clone,
        dimVisible: () => !!(dimEl && !dimEl.hidden)
    };
})();
