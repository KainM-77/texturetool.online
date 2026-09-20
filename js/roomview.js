/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE).

   ONE EXCEPTION, and it is not in this file. The room's lighting arithmetic is
   derived from TombEngine and lives in `ten/room-shading.js` under TombEngine's
   Modified MIT (non-commercial) licence. This file declares the uniforms, holds
   the GL plumbing and assembles the shader; the chunks it interpolates carry
   their own licence. Nothing else here is derived from the engine. */
/* ============================================================
   TRLE.RoomView — the room renderer
   ============================================================
   Its OWN WebGL 2 context, never shared with TRLE.Engine. Engine is a
   blitter: one fullscreen quad, no depth buffer, no camera. A room needs
   indexed geometry, a depth test and a camera that the user drives, so it
   gets its own context and the two exchange nothing but <canvas> textures.
   Babylon already follows this rule for the same reason.

   Subphase 2.4 draws geometry lit only by its BAKED VERTEX COLOURS, which
   is what Tomb Editor's viewport shows. Textures arrive in 2.5 and TombEngine's
   shading in 2.6.

   Camera controls are Tomb Editor's, deliberately: right-drag orbits,
   middle-drag pans, the wheel zooms. The audience already has those reflexes.

   Usage:
     const rv = TRLE.RoomView.create(canvas);
     await rv.load('rooms/room0.json');
     rv.setVertexColours(TRLE.RoomLight.bake(rv.mesh(), lights, ambient, opts));
     rv.lookAt([x,y,z], [x,y,z]);     // reproduce a known camera
   ============================================================ */
window.TRLE = window.TRLE || {};

