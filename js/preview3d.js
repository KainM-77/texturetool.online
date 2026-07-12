/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (C) 2026 KainM-77. This file is the author's own work,
   available under the MIT License (see LICENSE-MIT). The tool as a whole ships
   under GPL-3.0 (see LICENSE) only because it also bundles two GPL-3.0 seamless
   shaders derived from Materialize; this file contains none of that code. */
/* ============================================================
   TRLE.Preview3D — shared Babylon.js material preview
   ============================================================
   A reusable, lazy-loaded 3D preview: feed it our generated map
   canvases and it renders a PBR-lit, height-displaced mesh you can
   orbit. Babylon is fetched as a CDN global ONLY on first use, and
   runs in its OWN WebGL context — it never shares GL state with
   TRLE.Engine (the blitter); the two only exchange <canvas> textures.

   Used by both AtlasTool's Material modal (js/atlas.js) and the Learn
   page (js/tutorial.js). Preview-only — never touches export/map-gen.

   Usage:
     const p = TRLE.Preview3D.create(canvas, { onStatus, relief });
     p.setMaps({ diffuse, normal, ao, roughness, emissive, height });  // canvases
     p.setRelief(0.45);    // 0..1 displacement exaggeration
     p.pause(); p.resume(); p.resize(); p.dispose();
   ============================================================ */
window.TRLE = window.TRLE || {};

