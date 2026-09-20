/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   TRLE.RoomUV — texture coordinates for room geometry
   ============================================================
   Pure arithmetic, no DOM and no GL, so the node validators run it
   directly.

   THE RULE, measured off Tomb Editor's own textured export (research
   section 26) rather than assumed:

     One tile covers exactly ONE SECTOR, 1024 world units, on every axis.
     1136 of the room's 1140 faces carry a UV rectangle of exactly one
     tile; the four that do not are the SHORT ones.

     The scale is constant in WORLD space, so a partial face CROPS rather
     than squashing. A face one click tall takes a quarter of the tile,
     and takes the right quarter. A trapezoid's corners each take the part
     of the tile their own height lands on -- which is the decisive
     evidence, because it means the texture is pinned to world space and
     each corner samples whatever it physically covers.

   So the whole generator is: measure each corner along the face's own two
   in-plane axes, in sectors, and subtract the floor of the minimum. A full
   face gets 0..1, a quarter-height face gets 0.75..1.0.

   Orientation is NOT stored as a flag anywhere. In Tomb Editor's export it
   lives entirely in the ORDER of the UV indices around the face, and all
   four orientations occur naturally in a real room. Here it is a per-face
   rotate/flip the user can set, applied inside the tile.
   ============================================================ */
/* Wrapped so node can load it the way the validators load roomlight.js: the
   repo's usual `window.TRLE = …; TRLE.X = …` form leaves no bare global when
   `window` is a plain object in a vm context. */
