/* SPDX-License-Identifier: LicenseRef-TombEngine-NonCommercial
   ------------------------------------------------------------------
   DERIVED FROM TOMBENGINE. NOT MIT. NOT FOR COMMERCIAL USE.

   Copyright (c) 2025 Tomb Engine Team, for the parts derived from
   TombEngine. Modified MIT License (for non-commercial use only) --
   the full text is beside this file in `LICENSE`.

   Everything ELSE in this repository is plain MIT. See ../../LICENSE.
   ------------------------------------------------------------------
   TRLE.TenPreviewShaders -- the three PREVIEW shaders that reproduce
   TombEngine, moved out of js/shaders.js on 2026-09-20.

   WHY THEY MOVED

   js/shaders.js is compiled wholesale by the engine and is shared with
   the EXPORT pipeline, which every other feature depends on. A
   non-commercial shader sitting in it puts the whole tool across the
   line, which is exactly what `AtlasTool/ten/` exists to prevent. They
   had been there since before the boundary was drawn.

     pomPreview       TEN's ParallaxOcclusionMapping, Materials.hlsli:114-180
     pomPreview3D     the same march with a real per-fragment view vector
     materialPreview  TEN's Phong specular: RoughnessToExpMul and SPEC_FACTOR

   All three are PREVIEWS. None of them generates a map, and none of
   them is on the export path -- which is what makes this directory
   separable at all.

   HOW THEY LOAD, AND WHAT HAPPENS IF THEY DO NOT

   This file assigns onto `TRLE.Shaders` before `TRLE.Engine` compiles
   it, so nothing downstream changes: the engine still finds
   `pomPreview3D` in the table by name.

   Delete this directory and the tool still runs. `TRLE.Engine`'s
   parallax previews and the material modal's lit preview report
   themselves unavailable and the callers show a note instead; atlas
   cutting, every generated map and the whole export are untouched.
   `tools/validate-licensing.mjs` asserts that, by loading the tool with
   this directory withheld.
   ------------------------------------------------------------------ */
