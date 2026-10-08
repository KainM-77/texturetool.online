/* TRLE.Stickers: the sticker library (STICKERS-PLAN phase 2, D10 / D11).
   Images that are not tiles, held once per project and placed by the `sticker`
   layer kind, which COPIES the pixels it uses (so nothing here can change a tile).

   A record: { id: 's<n>', name, canvas, maps: { normal, height, ... } | null,
               from: 'upload' | 'cut' | 'psd', hash }
   Every image is trimmed to its alpha bounds and capped at MAX px on its longest
   side (a halving resize, as drawImported does, so a big downscale does not alias).

   Saved IN the project (whole library, A3) through atlas.js's serialiser, and moved
   between projects as a pack: <name>.atlasstickers.zip = manifest.json plus one PNG
   per image. A pack is UNTRUSTED input, like a project (SECURITY-PLAN phase 3):
   raster formats only, checked by their signature, decoded with createImageBitmap,
   manifest fields sanitised and capped, entries looked up by exact name in the ZIP,
   nothing fetched. No dependencies at definition time; JSZip and TRLE.Engine
   (decodeTGA) are read when called. */
TRLE.Stickers = (function () {
    const MAX = 2048;                 // longest side of a library image (P10)
    const MAX_COUNT = 1000;           // stickers one pack or project may add
    const MAX_NAME = 80;
    const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
    const MAX_DIM = 16384;            // a decoded image larger than this is refused
    const MAP_TYPES = ['normal', 'ao', 'specular', 'roughness', 'emissive', 'height'];
    /* Map files are paired with a sticker by the END of their name (P9, the author 2026-10-08):
       bolt.png + bolt_normal.png / bolt-n.png / bolt.nrm.png. Case-insensitive. */
    const ENDINGS = {
        normal: ['n', 'nrm', 'normal'], height: ['h', 'height', 'disp', 'bump'],
        roughness: ['r', 'rough', 'roughness'], ao: ['ao', 'occlusion'],
        specular: ['s', 'spec', 'specular'], emissive: ['e', 'emissive', 'glow'],
    };
    const END_RE = new RegExp('^(.+?)[-_.](' + Object.values(ENDINGS).flat().join('|') + ')$', 'i');
    const PACK_EXT = '.atlasstickers.zip';

    let items = [], seq = 0;
    const listeners = [];

    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const list = () => items.slice();
    const get = id => items.find(r => r.id === id) || null;
    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
    const newId = () => 's' + (++seq);

    /* A name for display only (always written with textContent): no control
       characters, whitespace collapsed, capped. */
    function cleanName(v) {
        let s = typeof v === 'string' ? v : '';
        s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
        if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME).trim();
        return s || 'Sticker';
    }
    const baseName = file => cleanName(String(file || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, ''));
    /* `name`, or `name (2)`, `name (3)`... when the library already has it (P11). */
    function uniqueName(name, skipId) {
        const taken = new Set(items.filter(r => r.id !== skipId).map(r => r.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        const stem = name.replace(/ \(\d+\)$/, '');
        for (let n = 2; ; n++) { const t = `${stem} (${n})`; if (!taken.has(t.toLowerCase())) return t; }
    }

    /* FNV-1a over the pixels (with the size), to skip an image already in the library. */
    function hashCanvas(c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let h = 0x811c9dc5 ^ c.width ^ (c.height << 16);
        for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(16) + ':' + c.width + 'x' + c.height;
    }

    /* Resize with halving steps (Firefox ignores imageSmoothingQuality, so one big
       drawImage aliases into moiré; CLAUDE.md "the import resize"). */
    function resizeTo(src, tw, th) {
        let cur = src, w = src.width, h = src.height;
        while (w > 2 * tw || h > 2 * th) {
            const nw = w > 2 * tw ? Math.ceil(w / 2) : w, nh = h > 2 * th ? Math.ceil(h / 2) : h;
            const t = mk(nw, nh), x = t.getContext('2d');
            x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
            x.drawImage(cur, 0, 0, nw, nh);
            cur = t; w = nw; h = nh;
        }
        const out = mk(tw, th), x = out.getContext('2d');
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(cur, 0, 0, tw, th);
        return out;
    }
    /* The bounding box of the pixels with any alpha; null when there are none. */
    function alphaBounds(c) {
        const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (!d[(y * w + x) * 4 + 3]) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    function crop(c, b) {
        if (b.x === 0 && b.y === 0 && b.w === c.width && b.h === c.height) return c;
        const o = mk(b.w, b.h);
        o.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        return o;
    }
    /* Trim and cap an image and its maps together: the maps are first brought to the
       image's size, then cropped by the IMAGE's alpha bounds. null when fully transparent. */
    function prepare(canvas, maps) {
        const b = alphaBounds(canvas);
        if (!b) return null;
        let img = crop(canvas, b), shrunk = false;
        let mp = null;
        if (maps) {
            mp = {};
            for (const t of MAP_TYPES) {
                const m = maps[t];
                if (!m) continue;
                const same = m.width === canvas.width && m.height === canvas.height;
                mp[t] = crop(same ? m : resizeTo(m, canvas.width, canvas.height), b);
            }
            if (!Object.keys(mp).length) mp = null;
        }
        const big = Math.max(img.width, img.height);
        if (big > MAX) {
            const k = MAX / big, tw = Math.max(1, Math.round(img.width * k)), th = Math.max(1, Math.round(img.height * k));
            img = resizeTo(img, tw, th);
            if (mp) for (const t of Object.keys(mp)) mp[t] = resizeTo(mp[t], tw, th);
            shrunk = true;
        }
        return { canvas: img, maps: mp, shrunk };
    }

    /* Add one image. `o`: { canvas, name, maps, from, id }. Returns
       { rec, dupe, shrunk } or null (empty image, or the library is full). */
    function add(o, quiet) {
        if (items.length >= MAX_COUNT) return null;
        const p = prepare(o.canvas, o.maps);
        if (!p) return null;
        const hash = hashCanvas(p.canvas);
        const twin = items.find(r => r.hash === hash);
        if (twin) return { rec: twin, dupe: true, shrunk: p.shrunk };
        const id = typeof o.id === 'string' && /^s\d+$/.test(o.id) && !get(o.id) ? o.id : newId();
        const n = parseInt(id.slice(1), 10); if (n > seq) seq = n;
        const rec = { id, name: uniqueName(cleanName(o.name)), canvas: p.canvas, maps: p.maps,
                      from: ['upload', 'cut', 'psd'].includes(o.from) ? o.from : 'upload', hash };
        items.push(rec);
        if (!quiet) emit();
        return { rec, dupe: false, shrunk: p.shrunk };
    }
    function remove(id) { const n = items.length; items = items.filter(r => r.id !== id); if (items.length !== n) emit(); }
    function rename(id, name) {
        const r = get(id);
        if (!r) return null;
        r.name = uniqueName(cleanName(name), id);
        emit();
        return r.name;
    }
    function clear(quiet) { items = []; seq = 0; if (!quiet) emit(); }

    /* ---- decoding untrusted bytes ---- */
    function sniff(u8, name) {
        const b = i => u8[i];
        if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'png';
        if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
        if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'webp';
        if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'gif';
        if (b(0) === 0x42 && b(1) === 0x4d) return 'bmp';
        if (/\.tga$/i.test(name || '')) return 'tga';   // TGA has no signature at the start
        return null;
    }
    /* A Blob / File into a canvas, or null. Raster only: anything without a known
       signature (SVG, HTML, text) is refused before the browser sees it. */
    async function decode(blob, name) {
        try {
            if (!blob || blob.size > MAX_ENTRY_BYTES || blob.size < 4) return null;
            const buf = await blob.arrayBuffer(), u8 = new Uint8Array(buf), kind = sniff(u8, name);
            if (!kind) return null;
            if (kind === 'tga') {
                const c = TRLE.Engine && TRLE.Engine.decodeTGA ? TRLE.Engine.decodeTGA(buf) : null;
                return c && c.width <= MAX_DIM && c.height <= MAX_DIM ? c : null;
            }
            const bmp = await createImageBitmap(new Blob([u8], { type: 'image/' + kind }));
            if (bmp.width > MAX_DIM || bmp.height > MAX_DIM) { bmp.close(); return null; }
            const c = mk(bmp.width, bmp.height);
            c.getContext('2d').drawImage(bmp, 0, 0);
            bmp.close();
            return c;
        } catch (e) {
            return null;
        }
    }

    /* Which map a file name is, by its ending: { base, type } or null. */
    function mapTypeOf(stem) {
        const m = END_RE.exec(stem);
        if (!m) return null;
        const end = m[2].toLowerCase(), type = Object.keys(ENDINGS).find(t => ENDINGS[t].includes(end));
        return type ? { base: m[1], type } : null;
    }
    /* Decoded images [{ name, canvas }] into stickers: a file whose name ends in a map
       ending, with a colour image of the same base name beside it, becomes that image's
       map; everything else is a sticker of its own (P9). */
    function groupImages(imgs) {
        const stems = imgs.map(i => String(i.name || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, ''));
        const colour = new Map();
        const isMap = imgs.map((_, k) => { const t = mapTypeOf(stems[k]); return t && imgs.some((_, j) => j !== k && stems[j].toLowerCase() === t.base.toLowerCase() && !mapTypeOf(stems[j])) ? t : null; });
        const out = [];
        imgs.forEach((im, k) => {
            if (isMap[k]) return;
            const key = stems[k].toLowerCase();
            const s = { name: baseName(im.name), canvas: im.canvas, maps: null };
            if (!colour.has(key)) colour.set(key, s);
            out.push(s);
        });
        imgs.forEach((im, k) => {
            const t = isMap[k];
            if (!t) return;
            const s = colour.get(t.base.toLowerCase());
            if (s) (s.maps = s.maps || {})[t.type] = (s.maps[t.type] || im.canvas);
        });
        return out;
    }
    /* Add a set of decoded images; the summary a toast reports. */
    function addGroups(groups, from) {
        const sum = { added: 0, dupes: 0, shrunk: 0, empty: 0, full: 0, ids: [] };
        for (const g of groups) {
            if (items.length >= MAX_COUNT) { sum.full++; continue; }
            const r = add({ canvas: g.canvas, name: g.name, maps: g.maps, from: g.from || from, id: g.id }, true);
            if (!r) { sum.empty++; continue; }
            if (r.dupe) { sum.dupes++; continue; }
            sum.added++; sum.ids.push(r.rec.id);
            if (r.shrunk) sum.shrunk++;
        }
        if (sum.added) emit();
        return sum;
    }
    /* A layered PSD (D11): one sticker per VISIBLE pixel layer, at the layer's opacity, trimmed to
       its own pixels (TRLE.PSD pads every layer to the document). Layers named like map files pair
       with a layer of the same base name, as files do. null when the file is not a readable PSD. */
    async function psdImages(file) {
        if (!TRLE.PSD || !TRLE.PSD.isPSDFile(file)) return null;
        let doc;
        try { doc = await TRLE.PSD.read(file); } catch (e) { return null; }
        const out = [];
        for (const L of doc.layers || []) {
            if (L.hidden || !L.canvas) continue;
            let c = L.canvas;
            if (L.opacity != null && L.opacity < 1) {
                const o = mk(c.width, c.height), x = o.getContext('2d');
                x.globalAlpha = Math.max(0, L.opacity); x.drawImage(c, 0, 0); c = o;
            }
            // The leaf name, with an extension so groupImages strips nothing from a dotted name.
            out.push({ name: String(L.name || 'Layer').split('/').pop() + '.png', canvas: c });
        }
        return out;
    }
    /* Files (an upload, a folder, a drop) into the library. A pack ZIP among them is read as a
       pack, a PSD as one sticker per visible layer. */
    async function addFiles(files) {
        const sum = { added: 0, dupes: 0, shrunk: 0, empty: 0, full: 0, failed: 0, ids: [] };
        const merge = s => { for (const k of Object.keys(sum)) if (k === 'ids') sum.ids.push(...(s.ids || [])); else sum[k] += s[k] || 0; };
        const imgs = [];
        for (const f of Array.from(files || [])) {
            if (/\.zip$/i.test(f.name || '') || f.type === 'application/zip') { merge(await readPack(f)); continue; }
            if (TRLE.PSD && TRLE.PSD.isPSDFile(f)) {
                const layers = await psdImages(f);
                if (!layers) { sum.failed++; continue; }
                merge(addGroups(groupImages(layers).map(g => Object.assign(g, { from: 'psd' })), 'psd'));
                continue;
            }
            const c = await decode(f, f.name);
            if (c) imgs.push({ name: f.name, canvas: c }); else sum.failed++;
        }
        merge(addGroups(groupImages(imgs), 'upload'));
        return sum;
    }

    /* ---- packs ---- */
    const safeEntry = v => typeof v === 'string' && /^[A-Za-z0-9_. -]{1,120}$/.test(v) && !v.includes('..');
    async function canvasBlob(c) {
        if (TRLE.Engine && TRLE.Engine.canvasToBlob) return TRLE.Engine.canvasToBlob(c);
        return new Promise(res => c.toBlob(res, 'image/png'));
    }
    /* A pack ZIP of `ids` (default: the whole library). */
    async function writePack(name, ids) {
        const zip = new JSZip(), recs = ids ? items.filter(r => ids.includes(r.id)) : items;
        const man = { format: 'atlasstickers', version: 1, name: cleanName(name), stickers: [] };
        let n = 0;
        for (const r of recs) {
            const stem = 's' + (++n), e = { name: r.name, file: stem + '.png', from: r.from };
            zip.file(e.file, await canvasBlob(r.canvas));
            if (r.maps) {
                e.maps = {};
                for (const t of MAP_TYPES) if (r.maps[t]) { e.maps[t] = `${stem}.${t}.png`; zip.file(e.maps[t], await canvasBlob(r.maps[t])); }
            }
            man.stickers.push(e);
        }
        zip.file('manifest.json', JSON.stringify(man, null, 2));
        return zip.generateAsync({ type: 'blob' });
    }
    /* A pack (or any ZIP of images) into the library. With a manifest, its entries;
       without one, every image in the ZIP's root, paired by name like a folder. */
    async function readPack(file) {
        const sum = { added: 0, dupes: 0, shrunk: 0, empty: 0, full: 0, failed: 0, ids: [] };
        let zip;
        try { zip = await JSZip.loadAsync(file); } catch (e) { sum.failed++; return sum; }
        const entry = n => { const f = zip.file(n); return f && !f.dir ? f : null; };
        const size = f => (f && f._data && f._data.uncompressedSize) || 0;
        const blobOf = async n => {
            const f = safeEntry(n) ? entry(n) : null;
            if (!f || size(f) > MAX_ENTRY_BYTES) return null;
            return f.async('blob');
        };
        const manF = entry('manifest.json');
        let man = null;
        if (manF && size(manF) < 4 * 1024 * 1024) { try { man = JSON.parse(await manF.async('string')); } catch (e) { man = null; } }
        if (man && Array.isArray(man.stickers)) {
            const groups = [];
            for (const e of man.stickers.slice(0, MAX_COUNT)) {
                if (!e || typeof e !== 'object') { sum.failed++; continue; }
                const c = await decode(await blobOf(e.file), e.file);
                if (!c) { sum.failed++; continue; }
                let maps = null;
                if (e.maps && typeof e.maps === 'object') {
                    for (const t of MAP_TYPES) {
                        if (!e.maps[t]) continue;
                        const m = await decode(await blobOf(e.maps[t]), e.maps[t]);
                        if (m) (maps = maps || {})[t] = m; else sum.failed++;
                    }
                }
                groups.push({ name: e.name, canvas: c, maps, from: e.from });
            }
            const s = addGroups(groups, 'upload');
            for (const k of Object.keys(s)) if (k === 'ids') sum.ids.push(...s.ids); else sum[k] += s[k];
            return sum;
        }
        const imgs = [];
        for (const n of Object.keys(zip.files).slice(0, MAX_COUNT * 7)) {
            if (!safeEntry(n) || !/\.(png|jpe?g|webp|gif|bmp|tga)$/i.test(n)) continue;
            const c = await decode(await blobOf(n), n);
            if (c) imgs.push({ name: n, canvas: c }); else sum.failed++;
        }
        const s = addGroups(groupImages(imgs), 'upload');
        for (const k of Object.keys(s)) if (k === 'ids') sum.ids.push(...s.ids); else sum[k] += s[k];
        return sum;
    }

    /* ---- the project (D10): every sticker, whole library (A3) ---- */
    async function toProject(png) {
        if (!items.length) return null;
        const out = [];
        for (const r of items) {
            const e = { id: r.id, name: r.name, from: r.from, src: await png(r.canvas) };
            if (r.maps) { e.maps = {}; for (const t of MAP_TYPES) if (r.maps[t]) e.maps[t] = await png(r.maps[t]); }
            out.push(e);
        }
        return out;
    }
    /* `loadCanvas(v)` is the project loader's own image route (projImageSrc: data:image or
       a Blob, nothing else), returning a canvas or null. Replaces the library. */
    async function fromProject(arr, loadCanvas) {
        clear(true);
        if (Array.isArray(arr)) {
            for (const e of arr.slice(0, MAX_COUNT)) {
                if (!e || typeof e !== 'object') continue;
                const c = await loadCanvas(e.src);
                if (!c) continue;
                let maps = null;
                if (e.maps && typeof e.maps === 'object') for (const t of MAP_TYPES) {
                    if (!e.maps[t]) continue;
                    const m = await loadCanvas(e.maps[t]);
                    if (m) (maps = maps || {})[t] = m;
                }
                add({ id: e.id, name: e.name, canvas: c, maps, from: e.from }, true);
            }
        }
        emit();
    }

    return { MAX, MAX_COUNT, MAP_TYPES, ENDINGS, PACK_EXT, list, get, onChange, add, remove, rename, clear,
             decode, mapTypeOf, groupImages, addGroups, addFiles, writePack, readPack, toProject, fromProject,
             prepare, cleanName, uniqueName, hashCanvas };
})();