TRLE.RoomView = (function () {
    'use strict';

    /* Field of view. 50 is what Tomb Editor's viewport uses and is the better
       working angle; 90 is what the in-game captures were taken at, so it is
       the "what the player sees" setting. Whether TombEngine states 90
       horizontally or vertically is settled in subphase 2.10 by rendering
       against a known capture; until then this is HORIZONTAL, which is how
       Tomb Raider has always stated it. */
    const FOV_EDITOR = 50, FOV_GAME = 90;

    const MAX_LIGHTS = 8;

    const VERT = `#version 300 es
        in vec3 a_position;
        in vec3 a_colour;
        in vec2 a_uv;
        in vec3 a_normal;
        in vec3 a_tangent;
        in vec3 a_bitangent;
        in float a_sel;
        uniform mat4 u_mvp;
        out vec3 v_colour;
        out vec2 v_uv;
        out vec3 v_world;
        out vec3 v_n;
        out vec3 v_t;
        out vec3 v_b;
        out float v_sel;
        void main() {
            v_sel = a_sel;
            v_colour = a_colour;
            v_uv = a_uv;
            v_world = a_position;
            v_n = a_normal; v_t = a_tangent; v_b = a_bitangent;
            gl_Position = u_mvp * vec4(a_position, 1.0);
        }`;

    /* TombEngine's room path, in the order Rooms.hlsl runs it:

           lighting  = the interpolated BAKED vertex colour, which is the whole
                       ambient — there is no image-based term and no constant
                       anywhere in the room path
           lighting += each dynamic light, diffuse x ROOM_LIGHT_COEFF
           lighting += each dynamic light, specular
           lighting += emissive
           colour    = texture * lighting * occlusion,  saturated

       THE ARITHMETIC OF THOSE MIDDLE LINES IS NOT MIT. It was taken from
       reading the engine, so it lives in `ten/room-shading.js` under
       TombEngine's own non-commercial licence and is interpolated in below. The
       uniform declarations, the sampling, the tangent frame and the selection
       tint are ours and stay here. See that file for what was taken and why it
       is not tidied.

       The consequence that is structural rather than arithmetic, and the reason
       the per-map toggles behave the way 2.18 measured: the baked term is a
       VERTEX ATTRIBUTE, so it cannot respond to a per-pixel normal map, and
       specular enters only through the light loop. A surface lit solely by
       baked light shows no normal-map response and no specular at all. */
    const TEN = TRLE.TenRoomShading;
    const FRAG = `#version 300 es
        precision highp float;
        in vec3 v_colour;
        in vec2 v_uv;
        in vec3 v_world;
        in vec3 v_n;
        in vec3 v_t;
        in vec3 v_b;
        in float v_sel;

        uniform sampler2D u_atlas;
        uniform sampler2D u_normal;
        uniform sampler2D u_ao;
        uniform sampler2D u_specular;
        uniform sampler2D u_roughness;
        uniform sampler2D u_emissive;
        uniform float u_hasNormal, u_hasAO, u_hasSpecular, u_hasRoughness, u_hasEmissive;

        uniform int   u_lightCount;
        uniform vec3  u_lightPos[${MAX_LIGHTS}];
        uniform vec3  u_lightColour[${MAX_LIGHTS}];
        uniform float u_lightIntensity[${MAX_LIGHTS}];
        uniform float u_lightIn[${MAX_LIGHTS}];
        uniform float u_lightOut[${MAX_LIGHTS}];
        uniform float u_lightSpot[${MAX_LIGHTS}];      // 1 for a spot, 0 for a point
        uniform vec3  u_lightAxis[${MAX_LIGHTS}];      // the way a spot points
        uniform float u_lightCosIn[${MAX_LIGHTS}];     // cosines, not angles
        uniform float u_lightCosOut[${MAX_LIGHTS}];
        uniform float u_anySpot;
        uniform vec3  u_camForward;

        out vec4 fragColor;

        ${TEN.constants()}

        void main() {
            vec3 tex = texture(u_atlas, v_uv).rgb;

            vec3 N = normalize(v_n);
            if (u_hasNormal > 0.5) {
                vec3 m = texture(u_normal, v_uv).xyz * 2.0 - 1.0;
                N = normalize(normalize(v_t) * m.x + normalize(v_b) * m.y + N * m.z);
            }
            float ao   = u_hasAO        > 0.5 ? texture(u_ao,        v_uv).r : 1.0;
            float sp   = u_hasSpecular  > 0.5 ? texture(u_specular,  v_uv).r : 0.0;
            float rgh  = u_hasRoughness > 0.5 ? texture(u_roughness, v_uv).r : 1.0;
            vec3 emis  = u_hasEmissive  > 0.5 ? texture(u_emissive,  v_uv).rgb : vec3(0.0);

            vec3 lighting = v_colour;

            ${TEN.lightLoop(MAX_LIGHTS)}

            ${TEN.composite()}
            /* Cool, because the room is warm. A selection has to be visible at a
               glance or it is exactly the kind of state this project has a
               memory about: live, and invisible. */
            if (v_sel > 0.5) rgb = mix(rgb, vec3(0.35, 0.80, 1.0), 0.45);
            fragColor = vec4(rgb, 1.0);
        }`;

    /* The pick pass. Face ids are written as a colour and one pixel is read
       back, which is exact by construction -- no ray, no tolerance, and it
       cannot disagree with what the user is looking at because it is rendered
       from the same camera with the same geometry. */
    /* Light markers: one BILLBOARDED QUAD per light, drawn after the room with
       the depth test off so a bulb inside a wall can still be found.

       NOT gl.POINTS, which is what 2.8 used. A point is clipped by its CENTRE,
       so a bulb half off the edge of the frame disappears entirely while it is
       still half on screen, and gl_PointSize is capped by the driver
       (ALIASED_POINT_SIZE_RANGE, 255 on plenty of them). A quad expanded in
       clip space has neither problem and costs six vertices per light.

       The glyphs come from a sheet drawn with canvas 2D paths, not from an
       emoji font. The same page would otherwise draw differently on macOS, on
       Windows and in headless Chrome, and those differences would land in the
       tracked reference PNGs as capture noise -- which one of them, by
       CLAUDE.md's own measurement, has little enough signal left to spare. */
    const ICONS = { sun: 0, point: 1, spot: 2, flame: 3 };
    const ICON_GRID = 2;            // a 2x2 sheet
    const ICON_CELL = 64;

    const MARK_VERT = `#version 300 es
        in vec3 a_position;
        in vec2 a_corner;           // -1..1, the quad's own corner
        in vec3 a_colour;
        in float a_icon;
        in float a_sel;
        uniform mat4 u_mvp;
        uniform vec2 u_half;        // half-size in CLIP units, so the pixel size is constant
        out vec2 v_uv;
        out vec3 v_c;
        out vec2 v_corner;
        out float v_sel;
        void main() {
            vec4 clip = u_mvp * vec4(a_position, 1.0);
            /* Multiplying by w before the perspective divide is what keeps the
               sprite the same size on screen at any distance. */
            clip.xy += a_corner * u_half * clip.w;
            gl_Position = clip;
            v_c = a_colour; v_corner = a_corner; v_sel = a_sel;
            vec2 cell = a_corner * 0.5 + 0.5;
            cell.y = 1.0 - cell.y;                       // the sheet runs top-down
            float cx = mod(a_icon, ${ICON_GRID}.0);
            float cy = floor(a_icon / ${ICON_GRID}.0);
            v_uv = (vec2(cx, cy) + cell) / ${ICON_GRID}.0;
        }`;

    /* The glyph carries its own outline: black rim, white body. Multiplying by
       the light's colour therefore leaves the rim black and tints only the
       body, so one sprite reads against a dark wall and a bright one alike. */
    const MARK_FRAG = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec3 v_c;
        in vec2 v_corner;
        in float v_sel;
        uniform sampler2D u_icons;
        out vec4 fragColor;
        void main() {
            vec4 t = texture(u_icons, v_uv);
            vec3 col = v_c * t.rgb;
            float a = t.a;
            if (v_sel > 0.5) {
                float r = length(v_corner);
                float ring = smoothstep(0.99, 0.94, r) * smoothstep(0.80, 0.86, r);
                col = mix(col, vec3(1.0), ring);
                a = max(a, ring);
            }
            if (a < 0.01) discard;
            fragColor = vec4(col, a);
        }`;

    /* The sheet. Two passes per glyph: a wide black stroke lays the rim down,
       then a white fill covers all but that rim. */
    function buildIconSheet() {
        const S = ICON_CELL, c = document.createElement('canvas');
        c.width = c.height = S * ICON_GRID;
        const x = c.getContext('2d');
        const shapes = {
            [ICONS.sun](x) {
                x.beginPath(); x.arc(32, 32, 13, 0, 7); x.fill(); x.stroke();
                for (let i = 0; i < 8; i++) {
                    const a = i * Math.PI / 4;
                    x.beginPath();
                    x.moveTo(32 + Math.cos(a) * 19, 32 + Math.sin(a) * 19);
                    x.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
                    x.stroke();
                }
            },
            [ICONS.point](x) {
                x.beginPath(); x.arc(32, 26, 14, 0, 7); x.fill(); x.stroke();
                x.beginPath(); x.moveTo(24, 42); x.lineTo(40, 42);
                x.lineTo(37, 52); x.lineTo(27, 52); x.closePath(); x.fill(); x.stroke();
            },
            [ICONS.spot](x) {
                x.beginPath(); x.moveTo(32, 16); x.lineTo(51, 53); x.lineTo(13, 53);
                x.closePath(); x.fill(); x.stroke();
                x.beginPath(); x.arc(32, 15, 7, 0, 7); x.fill(); x.stroke();
            },
            /* A teardrop, not a symmetric lens. Two mirrored beziers meeting at
               both ends read as a leaf; a round base under a drawn-out tip reads
               as a flame. */
            [ICONS.flame](x) {
                x.beginPath();
                x.moveTo(32, 8);
                x.bezierCurveTo(44, 24, 50, 33, 50, 39);
                x.arc(32, 39, 18, 0, Math.PI);
                x.bezierCurveTo(14, 33, 20, 24, 32, 8);
                x.closePath(); x.fill(); x.stroke();
            }
        };
        for (const k of Object.keys(shapes)) {
            const i = +k;
            for (const pass of [0, 1]) {
                x.save();
                x.translate((i % ICON_GRID) * S, Math.floor(i / ICON_GRID) * S);
                x.lineJoin = 'round'; x.lineCap = 'round';
                x.strokeStyle = pass ? '#fff' : '#000';
                x.fillStyle   = pass ? '#fff' : '#000';
                x.lineWidth   = pass ? 1 : 9;
                shapes[k](x);
                x.restore();
            }
        }
        return c;
    }

    /* The gizmo. Shafts are lines and are decoration; the HANDLES are discs and
       are the hit targets, which is what lets the id buffer do the hit-testing.
       A 1px line is not something you can reliably aim at anyway.

       Hit-testing through the id buffer rather than through ray-versus-cylinder
       maths, for the reason 2.5 gives for face picking: it is exact by
       construction and it cannot disagree with what the user is looking at,
       because it is rendered from the same camera with the same geometry. */
    const GIZ_BASE = 0xF000;                 // above any face id; faces reach ~1141
    const GIZ_HANDLES = ['x', 'y', 'z', 'dir'];

    const GIZ_VERT = `#version 300 es
        in vec3 a_position;
        in vec2 a_corner;
        in vec3 a_colour;
        in float a_id;
        in float a_disc;
        uniform mat4 u_mvp;
        uniform vec2 u_half;
        out vec3 v_c;
        out vec2 v_corner;
        out float v_disc;
        flat out float v_id;
        void main() {
            vec4 clip = u_mvp * vec4(a_position, 1.0);
            clip.xy += a_corner * u_half * clip.w;
            gl_Position = clip;
            v_c = a_colour; v_corner = a_corner; v_disc = a_disc; v_id = a_id;
        }`;

    const GIZ_FRAG = `#version 300 es
        precision highp float;
        in vec3 v_c;
        in vec2 v_corner;
        in float v_disc;
        out vec4 fragColor;
        void main() {
            if (v_disc > 0.5) {
                float r = length(v_corner);
                if (r > 1.0) discard;
                fragColor = vec4(mix(v_c, vec3(0.0), smoothstep(0.68, 0.97, r)), 1.0);
            } else {
                fragColor = vec4(v_c, 1.0);
            }
        }`;

    const GIZ_PICK_FRAG = `#version 300 es
        precision highp float;
        in vec2 v_corner;
        in float v_disc;
        flat in float v_id;
        out vec4 fragColor;
        void main() {
            if (v_disc > 0.5 && length(v_corner) > 1.0) discard;
            fragColor = vec4(mod(v_id, 256.0) / 255.0, floor(v_id / 256.0) / 255.0, 0.0, 1.0);
        }`;

    const PICK_VERT = `#version 300 es
        in vec3 a_position;
        in float a_faceId;
        uniform mat4 u_mvp;
        flat out float v_id;
        void main() {
            v_id = a_faceId;
            gl_Position = u_mvp * vec4(a_position, 1.0);
        }`;

    const PICK_FRAG = `#version 300 es
        precision highp float;
        flat in float v_id;
        out vec4 fragColor;
        void main() {
            float id = v_id + 1.0;                  // 0 is reserved for "nothing"
            fragColor = vec4(mod(id, 256.0) / 255.0,
                             floor(id / 256.0) / 255.0,
                             0.0, 1.0);
        }`;

    /* ---- small matrix helpers, hand-rolled in engine.js's style ----
       No matrix library: the project is CDN-only for dependencies and this is
       forty lines. Column-major, to match what WebGL wants. */
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function unit3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

    function lookAtM(eye, target, up) {
        const z = unit3(sub(eye, target));
        let x = cross(up || [0, 1, 0], z);
        if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = cross([0, 0, 1], z);   // looking straight down
        x = unit3(x);
        const y = cross(z, x);
        return [x[0], y[0], z[0], 0,
                x[1], y[1], z[1], 0,
                x[2], y[2], z[2], 0,
                -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
    }

    /* `fovDeg` is the HORIZONTAL angle, so the vertical one follows the aspect.
       Stated explicitly because getting this backwards is invisible on a square
       canvas and obvious on a wide one. */
    function perspectiveM(fovDeg, aspect, near, far) {
        const fx = 1 / Math.tan(fovDeg * Math.PI / 360);
        const fy = fx * aspect;
        const nf = 1 / (near - far);
        return [fx, 0, 0, 0,
                0, fy, 0, 0,
                0, 0, (far + near) * nf, -1,
                0, 0, 2 * far * near * nf, 0];
    }

    function mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
            let v = 0;
            for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = v;
        }
        return o;
    }

    function create(canvas, opts) {
        opts = opts || {};
        const gl = canvas.getContext('webgl2', {
            depth: true, antialias: true,
            // captures read the canvas back after the frame has been composited
            preserveDrawingBuffer: true
        });
        if (!gl) throw new Error('WebGL 2.0 is required');

        const state = {
            asset: null, vao: null, indexCount: 0, draw: null,
            posBuf: null, colBuf: null, uvBuf: null, idBuf: null, idxBuf: null,
            atlas: { cols: 4, rows: 4 }, tex: null, baked: null,
            maps: {}, mapTex: {}, dynamic: [], emitters: [], flameFrame: -1, clock: null,
            markers: [], markVao: null, markBuf: null, markIcons: null, overlaysVisible: true,
            gizmo: null, gizVao: null, gizBuf: null,
            nBuf: null, tBuf: null, bBuf: null, selBuf: null, selection: null,
            pickW: 0, pickH: 0,
            assignment: {}, pickFbo: null, pickTex: null, pickDepth: null, pickVao: null,
            // orbit camera: a target, a distance, and two angles
            target: [0, 1, 0], dist: 14, yaw: 0, pitch: 0.55,
            fov: FOV_EDITOR, fovMode: 'horizontal', dirty: true, frames: 0
        };

        /* ---- program ---- */
        function compile(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error('RoomView shader: ' + gl.getShaderInfoLog(s));
            return s;
        }
        function link(vs, fs, attribs) {
            const p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
            attribs.forEach((n, i) => gl.bindAttribLocation(p, i, n));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS))
                throw new Error('RoomView link: ' + gl.getProgramInfoLog(p));
            return p;
        }
        const prog = link(VERT, FRAG,
            ['a_position', 'a_colour', 'a_uv', 'a_normal', 'a_tangent', 'a_bitangent', 'a_sel']);
        const pickProg = link(PICK_VERT, PICK_FRAG, ['a_position', 'a_faceId']);
        const markProg = link(MARK_VERT, MARK_FRAG,
            ['a_position', 'a_corner', 'a_colour', 'a_icon', 'a_sel']);
        const uMarkMVP  = gl.getUniformLocation(markProg, 'u_mvp');
        const uMarkHalf = gl.getUniformLocation(markProg, 'u_half');
        const uMarkTex  = gl.getUniformLocation(markProg, 'u_icons');
        const uMVP = gl.getUniformLocation(prog, 'u_mvp');
        const uAtlas = gl.getUniformLocation(prog, 'u_atlas');
        const U = n => gl.getUniformLocation(prog, n);
        const uMaps = {
            normal: U('u_normal'), ao: U('u_ao'), specular: U('u_specular'),
            roughness: U('u_roughness'), emissive: U('u_emissive')
        };
        const uHas = {
            normal: U('u_hasNormal'), ao: U('u_hasAO'), specular: U('u_hasSpecular'),
            roughness: U('u_hasRoughness'), emissive: U('u_hasEmissive')
        };
        const uLight = {
            count: U('u_lightCount'), pos: U('u_lightPos[0]'), colour: U('u_lightColour[0]'),
            intensity: U('u_lightIntensity[0]'), inR: U('u_lightIn[0]'), outR: U('u_lightOut[0]'),
            spot: U('u_lightSpot[0]'), axis: U('u_lightAxis[0]'),
            cosIn: U('u_lightCosIn[0]'), cosOut: U('u_lightCosOut[0]'),
            anySpot: U('u_anySpot'), cam: U('u_camForward')
        };
        const uPickMVP = gl.getUniformLocation(pickProg, 'u_mvp');
        const gizAttribs = ['a_position', 'a_corner', 'a_colour', 'a_id', 'a_disc'];
        const gizProg  = link(GIZ_VERT, GIZ_FRAG, gizAttribs);
        const gizPick  = link(GIZ_VERT, GIZ_PICK_FRAG, gizAttribs);
        const uGizMVP  = gl.getUniformLocation(gizProg,  'u_mvp');
        const uGizHalf = gl.getUniformLocation(gizProg,  'u_half');
        const uGizPMVP = gl.getUniformLocation(gizPick,  'u_mvp');
        const uGizPHalf= gl.getUniformLocation(gizPick,  'u_half');

        /* A 1x1 white texture, so the shader multiplies by one until a real
           atlas arrives. Branching in the shader instead would mean two code
           paths for the same picture. */
        function makeTexture() {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            return t;
        }
        state.tex = makeTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                      new Uint8Array([255, 255, 255, 255]));

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        /* CW, not CCW. Tomb Editor's export has `Invert Z axis` on by default,
           and mirroring one axis reverses the handedness of the space, which
           reverses every triangle's winding with it. The asset keeps Tomb
           Editor's order faithfully, so this is where the mirror is accounted
           for.

           It is worth knowing how this presented: with CCW the entire FLOOR was
           being culled and the room still looked plausible, because the walls
           and ceiling happened to read as a dark room rather than as a room with
           no floor. The validator now points a camera at a face of each role
           from its own normal side, which is the check that catches it. */
        gl.frontFace(gl.CW);
        gl.clearColor(0.06, 0.06, 0.07, 1);

        /* ---- geometry ----
           The draw mesh has one vertex per face CORNER, not per shared vertex,
           because a vertex shared by faces carrying different tiles needs a
           different UV in each. The bake stays per SHARED vertex, which is what
           Tomb Editor does and what 2.1 was verified against, and `src` scatters
           those colours back out to the corners. */
        function buildBuffers() {
            const asset = state.asset;
            const dm = TRLE.RoomUV.buildDrawMesh(asset, state.assignment, state.atlas);
            state.draw = dm;
            state.indexCount = dm.tris.length;

            const bind = (buf, data, loc, size, type) => {
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, size, type || gl.FLOAT, false, 0, 0);
            };

            state.posBuf = state.posBuf || gl.createBuffer();
            state.colBuf = state.colBuf || gl.createBuffer();
            state.uvBuf  = state.uvBuf  || gl.createBuffer();
            state.idBuf  = state.idBuf  || gl.createBuffer();
            state.idxBuf = state.idxBuf || gl.createBuffer();

            state.vao = state.vao || gl.createVertexArray();
            gl.bindVertexArray(state.vao);
            bind(state.posBuf, dm.positions, 0, 3);
            bind(state.colBuf, colourBuffer(), 1, 3);
            bind(state.uvBuf, dm.uvs, 2, 2);
            state.nBuf = state.nBuf || gl.createBuffer();
            state.tBuf = state.tBuf || gl.createBuffer();
            state.bBuf = state.bBuf || gl.createBuffer();
            bind(state.nBuf, dm.normals, 3, 3);
            bind(state.tBuf, dm.tangents, 4, 3);
            bind(state.bBuf, dm.bitangents, 5, 3);
            state.selBuf = state.selBuf || gl.createBuffer();
            bind(state.selBuf, selectionBuffer(), 6, 1);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.idxBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, dm.tris, gl.STATIC_DRAW);
            gl.bindVertexArray(null);

            // the pick pass needs position and face id only
            state.pickVao = state.pickVao || gl.createVertexArray();
            gl.bindVertexArray(state.pickVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.posBuf);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
            bind(state.idBuf, dm.faceIds, 1, 1);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.idxBuf);
            gl.bindVertexArray(null);

            state.dirty = true;
        }

        /* One float per draw-mesh CORNER, because the draw mesh is per corner
           and a face's corners are contiguous. `faceRange` says where. */
        function selectionBuffer() {
            const dm = state.draw;
            const out = new Float32Array(dm.vertexCount);
            if (state.selection) for (const fi of state.selection) {
                const r = dm.faceRange[fi];
                if (r) for (let i = 0; i < r[1]; i++) out[r[0] + i] = 1;
            }
            return out;
        }

        function colourBuffer() {
            const dm = state.draw;
            if (state.baked) return TRLE.RoomUV.expandColours(state.baked, dm.src);
            const amb = (state.asset.ambient || [32, 32, 32]).map(c => c / 255);
            const col = new Float32Array(dm.vertexCount * 3);
            for (let i = 0; i < dm.vertexCount; i++) {
                col[i * 3] = amb[0]; col[i * 3 + 1] = amb[1]; col[i * 3 + 2] = amb[2];
            }
            return col;
        }

        function upload(asset) {
            state.asset = asset;
            buildBuffers();
            const s = Math.max(asset.sectors[0], asset.sectors[1]);
            state.target = [0, asset.ceiling / 2, 0];
            state.dist = s * 1.1;
            state.dirty = true;
        }

        /* Six vertices per marker, expanded from the light's world position.
           Rebuilt each draw because the list is short and a light moves. */
        const QUAD = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        /* Big enough to identify at a glance, small enough not to cover the
           surface it sits on. One place, because the validator needs the same
           number to put a marker's centre just off the edge of the frame. */
        function markSize() { return Math.max(22, canvas.width / 34); }
        function drawMarkers(mvp) {
            if (!state.overlaysVisible || !state.markers.length) return;
            const e = eye();
            /* Back to front. The depth test is off so a bulb inside a wall stays
               findable, which means nothing else decides the order where two
               sprites overlap. */
            const list = state.markers.slice().sort((a, b) =>
                (b.position[0] - e[0]) ** 2 + (b.position[1] - e[1]) ** 2 + (b.position[2] - e[2]) ** 2 -
                ((a.position[0] - e[0]) ** 2 + (a.position[1] - e[1]) ** 2 + (a.position[2] - e[2]) ** 2));

            const n = list.length, stride = 10;      // pos3 corner2 colour3 icon1 sel1
            const data = new Float32Array(n * 6 * stride);
            let o = 0;
            for (const m of list) {
                const icon = typeof m.icon === 'number' ? m.icon
                           : (ICONS[m.icon] != null ? ICONS[m.icon] : ICONS.point);
                const col = m.colour || [1, 1, 1];
                for (const q of QUAD) {
                    data[o++] = m.position[0]; data[o++] = m.position[1]; data[o++] = m.position[2];
                    data[o++] = q[0]; data[o++] = q[1];
                    data[o++] = col[0]; data[o++] = col[1]; data[o++] = col[2];
                    data[o++] = icon;
                    data[o++] = m.selected ? 1 : 0;
                }
            }

            if (!state.markIcons) {
                state.markIcons = makeTexture();
                gl.bindTexture(gl.TEXTURE_2D, state.markIcons);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildIconSheet());
            }
            state.markVao = state.markVao || gl.createVertexArray();
            state.markBuf = state.markBuf || gl.createBuffer();
            gl.bindVertexArray(state.markVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.markBuf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            const F = 4;
            const attr = (loc, size, off) => {
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * F, off * F);
            };
            attr(0, 3, 0); attr(1, 2, 3); attr(2, 3, 5); attr(3, 1, 8); attr(4, 1, 9);

            gl.useProgram(markProg);
            gl.uniformMatrix4fv(uMarkMVP, false, mvp);
            const px = markSize();
            gl.uniform2f(uMarkHalf, px / canvas.width, px / canvas.height);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.markIcons);
            gl.uniform1i(uMarkTex, 0);

            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);        // the quad's winding follows the camera
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, n * 6);
            gl.disable(gl.BLEND);
            gl.enable(gl.CULL_FACE);
            gl.enable(gl.DEPTH_TEST);
            gl.bindVertexArray(null);
        }

        /* Gizmo geometry, rebuilt each draw. Everything is sized in PIXELS and
           converted to world units at the gizmo's own depth, so it stays the
           same size on screen however far away the light is. */
        const GIZ_SHAFT_PX = 62, GIZ_DIR_PX = 92, GIZ_DISC_PX = 15;
        const GIZ_AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const GIZ_COLS = [[1, 0.35, 0.35], [0.45, 1, 0.45], [0.45, 0.65, 1], [1, 0.88, 0.35]];

        function gizmoScale() {
            const g = state.gizmo;
            if (!g) return 0;
            const e = eye();
            const d = Math.hypot(g.position[0] - e[0], g.position[1] - e[1], g.position[2] - e[2]);
            const fovH = state.fovMode === 'vertical'
                ? 2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * (canvas.width / canvas.height))
                : state.fov * Math.PI / 180;
            return 2 * d * Math.tan(fovH / 2) / Math.max(1, canvas.width);   // world units per pixel
        }

        /* Where each handle sits in the world. The page needs this too, to turn
           a pointer delta into a world delta along the axis. */
        function gizmoPoints() {
            const g = state.gizmo;
            if (!g) return null;
            const k = gizmoScale(), P = g.position;
            const out = { scale: k, tips: {} };
            GIZ_AXES.forEach((a, i) => {
                out.tips[GIZ_HANDLES[i]] = [P[0] + a[0] * GIZ_SHAFT_PX * k,
                                            P[1] + a[1] * GIZ_SHAFT_PX * k,
                                            P[2] + a[2] * GIZ_SHAFT_PX * k];
            });
            if (g.dir) out.tips.dir = [P[0] + g.dir[0] * GIZ_DIR_PX * k,
                                       P[1] + g.dir[1] * GIZ_DIR_PX * k,
                                       P[2] + g.dir[2] * GIZ_DIR_PX * k];
            return out;
        }

        /* One buffer: the handle discs as triangles first, then the shafts as
           lines, so two draw calls share one upload. */
        function gizmoBuffer() {
            const g = state.gizmo, pts = gizmoPoints();
            if (!pts) return null;
            const names = g.dir ? GIZ_HANDLES : GIZ_HANDLES.slice(0, 3);
            const stride = 10, data = [];
            const push = (p, c, col, id, disc) => data.push(
                p[0], p[1], p[2], c[0], c[1], col[0], col[1], col[2], id, disc);
            names.forEach((n, i) => {
                const p = pts.tips[n], col = GIZ_COLS[i], id = GIZ_BASE + 1 + i;
                for (const q of QUAD) push(p, q, col, id, 1);
            });
            const lineStart = data.length / stride;
            names.forEach((n, i) => {
                push(g.position, [0, 0], GIZ_COLS[i], 0, 0);
                push(pts.tips[n], [0, 0], GIZ_COLS[i], 0, 0);
            });
            return { data: new Float32Array(data), discVerts: names.length * 6,
                     lineStart, lineVerts: names.length * 2, stride };
        }

        function bindGizmo(b) {
            state.gizVao = state.gizVao || gl.createVertexArray();
            state.gizBuf = state.gizBuf || gl.createBuffer();
            gl.bindVertexArray(state.gizVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.gizBuf);
            gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.DYNAMIC_DRAW);
            const F = 4, st = b.stride * F;
            const attr = (loc, size, off) => {
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * F);
            };
            attr(0, 3, 0); attr(1, 2, 3); attr(2, 3, 5); attr(3, 1, 8); attr(4, 1, 9);
        }

        function drawGizmo(mvp, forPick) {
            /* One switch for both, because a marker and a gizmo are the same
               kind of thing: editor chrome the game does not draw, in a picture
               meant to be read beside the game. The PICK pass is exempt -- it
               never reaches the screen, and a hidden gizmo that could still be
               grabbed would be a worse bug than the one this prevents. */
            if (!forPick && !state.overlaysVisible) return;
            const b = gizmoBuffer();
            if (!b) return;
            bindGizmo(b);
            const prog = forPick ? gizPick : gizProg;
            gl.useProgram(prog);
            gl.uniformMatrix4fv(forPick ? uGizPMVP : uGizMVP, false, mvp);
            const half = GIZ_DISC_PX / 2;
            gl.uniform2f(forPick ? uGizPHalf : uGizHalf,
                         half / canvas.width, half / canvas.height);
            /* Depth off, so a bulb inside a wall can still be grabbed. That is
               the same decision the sprites make, and the two must agree or the
               handle would be reachable exactly where the sprite is not. */
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.drawArrays(gl.TRIANGLES, 0, b.discVerts);
            if (!forPick) gl.drawArrays(gl.LINES, b.lineStart, b.lineVerts);
            gl.enable(gl.CULL_FACE);
            gl.enable(gl.DEPTH_TEST);
            gl.bindVertexArray(null);
        }

        /* The view ray through a canvas pixel, in world space.

           Uses the same horizontal-or-vertical reading of the field of view the
           frame was drawn with. pickPoint built its ray assuming HORIZONTAL
           unconditionally, so in vertical mode its ray disagreed with its own
           picture. Latent, because nothing but 2.10's probe ever set vertical,
           and fixed here because the direction handle drags against this ray. */
        function rayThrough(px, py) {
            const w = canvas.width, h = canvas.height, aspect = w / h;
            const e = eye();
            const fwd = unit3(sub(state.target, e));
            const right = unit3(cross(fwd, [0, 1, 0]));
            const up = cross(right, fwd);
            const tanH = state.fovMode === 'vertical'
                ? Math.tan(state.fov * Math.PI / 360) * aspect
                : Math.tan(state.fov * Math.PI / 360);
            const sx = (px / w * 2 - 1) * tanH;
            const sy = (1 - py / h * 2) * tanH / aspect;
            return { origin: e, dir: unit3([fwd[0] + right[0] * sx + up[0] * sy,
                                            fwd[1] + right[1] * sx + up[1] * sy,
                                            fwd[2] + right[2] * sx + up[2] * sy]) };
        }

        /* One render of the pick pass, then ONE readback of a rectangle.

           Everything that needs face ids goes through here: a single pixel, a
           swept segment, or a box selection. Reading a region once beats
           picking per pixel by orders of magnitude, and it is what makes
           drag-painting and box-select affordable at all.

           The pick target used to be reallocated on every call -- a texImage2D
           and a renderbufferStorage per pick. Harmless once per click and
           wasteful sixty times a second, so it is now allocated on resize. */
        function pickRegion(x0, y0, x1, y1) {
            if (!state.asset) return null;
            const w = canvas.width, h = canvas.height;
            if (!state.pickFbo) {
                state.pickFbo = gl.createFramebuffer();
                state.pickTex = gl.createTexture();
                state.pickDepth = gl.createRenderbuffer();
            }
            if (state.pickW !== w || state.pickH !== h) {
                gl.bindTexture(gl.TEXTURE_2D, state.pickTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.bindRenderbuffer(gl.RENDERBUFFER, state.pickDepth);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
                state.pickW = w; state.pickH = h;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.pickFbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.pickTex, 0);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, state.pickDepth);

            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.useProgram(pickProg);
            const pa = w / h;
            const pFov = state.fovMode === 'vertical'
                ? 2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * pa) * 180 / Math.PI
                : state.fov;
            const mvp = mul(perspectiveM(pFov, pa, 0.05, 200), lookAtM(eye(), state.target, [0, 1, 0]));
            gl.uniformMatrix4fv(uPickMVP, false, mvp);
            gl.bindVertexArray(state.pickVao);
            gl.drawElements(gl.TRIANGLES, state.indexCount, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
            /* The handles go in AFTER the faces with the depth test off, so a
               handle simply overwrites whatever face is behind it. Precedence
               costs nothing and cannot drift out of step with what is drawn. */
            drawGizmo(mvp, true);

            const bx = Math.max(0, Math.min(x0, x1)), by = Math.max(0, Math.min(y0, y1));
            const ex = Math.min(w - 1, Math.max(x0, x1)), ey = Math.min(h - 1, Math.max(y0, y1));
            const bw = ex - bx + 1, bh = ey - by + 1;
            if (bw <= 0 || bh <= 0) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
            const data = new Uint8Array(bw * bh * 4);
            // readPixels counts rows from the BOTTOM, the canvas from the top
            gl.readPixels(bx, h - ey - 1, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, data);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.clearColor(0.06, 0.06, 0.07, 1);
            state.dirty = true;
            return {
                x: bx, y: by, w: bw, h: bh,
                at(px, py) {
                    const cx = px - bx, cy = py - by;
                    if (cx < 0 || cy < 0 || cx >= bw || cy >= bh) return 0;
                    const i = ((bh - 1 - cy) * bw + cx) * 4;
                    return data[i] + data[i + 1] * 256;
                }
            };
        }

        function pickRaw(px, py) {
            const r = pickRegion(px, py, px, py);
            return r ? r.at(px, py) : 0;
        }

        function eye() {
            const cp = Math.cos(state.pitch);
            return [state.target[0] + Math.sin(state.yaw) * cp * state.dist,
                    state.target[1] + Math.sin(state.pitch) * state.dist,
                    state.target[2] + Math.cos(state.yaw) * cp * state.dist];
        }

        function render() {
            const w = canvas.width, h = canvas.height;
            gl.viewport(0, 0, w, h);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            if (!state.vao) return;
            const view = lookAtM(eye(), state.target, [0, 1, 0]);
            /* TombEngine's field of view is stated HORIZONTALLY, as Tomb Raider
               always has, but that is a convention rather than something the
               debug overlay confirms -- so the vertical reading is expressible
               and 2.10 settles it against a capture. At the in-game shots' 1.86
               aspect the two differ enormously: 90 horizontal is 56.4 vertical,
               90 vertical is 123.6 horizontal. */
            const aspect = w / h;
            const proj = state.fovMode === 'vertical'
                ? perspectiveM(2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * aspect) * 180 / Math.PI, aspect, 0.05, 200)
                : perspectiveM(state.fov, aspect, 0.05, 200);
            gl.useProgram(prog);
            gl.uniformMatrix4fv(uMVP, false, mul(proj, view));
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.tex);
            gl.uniform1i(uAtlas, 0);

            /* Every sampler gets a real unit whether or not the map exists.
               Leaving one unbound makes it read unit 0, which silently feeds the
               DIFFUSE page into the normal map slot. */
            let unit = 1;
            for (const k of ['normal', 'ao', 'specular', 'roughness', 'emissive']) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, state.mapTex[k] || state.tex);
                gl.uniform1i(uMaps[k], unit);
                gl.uniform1f(uHas[k], state.mapTex[k] ? 1 : 0);
                unit++;
            }

            const n = Math.min(state.dynamic.length, MAX_LIGHTS);
            gl.uniform1i(uLight.count, n);
            if (n) {
                const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
                const ints = new Float32Array(n), ins = new Float32Array(n), outs = new Float32Array(n);
                const isSpot = new Float32Array(n), axis = new Float32Array(n * 3);
                const cosIn = new Float32Array(n), cosOut = new Float32Array(n);
                let anySpot = 0;
                for (let i = 0; i < n; i++) {
                    const L = state.dynamic[i];
                    if (L.type === 'spot') {
                        anySpot = 1; isSpot[i] = 1;
                        const l = TRLE.RoomLight.lightDir(L);
                        axis.set([-l[0], -l[1], -l[2]], i * 3);
                        const ia = L.innerAngle != null ? L.innerAngle : TRLE.RoomLight.DEFAULT_INNER_ANGLE;
                        const oa = L.outerAngle != null ? L.outerAngle : TRLE.RoomLight.DEFAULT_OUTER_ANGLE;
                        cosIn[i] = Math.cos(ia * Math.PI / 180);
                        cosOut[i] = Math.cos(oa * Math.PI / 180);
                    } else { axis.set([0, -1, 0], i * 3); cosIn[i] = 1; cosOut[i] = 0; }
                    pos.set(L.position, i * 3);
                    /* `rgb` is already linear and may exceed 1, which is how a
                       flame arrives: TombEngine divides its colour bytes by
                       CHAR_MAX (127), so a flame's red lands near 2.0 on
                       purpose. `colour` is the 0..255 form a placed bulb uses. */
                    col.set(L.rgb ? L.rgb : [L.colour[0] / 255, L.colour[1] / 255, L.colour[2] / 255], i * 3);
                    ints[i] = L.intensity;
                    ins[i] = L.innerRange != null ? L.innerRange : 1;
                    outs[i] = L.outerRange != null ? L.outerRange : 5;
                }
                gl.uniform3fv(uLight.pos, pos);
                gl.uniform3fv(uLight.colour, col);
                gl.uniform1fv(uLight.intensity, ints);
                gl.uniform1fv(uLight.inR, ins);
                gl.uniform1fv(uLight.outR, outs);
                gl.uniform1fv(uLight.spot, isSpot);
                gl.uniform3fv(uLight.axis, axis);
                gl.uniform1fv(uLight.cosIn, cosIn);
                gl.uniform1fv(uLight.cosOut, cosOut);
                gl.uniform1f(uLight.anySpot, anySpot);
            } else {
                gl.uniform1f(uLight.anySpot, 0);
            }
            const e = eye();
            const fwd = unit3([state.target[0] - e[0], state.target[1] - e[1], state.target[2] - e[2]]);
            gl.uniform3fv(uLight.cam, fwd);

            gl.bindVertexArray(state.vao);
            gl.drawElements(gl.TRIANGLES, state.indexCount, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
            drawMarkers(mul(proj, view));
            drawGizmo(mul(proj, view), false);
            state.frames++;
        }

        /* Only draws when something changed. A room view that spins the GPU at
           60fps on a static picture is exactly the kind of cost PERFORMANCE.md
           exists to keep out. */
        /* Emitters advance on a 30 Hz FRAME COUNTER, not on the render clock, so
           the flicker looks the same on a 60 Hz and a 144 Hz display -- Tomb
           Raider's logic has always run at 30. The redraw is driven by the
           counter changing rather than every animation frame, so an emitter
           costs about 30 draws a second and a still room costs none. */
        function tickEmitters() {
            if (!state.emitters.length) return false;
            const now = (state.clock != null) ? state.clock : performance.now();
            const f = TRLE.RoomLight.flameFrame(now);
            if (f === state.flameFrame) return false;
            state.flameFrame = f;
            state.dynamic = state.emitters
                .filter(e => e.enabled !== false)
                .map(e => TRLE.RoomLight.flameLight(e, f));
            /* A marker tagged with an emitter index follows it. The page sets
               the marker list and is not in this 30 Hz loop, so a travelling
               emitter would otherwise leave its own sprite behind. */
            for (const m of state.markers)
                if (m.emitter != null && state.emitters[m.emitter])
                    m.position = TRLE.RoomLight.emitterPosition(state.emitters[m.emitter], f);
            return true;
        }

        let raf = 0;
        function loop() {
            raf = requestAnimationFrame(loop);
            if (tickEmitters()) state.dirty = true;
            if (!state.dirty) return;
            state.dirty = false;
            render();
        }
        raf = requestAnimationFrame(loop);

        /* ---- Tomb Editor's camera controls ---- */
        let drag = null;
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 1 && e.button !== 2) return;   // middle pans, right orbits
            drag = { mode: e.button === 2 ? 'orbit' : 'pan', x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            if (drag.mode === 'orbit') {
                state.yaw -= dx * 0.008;
                state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.008));
            } else {
                // pan in the camera's own plane, scaled by distance so the room
                // moves with the pointer at any zoom
                const e0 = eye();
                const fwd = unit3(sub(state.target, e0));
                const right = unit3(cross(fwd, [0, 1, 0]));
                const up = cross(right, fwd);
                const k = state.dist * 0.0015;
                for (let i = 0; i < 3; i++)
                    state.target[i] += (-right[i] * dx + up[i] * dy) * k;
            }
            state.dirty = true;
        });
        const endDrag = () => { drag = null; };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', e => {
            state.dist = Math.max(0.5, Math.min(80, state.dist * (1 + Math.sign(e.deltaY) * 0.1)));
            state.dirty = true;
            e.preventDefault();
        }, { passive: false });

        return {
            gl: () => gl,
            asset: () => state.asset,
            /* The mesh shape TRLE.RoomLight wants, expanded from the palette. */
            mesh() {
                const a = state.asset;
                if (!a) return null;
                const positions = [];
                for (let i = 0; i < a.vertexCount; i++)
                    positions.push([a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]]);
                return { positions, faces: a.faces.map(f => ({ v: f.v, n: a.normals[f.ni] })) };
            },
            async load(url) {
                const asset = typeof url === 'string' ? await (await fetch(url)).json() : url;
                upload(asset);
                return asset;
            },
            /* Float32Array, three per SHARED vertex, straight out of
               RoomLight.bake. Expanded here to the draw mesh's corners. */
            setVertexColours(colours) {
                if (!state.colBuf || !state.draw) return false;
                state.baked = colours;
                gl.bindBuffer(gl.ARRAY_BUFFER, state.colBuf);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, colourBuffer());
                state.dirty = true;
                return true;
            },

            /* The atlas page, plus its tile grid. Uploaded UNFLIPPED: RoomUV's
               intoAtlas already reconciles the page's top-down row order with
               the within-tile v that runs up, so flipping here as well would
               invert the row index and quietly render the wrong tile. */
            setAtlas(source, grid) {
                if (grid) state.atlas = { cols: grid.cols, rows: grid.rows };
                gl.bindTexture(gl.TEXTURE_2D, state.tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
                if (grid && state.asset) buildBuffers();
                state.dirty = true;
            },
            atlas: () => Object.assign({}, state.atlas),

            /* The five material maps, on the same tile grid as the diffuse page.
               Pass null for one to switch it off. They are the tool's own
               exported sheets — the Room View generates nothing. */
            setMaps(maps) {
                for (const k of ['normal', 'ao', 'specular', 'roughness', 'emissive']) {
                    const src = maps && maps[k];
                    if (!src) {
                        if (state.mapTex[k]) { gl.deleteTexture(state.mapTex[k]); state.mapTex[k] = null; }
                        continue;
                    }
                    state.mapTex[k] = state.mapTex[k] || makeTexture();
                    gl.bindTexture(gl.TEXTURE_2D, state.mapTex[k]);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
                }
                state.maps = maps || {};
                state.dirty = true;
            },
            maps: () => Object.keys(state.mapTex).filter(k => state.mapTex[k]),

            /* Lights that light at RUNTIME. These are NOT the level's placed
               bulbs.

               TombEngine's CollectLightsForRoom walks `_dynamicLights` and
               nothing else, so the runtime light array a room is drawn with
               contains only lights spawned while the game runs: flame emitters,
               gunfire, flares, explosions. A bulb placed in Tomb Editor reaches
               room geometry exactly once, through the vertex colours baked at
               compile time, and never appears here.

               (A light's Static and Dynamic checkboxes in Tomb Editor are about
               which OBJECT classes it affects, static meshes versus moveables.
               They say nothing about room geometry and this module ignores them.)

               The consequence for the preview is the useful part: moving a
               placed bulb means re-baking, because there is no runtime path for
               it to take. That is what 2.2's measured costs are for. */
            setDynamicLights(lights) {
                state.dynamic = (lights || []).filter(L => L && L.enabled !== false);
                state.dirty = true;
            },
            dynamicLights: () => state.dynamic.slice(),

            /* Flame emitters. Each is { position, seed, jet, enabled } and
               produces one dynamic light per 30 Hz frame. Passing an empty list
               puts the renderer back exactly where it was: the emitter path
               writes nothing else and touches no baked state. */
            setEmitters(list) {
                state.emitters = list || [];
                if (!state.emitters.length) { state.dynamic = []; state.flameFrame = -1; }
                state.dirty = true;
            },
            emitters: () => state.emitters.slice(),
            /* Test hook: pin the emitter clock so a validator can step frames
               instead of racing wall time. Null returns it to the real clock. */
            setClock(ms) { state.clock = ms; state.dirty = true; },
            stepEmitters() { const changed = tickEmitters(); if (changed) render(); return changed; },

            /* faceIndex -> { tile, rot, flip }. Only the UVs move, so this does
               not touch positions or the bake. */
            setAssignment(map) {
                state.assignment = map || {};
                if (state.asset) {
                    const dm = TRLE.RoomUV.buildDrawMesh(state.asset, state.assignment, state.atlas);
                    state.draw.uvs = dm.uvs;
                    gl.bindBuffer(gl.ARRAY_BUFFER, state.uvBuf);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dm.uvs);
                    state.dirty = true;
                }
            },
            assignment: () => state.assignment,

            /* Light markers, [{ position, colour, icon, selected }]. `icon` is one
               of 'sun' | 'point' | 'spot' | 'flame'. Drawn on top of the room. */
            setMarkers(list) { state.markers = list || []; state.dirty = true; },
            markers: () => state.markers.slice(),
            /* Editor chrome: the light sprites AND the gizmo. Off for any
               capture meant to be read beside the game, which draws neither.
               The fidelity references carried two marker rings until 2.14, and
               2.15 would have put the gizmo in them the same way. */
            setOverlaysVisible(v) { state.overlaysVisible = v !== false; state.dirty = true; },
            overlaysVisible: () => state.overlaysVisible,
            iconSheet: buildIconSheet,
            markerPixelSize: markSize,
            ICONS,

            /* A world point in canvas pixels, through the same matrices the
               frame was drawn with. Null when the point is behind the camera.

               2.15's gizmo needs this for its drag arithmetic. 2.14 uses it to
               put a marker's CENTRE just outside the frame, which is precisely
               the case a gl.POINTS sprite gets wrong: a point is clipped by its
               centre, so it vanishes while half of it is still on screen. */
            project(p) {
                const w = canvas.width, h = canvas.height, aspect = w / h;
                const fov = state.fovMode === 'vertical'
                    ? 2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * aspect) * 180 / Math.PI
                    : state.fov;
                const m = mul(perspectiveM(fov, aspect, 0.05, 200),
                              lookAtM(eye(), state.target, [0, 1, 0]));
                const cx = m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12];
                const cy = m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13];
                const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
                if (cw <= 1e-6) return null;
                return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
            },

            /* Where in the room a canvas pixel is, not just which face.
               The id buffer gives the face; intersecting the view ray with that
               face's own plane gives the point on it. Exact, and it needs no
               depth readback -- which would otherwise mean either a float depth
               attachment or unprojecting a quantised 16-bit value. */
            pickPoint(px, py) {
                const fi = this.pick(px, py);
                if (fi < 0) return null;
                const a = state.asset, f = a.faces[fi], n = a.normals[f.ni];
                const p0 = [a.positions[f.v[0] * 3], a.positions[f.v[0] * 3 + 1], a.positions[f.v[0] * 3 + 2]];
                const { origin: e, dir } = rayThrough(px, py);
                const denom = dot(n, dir);
                if (Math.abs(denom) < 1e-6) return { face: fi, point: null };
                const t = dot(n, sub(p0, e)) / denom;
                if (t <= 0) return { face: fi, point: null };
                return { face: fi, point: [e[0] + dir[0] * t, e[1] + dir[1] * t, e[2] + dir[2] * t] };
            },
            drawMesh: () => state.draw,

            /* Which face is under this canvas pixel, or -1.
               A gizmo handle over the pixel also gives -1: the handle wins, so
               a click that grabs a handle must not also paint the face behind
               it. That precedence is the DRAW ORDER of the pick pass rather
               than a rule written twice. */
            pick(px, py) {
                const id = pickRaw(px, py);
                return (id === 0 || id >= GIZ_BASE) ? -1 : id - 1;
            },

            /* Face and handle in one readback.
               Precedence, decided once here and extended by 2.20: gizmo handle,
               then light sprite (which the page tests in screen space), then
               face. */
            pickAt(px, py) {
                const id = pickRaw(px, py);
                if (id >= GIZ_BASE) return { face: -1, handle: GIZ_HANDLES[id - GIZ_BASE - 1] || null };
                return { face: id === 0 ? -1 : id - 1, handle: null };
            },

            /* The view ray through a canvas pixel. The direction handle drags
               against a sphere, and 2.20 will want this too. */
            rayFrom(px, py) { return rayThrough(px, py); },

            /* Every face the pointer swept between two positions, in order.
               ONE pick render and ONE readback of the segment's bounding box,
               then samples along the line inside that buffer.

               Sampling matters: a drag delivers one position per frame, and at
               60 Hz a quick sweep can cross several faces between two of them.
               Painting only the face under the latest position would leave
               gaps, which reads as a brush that stutters. */
            pickSegment(x0, y0, x1, y1) {
                const r = pickRegion(x0, y0, x1, y1);
                if (!r) return [];
                const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
                const out = [], seen = new Set();
                for (let i = 0; i <= n; i++) {
                    const t = i / n;
                    const id = r.at(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
                    if (id === 0 || id >= GIZ_BASE) continue;
                    if (seen.has(id)) continue;
                    seen.add(id); out.push(id - 1);
                }
                return out;
            },

            /* Every face inside a screen rectangle. One readback of the whole
               box, which is exact and is the reason a marquee is cheaper than
               a click: no ray, no tolerance, and nothing to tune. */
            pickBox(x0, y0, x1, y1) {
                const r = pickRegion(x0, y0, x1, y1);
                if (!r) return [];
                const seen = new Set();
                for (let py = r.y; py < r.y + r.h; py++)
                    for (let px = r.x; px < r.x + r.w; px++) {
                        const id = r.at(px, py);
                        if (id !== 0 && id < GIZ_BASE) seen.add(id - 1);
                    }
                return [...seen];
            },

            /* Which faces are highlighted. A Set, a list, or null for none. */
            setSelection(faces) {
                state.selection = faces ? new Set(faces) : null;
                if (state.draw && state.selBuf) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, state.selBuf);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, selectionBuffer());
                }
                state.dirty = true;
            },
            selection: () => state.selection ? [...state.selection] : [],

            /* The gizmo, or null. `dir` is the unit vector the light points
               along, and only a sun or a spot has one. */
            setGizmo(g) { state.gizmo = g || null; state.dirty = true; },
            gizmo: () => state.gizmo,
            gizmoPoints,

            /* Put the camera exactly where something else says it was — the
               in-game captures give a position and a look-at, and reproducing
               them is what subphase 2.10 compares against. */
            lookAt(position, target) {
                state.target = target.slice();
                const d = sub(position, target);
                state.dist = Math.hypot(d[0], d[1], d[2]);
                state.pitch = Math.asin(d[1] / (state.dist || 1));
                state.yaw = Math.atan2(d[0], d[2]);
                state.dirty = true;
            },
            camera: () => ({ position: eye(), target: state.target.slice(),
                             dist: state.dist, yaw: state.yaw, pitch: state.pitch, fov: state.fov }),
            setFov(deg, mode) {
                state.fov = deg;
                if (mode) state.fovMode = mode;
                state.dirty = true;
            },
            fovMode: () => state.fovMode,
            fovPresets: () => ({ editor: FOV_EDITOR, game: FOV_GAME }),
            resize(w, h) {
                canvas.width = w; canvas.height = h; state.dirty = true;
            },
            /* Force a synchronous draw. Validators need the frame to exist
               before they read the canvas; rAF alone races them. */
            renderNow() { state.dirty = false; render(); },
            frames: () => state.frames,
            dispose() {
                cancelAnimationFrame(raf);
                if (state.vao) gl.deleteVertexArray(state.vao);
                [state.posBuf, state.colBuf, state.idxBuf].forEach(b => b && gl.deleteBuffer(b));
                gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
            }
        };
    }

    return { create, FOV_EDITOR, FOV_GAME };
})();