TRLE.Preview3D = (function () {
    'use strict';

    const BABYLON_CDN  = 'https://cdn.babylonjs.com/babylon.js';
    // Neutral studio IBL (prefiltered .env, ~200 KB) for image-based ambient +
    // reflections. Lazy-loaded alongside Babylon; preview-only, never exported.
    const IBL_ENV      = 'https://assets.babylonjs.com/environments/studio.env';
    const MAX_AMPLITUDE = 0.5;   // world-space displacement at relief = 1
    const SUBDIV        = 140;   // ground tessellation (≈20k verts)

    let _babylonPromise = null;
    function loadBabylon() {
        if (window.BABYLON) return Promise.resolve(window.BABYLON);
        if (_babylonPromise) return _babylonPromise;
        _babylonPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = BABYLON_CDN; s.async = true;
            s.onload  = () => window.BABYLON ? resolve(window.BABYLON) : reject(new Error('Babylon global missing'));
            s.onerror = () => { _babylonPromise = null; reject(new Error('Babylon failed to load')); };
            document.head.appendChild(s);
        });
        return _babylonPromise;
    }

    function create(canvas, opts) {
        opts = opts || {};
        const ctrl = {
            canvas, B: null, engine: null, scene: null, camera: null,
            ground: null, material: null, textures: [], shadowGen: null,
            maps: null, enabled: { normal: true, ao: true, roughness: true, emissive: true },
            lastHeight: null, relief: opts.relief != null ? opts.relief : 0.45,
            active: true, _ensure: null, onStatus: opts.onStatus || function () {}
        };

        function ensure() {
            if (ctrl.engine) return Promise.resolve(true);
            if (ctrl._ensure) return ctrl._ensure;
            ctrl.onStatus('Loading 3D…');
            ctrl._ensure = loadBabylon().then(B => {
                const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false });
                const scene  = new B.Scene(engine);
                scene.clearColor = new B.Color4(0.07, 0.07, 0.08, 1);
                scene.environmentIntensity = 0.55;

                const cam = new B.ArcRotateCamera('p3dCam', -Math.PI / 2, Math.PI / 3.1, 3.4, B.Vector3.Zero(), scene);
                cam.attachControl(canvas, true);
                cam.wheelPrecision = 60; cam.lowerRadiusLimit = 1.8; cam.upperRadiusLimit = 7; cam.minZ = 0.05;
                cam.panningSensibility = 0;  // keep the tile centred

                // Hemispheric fill is trimmed (vs 0.6) because the IBL below now
                // supplies most of the ambient/fill once it loads.
                const hemi = new B.HemisphericLight('p3dHemi', new B.Vector3(0.3, 1, 0.2), scene);
                hemi.intensity = 0.4;
                const dir = new B.DirectionalLight('p3dDir', new B.Vector3(-0.5, -1, -0.45), scene);
                dir.intensity = 1.3; dir.position = new B.Vector3(2.5, 4, 2.5);
                dir.shadowMinZ = 1; dir.shadowMaxZ = 14;

                // Soft self-shadows from the relief — adds depth in crevices that
                // the normal/AO maps alone can't convey. Casters set per ground rebuild.
                const sg = new B.ShadowGenerator(1024, dir);
                sg.usePercentageCloserFiltering = true;
                sg.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
                sg.bias = 0.0012; sg.normalBias = 0.02;
                ctrl.shadowGen = sg;

                // Image-based lighting: neutral studio reflections + ambient. Loaded
                // async so it never blocks first paint; environmentIntensity already
                // scales its contribution. Failure is silent (analytic lights remain).
                try {
                    const env = B.CubeTexture.CreateFromPrefilteredData(IBL_ENV, scene);
                    scene.environmentTexture = env;
                } catch (e) { /* keep analytic-only lighting */ }

                ctrl.B = B; ctrl.engine = engine; ctrl.scene = scene; ctrl.camera = cam;
                engine.runRenderLoop(() => { if (ctrl.active && ctrl.scene) ctrl.scene.render(); });
                ctrl.onStatus('');
                return true;
            }).catch(err => {
                console.error(err);
                ctrl.onStatus('3D unavailable');
                ctrl._ensure = null;
                return false;
            });
            return ctrl._ensure;
        }

        function tex(c, gamma) {
            const t = new ctrl.B.Texture(c.toDataURL(), ctrl.scene, false, false);
            t.gammaSpace = gamma;   // colour maps sRGB, data maps linear
            ctrl.textures.push(t);
            return t;
        }

        function applyMaterial() {
            const B = ctrl.B, maps = ctrl.maps, en = ctrl.enabled;
            if (!maps) return;
            ctrl.textures.forEach(t => t.dispose()); ctrl.textures = [];
            if (ctrl.material) { ctrl.material.dispose(); ctrl.material = null; }

            const m = new B.PBRMaterial('p3dMat', ctrl.scene);
            m.albedoTexture = tex(maps.diffuse, true);   // diffuse always shown
            m.metallic = 0; m.roughness = 1; m.environmentIntensity = 0.5;
            if (maps.roughness && en.roughness) {
                m.metallicTexture = tex(maps.roughness, false);
                m.useRoughnessFromMetallicTextureAlpha = false;  // opaque alpha, ignore
                m.useRoughnessFromMetallicTextureGreen = true;   // grayscale → green = roughness
                m.useMetallnessFromMetallicTextureBlue = false;  // keep metallic = 0
            }
            if (maps.ao && en.ao) m.ambientTexture = tex(maps.ao, false);
            if (maps.normal && en.normal) {
                m.bumpTexture = tex(maps.normal, false);
                m.invertNormalMapY = true;   // our normals are OpenGL (+Y up)
            }
            if (maps.emissive && en.emissive) {
                m.emissiveTexture = tex(maps.emissive, true);
                m.emissiveColor = new B.Color3(1, 1, 1);
            }
            if (ctrl.ground) ctrl.ground.material = m;
            ctrl.material = m;
        }

        /* Rebuild the ground from flat and vertex-displace it by the height map. */
        function applyDisplacement() {
            const B = ctrl.B;
            const depth = ctrl.relief * MAX_AMPLITUDE;
            if (ctrl.ground) { ctrl.ground.dispose(); ctrl.ground = null; }
            const g = B.MeshBuilder.CreateGround('p3dGround', { width: 2, height: 2, subdivisions: SUBDIV, updatable: true }, ctrl.scene);
            if (ctrl.material) g.material = ctrl.material;
            // Ground both casts (onto itself) and receives the directional shadow,
            // so raised relief self-shadows the valleys. Rebuilt each time → reset list.
            g.receiveShadows = true;
            if (ctrl.shadowGen) ctrl.shadowGen.getShadowMap().renderList = [g];
            ctrl.ground = g;
            if (!ctrl.lastHeight || depth <= 0) return;
            ctrl.onStatus('Building relief…');
            g.applyDisplacementMap(ctrl.lastHeight.toDataURL(), -depth, depth, () => {
                g.createNormals(true);   // recompute macro normals for the displaced silhouette
                ctrl.onStatus('');
            });
        }

        return {
            ensure,
            setMaps(maps) {
                ctrl.maps = maps;
                ctrl.lastHeight = maps.height || null;
                return ensure().then(ok => {
                    if (!ok) return false;
                    applyMaterial();
                    applyDisplacement();
                    return true;
                });
            },
            /* Toggle a single map's contribution without regenerating. key ∈
               normal|ao|roughness|emissive; 'height' is the relief slider. */
            setEnabled(key, on) {
                ctrl.enabled[key] = on;
                if (ctrl.engine && ctrl.maps) applyMaterial();
            },
            setRelief(v, rebuild) {
                ctrl.relief = v;
                if (rebuild !== false && ctrl.engine) applyDisplacement();
            },
            resize()  { if (ctrl.engine) ctrl.engine.resize(); },
            pause()   { ctrl.active = false; },
            resume()  { ctrl.active = true; if (ctrl.engine) ctrl.engine.resize(); },
            isLoaded(){ return !!ctrl.engine; },
            dispose() {
                ctrl.active = false;
                if (ctrl.engine) { try { ctrl.engine.stopRenderLoop(); ctrl.engine.dispose(); } catch (e) {} }
                ctrl.engine = ctrl.scene = ctrl.ground = ctrl.material = ctrl.shadowGen = null;
                ctrl.textures = []; ctrl._ensure = null;
            }
        };
    }

    return { create, loadBabylon };
})();
