/* SPDX-License-Identifier: GPL-3.0-only
   TextureTool — Copyright (C) 2026 KainM-77.
   MIXED LICENSE — read carefully:
   • Two seamless-tiling passes below — `seamlessMaker` and `seamlessSplat`
     (each marked inline "GPL-3.0 ONLY") — are ported (HLSL→GLSL) from Materialize
     (BoundingBoxSoftware) and are available ONLY under GPL-3.0. They are the sole
     reason the tool as a whole ships under GPL-3.0 (see LICENSE).
   • EVERY OTHER shader in this file is the author's own independent implementation
     of a standard image-processing technique and is ALSO available under the MIT
     License (see LICENSE-MIT) when copied on its own.
   • The file carries the GPL-3.0 SPDX tag because, as a whole unit, it contains
     the two ported shaders.
   See THIRD-PARTY-NOTICES.md and "Path to MIT.md" for the full per-shader audit. */
/* ============================================================
   TRLE Texture Tools — GLSL Shaders (WebGL 2.0 / GLSL ES 3.0)
   Fragment shaders for the web GPU texture pipeline.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.Shaders = {

    /* ---------- Shared fullscreen-quad vertex shader ---------- */
    vertex: `#version 300 es
        in vec2 a_position;
        out vec2 v_uv;
        void main() {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }`,

    /* ---------- Passthrough / copy ---------- */
    copy: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            fragColor = texture(u_texture, v_uv);
        }`,

    /* ---------- Desaturate (perceptual luminance) ---------- */
    desaturate: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_gamma;        // default 0.8 — reduces speckle noise
        uniform float u_alphaFlatten; // 1 = flatten toward neutral where transparent (decals)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 c = texture(u_texture, v_uv);
            float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
            // For transparent decals, push the height signal to flat (0.5) as alpha
            // drops, so AO/normal/height don't carve the decal's silhouette.
            if (u_alphaFlatten > 0.5) lum = mix(0.5, lum, c.a);
            lum = pow(clamp(lum, 0.0, 1.0), u_gamma);
            fragColor = vec4(vec3(lum), 1.0);
        }`,

    /* ---------- Separable Gaussian Blur ----------
       Two-pass: horizontal (u_direction = vec2(1/w, 0))
                 vertical  (u_direction = vec2(0, 1/h))
       Wrapping handled by GL_REPEAT on the texture.
       Uses a separable cosine-weighted kernel (a standard blur primitive).
       ------------------------------------------------ */
    gaussianBlur: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec2 u_direction;   // texel step in blur direction
        uniform float u_radius;     // blur radius in pixels (0-64)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            if (u_radius < 0.5) {
                fragColor = texture(u_texture, v_uv);
                return;
            }
            vec4 sum = vec4(0.0);
            float totalW = 0.0;
            int r = int(min(u_radius, 64.0));
            for (int i = -64; i <= 64; i++) {
                if (i < -r || i > r) continue;
                float fi = float(i);
                // Cosine-weighted separable kernel
                float w = cos(fi / u_radius * 1.5707963) * (1.0 - abs(fi) / (u_radius + 1.0));
                w = max(w, 0.0);
                sum += texture(u_texture, v_uv + u_direction * fi) * w;
                totalW += w;
            }
            fragColor = sum / totalW;
        }`,

    /* ---------- Height from Diffuse (multi-frequency) ----------
       Combines multiple blur levels with user weights.
       Used for the advanced height pipeline.
       ---------------------------------------------------------- */
    combineHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_blur0, u_blur1, u_blur2, u_blur3, u_blur4, u_blur5, u_blur6;
        uniform float u_w0, u_w1, u_w2, u_w3, u_w4, u_w5, u_w6;
        uniform float u_contrast;
        uniform float u_bias;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h = 0.0;
            float tw = 0.0;

            float b0 = texture(u_blur0, v_uv).r; h += b0 * u_w0; tw += u_w0;
            float b1 = texture(u_blur1, v_uv).r; h += b1 * u_w1; tw += u_w1;
            float b2 = texture(u_blur2, v_uv).r; h += b2 * u_w2; tw += u_w2;
            float b3 = texture(u_blur3, v_uv).r; h += b3 * u_w3; tw += u_w3;
            float b4 = texture(u_blur4, v_uv).r; h += b4 * u_w4; tw += u_w4;
            float b5 = texture(u_blur5, v_uv).r; h += b5 * u_w5; tw += u_w5;
            float b6 = texture(u_blur6, v_uv).r; h += b6 * u_w6; tw += u_w6;

            if (tw > 0.0) h /= tw;
            // Subtract DC (average) using heaviest blur
            h -= b6 * 0.5;
            h = h * u_contrast + 0.5 + u_bias;
            // Gamma correction
            h = pow(clamp(h, 0.0, 1.0), 0.45);
            fragColor = vec4(vec3(h), 1.0);
        }`,

    /* ---------- Simple Height (for preset-based generation) ----------
       Desaturate + contrast + bias — simpler than multi-frequency.
       ---------------------------------------------------------------- */
    simpleHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;  // blurred grayscale
        uniform float u_strength;     // 0-1
        uniform float u_bias;         // -0.5 to 0.5
        uniform float u_invert;       // 0 or 1
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h = texture(u_texture, v_uv).r;
            h = (h - 0.5) * u_strength + 0.5 + u_bias;
            if (u_invert > 0.5) h = 1.0 - h;
            h = clamp(h, 0.0, 1.0);
            fragColor = vec4(vec3(h), 1.0);
        }`,

    /* ---------- Seamless Height Edges ----------
       A height map turns a tile's natural left↔right / top↔bottom brightness
       mismatch into a parallax "cliff" at the repeat seam (far more visible than
       the diffuse seam). This blends the sharp interior toward a wrap-blurred
       copy inside a border band: a REPEAT-wrap blur is continuous across the
       seam, so the border becomes continuous while the interior keeps its detail.
       u_band = border width as a fraction of the tile (0..0.5).
       -------------------------------------------------------------------------- */
    edgeFeather: `#version 300 es
        precision highp float;
        uniform sampler2D u_sharp;     // original height
        uniform sampler2D u_blurred;   // wrap-blurred height (continuous across seam)
        uniform float u_band;          // 0..0.5
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float d = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
            float t = smoothstep(0.0, max(u_band, 1e-4), d);   // 0 at edge → blurred, 1 inside → sharp
            float h = mix(texture(u_blurred, v_uv).r, texture(u_sharp, v_uv).r, t);
            fragColor = vec4(vec3(h), 1.0);
        }`,

    /* ---------- Normal Map from Height ----------
       Central-difference height gradient packed as a tangent-space normal.
       Standard Sobel-style technique; independent implementation (differs from
       Materialize, which uses forward differences + a tangent cross-product).
       --------------------------------------------- */
    normalFromHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_heightMap;
        uniform float u_texelSize;        // 1.0 / textureWidth
        uniform float u_strength;         // normal intensity multiplier
        uniform float u_angularity;       // 0-1 blend toward a lateral-tilted normal (steepens near-flat areas)
        uniform float u_angularIntensity; // 0-1 strength of the lateral tilt
        uniform float u_flipY;            // 0 = OpenGL (TombEngine), 1 = DirectX (invert green)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h_l = texture(u_heightMap, v_uv + vec2(-u_texelSize, 0.0)).r;
            float h_r = texture(u_heightMap, v_uv + vec2( u_texelSize, 0.0)).r;
            float h_d = texture(u_heightMap, v_uv + vec2(0.0, -u_texelSize)).r;
            float h_u = texture(u_heightMap, v_uv + vec2(0.0,  u_texelSize)).r;

            vec3 normal = normalize(vec3(
                (h_l - h_r) * u_strength,
                (h_d - h_u) * u_strength,
                1.0
            ));

            // Angularity: tilt near-flat normals toward the lateral hemisphere edge.
            if (u_angularity > 0.0) {
                float len = length(normal.xy);
                if (len > 0.0001) {
                    vec3 angularDir = normalize(vec3(
                        (normal.xy / len) * u_angularIntensity,
                        max(1.0 - u_angularIntensity, 0.001)
                    ));
                    normal = normalize(mix(normal, angularDir, u_angularity));
                }
            }

            if (u_flipY > 0.5) normal.y = -normal.y;

            // Pack [-1,1] → [0,1]
            fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        }`,

    /* ---------- Multi-level Normal (frequency-band blend) ----------
       Multi-scale normal combine. Computes the height
       slope at three blur scales (fine / base / coarse) and blends:

         slope = sBase + wFine*(sFine - sBase) + wCoarse*(sCoarse - sBase)

       With wFine = wCoarse = 0 the result collapses to sBase — i.e. it is
       bit-identical to `normalFromHeight` on the base-blurred height, so the
       single-pass path stays the default and presets keep their calibration.
       - wFine  adds high-frequency surface detail on top of the base shape.
       - wCoarse blends toward large-scale curvature only (softens mid/fine).
       Angularity + FlipNormalY are applied identically to `normalFromHeight`.
       --------------------------------------------------------------- */
    normalFromHeightMulti: `#version 300 es
        precision highp float;
        uniform sampler2D u_hFine;        // less-blurred grayscale (high freq)
        uniform sampler2D u_hBase;        // base-blurred grayscale (single-pass input)
        uniform sampler2D u_hCoarse;      // more-blurred grayscale (low freq)
        uniform float u_texelSize;
        uniform float u_strength;
        uniform float u_wFine;            // weight of the fine band added over base
        uniform float u_wCoarse;          // weight pulling toward large-scale only
        uniform float u_angularity;
        uniform float u_angularIntensity;
        uniform float u_flipY;
        in vec2 v_uv;
        out vec4 fragColor;

        vec2 slopeOf(sampler2D h) {
            float l = texture(h, v_uv + vec2(-u_texelSize, 0.0)).r;
            float r = texture(h, v_uv + vec2( u_texelSize, 0.0)).r;
            float d = texture(h, v_uv + vec2(0.0, -u_texelSize)).r;
            float u = texture(h, v_uv + vec2(0.0,  u_texelSize)).r;
            return vec2(l - r, d - u);
        }

        void main() {
            vec2 sBase   = slopeOf(u_hBase);
            vec2 sFine   = slopeOf(u_hFine);
            vec2 sCoarse = slopeOf(u_hCoarse);
            vec2 s = sBase + u_wFine * (sFine - sBase) + u_wCoarse * (sCoarse - sBase);

            vec3 normal = normalize(vec3(s * u_strength, 1.0));

            // Angularity: tilt near-flat normals toward the lateral hemisphere edge.
            if (u_angularity > 0.0) {
                float len = length(normal.xy);
                if (len > 0.0001) {
                    vec3 angularDir = normalize(vec3(
                        (normal.xy / len) * u_angularIntensity,
                        max(1.0 - u_angularIntensity, 0.001)
                    ));
                    normal = normalize(mix(normal, angularDir, u_angularity));
                }
            }

            if (u_flipY > 0.5) normal.y = -normal.y;

            fragColor = vec4(normal * 0.5 + 0.5, 1.0);
        }`,

    /* ---------- Ambient Occlusion from Height ----------
       Horizon-based AO: for each of 16 directions find the
       MAXIMUM elevation angle within the sample radius, then
       average over directions.

       Using max() (not avg) per direction keeps mortar-joint
       shadows sharp rather than blurring them across the kernel.
       Positive diff = sample is higher than center = occludes center.
       --------------------------------------------------- */
    aoFromHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_heightMap;
        uniform sampler2D u_normalMap;  // packed normal; only used when u_normalBlend > 0
        uniform float u_texelSize;
        uniform float u_radius;         // sample radius in texels (1-30)
        uniform float u_intensity;      // darkness multiplier
        uniform float u_normalBlend;    // 0 = height-field only, 1 = normal-field only (dual-channel AO)
        in vec2 v_uv;
        out vec4 fragColor;

        const int DIRS  = 16;
        const int STEPS = 8;
        const float PI2 = 6.2831853;

        void main() {
            float centerH = texture(u_heightMap, v_uv).r;
            float aoH = 0.0;   // height-field horizon AO
            float aoN = 0.0;   // normal-field AO

            for (int d = 0; d < DIRS; d++) {
                float angle = float(d) / float(DIRS) * PI2;
                vec2 dir = vec2(cos(angle), sin(angle));
                float dirMax = 0.0;
                float nAccum = 0.0;

                for (int s = 1; s <= STEPS; s++) {
                    float t = float(s) / float(STEPS);
                    vec2 sampleUV = v_uv + dir * t * u_radius * u_texelSize;
                    float sampleH = texture(u_heightMap, sampleUV).r;
                    // Positive: sample is above center → occludes it
                    // Closer samples weighted more (1-t falloff)
                    float diff = (sampleH - centerH) * (1.0 - t);
                    dirMax = max(dirMax, diff);

                    if (u_normalBlend > 0.0) {
                        vec2 n = texture(u_normalMap, sampleUV).xy * 2.0 - 1.0;
                        nAccum += max(0.0, dot(n, -dir)) * (1.0 - t);
                    }
                }

                aoH += clamp(dirMax, 0.0, 1.0);
                aoN += clamp(nAccum / float(STEPS), 0.0, 1.0);
            }

            aoH /= float(DIRS);
            aoN /= float(DIRS);
            float ao = mix(aoH, aoN, clamp(u_normalBlend, 0.0, 1.0));
            // Gentler response (0.85 vs old 0.5 — less boosting) plus an AO floor
            // so AO can shade but never crush colour to black. The old curve +
            // no-floor made AO derived from albedo "fry" dark/patterned textures.
            float occ = pow(clamp(ao * u_intensity, 0.0, 1.0), 0.85);
            const float AO_FLOOR = 0.5;          // darkest AO output (≥50% brightness)
            fragColor = vec4(vec3(1.0 - occ * (1.0 - AO_FLOOR)), 1.0);
        }`,

    /* ---------- Roughness Map ----------
       Signed high-pass from diffuse luminance (standard technique).

       hp = lum - blurred_lum  (range ≈ -0.3 … +0.3 for typical textures)
       rough = baseValue + hp * contrast * 2.0

       Because hp is signed, pixels brighter than their local average pull
       roughness above the base; pixels darker than average pull it below.
       This gives genuine bidirectional variation even with a high baseValue,
       fixing the "baked white" issue caused by the old height-variance approach.
       ------------------------------------ */
    roughnessMap: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;   // grayscale of diffuse (unblurred)
        uniform sampler2D u_blurred;   // Gaussian-blurred version (radius 3)
        uniform float u_baseValue;     // 0-1 floor roughness
        uniform float u_contrast;      // 0-1 variation strength
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float lum  = texture(u_diffuse, v_uv).r;
            float blur = texture(u_blurred, v_uv).r;
            // Signed high-pass: captures local texture detail
            float hp = lum - blur;
            float rough = u_baseValue + hp * u_contrast * 2.0;
            fragColor = vec4(vec3(clamp(rough, 0.0, 1.0)), 1.0);
        }`,

    /* ---------- Seamless Maker ----------   ⚠ GPL-3.0 ONLY — NOT under MIT
       Makes a non-tiling texture tile seamlessly.
       Ported (HLSL→GLSL) from Materialize's Blit_Seamless_Texture_Maker.shader
       (frag pass) — a derivative of GPL-3.0 code, so this shader is GPL-3.0 only.
       (Replacing it independently is the last step to a fully-MIT tool; see
       "Path to MIT.md" §4.1.)

       Algorithm per-pixel:
       1. Compute edge-blend mask across overlap zone at origin edges (x=0, y=0).
       2. Sample diffuse + height at 4 offset positions (wrapped via fract).
       3. Remap each quadrant's UV so samples correctly address the texture
          after the overlap zone is removed.  The opposite edges (x=1, y=1)
          are healed by the remapping — their samples wrap into the mask zone.
       4. Height-guided smoothstep blend: highest-surface-wins rule where
          the mask bias ensures each side dominates near its own edge.
       5. Two-pass: horizontal edges first, then vertical using the
          intermediate result.
       ----------------------------------------- */
    seamlessMaker: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;    // original RGB diffuse
        uniform sampler2D u_heightMap;  // grayscale luminance proxy
        uniform float u_overlapX;       // overlap fraction (0.03–0.50)
        uniform float u_overlapY;       // overlap fraction (0.03–0.50)
        uniform float u_falloff;        // blend sharpness (0–1)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float invOverlapX = 1.0 - u_overlapX;
            float invOverlapY = 1.0 - u_overlapY;
            float oneOverOverlapX = 1.0 / u_overlapX;
            float oneOverOverlapY = 1.0 / u_overlapY;

            // Four offset UVs (toroidal wrapping via fract)
            vec2 uv  = fract(v_uv);
            vec2 uv2 = fract(v_uv - vec2(u_overlapX, 0.0));
            vec2 uv3 = fract(v_uv - vec2(0.0, u_overlapY));
            vec2 uv4 = fract(v_uv - vec2(u_overlapX, u_overlapY));

            // ── UV remapping (matches Materialize) ──
            // Each quadrant is scaled so the texture is addressed correctly
            // after the overlap zone is removed.  Without this step the
            // right/top edge samples don't cover the correct wrap regions.
            uv  *= vec2(invOverlapX, invOverlapY);

            uv2.x += u_overlapX;
            uv2   *= vec2(invOverlapX, invOverlapY);

            uv3.y += u_overlapY;
            uv3   *= vec2(invOverlapX, invOverlapY);

            uv4  += vec2(u_overlapX, u_overlapY);
            uv4   *= vec2(invOverlapX, invOverlapY);

            // Blend mask: 0→1 ramp across the overlap zone at the origin edge
            float maskX = clamp((1.0 - fract(v_uv.x) - invOverlapX) * oneOverOverlapX, 0.0, 1.0);
            float maskY = clamp((1.0 - fract(v_uv.y) - invOverlapY) * oneOverOverlapY, 0.0, 1.0);

            // Sample heights
            float h  = texture(u_heightMap, uv).r;
            float h2 = texture(u_heightMap, uv2).r;
            float h3 = texture(u_heightMap, uv3).r;
            float h4 = texture(u_heightMap, uv4).r;

            // Sample colours
            vec4 c  = texture(u_texture, uv);
            vec4 c2 = texture(u_texture, uv2);
            vec4 c3 = texture(u_texture, uv3);
            vec4 c4 = texture(u_texture, uv4);

            // Smoothstep range from falloff
            float ssHigh = 0.01 + 0.5 * clamp(u_falloff, 0.0, 1.0);
            float ssLow  = -0.01 - 0.5 * clamp(u_falloff, 0.0, 1.0);

            // ---- Horizontal blend (left ↔ right edges) ----
            float texBlendH = smoothstep(ssLow, ssHigh,
                (h2 + maskX) - (h + (1.0 - maskX)));
            vec4 colH = mix(c, c2, texBlendH);
            float heightH = max(h + (1.0 - maskX), h2 + maskX) - 1.0
                          + clamp(min(maskX, 1.0 - maskX), 0.0, 1.0);

            // ---- Vertical blend (top ↔ bottom edges) ----
            float texBlendV = smoothstep(ssLow, ssHigh,
                (h4 + maskX) - (h3 + (1.0 - maskX)));
            vec4 colV = mix(c3, c4, texBlendV);
            float heightV = max(h3 + (1.0 - maskX), h4 + maskX) - 1.0
                          + clamp(min(maskX, 1.0 - maskX), 0.0, 1.0);

            // ---- Combine horizontal + vertical ----
            float texBlend = smoothstep(ssLow, ssHigh,
                (heightV + maskY) - (heightH + (1.0 - maskY)));
            vec4 result = mix(colH, colV, texBlend);

            fragColor = vec4(result.rgb, 1.0);
        }`,

    /* ---------- Seamless: Splat (random stamps) ----------   ⚠ GPL-3.0 ONLY — NOT under MIT
       Ported (HLSL→GLSL) from Materialize's Blit_Seamless_Texture_Maker.shader
       (frag_splat pass). Rebuilds the texture from 4 rotated/wobbled
       stamps on a fixed square kernel, composited highest-height-wins
       so overlaps follow surface detail instead of cross-fading.
       Materialize accumulates one blit per stamp through ping-pong
       buffers; TRLE textures are always square, so the square kernel
       is hardcoded and the whole accumulation runs in a single pass.
       Each stamp is drawn at 9 wrap offsets for toroidal tiling.
       ------------------------------------------------------------- */
    seamlessSplat: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;     // original RGB diffuse
        uniform sampler2D u_heightMap;   // grayscale luminance proxy
        uniform float u_falloff;         // blend sharpness (0-1)
        uniform float u_rotation;        // base rotation, turns (0-1)
        uniform float u_rotationRandom;  // random rotation amount (0-1)
        uniform float u_scale;           // stamp scale (0.5-2.0)
        uniform float u_wobble;          // random offset amount (0-1)
        uniform float u_randomize;       // randomize seed (0-1)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            // Square splat kernel: xy = centre, z = stamp size
            const vec3 KERNEL[4] = vec3[4](
                vec3(0.0,  0.25, 0.8), vec3(0.5,  0.25, 0.8),
                vec3(0.25, 0.75, 0.8), vec3(0.75, 0.75, 0.8));
            const vec2 OFFSETS[9] = vec2[9](
                vec2( 1.0,  1.0), vec2(0.0,  1.0), vec2(-1.0,  1.0),
                vec2( 1.0,  0.0), vec2(0.0,  0.0), vec2(-1.0,  0.0),
                vec2( 1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, -1.0));

            float ssHigh =  0.01 + 0.5 * clamp(u_falloff, 0.0, 1.0);
            float ssLow  = -0.01 - 0.5 * clamp(u_falloff, 0.0, 1.0);

            vec3  accCol = vec3(0.0);
            float accH   = 0.0;

            for (int i = 0; i < 4; i++) {
                // Per-stamp pseudo-random values (Materialize's CPU-side
                // sin/cos hashes of the randomize seed, moved in-shader)
                float fi  = u_randomize + 1.0 + float(i);
                float rnd = sin(fi * 472.361);
                vec2  wob = vec2(sin(fi * 128.352), cos(fi * 243.767));

                float rot = (u_rotation + u_rotationRandom * rnd) * -6.28318530718;
                float cr = cos(rot), sr = sin(rot);

                for (int j = 0; j < 9; j++) {
                    vec2 p = (v_uv - KERNEL[i].xy + OFFSETS[j])
                           / (u_scale * KERNEL[i].z);
                    p = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);

                    // Rounded-square falloff masks over the stamp extent
                    vec2 m = clamp(abs(p * 2.0), 0.0, 1.0);
                    float box        = (1.0 - m.x) * (1.0 - m.y);
                    float centerMask = pow(clamp((box - 0.1) * 2.0, 0.0, 1.0), 0.3);
                    float uvMask     = clamp(box * 10.0, 0.0, 1.0);

                    vec2 suv = fract(p / (u_wobble + 1.0) + wob * u_wobble + 0.5);
                    float h  = texture(u_heightMap, suv).r;
                    vec3  c  = texture(u_texture,  suv).rgb;

                    // Highest surface wins, softened by falloff
                    float stampH = (h + 0.2) * centerMask * uvMask;
                    float blend  = smoothstep(ssLow, ssHigh, accH - stampH);
                    accCol = mix(c, accCol, blend);
                    accH   = max(accH, stampH);
                }
            }
            fragColor = vec4(accCol, 1.0);
        }`,

    /* ---------- Seamless: Scattered Edges (phase 2 default) ----------
       Half-offset base, but the seam is broken up with a noise-driven
       stochastic pick instead of a clean blend — hides the join on
       organic/noisy textures (sand, grass, gravel, foliage, rough stone).
       u_falloff blends from full scatter (0) to a smooth blend (1).
       ------------------------------------------------------------------ */
    seamlessScattered: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_overlapX;
        uniform float u_overlapY;
        uniform float u_falloff;
        uniform float u_scatterScale;   // noise granularity (≈ texture px width)
        in vec2 v_uv;
        out vec4 fragColor;

        float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        void main() {
            vec2 uv    = v_uv;
            vec2 uvOff = fract(uv + vec2(0.5));
            vec3 cOrig = texture(u_texture, uv).rgb;
            vec3 cOff  = texture(u_texture, uvOff).rgb;

            float dx = min(uv.x, 1.0 - uv.x);
            float dy = min(uv.y, 1.0 - uv.y);
            float ox = max(u_overlapX, 0.001);
            float oy = max(u_overlapY, 0.001);
            float feather = min(smoothstep(0.0, ox, dx), smoothstep(0.0, oy, dy));

            float n        = hash21(uv * u_scatterScale);
            float scatter  = step(n, feather);                       // dithered seam
            float sharp    = mix(8.0, 0.8, clamp(u_falloff, 0.0, 1.0));
            float smoothW  = clamp((feather - 0.5) * sharp + 0.5, 0.0, 1.0);
            float w        = mix(scatter, smoothW, clamp(u_falloff, 0.0, 1.0));

            fragColor = vec4(mix(cOff, cOrig, w), 1.0);
        }`,

    /* ---------- Seamless: Smoothed Copies of All Sides ----------
       Centre is left untouched; each border band is cross-faded with an
       axis-shifted copy so opposite edges match. Best for structured
       textures (brick, tile, panels) — preserves interior detail.
       ------------------------------------------------------------- */
    seamlessAllSides: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_overlapX;
        uniform float u_overlapY;
        uniform float u_falloff;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec2 uv = v_uv;
            vec3 c  = texture(u_texture, uv).rgb;
            vec3 cX = texture(u_texture, fract(uv + vec2(0.5, 0.0))).rgb; // for L/R seams
            vec3 cY = texture(u_texture, fract(uv + vec2(0.0, 0.5))).rgb; // for T/B seams

            float ox = max(u_overlapX, 0.001);
            float oy = max(u_overlapY, 0.001);
            float wx = min(smoothstep(0.0, ox, uv.x), smoothstep(0.0, ox, 1.0 - uv.x));
            float wy = min(smoothstep(0.0, oy, uv.y), smoothstep(0.0, oy, 1.0 - uv.y));

            float sharp = mix(8.0, 0.8, clamp(u_falloff, 0.0, 1.0));
            wx = clamp((wx - 0.5) * sharp + 0.5, 0.0, 1.0);
            wy = clamp((wy - 0.5) * sharp + 0.5, 0.0, 1.0);

            vec3 hb  = mix(cX, c, wx);   // resolve vertical seams first
            vec3 res = mix(cY, hb, wy);  // then horizontal seams + corners
            fragColor = vec4(res, 1.0);
        }`,

    /* ---------- Seamless: Smoothed Collage ----------
       Plain half-offset feather blend. Cheapest; good for smooth,
       low-contrast surfaces (plaster). No UV scaling.
       ------------------------------------------------ */
    seamlessCollage: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_overlapX;
        uniform float u_overlapY;
        uniform float u_falloff;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec2 uv    = v_uv;
            vec2 uvOff = fract(uv + vec2(0.5));
            vec3 cOrig = texture(u_texture, uv).rgb;
            vec3 cOff  = texture(u_texture, uvOff).rgb;

            float dx = min(uv.x, 1.0 - uv.x);
            float dy = min(uv.y, 1.0 - uv.y);
            float ox = max(u_overlapX, 0.001);
            float oy = max(u_overlapY, 0.001);
            float feather = min(smoothstep(0.0, ox, dx), smoothstep(0.0, oy, dy));

            float sharp = mix(8.0, 0.8, clamp(u_falloff, 0.0, 1.0));
            float w = clamp((feather - 0.5) * sharp + 0.5, 0.0, 1.0);
            fragColor = vec4(mix(cOff, cOrig, w), 1.0);
        }`,

    /* ---------- Seamless pre-pass: Crop & Resample ----------
       Re-samples a cropped sub-rect back to full size to trim dirty edges.
       u_crop = (left, top, right, bottom) as fractions [0–1).
       --------------------------------------------------------- */
    seamlessCrop: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec4 u_crop;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec2 lo = vec2(u_crop.x, u_crop.y);
            vec2 hi = vec2(1.0 - u_crop.z, 1.0 - u_crop.w);
            fragColor = texture(u_texture, mix(lo, hi, v_uv));
        }`,

    /* ---------- Generic two-texture mix (pre-average blend) ---------- */
    mix2: `#version 300 es
        precision highp float;
        uniform sampler2D u_texA;
        uniform sampler2D u_texB;
        uniform float u_amount;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            fragColor = mix(texture(u_texA, v_uv), texture(u_texB, v_uv), clamp(u_amount, 0.0, 1.0));
        }`,

    /* ---------- Tile Preview (2×2 tiling, 1:1) ----------
       Maps UVs to a 2×2 grid for live seamless preview, with an optional
       seam marker drawn along the tile joins so users can judge the result.
       ------------------------------------------------------ */
    tilePreview: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_showSeam;    // 0 / 1
        uniform vec3  u_seamColor;
        uniform float u_lineHalf;    // half line width in preview-uv units
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec2 tiledUV = fract(v_uv * 2.0);
            vec4 col = texture(u_texture, tiledUV);
            if (u_showSeam > 0.5) {
                float dxs = min(abs(v_uv.x - 0.5), min(v_uv.x, 1.0 - v_uv.x));
                float dys = min(abs(v_uv.y - 0.5), min(v_uv.y, 1.0 - v_uv.y));
                float d = min(dxs, dys);
                float line = 1.0 - smoothstep(0.0, u_lineHalf, d);
                col.rgb = mix(col.rgb, u_seamColor, line * 0.9);
            }
            fragColor = col;
        }`,

    /* ---------- Specular Map ----------
       Inverse-roughness concept: smooth = high specular.
       --------------------------------------------------- */
    specularMap: `#version 300 es
        precision highp float;
        uniform sampler2D u_heightMap;   // grayscale
        uniform float u_texelSize;
        uniform float u_baseValue;       // 0-1
        uniform float u_contrast;        // 0-1
        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            // Sample local smoothness (inverse of variance)
            float center = texture(u_heightMap, v_uv).r;
            float dev = 0.0;
            float count = 0.0;
            float avg = 0.0;
            for (int x = -3; x <= 3; x++) {
                for (int y = -3; y <= 3; y++) {
                    float s = texture(u_heightMap, v_uv + vec2(float(x), float(y)) * u_texelSize * 1.5).r;
                    avg += s;
                    count += 1.0;
                }
            }
            avg /= count;
            for (int x = -3; x <= 3; x++) {
                for (int y = -3; y <= 3; y++) {
                    float s = texture(u_heightMap, v_uv + vec2(float(x), float(y)) * u_texelSize * 1.5).r;
                    dev += abs(s - avg);
                }
            }
            dev /= count;

            float smoothness = 1.0 - sqrt(dev) * 4.0;
            float spec = u_baseValue + smoothness * u_contrast;
            // Luminance influence
            spec += (center - 0.5) * 0.10;
            fragColor = vec4(vec3(clamp(spec, 0.0, 1.0)), 1.0);
        }`,

    /* ---------- Emissive Map ----------
       Threshold-based brightness extraction.
       Bright areas in diffuse → emissive glow.
       ----------------------------------------- */
    emissiveMap: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;     // diffuse
        uniform float u_threshold;       // 0-1: brightness above which = emissive
        uniform float u_strength;        // 0-1: emissive intensity
        uniform float u_softness;        // 0-1: how soft the threshold edge is
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec3 c = texture(u_texture, v_uv).rgb;
            float lum = dot(c, vec3(0.299, 0.587, 0.114));
            float edge = u_softness * 0.3 + 0.01;
            float mask = smoothstep(u_threshold - edge, u_threshold + edge, lum);
            vec3 emissive = c * mask * u_strength;
            fragColor = vec4(emissive, 1.0);
        }`,

    /* ---------- Emissive Mask (authoring) ----------
       Builds a single-channel selection mask from the diffuse using one of
       three modes. Output is greyscale (mask in .rgb); a later pass colours it.
         u_mode 0 = brightness · 1 = colour-distance · 2 = hue range
       ------------------------------------------------ */
    emissiveMask: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;   // diffuse
        uniform float u_mode;          // 0 brightness | 1 colour | 2 hue
        uniform float u_threshold;     // brightness cutoff (0-1)
        uniform float u_softness;      // edge softness (0-1)
        uniform vec3  u_target;        // colour-mode target (0-1)
        uniform float u_tolerance;     // colour-mode max distance (0-1)
        uniform float u_hueCenter;     // hue-mode centre (0-1)
        uniform float u_hueWidth;      // hue-mode half-width (0-1)
        uniform float u_satMin;        // hue-mode min saturation
        uniform float u_valMin;        // hue-mode min value
        in vec2 v_uv;
        out vec4 fragColor;
        vec3 rgb2hsv(vec3 c){
            vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }
        void main(){
            vec3 c = texture(u_texture, v_uv).rgb;
            float mask = 0.0;
            if (u_mode < 0.5) {
                float lum = dot(c, vec3(0.299, 0.587, 0.114));
                float edge = u_softness * 0.3 + 0.01;
                mask = smoothstep(u_threshold - edge, u_threshold + edge, lum);
            } else if (u_mode < 1.5) {
                float dist = distance(c, u_target);
                float edge = u_softness * 0.3 + 0.01;
                mask = 1.0 - smoothstep(u_tolerance - edge, u_tolerance + edge, dist);
            } else {
                vec3 hsv = rgb2hsv(c);
                float dh = abs(hsv.x - u_hueCenter);
                dh = min(dh, 1.0 - dh);                       // wrap around the hue wheel
                float edge = u_softness * 0.1 + 0.005;
                float hueMask = 1.0 - smoothstep(u_hueWidth - edge, u_hueWidth + edge, dh);
                float satMask = smoothstep(u_satMin - 0.05, u_satMin + 0.05, hsv.y);
                float valMask = smoothstep(u_valMin - 0.05, u_valMin + 0.05, hsv.z);
                mask = hueMask * satMask * valMask;
            }
            fragColor = vec4(vec3(mask), 1.0);
        }`,

    /* ---------- Emissive Apply ----------
       Combines a selection mask with a glow source — either the diffuse's own
       colours or a flat tint — scaled by strength. Produces the final emissive. */
    emissiveApply: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        uniform sampler2D u_mask;
        uniform float u_useTint;       // >0.5 = use u_tint, else diffuse colour
        uniform vec3  u_tint;
        uniform float u_strength;      // 0-1
        in vec2 v_uv;
        out vec4 fragColor;
        void main(){
            vec3 c = texture(u_diffuse, v_uv).rgb;
            float m = texture(u_mask, v_uv).r;
            vec3 src = u_useTint > 0.5 ? u_tint : c;
            fragColor = vec4(src * m * u_strength, 1.0);
        }`,

    /* ---------- Transition Composite ----------
       Blends base + overlay using a mask texture.
       -------------------------------------------- */
    transitionComposite: `#version 300 es
        precision highp float;
        uniform sampler2D u_base;
        uniform sampler2D u_overlay;
        uniform sampler2D u_mask;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 base = texture(u_base, v_uv);
            vec4 over = texture(u_overlay, v_uv);
            float m = texture(u_mask, v_uv).r;
            fragColor = vec4(mix(base.rgb, over.rgb, m), mix(base.a, over.a, m));
        }`,

    /* ---------- Mask Blur (tile-aware) ----------
       Blurs a mask using the 3x3 tiling trick
       for seamless edges. Samples from a 3x3 tiled version.
       ------------------------------------------------------ */
    tileMaskBlur: `#version 300 es
        precision highp float;
        uniform sampler2D u_mask;
        uniform vec2 u_direction;
        uniform float u_radius;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            if (u_radius < 0.5) {
                fragColor = texture(u_mask, v_uv);
                return;
            }
            // Convert to 3x3 tiled space (center tile)
            vec2 tiledUV = (v_uv + 1.0) / 3.0; // offset to center tile of 3x3
            vec4 sum = vec4(0.0);
            float totalW = 0.0;
            int r = int(min(u_radius, 40.0));
            for (int i = -40; i <= 40; i++) {
                if (i < -r || i > r) continue;
                float fi = float(i);
                float w = cos(fi / u_radius * 1.5707963) * (1.0 - abs(fi) / (u_radius + 1.0));
                w = max(w, 0.0);
                vec2 sampleUV = tiledUV + u_direction * fi;
                // Wrap to [0,1] for tiled sampling
                sampleUV = fract(sampleUV);
                sum += texture(u_mask, sampleUV) * w;
                totalW += w;
            }
            fragColor = sum / totalW;
        }`,

    /* ---------- Edge Seam Protection Mask ----------
       Creates a hard mask with inward-curving boundary
       to ensure seamless edges on transitions.
       ------------------------------------------------ */
    seamProtection: `#version 300 es
        precision highp float;
        uniform sampler2D u_blurredMask;
        uniform sampler2D u_hardMask;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float blurred = texture(u_blurredMask, v_uv).r;
            float hard = texture(u_hardMask, v_uv).r;
            // Take maximum — hard mask protects edges,
            // blurred mask provides smooth interior transition
            float result = max(blurred, hard);
            fragColor = vec4(vec3(result), 1.0);
        }`,

    /* ---------- Normalize Contrast (range stretch) ----------
       Remaps grayscale from [u_min, u_max] → [0, 1].
       Applied after desaturation so dark textures produce the
       same gradient magnitude as bright ones in normals/AO/height.
       ------------------------------------------------------------ */
    normalizeContrast: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_min;
        uniform float u_max;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float range = max(u_max - u_min, 0.001);
            float h = texture(u_texture, v_uv).r;
            fragColor = vec4(vec3(clamp((h - u_min) / range, 0.0, 1.0)), 1.0);
        }`,

    /* ---------- Edge Enhance (Unsharp Mask) ----------
       Amplifies high-frequency detail in the normalized grayscale
       before normal/AO generation. Used for architectural presets
       (brick, tile, concrete, slate, etc.) where mortar/grout edges
       have low absolute contrast and would otherwise produce flat normals.
       Runs only when preset.edgeEnhance > 0.
       -------------------------------------------------- */
    edgeEnhance: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;  // normalized grayscale
        uniform sampler2D u_blurred;  // Gaussian-blurred version (radius 2)
        uniform float u_strength;     // amplification factor (3–6)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h = texture(u_texture, v_uv).r;
            float b = texture(u_blurred, v_uv).r;
            float edge = h - b;
            fragColor = vec4(vec3(clamp(h + edge * u_strength, 0.0, 1.0)), 1.0);
        }`,

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

    /* ---------- Transition: height-blended organic edge (Phase 4) ----------
       Like transitionComposite, but near the mask mid-line the blend is
       biased by each source's luminance ("height"), so the boundary
       interlocks instead of being a straight alpha cross-fade. Borders
       (m≈0 / m≈1) are preserved exactly so the tile still connects to its
       neighbours — the height term is windowed by 4·m·(1-m).
       ----------------------------------------------------------------------- */
    transitionHeightBlend: `#version 300 es
        precision highp float;
        uniform sampler2D u_base;
        uniform sampler2D u_overlay;
        uniform sampler2D u_mask;
        uniform float u_detail;   // 0..1 strength of the height interlock
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 base = texture(u_base, v_uv);
            vec4 over = texture(u_overlay, v_uv);
            float m   = texture(u_mask, v_uv).r;
            float hA = dot(base.rgb, vec3(0.299, 0.587, 0.114));
            float hB = dot(over.rgb, vec3(0.299, 0.587, 0.114));
            float band = 4.0 * m * (1.0 - m);              // 0 at edges, 1 mid
            float w = clamp(m + u_detail * (hB - hA) * band, 0.0, 1.0);
            fragColor = vec4(mix(base.rgb, over.rgb, w), mix(base.a, over.a, w));
        }`,

    /* ---------- Poisson guidance: weighted Laplacian (Phase 4) ----------
       Outputs L = (1-m)·∇²base + m·∇²overlay per channel (RGBA16F, signed).
       Used as the divergence term of the Poisson equation ∇²f = L.
       --------------------------------------------------------------------- */
    poissonGuidance: `#version 300 es
        precision highp float;
        uniform sampler2D u_base;
        uniform sampler2D u_overlay;
        uniform sampler2D u_mask;
        uniform vec2 u_texel;     // (1/S, 1/S)
        in vec2 v_uv;
        out vec4 fragColor;
        vec3 lap(sampler2D t) {
            vec3 c = texture(t, v_uv).rgb;
            vec3 l = texture(t, v_uv - vec2(u_texel.x, 0.0)).rgb;
            vec3 r = texture(t, v_uv + vec2(u_texel.x, 0.0)).rgb;
            vec3 d = texture(t, v_uv - vec2(0.0, u_texel.y)).rgb;
            vec3 u = texture(t, v_uv + vec2(0.0, u_texel.y)).rgb;
            return l + r + d + u - 4.0 * c;
        }
        void main() {
            float m = texture(u_mask, v_uv).r;
            vec3 L = mix(lap(u_base), lap(u_overlay), m);
            fragColor = vec4(L, 1.0);
        }`,

    /* ---------- Poisson Jacobi relaxation step (Phase 4) ----------
       One iteration of  f = (fL+fR+fU+fD - L) / 4 , holding the 1px border
       fixed to the alpha-blended result so connectivity is unchanged.
       Ping-pong this shader ~300×, seeded from the alpha result.
       -------------------------------------------------------------- */
    poissonJacobi: `#version 300 es
        precision highp float;
        uniform sampler2D u_f;          // current solution
        uniform sampler2D u_guidance;   // L from poissonGuidance
        uniform sampler2D u_alpha;      // boundary / seed value
        uniform vec2 u_texel;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            // Hold the outer ring fixed (Dirichlet boundary).
            if (v_uv.x < u_texel.x || v_uv.x > 1.0 - u_texel.x ||
                v_uv.y < u_texel.y || v_uv.y > 1.0 - u_texel.y) {
                fragColor = vec4(texture(u_alpha, v_uv).rgb, 1.0);
                return;
            }
            vec3 fl = texture(u_f, v_uv - vec2(u_texel.x, 0.0)).rgb;
            vec3 fr = texture(u_f, v_uv + vec2(u_texel.x, 0.0)).rgb;
            vec3 fd = texture(u_f, v_uv - vec2(0.0, u_texel.y)).rgb;
            vec3 fu = texture(u_f, v_uv + vec2(0.0, u_texel.y)).rgb;
            vec3 L  = texture(u_guidance, v_uv).rgb;
            fragColor = vec4((fl + fr + fd + fu - L) * 0.25, 1.0);
        }`,

    /* ---------- Inpaint Jacobi (Laplace fill, Phase 6) ----------
       Diffusion inpainting: known pixels (mask < 0.5) are held to the original;
       hole pixels relax to the average of their neighbours. Ping-pong until the
       surrounding colours diffuse across the painted region.
       ------------------------------------------------------------ */
    inpaintJacobi: `#version 300 es
        precision highp float;
        uniform sampler2D u_f;       // current solution
        uniform sampler2D u_orig;    // original image (known pixels)
        uniform sampler2D u_mask;    // white = hole to fill
        uniform vec2 u_texel;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float m = texture(u_mask, v_uv).r;
            if (m < 0.5) { fragColor = vec4(texture(u_orig, v_uv).rgb, 1.0); return; }
            vec3 l = texture(u_f, v_uv - vec2(u_texel.x, 0.0)).rgb;
            vec3 r = texture(u_f, v_uv + vec2(u_texel.x, 0.0)).rgb;
            vec3 d = texture(u_f, v_uv - vec2(0.0, u_texel.y)).rgb;
            vec3 u = texture(u_f, v_uv + vec2(0.0, u_texel.y)).rgb;
            fragColor = vec4((l + r + d + u) * 0.25, 1.0);
        }`,

    /* ---------- De-light (remove baked lighting, Phase 7) ----------
       Divides the diffuse by its own low-frequency luminance (a heavy blur),
       flattening large-scale brightness variation (baked sun/shadow) while
       keeping local colour + detail. Re-centred to mid-grey and mixed back by
       u_strength so it stays controllable.
       --------------------------------------------------------------- */
    delight: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;   // diffuse
        uniform sampler2D u_blurred;   // heavily blurred diffuse
        uniform float u_strength;      // 0..1
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec3 d = texture(u_texture, v_uv).rgb;
            vec3 b = texture(u_blurred, v_uv).rgb;
            float bl = dot(b, vec3(0.299, 0.587, 0.114));
            vec3 evened = d / max(bl, 0.04) * 0.5;        // normalise by local luminance
            fragColor = vec4(clamp(mix(d, evened, u_strength), 0.0, 1.0), 1.0);
        }`,

    /* ---------- Colour Adjust (HSL / contrast / gamma / temp) ----------
       A non-destructive colour grade applied to a whole tile. Order: white
       balance → gamma → brightness/contrast → hue/saturation → vibrance →
       invert. Alpha is preserved. ------------------------------------------ */
    colorAdjust: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_hue;        // degrees (-180..180)
        uniform float u_sat;        // 0..2 (1 = neutral)
        uniform float u_bright;     // -1..1 additive
        uniform float u_contrast;   // 0..2 (1 = neutral)
        uniform float u_gamma;      // 0.2..3 (1 = neutral)
        uniform float u_temp;       // -1..1 (warm + / cool -)
        uniform float u_tint;       // -1..1 (magenta + / green -)
        uniform float u_vibrance;   // -1..1
        uniform float u_invert;     // 0/1
        in vec2 v_uv;
        out vec4 fragColor;
        vec3 rgb2hsv(vec3 c){
            vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
        }
        vec3 hsv2rgb(vec3 c){
            vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        void main(){
            vec4 src = texture(u_texture, v_uv);
            vec3 c = src.rgb;
            c.r += u_temp * 0.15; c.b -= u_temp * 0.15; c.g += u_tint * 0.15;   // white balance
            c = clamp(c, 0.0, 1.0);
            c = pow(c, vec3(1.0 / max(u_gamma, 0.01)));                          // gamma
            c += u_bright;                                                        // brightness
            c = (c - 0.5) * u_contrast + 0.5;                                     // contrast
            c = clamp(c, 0.0, 1.0);
            vec3 hsv = rgb2hsv(c);
            hsv.x = fract(hsv.x + u_hue / 360.0);                                 // hue
            hsv.y = clamp(hsv.y * u_sat, 0.0, 1.0);                               // saturation
            c = hsv2rgb(hsv);
            float lum = dot(c, vec3(0.299, 0.587, 0.114));                        // vibrance
            c = mix(vec3(lum), c, clamp(1.0 + u_vibrance * (1.0 - hsv.y), 0.0, 3.0));
            c = clamp(c, 0.0, 1.0);
            c = mix(c, 1.0 - c, u_invert);                                        // invert
            fragColor = vec4(c, src.a);
        }`,

    /* ---------- Colour Transfer (recolour from another texture) ----------
       Reinhard-style per-channel mean/std transfer: shifts a tile's colour
       distribution toward a reference's. meanA/scale come from the source,
       meanB from the reference; u_strength blends back to the original. ----- */
    colorTransfer: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec3  u_meanA;   // source per-channel mean
        uniform vec3  u_meanB;   // reference per-channel mean
        uniform vec3  u_scale;   // stdB / stdA per channel
        uniform float u_strength;
        in vec2 v_uv;
        out vec4 fragColor;
        void main(){
            vec4 src = texture(u_texture, v_uv);
            vec3 mapped = (src.rgb - u_meanA) * u_scale + u_meanB;
            vec3 outc = clamp(mix(src.rgb, mapped, u_strength), 0.0, 1.0);
            fragColor = vec4(outc, src.a);
        }`,

    /* ---------- Animated tileable noise (Phase 0 spike) ----------
       Procedural noise for animated textures. The trick for "the last frame
       loops back into the first" is to sample a *periodic* 3D gradient noise
       (Gustavson's classic pnoise) where the third axis is time: we traverse
       exactly one period over t∈[0,1), so the frame at t=1 is identical to t=0.
       The x/y axes are also periodic, so every individual frame tiles seamlessly
       (which doubles as the single-tile "UV-rotate" output mode).
         u_time          animation phase, 0..1 (frame i → i/frames)
         u_period        integer lattice repeats per axis (scale; x≠y stretches the
                         pattern → vertical streaks for fire/waterfalls)
         u_flow          directional scroll in WHOLE tiles over the loop. Because the
                         field is spatially periodic, scrolling by an integer number
                         of tiles lands exactly back on itself, so the loop and the
                         seamless tiling both survive the motion.
         u_timePeriod    integer churn cycles over the loop (apparent speed)
         u_octaves       fBm octaves (1..8); freq & period double each octave
         u_gain          per-octave amplitude falloff (≈0.5)
         u_warp          domain-warp amount (swirl); 0 = none
         u_contrast      output contrast around 0.5
         u_seed          integer-ish pattern offset (preserves tiling)
         u_style         0 fBm (clouds/smoke), 1 ridged (caustics/veins), 2 billow
         u_useRamp       1 = map value through u_ramp gradient, 0 = grayscale
         u_ramp          1D RGBA gradient (256×1) sampled at the noise value
         u_equalize      0..1 (ramp only) flatten the value distribution so the
                         gradient uses its full colour range; also relaxes contrast
       Output: RGBA — grayscale, or the palette colour (with the ramp's alpha). */
    animNoise: `#version 300 es
        precision highp float;
        uniform float u_time;
        uniform vec2  u_period;   // lattice repeats per axis (integer → tileable; x≠y stretches)
        uniform vec2  u_flow;     // directional scroll in whole tiles over the loop (integer → still loops)
        uniform float u_timePeriod;
        uniform float u_octaves;
        uniform float u_gain;
        uniform float u_warp;
        uniform float u_contrast;
        uniform float u_seed;
        uniform float u_style;
        uniform float u_useRamp;
        uniform sampler2D u_ramp;
        uniform float u_equalize;   // 0..1 colour-spread (ramp only)
        in vec2 v_uv;
        out vec4 fragColor;

        vec3 mod289v3(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
        vec4 mod289v4(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
        vec4 permute(vec4 x){ return mod289v4(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
        vec3 fade(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

        // Classic periodic 3D Perlin noise (period = rep, must be integer).
        float pnoise(vec3 P, vec3 rep){
            vec3 Pi0 = mod(floor(P), rep);
            vec3 Pi1 = mod(Pi0 + 1.0, rep);
            Pi0 = mod289v3(Pi0); Pi1 = mod289v3(Pi1);
            vec3 Pf0 = fract(P);
            vec3 Pf1 = Pf0 - 1.0;
            vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
            vec4 iy = vec4(Pi0.yy, Pi1.yy);
            vec4 iz0 = Pi0.zzzz, iz1 = Pi1.zzzz;
            vec4 ixy = permute(permute(ix) + iy);
            vec4 ixy0 = permute(ixy + iz0);
            vec4 ixy1 = permute(ixy + iz1);
            vec4 gx0 = ixy0 * (1.0/7.0);
            vec4 gy0 = fract(floor(gx0) * (1.0/7.0)) - 0.5;
            gx0 = fract(gx0);
            vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
            vec4 sz0 = step(gz0, vec4(0.0));
            gx0 -= sz0 * (step(0.0, gx0) - 0.5);
            gy0 -= sz0 * (step(0.0, gy0) - 0.5);
            vec4 gx1 = ixy1 * (1.0/7.0);
            vec4 gy1 = fract(floor(gx1) * (1.0/7.0)) - 0.5;
            gx1 = fract(gx1);
            vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
            vec4 sz1 = step(gz1, vec4(0.0));
            gx1 -= sz1 * (step(0.0, gx1) - 0.5);
            gy1 -= sz1 * (step(0.0, gy1) - 0.5);
            vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
            vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
            vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
            vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
            vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
            vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
            vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
            vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
            vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
            g000*=norm0.x; g010*=norm0.y; g100*=norm0.z; g110*=norm0.w;
            vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
            g001*=norm1.x; g011*=norm1.y; g101*=norm1.z; g111*=norm1.w;
            float n000 = dot(g000, Pf0);
            float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
            float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
            float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
            float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
            float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
            float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
            float n111 = dot(g111, Pf1);
            vec3 f = fade(Pf0);
            vec4 nz = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), f.z);
            vec2 nyz = mix(nz.xy, nz.zw, f.y);
            return 2.2 * mix(nyz.x, nyz.y, f.x);
        }

        // Per-octave value shaped by style; all returned roughly in 0..1.
        float shape(float n, int style){
            if (style == 1) return 1.0 - abs(n);   // ridged → sharp caustics/veins
            if (style == 2) return abs(n);          // billow → puffy
            return n * 0.5 + 0.5;                    // fBm (default)
        }
        // fBm of periodic noise. seedOff is an integer offset (keeps tiling).
        float fbm(vec2 uv, float t, vec3 seedOff, int style){
            float amp = 0.5, sum = 0.0, norm = 0.0;
            vec3 rep = vec3(u_period.x, u_period.y, u_timePeriod);
            vec3 P = vec3(uv * u_period, t * u_timePeriod) + seedOff;
            for (int i = 0; i < 8; i++){
                if (float(i) >= u_octaves) break;
                sum  += amp * shape(pnoise(P, rep), style);
                norm += amp;
                P *= 2.0; rep *= 2.0; amp *= u_gain;
            }
            return sum / max(norm, 1e-4);
        }

        // Colour-spread: remap the style-skewed value toward a uniform 0..1 so a
        // full-spectrum ramp isn't starved in the middle. Per-style, since fBm
        // piles near 0.5, ridged near 1.0, billow near 0.0.
        float flattenValue(float v, int style){
            v = clamp(v, 0.0, 1.0);
            if (style == 1) return v * v;                              // ridged: high pile → pull down
            if (style == 2) { float w = 1.0 - v; return 1.0 - w * w; } // billow: low pile → lift
            return smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, v));      // fBm: stretch the centre out
        }

        void main(){
            int style = int(u_style + 0.5);
            vec3 seedOff = floor(vec3(u_seed*16.0, u_seed*16.0 + 5.0, u_seed*16.0 + 11.0));
            // Directional scroll (whole tiles per loop → stays seamless + looping).
            vec2 uv = v_uv + u_flow * u_time;
            if (u_warp > 0.0){
                // Periodic, zero-mean warp field (integer offsets keep it
                // tileable + looping); style 0 keeps the displacement smooth.
                vec2 w = vec2(fbm(uv, u_time, seedOff + vec3(3.0,7.0,0.0), 0) - 0.5,
                              fbm(uv, u_time, seedOff + vec3(11.0,2.0,0.0), 0) - 0.5);
                uv += u_warp * 2.0 * w / u_period;
            }
            float v = fbm(uv, u_time, seedOff, style);
            // Colour-spread (opt-in, ramp only): flatten the distribution and relax
            // contrast toward neutral so the gradient sweeps its whole range.
            float eqAmt = (u_useRamp > 0.5) ? clamp(u_equalize, 0.0, 1.0) : 0.0;
            if (eqAmt > 0.0) v = mix(v, flattenValue(v, style), eqAmt);
            float c = mix(u_contrast, 1.0, eqAmt);
            v = clamp((v - 0.5) * c + 0.5, 0.0, 1.0);
            fragColor = u_useRamp > 0.5 ? texture(u_ramp, vec2(v, 0.5)) : vec4(vec3(v), 1.0);
        }`
};
