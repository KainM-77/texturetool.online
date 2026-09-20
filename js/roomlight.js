/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE).

   INDEPENDENT IMPLEMENTATION. The light model below was recovered by measuring
   Tomb Editor's own room exports (AtlasTool/tools/fixtures/roomview/), not by
   reading Tomb Editor's source — which carries no licence and cannot be copied.
   The measurements and their residuals are in
   docs/AtlasRoomView/AtlasRoomViewPlan.md section 2.1. */
/* ============================================================
   TRLE.RoomLight — Tomb Editor style vertex-light bake
   ============================================================
   Pure arithmetic, no DOM and no GL, so the node validators can
   run it directly. Given a room mesh, a light list and a room
   ambient it returns one RGB colour per vertex, which is exactly
   what Tomb Editor bakes and what TombEngine then interpolates.

   THE MODEL, and every part of it is measured rather than assumed:

     colour_scale = Colour(0..255) * Intensity / 255      (a plain
         multiplier; NOT the /128 that LightInstance's "1.0 normal,
         2.0 maximum" comment suggests)

     sun:    scale * weighted mean over incident triangles of
             max(0, dot(N, L))            — DIRECTIONAL, no falloff
     point:  scale * clamp((Out - d) / (Out - In), 0, 1)
                                          — NOT directional. There is
             no N.L term at all: a surface facing away from a point
             light receives exactly as much as one facing it.

     negative Intensity subtracts, using the same non-directional form

   THE RANGE IS 0..2, NOT 0..1, and this is easy to get wrong because the
   fixture hides it. Tomb Editor's vertex lighting is not internally
   clamped to 2.0, and its exporter clamps to [0,2] and then DIVIDES BY
   TWO to fit an OBJ (BaseGeometryExporter.ApplyColorTransform). So the
   numbers in the room exports are HALF what the engine uses.

   A bake fitted to the export therefore reproduces the file exactly and
   renders the room at half the brightness TombEngine shows -- which is
   precisely what happened, and was only caught by putting our render
   beside an in-game capture of the same camera with the same atlas.

   So this returns ENGINE-space values. Compare against an export by
   halving, which is what validate-roomview-bake does.

   Do NOT reuse this for the runtime shading pass. TombEngine's
   DoPointLight multiplies by N.L and this bake does not; they are
   different models and merging them would be wrong in both places.
   ============================================================ */
