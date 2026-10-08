/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License.

   Every shader in this file is an independent implementation of a standard,
   published image-processing technique. No Materialize code remains: the two
   ported GPL-3.0 seamless passes (`seamlessMaker`, `seamlessSplat`) were removed
   on 2026-09-13 and replaced by `wrapShift`/`seamBandMask`/`bandBlend`/`bandDiff`
   (multi-band Laplacian blending) and `seamlessStamp` (variance-preserving stamp
   blending). See THIRD-PARTY-NOTICES.md and "Path to MIT.md". */
/* ============================================================
   TRLE Texture Tools — GLSL Shaders (WebGL 2.0 / GLSL ES 3.0)
   Fragment shaders for the web GPU texture pipeline.

   ⚠ BEFORE DELETING AN "UNUSED" SHADER: a grep over engine.js + atlas.js only
   is NOT enough and will lie to you. `animNoise` is used by js/animgen.js.
   Sweep every js/*.js, ten/*.js AND the HTML files.

   Genuinely unwired, each annotated at its definition with why it is still
   here: normalizeContrast, edgeEnhance, tileMaskBlur, seamProtection. See
   Roadmap.md "Phase 2". (`combineHeight` was on this list until 2026-10-01; it
   is the relief detail-band recombine now, see HEIGHT-BANDS-PLAN.md.)
   `seamlessCrop` and `mix2` are
   unwired too: their only caller was js/app.js, deleted 2026-09-13 with
   texturetool.html (the v1 copy lives in Archive/TextureTool-v1/).
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

    /* ---------- Relief detail bands (the height equaliser) ----------
       HEIGHT-BANDS-PLAN.md. Wired 2026-10-01 by `Engine.bandEqualise`, which
       generateMaps runs on the desaturated grey before it becomes the shared
       relief (normal, AO and height read it; roughness and specular do not).

       u_blur0 is the grey itself (L0); u_blur1..6 are the à trous levels L1..L6
       (`atrousBlur`, sigma 1, 2.2, 4.6, 9.2, 18.5, 37 px; RGBA16F). Band
       k = L(k) - L(k+1) is the detail between two octaves, and the output is
           L6 + sum(u_w(k) * band k),   k = 0..5
       so at every weight 1 the sum telescopes back to L0 exactly. The coarsest
       level L6 is always kept at full weight: it carries the mean, so boosting
       or cutting a band moves detail around it rather than shifting the map.

       The multi-band idea is the one Materialize uses (manual per-frequency
       weights, no auto-gain); this code is independent, written for this tool
       ("Path to MIT.md" §2). It replaced an earlier unwired combine with a DC
       step and a 0.45 gamma, which was never an identity at equal weights.
       ---------------------------------------------------------- */
    /* ---------- À trous blur (one axis, one level) ----------
       The B3-spline kernel [1 4 6 4 1] / 16 with holes: taps u_step apart, where
       u_step = texel * 2^(level-1) along one axis. Run H then V per level, each
       level from the previous one, and the levels are the classic "à trous"
       (starlet) pyramid at full resolution: cumulative sigma sqrt((4^k - 1) / 3),
       i.e. 1, 2.2, 4.6, 9.2, 18.5, 37 px for six levels, at 5 taps a pass instead
       of a 129-tap loop per pass.
       No downsampling, so nothing to upsample (no bilinear facets in a normal map)
       and it stays exactly translation-equivariant under REPEAT. Textbook
       technique (Holschneider et al. 1989; Starck & Murtagh); written for this
       tool. Used by Engine.bandEqualise. */
    atrousBlur: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec2 u_step;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            fragColor = (texture(u_texture, v_uv - 2.0 * u_step)
                       + 4.0 * texture(u_texture, v_uv - u_step)
                       + 6.0 * texture(u_texture, v_uv)
                       + 4.0 * texture(u_texture, v_uv + u_step)
                       + texture(u_texture, v_uv + 2.0 * u_step)) / 16.0;
        }`,

    /* ---------- Cavity and edges (CAVITY-PLAN.md) ----------
       Curvature from the relief: d = blur(relief) - relief. Positive d is a
       crevice (lower than its surroundings), negative an edge. Scaled by u_scale
       and clamped, then folded into one map:
         u_mode 0  AO:        v *= 1 - amount * crevice      (Crevice Shadow)
         u_mode 1  roughness: v += amount * crevice * (1-v)  (Crevice Roughness)
         u_mode 2  specular:  v += amount * edge * (1-v)     (Edge Shine)
       Pass EVERY uniform at every call: blit() leaves them set on the program.
       Standard difference-of-blurs curvature; written for this tool. */
    curvatureApply: `#version 300 es
        precision highp float;
        uniform sampler2D u_map;
        uniform sampler2D u_relief;
        uniform sampler2D u_reliefBlur;
        uniform float u_amount;
        uniform float u_mode;
        uniform float u_scale;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float v = texture(u_map, v_uv).r;
            float d = texture(u_reliefBlur, v_uv).r - texture(u_relief, v_uv).r;
            float crevice = clamp(d * u_scale, 0.0, 1.0);
            float edge = clamp(-d * u_scale, 0.0, 1.0);
            if (u_mode < 0.5)      v *= 1.0 - u_amount * crevice;
            else if (u_mode < 1.5) v += u_amount * crevice * (1.0 - v);
            else                   v += u_amount * edge * (1.0 - v);
            fragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
        }`,

    combineHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_blur0, u_blur1, u_blur2, u_blur3, u_blur4, u_blur5, u_blur6;
        uniform float u_w0, u_w1, u_w2, u_w3, u_w4, u_w5;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float l0 = texture(u_blur0, v_uv).r;
            float l1 = texture(u_blur1, v_uv).r;
            float l2 = texture(u_blur2, v_uv).r;
            float l3 = texture(u_blur3, v_uv).r;
            float l4 = texture(u_blur4, v_uv).r;
            float l5 = texture(u_blur5, v_uv).r;
            float l6 = texture(u_blur6, v_uv).r;
            float h = l6
                    + u_w0 * (l0 - l1) + u_w1 * (l1 - l2) + u_w2 * (l2 - l3)
                    + u_w3 * (l3 - l4) + u_w4 * (l4 - l5) + u_w5 * (l5 - l6);
            fragColor = vec4(vec3(clamp(h, 0.0, 1.0)), 1.0);
        }`,

    /* ---------- Simple Height (for preset-based generation) ----------
       Desaturate + contrast + bias — simpler than multi-frequency.
       ---------------------------------------------------------------- */
    /* ---------- Height (parallax) ----------
       TombEngine reads this as `depth = 1.0 - ORSH.w` (Materials.hlsli:159): WHITE
       is the polygon plane and everything darker is carved BELOW it. POM never pops
       a texel out in front of the surface.

       This used to be `h = (h - 0.5) * strength + 0.5` -- centred on mid-gray, which
       put the whole tile half a depth-range under the plane whatever the slider said.
       Measured consequence: at Height Strength 1, on an almost-flat map, TEN still
       marched the UV ~12.5px with no relief to show for it, and dragged every border
       that far into the neighbouring atlas texture. See HEIGHT-MAP-AUDIT.md.

       So the contrast scale stays, and then the whole map slides so its u_ref
       (the 98th percentile, measured on the CPU -- not the MAX, or one white speck
       would flatten the tile) lands on u_top. The relief is unchanged to three
       decimal places; the wasted constant offset drops ~7.8x.
       -------------------------------------------------------------------------- */
    simpleHeight: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;  // blurred grayscale
        uniform float u_strength;     // contrast about mid-gray
        uniform float u_ref;          // the contrast-scaled map's 98th percentile
        uniform float u_top;          // where that percentile should land (1.0 = TEN's plane)
        uniform float u_invert;       // 0 or 1
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h = texture(u_texture, v_uv).r;
            h = (h - 0.5) * u_strength + 0.5;
            if (u_invert > 0.5) h = 1.0 - h;
            h += u_top - u_ref;
            h = clamp(h, 0.0, 1.0);
            fragColor = vec4(vec3(h), 1.0);
        }`,

    /* ---------- Height: fade the border to white ----------
       The TEN devs' rule: "Parallax textures cannot be seamlessly tiled, so to avoid
       artifacts on edges, you must make sure that the height map fades to white on
       texture edges." White is depth 0, so the POM march terminates immediately
       there and cannot carry the UV out of the texture's own box.

       It has to, because the march is long. POM_HEIGHT_SCALE 0.0035 over a 4096 page
       is 14.3px at a 45 degree view and 35.8px at the grazing limit, against Tomb
       Editor's 8px of edge bleed -- so past the padding it samples an unrelated
       texture, or black. That is the reported "black bars at the edges", measured at
       6.45% of the tile before this and 0% after.

       NOTE, because it contradicts the rule everywhere else in this codebase: the
       noise here is NOT periodic and must not be made so. Every other procedural
       field (makePeriodicNoise, bsetOrgFields, the Build Pattern warp) samples a
       lattice whose period divides the tile because the result has to wrap. A white
       border deliberately destroys the height map's tiling -- that is the entire
       point -- so there is nothing to preserve and a lattice would only constrain
       the shape.

       u_profile: 0 smooth (smoothstep) - what the devs' own example images show
                  1 linear            - predictable, keeps marginally more interior
                  2 tight             - narrow and steep, for large tiles
                  3 rough             - the distance field perturbed, for rubble
                  4 joint-aware       - handled on the CPU, arrives here as profile 0
       u_edges:   per-side enables, N/E/S/W packed as 1/2/4/8.
       -------------------------------------------------------------------------- */
    heightEdgeWhite: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform sampler2D u_bandMap;  // 4 rows N,E,S,W — local band width in .r, as a fraction of u_bandMax
        uniform float u_band;         // nominal border width, fraction of the tile (0..0.5)
        uniform float u_bandMax;      // what a bandMap value of 1.0 means
        uniform float u_useBandMap;   // 1 = joint-aware
        uniform float u_amount;       // 0..1, how far toward white the border goes
        uniform float u_profile;
        uniform float u_edges;        // bitmask N=1 E=2 S=4 W=8
        uniform float u_seed;
        uniform float u_texel;        // 1/size
        in vec2 v_uv;
        out vec4 fragColor;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453123);
        }
        float vnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                       mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        bool on(float bit) { return mod(floor(u_edges / bit), 2.0) >= 0.5; }

        /* Local band width for one edge. Joint-aware reads it from the lookup the
           CPU built by finding the first mortar line inward of each border position;
           everything else is the nominal band, with Rough varying it spatially.

           Rough varies the WIDTH rather than displacing the contour, so the border
           stays white by construction: d is 0 there whatever the band is, and no
           amount of noise can reopen the parallax march. */
        float bandFor(float row, float t) {
            if (u_useBandMap > 0.5)
                return max(texture(u_bandMap, vec2(t, (row + 0.5) / 4.0)).r * u_bandMax, 1e-4);
            if (u_profile > 2.5 && u_profile < 3.5)
                return max(u_band * (1.0 + 0.55 * (vnoise(v_uv * 9.0) * 2.0 - 1.0)), 1e-4);
            return max(u_band, 1e-4);
        }

        /* How white this edge wants the pixel, 1 at the border falling to 0 inside.
           The outermost texel's CENTRE sits half a texel in, so without that shift
           the linear and tight profiles stop a shade short of 255 at the border --
           and a shade short of white is still a live parallax march. */
        float edgeW(float dist, float row, float along) {
            if (dist > 0.5) return 0.0;
            float t = clamp(max(0.0, dist - 0.5 * u_texel) / bandFor(row, along), 0.0, 1.0);
            if (u_profile < 0.5)      return 1.0 - smoothstep(0.0, 1.0, t);        // smooth
            else if (u_profile < 1.5) return 1.0 - t;                              // linear
            else if (u_profile < 2.5) return 1.0 - smoothstep(0.0, 1.0, sqrt(t));  // tight
            return 1.0 - smoothstep(0.0, 1.0, t);                                  // rough, joint-aware
        }

        void main() {
            float h = texture(u_texture, v_uv).r;
            /* Per-edge, then MAX -- not a single distance-to-nearest-border. The
               joint-aware band differs per edge and per position along it, so the
               four have to be evaluated separately. A disabled edge contributes
               nothing, which is what lets a texture that only ever meets a floor on
               one side keep the detail on its other three. */
            float w = 0.0;
            if (on(1.0)) w = max(w, edgeW(v_uv.y,       0.0, v_uv.x));
            if (on(2.0)) w = max(w, edgeW(1.0 - v_uv.x, 1.0, v_uv.y));
            if (on(4.0)) w = max(w, edgeW(1.0 - v_uv.y, 2.0, v_uv.x));
            if (on(8.0)) w = max(w, edgeW(v_uv.x,       3.0, v_uv.y));

            h = mix(h, 1.0, clamp(w * u_amount, 0.0, 1.0));
            fragColor = vec4(vec3(h), 1.0);
        }`,

    /* ---------- Height: painted lift ----------
       Raise or lower a painted region of the height map. Runs BETWEEN the plane
       shift and the white border, never after: a stroke near the edge would
       otherwise punch a hole in the border and hand the parallax march its way out
       of the texture again, which is the whole thing the border exists to stop.
       -------------------------------------------------------------------------- */
    heightPaint: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform sampler2D u_mask;
        uniform float u_lift;      // -1..1
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            float h = texture(u_texture, v_uv).r;
            float m = texture(u_mask, v_uv).r;
            fragColor = vec4(vec3(clamp(h + u_lift * m, 0.0, 1.0)), 1.0);
        }`,

    /* pomPreview MOVED to AtlasTool/ten/preview-shaders.js on 2026-09-20.
       It reproduces TombEngine and is therefore NOT MIT; this file is shared
       with the export pipeline and has to stay clean. It is assigned onto
       TRLE.Shaders before the engine compiles the table, so lookups by name
       are unchanged. See ten/README.md. */

    /* pomPreview3D MOVED to AtlasTool/ten/preview-shaders.js on 2026-09-20.
       It reproduces TombEngine and is therefore NOT MIT; this file is shared
       with the export pipeline and has to stay clean. It is assigned onto
       TRLE.Shaders before the engine compiles the table, so lookups by name
       are unchanged. See ten/README.md. */

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
        uniform float u_aoDepth;        // how far AO may darken: 0 = none, 1 = down to black. Floor is 1-depth
        uniform float u_aoCurve;        // response exponent. Lower = more mid-tone shading
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
            // Gentler response than the original 0.5 curve, plus a floor, so AO can
            // shade without crushing colour to black — the old curve + no-floor made
            // AO derived from albedo "fry" dark/patterned textures.
            //
            // Both are per-preset now (u_aoCurve / u_aoDepth) rather than baked
            // constants. The engine defaults them to 0.85 / 0.5, which is exactly the
            // old hard-coded pair, so a preset that omits the keys is unchanged.
            // Depth rather than floor because it reads the way every other slider
            // does: more = more visible effect. Floor = 1 - depth.
            float occ = pow(clamp(ao * u_intensity, 0.0, 1.0), u_aoCurve);
            fragColor = vec4(vec3(1.0 - occ * u_aoDepth), 1.0);
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
       Unwired since js/app.js was deleted (2026-09-13); kept like the others
       in the header's unwired list.
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

    /* ---------- Generic two-texture mix (pre-average blend) ----------
       Unwired since js/app.js was deleted (2026-09-13); kept like the others
       in the header's unwired list. */
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

       The detail term is SIGNED and headroom-scaled — the same correction
       roughnessMap got when it abandoned height-variance (see PresetHistory.md,
       "Specular — the 'baked white' artifact, round two"). The old form was
           spec = base + smoothness * contrast
       where `smoothness` sits near 1.0 on any smooth area, so the term could
       only ever ADD. 35 of 75 presets had base + contrast > 1.0, so their maps
       clamped to a flat white sheet (metal: 64% of pixels at exactly 255) and
       Specular Contrast controlled nothing. In-engine that reads as a
       full-strength white specular over the whole surface, which greys out
       saturated diffuse colours — the "dingy pink ladder" report.
       --------------------------------------------------- */
    specularMap: `#version 300 es
        precision highp float;
        uniform sampler2D u_heightMap;   // grayscale
        uniform float u_texelSize;
        uniform float u_baseValue;       // 0-1
        uniform float u_contrast;        // 0-1
        in vec2 v_uv;
        out vec4 fragColor;

        /* How far out to look when judging "is this spot smooth or busy".
           ------------------------------------------------------------
           7x7 samples at this spacing, so the window reaches +/-3*SPACING texels.
           This was 1.5 (a +/-4.5 texel reach) and that width was visible in-engine
           on glazed mosaic: local deviation cannot tell a rough surface from a hard
           boundary between two SMOOTH surfaces, so a grout line dulled every pixel
           whose window touched it. The result was a band of grout-level specular
           bleeding ~5px onto clean glaze, traced around each tile in the shape of
           that tile — on a 32px mosaic cell it ate 38% of the face and read as a
           worn, dingy inset square.

           At 0.75 the reach is +/-2.25 texels and the band drops to 23% of the face,
           with the grout itself just as dull as before (the effect is intended; only
           its bleed onto the glaze was not). Measured cost is ~4% of specular
           variation across all 53 solids, which is the price of judging roughness
           over a smaller neighbourhood.

           An edge-aware (bilateral) version was built and measured, and rejected:
           it reached the same 77% glossy core only when combined with this same
           narrowing, cost 16% of specular variation instead of 4%, and lifted the
           grout from 128 to 153 — eroding the very glaze-vs-grout distinction it
           was meant to protect. Magnitude-based edge rejection cannot separate
           "rough" from "edge", because roughness IS large-magnitude deviation.
           A real fix would have to discriminate on spatial structure (sign changes,
           coherence) rather than magnitude. Not worth it for a 4%-cost alternative
           that lands the same geometry. */
        const float SPACING = 0.75;

        void main() {
            // Sample local smoothness (inverse of variance)
            float center = texture(u_heightMap, v_uv).r;
            float dev = 0.0;
            float count = 0.0;
            float avg = 0.0;
            for (int x = -3; x <= 3; x++) {
                for (int y = -3; y <= 3; y++) {
                    float s = texture(u_heightMap, v_uv + vec2(float(x), float(y)) * u_texelSize * SPACING).r;
                    avg += s;
                    count += 1.0;
                }
            }
            avg /= count;
            for (int x = -3; x <= 3; x++) {
                for (int y = -3; y <= 3; y++) {
                    float s = texture(u_heightMap, v_uv + vec2(float(x), float(y)) * u_texelSize * SPACING).r;
                    dev += abs(s - avg);
                }
            }
            dev /= count;

            // Signed detail: +1 = locally smooth (glossy), -1 = locally busy (dulled).
            // Luminance folded in at a low weight so brighter pixels read slightly
            // shinier, as before — but now scaled by contrast like everything else.
            float smoothness = clamp(1.0 - sqrt(dev) * 4.0, 0.0, 1.0);
            float detail = clamp((smoothness * 2.0 - 1.0) + (center - 0.5) * 0.20, -1.0, 1.0);

            // Symmetric half-range swing. This used to scale by the headroom on the
            // side we were moving toward (1-base above, base below), which stopped
            // high-base presets clipping but was asymmetric: a base far from 0.5 got
            // a ~7.5x slope kink at detail == 0, and since detail runs mostly
            // negative on any textured tile, every matte preset lived on the
            // compressed side and its map went flat (dirt: range 45 -> 8 levels).
            // The detail signal was never the problem; the multiplier destroyed it.
            //
            // Symmetric removes the kink. SWING is the floor of the old
            // min(base, 1-base) — which, at 0.5, that expression can never exceed —
            // so it reduces to a constant. u_contrast now reads as "fraction of half
            // the range the detail may use", which is what materials-guide.js has
            // always claimed it means. No built-in preset clips at its default
            // contrast; the clamp below still catches extreme hand-set values.
            const float SWING = 0.5;
            float spec = u_baseValue + detail * u_contrast * SWING;
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
       NOT WIRED UP — nothing blits this. Superseded by the mask paths in
       atlas.js. Kept only because it is a correct, self-contained primitive;
       no lesson is attached to it, so it is safe to delete.

       Blurs a mask using the 3x3 tiling trick for seamless edges.
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
       NOT WIRED UP — nothing blits this. Superseded by buildTopologyMask and
       the corner/organic mask work in atlas.js. No lesson attached; safe to
       delete.

       Creates a hard mask with inward-curving boundary.
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
       ⚠ NOT WIRED UP, AND DELIBERATELY SO. This is a corpse of a failed
       experiment, kept here as a warning rather than deleted — see
       FailedExperiment1/README.md and Roadmap.md "Phase 4".

       Remaps grayscale from [u_min, u_max] → [0, 1], the idea being that dark
       textures would then produce the same gradient magnitude as bright ones.
       It shipped once and was reverted:

         • min/max is outlier-driven. One bright specular pixel and one dark
           crevice pixel span the full range on nearly every photograph, so the
           step either no-ops or fires everywhere. Thresholds of 0.05 and 0.30
           were both wrong.
         • It rewrites the grayscale INPUT, so amplified micro-noise propagates
           into normal, AO, specular and roughness alike.
         • Combined with edgeEnhance below it formed a positive feedback loop
           on grain, and presets then got de-tuned to compensate, hiding the
           root cause.

       The underlying problem is real and measured (output normal strength
       tracks input luminance std ~1:1). The SHIPPED answer is the advisory note
       in the material modal — `matContrastAdvice` in atlas.js — which informs
       instead of auto-correcting. If you are about to re-enable this shader,
       read Roadmap.md "Phase 4" first: Materialize solves the same problem with
       manual multi-band controls (our independent `combineHeight` is above) and
       ships no auto-gain at all.
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
       ⚠ NOT WIRED UP, AND DELIBERATELY SO — the other half of the failed
       experiment above. See FailedExperiment1/README.md.

       Amplifies high-frequency detail in the normalized grayscale before
       normal/AO generation, intended for architectural presets where mortar
       and grout edges have low absolute contrast. What it actually did was
       treat every pixel-level luminance variation as a surface edge, giving
       every material a "pumice stone" embossed look — worst on exactly the
       brick/tile presets it was meant to help, because their diffuse is a
       photographic scan full of natural variation.

       No preset declares `edgeEnhance` any more; nothing reads it.
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

    /* materialPreview MOVED to AtlasTool/ten/preview-shaders.js on 2026-09-20.
       It reproduces TombEngine and is therefore NOT MIT; this file is shared
       with the export pipeline and has to stay clean. It is assigned onto
       TRLE.Shaders before the engine compiles the table, so lookups by name
       are unchanged. See ten/README.md. */

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

       Alpha is PASSED THROUGH, as in colorAdjust and colorTransfer. It used to be
       written as a hard 1.0, which quietly turned every cutout opaque: the RGB
       under alpha 0 is 0 in a canvas, so a fence's holes came back as solid black
       bars. Measured on a half-transparent tile, mean alpha 191.5 -> 255.
       --------------------------------------------------------------- */
    delight: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;   // diffuse
        uniform sampler2D u_blurred;   // heavily blurred diffuse
        uniform float u_strength;      // 0..1
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 src = texture(u_texture, v_uv);
            vec3 d = src.rgb;
            vec3 b = texture(u_blurred, v_uv).rgb;
            float bl = dot(b, vec3(0.299, 0.587, 0.114));
            vec3 evened = d / max(bl, 0.04) * 0.5;        // normalise by local luminance
            fragColor = vec4(clamp(mix(d, evened, u_strength), 0.0, 1.0), src.a);
        }`,

    /* ---------- Colour Adjust (HSL / contrast / gamma / temp) ----------
       A non-destructive colour grade applied to a whole tile. Order: white
       balance → gamma → brightness/contrast → hue/saturation → vibrance →
       invert. Alpha is preserved.

       THE TWO INTERMEDIATE CLAMPS ARE GONE (2026-09-22). There used to be a hard
       clamp(c, 0, 1) after white balance and another after contrast. They destroyed
       information a LATER stage could have used: with Temperature -60 the red
       channel goes below zero and is pinned at 0, then Brightness +40 lifts a
       channel that no longer has anywhere to come back from. The pipeline now runs
       unbounded and rounds once, at the end.

       Measured scope, so nobody oversells this: across nine realistic slider
       settings on seven textures, EIGHT are byte-identical with and without those
       clamps. Only opposing-direction combinations differ (temp -60 + bright +40:
       19.4% of pixels, mean delta 1.165/255, max 22.9, hue error 24.4 deg). Worth
       fixing because it is free and strictly correct, but Adjust Colours was not
       broken — the beta report's "chromatic aberrations" came from colorTransfer.

       THE FINAL CLAMP STAYS HARD, and must. Do not reach for colorTransfer's
       gamutLift here: out-of-range is usually the USER'S INTENT in this shader (at
       Brightness -50, 89.9% of pixels legitimately fall below zero) and lifting them
       back would neutralise the slider. See COLOUR-TOOLS-PLAN.md §4 Decision 3.
       ------------------------------------------------------------------------ */
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
        uniform vec3  u_levBlack;   // per-channel black point, 0..1  (UI: "Dark cutoff")
        uniform vec3  u_levWhite;   // per-channel white point, 0..1  (UI: "Bright cutoff")
        uniform vec3  u_levGamma;   // per-channel gamma, 0.2..3
        uniform float u_levOn;      // 0 = skip the levels stage entirely
        uniform sampler2D u_curveTex; // 256x1 LUT, R/G/B = that channel's curve with the RGB curve on top.
                                      // EVERY caller must bind it (to the input when unused): see caBlit.
        uniform float u_curveOn;    // 0 = skip the curves stage entirely
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
            /* Per-channel LEVELS, first, because it is an input transform: it decides
               what counts as black and white before anything else reads the pixel.

               This stage DOES clamp, and that is not the clipping the rest of this
               shader was fixed for. A black point is a clip the USER asked for -- drag
               it to 40 and everything below 40 is meant to go to black. Soft-clipping
               it, or routing it through colorTransfer's gamutLift, would make the
               control feel broken. The clamps that were removed were INCIDENTAL ones
               mid-pipeline. Keep the two ideas apart. */
            if (u_levOn > 0.5) {
                vec3 span = max(u_levWhite - u_levBlack, vec3(1e-4));
                c = pow(clamp((c - u_levBlack) / span, 0.0, 1.0), 1.0 / max(u_levGamma, vec3(0.01)));
            }
            /* CURVES, also an input transform. Looked up NEAREST at texel centres, so
               an 8-bit input lands exactly on its own table entry: the curve is exact,
               not interpolated. Skipped outright unless a curve is actually bent, which
               is what keeps every other mode, and an untouched Curves mode, byte for
               byte what it was. */
            if (u_curveOn > 0.5) {
                vec3 k = floor(clamp(c, 0.0, 1.0) * 255.0 + 0.5);
                c = vec3(texture(u_curveTex, vec2((k.r + 0.5) / 256.0, 0.5)).r,
                         texture(u_curveTex, vec2((k.g + 0.5) / 256.0, 0.5)).g,
                         texture(u_curveTex, vec2((k.b + 0.5) / 256.0, 0.5)).b);
            }
            c.r += u_temp * 0.15; c.b -= u_temp * 0.15; c.g += u_tint * 0.15;   // white balance
            // gamma on a signed value: keep the sign so a channel driven negative by
            // white balance can still be recovered by a later brightness lift.
            c = sign(c) * pow(abs(c), vec3(1.0 / max(u_gamma, 0.01)));            // gamma
            c += u_bright;                                                        // brightness
            c = (c - 0.5) * u_contrast + 0.5;                                     // contrast
            // rgb2hsv needs a real colour, so the clamp happens HERE and not before:
            // every stage above ran unbounded, and nothing downstream can recover.
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
       Reinhard mean/std transfer, done in CIELAB. Shifts a tile's colour
       distribution toward a reference's: meanA/scale come from the source,
       meanB from the reference, u_strength blends back to the original.

       WHY LAB AND NOT RGB (measured 2026-09-22, see COLOUR-TOOLS-PLAN.md §1/§4).
       This used to run three independent gains on gamma-encoded R, G and B. The
       channels are correlated, so per-channel std matching does NOT land the
       aggregate statistics on the reference, and the residue turns distance from
       mean BRIGHTNESS into COLOUR: a pixel 30 units above the mean in all three
       channels is still grey, but with gains of 2.17/1.73/0.97 it comes out
       +65/+52/+29, which is orange. Highlights drift one way, shadows the other.
       That is what a beta report saw as "chromatic aberrations".

       A mean/std transfer promises to land the source's spread on the reference's,
       so the honest error is |log2(out_spread / ref_spread)| over a 5-source x
       11-reference sweep. Chroma: RGB 0.534, YCbCr 0.148, Lab 0.070. Luma: 0.281 /
       0.034 / 0.027. YCbCr was a real candidate (linear matrix, no transcendentals)
       and still beats RGB by 3.6x, but this is a one-off blit rather than a
       per-frame path, so Lab's pow/cbrt cost nothing worth having.

       Lab round-trips EXACTLY at scale 1 with equal means (max delta 0.000/255
       measured), which is what makes the identity assertion in
       validate-colour-maths.mjs possible. Keep it that way.

       GAMUT: gamutLift, NOT a clamp, and NOT a desaturate-toward-luminance.
       See the note on gamutLift below. ------------------------------------- */
    colorTransfer: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec3  u_meanA;   // source mean,      Lab
        uniform vec3  u_meanB;   // reference mean,   Lab
        uniform vec3  u_scale;   // stdB / stdA per Lab axis, clamped 0.2..3
        uniform float u_strength;
        in vec2 v_uv;
        out vec4 fragColor;

        const mat3 RGB2XYZ = mat3(
                   0.4124564,  0.2126729,  0.0193339,
                   0.3575761,  0.7151522,  0.1191920,
                   0.1804375,  0.0721750,  0.9503041);
        const mat3 XYZ2RGB = mat3(
                   3.2404548, -0.9692664,  0.0556434,
                  -1.5371389,  1.8760109, -0.2040259,
                  -0.4985315,  0.0415561,  1.0572252);
        const vec3 D65 = vec3(0.95047, 1.0, 1.08883);

        vec3 srgb2lin(vec3 c){
            return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
        }
        /* Sign-preserving, and deliberately NOT clamped: the transfer can land a
           pixel outside the cube and gamutLift needs to see how far out it is. A
           clamp here would silently become the hard-clamp behaviour we are removing. */
        vec3 lin2srgb(vec3 c){
            vec3 a = abs(c);
            vec3 r = mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), a));
            return sign(c) * r;
        }
        float labf(float t)  { return t > 0.008856 ? pow(t, 1.0 / 3.0) : t / 0.128418 + 0.137931; }
        float labfi(float t) { return t > 0.206897 ? t * t * t : 0.128418 * (t - 0.137931); }

        vec3 rgb2lab(vec3 c){
            vec3 xyz = (RGB2XYZ * srgb2lin(c)) / D65;
            float fx = labf(xyz.x), fy = labf(xyz.y), fz = labf(xyz.z);
            return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
        }
        vec3 lab2rgb(vec3 l){
            float fy = (l.x + 16.0) / 116.0;
            float fx = fy + l.y / 500.0;
            float fz = fy - l.z / 200.0;
            vec3 xyz = vec3(labfi(fx), labfi(fy), labfi(fz)) * D65;
            return lin2srgb(XYZ2RGB * xyz);
        }

        /* Bring an out-of-gamut colour back by moving ALL THREE channels together,
           which preserves their ratios and therefore the hue. Clamping each channel
           independently does not: 100% of the clipping here is on the dark side, so
           a pixel at (-20, 8, 15) loses its red entirely and arrives cyan, while its
           neighbour one shade lighter does not clip at all. Measured on out-of-gamut
           pixels, hue angle error: hard clamp 24.4 deg (p99 178.4, i.e. the opposite
           hue), full lift 4.8 deg (p99 35.3).

           TWO THINGS NOT TO RE-PROPOSE, both measured and both counter-intuitive:
           - Desaturating toward the pixel's own luminance is WORSE than clamping
             (38.0 deg vs 28.2 under the old RGB transfer). All the clipping is on the
             dark side where the target luminance is itself out of range, so pulling
             toward it does not bring the pixel back and it still needs a clamp.
           - A PARTIAL lift is useless. Sweeping the strength 0..1, p99 hue error sits
             at ~177 deg until it reaches exactly 1.0, then collapses to 35.3 - because
             anything less is still clamped afterwards. It is a cliff, not a dial.

           Cost is a slight shadow lift (1st-percentile luminance moves 0.6 to 2.9 of
           255 on four of five references; the minimum stays at ~0). It does not wash
           the blacks out.

           This belongs to colorTransfer ONLY. colorAdjust must NOT use it: there,
           going out of range is usually the user's intent (at Brightness -50, 89.9%
           of pixels legitimately fall below zero) and lifting would neutralise the
           slider. */
        vec3 gamutLift(vec3 c){
            c -= min(min(c.r, min(c.g, c.b)), 0.0);
            c -= max(max(c.r, max(c.g, c.b)) - 1.0, 0.0);
            return clamp(c, 0.0, 1.0);
        }

        void main(){
            vec4 src = texture(u_texture, v_uv);
            vec3 lab = rgb2lab(src.rgb);
            vec3 mapped = (lab - u_meanA) * u_scale + u_meanB;
            fragColor = vec4(gamutLift(lab2rgb(mix(lab, mapped, u_strength))), src.a);
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
        }`,

    /* ---------- Animated CAUSTICS (WATER-CAUSTICS-PLAN) ----------
       The third animated-texture generator (js/animcaustics.js). Light focused
       by a water surface draws a network of closed cells whose bright edges meet
       at junctions; this is that network as a Worley F2 - F1 field on a
       toroidal lattice, on black, so under Additive blending only the lines add.

       Guarantees, all by construction:
         TILES   the lattice is u_cells per axis (integers) and every cell index
                 is wrapped, so the field is periodic over the tile.
         LOOPS   each site orbits its cell a whole number of times per loop, and
                 every time product is fract()ed BEFORE it meets the phase, so
                 t = 1 gives frame 0's angles bit for bit (also the drift).
         EXACT   a site sits at most jitter 0.30 + wobble 0.45 = 0.75 cell from
                 its cell centre, so the 5x5 search sees every site that can be
                 F1..F3. A 3x3 search is wrong once sites move (worleyField's
                 trap, WATER-CAUSTICS-PLAN 3.7).
         SEEDS   site randomness comes from an integer hash (pcg3d), so a seed
                 means the same pixels on every GPU.

       Crisp is IN the shader (u_ss x u_ss taps, the field averaged before the
       ramp), never render-large-then-box-down: a box-down averages a canvas,
       and once the background can be transparent that is straight alpha.

       Every count is a FLOAT uniform because blit() only sets floats.

       Uniforms:
         u_time       loop phase in [0, 1)
         u_seed       pattern seed (its integer part)
         u_cells      cells per axis (integers)
         u_speed      most orbit cycles per loop for any site (integer >= 1)
         u_flow       drift in whole tiles per loop (integers)
         u_exposure   overall brightness
         u_width      line width, fraction of a cell
         u_lineVary   0..1 width varies along the lines
         u_junctions  0..1 extra light where three cells meet
         u_wobble     orbit radius, cells (<= 0.45)
         u_jitter     static irregularity, cells (<= 0.30)
         u_lineBright 0..1 the network's weight
         UNDERGLOW (off at u_glow 0, then not computed)
         u_glow       0..1 strength of a soft second network beneath
         u_glowCells  its lattice (integers), u_glowSoft 0..1 its line width,
         u_glowSpeed  its orbit cycles, u_glowOffset its shift in its own cells
         RIPPLE (each off at 0, then not computed)
         u_warp       0..1 periodic domain warp of both networks
         u_warpScale  its spatial period (integer); u_warpSpeed its cycles/loop
         u_surface    0..1 fBm added to the value (choppy water); uses the
                      warp's scale x2 and speed
         u_shimmer    0..1 brightness flicker; u_shimmerSpeed its cycles/loop
         u_fringe     0..1 colour fringe: R and B read the field either side of G
         u_transparent 1 = transparent background (light carried as alpha)
         u_ss         supersample taps per axis (1..4)
         u_size       output size in px (tap spacing)
         u_shift      TEST ONLY: a domain shift in tiles; 0 in use
         u_useRamp / u_ramp   as animNoise
       Output: RGBA, grayscale or the ramp colour. */
    animCaustics: `#version 300 es
        precision highp float;
        precision highp int;
        uniform float u_time;
        uniform float u_seed;
        uniform vec2  u_cells;
        uniform float u_speed;
        uniform vec2  u_flow;
        uniform float u_exposure;
        uniform float u_width;
        uniform float u_lineVary;
        uniform float u_junctions;
        uniform float u_wobble;
        uniform float u_jitter;
        uniform float u_lineBright;
        uniform float u_glow;
        uniform vec2  u_glowCells;
        uniform float u_glowSoft;
        uniform float u_glowSpeed;
        uniform float u_glowOffset;
        uniform float u_warp;
        uniform float u_warpScale;
        uniform float u_warpSpeed;
        uniform float u_surface;
        uniform float u_shimmer;
        uniform float u_shimmerSpeed;
        uniform float u_fringe;
        uniform float u_transparent;
        uniform float u_ss;
        uniform float u_size;
        uniform vec2  u_shift;
        uniform float u_useRamp;
        uniform sampler2D u_ramp;
        in vec2 v_uv;
        out vec4 fragColor;

        // Classic periodic Perlin, the same as animNoise's (copied, so that
        // shader's source is untouched).
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

        // pcg3d (Jarzynski & Olano 2020). Integer maths, the same on every GPU.
        uvec3 pcg3d(uvec3 v) {
            v = v * 1664525u + 1013904223u;
            v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
            v ^= v >> 16u;
            v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
            return v;
        }
        // The top 24 bits as [0, 1): exact in a float, so the JS mirror in
        // validate-animcaustics can reproduce it.
        vec3 u01(uvec3 h) { return vec3(h >> 8u) * (1.0 / 16777216.0); }

        // A site's position in cell units, relative to its cell's corner.
        vec2 site(uvec2 cell, uint salt, float t, float speed) {
            vec3 a = u01(pcg3d(uvec3(cell, salt)));
            vec3 b = u01(pcg3d(uvec3(cell, salt ^ 0x9E3779B9u)));
            float cyc = min(floor(b.x * speed) + 1.0, speed);
            float dir = b.y < 0.5 ? -1.0 : 1.0;
            float ang = 6.28318530718 * fract(a.z + fract(dir * cyc * t));
            return vec2(0.5) + u_jitter * (2.0 * a.xy - 1.0) + u_wobble * vec2(cos(ang), sin(ang));
        }

        // Distances to the nearest three sites, F1 <= F2 <= F3, in cell units.
        vec3 worley(vec2 p, vec2 cells, uint salt, float t, float speed) {
            vec2 c = floor(p), f = p - c;
            vec3 F = vec3(1e9);
            for (int j = -2; j <= 2; j++) {
                for (int i = -2; i <= 2; i++) {
                    vec2 o = vec2(float(i), float(j));
                    vec2 w = mod(c + o, cells);
                    vec2 d = o + site(uvec2(w + 0.5), salt, t, speed) - f;
                    float dd = dot(d, d);
                    if (dd < F.x)      F = vec3(dd, F.x, F.y);
                    else if (dd < F.y) F = vec3(F.x, dd, F.y);
                    else if (dd < F.z) F.z = dd;
                }
            }
            return sqrt(F);
        }

        // Periodic noise in [0, 1] that loops: spatial period per (integers)
        // and cyc whole cycles per loop in time. At t = 1, z = cyc lands on
        // the lattice exactly as z = 0 does. An integer offset keeps the period.
        float loopNoise(vec2 uv, float t, vec2 per, float cyc, vec3 off) {
            return clamp(pnoise(vec3(uv * per, t * cyc) + off, vec3(per, cyc)) * 0.5 + 0.5, 0.0, 1.0);
        }

        // Ripple: a two-octave periodic warp, in uv, up to about a Lines cell.
        // ONE loopNoise call site in a loop rather than four inline calls: the
        // software renderer (SwiftShader, which headless Chrome and some users
        // run) pays for inlined code even while u_warp is 0. Measured 2026-10-03.
        vec2 rippleWarp(vec2 uv, float t, uint salt) {
            vec3 o1 = vec3(float(salt % 61u), float(salt % 53u), 0.0);
            vec3 o2 = vec3(float(salt % 47u), float(salt % 43u), 0.0);
            vec2 n = vec2(0.0);
            for (int k = 0; k < 4; k++) {
                float oct = float(k / 2);                       // 0, 0, 1, 1
                bool second = (k % 2) == 1;                     // x or y
                vec3 o = (second == (oct > 0.5)) ? o1 : o2;     // x: o1 then o2, y: o2 then o1
                float v = (loopNoise(uv, t, vec2(u_warpScale) * (1.0 + oct), u_warpSpeed, o) - 0.5) * (1.0 - 0.5 * oct);
                if (second) n.y += v; else n.x += v;
            }
            return uv + 2.0 * u_warp * n / u_cells;
        }

        float linesField(vec2 uv, float t, uint seed) {
            uint salt = seed * 8u + 1u;
            vec3 F = worley(uv * u_cells, u_cells, salt, t, u_speed);
            float w = u_width;
            if (u_lineVary > 0.0) {
                vec2 per = max(vec2(1.0), floor(u_cells * 0.5 + 0.5));
                vec3 off = vec3(float(salt % 97u), float(salt % 89u), 0.0);
                float n = clamp(pnoise(vec3(uv * per, t) + off, vec3(per, 1.0)) * 0.5 + 0.5, 0.0, 1.0);
                w *= mix(1.0, 0.25 + 1.5 * n, u_lineVary);
            }
            w = max(w, 1e-4);
            float v = exp(-(F.y - F.x) / w);
            if (u_junctions > 0.0) v *= 1.0 + 2.0 * u_junctions * exp(-(F.z - F.x) / (2.5 * w));
            return u_lineBright * v;
        }

        // Underglow: a second, softer network beneath, its own seed, lattice and
        // speed, shifted by a constant (a constant shift keeps the torus).
        float glowField(vec2 uv, float t, uint seed) {
            uint salt = seed * 8u + 2u;
            vec2 q = uv + u_glowOffset * vec2(1.0, 0.6) / u_glowCells;
            vec3 F = worley(q * u_glowCells, u_glowCells, salt, t, u_glowSpeed);
            float w = mix(0.10, 0.60, u_glowSoft);
            return 0.5 * u_glow * exp(-(F.y - F.x) / w);
        }

        // Everything at one point, before exposure. Each optional term is
        // skipped at 0, so a recipe without it renders exactly as before.
        float fieldAt(vec2 uv, float t, uint seed) {
            if (u_warp > 0.0) uv = rippleWarp(uv, t, seed * 8u + 3u);
            float v = linesField(uv, t, seed);
            if (u_glow > 0.0) v += glowField(uv, t, seed);
            if (u_shimmer > 0.0) {
                uint salt = seed * 8u + 4u;
                vec2 per = max(vec2(1.0), floor(u_cells / 3.0 + 0.5));
                float s = loopNoise(uv, t, per, u_shimmerSpeed, vec3(float(salt % 71u), float(salt % 67u), 0.0));
                v *= 1.0 - u_shimmer * 0.85 * (1.0 - smoothstep(0.25, 0.75, s));
            }
            if (u_surface > 0.0) {
                uint salt = seed * 8u + 5u;
                vec3 o = vec3(float(salt % 59u), float(salt % 41u), 0.0);
                vec2 per = vec2(u_warpScale * 2.0);
                float n = 0.6 * loopNoise(uv, t, per, u_warpSpeed, o) + 0.4 * loopNoise(uv, t, per * 2.0, u_warpSpeed, o.yxz);
                v += u_surface * 0.9 * n * n;
            }
            return v;
        }

        void main() {
            float t = u_time;
            uint seed = uint(floor(abs(u_seed)));
            float ss = clamp(floor(u_ss + 0.5), 1.0, 4.0);
            vec2 base = v_uv + u_shift + fract(u_flow * t);
            // Colour fringe: R and B read the field a little either side of G,
            // along a fixed diagonal (a constant offset, so it still tiles).
            // One fieldAt call site, looped over the channels it needs: three
            // inline calls cost the software renderer 2.3x with fringe OFF.
            vec2 fr = u_fringe * 0.12 * vec2(0.8, 0.6) / u_cells;
            int c0 = u_fringe > 0.0 ? 0 : 1, c1 = u_fringe > 0.0 ? 2 : 1;
            vec3 acc = vec3(0.0);
            for (int b = 0; b < 4; b++) {
                if (float(b) >= ss) break;
                for (int a = 0; a < 4; a++) {
                    if (float(a) >= ss) break;
                    vec2 off = (vec2(float(a), float(b)) + 0.5) / ss - 0.5;
                    vec2 uv = base + off / u_size;
                    vec3 px = vec3(0.0);
                    for (int ch = c0; ch <= c1; ch++) {
                        float v = clamp(u_exposure * fieldAt(uv + float(ch - 1) * fr, t, seed), 0.0, 1.0);
                        if (ch == 0) px.r = v; else if (ch == 1) px.g = v; else px.b = v;
                    }
                    acc += u_fringe > 0.0 ? px : vec3(px.g);
                }
            }
            vec3 v = acc / (ss * ss);
            vec4 col;
            if (u_fringe > 0.0) {
                vec4 cg = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.g, 0.5)) : vec4(vec3(v.g), 1.0);
                float r = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.r, 0.5)).r : v.r;
                float bl = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.b, 0.5)).b : v.b;
                col = vec4(r, cg.g, bl, cg.a);
            } else {
                col = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.g, 0.5)) : vec4(vec3(v.g), 1.0);
            }
            // Transparent background: the colour is LIGHT, so carry it as straight
            // alpha. a = the brightest channel and rgb / a, so source-over gives
            // light + base * (1 - a), and over black exactly the black-background
            // frame. After the tap average, so Crisp never averages straight alpha.
            if (u_transparent > 0.5) {
                float l = max(col.r, max(col.g, col.b));
                col = vec4(l > 0.0 ? col.rgb / l : vec3(0.0), l * col.a);
            }
            fragColor = col;
        }`,

    /* ---------- Caustics, REFRACTION model (WATER-CAUSTICS-PLAN phase 5a) ----------
       Physically based caustics by photon splatting: a fine grid of light
       packets on the water surface is refracted by the slope of a periodic wave
       height field and lands on the floor; where the surface focuses light,
       packets pile up. Three passes, driven by js/animcaustics.js:
         causticSplat  (points, additive into RGBA16F) -> counts per pixel
         causticBlur   (twice, separable, wrapping)   -> a soft halo
         causticFinish (fullscreen)                   -> tone, ramp, background
       Guarantees, by construction:
         TILES  every wave vector is an INTEGER pair and a landing point is
                fract()ed, so light leaving one edge enters the other.
         LOOPS  each wave moves a whole number of cycles per loop, and the time
                product is fract()ed before it meets the phase (as animCaustics).
         LIGHT  each packet adds exactly 1.0; counts are integers, exact in half
                float up to 2048 per pixel, so the total is (S*sub)^2. */
    causticSplat: {
        vert: `#version 300 es
        precision highp float;
        precision highp int;
        uniform float u_grid;      // packets per axis (S * sub)
        uniform float u_time;      // loop phase
        uniform float u_depth;     // RMS landing offset, in tiles
        uniform float u_nWaves;
        uniform vec4  u_wA[64];    // kx, ky (integers), slope amplitude, phase
        uniform vec4  u_wB[64];    // whole cycles per loop, -, -, -
        uniform vec2  u_shift;     // TEST ONLY: a domain shift in tiles
        uniform float u_out;       // target size in px
        uniform vec2  u_flow;      // drift, whole tiles per loop (as animCaustics)
        void main() {
            int g = int(u_grid + 0.5);
            int i = gl_VertexID % g, j = gl_VertexID / g;
            vec2 p = (vec2(float(i), float(j)) + 0.5) / u_grid;
            // u_shift moves the WAVE FIELD, not the packets: shifting a whole grid
            // of packets by half a tile is the same grid, so the image would not
            // move at all. Shifting the field rolls the image the other way.
            vec2 f = p + u_shift + fract(u_flow * u_time);
            vec2 grad = vec2(0.0);
            for (int k = 0; k < 64; k++) {
                if (float(k) >= u_nWaves) break;
                vec4 a = u_wA[k];
                float ph = fract(fract(dot(a.xy, f)) + a.w + fract(-u_wB[k].x * u_time));
                grad += a.z * a.xy * cos(6.28318530718 * ph);
            }
            vec2 q = fract(p + u_depth * grad);
            // Bin EXPLICITLY: put the point at the centre of the pixel it falls
            // in. Left to the rasteriser, a point snapped onto a pixel corner
            // lit none of the four (measured: 251 of 1,048,576 packets lost at
            // 256 px, none at depth 0), which breaks light conservation.
            q = (min(floor(q * u_out), u_out - 1.0) + 0.5) / u_out;
            gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
            gl_PointSize = 1.0;
        }`,
        frag: `#version 300 es
        precision highp float;
        uniform vec4 u_mask;       // which channels this splat feeds (colour fringe)
        out vec4 fragColor;
        void main() { fragColor = u_mask; }`
    },

    /* One separable pass of a wrapping Gaussian over a float target; sigma in
       px, at most 32 px of reach. */
    causticBlur: `#version 300 es
        precision highp float;
        precision highp int;
        uniform sampler2D u_accum;
        uniform vec2  u_dir;       // (1,0) or (0,1)
        uniform float u_sigma;
        uniform float u_size;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            int S = int(u_size + 0.5);
            ivec2 c = ivec2(gl_FragCoord.xy);
            int R = min(32, int(ceil(3.0 * u_sigma)));
            vec4 acc = vec4(0.0); float ws = 0.0;
            for (int k = -32; k <= 32; k++) {
                if (k < -R || k > R) continue;
                float w = exp(-float(k * k) / (2.0 * u_sigma * u_sigma));
                ivec2 q = c + ivec2(u_dir) * k;
                q = ((q % S) + S) % S;
                acc += w * texelFetch(u_accum, q, 0);
                ws += w;
            }
            fragColor = acc / ws;
        }`,

    /* Counts -> colour. u_perPx is the count of uniform light, so I = 1.0 is
       "no focusing"; light below u_black adds nothing (the floor stays), and
       the rest saturates towards white. Background as animCaustics. */
    causticFinish: `#version 300 es
        precision highp float;
        precision highp int;
        uniform sampler2D u_accum;
        uniform float u_perPx;
        uniform float u_black;
        uniform float u_gain;
        uniform float u_exposure;
        uniform float u_fringe;
        uniform float u_transparent;
        uniform float u_useRamp;
        uniform sampler2D u_ramp;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 I = texelFetch(u_accum, ivec2(gl_FragCoord.xy), 0) / u_perPx;
            vec3 L = u_fringe > 0.0 ? I.rgb : vec3(I.r);
            vec3 v = clamp(u_exposure * (1.0 - exp(-u_gain * max(L - u_black, 0.0))), 0.0, 1.0);
            vec4 col;
            if (u_fringe > 0.0) {
                vec4 cg = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.g, 0.5)) : vec4(vec3(v.g), 1.0);
                float r = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.r, 0.5)).r : v.r;
                float bl = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.b, 0.5)).b : v.b;
                col = vec4(r, cg.g, bl, cg.a);
            } else {
                col = u_useRamp > 0.5 ? texture(u_ramp, vec2(v.g, 0.5)) : vec4(vec3(v.g), 1.0);
            }
            if (u_transparent > 0.5) {
                float l = max(col.r, max(col.g, col.b));
                col = vec4(l > 0.0 ? col.rgb / l : vec3(0.0), l * col.a);
            }
            fragColor = col;
        }`,

    /* ================================================================
       MIT SEAMLESS PATH — clean-room replacements for the two GPL-3.0
       Materialize ports (`seamlessMaker`, `seamlessSplat`).

       These implement published, independent techniques and share no code or
       algorithm with Materialize:
         • wrapShift + seamBandMask + bandBlend   → multi-band (Laplacian
           pyramid) blending, Burt & Adelson 1983; the GPU/mipmap formulation
           is JCGT 14(1) 2025 "GPU-Friendly Laplacian Texture Blending".
         • seamlessStamp → variance-preserving ("histogram-preserving")
           blending of randomly rotated stamps, Heitz & Neyret, HPG 2018.
       Both are MIT, like the rest of this file's own shaders.
       ================================================================ */

    /* Toroidal shift: sample the source at uv + offset, wrapped. Used to bring
       the opposite edge of the texture into register with this one. */
    wrapShift: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform vec2 u_offset;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() { fragColor = texture(u_texture, fract(v_uv + u_offset)); }`,

    /* Blend weight for the seam band.
       1 = take the shifted copy, 0 = keep the original.

       WHY THE WEIGHT MUST REACH EXACTLY 1 AT THE BORDER — this is the whole
       tiling guarantee, and getting it wrong makes the pass a decorative no-op:
       the output is O(x) = mix(A(x), B(x), w(x)) where B(x) = A(fract(x + s)).
       B is periodic by construction — B(0) = A(s) = B(1) — for ANY shift s. So
       if w = 1 at both borders, O(0) = B(0) = B(1) = O(1) and the tile wraps no
       matter what A looked like. Cap w below 1 (an earlier version halved it)
       and the output inherits A's own discontinuity at the seam. */
    seamBandMask: `#version 300 es
        precision highp float;
        uniform float u_bandX;   // half-width of the blend band, in uv
        uniform float u_bandY;
        in vec2 v_uv;
        out vec4 fragColor;
        float edgeW(float t, float band) {
            // distance to the nearest border (0 or 1), normalised by the band
            float d = min(t, 1.0 - t);
            return 1.0 - smoothstep(0.0, max(band, 1e-4), d);
        }
        void main() {
            float w = max(edgeW(v_uv.x, u_bandX), edgeW(v_uv.y, u_bandY));
            fragColor = vec4(vec3(w), 1.0);
        }`,

    /* One band of the Laplacian blend, in float.
       out = base + mix(a, b, w * m), where a and b are the band's detail from
       the original and the shifted copy. Runs on RGBA16F FBOs because band
       detail is signed and would clip to black at 8-bit. */
    bandBlend: `#version 300 es
        precision highp float;
        uniform sampler2D u_base;    // accumulated result so far
        uniform sampler2D u_a;       // this band, original
        uniform sampler2D u_b;       // this band, shifted copy
        uniform sampler2D u_mask;    // blend weight, blurred to this band's scale
        uniform float u_weight;      // extra per-band weight (falloff control)
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            vec4 base = texture(u_base, v_uv);
            vec4 a = texture(u_a, v_uv);
            vec4 b = texture(u_b, v_uv);
            float m = clamp(texture(u_mask, v_uv).r * u_weight, 0.0, 1.0);
            fragColor = vec4(base.rgb + mix(a.rgb, b.rgb, m), 1.0);
        }`,

    /* Signed difference of two float textures — one Laplacian band. */
    bandDiff: `#version 300 es
        precision highp float;
        uniform sampler2D u_fine, u_coarse;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
            fragColor = vec4(texture(u_fine, v_uv).rgb - texture(u_coarse, v_uv).rgb, 1.0);
        }`,

    /* Random rotated stamps, composited with VARIANCE-PRESERVING blending.
       ------------------------------------------------------------------
       Heitz & Neyret's observation: a plain weighted average of N samples of a
       texture has variance scaled by sum(w^2), so overlapping stamps wash out
       into mush — the contrast visibly sags wherever stamps overlap. Dividing
       the centred sum by sqrt(sum(w^2)) instead of by sum(w) restores the
       original variance, so overlaps keep the source's contrast.

       Every stamp is drawn at 9 wrap offsets, so the result tiles. */
    seamlessStamp: `#version 300 es
        precision highp float;
        uniform sampler2D u_texture;
        uniform float u_falloff;        // stamp edge softness (0-1)
        uniform float u_rotation;       // base rotation, turns
        uniform float u_rotationRandom; // random rotation spread
        uniform float u_scale;          // stamp size
        uniform float u_wobble;         // positional jitter
        uniform float u_randomize;      // seed
        in vec2 v_uv;
        out vec4 fragColor;

        const int STAMPS = 4;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        mat2 rot(float turns) {
            float a = turns * 6.2831853;
            return mat2(cos(a), -sin(a), sin(a), cos(a));
        }
        void main() {
            // Mean of the source, so we can centre before blending. A 4-tap
            // estimate is plenty: it only sets the level the variance is
            // restored around, not the detail.
            vec3 mean = 0.25 * (texture(u_texture, vec2(0.25, 0.25)).rgb
                              + texture(u_texture, vec2(0.75, 0.25)).rgb
                              + texture(u_texture, vec2(0.25, 0.75)).rgb
                              + texture(u_texture, vec2(0.75, 0.75)).rgb);

            vec3 acc = vec3(0.0);
            float wSum = 0.0, wSqSum = 0.0;
            float size = mix(0.45, 0.95, clamp(u_scale, 0.0, 1.0));

            for (int i = 0; i < STAMPS; i++) {
                float fi = float(i);
                vec2 seed = vec2(fi + 1.0, u_randomize * 37.0 + fi * 7.0);
                // stamp centre on a 2x2 lattice, jittered
                vec2 cell = vec2(mod(fi, 2.0), floor(fi * 0.5)) * 0.5 + 0.25;
                vec2 jitter = (vec2(hash(seed), hash(seed + 3.7)) - 0.5) * u_wobble * 0.5;
                vec2 centre = cell + jitter;
                float turns = u_rotation + (hash(seed + 11.3) - 0.5) * u_rotationRandom;

                // 9 wrap offsets so a stamp crossing the border reappears
                for (int oy = -1; oy <= 1; oy++) {
                    for (int ox = -1; ox <= 1; ox++) {
                        vec2 d = v_uv - centre - vec2(float(ox), float(oy));
                        vec2 local = rot(turns) * d / size;
                        // radial falloff -> weight; outside the stamp contributes nothing
                        float r = length(local) * 2.0;
                        if (r >= 1.0) continue;
                        float w = pow(1.0 - r, mix(1.0, 4.0, clamp(u_falloff, 0.0, 1.0)));
                        if (w <= 0.0) continue;
                        vec3 c = texture(u_texture, fract(local + 0.5)).rgb;
                        acc    += (c - mean) * w;
                        wSum   += w;
                        wSqSum += w * w;
                    }
                }
            }
            // Variance-preserving normalisation. Falling back to the mean where
            // nothing landed keeps the output defined for any parameter set.
            vec3 outC = (wSqSum > 1e-6) ? mean + acc / sqrt(wSqSum) : mean;
            fragColor = vec4(clamp(outC, 0.0, 1.0), 1.0);
        }`,

    /* ================================================================
       SPRITE NOISE BODY (SPRITE-PLAN phase 3), used by js/spritegen.js.
       A DENSITY field for one sprite frame: periodic fBm (the same
       classic periodic Perlin as animNoise, copied so animNoise's bytes
       cannot move), shaped by a body silhouette whose edge the noise
       roughens, then an erosion threshold that eats the thin parts first
       (the standard age-driven smoke puff). Writes the density in RGB;
       colour, background and the card-edge guard are applied on the CPU
       so both sprite families share them.

       Loop closure is exact by construction: the time and flow offsets
       arrive already wrapped with fract() on the CPU side, so the frame
       at t=1 is computed from the SAME inputs as t=0; and both offsets
       are whole lattice periods apart from any other t, so the wrap is
       invisible. EVERY uniform is passed on every call (blit leaves
       uniforms set from the previous draw).
       ================================================================ */
    spriteNoise: `#version 300 es
        precision highp float;
        uniform float u_period;      // lattice cells across the card (integer)
        uniform float u_timeZ;       // time along the lattice's z, already wrapped
        uniform float u_timePeriod;  // z period (integer)
        uniform vec2  u_shift;       // flow offset in lattice cells, already wrapped
        uniform float u_octaves;
        uniform float u_gain;
        uniform float u_style;       // 0 fBm, 1 ridged, 2 billow
        uniform float u_warp;
        uniform float u_seed;
        uniform float u_body;        // 0 round, 1 flame, 2 column, 3 cloud
        uniform float u_scale;       // the frame's size factor
        uniform float u_ragged;      // how far the noise pushes the silhouette
        uniform float u_feather;     // silhouette edge softness
        uniform float u_detail;      // 0 = flat body, 1 = fully noise-modulated
        uniform float u_contrast;
        uniform float u_erode;       // density below this burns away
        uniform float u_erodeSoft;
        uniform float u_bright;
        in vec2 v_uv;
        out vec4 fragColor;

        vec3 mod289v3(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
        vec4 mod289v4(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
        vec4 permute(vec4 x){ return mod289v4(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
        vec3 fade(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }
        // \`so\` offsets the HASH after the periodic wrap, not the position: an
        // offset on the position is itself wrapped by \`rep\`, so a seed of
        // floor(seed * 16) vanished on every period dividing 16 (measured:
        // seeds 9 and 10 gave identical bytes). A constant on the hashed index
        // keeps the period and changes every gradient.
        float pnoise(vec3 P, vec3 rep, vec3 so){
            vec3 Pi0 = mod(floor(P), rep);
            vec3 Pi1 = mod(Pi0 + 1.0, rep);
            Pi0 = mod289v3(Pi0 + so); Pi1 = mod289v3(Pi1 + so);
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
        float shape(float n, int style){
            if (style == 1) return 1.0 - abs(n);
            if (style == 2) return abs(n);
            return n * 0.5 + 0.5;
        }
        // fBm over lattice coordinates L (already in cells), periodic in x/y
        // by u_period and in z by u_timePeriod.
        float fbm(vec3 L, int style, vec3 so){
            float amp = 0.5, sum = 0.0, norm = 0.0;
            vec3 rep = vec3(u_period, u_period, u_timePeriod);
            vec3 P = L;
            for (int i = 0; i < 8; i++){
                if (float(i) >= u_octaves) break;
                sum  += amp * shape(pnoise(P, rep, so), style);
                norm += amp;
                P *= 2.0; rep *= 2.0; amp *= u_gain;
            }
            return sum / max(norm, 1e-4);
        }

        // Distance-like body coordinate: 1.0 on the silhouette, < 1 inside.
        float bodyDist(vec2 p, int body){
            if (body == 1) {                                   // flame: wide base, tapering tip
                vec2 q = p - vec2(0.0, -0.35);
                float taper = mix(1.0, 0.18, smoothstep(-0.45, 1.0, q.y));
                return length(vec2(q.x / (0.5 * taper), q.y / (q.y > 0.0 ? 1.15 : 0.42)));
            }
            if (body == 2) {                                   // column: a rising plume
                return length(vec2(p.x / 0.32, max(0.0, abs(p.y) - 0.45) / 0.35));
            }
            if (body == 3) {                                   // cloud: wide and low
                return length(p * vec2(1.0 / 0.85, 1.0 / 0.5));
            }
            return length(p) / 0.72;                           // round puff
        }

        void main(){
            int style = int(u_style + 0.5);
            int body = int(u_body + 0.5);
            // One hash offset per field, all from the seed.
            vec3 so = mod(floor(u_seed) * vec3(7.0, 13.0, 29.0), 289.0);
            vec3 L = vec3(v_uv * u_period + u_shift, u_timeZ);
            if (u_warp > 0.0){
                vec2 w = vec2(fbm(L, 0, so + vec3(31.0, 0.0, 0.0)) - 0.5,
                              fbm(L, 0, so + vec3(0.0, 47.0, 0.0)) - 0.5);
                L.xy += u_warp * 2.0 * w;
            }
            float n = fbm(L, style, so);
            // Contrast about each style's own mean: billow sits low (~0.3) and
            // ridged high (~0.7), so centring them on 0.5 emptied billow bodies
            // and burned ridged ones to white.
            float centre = style == 2 ? 0.3 : (style == 1 ? 0.7 : 0.5);
            float nc = clamp((n - centre) * u_contrast + 0.5, 0.0, 1.0);

            vec2 p = (v_uv * 2.0 - 1.0) / max(u_scale, 1e-3);
            // The silhouette is roughed by its OWN plain fBm (mean 0.5 whatever
            // the style), scaled up because fBm sits in a narrow band round 0.5;
            // at Ragged 1 it tears tongues off the edge.
            float ne = fbm(L, 0, so + vec3(71.0, 13.0, 5.0));
            float d = bodyDist(p, body) - u_ragged * (ne - 0.5) * 3.0;
            float mask = 1.0 - smoothstep(1.0 - max(u_feather, 0.01), 1.0, d);
            float dens = mask * mix(1.0, nc, u_detail);
            float v = dens * smoothstep(u_erode, u_erode + max(u_erodeSoft, 0.005), dens);
            v = clamp(v * u_bright, 0.0, 1.0);
            fragColor = vec4(v, v, v, 1.0);
        }`,
    /* ---------- The shared resampler (TRANSFORMS-PLAN D1) ----------
       Every transform (Free Transform, Perspective, Distort, and the map
       move behind them) is INVERSE mapping: each output pixel asks where it
       came from, p = G(x), and samples the source there.

       Coordinates are IMAGE pixels, y down, pixel centres at i + 0.5, on both
       sides: textures arrive with UNPACK_FLIP_Y, so a fetch flips the row back.
       G is affine (u_m0, u_m1 rows applied to (x, y, 1)) or, with u_map = 1, a
       homography divided by the u_m2 row.

       Taps are texelFetch with the edge rule done on integers (exact on any tile
       size, including non-power-of-two photos), never hardware LINEAR: straight
       alpha filtered by the hardware turns a cutout's hidden RGB into a fringe,
       the lesson warpLayerToroidal already paid for. So every tap is
       premultiplied, filtered, clamped (bicubic and Lanczos overshoot), divided.

       u_filter: 0 nearest, 1 bilinear, 2 bicubic (Catmull-Rom), 3 Lanczos-3.
       u_edge:   0 wrap, 1 stretch, 2 transparent, 3 mirror. Stretch is NOT a
                 per-axis clamp: a point past a corner clamps both axes to one
                 pixel, so every corner went flat (measured: 11,615 pixels, 7
                 colours, in a Perspective distort). It pulls a point outside the
                 tile back to the border along the line to the tile's centre
                 (`stretchIn`), so the corners fan out; the taps then still clamp.
       u_ss:     K x K supersample per output pixel (1..4), for shrinking.
       u_normal: 1 = the source is an encoded normal map, so the slope it encodes
                 is turned by the map's Jacobian too (n proportional to (-grad h, 1),
                 and under G the gradient becomes JG^T grad h). JG is taken by
                 central differences, then divided by sqrt|det| so a resize turns
                 the relief without steepening or flattening it. u_nflip is the
                 green channel's sign against image-down y (-1 = the tool's own
                 convention, Flip Normal Y off). */
    warpResample: `#version 300 es
        precision highp float;
        precision highp int;
        uniform sampler2D u_src;
        uniform vec2 u_srcSize;
        uniform vec2 u_dstSize;
        uniform float u_map;
        uniform vec3 u_m0, u_m1, u_m2;
        uniform float u_filter;
        uniform float u_edge;
        uniform float u_ss;
        uniform float u_normal;
        uniform float u_nflip;
        // Distort (phase 4): a displacement added to G, in source px. 0 none,
        // 1 wave, 2 a map (R sideways, G up and down, 128 = no shift). t is the
        // output position over u_dispPeriod (the tile), so whole cycles and a
        // tiling map repeat exactly; u_dispAmpScale turns tile px into this
        // canvas's px for a layer stored at another size.
        uniform float u_dispMode;
        uniform vec2 u_dispPeriod;
        uniform float u_dispAmpScale;
        uniform vec2 u_waveAmp, u_waveCycles;
        uniform float u_wavePhase, u_waveShape;
        uniform sampler2D u_dispMap;
        uniform vec2 u_dispMapSize;
        uniform float u_dispStrength;
        // FILTERS-PLAN phase 2: 3 = a radial distortion, written in fractions of the
        // period (so a layer stored at another size follows it) and added in canvas
        // px. Inside a circle that falls to no shift at its rim; the centre wraps
        // (toroidal), and a radius of at most half the tile never reaches the border,
        // so the result tiles. Original code for the published maps (Twirl, Pinch,
        // Spherize, ZigZag, Polar Coordinates); PhotoCraft's distort.rs / distort2.rs
        // (MIT OR Apache-2.0, Copyright (c) 2026 ArtCraft Team and the PhotoCraft
        // contributors) is the reference for the formulas.
        uniform float u_radType, u_radSub, u_radAmount, u_radRidges, u_radRadius;
        uniform vec2 u_radCentre;
        // 4 = Liquify's field (FILTERS-PLAN phase 3): an N x N RGBA32F grid, r and g the offset as a fraction
        // of the tile, node i at (i + 0.5) / N; Catmull-Rom with every index wrapped, so it tiles.
        uniform sampler2D u_dispField;
        uniform float u_fieldN;
        out vec4 fragColor;

        int fdiv(int a, int b) { return int(floor(float(a) / float(b))); }
        int edgeAxis(int i, int n, int mode) {
            if (mode == 0) return i - n * fdiv(i, n);
            if (mode == 3) { int m = i - 2 * n * fdiv(i, 2 * n); return m < n ? m : 2 * n - 1 - m; }
            return clamp(i, 0, n - 1);
        }
        vec4 tap(ivec2 q) {
            ivec2 n = ivec2(u_srcSize);
            int mode = int(u_edge + 0.5);
            if (mode == 2 && (q.x < 0 || q.y < 0 || q.x >= n.x || q.y >= n.y)) return vec4(0.0);
            ivec2 r = ivec2(edgeAxis(q.x, n.x, mode), edgeAxis(q.y, n.y, mode));
            vec4 c = texelFetch(u_src, ivec2(r.x, n.y - 1 - r.y), 0);
            return vec4(c.rgb * c.a, c.a);
        }
        float cubicW(float x) {           // Catmull-Rom, a = -0.5
            x = abs(x);
            if (x < 1.0) return (1.5 * x - 2.5) * x * x + 1.0;
            if (x < 2.0) return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
            return 0.0;
        }
        float lanczosW(float x) {
            x = abs(x);
            if (x < 1e-5) return 1.0;
            if (x >= 3.0) return 0.0;
            float px = 3.14159265358979 * x;
            return 3.0 * sin(px) * sin(px / 3.0) / (px * px);
        }
        vec2 stretchIn(vec2 p) {
            vec2 c = u_srcSize * 0.5, d = p - c;
            vec2 lim = (c - 0.5) / max(abs(d), vec2(1e-6));
            return c + d * min(1.0, min(lim.x, lim.y));
        }
        vec4 sampleAt(vec2 p) {
            if (int(u_edge + 0.5) == 1) p = stretchIn(p);
            int f = int(u_filter + 0.5);
            if (f == 0) return tap(ivec2(floor(p)));
            vec2 t = p - 0.5;
            vec2 b = floor(t);
            vec2 fr = t - b;
            ivec2 i0 = ivec2(b);
            if (f == 1) {
                return mix(mix(tap(i0), tap(i0 + ivec2(1, 0)), fr.x),
                           mix(tap(i0 + ivec2(0, 1)), tap(i0 + ivec2(1, 1)), fr.x), fr.y);
            }
            int lo = f == 2 ? -1 : -2, hi = f == 2 ? 2 : 3;
            float wx[6], wy[6];
            float sx = 0.0, sy = 0.0;
            for (int k = 0; k < 6; k++) {
                int o = lo + k;
                if (o > hi) { wx[k] = 0.0; wy[k] = 0.0; continue; }
                wx[k] = f == 2 ? cubicW(fr.x - float(o)) : lanczosW(fr.x - float(o));
                wy[k] = f == 2 ? cubicW(fr.y - float(o)) : lanczosW(fr.y - float(o));
                sx += wx[k]; sy += wy[k];
            }
            vec4 acc = vec4(0.0);
            for (int j = 0; j < 6; j++) {
                if (lo + j > hi) break;
                vec4 row = vec4(0.0);
                for (int k = 0; k < 6; k++) {
                    if (lo + k > hi) break;
                    row += wx[k] * tap(i0 + ivec2(lo + k, lo + j));
                }
                acc += wy[j] * row;
            }
            return acc / (sx * sy);
        }
        float waveF(float a) {
            float s = sin(a);
            if (u_waveShape > 1.5) return s >= 0.0 ? 1.0 : -1.0;
            if (u_waveShape > 0.5) return asin(clamp(s, -1.0, 1.0)) * 0.63661977;
            return s;
        }
        vec2 fieldNode(ivec2 q) {
            int n = int(u_fieldN + 0.5);
            return texelFetch(u_dispField, ivec2(q.x - n * fdiv(q.x, n), q.y - n * fdiv(q.y, n)), 0).rg;
        }
        vec2 fieldDisp(vec2 t) {
            vec2 g = t * u_fieldN - 0.5, b = floor(g), f = g - b;
            ivec2 i0 = ivec2(b);
            vec2 acc = vec2(0.0);
            for (int j = -1; j <= 2; j++) {
                float wy = cubicW(f.y - float(j));
                for (int i = -1; i <= 2; i++) acc += fieldNode(i0 + ivec2(i, j)) * (cubicW(f.x - float(i)) * wy);
            }
            return acc;
        }
        float sphere1d(float rn, float a) {
            float target = a >= 0.0 ? asin(clamp(rn, 0.0, 1.0)) * 0.63661977 : sin(rn * 1.57079633);
            return rn + abs(a) * (target - rn);
        }
        vec2 radialDisp(vec2 xm) {
            vec2 P = u_dispPeriod;
            float TAU = 6.28318531;
            if (u_radType > 3.5) {                               // Polar Coordinates: the whole tile
                float rmax = min(P.x, P.y) * 0.5;
                vec2 c = P * 0.5, src;
                if (u_radSub < 0.5) {
                    vec2 dl = xm - c;
                    float th = atan(dl.x, -dl.y);
                    if (th < 0.0) th += TAU;
                    src = vec2(th / TAU * P.x, length(dl) / rmax * P.y);
                } else {
                    float th = xm.x / P.x * TAU, r = xm.y / P.y * rmax;
                    src = c + r * vec2(sin(th), -cos(th));
                }
                return src - xm;
            }
            vec2 q = xm / P - u_radCentre;
            q -= floor(q + 0.5);                                 // the nearest copy of the centre
            vec2 delta = q * P;
            float Rp = u_radRadius * 0.5 * min(P.x, P.y), r = length(delta), a = u_radAmount;
            vec2 s = delta;
            if (u_radType < 0.5) {                               // Twirl: a is radians
                if (r < Rp) {
                    float t = a * (1.0 - r / Rp), cs = cos(t), sn = sin(t);
                    s = vec2(delta.x * cs - delta.y * sn, delta.x * sn + delta.y * cs);
                }
            } else if (u_radType < 1.5) {                        // Pinch: a in -1..1
                if (r < Rp && r > 0.0) s = delta * (Rp * pow(r / Rp, 1.0 - a * 0.5) / r);
            } else if (u_radType < 2.5) {                        // Spherize
                if (u_radSub < 0.5) {
                    if (r < Rp && r > 0.0) s = delta * (Rp * sphere1d(r / Rp, a) / r);
                } else if (u_radSub < 1.5) {
                    if (abs(delta.x) < Rp) s.x = sign(delta.x) * Rp * sphere1d(abs(delta.x) / Rp, a);
                } else {
                    if (abs(delta.y) < Rp) s.y = sign(delta.y) * Rp * sphere1d(abs(delta.y) / Rp, a);
                }
            } else if (r < Rp && r > 0.0 && a != 0.0) {         // ZigZag
                float k = max(u_radRidges, 0.5), rn = r / Rp;
                float wave = sin(TAU * k * rn) * (1.0 - rn);
                float radial = 0.0, angular = 0.0;
                if (u_radSub < 0.5) angular = a * wave * 1.57079633 / k;                  // around the centre
                else if (u_radSub < 1.5) radial = a * wave * Rp / (4.0 * k);              // out from the centre
                else { radial = a * wave * Rp / (8.0 * k); angular = a * wave * 0.785398163 / k; }   // pond ripples
                float th = atan(delta.y, delta.x) + angular, rs = max(r + radial, 0.0);
                s = rs * vec2(cos(th), sin(th));
            }
            return s - delta;
        }
        vec2 G(vec2 x) {
            vec3 h = vec3(x, 1.0);
            vec2 p = vec2(dot(u_m0, h), dot(u_m1, h));
            if (u_map > 0.5) p /= dot(u_m2, h);
            if (u_dispMode > 0.5) {
                /* Wrapped into one period BEFORE anything else, so x and x + period
                   give the same bits: dividing first and adding a cycle later
                   rounds differently, and a repeat that is off by an ulp is not
                   a repeat. The map is fetched by hand (integer wrap, bilinear)
                   for the same reason: hardware filtering at t and t + 1 differs. */
                vec2 xm = x - u_dispPeriod * floor(x / u_dispPeriod);
                vec2 t = xm / u_dispPeriod;
                vec2 d;
                if (u_dispMode > 3.5) {
                    d = fieldDisp(t) * u_dispPeriod;
                } else if (u_dispMode > 2.5) {
                    d = radialDisp(xm);
                } else if (u_dispMode < 1.5) {
                    d = vec2(u_waveAmp.x * waveF(6.28318531 * u_waveCycles.y * t.y + u_wavePhase),
                             u_waveAmp.y * waveF(6.28318531 * u_waveCycles.x * t.x + u_wavePhase));
                } else {
                    ivec2 n = ivec2(u_dispMapSize);
                    vec2 q = t * u_dispMapSize - 0.5;
                    vec2 b = floor(q), f = q - b;
                    ivec2 i0 = ivec2(b);
                    vec2 m00, m10, m01, m11;
                    #define MAPTAP(o) texelFetch(u_dispMap, ivec2(edgeAxis(i0.x + o.x, n.x, 0), n.y - 1 - edgeAxis(i0.y + o.y, n.y, 0)), 0).rg
                    m00 = MAPTAP(ivec2(0, 0)); m10 = MAPTAP(ivec2(1, 0));
                    m01 = MAPTAP(ivec2(0, 1)); m11 = MAPTAP(ivec2(1, 1));
                    vec2 m = mix(mix(m00, m10, f.x), mix(m01, m11, f.x), f.y);
                    d = (m * 255.0 - 128.0) / 127.5 * u_dispStrength;
                }
                p += d * u_dispAmpScale;
            }
            return p;
        }
        void main() {
            vec2 x = vec2(gl_FragCoord.x, u_dstSize.y - gl_FragCoord.y);
            int K = int(clamp(u_ss, 1.0, 4.0) + 0.5);
            vec4 acc = vec4(0.0);
            for (int j = 0; j < 4; j++) {
                if (j >= K) break;
                for (int i = 0; i < 4; i++) {
                    if (i >= K) break;
                    vec2 o = (vec2(float(i), float(j)) + 0.5) / float(K) - 0.5;
                    vec4 s = sampleAt(G(x + o));
                    s.a = clamp(s.a, 0.0, 1.0);
                    s.rgb = clamp(s.rgb, 0.0, s.a);
                    acc += s;
                }
            }
            acc /= float(K * K);
            vec4 c = acc.a > 0.5 / 255.0 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
            if (u_normal > 0.5) {
                vec2 cx = (G(x + vec2(1.0, 0.0)) - G(x - vec2(1.0, 0.0))) * 0.5;
                vec2 cy = (G(x + vec2(0.0, 1.0)) - G(x - vec2(0.0, 1.0))) * 0.5;
                mat2 JG = mat2(cx, cy);                  // columns: dG/dx, dG/dy
                float det = abs(determinant(JG));
                if (det > 1e-8) JG /= sqrt(det);
                vec3 n = c.rgb * 2.0 - 1.0;
                vec2 g = vec2(n.x, u_nflip * n.y) / max(n.z, 1e-3);
                g = transpose(JG) * g;
                vec3 m = normalize(vec3(g.x, u_nflip * g.y, 1.0));
                c.rgb = m * 0.5 + 0.5;
            }
            fragColor = c;
        }`,
    /* ---------- Slope Blur (WEATHERING-PLAN phase 1) ----------
       After Substance's Slope Blur: each pixel looks along the slope of a DRIVER
       (a smoothed grey) and takes a one-sided run of taps downhill (or uphill),
       so wear and smearing follow the relief. Mode 0 averages the taps (a
       directional blur), 1 keeps the tap with the lowest luminance (edges are
       eaten away), 2 the highest (edges smear out). Min and Max pick a whole
       tap, so colours stay colours instead of channels being compared. The run
       is u_amount px long, or scaled by the slope's strength when u_follow is
       on. u_edge 0 wraps (the result tiles when the tile and the driver do),
       1 clamps. Taps are premultiplied, as in warpResample. A flat driver, no
       amount or no strength writes the source texel unchanged. Original code
       for the published technique; Material Maker's slope_blur (MIT) is the
       reference for the one-sided taps. All fetches are texel-exact in GL
       coordinates, so the flipped upload needs no handling. */
    slopeBlur: `#version 300 es
        precision highp float;
        precision highp int;
        uniform sampler2D u_src;
        uniform sampler2D u_driver;
        uniform vec2 u_size;
        uniform float u_amount, u_samples, u_mode, u_dir, u_follow, u_gain, u_strength, u_edge;
        out vec4 fragColor;
        int fdiv(int a, int b) { return int(floor(float(a) / float(b))); }
        ivec2 edgeQ(ivec2 q) {
            ivec2 n = ivec2(u_size);
            if (u_edge < 0.5) return ivec2(q.x - n.x * fdiv(q.x, n.x), q.y - n.y * fdiv(q.y, n.y));
            return clamp(q, ivec2(0), n - 1);
        }
        float D(ivec2 q) { return texelFetch(u_driver, edgeQ(q), 0).r; }
        vec4 fetchP(ivec2 q) { vec4 c = texelFetch(u_src, edgeQ(q), 0); return vec4(c.rgb * c.a, c.a); }
        vec4 bil(vec2 p) {
            vec2 t = p - 0.5, b = floor(t), f = t - b;
            ivec2 i0 = ivec2(b);
            return mix(mix(fetchP(i0), fetchP(i0 + ivec2(1, 0)), f.x),
                       mix(fetchP(i0 + ivec2(0, 1)), fetchP(i0 + ivec2(1, 1)), f.x), f.y);
        }
        float key(vec4 pm) {
            if (pm.a < 0.004) return u_mode < 1.5 ? 2.0 : -1.0;   // a hole never wins
            return dot(pm.rgb, vec3(0.299, 0.587, 0.114)) / pm.a;
        }
        void main() {
            ivec2 p = ivec2(gl_FragCoord.xy);
            vec4 raw = texelFetch(u_src, p, 0);
            if (u_amount < 0.01 || u_strength <= 0.0) { fragColor = raw; return; }
            vec2 g = vec2(D(p + ivec2(1, 0)) - D(p - ivec2(1, 0)), D(p + ivec2(0, 1)) - D(p - ivec2(0, 1))) * 0.5;
            float gl = length(g);
            if (gl < 1e-6) { fragColor = raw; return; }
            vec2 dir = -g / gl * u_dir;
            float len = u_amount * (u_follow > 0.5 ? clamp(gl * u_gain, 0.0, 1.0) : 1.0);
            int N = int(clamp(u_samples, 2.0, 48.0));
            vec2 c0 = vec2(p) + 0.5;
            vec4 best = bil(c0), acc = best;
            float bk = key(best);
            for (int i = 0; i < 48; i++) {
                if (i >= N) break;
                vec4 s = bil(c0 + dir * len * (float(i + 1) / float(N)));
                if (u_mode < 0.5) acc += s;
                else {
                    float k = key(s);
                    if (u_mode < 1.5 ? k < bk : k > bk) { bk = k; best = s; }
                }
            }
            vec4 res = u_mode < 0.5 ? acc / float(N + 1) : best;
            vec4 pm = mix(vec4(raw.rgb * raw.a, raw.a), res, clamp(u_strength, 0.0, 1.0));
            fragColor = pm.a > 0.5 / 255.0 ? vec4(pm.rgb / pm.a, pm.a) : vec4(0.0);
        }`,
};
