/* SPDX-License-Identifier: GPL-3.0-only
   TextureTool — Copyright (C) 2026 KainM-77. Licensed under GPL-3.0. See LICENSE.
   Pipeline adapted from Materialize (BoundingBoxSoftware), GPL-3.0.
   See THIRD-PARTY-NOTICES.md. */
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
            const prog = _linkProgram(vert, TRLE.Shaders[name]);
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
    function generateMaps(diffuseTexture, width, height, preset, enabledMaps) {
        const results = {};
        const texel = 1.0 / Math.max(width, height);

        // Step 1: Desaturate to grayscale (alpha-flattened for decal presets so
        // transparent areas read as flat, not as deep crevices).
        const grayFBO = createFBO(width, height);
        blit('desaturate', {
            u_texture: diffuseTexture,
            u_gamma: 0.8,
            u_alphaFlatten: preset.decal ? 1.0 : 0.0
        }, grayFBO);

        // Step 2: Blur grayscale for height base
        const heightBlurred = gaussianBlur(grayFBO.texture, width, height, preset.heightBlur);

        // Step 3: Create height map
        if (enabledMaps.height) {
            const heightFBO = createFBO(width, height);
            blit('simpleHeight', {
                u_texture: heightBlurred.texture,
                u_strength: preset.heightStrength / 25.0,
                u_bias: 0.0,
                u_invert: 0.0
            }, heightFBO);
            // Optional seamless edges: feather the border toward a wrap-blurred
            // copy so the height (parallax) doesn't cliff at the repeat seam.
            if (preset.heightSeamless) {
                const band = (typeof preset.heightSeamlessBand === 'number') ? preset.heightSeamlessBand : 0.12;
                const radius = Math.max(4, band * Math.max(width, height));
                const blurred = gaussianBlur(heightFBO.texture, width, height, radius);
                const feathered = createFBO(width, height);
                blit('edgeFeather', {
                    u_sharp: heightFBO.texture,
                    u_blurred: blurred.texture,
                    u_band: band
                }, feathered);
                deleteFBO(blurred);
                deleteFBO(heightFBO);
                results.height = feathered;
            } else {
                results.height = heightFBO;
            }
        }

        // Step 4: Create blurred height for normals/AO (use preset blur)
        const normalBlurred = gaussianBlur(grayFBO.texture, width, height, preset.normalBlur);

        // Step 5: Normal map from height
        if (enabledMaps.normal) {
            // First create a better height for normals
            const normalHeightFBO = createFBO(width, height);
            blit('simpleHeight', {
                u_texture: normalBlurred.texture,
                u_strength: 1.0,
                u_bias: 0.0,
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

        // Step 6: AO from height
        // No pre-blur: blurring before AO was smearing mortar-joint edges.
        // The shader now uses max-per-direction to keep shadows sharp.
        if (enabledMaps.ao) {
            const aoHeightFBO = createFBO(width, height);
            blit('simpleHeight', {
                u_texture: grayFBO.texture,
                u_strength: 1.0,
                u_bias: 0.0,
                u_invert: 0.0
            }, aoHeightFBO);

            // Optional normal-field AO channel (Materialize dual-channel blend).
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
                u_normalBlend: aoNormalBlend
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
        poissonBlend,
        inpaintDiffusion,
        generateMaps,
        emissiveFromDiffuse,
        loadImageAsTexture,
        canvasToBlob,
        encodeTGA,
        programs: () => programs
    };
})();