(function (root) {
    'use strict';
    root.TRLE = root.TRLE || {};

    const SECTOR = 1024;   // world units per sector
    const CLICK  = 256;    // world units per click
    /* Tomb Editor's export divides vertex colour by this to fit an OBJ, so it
       is also what turns an exported value back into an engine one. */
    const EXPORT_RANGE = 2;

    /* Tomb Editor's world space to the exported room space, verified against
       TombEngine's own debug overlay on five independent points (research
       section 28). `centre` is half the room's world bounds. */
    function worldToRoom(p, centre) {
        return [(p[0] - centre) / SECTOR, -p[1] / SECTOR, -(p[2] - centre) / SECTOR];
    }

    function norm(v) {
        const m = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / m, v[1] / m, v[2] / m];
    }

    /* Direction TOWARD a sun light, from Tomb Editor's Dir X / Dir Y in degrees.

       THE AZIMUTH RUNS THE OTHER WAY: az = -Dir Y. Measured, not chosen.
       Research section 29.1 reads it straight off two exports with no fitting:
       at Dir X -45 / Dir Y 90 Tomb Editor lights the floor and the -X wall by
       exactly 0.353553 each and everything else by exactly zero, which forces
       L = (-0.7071, 0.7071, 0). The opposite sign on X.

       It is invisible at Dir Y 0 and 180 and a half-turn wrong everywhere else,
       which is why the original fixture -- a sun at Dir Y 0 -- never caught it.
       Consistent with LightInstance.ToString() negating Y for display, so the
       number on Tomb Editor's panel is the negation of the stored one.

       Dir X is confirmed at -90, -45 and, through the two spot fixtures, at
       -17.83 and -19.16. */
    function sunDirection(dirXDeg, dirYDeg) {
        const ex = (dirXDeg || 0) * Math.PI / 180;
        const az = -(dirYDeg || 0) * Math.PI / 180;
        return norm([Math.sin(az) * Math.cos(ex), -Math.sin(ex), Math.cos(az) * Math.cos(ex)]);
    }

    /* The inverse, for a direction handle the user drags. Returns the Dir X and
       Dir Y that Tomb Editor's panel would show for a light pointing along
       `L` (toward the light), with Dir Y wrapped into [0, 360). */
    function sunAngles(L) {
        const u = norm(L);
        const dirX = Math.asin(Math.max(-1, Math.min(1, -u[1]))) * 180 / Math.PI;
        let dirY = -Math.atan2(u[0], u[2]) * 180 / Math.PI;
        dirY = ((dirY % 360) + 360) % 360;
        return { dirX, dirY };
    }

    /* Per-vertex list of {n, w}: the face normals meeting that vertex and how
       many TRIANGLES each contributes there.

       Tomb Editor bakes per triangle. Its OBJ exporter merges coplanar triangle
       pairs back into quads, so a quad in the file is two triangles in the bake
       and a corner of it belongs to either one or both of them, depending on
       which diagonal splits it. Measured against the sun fixture, the diagonal
       is the one joining corners 1 and 3 — which makes corners 1 and 3 belong to
       two triangles and corners 0 and 2 to one.

       That rule is exact on 415 of the 419 lit vertices. The four it misses are
       all ceiling corners of the tomb alcove, each with exactly one incident
       triangle, and no consistent assignment of diagonals was found that closes
       them without breaking others. Worst case there is 0.0083, about 2/255.
       See the plan for the full residual. */
    function vertexFaceWeights(mesh) {
        const out = [];
        for (let i = 0; i < mesh.positions.length; i++) out.push([]);
        for (const f of mesh.faces) {
            const quad = f.v.length === 4;
            for (let j = 0; j < f.v.length; j++) {
                const w = quad ? ((j === 1 || j === 3) ? 2 : 1) : 1;
                out[f.v[j]].push({ n: f.n, w });
            }
        }
        return out;
    }

    /* Weighted mean of max(0, N.L) over the triangles meeting this vertex. */
    function directionalTerm(fw, L) {
        let sum = 0, wsum = 0;
        for (const { n, w } of fw) {
            const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
            sum += (d > 0 ? d : 0) * w;
            wsum += w;
        }
        return wsum ? sum / wsum : 0;
    }

    function attenuation(dist, inner, outer) {
        const span = outer - inner;
        if (span <= 0) return dist <= outer ? 1 : 0;
        const a = (outer - dist) / span;
        return a < 0 ? 0 : (a > 1 ? 1 : a);
    }

    /* The direction TOWARD a light, memoised on the light but KEYED on the
       angles. Memoising without the key is a stale-cache bug waiting for the
       first caller that edits Dir X on a light it reuses, which a draggable
       direction handle does on every frame. */
    function lightDir(light) {
        const key = light.dirX + ',' + light.dirY;
        if (light._Lkey !== key) {
            light._L = sunDirection(light.dirX, light.dirY);
            light._Lkey = key;
        }
        return light._L;
    }

    /* SPOT lights (research section 29.2), and the shape of it is the finding.

       Three factors, and the third is not what a spot light usually does:

         distance   clamp((Out - d) / (Out - In), 0, 1)     as a point light
         angle      clamp((cos - cos Out_a) / (cos In_a - cos Out_a), 0, 1)
                    LINEAR IN THE COSINE, which is the same expression
                    TombEngine's DoSpotLight uses at runtime
         surface    the SUN's directional term, evaluated on the spot's AXIS

       That last one: the surface is shaded as though a sun were pointing the
       same way the spot points. The bulb's position decides only how much
       arrives, through the other two factors. Measured across 68 lit vertices,
       where the residual against a model with no surface term was exactly
       constant per set of incident normals and those constants were
       dot(N, -axis) to four decimals.

       So the three light types treat the normal three different ways: a sun by
       its own direction, a point light not at all, a spot by its axis. */
    const DEFAULT_INNER_ANGLE = 20, DEFAULT_OUTER_ANGLE = 25;

    function spotTerm(light, pos, fw) {
        const L = lightDir(light);
        const dx = pos[0] - light.position[0];
        const dy = pos[1] - light.position[1];
        const dz = pos[2] - light.position[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-9) return 0;
        // dot with the axis, which is -L
        const cosT = -(dx * L[0] + dy * L[1] + dz * L[2]) / d;
        const ia = light.innerAngle != null ? light.innerAngle : DEFAULT_INNER_ANGLE;
        const oa = light.outerAngle != null ? light.outerAngle : DEFAULT_OUTER_ANGLE;
        const ci = Math.cos(ia * Math.PI / 180), co = Math.cos(oa * Math.PI / 180);
        const span = ci - co;
        let ang = span > 1e-9 ? (cosT - co) / span : (cosT >= co ? 1 : 0);
        if (ang <= 0) return 0;
        if (ang > 1) ang = 1;
        const dist = attenuation(d, light.innerRange, light.outerRange);
        if (!dist) return 0;
        return dist * ang * directionalTerm(fw, L);
    }

    /* One light's contribution at one vertex, as a linear RGB triple. Not
       clamped here: the caller sums and clamps once, which is what produces the
       measured behaviour of a negative light eating into the ambient. */
    function contribution(light, pos, fw) {
        /* EXPORT_RANGE is the same factor the exporter divided out, so a light
           that measured Colour*Intensity/255 against the halved file is
           Colour*Intensity*2/255 in the engine. */
        const k = (light.intensity || 0) * EXPORT_RANGE / 255;
        let term;
        if (light.type === 'sun') {
            term = directionalTerm(fw, lightDir(light));
        } else if (light.type === 'spot') {
            term = spotTerm(light, pos, fw);
        } else {
            const d = Math.hypot(light.position[0] - pos[0],
                                 light.position[1] - pos[1],
                                 light.position[2] - pos[2]);
            term = attenuation(d, light.innerRange, light.outerRange);
        }
        if (!term) return null;
        const c = light.colour;
        return [c[0] * k * term, c[1] * k * term, c[2] * k * term];
    }

    /* Bake.

       mesh    { positions: [[x,y,z], …], faces: [{ v: [i…], n: [x,y,z] }, …] }
               positions and normals in ROOM space (sectors), normals unit.
       lights  [{ type:'sun'|'point', colour:[0..255]x3, intensity,
                  innerRange, outerRange, position, dirX, dirY, enabled }]
       ambient [r,g,b] — the room's Ambient swatch, in ENGINE space. A swatch of
               32,32,32 is 2 * 32/255, because the 0..255 colour maps onto the
               engine's 0..2 range.
       opts    { visibility(vertexIndex, lightIndex) -> 0..1 }  obstruction,
               supplied by subphase 2.2; absent means fully lit.

       Returns Float32Array, three components per vertex, clamped to [0,1]. */
    function bake(mesh, lights, ambient, opts) {
        opts = opts || {};
        const vis = opts.visibility;
        const fws = vertexFaceWeights(mesh);
        const n = mesh.positions.length;
        const out = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            let r = ambient[0], g = ambient[1], b = ambient[2];
            for (let li = 0; li < lights.length; li++) {
                const L = lights[li];
                if (L.enabled === false) continue;
                const c = contribution(L, mesh.positions[i], fws[i]);
                if (!c) continue;
                const v = vis ? vis(i, li) : 1;
                if (!v) continue;
                r += c[0] * v; g += c[1] * v; b += c[2] * v;
            }
            /* Clamped at zero only. Tomb Editor does not clamp vertex lighting
               at the top -- its own exporter has to, on the way out -- and
               TombEngine saturates the finished pixel rather than the light. */
            out[i * 3]     = r < 0 ? 0 : r;
            out[i * 3 + 1] = g < 0 ? 0 : g;
            out[i * 3 + 2] = b < 0 ? 0 : b;
        }
        return out;
    }


    /* ============================================================
       OBSTRUCTION  (subphase 2.2)
       ============================================================
       Tomb Editor decides whether a light reaches a vertex by tracing
       toward the bulb THROUGH THE ROOM'S FLOOR AND CEILING, not by
       intersecting the room's triangles. Measured on the fixture's
       obstructed/unobstructed pairs, the visibility it produces is
       strictly BINARY -- 419 sun vertices and 180 point-light vertices,
       every one of them either fully lit or fully dark, no fractions.
       That is Default quality, which is one sample.

       What reproduces it: step along the segment from the vertex to the
       bulb and, at each step, look up the floor and ceiling height at
       that (x, z). The ray is blocked if it passes BELOW the floor or
       AT OR ABOVE the ceiling. Where several surfaces cover one point,
       the floor is the HIGHEST of them and the ceiling the LOWEST -- the
       ones actually underfoot and overhead.

       Exact for the sun (419/419) and 173/180 for the point light; the
       seven it misses are recorded in the validator by index. Four other
       formulations were tried and are worse, so do not "improve" this
       without measuring: exact ray-triangle intersection (97.6% / 96.1%,
       and it trips on slope edges), the same with a grazing-angle rule
       (no change), per-sector floor/ceiling extremes instead of per-point
       sampling (85.3%), and including the vertex's own position in the
       walk rather than starting one step along (83.8%).
       ------------------------------------------------------------ */

    /* Floor and ceiling surfaces, bucketed by sector cell so a lookup
       touches two or three triangles instead of six hundred. */
    function buildHeightField(mesh) {
        const floors = new Map(), ceils = new Map();
        const push = (map, key, tri) => {
            let a = map.get(key); if (!a) map.set(key, a = []); a.push(tri);
        };
        for (const f of mesh.faces) {
            if (Math.abs(f.n[1]) < 0.01) continue;         // a wall holds no height
            const map = f.n[1] > 0 ? floors : ceils;
            const idx = f.v;
            const tris = idx.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
            for (const [a, b, c] of tris) {
                const t = [mesh.positions[idx[a]], mesh.positions[idx[b]], mesh.positions[idx[c]]];
                /* Registered into every cell the triangle touches AND one cell
                   beyond, on each side. That dilation is not a lookup
                   convenience, it is part of the model: Tomb Editor's trace
                   works at SECTOR granularity, so a raised block occludes for
                   the whole sector it stands in rather than only where its
                   triangles actually are. Measured, on visibility decisions
                   against the two isolating fixtures:

                     dilated by one cell   sun 419/419, point 173/173
                     exact cell bounds     sun 417/419, point 171/173

                   The four it loses are vertices that Tomb Editor shadows
                   behind a column and an exact test leaves lit. It costs about
                   5x the trace time (44 ms to 207 ms for a cold three-light
                   bake), which is worth it and is bounded by the memoisation in
                   makeVisibility. */
                const x0 = Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) - 1e-6);
                const x1 = Math.ceil(Math.max(t[0][0], t[1][0], t[2][0]) + 1e-6);
                const z0 = Math.floor(Math.min(t[0][2], t[1][2], t[2][2]) + -1e-6);
                const z1 = Math.ceil(Math.max(t[0][2], t[1][2], t[2][2]) + 1e-6);
                for (let x = x0; x < x1; x++)
                    for (let z = z0; z < z1; z++)
                        push(map, x + ',' + z, t);
            }
        }
        return { floors, ceils };
    }

    /* Height of a surface set at (x, z). `hi` picks the highest candidate
       (floors) or the lowest (ceilings). null means nothing covers it,
       which is outside the room and therefore solid. */
    function heightAt(map, x, z, hi) {
        const scan = (bucket) => {
            if (!bucket) return null;
            let best = null;
            for (const [a, b, c] of bucket) {
                const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
                if (Math.abs(d) < 1e-12) continue;
                const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
                const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
                const w = 1 - u - v;
                if (u < -1e-7 || v < -1e-7 || w < -1e-7) continue;
                const y = u * a[1] + v * b[1] + w * c[1];
                if (best === null) best = y;
                else best = hi ? Math.max(best, y) : Math.min(best, y);
            }
            return best;
        };
        return scan(map.get(Math.floor(x + 1e-9) + ',' + Math.floor(z + 1e-9)));
    }

    const TRACE_STEPS = 96;

    function segmentBlocked(hf, from, to) {
        for (let s = 1; s < TRACE_STEPS; s++) {
            const t = s / TRACE_STEPS;
            const x = from[0] + (to[0] - from[0]) * t;
            const y = from[1] + (to[1] - from[1]) * t;
            const z = from[2] + (to[2] - from[2]) * t;
            const fh = heightAt(hf.floors, x, z, true);
            const ch = heightAt(hf.ceils, x, z, false);
            if (fh === null || ch === null) return true;
            if (y < fh - 1e-6) return true;
            if (y >= ch - 1e-6) return true;
        }
        return false;
    }

    /* Tomb Editor's Light Quality is a soft-shadow SAMPLE COUNT: Low 1,
       Medium 3, High 5, used as an N x N grid in X and Z at one click
       (256 units, a quarter sector) spacing, with Y fixed. So Medium is
       nine traces per vertex per light and High twenty-five. Default is
       Low, which is what the fixture was baked at and why its visibility
       is binary. */
    const QUALITY_SAMPLES = { low: 1, medium: 3, high: 5 };

    function lightSampleOffsets(quality) {
        const n = QUALITY_SAMPLES[quality] || 1;
        if (n === 1) return [[0, 0, 0]];
        const out = [], half = Math.floor(n / 2), step = 0.25;   // 256 units
        for (let i = -half; i <= half; i++)
            for (let j = -half; j <= half; j++) out.push([i * step, 0, j * step]);
        return out;
    }

    /* visibility(vertexIndex, lightIndex) -> 0..1, the callback `bake` wants.
       Memoised, because a light drag re-bakes every vertex and the trace is
       the expensive half. */
    function makeVisibility(mesh, lights, opts) {
        opts = opts || {};
        const hf = opts.heightField || buildHeightField(mesh);
        const cache = new Map();
        return function (vi, li) {
            const L = lights[li];
            if (!L || L.obstruct === false) return 1;
            if (L.type === 'sun' && !L.position) return 1;   // nothing to trace toward
            const key = vi * 1024 + li;
            let v = cache.get(key);
            if (v !== undefined) return v;
            const offs = lightSampleOffsets(L.quality || 'low');
            let open = 0;
            for (const o of offs) {
                const target = [L.position[0] + o[0], L.position[1] + o[1], L.position[2] + o[2]];
                if (!segmentBlocked(hf, mesh.positions[vi], target)) open++;
            }
            v = open / offs.length;
            cache.set(key, v);
            return v;
        };
    }

    /* ============================================================
       FLAME EMITTERS  (subphase 2.7)
       ============================================================
       The only thing that lights room geometry at runtime. A placed bulb
       reaches a room once, through the bake; TombEngine's
       CollectLightsForRoom walks the dynamic list and nothing else.

       An ordinary flame emitter calls SpawnDynamicLight EVERY GAME FRAME
       with fresh random numbers, which is the whole of the flicker:

         falloff  (16 - (rand & 1)) * multiplier      so 15 or 16
         colour   (1.0, rand in [0.3, 0.4], 0.1) * 255

       SpawnDynamicLight then turns that into a light:

         Out    = falloff * 255                        world units
         In     = 1.0                                  world units, so ~0
         Colour = byte / CHAR_MAX                       and CHAR_MAX is 127
         Intensity = 1.0

       Two things in there are easy to miss. The divisor is 127, not 255, so
       a flame's red channel arrives at about 2.0 and the light is
       deliberately over-bright. And AddDynamicPointLight dims the colour by
       radius / 2048 for radii under two sectors, which a flame never trips
       but a smaller effect would.

       The JET flame variant uses `(rand & 3) + 20` instead, a much wider
       5100 to 5865 units. The ordinary emitter is the default here.

       The flicker is driven by a FRAME COUNTER at 30 Hz rather than by the
       render clock, so it does not speed up on a faster display. */
    const FLAME = {
        falloff: [15, 16],     // multiplied by 255 for world units
        red: 1.0, green: [0.3, 0.4], blue: 0.1,
        divisor: 127,          // CHAR_MAX, which is what the engine uses
        intensity: 1.0,
        innerRange: 1.0,       // world units
        rateHz: 30             // Tomb Raider logic runs at 30
    };

    /* A deterministic stand-in for the engine's random: same emitter and same
       frame gives the same light, which is what lets a validator assert on a
       flicker at all. */
    function flameRand(seed, frame, salt) {
        let h = (seed | 0) * 374761393 + (frame | 0) * 668265263 + (salt | 0) * 2246822519;
        h = (h ^ (h >>> 13)) >>> 0;
        h = Math.imul(h, 1274126177) >>> 0;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /* Where an emitter is on a given frame.

       A TRAVELLING emitter walks a circle, and its position is a function of
       the same 30 Hz frame counter the flicker runs on -- not of wall time.
       That is not a tidiness choice: `setClock` is what lets a validator pin an
       emitter and get a reproducible frame, and the fidelity captures went
       non-deterministic once already because this emitter moved between
       renders. A path driven by performance.now() would undo that fix.

       path: { radius, seconds, centre?, height?, phase? }. Absent means the
       emitter sits still, and then this returns its own position unchanged, so
       the whole feature is inert when it is off. */
    function emitterPosition(emitter, frame) {
        const p = emitter.path;
        if (!p || !(p.radius > 0)) return emitter.position.slice();
        const period = Math.max(1, Math.round((p.seconds || 6) * FLAME.rateHz));
        const t = (((frame | 0) % period) + period) % period / period;
        const a = t * Math.PI * 2 + (p.phase || 0);
        const c = p.centre || emitter.position;
        return [c[0] + Math.cos(a) * p.radius,
                p.height != null ? p.height : c[1],
                c[2] + Math.sin(a) * p.radius];
    }

    /* One frame of an emitter, as a light the renderer can consume.
       `emitter` is { position (room space), seed, jet, path }. */
    function flameLight(emitter, frame) {
        const seed = emitter.seed | 0;
        const jet = !!emitter.jet;
        const falloff = jet
            ? 20 + Math.floor(flameRand(seed, frame, 1) * 4)        // (rand & 3) + 20
            : FLAME.falloff[flameRand(seed, frame, 1) < 0.5 ? 0 : 1];
        const g = FLAME.green[0] + flameRand(seed, frame, 2) * (FLAME.green[1] - FLAME.green[0]);
        // the engine rounds the colour to a byte before dividing, so do the same
        const toLinear = v => Math.floor(v * 255) / FLAME.divisor;
        return {
            type: 'point',
            rgb: [toLinear(FLAME.red), toLinear(g), toLinear(FLAME.blue)],
            intensity: FLAME.intensity,
            innerRange: FLAME.innerRange / SECTOR,
            outerRange: falloff * 255 / SECTOR,
            position: emitterPosition(emitter, frame),
            _falloff: falloff
        };
    }

    /* The frame number an emitter should be on at wall-clock time `ms`. */
    function flameFrame(ms) { return Math.floor(ms * FLAME.rateHz / 1000); }

    /* A room's Ambient swatch (0..255) in ENGINE space. One place, because
       getting the factor wrong renders the whole room at half brightness and
       every fixture still passes. */
    function ambientFromSwatch(rgb255) {
        return rgb255.map(c => EXPORT_RANGE * c / 255);
    }

    root.TRLE.RoomLight = {
        FLAME, flameRand, flameLight, flameFrame, emitterPosition, ambientFromSwatch,
        SECTOR, CLICK, QUALITY_SAMPLES, EXPORT_RANGE,
        worldToRoom, sunDirection, sunAngles, vertexFaceWeights, lightDir, spotTerm,
        DEFAULT_INNER_ANGLE, DEFAULT_OUTER_ANGLE,
        directionalTerm, attenuation, contribution, bake,
        buildHeightField, heightAt, segmentBlocked, lightSampleOffsets, makeVisibility
    };
})(typeof window !== 'undefined' ? window : globalThis);
