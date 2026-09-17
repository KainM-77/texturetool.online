/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). Independent WebGL 2.0 code — no Materialize code is used here;
   the multi-pass design was merely informed by Materialize's Graphics.Blit
   pipeline. The whole tool is MIT as of 2026-09-13. See THIRD-PARTY-NOTICES.md. */
/* ============================================================
   TRLE Texture Tools — WebGL 2.0 Processing Engine
   GPU-accelerated texture processing via fragment shaders.
   Replaces Unity's Graphics.Blit() with FBO + fullscreen quad.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.Engine = (function() {
    'use strict';

    let gl = null;
    let programs = {};
    let quadVAO = null;
    let quadVBO = null;
    const textures = {};
    const fbos = {};

    /* ---- Initialization ---- */
    function init(canvas) {
        gl = canvas.getContext('webgl2', {
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            antialias: false
        });
        if (!gl) {
            console.error('WebGL 2.0 not supported');
            return false;
        }
        // Check for float texture support
        const ext1 = gl.getExtension('EXT_color_buffer_float');
        const ext2 = gl.getExtension('OES_texture_float_linear');
        if (!ext1) console.warn('EXT_color_buffer_float not available, falling back to UNSIGNED_BYTE');

        _createQuad();
        _compileAllShaders();
        return true;
    }

    /* ---- Create fullscreen quad geometry ---- */
    function _createQuad() {
        const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
        quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

        quadVAO = gl.createVertexArray();
        gl.bindVertexArray(quadVAO);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    /* ---- Shader compilation ---- */
    function _compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            console.error('Source:', source.split('\n').map((l,i) => `${i+1}: ${l}`).join('\n'));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function _linkProgram(vertSrc, fragSrc) {
        const vs = _compileShader(gl.VERTEX_SHADER, vertSrc);
        const fs = _compileShader(gl.FRAGMENT_SHADER, fragSrc);
        if (!vs || !fs) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'a_position');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog);
            return null;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return prog;
    }

    function _compileAllShaders() {
        const vert = TRLE.Shaders.vertex;
        const shaderNames = Object.keys(TRLE.Shaders).filter(k => k !== 'vertex');
        for (const name of shaderNames) {
            /* A shader is normally a fragment source drawn over the shared
               fullscreen quad. `{vert, frag}` is the escape hatch for one that
               needs its own vertex stage -- pomPreview3D has to transform the quad
               and hand the fragment stage a per-vertex view vector. */
            const src = TRLE.Shaders[name];
            const prog = (src && typeof src === 'object')
                ? _linkProgram(src.vert, src.frag)
                : _linkProgram(vert, src);
            if (prog) {
                programs[name] = prog;
            } else {
                console.error(`Failed to compile shader: ${name}`);
            }
        }
    }

    /* ---- Texture Management ---- */
    function createTexture(width, height, data, options = {}) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);

        const wrap = options.wrap !== undefined ? options.wrap : gl.REPEAT;
        const filter = options.filter || gl.LINEAR;
        const internalFormat = options.float ? gl.RGBA16F : gl.RGBA8;
        const format = gl.RGBA;
        const type = options.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

        if (data instanceof HTMLImageElement || data instanceof HTMLCanvasElement || data instanceof ImageBitmap) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, format, type, data);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        } else if (data) {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
        }

        tex._width = width;
        tex._height = height;
        return tex;
    }

    function createTextureFromImage(img, options = {}) {
        return createTexture(img.width || img.naturalWidth, img.height || img.naturalHeight, img, options);
    }

    function deleteTexture(tex) {
        if (tex) gl.deleteTexture(tex);
    }

    /* ---- Framebuffer Management ---- */
    function createFBO(width, height, options = {}) {
        const fbo = gl.createFramebuffer();
        const tex = createTexture(width, height, null, { float: options.float, wrap: gl.REPEAT });

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn('Framebuffer not complete:', status, '— falling back to RGBA8');
            // Fallback to RGBA8
            gl.deleteTexture(tex);
            const texFallback = createTexture(width, height, null, { float: false, wrap: gl.REPEAT });
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texFallback, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { fbo, texture: texFallback, width, height };
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, texture: tex, width, height };
    }

    function deleteFBO(fboObj) {
        if (!fboObj) return;
        if (fboObj.texture) gl.deleteTexture(fboObj.texture);
        if (fboObj.fbo) gl.deleteFramebuffer(fboObj.fbo);
    }

    /* ---- Blit (core operation — replaces Unity Graphics.Blit) ---- */
    function blit(shaderName, uniforms, target, width, height) {
        const prog = programs[shaderName];
        if (!prog) { console.error('Unknown shader:', shaderName); return; }

        if (target) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo || target);
            gl.viewport(0, 0, width || target.width, height || target.height);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        }

        gl.useProgram(prog);

        // Set uniforms
        let texUnit = 0;
        for (const [name, value] of Object.entries(uniforms)) {
            const loc = gl.getUniformLocation(prog, name);
            if (loc === null) continue;

            if (value instanceof WebGLTexture) {
                gl.activeTexture(gl.TEXTURE0 + texUnit);
                gl.bindTexture(gl.TEXTURE_2D, value);
                gl.uniform1i(loc, texUnit);
                texUnit++;
            } else if (typeof value === 'number') {
                gl.uniform1f(loc, value);
            } else if (Array.isArray(value) || value instanceof Float32Array) {
                if (value.length === 2) gl.uniform2fv(loc, value);
                else if (value.length === 3) gl.uniform3fv(loc, value);
                else if (value.length === 4) gl.uniform4fv(loc, value);
                else if (value.length === 16) gl.uniformMatrix4fv(loc, false, value);
            }
        }

        // Draw fullscreen quad
        gl.bindVertexArray(quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    /* ---- Read pixels back from a framebuffer ---- */
    function readPixels(fboObj) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboObj.fbo);
        const pixels = new Uint8Array(fboObj.width * fboObj.height * 4);
        gl.readPixels(0, 0, fboObj.width, fboObj.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return pixels;
    }

    /* ---- Height-map geometry, from TombEngine's own parallax shader ----
       POM marches the UV by POM_HEIGHT_SCALE (0.0035) over the ATLAS PAGE, divided
       by the view's tangent-space Z which is clamped at POM_MIN_ANGLE (0.4)
       -- Materials.hlsli:17-23, 143-150. Over a 4096 page (the minimum; Tomb Editor
       takes the level's larger setting when set) that is 14.3px at a 45 degree view
       and 35.8px at the grazing limit, against 8px of edge bleed.

       The reach is an ABSOLUTE distance in page pixels, so the fraction of a TILE
       that has to fade to white grows as the tile shrinks: 3.5% at 1024, 14% at 256,
       and more than half a 64px tile -- which is why parallax does not survive on
       small textures at all. See HEIGHT-MAP-AUDIT.md. */
    const POM_REACH_PX = 0.0035 * 4096 / 0.4;      // 35.84
    function heightEdgeBandFor(tileSize) {
        return Math.max(0.03, Math.min(0.30, POM_REACH_PX / Math.max(1, tileSize)));
    }

    /* ---- Joint-aware band widths (the "bricks" edge profile) ----
       A uniform white border slices whatever it lands on, which on a laid-brick or
       cobble texture means half-eaten stones all the way round. This finds, for each
       position along each edge, the first MORTAR LINE inward of it -- the darkest
       row/column inside a search window -- and ends the fade there instead. The
       whiteout then stops on a joint, which is where a real wall's texture would be
       cut anyway.

       Returns a `size x 4` RGBA texture: rows N, E, S, W, red channel holding the
       local band as a fraction of `bandMax`.

       Read off the UNBLURRED gray, at up to full resolution. Both matter and both
       were wrong first time: mortar joints on a 256px brick texture are ~2px wide
       and about 9px apart, so the height blur (2px) plus a half-resolution readback
       flattened a 22-vs-78 luminance trough into nothing and the scan picked noise. */
    function jointBandTexture(grayFBO, size, band, bandMax) {
        const N = Math.min(256, size);
        const small = createFBO(N, N);
        blit('copy', { u_texture: grayFBO.texture }, small);
        const px = readPixels(small);
        deleteFBO(small);
        /* Stay in GL space. readPixels is bottom-up and so is v_uv, so `y` here is
           the shader's v_uv.y directly -- no flip. Flipping it here (the first
           version did) silently swapped the N and S band maps and mirrored E and W,
           which put every joint lookup on the wrong edge. */
        const at = (x, y) => px[(y * N + x) * 4];

        /* Never search shorter than the safe band -- the fade has to cover TEN's
           reach whatever the texture looks like -- and never longer than bandMax. */
        const lo = Math.max(1, Math.round(band * N));
        const hi = Math.max(lo + 1, Math.min(N - 1, Math.round(bandMax * N)));
        const out = new Uint8Array(N * 4 * 4);

        /* Score each candidate depth by darkness AVERAGED ALONG THE EDGE, not by the
           single darkest pixel under each position. A mortar course is a line: the
           average finds it, while a per-pixel minimum finds whichever speck of grout
           happens to be darkest and produces a sawtooth. The window is local rather
           than the whole edge so staggered vertical joints (the E/W edges of a
           brick bond) are still followed instead of averaged away. */
        const scan = (row, sample) => {
            const W = Math.max(1, Math.round(N / 10));
            const best = new Int32Array(N).fill(lo);
            const bestV = new Float32Array(N).fill(1e9);
            const sumV = new Float32Array(N);       // for the "is there a joint at all" test
            const line = new Float32Array(N);
            let depths = 0;
            for (let d = lo; d <= hi; d++) {
                depths++;
                for (let a = 0; a < N; a++) line[a] = sample(a, d);
                let acc = 0, n = 0;
                for (let a = 0; a <= Math.min(W, N - 1); a++) { acc += line[a]; n++; }
                for (let a = 0; a < N; a++) {
                    if (a > W) { acc -= line[a - W - 1]; n--; }
                    if (a + W < N) { acc += line[a + W]; n++; }
                    const v = acc / n;
                    sumV[a] += v;
                    if (v < bestV[a]) { bestV[a] = v; best[a] = d; }
                }
            }
            for (let a = 0; a < N; a++) {
                /* Only follow the trough when there IS one. On a coursed texture the
                   dip is enormous (brick: 22 against a face mean of 78, a 72% dip);
                   on irregular stone with no edge-parallel joints the profile drifts
                   by a few percent and the "darkest" depth is arbitrary. Measured:
                   without this, Stonetiles got a worse contour than plain smooth.
                   Below the threshold we fall back to the nominal band, so choosing
                   joint-aware can never be worse than not choosing it.

                   0.25 is where the two behaviours actually separate, measured:
                   Bricks dips 72%, Stonetiles (irregular, no coursed lines) 12%,
                   Sand ~0. A real grout line is far darker than a quarter. */
                const mean = sumV[a] / Math.max(1, depths);
                const dip = (mean - bestV[a]) / Math.max(1, mean);
                const d = dip > 0.25 ? best[a] / N : band;
                const frac = Math.max(band, d) / bandMax;
                out[(row * N + a) * 4] = Math.round(Math.max(0, Math.min(1, frac)) * 255);
                out[(row * N + a) * 4 + 3] = 255;
            }
        };
        // Rows are the shader's edge order: v_uv.y->0, v_uv.x->1, v_uv.y->1, v_uv.x->0.
        scan(0, (x, d) => at(x, d));
        scan(1, (y, d) => at(N - 1 - d, y));         // E
        scan(2, (x, d) => at(x, N - 1 - d));         // S
        scan(3, (y, d) => at(d, y));                 // W

        return createTexture(N, 4, out, { filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE });
    }

    /* ---- Percentiles of a framebuffer's red channel ----
       Read back at 64x64 (16 KB) rather than full size: this runs once per tile per
       generate, and generateMaps already reads every finished map back at full
       resolution, so it is noise against what is already there.

       Percentiles, not min/max: one white speck would otherwise decide where the
       whole tile's surface plane sits. */
    function fboPercentiles(fboObj, ps) {
        const S = 64;
        const small = createFBO(S, S);
        blit('copy', { u_texture: fboObj.texture }, small);
        const px = readPixels(small);
        deleteFBO(small);
        const v = new Uint8Array(S * S);
        for (let i = 0; i < S * S; i++) v[i] = px[i * 4];
        v.sort();
        return ps.map(p => v[Math.min(S * S - 1, Math.max(0, Math.round(p * (S * S - 1))))] / 255);
    }

    /* ---- Live parallax preview ----
       Renders `diffuse` as TombEngine's POM would sample it through `height`, at a
       given view angle. Preview only -- it never touches an exported map -- but it
       is the real shader's arithmetic, so what it shows (including a black bar at
       the border) is what the engine will draw.

       `tileSize` matters and is not cosmetic: the march is a fixed distance in
       ATLAS-PAGE pixels, so the same height map eats a bigger share of a small
       texture. */
    function pomPreview(diffuseCanvas, heightCanvas, tileSize, viewDeg) {
        const th = (viewDeg || 60) * Math.PI / 180;
        const vXY = Math.sin(th), vZraw = Math.cos(th);
        const vZ = Math.max(0.4, Math.min(1, vZraw));
        const factor = Math.max(0, Math.min(1, (vZraw - 0.4) / 0.6));
        const steps = Math.max(1, Math.ceil(16 + (1 - 16) * factor));
        const reachPx = (vXY / vZ) * 0.0035 * 4096;
        const S = Math.min(512, Math.max(64, tileSize));
        const dTex = createTextureFromImage(diffuseCanvas, { wrap: gl.CLAMP_TO_EDGE });
        const hTex = createTextureFromImage(heightCanvas, { wrap: gl.CLAMP_TO_EDGE });
        const out = createFBO(S, S);
        blit('pomPreview', {
            u_diffuse: dTex, u_height: hTex,
            u_reach: reachPx / Math.max(1, tileSize),
            u_steps: steps,
            u_padPx: 8 / Math.max(1, tileSize),
            u_dir: 1.0
        }, out);
        const cv = fboToCanvas(out);
        deleteFBO(out); deleteTexture(dTex); deleteTexture(hTex);
        return cv;
    }

    /* ---- The same TombEngine march, on a surface you can turn ----------------
       `pomPreview` above renders the wall face-on with one reach for the whole
       image. This draws the quad in PERSPECTIVE and lets each fragment work out its
       own tangent-space view vector, which is what TEN actually does -- so the
       parallax strengthens toward the grazing end of the surface and eases off
       head-on, in one picture, as it will in game.

       Why not a displaced mesh (we already ship Babylon for the material preview):
       TombEngine does not move geometry. It fakes depth per pixel, so a
       parallax-mapped wall keeps a dead-flat silhouette and the relief collapses as
       you rotate away from it. A displaced mesh shows bumpy edges and true
       occlusion that the engine never draws -- it would look better and be wrong.
       Nothing here needs the Tomb Engine renderer; the march IS TEN's.

       yaw/pitch in degrees, dist in quad half-widths. */
    function pomPreview3D(diffuseCanvas, heightCanvas, tileSize, opts) {
        const o = Object.assign({ yaw: 38, pitch: 24, dist: 3.1, size: 420, light: 1 }, opts || {});
        const S = Math.max(64, Math.min(768, o.size));
        const yaw = o.yaw * Math.PI / 180, pitch = o.pitch * Math.PI / 180;
        // Camera orbits the quad, which sits in the z = 0 plane spanning [-1,1].
        const cam = [
            Math.sin(yaw) * Math.cos(pitch) * o.dist,
            Math.sin(pitch) * o.dist,
            Math.cos(yaw) * Math.cos(pitch) * o.dist
        ];
        const mvp = _perspectiveLookAt(cam, [0, 0, 0], 42, 1, 0.05, 50);
        const dTex = createTextureFromImage(diffuseCanvas, { wrap: gl.CLAMP_TO_EDGE });
        const hTex = createTextureFromImage(heightCanvas, { wrap: gl.CLAMP_TO_EDGE });
        const out = createFBO(S, S);
        gl.clearColor(0, 0, 0, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, S, S);
        gl.clear(gl.COLOR_BUFFER_BIT);
        blit('pomPreview3D', {
            u_diffuse: dTex, u_height: hTex,
            u_mvp: mvp,
            u_camPos: cam,
            // POM_HEIGHT_SCALE over the atlas page, expressed in this tile's UVs --
            // the same absolute reach the flat preview uses.
            u_scale: 0.0035 * 4096 / Math.max(1, tileSize),
            u_minAngle: 0.4,
            u_steps: 24,
            u_padPx: 8 / Math.max(1, tileSize),
            u_light: o.light
        }, out);
        const cv = fboToCanvas(out);
        deleteFBO(out); deleteTexture(dTex); deleteTexture(hTex);
        return cv;
    }

    /* Column-major perspective * lookAt, just enough for the preview above. Kept
       local rather than pulling in a matrix library -- CDN-only deps, and this is
       twenty lines. */
    function _perspectiveLookAt(eye, target, fovDeg, aspect, near, far) {
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const z = norm(sub(eye, target));
        const x = norm(cross([0, 1, 0], z));
        const y = cross(z, x);
        const view = [
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
        ];
        const f = 1 / Math.tan(fovDeg * Math.PI / 360);
        const nf = 1 / (near - far);
        const proj = [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0
        ];
        const out = new Float32Array(16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
            let v = 0;
            for (let k = 0; k < 4; k++) v += proj[k * 4 + r] * view[c * 4 + k];
            out[c * 4 + r] = v;
        }
        return out;
    }

    /* ---- Convert FBO to Canvas (for display/download) ---- */
    function fboToCanvas(fboObj) {
        const pixels = readPixels(fboObj);
        const canvas = document.createElement('canvas');
        canvas.width = fboObj.width;
        canvas.height = fboObj.height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(fboObj.width, fboObj.height);

        // Flip Y (WebGL is bottom-up)
        for (let y = 0; y < fboObj.height; y++) {
            const srcRow = (fboObj.height - 1 - y) * fboObj.width * 4;
            const dstRow = y * fboObj.width * 4;
            for (let x = 0; x < fboObj.width * 4; x++) {
                imageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /* ---- High-Level: Gaussian Blur (two-pass separable) ---- */
    function gaussianBlur(srcTexture, width, height, radius) {
        if (radius < 0.5) {
            // No blur needed — just copy
            const out = createFBO(width, height);
            blit('copy', { u_texture: srcTexture }, out);
            return out;
        }

        const temp = createFBO(width, height);
        const out = createFBO(width, height);

        // Horizontal pass
        blit('gaussianBlur', {
            u_texture: srcTexture,
            u_direction: [1.0 / width, 0.0],
            u_radius: radius
        }, temp);

        // Vertical pass
        blit('gaussianBlur', {
            u_texture: temp.texture,
            u_direction: [0.0, 1.0 / height],
            u_radius: radius
        }, out);

        deleteFBO(temp);
        return out;
    }

    /* ---- Multigrid V-cycle solver (coarse → fine) ----
       Plain Jacobi needs O(N²) iterations to converge across an N-pixel domain,
       so it never fills large regions in a practical budget. This solves the
       same relaxation on a resolution pyramid: the coarsest level converges
       cheaply, each finer level is seeded from the upsampled coarser solution
       and only needs a few iterations to add detail near the boundary.
         prep(s)            → per-level data object with a cleanup() method
         seedCoarsest(s,d,t)→ blit the initial guess into target FBO t
         relax(s,d,srcTex,dst) → one Jacobi blit
       Returns the full-resolution solution FBO (caller deletes). */
    function _multigridSolve(size, prep, seedCoarsest, relax, float) {
        const levels = [];
        for (let s = size; s >= 8; s = Math.floor(s / 2)) levels.push(s);
        const data = {};
        for (const s of levels) data[s] = prep(s);

        let solution = null;
        for (let i = levels.length - 1; i >= 0; i--) {
            const s = levels[i];
            const coarsest = (solution === null);
            let src = createFBO(s, s, { float });
            let dst = createFBO(s, s, { float });
            if (coarsest) {
                seedCoarsest(s, data[s], src);
            } else {
                blit('copy', { u_texture: solution.texture }, src);   // upsample (LINEAR)
                deleteFBO(solution);
            }
            const iters = coarsest ? Math.max(80, s * s) : 48;
            for (let k = 0; k < iters; k++) {
                relax(s, data[s], src.texture, dst);
                const t = src; src = dst; dst = t;
            }
            deleteFBO(dst);
            solution = src;
        }
        for (const s of levels) data[s].cleanup();
        return solution;
    }

    /* ---- High-Level: Poisson (gradient-domain) blend ----
       Solves ∇²f = (1-mask)·∇²base + mask·∇²overlay with the border held to
       `alphaTexture` (plain alpha composite), removing the tonal seam where
       base/overlay differ in brightness while keeping the tile's edges intact.
       Guidance is recomputed per pyramid level from that level's base/overlay,
       which keeps it self-consistent in each level's pixel units. Returns a
       float FBO the caller must deleteFBO(). */
    function poissonBlend(baseTexture, overlayTexture, maskTexture, alphaTexture, size) {
        return _multigridSolve(size,
            (s) => {
                const texel = [1.0 / s, 1.0 / s];
                const b = createFBO(s, s, { float: true }); blit('copy', { u_texture: baseTexture }, b);
                const o = createFBO(s, s, { float: true }); blit('copy', { u_texture: overlayTexture }, o);
                const m = createFBO(s, s, { float: true }); blit('copy', { u_texture: maskTexture }, m);
                const a = createFBO(s, s, { float: true }); blit('copy', { u_texture: alphaTexture }, a);
                const g = createFBO(s, s, { float: true });
                blit('poissonGuidance', { u_base: b.texture, u_overlay: o.texture, u_mask: m.texture, u_texel: texel }, g);
                deleteFBO(b); deleteFBO(o); deleteFBO(m);
                return { a, g, cleanup() { deleteFBO(a); deleteFBO(g); } };
            },
            (s, d, target) => blit('copy', { u_texture: d.a.texture }, target),
            (s, d, srcTex, dst) => blit('poissonJacobi', {
                u_f: srcTex, u_guidance: d.g.texture, u_alpha: d.a.texture, u_texel: [1.0 / s, 1.0 / s]
            }, dst),
            true
        );
    }

    /* ---- High-Level: Diffusion inpaint (Laplace fill, Phase 6) ----
       Fills the white region of `maskTexture` by diffusing surrounding colours
       inward (∇²f = 0, Dirichlet boundary = original), via the multigrid solver
       so even large painted regions fill. Returns an RGBA8 FBO (caller deletes). */
    function inpaintDiffusion(origTexture, maskTexture, size) {
        return _multigridSolve(size,
            (s) => {
                const o = createFBO(s, s); blit('copy', { u_texture: origTexture }, o);
                const m = createFBO(s, s); blit('copy', { u_texture: maskTexture }, m);
                return { o, m, cleanup() { deleteFBO(o); deleteFBO(m); } };
            },
            (s, d, target) => blit('copy', { u_texture: d.o.texture }, target),
            (s, d, srcTex, dst) => blit('inpaintJacobi', {
                u_f: srcTex, u_orig: d.o.texture, u_mask: d.m.texture, u_texel: [1.0 / s, 1.0 / s]
            }, dst),
            false
        );
    }

    /* ---- High-Level: Generate all material maps from a diffuse ---- */
    /* ---- Seamless: multi-band (Laplacian pyramid) edge blend — MIT ----
       Clean-room replacement for the GPL `seamlessMaker` port. Blends the tile
       with a toroidally half-shifted copy of itself, per frequency band.

       Why multi-band rather than one cross-fade: a single blend width cannot
       serve both ends of the spectrum. Wide enough to hide the low-frequency
       step across the seam, and the high frequencies cross-fade into visible
       ghosting; narrow enough to keep detail crisp, and the brightness step
       stays. Blending each octave with a mask blurred to that octave's own
       scale gives each band the width it needs — low bands blend wide, fine
       bands blend narrow. (Burt & Adelson 1983; GPU formulation JCGT 14(1) 2025.)

       The bands are held in RGBA16F because Laplacian detail is signed and
       would clip to black at 8 bits.

       `falloff` (0-1) scales the mask, i.e. how hard the seam is pulled toward
       the shifted copy. `overlapX/Y` set the widest band's reach. */
    function seamlessMultiBand(srcTexture, size, opts = {}) {
        const LEVELS = 5;
        // AtlasTool tiles are square, but the root tool's seamless tab can hand
        // us a non-square source, so height is separable via opts.height.
        const width = size, height = opts.height || size;
        const overlapX = opts.overlapX != null ? opts.overlapX : 0.25;
        const overlapY = opts.overlapY != null ? opts.overlapY : 0.25;
        const falloff  = opts.falloff  != null ? opts.falloff  : 0.5;
        const temps = [];
        const F = () => { const f = createFBO(width, height, { float: true }); temps.push(f); return f; };

        /* A = original. B = a toroidally shifted copy, which supplies the
           content that replaces the seam.

           THE SHIFT MUST NOT BE 0.5. A half-shift looks like the obvious choice
           ("bring the opposite corner into register") and is degenerate on a
           large class of real inputs: many tiling source textures are already
           periodic at half-width, so B comes out pixel-identical to A and the
           whole pass silently becomes a no-op. Measured on Examples/Bricks.png,
           a 0.5 shift gives a mean absolute difference of exactly 0, while
           0.137 gives 29.2 and 0.25 gives 18.1.

           0.381966 = 1 - 1/phi, the "most irrational" fraction, so it cannot
           land on 1/2, 1/3, 1/4 or any other low-order periodicity a tiling
           texture is likely to have. The two axes use different offsets so a
           texture periodic along one axis still gets a real shift on the other. */
        const SHIFT_X = 0.381966, SHIFT_Y = 0.618034;
        const A = F(); blit('copy', { u_texture: srcTexture }, A);
        const B = F(); blit('wrapShift', { u_texture: srcTexture, u_offset: [SHIFT_X, SHIFT_Y] }, B);

        const mask = F();
        blit('seamBandMask', { u_bandX: overlapX, u_bandY: overlapY }, mask);

        /* Gaussian pyramids. gaussianBlur() allocates 8-bit internally, so the
           blurs are done here against float targets instead. */
        const blurF = (tex, radius) => {
            const t = F(), o = F();
            blit('gaussianBlur', { u_texture: tex, u_direction: [1 / width, 0], u_radius: radius }, t);
            blit('gaussianBlur', { u_texture: t.texture, u_direction: [0, 1 / height], u_radius: radius }, o);
            return o;
        };
        const radii = [];
        for (let i = 0; i < LEVELS; i++) radii.push(Math.max(1, Math.round(2 * Math.pow(2, i))));

        const pyrA = [A], pyrB = [B], pyrM = [mask];
        for (let i = 0; i < LEVELS; i++) {
            pyrA.push(blurF(pyrA[i].texture, radii[i]));
            pyrB.push(blurF(pyrB[i].texture, radii[i]));
            // The mask is blurred to the SAME scale as the band it weights —
            // this is what gives each octave its own blend width.
            pyrM.push(blurF(pyrM[i].texture, radii[i]));
        }

        // Start from the coarsest level, blended with the coarsest mask.
        let acc = F();
        blit('bandBlend', {
            u_base: F().texture,              // zero-initialised
            u_a: pyrA[LEVELS].texture,
            u_b: pyrB[LEVELS].texture,
            u_mask: pyrM[LEVELS].texture,
            u_weight: 1.0
        }, acc);

        // Add each finer band back, weighted by the mask at that band's scale.
        for (let i = LEVELS - 1; i >= 0; i--) {
            const la = F(); blit('bandDiff', { u_fine: pyrA[i].texture, u_coarse: pyrA[i + 1].texture }, la);
            const lb = F(); blit('bandDiff', { u_fine: pyrB[i].texture, u_coarse: pyrB[i + 1].texture }, lb);
            const next = F();
            blit('bandBlend', {
                u_base: acc.texture, u_a: la.texture, u_b: lb.texture,
                u_mask: pyrM[i].texture,
                // Fine bands follow the mask less, which is what suppresses
                // ghosting where the two copies disagree on detail.
                u_weight: 0.35 + 0.65 * falloff * (i / LEVELS)
            }, next);
            acc = next;
        }

        const out = createFBO(width, height);
        blit('copy', { u_texture: acc.texture }, out);
        temps.forEach(f => deleteFBO(f));
        return out;
    }

    function generateMaps(diffuseTexture, width, height, preset, enabledMaps) {
        const results = {};
        const texel = 1.0 / Math.max(width, height);

        // Step 1: Desaturate to grayscale, alpha-flattened where the diffuse is
        // transparent so those areas read as flat rather than as deep crevices.
        //
        // Transparent pixels reach us as pure BLACK (the canvas discards whatever
        // RGB sat under alpha=0), which is the lowest luminance there is — so
        // without this, every cutout becomes the deepest part of the height map
        // and each alpha edge a cliff. In-engine, parallax then treats the holes
        // in a grate or fence as a real recessed surface and drags texels across
        // the boundary: translucent smearing, and see-through where the offset
        // pushes the hole outward.
        //
        // `alphaFlatten` is set by the caller from the tile's actual alpha
        // (AtlasTool scans the diffuse). `decal` stays as a fallback so the decal
        // presets keep forcing it on regardless of what the tile looks like.
        const flatten = (preset.alphaFlatten != null) ? preset.alphaFlatten : preset.decal;
        const grayFBO = createFBO(width, height);
        blit('desaturate', {
            u_texture: diffuseTexture,
            u_gamma: 0.8,
            u_alphaFlatten: flatten ? 1.0 : 0.0
        }, grayFBO);

        /* Step 2: what the relief is READ FROM, then blur it.

           Normally that is the tile's own luminance. `preset.heightSource` swaps in
           a colour / hue SELECTION instead, so the mortar can carve in while the
           stones stay flat -- which luminance cannot express on a texture whose
           stones are darker than its joints. It reuses the emissiveMask shader
           rather than adding one, and the selection (1 where matched) is turned the
           right way up by simpleHeight's EXISTING u_invert, XOR'd with the user's
           own "which side sinks" choice. Zero new GLSL, zero new uniforms. */
        let heightBase = grayFBO, heightSelFBO = null;
        let heightInvert = !!preset.heightInvert;
        const hSrc = preset.heightSource;
        if (enabledMaps.height && hSrc && typeof hSrc.mode === 'number') {
            heightSelFBO = createFBO(width, height);
            blit('emissiveMask', {
                u_texture:   diffuseTexture,
                u_mode:      hSrc.mode,
                u_threshold: 0.5,
                u_softness:  hSrc.softness != null ? hSrc.softness : 0.3,
                u_target:    hSrc.target || [1, 1, 1],
                u_tolerance: hSrc.tolerance != null ? hSrc.tolerance : 0.25,
                u_hueCenter: hSrc.hueCenter != null ? hSrc.hueCenter : 0.08,
                u_hueWidth:  hSrc.hueWidth != null ? hSrc.hueWidth : 0.08,
                u_satMin:    hSrc.satMin != null ? hSrc.satMin : 0.3,
                u_valMin:    hSrc.valMin != null ? hSrc.valMin : 0.2
            }, heightSelFBO);
            heightBase = heightSelFBO;
            // The selection reads as "this is the thing", and the thing carves IN
            // by default -- so the default for a selection is the inverted sense.
            heightInvert = !heightInvert;
        }
        const heightBlurred = gaussianBlur(heightBase.texture, width, height, preset.heightBlur);

        // Step 3: Create height map
        if (enabledMaps.height) {
            const strength = preset.heightStrength / 25.0;
            const invert = heightInvert;
            /* Where the surface plane sits. The shader slides the whole map so its
               98th percentile lands on `top`; measure that percentile here, on the
               blurred gray, and push it through the same affine the shader applies.
               Order-preserving, so no second render pass is needed -- and under
               inversion the high end comes from the LOW percentile. */
            const [p02, p98] = fboPercentiles(heightBlurred, [0.02, 0.98]);
            const scaled = v => (v - 0.5) * strength + 0.5;
            const ref = invert ? 1.0 - scaled(p02) : scaled(p98);
            const top = (typeof preset.heightTop === 'number') ? preset.heightTop : 1.0;

            const heightFBO = createFBO(width, height);
            blit('simpleHeight', {
                u_texture: heightBlurred.texture,
                u_strength: strength,
                u_ref: ref,
                u_top: top,
                u_invert: invert ? 1.0 : 0.0
            }, heightFBO);

            /* A painted raise/lower, if the tile carries one. Deliberately BEFORE the
               white border: a stroke near the edge must not be able to punch a hole
               in it and hand the march its way back out of the texture. */
            let heightSrc = heightFBO;
            const paint = preset.heightPaint;
            if (paint && paint.mask && Math.abs(paint.lift || 0) > 0.001) {
                const mTex = createTextureFromImage(paint.mask, { wrap: gl.CLAMP_TO_EDGE });
                const painted = createFBO(width, height);
                blit('heightPaint', {
                    u_texture: heightFBO.texture, u_mask: mTex, u_lift: paint.lift
                }, painted);
                deleteTexture(mTex);
                deleteFBO(heightFBO);
                heightSrc = painted;
            }

            /* Fade the border to white so TEN's parallax cannot march out of the
               texture's own box in the atlas page. On by default: the height map is
               measurably wrong for TEN without it (HEIGHT-MAP-AUDIT.md), and the
               band it needs is a property of the tile size, not a taste setting. */
            const edge = preset.heightEdge;
            const amount = edge && typeof edge.amount === 'number' ? edge.amount : 1.0;
            if (amount > 0.001) {
                const band = (edge && typeof edge.band === 'number')
                    ? edge.band : heightEdgeBandFor(Math.min(width, height));
                const profile = (edge && typeof edge.profile === 'number') ? edge.profile : 0;
                const bandMax = Math.min(0.45, band * 2.2);
                const jointTex = (profile === 4)
                    ? jointBandTexture(grayFBO, Math.min(width, height), band, bandMax) : null;
                const white = createFBO(width, height);
                blit('heightEdgeWhite', {
                    u_texture: heightSrc.texture,
                    u_bandMap: jointTex || heightSrc.texture,   // unused when off, but must bind
                    u_useBandMap: jointTex ? 1.0 : 0.0,
                    u_band: band,
                    u_bandMax: bandMax,
                    u_amount: amount,
                    u_profile: profile,
                    u_edges: (edge && typeof edge.edges === 'number') ? edge.edges : 15,
                    u_seed: (edge && typeof edge.seed === 'number') ? edge.seed : 0,
                    u_texel: 1.0 / Math.max(1, Math.min(width, height))
                }, white);
                if (jointTex) deleteTexture(jointTex);
                deleteFBO(heightSrc);
                results.height = white;
            } else {
                results.height = heightSrc;
            }
        }

        // Step 4: Create blurred height for normals/AO (use preset blur)
        const normalBlurred = gaussianBlur(grayFBO.texture, width, height, preset.normalBlur);

        // Step 5: Normal map from height
        if (enabledMaps.normal) {
            const fineW   = preset.normalFineDetail ?? 0;   // high-freq band weight
            const coarseW = preset.normalLargeScale ?? 0;   // large-scale band weight

            if (fineW > 0 || coarseW > 0) {
                // Multi-level path: blend the height slope at three blur scales.
                // The base scale matches the single-pass input (normalBlurred), so
                // weights of 0 reproduce the single-pass output exactly.
                const baseBlur     = preset.normalBlur ?? 0;
                const fineRadius   = Math.max(0, baseBlur * 0.34);
                const coarseRadius = baseBlur * 3 + 5;
                const fineBlurred   = gaussianBlur(grayFBO.texture, width, height, fineRadius);
                const coarseBlurred = gaussianBlur(grayFBO.texture, width, height, coarseRadius);

                const normalFBO = createFBO(width, height);
                blit('normalFromHeightMulti', {
                    u_hFine:   fineBlurred.texture,
                    u_hBase:   normalBlurred.texture,
                    u_hCoarse: coarseBlurred.texture,
                    u_texelSize: texel,
                    u_strength: preset.normalStrength / 10.0,
                    u_wFine:   fineW,
                    u_wCoarse: coarseW,
                    u_angularity: (preset.normalAngularity ?? 0),
                    u_angularIntensity: (preset.normalAngularIntensity ?? 0.5),
                    u_flipY: preset.flipNormalY ? 1.0 : 0.0
                }, normalFBO);
                results.normal = normalFBO;
                deleteFBO(fineBlurred);
                deleteFBO(coarseBlurred);
            } else {
                // Single-pass path (default, unchanged).
                const normalHeightFBO = createFBO(width, height);
                /* u_ref == u_top means "no plane shift": this is the normal path's
                   internal height, not an exported one. Both MUST be passed even
                   though the difference is zero -- blit() leaves uniforms set on the
                   program, so omitting them inherits whatever the exported height
                   map set a moment earlier, and the normal map silently changes
                   depending on whether Height happened to be ticked. That is exactly
                   the regression validate-multilevel-normal caught. */
                blit('simpleHeight', {
                    u_texture: normalBlurred.texture,
                    u_strength: 1.0,
                    u_ref: 0.0,
                    u_top: 0.0,
                    u_invert: 0.0
                }, normalHeightFBO);

                const normalFBO = createFBO(width, height);
                blit('normalFromHeight', {
                    u_heightMap: normalHeightFBO.texture,
                    u_texelSize: texel,
                    u_strength: preset.normalStrength / 10.0,
                    u_angularity: (preset.normalAngularity ?? 0),
                    u_angularIntensity: (preset.normalAngularIntensity ?? 0.5),
                    u_flipY: preset.flipNormalY ? 1.0 : 0.0
                }, normalFBO);
                results.normal = normalFBO;
                deleteFBO(normalHeightFBO);
            }
        }

        // Step 6: AO from height
        // No pre-blur: blurring before AO was smearing mortar-joint edges.
        // The shader now uses max-per-direction to keep shadows sharp.
        if (enabledMaps.ao) {
            const aoHeightFBO = createFBO(width, height);
            // Same as above: no plane shift, and both uniforms set explicitly.
            blit('simpleHeight', {
                u_texture: grayFBO.texture,
                u_strength: 1.0,
                u_ref: 0.0,
                u_top: 0.0,
                u_invert: 0.0
            }, aoHeightFBO);

            // Optional normal-field AO channel (dual-channel AO: height-field + normal-field).
            // Build a normal map from the AO height only when the user asks to blend.
            const aoNormalBlend = preset.aoNormalBlend ?? 0;
            let aoNormalFBO = null;
            if (aoNormalBlend > 0) {
                aoNormalFBO = createFBO(width, height);
                blit('normalFromHeight', {
                    u_heightMap: aoHeightFBO.texture,
                    u_texelSize: texel,
                    u_strength: (preset.normalStrength ?? 10) / 10.0,
                    u_angularity: 0.0,
                    u_angularIntensity: 0.0,
                    u_flipY: 0.0
                }, aoNormalFBO);
            }

            const aoFBO = createFBO(width, height);
            blit('aoFromHeight', {
                u_heightMap: aoHeightFBO.texture,
                u_normalMap: (aoNormalFBO || aoHeightFBO).texture,
                u_texelSize: texel,
                u_radius: preset.aoRadius,
                u_intensity: preset.aoIntensity / 5.0,
                u_normalBlend: aoNormalBlend,
                // Defaults reproduce the previously hard-coded 0.85 curve / 0.5 floor,
                // so every preset that omits these keys is byte-for-byte unchanged.
                u_aoDepth: preset.aoDepth ?? 0.5,
                u_aoCurve: preset.aoCurve ?? 0.85
            }, aoFBO);
            results.ao = aoFBO;
            deleteFBO(aoHeightFBO);
            if (aoNormalFBO) deleteFBO(aoNormalFBO);
        }

        // Step 7: Roughness map (signed high-pass from diffuse luminance)
        if (enabledMaps.roughness) {
            const roughBlurred = gaussianBlur(grayFBO.texture, width, height, 3);
            const roughFBO = createFBO(width, height);
            blit('roughnessMap', {
                u_diffuse:   grayFBO.texture,
                u_blurred:   roughBlurred.texture,
                u_baseValue: preset.roughnessBase / 255.0,
                u_contrast:  preset.roughnessContrast / 30.0
            }, roughFBO);
            deleteFBO(roughBlurred);
            results.roughness = roughFBO;
        }

        // Step 8: Specular map
        if (enabledMaps.specular) {
            const specFBO = createFBO(width, height);
            blit('specularMap', {
                u_heightMap: grayFBO.texture,
                u_texelSize: texel,
                u_baseValue: preset.specularBase / 255.0,
                u_contrast: preset.specularContrast / 30.0
            }, specFBO);
            results.specular = specFBO;
        }

        // Step 9: Emissive map
        if (enabledMaps.emissive) {
            const emissFBO = createFBO(width, height);
            blit('emissiveMap', {
                u_texture: diffuseTexture,
                u_threshold: preset.emissiveThreshold / 255.0,
                u_strength: preset.emissiveStrength / 100.0,
                u_softness: 0.5
            }, emissFBO);
            results.emissive = emissFBO;
        }

        // Cleanup temporary FBOs
        deleteFBO(grayFBO);
        if (heightSelFBO) deleteFBO(heightSelFBO);   // the colour/hue height source
        deleteFBO(heightBlurred);
        deleteFBO(normalBlurred);

        return results;
    }

    /* ---- Utility: Load image as texture ---- */
    function loadImageAsTexture(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const tex = createTextureFromImage(img);
                resolve({ texture: tex, width: img.naturalWidth, height: img.naturalHeight, image: img });
            };
            img.onerror = reject;
            img.src = src;
        });
    }

    /* ---- Utility: Canvas to downloadable blob ---- */
    function canvasToBlob(canvas, format = 'image/png', quality = 0.95) {
        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), format, quality);
        });
    }

    /* ---- Utility: encode a canvas as an uncompressed 32-bit TGA (with alpha) ----
       The browser can't produce TGA via toBlob, so we write it by hand. BGRA byte
       order, top-left origin (descriptor 0x28). Returns a Blob. */
    function encodeTGA(canvas) {
        const w = canvas.width, h = canvas.height;
        const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        const header = new Uint8Array(18);
        header[2] = 2;                       // uncompressed true-color
        header[12] = w & 0xff; header[13] = (w >> 8) & 0xff;
        header[14] = h & 0xff; header[15] = (h >> 8) & 0xff;
        header[16] = 32;                     // bits per pixel
        header[17] = 0x28;                   // 8 alpha bits + top-left origin
        const body = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            const s = i * 4, d = i * 4;
            body[d]     = px[s + 2];         // B
            body[d + 1] = px[s + 1];         // G
            body[d + 2] = px[s];             // R
            body[d + 3] = px[s + 3];         // A
        }
        return new Blob([header, body], { type: 'image/x-tga' });
    }

    /* ---- Utility: decode a TGA file into a canvas ----
       Browsers can't render TGA via <img>, so we parse it by hand. Handles the
       formats a TRLE artist actually ships: uncompressed true-colour (type 2)
       and RLE true-colour (type 10), at 24 or 32 bits, either vertical origin.
       Grayscale (type 3 / 11) is included for completeness. Colour-mapped TGAs
       (type 1 / 9) are rare for textures and are rejected with a clear throw.
       Returns a canvas (same shape as the <img> path elsewhere). */
    function decodeTGA(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        if (bytes.length < 18) throw new Error('File is too small to be a TGA.');
        const idLength   = bytes[0];
        const colorMapT  = bytes[1];
        const imageType  = bytes[2];
        const w = bytes[12] | (bytes[13] << 8);
        const h = bytes[14] | (bytes[15] << 8);
        const bpp = bytes[16];
        const descriptor = bytes[17];
        if (!w || !h) throw new Error('TGA has zero dimensions.');
        if (colorMapT !== 0 || imageType === 1 || imageType === 9)
            throw new Error('Colour-mapped (indexed) TGAs are not supported — re-export as 24/32-bit true-colour.');

        const isRLE  = imageType === 10 || imageType === 11;
        const isGray = imageType === 3  || imageType === 11;
        const rawType = imageType & 0x07;   // 2 = true-colour, 3 = grayscale
        if (rawType !== 2 && rawType !== 3)
            throw new Error('Unsupported TGA image type (' + imageType + ').');
        if (bpp !== 24 && bpp !== 32 && !(isGray && bpp === 8))
            throw new Error('Unsupported TGA bit depth (' + bpp + ').');

        const bytesPerPixel = bpp >> 3;
        let p = 18 + idLength;              // skip header + image ID field
        if (colorMapT !== 0) { /* skipped above via throw */ }

        const total = w * h;
        const rgba = new Uint8ClampedArray(total * 4);

        // Read one source pixel at buffer offset `off` into rgba[dst*4..].
        function put(dst, off) {
            if (isGray) {
                const g = bytes[off];
                rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = 255;
            } else {
                rgba[dst]     = bytes[off + 2];               // R (from B)
                rgba[dst + 1] = bytes[off + 1];               // G
                rgba[dst + 2] = bytes[off];                   // B (from R)
                rgba[dst + 3] = bytesPerPixel === 4 ? bytes[off + 3] : 255;
            }
        }

        if (!isRLE) {
            if (p + total * bytesPerPixel > bytes.length)
                throw new Error('TGA pixel data is truncated.');
            for (let i = 0; i < total; i++) put(i * 4, p + i * bytesPerPixel);
        } else {
            let i = 0;
            while (i < total) {
                if (p >= bytes.length) throw new Error('TGA RLE data is truncated.');
                const packet = bytes[p++];
                const count = (packet & 0x7f) + 1;
                if (packet & 0x80) {                          // RLE run
                    for (let k = 0; k < count && i < total; k++, i++) put(i * 4, p);
                    p += bytesPerPixel;
                } else {                                      // raw packet
                    for (let k = 0; k < count && i < total; k++, i++, p += bytesPerPixel) put(i * 4, p);
                }
            }
        }

        // Apply origin: descriptor bit 5 set = top-left, clear = bottom-left.
        const topLeft = (descriptor & 0x20) !== 0;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        if (topLeft) {
            imgData.data.set(rgba);
        } else {
            // Flip rows into the destination (TGA default is bottom-up).
            const rowBytes = w * 4;
            for (let y = 0; y < h; y++) {
                const src = (h - 1 - y) * rowBytes;
                imgData.data.set(rgba.subarray(src, src + rowBytes), y * rowBytes);
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    /* ---- Authored emissive map from a diffuse canvas ----
       Builds a selection mask (brightness / colour / hue), optionally feathers
       it for a soft bloom, then colours it (diffuse colours or a flat tint).
       Returns an RGB canvas (black = no emission). opts:
         mode 0|1|2, threshold, softness, target[r,g,b 0-1], tolerance,
         hueCenter, hueWidth, satMin, valMin, useTint, tint[r,g,b 0-1],
         strength (0-1), feather (px) */
    function emissiveFromDiffuse(diffuseCanvas, opts = {}) {
        const w = diffuseCanvas.width, h = diffuseCanvas.height;
        const tex = createTextureFromImage(diffuseCanvas);

        // Base selection mask: either a supplied painted canvas, or generated
        // on the GPU from the diffuse by brightness / colour / hue.
        let maskFBO = null, maskCanvasTex = null, maskBaseTex;
        if (opts.maskCanvas) {
            maskCanvasTex = createTextureFromImage(opts.maskCanvas);
            maskBaseTex = maskCanvasTex;
        } else {
            maskFBO = createFBO(w, h);
            blit('emissiveMask', {
                u_texture:   tex,
                u_mode:      opts.mode || 0,
                u_threshold: opts.threshold != null ? opts.threshold : 0.8,
                u_softness:  opts.softness != null ? opts.softness : 0.3,
                u_target:    opts.target || [1, 1, 1],
                u_tolerance: opts.tolerance != null ? opts.tolerance : 0.25,
                u_hueCenter: opts.hueCenter != null ? opts.hueCenter : 0.08,
                u_hueWidth:  opts.hueWidth != null ? opts.hueWidth : 0.08,
                u_satMin:    opts.satMin != null ? opts.satMin : 0.3,
                u_valMin:    opts.valMin != null ? opts.valMin : 0.2
            }, maskFBO);
            maskBaseTex = maskFBO.texture;
        }

        let maskTex = maskBaseTex, blurred = null;
        if (opts.feather && opts.feather > 0) {
            blurred = gaussianBlur(maskBaseTex, w, h, opts.feather);
            maskTex = blurred.texture;
        }

        const outFBO = createFBO(w, h);
        blit('emissiveApply', {
            u_diffuse:  tex,
            u_mask:     maskTex,
            u_useTint:  opts.useTint ? 1.0 : 0.0,
            u_tint:     opts.tint || [1, 1, 1],
            u_strength: opts.strength != null ? opts.strength : 1.0
        }, outFBO);

        const canvas = fboToCanvas(outFBO);
        deleteFBO(outFBO);
        if (maskFBO) deleteFBO(maskFBO);
        if (maskCanvasTex) deleteTexture(maskCanvasTex);
        if (blurred) deleteFBO(blurred);
        deleteTexture(tex);
        return canvas;
    }

    /* ---- Selection mask from a diffuse ----
       The brightness / colour-distance / hue-range selection that Make Emissive
       and the height-source picker both build inline, handed back as a plain
       greyscale canvas (white = selected). No new GLSL: it is the same
       `emissiveMask` shader, which is why the opts names match
       emissiveFromDiffuse's.

       opts: mode 0|1|2, threshold, softness, target[r,g,b 0-1], tolerance,
             hueCenter, hueWidth, satMin, valMin, feather (px), invert (bool) */
    function selectionMask(diffuseCanvas, opts = {}) {
        const w = diffuseCanvas.width, h = diffuseCanvas.height;
        const tex = createTextureFromImage(diffuseCanvas);
        const maskFBO = createFBO(w, h);
        blit('emissiveMask', {
            u_texture:   tex,
            u_mode:      opts.mode || 0,
            u_threshold: opts.threshold != null ? opts.threshold : 0.8,
            u_softness:  opts.softness != null ? opts.softness : 0.3,
            u_target:    opts.target || [1, 1, 1],
            u_tolerance: opts.tolerance != null ? opts.tolerance : 0.25,
            u_hueCenter: opts.hueCenter != null ? opts.hueCenter : 0.08,
            u_hueWidth:  opts.hueWidth != null ? opts.hueWidth : 0.08,
            u_satMin:    opts.satMin != null ? opts.satMin : 0.3,
            u_valMin:    opts.valMin != null ? opts.valMin : 0.2
        }, maskFBO);

        let blurred = null, src = maskFBO;
        if (opts.feather && opts.feather > 0) {
            blurred = gaussianBlur(maskFBO.texture, w, h, opts.feather);
            src = blurred;
        }
        const canvas = fboToCanvas(src);
        deleteFBO(maskFBO);
        if (blurred) deleteFBO(blurred);
        deleteTexture(tex);

        // Inverting on the CPU keeps the shader free of a uniform that only one
        // caller wants; the mask is already back as pixels by this point.
        if (opts.invert) {
            const ctx = canvas.getContext('2d');
            const im = ctx.getImageData(0, 0, w, h), d = im.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
            }
            ctx.putImageData(im, 0, 0);
        }
        return canvas;
    }

    /* ---- GPU-only FBO → screen blit (zero CPU readback) ----
       Uses gl.blitFramebuffer() to copy an FBO's colour
       attachment directly to the default framebuffer (canvas).
       No gl.readPixels() — stays entirely on the GPU.
       Used for the seamless-maker live 2×2 tiled preview.
       -------------------------------------------------------- */
    function blitToScreen(fboObj) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fboObj.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(
            0, 0, fboObj.width, fboObj.height,
            0, 0, fboObj.width, fboObj.height,
            gl.COLOR_BUFFER_BIT, gl.NEAREST
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* ---- Public API ---- */
    return {
        init,
        gl: () => gl,
        createTexture,
        createTextureFromImage,
        deleteTexture,
        createFBO,
        deleteFBO,
        blit,
        readPixels,
        fboToCanvas,
        blitToScreen,
        gaussianBlur,
        seamlessMultiBand,
        poissonBlend,
        inpaintDiffusion,
        generateMaps,
        // The safe white-edge band for a tile size, so the UI can default and advise
        // from the same number the pipeline uses.
        heightEdgeBandFor,
        POM_REACH_PX,
        pomPreview,
        pomPreview3D,
        emissiveFromDiffuse,
        selectionMask,
        loadImageAsTexture,
        canvasToBlob,
        encodeTGA,
        decodeTGA,
        programs: () => programs
    };
})();