(function (root) {
    'use strict';
    root.TRLE = root.TRLE || {};
    root.TRLE.Shaders = root.TRLE.Shaders || {};

    /* TombEngine's own march constants, Materials.hlsli:17-23 and 143-150.
       js/engine.js used to carry these as bare numerals at the call site; it
       reads them from here now, so the engine holds no TEN-derived value. */
    root.TRLE.TenPreviewShaders = {
        HEIGHT_SCALE: 0.0035,   // POM_HEIGHT_SCALE, over the ATLAS PAGE
        MIN_ANGLE:    0.4,      // POM_MIN_ANGLE, the grazing clamp
        PAGE:         4096,     // the minimum page Tomb Editor builds
        names: ['pomPreview', 'pomPreview3D', 'materialPreview']
    };

    Object.assign(root.TRLE.Shaders, {
    /* ---------- Parallax preview (what TombEngine will actually draw) ----------
       A port of TEN's ParallaxOcclusionMapping (Materials.hlsli:114-180) so the
       Height modal can show the real thing instead of a displaced-mesh
       approximation -- including the failure it exists to prevent.

       The march is in ATLAS-PAGE space, so this needs the tile's size to convert:
       a fixed page-pixel reach is a bigger slice of a small tile. Past the
       texture's own border it shows what the packed page really holds -- Tomb
       Editor's edge bleed for u_padPx pixels, then black for the unrelated
       neighbour beyond it. That black IS the reported bar.
       -------------------------------------------------------------------------- */
    pomPreview: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        uniform sampler2D u_height;
        uniform float u_reach;     // full-depth march, in TILE units (reachPx / tileSize)
        uniform float u_steps;
        uniform float u_padPx;     // Tomb Editor's edge bleed, in tile units
        uniform float u_dir;       // march direction in x: +1 or -1
        in vec2 v_uv;
        out vec4 fragColor;

        // Outside the tile the page holds the bled edge pixel, so the march reads
        // a clamped sample -- exactly what the shipped atlas would give it.
        float hAt(vec2 uv) { return texture(u_height, clamp(uv, 0.0, 1.0)).r; }

        void main() {
            float n = max(1.0, floor(u_steps));
            float layer = 1.0 / n;
            vec2 step = vec2(u_dir * u_reach / n, 0.0);

            float depth = 0.0;
            vec2 uv = v_uv;
            float mapDepth = 1.0 - hAt(uv);
            for (int i = 0; i < 16; i++) {
                if (float(i) >= n || depth >= mapDepth) break;
                uv += step; depth += layer;
                mapDepth = 1.0 - hAt(uv);
            }
            vec2 prev = uv - step;
            float mapPrev = 1.0 - hAt(prev);
            float after = mapDepth - depth;
            float before = mapPrev - (depth - layer);
            float w = clamp(after / (after - before + 1e-6), 0.0, 1.0);
            vec2 finalUV = mix(uv, prev, w);

            float over = max(max(finalUV.x - 1.0, -finalUV.x),
                             max(finalUV.y - 1.0, -finalUV.y));
            if (over > u_padPx) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
            fragColor = vec4(texture(u_diffuse, clamp(finalUV, 0.0, 1.0)).rgb, 1.0);
        }`,

    /* ---------- TombEngine parallax, ON A 3D SURFACE ----------
       The flat `pomPreview` above marches with ONE reach value for the whole
       image, taken from a "viewing angle" slider -- which is a fair picture of a
       wall seen face-on at that angle and tells you very little about how the
       relief will read as you move past it.

       This is the same march with a REAL view vector: the quad is drawn in
       perspective and each fragment computes its own tangent-space view direction,
       which is exactly what TombEngine does (Materials.hlsli:114-180). So the
       parallax gets stronger toward grazing parts of the surface and weaker
       head-on, all in one image, the way it does in game.

       It is deliberately NOT a displaced mesh. TombEngine does not move geometry:
       it fakes depth per-pixel, so the silhouette of a parallax-mapped wall stays
       perfectly flat and the relief flattens out as you rotate away. A displaced
       mesh would show bumpy edges and real occlusion the engine never produces --
       i.e. it would be wrong in precisely the way that matters here.

       Needs its own VERTEX shader, hence the {vert, frag} form. */
    pomPreview3D: {
        vert: `#version 300 es
        in vec2 a_position;
        uniform mat4 u_mvp;
        uniform vec3 u_camPos;       // camera in the quad's local space
        out vec2 v_uv;
        out vec3 v_viewTS;           // view direction, tangent space
        void main() {
            vec3 local = vec3(a_position, 0.0);          // the quad lies in z = 0
            v_uv = a_position * 0.5 + 0.5;
            /* Tangent space for this quad is trivial: tangent = +x, bitangent = +y,
               normal = +z, so the local-space view vector already IS the
               tangent-space one. Keeping it explicit because the moment this stops
               being a flat quad that stops being true. */
            v_viewTS = u_camPos - local;
            gl_Position = u_mvp * vec4(local, 1.0);
        }`,
        frag: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        uniform sampler2D u_height;
        uniform float u_scale;       // POM_HEIGHT_SCALE * page/tile, in UV units
        uniform float u_minAngle;    // POM_MIN_ANGLE clamp (TEN uses 0.4)
        uniform float u_steps;
        uniform float u_padPx;       // Tomb Editor's edge bleed, in tile units
        uniform float u_light;       // simple lambert so the relief reads at all
        in vec2 v_uv;
        in vec3 v_viewTS;
        out vec4 fragColor;

        float hAt(vec2 uv) { return texture(u_height, clamp(uv, 0.0, 1.0)).r; }

        void main() {
            vec3 v = normalize(v_viewTS);
            // TEN clamps the tangent-space Z so a grazing view cannot march forever.
            float vz = max(abs(v.z), u_minAngle);
            vec2 dir = -v.xy / vz * u_scale;

            float n = max(1.0, floor(u_steps));
            float layer = 1.0 / n;
            vec2 stepUV = dir / n;

            float depth = 0.0;
            vec2 uv = v_uv;
            float mapDepth = 1.0 - hAt(uv);
            for (int i = 0; i < 32; i++) {
                if (float(i) >= n || depth >= mapDepth) break;
                uv += stepUV; depth += layer;
                mapDepth = 1.0 - hAt(uv);
            }
            vec2 prev = uv - stepUV;
            float mapPrev = 1.0 - hAt(prev);
            float after = mapDepth - depth;
            float before = mapPrev - (depth - layer);
            float w = clamp(after / (after - before + 1e-6), 0.0, 1.0);
            vec2 finalUV = mix(uv, prev, w);

            float over = max(max(finalUV.x - 1.0, -finalUV.x),
                             max(finalUV.y - 1.0, -finalUV.y));
            if (over > u_padPx) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

            vec3 c = texture(u_diffuse, clamp(finalUV, 0.0, 1.0)).rgb;
            /* A cheap lambert off the height gradient. Not TEN's lighting -- this
               preview is honest about the GEOMETRY, not the shading -- but without
               any shading at all a parallax surface is very hard to read. */
            float t = 1.0 / 256.0;
            float hx = hAt(finalUV + vec2(t, 0.0)) - hAt(finalUV - vec2(t, 0.0));
            float hy = hAt(finalUV + vec2(0.0, t)) - hAt(finalUV - vec2(0.0, t));
            vec3 nrm = normalize(vec3(-hx * 4.0, -hy * 4.0, 1.0));
            float lam = clamp(dot(nrm, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);
            fragColor = vec4(c * mix(1.0, 0.45 + 0.75 * lam, u_light), 1.0);
        }`
    },

    /* ---------- Material Preview (TombEngine-approximated Phong) ----------
       Composites diffuse + normal + AO + specular + roughness + emissive
       under a single directional light to approximate how TombEngine
       renders a room surface. Height is excluded (no parallax in preview).

       u_lightDir  — pre-normalised vec3 pointing toward the light source
                     in tangent space (right=+X, up=+Y, out-of-surface=+Z).
       u_hasX      — 1.0 if the corresponding map is available + enabled,
                     0.0 otherwise (fallback values used instead).
       -------------------------------------------------------------------- */
    materialPreview: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        uniform sampler2D u_normal;
        uniform sampler2D u_ao;
        uniform sampler2D u_specular;
        uniform sampler2D u_roughness;
        uniform sampler2D u_emissive;
        uniform float u_hasNormal;
        uniform float u_hasAO;
        uniform float u_hasSpecular;
        uniform float u_hasRoughness;
        uniform float u_hasEmissive;
        uniform vec3 u_lightDir;
        in vec2 v_uv;
        out vec4 fragColor;

        float roughnessToExp(float r) {
            float g = 1.0 - clamp(r, 0.04, 1.0);
            return mix(0.04, 4.0, g * g);
        }

        void main() {
            vec4 diffSample = texture(u_diffuse, v_uv);
            vec3 diff = diffSample.rgb;

            vec3 N = u_hasNormal > 0.5
                ? normalize(texture(u_normal, v_uv).xyz * 2.0 - 1.0)
                : vec3(0.0, 0.0, 1.0);

            float ao      = u_hasAO        > 0.5 ? texture(u_ao,        v_uv).r   : 1.0;
            float sp      = u_hasSpecular  > 0.5 ? texture(u_specular,  v_uv).r   : 0.5;
            float rgh     = u_hasRoughness > 0.5 ? texture(u_roughness, v_uv).r   : 0.5;
            vec3 emissive = u_hasEmissive  > 0.5 ? texture(u_emissive,  v_uv).rgb : vec3(0.0);

            vec3 L = normalize(u_lightDir);
            vec3 V = vec3(0.0, 0.0, 1.0);
            vec3 R = reflect(-L, N);

            float NdotL  = max(dot(N, L), 0.0);
            float expVal = max(64.0 * roughnessToExp(rgh), 1.0);
            float spec   = pow(max(dot(V, R), 0.0), expVal) * sp;

            // ambient * ao + diffuse * NdotL * ROOM_LIGHT_COEFF + spec + emissive
            vec3 color = diff * (0.3 * ao + NdotL * 0.7) + vec3(spec) + emissive;
            fragColor = vec4(clamp(color, 0.0, 1.0), diffSample.a);
        }`,
    });
})(typeof window !== 'undefined' ? window : globalThis);