(function (root) {
    'use strict';
    root.TRLE = root.TRLE || {};

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    function unit(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

    /* A canonical pair of axes for a face, from its normal alone.

       Anything with a vertical component — floors, ceilings and SLOPES — is
       measured by its HORIZONTAL projection, world +X and +Z, with the ceiling
       flipping v so a texture reads the same way up seen from below.

       Projecting rather than measuring along the surface is not a shortcut, it
       is what Tomb Editor does, and the slopes are what prove it: a sloped face
       spanning x 1, y 0.25, z 1 carries exactly ONE tile in the export, not the
       1.03 tiles its surface length would earn. That is the "slopes stretch"
       behaviour research section 26 recorded, and a horizontal projection
       reproduces it exactly and for free.

       True walls have no horizontal projection to speak of, so they take the
       direction across the face as u and world up as v — which is what a wall
       texture wants anyway, with the tile's top edge at the top of the wall.

       The 0.001 cutoff is deliberately the same one the asset pipeline uses to
       call a face a wall, so the two classifications cannot disagree. */
    function faceBasis(n) {
        if (n[1] > 0.001)  return { t: [1, 0, 0], b: [0, 0, 1] };
        if (n[1] < -0.001) return { t: [1, 0, 0], b: [0, 0, -1] };
        const t = unit(cross([0, 1, 0], n));
        return { t, b: unit(cross(n, t)) };
    }

    /* The eight ways a tile can sit on a face. Orientation is a property of the
       assignment, not of the geometry, so it is applied inside the unit tile
       just before the tile is placed in the atlas. */
    function orient(u, v, rot, flip) {
        if (flip) u = 1 - u;
        switch (((rot | 0) % 4 + 4) % 4) {
            case 1:  return [1 - v, u];
            case 2:  return [1 - u, 1 - v];
            case 3:  return [v, 1 - u];
            default: return [u, v];
        }
    }

    /* UVs for one face, inside the unit tile. */
    function faceTileUVs(face, positions, normal) {
        const { t, b } = faceBasis(normal);
        const raw = face.v.map(vi => {
            const p = [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];
            return [dot(p, t), dot(p, b)];
        });
        /* Subtract the floor of the minimum, not the minimum itself. Subtracting
           the minimum would stretch every partial face back out to a full tile,
           which is exactly the squashing the measured rule says does not happen. */
        const u0 = Math.floor(Math.min(...raw.map(r => r[0])) + 1e-6);
        const v0 = Math.floor(Math.min(...raw.map(r => r[1])) + 1e-6);
        return raw.map(([u, v]) => [u - u0, v - v0]);
    }

    /* Place a unit-tile coordinate into an atlas page.
       `atlas` is { cols, rows } — the tile grid of the page, which is what the
       tool's own export already produces.

       Note the `1 - uv[1]`. Two conventions meet here and they run opposite
       ways: the tool's atlases are row-major from the TOP, so tile 0 is the
       top-left cell, while the within-tile v produced above runs UP, because it
       is measured in world space where a wall's tile starts at the floor.
       Flipping v inside the cell reconciles them, and means the page needs no
       flip on upload at all.

       Getting this wrong is quiet rather than loud: the row index inverts, so a
       face assigned tile 1 renders tile 13 in a four-row sheet. It still draws,
       still lights, still picks. It was caught by asserting that the rendered
       pixel equals texture x lighting for the tile the id buffer says is there. */
    function intoAtlas(uv, tile, atlas) {
        const col = tile % atlas.cols, row = (tile / atlas.cols) | 0;
        return [(col + uv[0]) / atlas.cols, (row + (1 - uv[1])) / atlas.rows];
    }

    /* Build the DRAW mesh.

       Texturing forces the vertices apart: one vertex may be shared by faces
       carrying different tiles, and it needs a different UV in each. So the
       draw mesh has one vertex per face CORNER, and `src` maps each of them
       back to the shared vertex the bake computed a colour for. The bake stays
       per shared vertex -- it has to, because that is what Tomb Editor does and
       what 2.1 was verified against.

       assignment: faceIndex -> { tile, rot, flip }, or a function, or a number.
       Returns flat typed arrays ready for the GPU, plus `faceRange` so picking
       and per-face edits can find a face's corners without searching. */
    function buildDrawMesh(asset, assignment, atlas) {
        const get = fi => {
            const a = typeof assignment === 'function' ? assignment(fi) : assignment[fi];
            if (a == null) return { tile: 0, rot: 0, flip: false };
            return typeof a === 'number' ? { tile: a, rot: 0, flip: false } : a;
        };

        const positions = [], uvs = [], src = [], tris = [], faceRange = [], faceIds = [];
        const normals = [], tangents = [], bitangents = [];
        let base = 0;
        for (let fi = 0; fi < asset.faces.length; fi++) {
            const f = asset.faces[fi];
            const n = asset.normals[f.ni];
            const a = get(fi);
            const tileUV = faceTileUVs(f, asset.positions, n);
            /* The TBN a normal map needs, taken from the SAME basis the UVs use.
               Deriving it any other way would let the tangent frame disagree
               with the texture it is meant to be reading. */
            const basis = faceBasis(n);

            for (let j = 0; j < f.v.length; j++) {
                const vi = f.v[j];
                positions.push(asset.positions[vi * 3], asset.positions[vi * 3 + 1], asset.positions[vi * 3 + 2]);
                const o = orient(tileUV[j][0], tileUV[j][1], a.rot, a.flip);
                const p = intoAtlas(o, a.tile, atlas);
                uvs.push(p[0], p[1]);
                src.push(vi);
                faceIds.push(fi);      // for the id-buffer pick, one per corner
                normals.push(n[0], n[1], n[2]);
                tangents.push(basis.t[0], basis.t[1], basis.t[2]);
                bitangents.push(basis.b[0], basis.b[1], basis.b[2]);
            }
            /* Tomb Editor's diagonal again, corner 1 to corner 3. The draw mesh
               must split the same way the bake assumed, or the shading across a
               quad disagrees with the colours that were computed for it. */
            if (f.v.length === 4) {
                tris.push(base + 0, base + 1, base + 3, base + 1, base + 2, base + 3);
            } else {
                tris.push(base + 0, base + 1, base + 2);
            }
            faceRange.push([base, f.v.length]);
            base += f.v.length;
        }

        return {
            positions: new Float32Array(positions),
            uvs: new Float32Array(uvs),
            src: new Uint16Array(src),
            faceIds: new Float32Array(faceIds),
            normals: new Float32Array(normals),
            tangents: new Float32Array(tangents),
            bitangents: new Float32Array(bitangents),
            tris: new Uint16Array(tris),
            faceRange,
            vertexCount: base
        };
    }

    /* Scatter one colour per SHARED vertex out to the draw mesh's corners. */
    function expandColours(baked, src) {
        const out = new Float32Array(src.length * 3);
        for (let i = 0; i < src.length; i++) {
            const s = src[i] * 3;
            out[i * 3] = baked[s]; out[i * 3 + 1] = baked[s + 1]; out[i * 3 + 2] = baked[s + 2];
        }
        return out;
    }

    /* Bulk assignment: every face of a role gets one tile. Returns a new map so
       a caller can keep the previous one for undo. */
    function assignRole(asset, current, role, tile) {
        const next = Object.assign({}, current);
        for (let fi = 0; fi < asset.faces.length; fi++) {
            const f = asset.faces[fi];
            const matches = role === 'all' || f.role === role ||
                (role === 'floors' && (f.role === 'floor' || f.role === 'slope')) ||
                (role === 'ceilings' && (f.role === 'ceiling' || f.role === 'slopeCeiling'));
            if (matches) next[fi] = Object.assign({ tile: 0, rot: 0, flip: false }, next[fi], { tile });
        }
        return next;
    }

    root.TRLE.RoomUV = {
        faceBasis, orient, faceTileUVs, intoAtlas, buildDrawMesh, expandColours, assignRole
    };
})(typeof window !== 'undefined' ? window : globalThis);
