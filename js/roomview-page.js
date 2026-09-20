/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   RoomView.html's own wiring — the panel, not the renderer
   ============================================================
   Split out of the page so it can be read and diffed like code rather
   than living in a <script> block. The renderer is js/roomview.js and
   knows nothing about any of this.

   The lighting panel deliberately mirrors Tomb Editor's, down to the
   controls that do nothing here: a TRLE author already has those
   reflexes, and a familiar panel with three inert boxes and a line
   saying why is better than an unfamiliar one that is merely tidy.
   ============================================================ */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const canvas = $('rv-canvas');
    const status = $('rv-status');
    const rv = TRLE.RoomView.create(canvas);
    const RL = TRLE.RoomLight;

    let asset = null, lights = [], assignment = {}, emitters = [];
    /* Startup is not finished when the room asset exists. `view.asset()` is set
       synchronously inside load(), while the handoff, the atlas decode, the
       first assignment and the first bake are all still pending -- so anything
       that waits on the asset can start asking questions of an unbaked room and
       an unpainted atlas. That was a latent race for five subphases and only
       surfaced when 2.13 shifted the load timing: a validator started failing
       about one run in three with "0 frames" and the raw 32,32,32 ambient. */
    let pageReady = false;
    let selectedLight = 0, selectedTile = 0, selectedFace = -1;
    let selection = new Set(), undoStack = [];
    let paintDrag = null, boxDrag = null;
    const MAX_UNDO = 60;
    let placeMode = null, useMaps = true;
    const MAPS = ['normal', 'ao', 'specular', 'roughness', 'emissive'];
    const mapOn = { normal: true, ao: true, specular: true, roughness: true, emissive: true };
    /* The atlas in use: either the editor's, handed over through IndexedDB, or
       the drawn placeholder when the page is opened on its own. */
    let atlasSource = null, grid = { cols: 4, rows: 4 }, tileCount = 16;
    let handoffStamp = null, handoffMaps = null;

    /* ---- placeholder art. 2.9 replaces this with the user's own atlas ---- */
    function placeholderAtlas() {
        const S = 256, T = S / 4;
        const c = document.createElement('canvas'); c.width = c.height = S;
        const x = c.getContext('2d');
        const hues = [10, 30, 50, 75, 110, 140, 165, 190, 210, 230, 260, 285, 310, 330, 350, 0];
        for (let i = 0; i < 16; i++) {
            const col = i % 4, row = (i / 4) | 0;
            x.fillStyle = 'hsl(' + hues[i] + ' 45% ' + (i === 15 ? 70 : 42) + '%)';
            x.fillRect(col * T, row * T, T, T);
            x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 2;
            x.strokeRect(col * T + 1, row * T + 1, T - 2, T - 2);
            x.fillStyle = '#000';
            x.beginPath(); x.moveTo(col * T + 3, row * T + 3);
            x.lineTo(col * T + 18, row * T + 3); x.lineTo(col * T + 3, row * T + 18); x.fill();
            x.fillStyle = '#fff'; x.font = 'bold 26px system-ui'; x.textAlign = 'center';
            x.fillText(String(i), col * T + T / 2, row * T + T / 2 + 10);
        }
        return c;
    }

    function placeholderMaps() {
        const S = 256, T = S / 4;
        const make = draw => { const c = document.createElement('canvas');
            c.width = c.height = S; draw(c.getContext('2d')); return c; };
        const normal = make(x => {
            const img = x.createImageData(S, S);
            for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
                const lx = (px % T) / T, ly = (py % T) / T, edge = 0.12;
                let nx = 0, ny = 0;
                if (lx < edge) nx = -(1 - lx / edge); else if (lx > 1 - edge) nx = (lx - (1 - edge)) / edge;
                if (ly < edge) ny = (1 - ly / edge); else if (ly > 1 - edge) ny = -(ly - (1 - edge)) / edge;
                const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
                const i = (py * S + px) * 4;
                img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
                img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                img.data[i + 3] = 255;
            }
            x.putImageData(img, 0, 0);
        });
        const ao = make(x => {
            x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
            for (let i = 0; i < 16; i++) {
                const cx = (i % 4) * T, cy = ((i / 4) | 0) * T;
                const g = x.createLinearGradient(cx, cy, cx, cy + T);
                g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.18, 'rgba(0,0,0,0)');
                g.addColorStop(0.82, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
                x.fillStyle = g; x.fillRect(cx, cy, T, T);
            }
        });
        const ramp = fn => make(x => {
            for (let i = 0; i < 16; i++) {
                const v = Math.round(fn(i) * 255);
                x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
                x.fillRect((i % 4) * T, ((i / 4) | 0) * T, T, T);
            }
        });
        const emissive = make(x => {
            x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
            x.fillStyle = '#4a2c08'; x.fillRect((9 % 4) * T, ((9 / 4) | 0) * T, T, T);
        });
        return { normal, ao, specular: ramp(i => i / 15), roughness: ramp(i => 1 - i / 15), emissive };
    }

    /* ---- the handoff ----
       The editor stitches the SAME pages it exports, writes them to a separate
       IndexedDB record and opens this page by a named target, so pressing the
       button again refreshes this view rather than opening a second one.

       Nothing here parses the editor's element graph, and that is the point:
       the Room View consumes what Tomb Editor consumes, so it previews the
       artifact that ships. If the record is missing -- the page opened on its
       own, or storage refused -- it falls back to the placeholder rather than to
       an error. */
    async function loadHandoff() {
        if (!window.TRLE || !TRLE.Store || !TRLE.Store.available()) return null;
        try {
            const rec = await TRLE.Store.loadRoomView();
            if (!rec || !rec.pages || !rec.pages.diffuse) return null;
            const decode = async blob => {
                const bmp = await createImageBitmap(blob);
                const c = document.createElement('canvas');
                c.width = bmp.width; c.height = bmp.height;
                c.getContext('2d').drawImage(bmp, 0, 0);
                bmp.close();
                return c;
            };
            const out = { manifest: rec.manifest, diffuse: await decode(rec.pages.diffuse), maps: {} };
            for (const k of ['normal', 'ao', 'specular', 'roughness', 'emissive']) {
                if (rec.pages[k]) out.maps[k] = await decode(rec.pages[k]);
            }
            return out;
        } catch (e) { console.warn('Room View handoff unavailable:', e); return null; }
    }

    /* Re-read on focus, but ONLY when the editor has marked the handoff stale by
       writing a new stamp. Alt-tabbing back must not trigger a re-bake, and a
       preview that silently shows an older atlas than the editor is worse than
       one that says so. */
    async function checkStale() {
        if (handoffStamp == null) return;
        try {
            const rec = await TRLE.Store.loadRoomView();
            if (rec && rec.manifest && rec.manifest.stamp !== handoffStamp) location.reload();
        } catch { /* leave it alone */ }
    }
    addEventListener('focus', checkStale);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStale(); });

    /* ---- the bake, in two qualities ----
       Reduced quality while a control is being dragged, full quality when it is
       released. Tomb Editor does exactly this, and it was fixed as an invariant
       before any of it was measured, so the 1/9/25 numbers confirm a budget
       rather than choosing a design. */
    let bakeTimer = 0, lastColours = null, lastQuality = null;
    function relight(quality) {
        if (!asset) return;
        const t0 = performance.now();
        const ls = lights.filter(L => L.enabled !== false)
                         .map(L => Object.assign({}, L, { quality: quality || L.quality || 'low' }));
        const mesh = rv.mesh();
        const colours = RL.bake(mesh, ls, RL.ambientFromSwatch(asset.ambient), {
            visibility: RL.makeVisibility(mesh, ls, { heightField: RL.buildHeightField(mesh) })
        });
        rv.setVertexColours(colours);
        lastColours = colours; lastQuality = quality || null;
        status.textContent = asset.name + ' · '
                           + (atlasSource === 'editor' ? 'your atlas' : 'sample atlas')
                           + ' · ' + ls.length + ' lights · baked in '
                           + Math.round(performance.now() - t0) + ' ms';
    }
    const relightSoon = () => { clearTimeout(bakeTimer); bakeTimer = setTimeout(() => relight('low'), 90); };
    const relightFull = () => { clearTimeout(bakeTimer); relight(null); };

    /* A DRAG cannot use the trailing debounce above. Something resets it every
       16 ms, so it never fires until the drag stops, and the room would sit
       unlit under the pointer the whole time. That is the same trap
       demo-runner.js records for slider sweeps.

       So a drag re-bakes at most once per animation frame at Default quality,
       which section 2b.0 measured at 14 ms for the real room. Full quality on
       release, which is the cadence 2.8 already built. */
    let bakePending = false;
    function relightFrame() {
        if (bakePending) return;
        bakePending = true;
        requestAnimationFrame(() => { bakePending = false; relight('low'); });
    }

    /* ---- lighting panel ---- */
    const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

    function drawLightList() {
        const ul = $('rv-lights');
        ul.innerHTML = '';
        lights.forEach((L, i) => {
            const li = document.createElement('li');
            if (i === selectedLight) li.className = 'sel';
            const sw = document.createElement('span');
            sw.className = 'swatch'; sw.style.background = hex(L.colour);
            li.appendChild(sw);
            li.appendChild(document.createTextNode(
                (L.type === 'sun' ? 'Sun' : L.type === 'spot' ? 'Spot'
                    : L.intensity < 0 ? 'Shadow' : 'Point')
                + ' · ' + L.intensity.toFixed(2)));
            li.onclick = () => { selectedLight = i; drawLightList(); loadLightForm(); };
            ul.appendChild(li);
        });
        refreshMarkers();
    }

    /* A marker's tint is the light's colour NORMALISED, not the colour itself.
       A sprite is there to be found, and the fixture sun is authored at
       (60, 63, 65), which as a tint is very nearly black against a dark room.
       The list swatch beside it still shows the true colour, so nothing is
       hidden by this. */
    function markerTint(L) {
        if (L.intensity < 0) return [0.3, 0.8, 1];        // a shadow bulb, as before
        const m = Math.max(L.colour[0], L.colour[1], L.colour[2], 1);
        return [L.colour[0] / m, L.colour[1] / m, L.colour[2] / m];
    }

    /* Lights and flame emitters share one marker list, because from the user's
       side they are all "a thing in the room that emits light" even though only
       one of them survives the bake. */
    function refreshMarkers() {
        const out = [];
        lights.forEach((L, i) => {
            if (L.enabled === false) return;
            out.push({ position: L.position, colour: markerTint(L),
                       icon: L.type === 'sun' ? 'sun' : L.type === 'spot' ? 'spot' : 'point',
                       selected: i === selectedLight });
        });
        if ($('rv-flame').checked) emitters.forEach((e, i) => {
            if (e.enabled === false) return;
            /* Tagged with its index so the renderer can move the sprite with a
               travelling emitter; the page is not in the 30 Hz loop. */
            out.push({ position: e.position.slice(), colour: [1, 0.55, 0.15],
                       icon: 'flame', emitter: i });
        });
        rv.setMarkers(out);
        refreshGizmo();
    }

    /* The gizmo follows the selected light. `dir` is the direction the light
       POINTS, so the handle sits where the light is aimed rather than where it
       came from, which is the reading that matches a spot cone. */
    function refreshGizmo() {
        const L = lights[selectedLight];
        if (!L || L.enabled === false) { rv.setGizmo(null); return; }
        let dir = null;
        if (L.type === 'sun' || L.type === 'spot') {
            const l = RL.sunDirection(L.dirX, L.dirY);
            dir = [-l[0], -l[1], -l[2]];
        }
        rv.setGizmo({ position: L.position, dir });
    }

    /* ---- dragging a handle ----
       Axis drags project the pointer delta onto the axis as it appears ON
       SCREEN, which is the only reading that behaves the same whichever way the
       camera is facing. The direction handle drags against a sphere instead,
       because what it edits is an angle pair and not a position. */
    let gdrag = null;
    const canvasXY = e => {
        const r = canvas.getBoundingClientRect();
        return [Math.round((e.clientX - r.left) * devicePixelRatio),
                Math.round((e.clientY - r.top) * devicePixelRatio)];
    };

    function beginDrag(handle, x, y) {
        const L = lights[selectedLight], pts = rv.gizmoPoints();
        if (!L || !pts || !pts.tips[handle]) return false;
        const p0 = rv.project(L.position), p1 = rv.project(pts.tips[handle]);
        const tip = pts.tips[handle];
        const away = handle === 'dir' && (() => {
            /* Which half of the sphere the handle starts on. A sphere drag
               normally takes the NEAR intersection, which is right while the
               handle faces the camera and wrong the moment it does not: grabbing
               a handle that points away would snap it to the front before the
               pointer had moved. */
            const r = rv.rayFrom(x, y);
            const a = [tip[0] - L.position[0], tip[1] - L.position[1], tip[2] - L.position[2]];
            return a[0] * r.dir[0] + a[1] * r.dir[1] + a[2] * r.dir[2] > 0;
        })();
        gdrag = {
            handle, x, y, away, start: L.position.slice(),
            axisScreen: (p0 && p1) ? [p1[0] - p0[0], p1[1] - p0[1]] : null,
            reach: Math.hypot(tip[0] - L.position[0], tip[1] - L.position[1], tip[2] - L.position[2])
        };
        return true;
    }

    function moveDrag(x, y) {
        const L = lights[selectedLight];
        if (!gdrag || !L) return;
        if (gdrag.handle === 'dir') {
            const r = rv.rayFrom(x, y), C = gdrag.start, R = gdrag.reach;
            const oc = [r.origin[0] - C[0], r.origin[1] - C[1], r.origin[2] - C[2]];
            const b = oc[0] * r.dir[0] + oc[1] * r.dir[1] + oc[2] * r.dir[2];
            const cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - R * R;
            const disc = b * b - cc;
            let P;
            if (disc >= 0) {
                const t = gdrag.away ? -b + Math.sqrt(disc) : -b - Math.sqrt(disc);
                P = [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t];
            } else {
                /* Past the silhouette the ray misses the sphere entirely. Take
                   its closest approach and push that out to the surface, so the
                   handle keeps following the pointer instead of sticking at the
                   rim. */
                const t = -b;
                const q = [r.origin[0] + r.dir[0] * t - C[0],
                           r.origin[1] + r.dir[1] * t - C[1],
                           r.origin[2] + r.dir[2] * t - C[2]];
                const m = Math.hypot(q[0], q[1], q[2]) || 1;
                P = [C[0] + q[0] / m * R, C[1] + q[1] / m * R, C[2] + q[2] / m * R];
            }
            const ax = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
            const m = Math.hypot(ax[0], ax[1], ax[2]) || 1;
            // the handle shows where it POINTS; the angles describe the direction TOWARD it
            const a = RL.sunAngles([-ax[0] / m, -ax[1] / m, -ax[2] / m]);
            L.dirX = +a.dirX.toFixed(2);
            L.dirY = +a.dirY.toFixed(2);
            if (selectedLight === sunIndex()) dayDesync();
            loadLightForm();
        } else {
            const A = gdrag.axisScreen;
            if (!A) return;
            const len2 = A[0] * A[0] + A[1] * A[1];
            if (len2 < 1) return;                      // the axis points at the camera
            const t = ((x - gdrag.x) * A[0] + (y - gdrag.y) * A[1]) / len2 * gdrag.reach;
            const i = { x: 0, y: 1, z: 2 }[gdrag.handle];
            L.position = gdrag.start.slice();
            L.position[i] = gdrag.start[i] + t;
        }
        drawLightList();
        relightFrame();
    }

    /* Which light sprite is under a pixel, or -1. Screen space rather than the
       id buffer: a sprite is a fixed number of pixels wide whatever it is
       standing on, so its hit area is a screen-space circle by definition. */
    function spriteAt(x, y) {
        const half = rv.markerPixelSize() / 2;
        let best = -1, bestD = half;
        lights.forEach((L, i) => {
            if (L.enabled === false) return;
            const p = rv.project(L.position);
            if (!p) return;
            const d = Math.hypot(p[0] - x, p[1] - y);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    }

    function loadLightForm() {
        const L = lights[selectedLight];
        if (!L) return;
        $('rv-ltype').value = L.type === 'sun' ? 'sun' : L.type === 'spot' ? 'spot'
                             : (L.intensity < 0 ? 'shadow' : 'point');
        $('rv-lcolour').value = hex(L.colour);
        $('rv-lint').value = L.intensity;
        $('rv-lin').value = L.innerRange != null ? L.innerRange : 1;
        $('rv-lout').value = L.outerRange != null ? L.outerRange : 5;
        $('rv-ldirx').value = L.dirX != null ? L.dirX : -90;
        $('rv-ldiry').value = L.dirY != null ? L.dirY : 0;
        $('rv-lina').value = L.innerAngle != null ? L.innerAngle : RL.DEFAULT_INNER_ANGLE;
        $('rv-louta').value = L.outerAngle != null ? L.outerAngle : RL.DEFAULT_OUTER_ANGLE;
        $('rv-lenabled').checked = L.enabled !== false;
        $('rv-lobstruct').checked = L.obstruct !== false;
        $('rv-lquality').value = L.quality || 'low';
        /* Tomb Editor greys the controls a type does not use rather than hiding
           them, so the panel does not reflow as you switch type. */
        const sun = L.type === 'sun', spot = L.type === 'spot';
        $('rv-lcolour').disabled = sun && selectedLight === sunIndex() && dayRamp();
        $('rv-lin').disabled = sun; $('rv-lout').disabled = sun;
        $('rv-ldirx').disabled = !sun && !spot; $('rv-ldiry').disabled = !sun && !spot;
        $('rv-lina').disabled = !spot; $('rv-louta').disabled = !spot;
    }

    function readLightForm() {
        const L = lights[selectedLight];
        if (!L) return;
        const t = $('rv-ltype').value;
        L.type = t === 'sun' ? 'sun' : t === 'spot' ? 'spot' : 'point';
        L.colour = unhex($('rv-lcolour').value);
        L.intensity = parseFloat($('rv-lint').value) || 0;
        L.innerRange = parseFloat($('rv-lin').value);
        L.outerRange = parseFloat($('rv-lout').value);
        L.dirX = parseFloat($('rv-ldirx').value);
        L.dirY = parseFloat($('rv-ldiry').value);
        L.innerAngle = parseFloat($('rv-lina').value);
        L.outerAngle = parseFloat($('rv-louta').value);
        L.enabled = $('rv-lenabled').checked;
        L.obstruct = $('rv-lobstruct').checked;
        L.quality = $('rv-lquality').value;
        /* Whatever colour you set by hand becomes the ramp's base, or the next
           slider move would warm a colour you have since replaced. */
        if (selectedLight === sunIndex() && !dayRamp()) { dayLight = L; dayBase = L.colour.slice(); }
        drawLightList();
    }

    ['rv-lcolour', 'rv-lint', 'rv-lin', 'rv-lout', 'rv-ldirx', 'rv-ldiry',
     'rv-lina', 'rv-louta'].forEach(id => {
        $(id).addEventListener('input',  () => { readLightForm(); relightSoon(); });
        $(id).addEventListener('change', () => { readLightForm(); relightFull(); });
    });
    ['rv-ldirx', 'rv-ldiry'].forEach(id =>
        $(id).addEventListener('input', () => { if (selectedLight === sunIndex()) dayDesync(); }));
    ['rv-lenabled', 'rv-lobstruct', 'rv-lquality', 'rv-ltype'].forEach(id =>
        $(id).addEventListener('change', () => { readLightForm(); loadLightForm(); relightFull(); }));

    $('rv-ladd').onclick = () => {
        const t = $('rv-ltype').value;
        lights.push({ type: t === 'sun' ? 'sun' : t === 'spot' ? 'spot' : 'point',
                      colour: [255, 220, 170],
                      intensity: t === 'shadow' ? -0.4 : t === 'spot' ? 1.0 : 0.5,
                      innerRange: 1, outerRange: 5,
                      innerAngle: RL.DEFAULT_INNER_ANGLE, outerAngle: RL.DEFAULT_OUTER_ANGLE,
                      dirX: t === 'spot' ? -45 : -90, dirY: 0,
                      position: [0, 1, 0], enabled: true, obstruct: true, quality: 'low' });
        selectedLight = lights.length - 1;
        drawLightList(); loadLightForm(); relightFull();
        placeMode = 'light';
        status.textContent = 'Click in the room to place the light';
    };
    $('rv-ldel').onclick = () => {
        if (lights.length <= 1) return;
        lights.splice(selectedLight, 1);
        selectedLight = Math.max(0, selectedLight - 1);
        drawLightList(); loadLightForm(); relightFull();
    };

    /* ---- texturing ---- */
    /* The palette is the atlas's OWN tile grid, however many tiles that is. It
       used to hardcode a 4x4 sheet, which is only ever right for the
       placeholder. */
    function drawPalette(atlas) {
        const wrap = $('rv-palette');
        wrap.innerHTML = '';
        wrap.style.gridTemplateColumns = 'repeat(' + Math.min(grid.cols, 8) + ', 1fr)';
        const url = atlas.toDataURL();
        const px = grid.cols > 1 ? 100 / (grid.cols - 1) : 0;
        const py = grid.rows > 1 ? 100 / (grid.rows - 1) : 0;
        for (let i = 0; i < tileCount; i++) {
            const b = document.createElement('button');
            b.style.backgroundImage = 'url(' + url + ')';
            b.style.backgroundSize = (grid.cols * 100) + '% ' + (grid.rows * 100) + '%';
            b.style.backgroundPosition = ((i % grid.cols) * px) + '% ' + (((i / grid.cols) | 0) * py) + '%';
            b.title = 'Tile ' + i;
            if (i === selectedTile) b.className = 'sel';
            b.onclick = () => { selectedTile = i; drawPalette(atlas); };
            wrap.appendChild(b);
        }
    }

    /* ---- texturing: selection and undo (2.20) ----
       Undo covers the face-to-tile assignment and nothing else, which is what
       the author asked for. It is cheap because the assignment is a plain map
       that every operation REPLACES rather than mutates -- assignRole's own
       comment has said so since 2.5 -- so a snapshot is a shallow copy. */
    function pushUndo() {
        undoStack.push(Object.assign({}, assignment));
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        $('rv-undo').disabled = false;
    }
    function undo() {
        if (!undoStack.length) return false;
        assignment = undoStack.pop();
        rv.setAssignment(assignment);
        $('rv-undo').disabled = undoStack.length === 0;
        status.textContent = 'undone';
        return true;
    }

    function setSelection(next) {
        selection = next;
        rv.setSelection(selection);
        const n = selection.size;
        $('rv-applysel').disabled = n === 0;
        $('rv-clearsel').disabled = n === 0;
        $('rv-selnote').textContent = n === 0 ? 'Nothing selected.'
            : n + (n === 1 ? ' face selected.' : ' faces selected.');
    }

    /* Paint a list of faces in ONE operation. The caller pushes undo once for
       the whole stroke, never per face: a thirty-face sweep that took thirty
       undos to put back is the bug the context menu already has a rule about. */
    function paintFaces(ids) {
        if (!ids.length) return 0;
        const next = Object.assign({}, assignment);
        for (const fi of ids)
            next[fi] = Object.assign({ tile: selectedTile, rot: 0, flip: false },
                                     next[fi], { tile: selectedTile });
        assignment = next;
        rv.setAssignment(assignment);
        return ids.length;
    }

    const setFace = (fi, patch) => {
        assignment = Object.assign({}, assignment,
            { [fi]: Object.assign({ tile: selectedTile, rot: 0, flip: false }, assignment[fi], patch) });
        rv.setAssignment(assignment);
    };

    $('rv-paint').onclick = () => {
        if (!asset) return;
        pushUndo();
        assignment = TRLE.RoomUV.assignRole(asset, assignment, $('rv-role').value, selectedTile);
        rv.setAssignment(assignment);
    };
    $('rv-applysel').onclick = () => {
        if (!selection.size) return;
        pushUndo();
        const n = paintFaces([...selection]);
        status.textContent = 'painted ' + n + (n === 1 ? ' face' : ' faces');
    };
    $('rv-clearsel').onclick = () => setSelection(new Set());
    $('rv-undo').onclick = undo;
    addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
        else if (e.key === 'Escape' && selection.size) { setSelection(new Set()); e.preventDefault(); }
    });
    $('rv-rot').onclick = () => {
        if (selectedFace < 0) return;
        const a = assignment[selectedFace] || { tile: selectedTile, rot: 0, flip: false };
        setFace(selectedFace, { rot: ((a.rot | 0) + 1) % 4 });
    };
    $('rv-flip').onclick = () => {
        if (selectedFace < 0) return;
        const a = assignment[selectedFace] || { tile: selectedTile, rot: 0, flip: false };
        setFace(selectedFace, { flip: !a.flip });
    };

    /* ---- materials: the gated half of the two-stage flow ---- */

    /* Which maps the renderer should be holding right now. Passing a subset is
       all a toggle needs: the shader already has a per-map flag and binds every
       sampler to a real unit whether or not its map exists. */
    function currentMaps() {
        if (!useMaps) return null;
        const all = handoffMaps || placeholderMaps();
        const out = {};
        for (const k of MAPS) if (mapOn[k] && all[k]) out[k] = all[k];
        return out;
    }

    /* Three of the five maps do NOTHING in a room with no dynamic light in it,
       and that falls straight out of how the room is composed rather than being
       a limitation of this preview:

         normal      the baked term is a VERTEX attribute, so it cannot respond
                     to a per-pixel normal at all
         specular    exists only inside the dynamic light loop
         roughness   only shapes specular, so it inherits specular's condition

       AO multiplies the finished pixel and emissive is added after the loop, so
       those two work on baked light alone. An unticked box that does nothing is
       exactly the kind of state this project has a memory about, so the panel
       names the condition instead of leaving it to be discovered. */
    const DYNAMIC_ONLY = ['normal', 'specular', 'roughness'];
    function mapAdvice() {
        const el = $('rv-mapadvice');
        if (!useMaps) { el.textContent = 'Maps are off, so the room is diffuse only.'; return; }
        const lit = $('rv-flame').checked && emitters.length > 0;
        const waiting = DYNAMIC_ONLY.filter(k => mapOn[k]);
        if (!waiting.length) {
            el.textContent = 'AO and Emissive work on baked light alone.';
        } else if (lit) {
            el.textContent = 'A flame is in the room, so Normal, Specular and Roughness can show '
                           + 'where it reaches. Carry it around to see more of them.';
        } else {
            el.textContent = 'Normal, Specular and Roughness need a dynamic light and there is '
                           + 'none. Baked light is a vertex colour, so it cannot respond to a '
                           + 'normal map, and specular only exists where a dynamic light reaches. '
                           + 'Turn a flame on.';
        }
    }

    function refreshMaps() {
        rv.setMaps(currentMaps());
        for (const k of MAPS) $('rv-map-' + k).disabled = !useMaps;
        mapAdvice();
    }

    $('rv-usemaps').onchange = e => { useMaps = e.target.checked; refreshMaps(); };
    MAPS.forEach(k => $('rv-map-' + k).addEventListener('change', e => {
        mapOn[k] = e.target.checked;
        refreshMaps();
    }));
    $('rv-apply').onclick = async () => {
        const bar = $('rv-bar'), fill = bar.firstElementChild;
        bar.classList.add('on'); fill.style.width = '10%';
        await new Promise(r => setTimeout(r, 0));
        rv.setMaps(currentMaps());
        fill.style.width = '55%';
        await new Promise(r => setTimeout(r, 0));
        relightFull();
        fill.style.width = '100%';
        setTimeout(() => { bar.classList.remove('on'); fill.style.width = '0'; }, 400);
    };

    /* ---- clicking in the room ---- */
    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !asset) return;
        const [cx, cy] = canvasXY(e);

        /* PRECEDENCE, decided once here and extended by 2.20:
           gizmo handle, then light sprite, then face.
           The handle half is free -- the pick pass draws the handles after the
           faces with the depth test off, so the id buffer already answers it. */
        const at = rv.pickAt(cx, cy);
        if (at.handle && beginDrag(at.handle, cx, cy)) {
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }
        const sprite = spriteAt(cx, cy);
        if (sprite >= 0 && !placeMode) {
            selectedLight = sprite;
            drawLightList(); loadLightForm();
            status.textContent = 'selected light ' + (sprite + 1);
            return;
        }

        /* Shift adds to the selection and Alt takes away, either as a box or,
           with no movement, as a single face. A plain drag paints. */
        if ((e.shiftKey || e.altKey) && !placeMode) {
            boxDrag = { x0: cx, y0: cy, x1: cx, y1: cy, sub: e.altKey && !e.shiftKey };
            drawBand();
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        const hit = rv.pickPoint(cx, cy);
        if (!hit) return;
        if (placeMode && hit.point) {
            const n = asset.normals[asset.faces[hit.face].ni];
            // lift it off the surface it was dropped on, or the bulb sits inside it
            const p = [hit.point[0] + n[0] * 0.35, hit.point[1] + n[1] * 0.35, hit.point[2] + n[2] * 0.35];
            if (placeMode === 'light') { lights[selectedLight].position = p; drawLightList(); relightFull(); }
            else { emitters[0].position = p; emitters[0].home = p.slice();
                   applyTravel(); }
            placeMode = null;
            status.textContent = 'placed';
            return;
        }
        /* ONE undo entry for the whole stroke, pushed here and never in the
           move handler. */
        pushUndo();
        selectedFace = hit.face;
        paintFaces([hit.face]);
        paintDrag = { last: [cx, cy], seen: new Set([hit.face]) };
        canvas.setPointerCapture(e.pointerId);
        status.textContent = 'painted face ' + hit.face + ' (' + asset.faces[hit.face].role + ')';
    });

    function drawBand() {
        const b = $('rv-band');
        if (!boxDrag) { b.classList.remove('on'); return; }
        const d = devicePixelRatio;
        b.style.left   = Math.min(boxDrag.x0, boxDrag.x1) / d + 'px';
        b.style.top    = Math.min(boxDrag.y0, boxDrag.y1) / d + 'px';
        b.style.width  = Math.abs(boxDrag.x1 - boxDrag.x0) / d + 'px';
        b.style.height = Math.abs(boxDrag.y1 - boxDrag.y0) / d + 'px';
        b.classList.add('on');
    }

    function commitBox() {
        const ids = rv.pickBox(boxDrag.x0, boxDrag.y0, boxDrag.x1, boxDrag.y1);
        const next = new Set(selection);
        for (const fi of ids) { if (boxDrag.sub) next.delete(fi); else next.add(fi); }
        setSelection(next);
        status.textContent = (boxDrag.sub ? 'deselected ' : 'selected ') + ids.length
                           + (ids.length === 1 ? ' face' : ' faces');
    }

    /* A pointer move is THROTTLED TO A FRAME, not handled per event. A 120 Hz
       mouse delivers twice as many moves as there are frames and painting the
       same face twice in one frame is wasted work -- the same reasoning
       demo-runner.js records for slider sweeps.

       What is NOT thrown away is the distance covered: the sweep between the
       last handled position and this one is picked as a SEGMENT, so a fast
       flick paints every face it crossed rather than the two it was sampled
       over. */
    let pendingPaint = null, paintQueued = false;
    function servicePaint() {
        paintQueued = false;
        if (!paintDrag || !pendingPaint) return;
        const [px, py] = pendingPaint; pendingPaint = null;
        const ids = rv.pickSegment(paintDrag.last[0], paintDrag.last[1], px, py);
        paintDrag.last = [px, py];
        const fresh = ids.filter(fi => !paintDrag.seen.has(fi));
        fresh.forEach(fi => paintDrag.seen.add(fi));
        if (fresh.length) {
            paintFaces(fresh);
            status.textContent = 'painted ' + paintDrag.seen.size + ' faces';
        }
    }
    canvas.addEventListener('pointermove', e => {
        const [x, y] = canvasXY(e);
        if (gdrag) { moveDrag(x, y); return; }
        if (boxDrag) { boxDrag.x1 = x; boxDrag.y1 = y; drawBand(); return; }
        if (paintDrag) {
            pendingPaint = [x, y];
            if (!paintQueued) { paintQueued = true; requestAnimationFrame(servicePaint); }
        }
    });
    const endPointer = () => {
        if (gdrag) { gdrag = null; relightFull(); }
        if (paintDrag) paintDrag = null;
        if (boxDrag) { commitBox(); boxDrag = null; drawBand(); }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', () => {
        gdrag = null; paintDrag = null; boxDrag = null; drawBand();
    });

    /* The travelling flame. No re-bake at any point: a flame is a dynamic
       light, so moving it costs one more light in a loop that already runs. */
    function applyTravel() {
        const on = $('rv-flametravel').checked;
        const radius = parseFloat($('rv-flameradius').value) || 0;
        const seconds = parseFloat($('rv-flamesecs').value) || 8;
        for (const e of emitters) {
            if (!on || radius <= 0) { delete e.path; continue; }
            e.path = { radius, seconds, centre: e.home || (e.home = e.position.slice()),
                       height: (e.home || e.position)[1] };
        }
        $('rv-flameradius').disabled = !on;
        $('rv-flamesecs').disabled = !on;
        rv.setEmitters($('rv-flame').checked ? emitters : []);
        refreshMarkers();
    }
    ['rv-flametravel', 'rv-flameradius', 'rv-flamesecs'].forEach(id =>
        $(id).addEventListener('change', applyTravel));
    $('rv-flame').onchange = e => { rv.setEmitters(e.target.checked ? emitters : []);
                                    refreshMarkers(); mapAdvice(); };
    $('rv-flameplace').onclick = () => {
        placeMode = 'flame';
        status.textContent = 'Click in the room to place the flame';
    };
    /* ---- the daylight sweep ----

       One slider swings the first Sun along an arc and the room re-lights as it
       goes. The arc is chosen, not measured, and it is worth saying which half
       of this is which:

         The ANGLES are Tomb Editor's. Dir X is elevation, -90 straight down and
         0 on the horizon; Dir Y is the bearing, with the sign the panel shows
         (research 29.1). The slider's MIDDLE is exactly the room's shipped sun,
         Dir X -90 / Dir Y 0, so loading the page and touching nothing changes
         no vertex at all -- which is asserted, and is why no reference PNG
         moved in this subphase.

         The COLOUR ramp is OURS. Tomb Editor has nothing like it. So it sits
         behind a checkbox that says so, it multiplies the sun you built rather
         than replacing it with a colour we picked, and unticking it restores
         that colour exactly. The requirement the plan set is that unticking it
         gives a bake BYTE-IDENTICAL to typing the same two angles into the
         panel by hand, and the way that is made structural rather than lucky is
         that both paths write the same integers: the sweep rounds Dir X and
         Dir Y to whole degrees, which is the number input's own step.

       Cadence is 2.8's, unchanged: Default quality while the slider moves or
       Play runs, full quality when it stops. Section 2b.0 measured a complete
       re-bake at 14 ms, which is what makes an animated sun affordable at all.

       The slider position is kept as a FLOAT beside the input rather than read
       back off it. A range input snaps to its own step, and a 12-second day
       advances 0.33 steps per frame at 60fps, so reading the value back would
       round every frame's advance to zero and Play would sit still. */
    const DAY_STEPS = 240;          // the slider's range, ~3 clock minutes each
    const DAY_SECONDS = 12;         // dawn to dusk, when Play is running
    /* Multiplied into the sun's own colour at the horizon, easing to 1 at noon,
       so a grey sun stays grey and a warm one gets warmer. Ours. */
    const DAY_WARM = [1, 0.72, 0.45];

    let dayPos = DAY_STEPS / 2;     // float; the input is its rounded mirror
    let dayBase = null;             // the sun's colour before the ramp touched it
    let dayLight = null;            // WHICH light that base belongs to
    let daySynced = true;           // false once something else moved the sun
    let dayRaf = 0, dayLast = 0;

    const sunIndex = () => lights.findIndex(L => L.type === 'sun');
    const dayRamp = () => $('rv-dayramp').checked;
    const dayT = () => dayPos / DAY_STEPS;

    /* Elevation is a half sine, so both ends sit on the horizon and the middle
       is overhead; the bearing is a straight sweep through 0. Rounded here, and
       only here, so every writer downstream agrees on the integer. */
    function dayAngles(t) {
        return { dirX: Math.round(-90 * Math.sin(Math.PI * t)),
                 dirY: Math.round(-90 + 180 * t) };
    }
    function dayTint(t) {
        const k = Math.sin(Math.PI * t);          // 0 at the horizon, 1 at noon
        return DAY_WARM.map(w => w + (1 - w) * k);
    }
    function dayClock(t) {
        const m = Math.round((6 + 12 * t) * 60);  // 06:00 to 18:00
        return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }

    function applyDaylight(bake) {
        const i = sunIndex(), t = dayT(), a = dayAngles(t), has = i >= 0;
        $('rv-daytime').disabled = !has;
        $('rv-dayplay').disabled = !has;
        if (!has) {
            $('rv-dayread').textContent = 'no Sun in the list';
            dayLight = null; dayBase = null;
            return;
        }
        const L = lights[i];
        /* The base belongs to a LIGHT, not to an index. Keying it on the index
           would hand a newly-driven sun the previous one's base, and since the
           previous one's stored colour is already tinted, the new sun would be
           warmed twice. */
        if (L !== dayLight) { dayLight = L; dayBase = L.colour.slice(); }
        L.dirX = a.dirX; L.dirY = a.dirY;
        if (dayRamp()) {
            const tn = dayTint(t);
            L.colour = dayBase.map((v, k) => Math.max(0, Math.min(255, Math.round(v * tn[k]))));
        }
        daySynced = true;
        $('rv-dayread').textContent = dayClock(t) + ' · ' + a.dirX + ' / ' + a.dirY;
        if (selectedLight === i) loadLightForm();
        drawLightList();
        refreshMarkers();
        if (bake) bake();
    }

    /* The readout must never claim an angle the sun no longer has. Anything
       else that writes the driven sun's direction -- the panel, the gizmo's
       yellow handle -- says so, and the slider stops pretending to describe it
       until it is moved again. */
    function dayDesync() {
        if (!daySynced) return;
        const i = sunIndex();
        if (i < 0) return;
        daySynced = false;
        $('rv-dayread').textContent = 'hand-set · ' + Math.round(lights[i].dirX)
                                    + ' / ' + Math.round(lights[i].dirY);
    }

    function setDayPos(p, bake) {
        dayPos = Math.max(0, Math.min(DAY_STEPS, p));
        $('rv-daytime').value = String(Math.round(dayPos));
        applyDaylight(bake);
    }

    /* Repo-wide rule, and here it has teeth beyond politeness: run-validators
       kills a validator at 300 s, and the demo course already paid for learning
       that. Play collapses to its end state, which is dusk. */
    const dayReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setDayPlaying(on) {
        $('rv-dayplay').textContent = on ? '■ Stop' : '▶ Play';
    }
    function stopDay(full) {
        if (!dayRaf) return;
        cancelAnimationFrame(dayRaf); dayRaf = 0;
        setDayPlaying(false);
        if (full !== false) relightFull();
    }
    function playDay() {
        if (dayRaf) { stopDay(); return; }
        if (sunIndex() < 0) return;
        if (dayPos >= DAY_STEPS) dayPos = 0;      // a second press restarts the day
        if (dayReduced()) { setDayPos(DAY_STEPS, relightFull); return; }
        setDayPlaying(true);
        dayLast = performance.now();
        const step = now => {
            const dt = Math.min(0.25, (now - dayLast) / 1000);
            dayLast = now;
            setDayPos(dayPos + dt / DAY_SECONDS * DAY_STEPS, () => relight('low'));
            if (dayPos >= DAY_STEPS) { dayRaf = 0; setDayPlaying(false); relightFull(); return; }
            dayRaf = requestAnimationFrame(step);
        };
        dayRaf = requestAnimationFrame(step);
    }

    $('rv-daytime').addEventListener('input',  () => { stopDay(false); setDayPos(+$('rv-daytime').value, relightFrame); });
    $('rv-daytime').addEventListener('change', () => setDayPos(+$('rv-daytime').value, relightFull));
    $('rv-dayplay').onclick = playDay;
    $('rv-dayramp').onchange = () => {
        const i = sunIndex();
        if (i < 0) { applyDaylight(null); return; }
        if (dayRamp()) { dayLight = lights[i]; dayBase = lights[i].colour.slice(); }
        else if (dayBase && dayLight === lights[i]) lights[i].colour = dayBase.slice();
        applyDaylight(relightFull);
    };

    $('rv-fov').onchange = e => rv.setFov(+e.target.value);

    /* Measures the STAGE rather than the canvas, so the size it reads can never
       be the size it just wrote, and it ignores a call that would change
       nothing. Both halves matter: a ResizeObserver fires once when observation
       starts and again on every layout pass, so an unguarded fit() re-sizes the
       canvas at moments nothing asked it to -- which wipes the drawing buffer
       and throws away a frame something else had just rendered into it. That
       showed up immediately as a validator failing about one run in three with
       "0 frames" and a near-empty picture. */
    let fitW = 0, fitH = 0;
    function fit() {
        const r = canvas.parentElement.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width * devicePixelRatio));
        const h = Math.max(1, Math.round(r.height * devicePixelRatio));
        if (w === fitW && h === fitH) return;
        fitW = w; fitH = h;
        rv.resize(w, h);
    }
    /* The canvas backing store follows the STAGE, not the window.

       Collapsing the dock changes the stage's size with no resize event at all,
       so a window listener on its own leaves the canvas at its previous size:
       the rendered aspect is then wrong, and because this renderer states its
       field of view HORIZONTALLY the vertical angle silently changes with it.
       Nothing throws and nothing looks broken, the picture is just quietly a
       different lens. A ResizeObserver covers every cause rather than every
       cause we happened to think of. */
    if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas.parentElement);
    addEventListener('resize', fit);        // backstop where there is no observer

    /* ---- the dock ----
       Tomb Editor's Lighting panel is a strip along the bottom, so this one is
       too. It collapses because height is the one thing a room view cannot get
       back, and this is the only chrome that takes any. */
    const dock = $('rv-dock'), dockToggle = $('rv-dock-toggle');
    function setDock(open) {
        dock.classList.toggle('closed', !open);
        dockToggle.textContent = open ? '\u25be' : '\u25b8';
        dockToggle.setAttribute('aria-expanded', String(open));
        $('rv-dock-cap').textContent = open ? '' : 'collapsed, click to show the lights';
        fit();
    }
    dockToggle.onclick = () => setDock(dock.classList.contains('closed'));

    /* ---- start ---- */
    rv.load('rooms/room0.json').then(async a => {
        asset = a;
        const w2r = p => RL.worldToRoom(p, a.centre);
        lights = [
            { type: 'sun',   colour: [60, 63, 65],  intensity: 0.50, dirX: -90, dirY: 0,
              position: w2r([10240, -1024, 9344]), enabled: true, obstruct: true, quality: 'low' },
            { type: 'point', colour: [223, 32, 0],  intensity: 0.50, innerRange: 1, outerRange: 5,
              position: w2r([9216, -1024, 17408]), enabled: true, obstruct: true, quality: 'low' },
            { type: 'point', colour: [223, 32, 0],  intensity: -0.46, innerRange: 1, outerRange: 5,
              position: w2r([17280, -1792, 3584]), enabled: true, obstruct: true, quality: 'low' }
        ];
        const hand = await loadHandoff();
        let atlas;
        if (hand) {
            const m = hand.manifest;
            grid = { cols: m.cols, rows: m.rows };
            tileCount = m.count;
            handoffStamp = m.stamp;
            handoffMaps = Object.keys(hand.maps).length ? hand.maps : null;
            atlas = hand.diffuse;
            atlasSource = 'editor';
            selectedTile = 0;
            rv.setAtlas(atlas, grid);
        } else {
            grid = { cols: 4, rows: 4 }; tileCount = 16; selectedTile = 15;
            atlas = placeholderAtlas();
            atlasSource = 'placeholder';
            rv.setAtlas(atlas, grid);
        }
        refreshMaps();
        drawPalette(atlas);
        const pick = i => Math.min(i, tileCount - 1);
        assignment = TRLE.RoomUV.assignRole(a, {}, 'wall', hand ? pick(0) : 15);
        assignment = TRLE.RoomUV.assignRole(a, assignment, 'floors', hand ? pick(1) : 1);
        assignment = TRLE.RoomUV.assignRole(a, assignment, 'ceilings', hand ? pick(2) : 8);
        rv.setAssignment(assignment);
        emitters = [{ name: 'alcove fire', position: [-1, 0.5, -6.5], seed: 1,
                      home: [-1, 0.5, -6.5] }];
        applyTravel();
        drawLightList(); loadLightForm();
        /* At the slider's midpoint the tint is exactly 1 and the angles are the
           ones this sun already has, so this is a no-op on the shipped room.
           Asserted, because it is what keeps the reference captures still. */
        applyDaylight(null);
        fit(); relightFull();
        /* One guaranteed frame, so "is it ready" and "has it drawn" are the same
           question rather than two that race. */
        rv.renderNow();
        pageReady = true;
        setInterval(() => {
            const c = rv.camera();
            $('rv-readout').textContent = 'x ' + c.position[0].toFixed(2) + '  y ' + c.position[1].toFixed(2)
                                        + '  z ' + c.position[2].toFixed(2) + '  ·  ' + c.fov + '°';
        }, 100);
    }).catch(err => { status.textContent = 'Could not load the room: ' + err.message; });

    /* Test hook, the same shape as the tool's own `?capture` convention. */
    TRLE._rv = {
        view: rv,
        ready: () => pageReady,
        lights: () => lights,
        relight: relightFull,
        setLights(next) { lights = next; selectedLight = 0; drawLightList(); loadLightForm(); relightFull(); },
        assignment: () => assignment,
        setAssignment(next) { assignment = next; rv.setAssignment(next); },
        placeholderAtlas, placeholderMaps,
        emitters: () => emitters,
        setEmitters(next) { emitters = next; rv.setEmitters(next); },
        applyTravel,
        dynamicLights: () => rv.dynamicLights(),
        selectFace(fi) { selectedFace = fi; },
        selectTile(t) { selectedTile = t; },
        setPlaceMode(m) { placeMode = m; },
        selectedLight: () => selectedLight,
        atlasSource: () => atlasSource,
        grid: () => grid,
        tileCount: () => tileCount,
        handoffStamp: () => handoffStamp,
        markers: () => rv.markers(),
        markerTint, spriteAt, refreshGizmo,
        mapOn, currentMaps, refreshMaps,
        setMapOn(k, v) { mapOn[k] = v; $('rv-map-' + k).checked = v; refreshMaps(); },
        selection: () => [...selection],
        setSelection(list) { setSelection(new Set(list)); },
        undoDepth: () => undoStack.length,
        undo, pushUndo, paintFaces,
        servicePaint,
        beginPaint(x, y) { pushUndo(); const h = rv.pickPoint(x, y); if (!h) return -1;
                           paintFaces([h.face]); paintDrag = { last: [x, y], seen: new Set([h.face]) };
                           return h.face; },
        movePaint(x, y) { pendingPaint = [x, y]; servicePaint(); },
        endPaint() { const n = paintDrag ? paintDrag.seen.size : 0; paintDrag = null; return n; },
        boxSelect(x0, y0, x1, y1, sub) {
            boxDrag = { x0, y0, x1, y1, sub: !!sub }; commitBox(); boxDrag = null; drawBand();
        },
        beginDrag, moveDrag,
        endDrag() { gdrag = null; relightFull(); },
        dragging: () => !!gdrag,
        setDock,
        lastBake: () => (lastColours ? Array.from(lastColours) : null),
        lastQuality: () => lastQuality,
        dayPos: () => dayPos,
        dayT, dayAngles, dayTint, dayClock, sunIndex,
        daySynced: () => daySynced,
        dayReadout: () => $('rv-dayread').textContent,
        dayBase: () => (dayBase ? dayBase.slice() : null),
        setDay(p, full) { setDayPos(p, full === false ? relightFrame : relightFull); },
        setDayRamp(on) { $('rv-dayramp').checked = !!on; $('rv-dayramp').onchange(); },
        dayRamp,
        playDay, stopDay,
        dayPlaying: () => !!dayRaf,
        dayReduced,
        dockOpen: () => !dock.classList.contains('closed'),
        stageRect: () => canvas.parentElement.getBoundingClientRect(),
        canvasSize: () => [canvas.width, canvas.height]
    };
})();
