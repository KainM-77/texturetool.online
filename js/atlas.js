/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (C) 2026 KainM-77. This file is the author's own work,
   available under the MIT License (see LICENSE-MIT). The tool as a whole ships
   under GPL-3.0 (see LICENSE) only because it also bundles two GPL-3.0 seamless
   shaders derived from Materialize; this file contains none of that code. */
/* ============================================================
   TRLE Atlas Tool — all-in-one atlas workbench
   Slice an atlas into elements, then per element: make seamless,
   build transitions with another element, assign materials
   (preset or custom), and export the atlas + material map atlases.
   Reuses TRLE.Engine / TRLE.Shaders / TRLE presets from the
   Texture Tool; mask + transition logic ported from app.js.
   ============================================================ */

window.TRLE = window.TRLE || {};

(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    /* ============ STATE ============ */
    const state = {
        image: null,        // uploaded atlas <img>
        tileSize: 256,
        cols: 0,
        elements: [],       // render order == atlas order
        nextId: 1,
        selectedId: null,   // primary of the selection (last clicked)
        selSet: new Set(),  // unified multi-selection (Windows-style icon select)
        selAnchor: null,    // anchor id for Shift+click range selection
        focusedId: null,    // roving-tabindex target for keyboard grid nav
        ctxTargetId: null,  // element the context menu points at
        pickBaseId: null,   // pick-partner mode: locked base element
        pickMode: 'transition', // what the second click builds: 'transition' | 'wang'
        dragId: null,       // element being drag-reordered
        modalReturnFocus: null,  // element to restore focus to when a modal closes
        flipNormalY: false  // global: export normals in DirectX (flipped green) vs OpenGL/TombEngine
    };

    /* element: {
         id, kind: 'tile' | 'transition',
         canvas,            // live diffuse — same canvas object shown in the grid
         original,          // pristine slice (kind 'tile' only)
         seamless: false,
         material: { type, aesthetic, key, custom } | null,
         base, overlay, mode, pivot, hardness   // 'transition' only (parent ids)
       } */
    const byId = id => state.elements.find(e => e.id === id);
    const indexOf = id => state.elements.findIndex(e => e.id === id);

    /* ============ TRANSITION MODES + MASKS (ported from app.js) ============ */
    const TRANS_MODES = [
        { mode: 'Top',                 label: 'Top ⬆️' },
        { mode: 'Bottom',              label: 'Bot ⬇️' },
        { mode: 'Left',                label: 'Left ⬅️' },
        { mode: 'Right',               label: 'Right ➡️' },
        { mode: 'DiagonalTopLeft',     label: '↖️' },
        { mode: 'DiagonalTopRight',    label: '↗️' },
        { mode: 'DiagonalBottomLeft',  label: '↙️' },
        { mode: 'DiagonalBottomRight', label: '↘️' },
        { mode: 'TopFull',             label: 'Top ⬆' },
        { mode: 'BottomFull',          label: 'Bot ⬇' },
        { mode: 'LeftFull',            label: 'Left ⬅' },
        { mode: 'RightFull',           label: 'Right ➡' },
        { mode: 'TopLeftFull',         label: '◤' },
        { mode: 'TopRightFull',        label: '◥' },
        { mode: 'BottomLeftFull',      label: '◣' },
        { mode: 'BottomRightFull',     label: '◢' },
        // Slope/diagonal-split transitions: a clean 45° boundary along the tile
        // diagonal, blending toward the right-angle corner (matches a triangular
        // floor where one half is flat and the other is a slope).
        { mode: 'SlopeTL',             label: '◸ Slope TL' },
        { mode: 'SlopeTR',             label: '◹ Slope TR' },
        { mode: 'SlopeBL',             label: '◺ Slope BL' },
        { mode: 'SlopeBR',             label: '◿ Slope BR' }
    ];

    /* JohnnyJF10 distance-field topology (TgaBuilder, MIT) */
    function computeTopology(mode, nx, ny) {
        switch (mode) {
            case 'Top':              return [Math.min(nx, 1 - nx, 1 - ny), ny];
            case 'Bottom':           return [Math.min(nx, 1 - nx, ny), 1 - ny];
            case 'Left':             return [Math.min(ny, 1 - ny, 1 - nx), nx];
            case 'Right':            return [Math.min(ny, 1 - ny, nx), 1 - nx];
            case 'DiagonalTopLeft':     return [Math.min(1 - nx, 1 - ny), Math.min(nx, ny)];
            case 'DiagonalTopRight':    return [Math.min(nx, 1 - ny), Math.min(1 - nx, ny)];
            case 'DiagonalBottomLeft':  return [Math.min(1 - nx, ny), Math.min(nx, 1 - ny)];
            case 'DiagonalBottomRight': return [Math.min(nx, ny), Math.min(1 - nx, 1 - ny)];
            case 'TopFull':    return [1 - ny, ny];
            case 'BottomFull': return [ny, 1 - ny];
            case 'LeftFull':   return [1 - nx, nx];
            case 'RightFull':  return [nx, 1 - nx];
            case 'TopLeftFull':     return [Math.min(nx, ny),         1 - Math.min(nx, ny)];
            case 'TopRightFull':    return [Math.min(1 - nx, ny),     1 - Math.min(1 - nx, ny)];
            case 'BottomLeftFull':  return [Math.min(nx, 1 - ny),     1 - Math.min(nx, 1 - ny)];
            case 'BottomRightFull': return [Math.min(1 - nx, 1 - ny), 1 - Math.min(1 - nx, 1 - ny)];
            // Diagonal (slope) splits: v rises linearly toward the named right-angle
            // corner; the overlay fills that right-triangle, boundary = the opposite
            // diagonal. Sum is constant (2) so v ∈ [0,1].
            case 'SlopeBR': return [nx + ny,           2.0 - (nx + ny)];        // boundary TR–BL, fills BR
            case 'SlopeTL': return [2.0 - (nx + ny),   nx + ny];                // fills TL
            case 'SlopeBL': return [ny - nx + 1.0,     1.0 - (ny - nx)];        // boundary TL–BR, fills BL
            case 'SlopeTR': return [nx - ny + 1.0,     1.0 - (nx - ny)];        // fills TR
            default: return [0, 0];
        }
    }

    function buildTopologyMask(S, mode, pivot, hardness) {
        pivot    = Math.max(0, Math.min(1, pivot));
        hardness = Math.max(0, Math.min(1, hardness));
        const lower     = pivot * hardness;
        const upper     = 1.0 - (1.0 - pivot) * hardness;
        const isHardCut = upper <= lower + 1e-5;

        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d   = img.data;

        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const nx = S > 1 ? x / (S - 1) : 0.5;
                const ny = S > 1 ? y / (S - 1) : 0.5;
                const [d1, d2] = computeTopology(mode, nx, ny);
                const sum = d1 + d2;
                const v   = sum < 1e-10 ? 0.5 : d1 / sum;
                let w;
                if (isHardCut) w = v >= pivot ? 1.0 : 0.0;
                else w = Math.max(0.0, Math.min(1.0, (v - lower) / (upper - lower)));
                const byte = Math.round(w * 255);
                const idx = (y * S + x) * 4;
                d[idx] = byte; d[idx+1] = byte; d[idx+2] = byte; d[idx+3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);

        // Smooth corner singularities (sub-pixel relative radius)
        const blurR = Math.max(0.75, S / 128);
        const tmp = document.createElement('canvas');
        tmp.width = S; tmp.height = S;
        const tCtx = tmp.getContext('2d');
        tCtx.filter = `blur(${blurR}px)`;
        tCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(tmp, 0, 0);
        return canvas;
    }

    /* ============ WANG MASK (Phase 9) ============
       16-tile edge set: bits N=1, E=2, S=4, W=8. The overlay bleeds in from each
       active edge (1 at the edge → 0 at the far side). Edges are combined with a
       smooth UNION (probabilistic OR) rather than max() — single edges are
       identical, but corners round off instead of leaving a diagonal crease.
       Hardness then sets the width of a smoothstep seam centred on the pivot
       contour: 0 = wide soft blend, 1 = crisp cut. Same white=overlay convention,
       so it drops straight into the existing compositing + material paths. */
    function buildWangMask(S, bits, pivot, hardness) {
        pivot    = Math.max(0, Math.min(1, pivot));
        hardness = Math.max(0, Math.min(1, hardness));
        const hw = (1 - hardness) * 0.5;          // smoothstep half-band in g-space
        const isHardCut = hw < 1e-4;
        const N = bits & 1, E = bits & 2, Sb = bits & 4, W = bits & 8;

        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d   = img.data;

        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const nx = S > 1 ? x / (S - 1) : 0.5;
                const ny = S > 1 ? y / (S - 1) : 0.5;
                // Smooth union: g = 1 - Π(1 - edgeProximity) over active edges.
                let inv = 1;
                if (N)  inv *= ny;          // north proximity (1-ny) → factor 1-(1-ny)=ny
                if (Sb) inv *= 1 - ny;      // south proximity ny     → factor 1-ny
                if (W)  inv *= nx;          // west  proximity (1-nx) → factor nx
                if (E)  inv *= 1 - nx;      // east  proximity nx     → factor 1-nx
                const g = 1 - inv;
                let w;
                if (isHardCut) w = g >= pivot ? 1.0 : 0.0;
                else {
                    const c = Math.max(0, Math.min(1, (g - (pivot - hw)) / (2 * hw)));
                    w = c * c * (3 - 2 * c);   // smoothstep — eased seam, no linear kink
                }
                const byte = Math.round(w * 255);
                const idx = (y * S + x) * 4;
                d[idx] = byte; d[idx+1] = byte; d[idx+2] = byte; d[idx+3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);

        const blurR = Math.max(0.75, S / 128);
        const tmp = document.createElement('canvas');
        tmp.width = S; tmp.height = S;
        const tCtx = tmp.getContext('2d');
        tCtx.filter = `blur(${blurR}px)`;
        tCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(tmp, 0, 0);
        return canvas;
    }

    /* ============ EDGE VIGNETTE MASK (Phase T3) ============
       White at the borders → black in the centre, used to fade a decal's edges
       to transparent. `amt` (0..1) = how far the fade reaches inward; `hardness`
       sharpens the ramp. Same blur tail as the other masks. */
    function buildEdgeVignetteMask(S, amt, hardness) {
        amt = Math.max(0.02, Math.min(1, amt)) * 0.5;     // up to half-tile
        hardness = Math.max(0, Math.min(1, hardness));
        const lower = 0.5 * hardness, upper = 1.0 - 0.5 * hardness;
        const hardCut = upper <= lower + 1e-5;
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d = img.data;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const nx = S > 1 ? x / (S - 1) : 0.5;
                const ny = S > 1 ? y / (S - 1) : 0.5;
                const dist = Math.min(nx, 1 - nx, ny, 1 - ny);   // 0 at edge … 0.5 centre
                let v = 1 - Math.min(1, dist / amt);             // 1 at edge → 0 inside
                if (hardCut) v = v >= 0.5 ? 1 : 0;
                else v = Math.max(0, Math.min(1, (v - lower) / (upper - lower)));
                const byte = Math.round(v * 255);
                const idx = (y * S + x) * 4;
                d[idx] = byte; d[idx + 1] = byte; d[idx + 2] = byte; d[idx + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const blurR = Math.max(0.75, S / 128);
        const tmp = document.createElement('canvas');
        tmp.width = S; tmp.height = S;
        const tCtx = tmp.getContext('2d');
        tCtx.filter = `blur(${blurR}px)`;
        tCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(tmp, 0, 0);
        return canvas;
    }

    function compositeTransition(baseCanvas, overlayCanvas, maskCanvas, size) {
        const result = document.createElement('canvas');
        result.width = size; result.height = size;
        const ctx = result.getContext('2d');
        const baseData = baseCanvas.getContext('2d').getImageData(0, 0, size, size);
        const overData = overlayCanvas.getContext('2d').getImageData(0, 0, size, size);
        const maskData = maskCanvas.getContext('2d').getImageData(0, 0, size, size);
        const outData  = ctx.createImageData(size, size);
        for (let i = 0; i < baseData.data.length; i += 4) {
            const t = maskData.data[i] / 255;
            outData.data[i]     = Math.round(baseData.data[i]     * (1 - t) + overData.data[i]     * t);
            outData.data[i + 1] = Math.round(baseData.data[i + 1] * (1 - t) + overData.data[i + 1] * t);
            outData.data[i + 2] = Math.round(baseData.data[i + 2] * (1 - t) + overData.data[i + 2] * t);
            // Blend alpha too so transparent textures survive transitions (Phase T1).
            outData.data[i + 3] = Math.round(baseData.data[i + 3] * (1 - t) + overData.data[i + 3] * t);
        }
        ctx.putImageData(outData, 0, 0);
        return result;
    }

    /* Compose a transition's DIFFUSE using the chosen blend method (Phase 4).
       'alpha' (default) = the original CPU mask cross-fade (unchanged).
       'height'/'poisson' = GPU options that hide the seam. Material-map
       compositing still uses the plain alpha mask (see deriveMaps). */
    function composeTransitionDiffuse(baseCanvas, overlayCanvas, maskCanvas, size, method, iters) {
        if (!method || method === 'alpha') {
            return compositeTransition(baseCanvas, overlayCanvas, maskCanvas, size);
        }
        const E = TRLE.Engine;
        const baseTex = E.createTextureFromImage(baseCanvas);
        const overTex = E.createTextureFromImage(overlayCanvas);
        const maskTex = E.createTextureFromImage(maskCanvas);
        let out;
        if (method === 'height') {
            const fbo = E.createFBO(size, size);
            E.blit('transitionHeightBlend', {
                u_base: baseTex, u_overlay: overTex, u_mask: maskTex, u_detail: 0.45
            }, fbo);
            out = E.fboToCanvas(fbo);
            E.deleteFBO(fbo);
        } else { // 'poisson'
            const alpha = compositeTransition(baseCanvas, overlayCanvas, maskCanvas, size);
            const alphaTex = E.createTextureFromImage(alpha);
            const fboF = E.poissonBlend(baseTex, overTex, maskTex, alphaTex, size, iters);
            // Resolve the float result into an RGBA8 FBO so fboToCanvas can read it.
            const fbo8 = E.createFBO(size, size);
            E.blit('copy', { u_texture: fboF.texture }, fbo8);
            out = E.fboToCanvas(fbo8);
            // Poisson solves RGB only — restore the mask-blended alpha (Phase T1).
            copyAlphaChannel(out, alpha);
            E.deleteFBO(fboF);
            E.deleteFBO(fbo8);
            E.deleteTexture(alphaTex);
        }
        E.deleteTexture(baseTex);
        E.deleteTexture(overTex);
        E.deleteTexture(maskTex);
        return out;
    }

    /* Flatten transparent pixels to opaque magenta (#FF00FF) — Tomb Editor treats
       pure magenta as invisible. Returns a new canvas; input is untouched. */
    function magentaKey(canvas) {
        const w = canvas.width, h = canvas.height;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        const img = canvas.getContext('2d').getImageData(0, 0, w, h);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; }
            d[i + 3] = 255;   // everything opaque for color-key workflows
        }
        ctx.putImageData(img, 0, 0);
        return out;
    }

    /* Multiply a tile's alpha down by a mask (white → transparent). Returns a new
       canvas. Used by Fade to Transparent (Phase T3). */
    function applyAlphaFade(srcCanvas, maskCanvas) {
        const S = srcCanvas.width;
        const out = document.createElement('canvas');
        out.width = S; out.height = S;
        const ctx = out.getContext('2d');
        const img = srcCanvas.getContext('2d').getImageData(0, 0, S, S);
        const d = img.data;
        const m = maskCanvas.getContext('2d').getImageData(0, 0, S, S).data;
        for (let i = 0; i < d.length; i += 4) {
            d[i + 3] = Math.round(d[i + 3] * (1 - m[i] / 255));
        }
        ctx.putImageData(img, 0, 0);
        return out;
    }

    /* Copy src's alpha channel into dst (same size). Used to restore alpha after
       an RGB-only GPU pass (e.g. Poisson) so transparency survives. */
    function copyAlphaChannel(dst, src) {
        const w = dst.width, h = dst.height;
        const dctx = dst.getContext('2d');
        const d = dctx.getImageData(0, 0, w, h);
        const s = src.getContext('2d').getImageData(0, 0, w, h).data;
        for (let i = 3; i < d.data.length; i += 4) d.data[i] = s[i];
        dctx.putImageData(d, 0, 0);
    }

    /* ============ ORGANIC NOISE (Phase 13) ============
       Seeded fractal value-noise used to author organic, non-linear transition
       masks. Edges can be faded to black ("edge-safe") so the overlay never
       reaches a tile border — keeping neighbouring tiles seamless. Shared by
       the Organic Transition generator and the organic-edge option in the
       other transition creators. */
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /* A 2D value-noise sampler on an integer lattice, deterministically seeded. */
    function makeValueNoise(seed) {
        const rnd = mulberry32(seed);
        const SZ = 256, mask = SZ - 1;
        const perm = new Uint8Array(SZ);
        for (let i = 0; i < SZ; i++) perm[i] = i;
        for (let i = SZ - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
        const grad = new Float32Array(SZ);
        for (let i = 0; i < SZ; i++) grad[i] = rnd();
        const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp = (a, b, t) => a + (b - a) * t;
        const hash = (xi, yi) => grad[(perm[xi & mask] + (yi & mask)) & mask];
        return (x, y) => {
            const xi = Math.floor(x), yi = Math.floor(y);
            const xf = x - xi, yf = y - yi;
            const u = fade(xf), v = fade(yf);
            return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u),
                        lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
        };
    }
    /* Build an organic grayscale mask (white = overlay shows).
       opts: { seed, scale (0..1, larger = bigger patches), coverage (0..1
       overlay fraction), roughness (0..1 edge raggedness), edgeSafe (fade to
       black near borders for seamless tiling), edgeMargin (0..1 of min side),
       hint (grayscale canvas biasing where overlay lands), hintStrength }. */
    function buildOrganicMask(W, H, opts) {
        const o = Object.assign({
            seed: 1, scale: 0.5, coverage: 0.5, roughness: 0.5,
            edgeSafe: true, edgeMargin: 0.12, hint: null, hintStrength: 0.7,
            seam: null   // {segs, top[], right[], bottom[], left[]} — per-side seamless control
        }, opts);
        const noise  = makeValueNoise(o.seed);
        const warp   = makeValueNoise((o.seed ^ 0x9e3779b9) >>> 0);
        const baseFreq = 1.5 + (1 - o.scale) * 10;     // lattice cells across the tile
        const octaves  = 2 + Math.round(o.roughness * 3);
        const warpAmt  = o.roughness * 0.6;
        const soft     = 0.04 + o.roughness * 0.18;    // threshold softness → edge feather
        const thr      = 1 - o.coverage;
        const edgePx   = Math.max(2, Math.min(W, H) * o.edgeMargin);
        const seam     = o.seam && o.seam.segs > 0 ? o.seam : null;
        const useUniform = !seam && o.edgeSafe;   // back-compat: fade all borders
        const fade = (dist) => { const e = dist / edgePx; return e >= 1 ? 1 : e * e * (3 - 2 * e); };
        let hintData = null;
        if (o.hint) hintData = resizeCanvas(o.hint, W, H).getContext('2d').getImageData(0, 0, W, H).data;
        const fbm = (nx, ny) => {
            let amp = 1, freq = 1, sum = 0, norm = 0;
            for (let i = 0; i < octaves; i++) { sum += amp * noise(nx * freq, ny * freq); norm += amp; amp *= 0.5; freq *= 2; }
            return sum / norm;
        };
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        const ctx = out.getContext('2d');
        const img = ctx.createImageData(W, H);
        const d = img.data;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let nx = (x / W) * baseFreq, ny = (y / H) * baseFreq;
                nx += (warp(nx + 5.2, ny + 1.3) - 0.5) * warpAmt * baseFreq * 0.3;
                ny += (warp(nx + 9.7, ny + 4.1) - 0.5) * warpAmt * baseFreq * 0.3;
                let field = fbm(nx, ny);
                const idx = (y * W + x) * 4;
                if (hintData) {
                    const h = hintData[idx] / 255;
                    field = field * (1 - o.hintStrength) + (field * 0.45 + h * 0.55) * o.hintStrength;
                }
                let v = (field - (thr - soft)) / (2 * soft);
                v = v < 0 ? 0 : v > 1 ? 1 : v;
                v = v * v * (3 - 2 * v);
                if (seam) {
                    // Fade only toward the borders whose segment is marked seamless.
                    const sx = Math.min(seam.segs - 1, (x / W * seam.segs) | 0);
                    const sy = Math.min(seam.segs - 1, (y / H * seam.segs) | 0);
                    let f = 1;
                    if (seam.top[sx])    f = Math.min(f, fade(y));
                    if (seam.bottom[sx]) f = Math.min(f, fade(H - 1 - y));
                    if (seam.left[sy])   f = Math.min(f, fade(x));
                    if (seam.right[sy])  f = Math.min(f, fade(W - 1 - x));
                    v *= f;
                } else if (useUniform) {
                    v *= fade(Math.min(x, W - 1 - x, y, H - 1 - y));
                }
                const g = Math.round(v * 255);
                d[idx] = d[idx + 1] = d[idx + 2] = g; d[idx + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return out;
    }

    /* Roughen a mask's edges by domain-warping it with seeded noise — turns a
       clean straight/curved A→B boundary into an organic, ragged one. Applied
       to the whole (global) mask before slicing, so grid tiles stay seamless.
       amount 0..1; returns src unchanged when amount <= 0. */
    function warpMaskOrganic(src, W, H, amount, seed) {
        if (!amount || amount <= 0) return src;
        const nX = makeValueNoise(seed >>> 0);
        const nY = makeValueNoise((seed ^ 0x85ebca6b) >>> 0);
        const freq = 4, maxD = amount * Math.min(W, H) * 0.14;
        const sdata = resizeCanvas(src, W, H).getContext('2d').getImageData(0, 0, W, H).data;
        const sample = (x, y) => {
            x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
            y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
            return sdata[((y | 0) * W + (x | 0)) * 4];
        };
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        const octx = out.getContext('2d');
        const img = octx.createImageData(W, H), d = img.data;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const u = (x / W) * freq, v = (y / H) * freq;
            const dx = (nX(u, v) - 0.5) * 2 * maxD;
            const dy = (nY(u + 3.1, v + 7.7) - 0.5) * 2 * maxD;
            const g = sample(x + dx, y + dy);
            const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        return out;
    }

    /* ============ GENERIC UTILITIES ============ */
    const TOAST_ICONS = { success: '✅', error: '⛔', warning: '⚠️', info: '💡' };
    let toastTimer = null;

    /* Messages render into the left-rail log (newest on top), keeping a short
       scrollback so the user can actually read what happened.
       showToast(msg) → info · showToast(msg,'success') · showToast(msg,'error',ms) */
    const MSG_MAX = 10;
    function showToast(msg, type = 'info', duration) {
        const log = $('at-msg-log-list');
        if (!log) return;
        if (duration == null) duration = type === 'error' ? 18000 : 15000;
        const kind = TOAST_ICONS[type] ? type : 'info';
        const item = document.createElement('div');
        item.className = 'at-msg at-msg-' + kind;
        item.innerHTML = `<span class="toast-icon">${TOAST_ICONS[kind]}</span><span class="toast-msg"></span>`;
        item.querySelector('.toast-msg').textContent = msg;
        log.insertBefore(item, log.firstChild);
        while (log.children.length > MSG_MAX) log.removeChild(log.lastChild);
        requestAnimationFrame(() => item.classList.add('show'));
        setTimeout(() => {
            item.classList.remove('show');
            setTimeout(() => { if (item.parentNode) item.remove(); }, 300);
        }, duration);
    }

    /* ============ PREFS (localStorage) ============ */
    const PREFS_KEY = 'trle-atlas-prefs';
    const prefs = (() => {
        try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
        catch { return {}; }
    })();
    function savePref(key, value) {
        prefs[key] = value;
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
        catch { /* storage full or disabled — ignore */ }
    }

    /* ============ USER MATERIAL PRESETS (localStorage) ============
       Saved materials the user can reuse across tiles, batches and projects.
       Each is { id, name, preset } where `preset` is a full resolved preset
       object (base props + any slider tweaks), so it generates maps on its own
       and survives even if the original built-in preset changes. */
    const USER_PRESETS_KEY = 'trle-atlas-matpresets';
    let userPresets = (() => {
        try { const a = JSON.parse(localStorage.getItem(USER_PRESETS_KEY)); return Array.isArray(a) ? a : []; }
        catch { return []; }
    })();
    function persistUserPresets() {
        try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets)); }
        catch { /* storage full or disabled — ignore */ }
    }
    function userPresetById(id) { return userPresets.find(p => p.id === id) || null; }
    function newPresetId() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    /* ============ BUSY STATE ============ */
    function setBusy(btn, busy, busyLabel) {
        if (!btn) return;
        if (busy) {
            if (btn.dataset.idleLabel == null) btn.dataset.idleLabel = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('btn-busy');
            btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${busyLabel || 'Working…'}`;
        } else {
            btn.disabled = false;
            btn.classList.remove('btn-busy');
            if (btn.dataset.idleLabel != null) {
                btn.innerHTML = btn.dataset.idleLabel;
                delete btn.dataset.idleLabel;
            }
        }
    }

    function resizeCanvas(src, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, 0, 0, w, h);
        return c;
    }

    function cloneCanvas(src) {
        return resizeCanvas(src, src.width, src.height);
    }

    /* Geometric transform (90° rotation + flips) used to re-orient a transition's
       overlay (B) texture. geom = { rot:0|90|180|270, flipH, flipV }. Returns a new
       canvas (or the source unchanged when geom is identity/absent). */
    function geomIsIdentity(g) { return !g || (!g.rot && !g.flipH && !g.flipV); }
    function geomTransform(src, geom) {
        if (geomIsIdentity(geom)) return src;
        const S = src.width;
        const out = document.createElement('canvas'); out.width = S; out.height = S;
        const ctx = out.getContext('2d');
        ctx.translate(S / 2, S / 2);
        if (geom.rot) ctx.rotate(geom.rot * Math.PI / 180);   // canvas matrix becomes R·diag(flip)
        ctx.scale(geom.flipH ? -1 : 1, geom.flipV ? -1 : 1);
        ctx.drawImage(src, -S / 2, -S / 2);
        return out;
    }
    /* After geomTransform on a NORMAL map, rotate/flip the encoded XY vectors to
       match the pixel transform (Z/B unchanged). Mutates the canvas in place. */
    function normalFixGeom(canvas, geom) {
        if (geomIsIdentity(geom)) return;
        const t = (geom.rot || 0) * Math.PI / 180;
        const cs = Math.round(Math.cos(t)), sn = Math.round(Math.sin(t));
        const fx = geom.flipH ? -1 : 1, fy = geom.flipV ? -1 : 1;
        // Linear part L = R(t)·diag(fx,fy) with canvas (y-down) rotation [[cos,-sin],[sin,cos]].
        const a = cs * fx, b = -sn * fy, c = sn * fx, d = cs * fy;
        const ctx = canvas.getContext('2d'), S = canvas.width;
        const img = ctx.getImageData(0, 0, S, S), px = img.data;
        for (let i = 0; i < px.length; i += 4) {
            const nx = px[i] / 255 * 2 - 1, ny = px[i + 1] / 255 * 2 - 1;
            px[i]     = Math.round((Math.max(-1, Math.min(1, a * nx + b * ny)) * 0.5 + 0.5) * 255);
            px[i + 1] = Math.round((Math.max(-1, Math.min(1, c * nx + d * ny)) * 0.5 + 0.5) * 255);
        }
        ctx.putImageData(img, 0, 0);
    }

    /* Blur + scale a hand-painted mask to S so its boundary is soft, matching
       the look of the generated topology masks. */
    function softenMask(src, S) {
        const out = document.createElement('canvas');
        out.width = S; out.height = S;
        const ctx = out.getContext('2d');
        ctx.filter = `blur(${Math.max(0.75, S / 128)}px)`;
        ctx.drawImage(src, 0, 0, S, S);
        ctx.filter = 'none';
        return out;
    }
    /* Feather a selection mask by an explicit pixel radius (0 = crisp edge).
       Used by multi-material layers to soften the boundary between materials. */
    function featherMask(src, S, px) {
        if (!px || px < 0.5) return src;
        const out = document.createElement('canvas');
        out.width = S; out.height = S;
        const ctx = out.getContext('2d');
        ctx.filter = `blur(${px}px)`;
        ctx.drawImage(src, 0, 0, S, S);
        ctx.filter = 'none';
        return out;
    }

    /* Multi-material compositor (shared by deriveMaps + the modal preview).
       Generates each layer's maps from the same diffuse, then composites them in
       order through each region layer's (optionally feathered) mask. Returns a
       { mapType: canvas } object. Later layers win where masks overlap. */
    function composeLayerMaps(diffuseCanvas, layers, enabledMaps, S) {
        const tex = TRLE.Engine.createTextureFromImage(diffuseCanvas);
        const genLayer = (layer) => {
            const preset = Object.assign({}, presetFromMaterial(layer.material),
                { flipNormalY: state.flipNormalY, heightSeamless: heightSeamlessOn() });
            const maps = TRLE.Engine.generateMaps(tex, S, S, preset, enabledMaps);
            const out = {};
            for (const mt of TRLE.MapOrder) if (maps[mt]) { out[mt] = TRLE.Engine.fboToCanvas(maps[mt]); TRLE.Engine.deleteFBO(maps[mt]); }
            return out;
        };
        let result = genLayer(layers[0]);                 // base layer covers the whole tile
        for (let li = 1; li < layers.length; li++) {
            const layer = layers[li];
            if (!layer.mask) continue;
            const lm = genLayer(layer);
            const mask = featherMask(layer.mask, S, layer.feather || 0);
            for (const mt of TRLE.MapOrder)
                if (result[mt] && lm[mt]) result[mt] = compositeTransition(result[mt], lm[mt], mask, S);
        }
        TRLE.Engine.deleteTexture(tex);
        return result;
    }

    /* ============ REUSABLE MASK BRUSH (Phase 5) ============
       Wires pointer painting on a display canvas into an offscreen grayscale
       mask canvas (white = paint, black = erase). Generic so the Phase-6 heal
       tool can reuse it. opts: { active, brushSize, erase, onPaint }. */
    function attachMaskBrush(displayCanvas, maskCanvas, opts) {
        let drawing = false, lastX = 0, lastY = 0;

        const pos = (ev) => {
            const r = displayCanvas.getBoundingClientRect();
            return [
                (ev.clientX - r.left) / r.width  * maskCanvas.width,
                (ev.clientY - r.top)  / r.height * maskCanvas.height
            ];
        };
        const radiusPx = () => {
            const r = displayCanvas.getBoundingClientRect();
            return Math.max(1, opts.brushSize() * (maskCanvas.width / r.width));
        };
        const dab = (x, y, radius) => {
            const ctx = maskCanvas.getContext('2d');
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = opts.erase() ? '#000' : '#fff';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        };
        const strokeTo = (x, y) => {
            const radius = radiusPx();
            const dx = x - lastX, dy = y - lastY;
            const dist = Math.hypot(dx, dy);
            const n = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.4)));
            for (let i = 1; i <= n; i++) dab(lastX + dx * i / n, lastY + dy * i / n, radius);
            lastX = x; lastY = y;
        };

        displayCanvas.addEventListener('pointerdown', e => {
            if (!opts.active()) return;
            drawing = true;
            try { displayCanvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
            [lastX, lastY] = pos(e);
            dab(lastX, lastY, radiusPx());
            opts.onPaint();
            e.preventDefault();
        });
        displayCanvas.addEventListener('pointermove', e => {
            if (!drawing || !opts.active()) return;
            const [x, y] = pos(e);
            strokeTo(x, y);
            opts.onPaint();
            e.preventDefault();
        });
        const end = e => {
            if (!drawing) return;
            drawing = false;
            try { displayCanvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        };
        displayCanvas.addEventListener('pointerup', end);
        displayCanvas.addEventListener('pointercancel', end);
    }

    function downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    function setupUpload(uploadId, fileId, callback) {
        const area = $(uploadId);
        const input = $(fileId);
        input.addEventListener('change', e => {
            if (e.target.files[0]) loadImageFile(e.target.files[0], area, callback);
        });
        area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
        area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
        area.addEventListener('drop', e => {
            e.preventDefault();
            area.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) loadImageFile(e.dataTransfer.files[0], area, callback);
        });
    }

    /* Is this file a TGA? Browsers can't decode TGA in <img>, so we sniff it by
       extension (its MIME type is unreliable — often empty or image/x-tga). */
    function isTGAFile(file) {
        return /\.tga$/i.test(file.name || '') ||
               /tga/i.test(file.type || '');
    }

    /* Read any supported image file into a real <img> element, so every caller
       downstream gets a uniform HTMLImageElement (naturalWidth/Height etc.).
       PNG/JPEG/GIF/WebP/BMP go straight through the browser; TGA is decoded by
       hand (TRLE.Engine.decodeTGA) then re-encoded to a PNG data-URL. Returns a
       Promise that rejects with a human-readable Error on any failure. */
    function readImageFile(file) {
        if (isTGAFile(file)) {
            return file.arrayBuffer().then(buf => {
                let canvas;
                try {
                    canvas = TRLE.Engine.decodeTGA(buf);
                } catch (err) {
                    throw new Error(`Couldn’t read “${file.name}”: ${err.message}`);
                }
                return loadImageURL(canvas.toDataURL('image/png')).then(img => {
                    if (!img) throw new Error(`Couldn’t decode “${file.name}”.`);
                    return img;
                });
            });
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(
                    `Couldn’t read “${file.name}”. Unsupported or corrupt image — try PNG or TGA.`));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error(`Couldn’t read “${file.name}”.`));
            reader.readAsDataURL(file);
        });
    }

    function loadImageFile(file, area, callback) {
        readImageFile(file).then(img => {
            area.querySelectorAll('.preview-img').forEach(el => el.remove());
            const preview = document.createElement('img');
            preview.className = 'preview-img';
            preview.src = img.src;
            area.appendChild(preview);
            area.querySelector('.upload-text').textContent =
                `${file.name} (${img.naturalWidth}×${img.naturalHeight})`;
            callback(img, file.name);
        }).catch(err => showToast(err.message, 'error'));
    }

    /* ============ MATERIALS ============ */
    const DEFAULTS = { solid: 'stone', liquid: 'still_water' };

    function getPreset(type, key, aesthetic) {
        if (aesthetic === 'saved') {
            const u = userPresetById(key);
            return u ? Object.assign({}, u.preset) : null;
        }
        return type === 'liquid'
            ? TRLE.getLiquidPreset(key, aesthetic)
            : TRLE.getSolidPreset(key, aesthetic);
    }

    /* Resolve a material descriptor ({type,aesthetic,key,custom}) to a preset
       object. Shared by single-material tiles and per-layer multi-materials. */
    function presetFromMaterial(m) {
        if (!m) return getPreset('solid', DEFAULTS.solid, 'realistic');
        if (m.custom) return m.custom;
        return getPreset(m.type, m.key, m.aesthetic) || getPreset('solid', DEFAULTS.solid, 'realistic');
    }
    function resolvePreset(el) {
        return presetFromMaterial(el.material);
    }

    /* A tile carries multiple materials (one per painted region) when it has ≥2
       layers: a base + at least one masked region. */
    function hasMatLayers(el) {
        return Array.isArray(el.matLayers) && el.matLayers.length >= 2;
    }

    function materialLabel(el) {
        if (el.kind === 'transition') {
            const a = byId(el.base), b = byId(el.overlay);
            return `${a ? materialLabel(a) : '?'} ↔ ${b ? materialLabel(b) : '?'}`;
        }
        if (hasMatLayers(el)) return `Multi-material (${el.matLayers.length} layers)`;
        if (!el.material) return 'Stone (default)';
        const p = resolvePreset(el);
        return (p.label || el.material.key) + (el.material.custom ? ' *' : '');
    }

    /* ============ GRID ============ */
    function visCols() { return Math.min(Math.max(1, state.cols), 12); }
    function cellById(id) { return $('at-grid').querySelector(`.at-cell[data-id="${id}"]`); }

    function cellAriaLabel(el, i) {
        const parts = [`Element ${i + 1}`, el.kind === 'transition' ? 'transition tile' : 'tile'];
        parts.push(el.kind === 'transition' ? 'material inherited' : materialLabel(el));
        if (el.seamless) parts.push('seamless');
        if (state.selSet.has(el.id)) parts.push('selected');
        return parts.join(', ');
    }

    function renderGrid() {
        const grid = $('at-grid');
        // Preserve keyboard focus across re-render if a cell was focused.
        const active = document.activeElement;
        const hadCellFocus = !!(active && active.classList && active.classList.contains('at-cell'));
        grid.innerHTML = '';
        const cols = Math.max(1, state.cols);
        grid.style.gridTemplateColumns = `repeat(${Math.min(cols, 12)}, 1fr)`;
        grid.style.maxWidth = `${Math.min(cols, 12) * 116}px`;

        // Keep the layout (columns/rows) controls in sync with the current grid.
        const colsInput = $('at-cols-input'), rowsInput = $('at-rows-input'), note = $('at-layout-note');
        const N = state.elements.length, rows = N ? Math.ceil(N / cols) : 0;
        if (colsInput) colsInput.value = cols;
        if (rowsInput) rowsInput.value = rows;
        if (note) note.textContent = N ? `${N} tile${N !== 1 ? 's' : ''}` : 'empty';

        // Keep the roving-tabindex target valid.
        if (!state.elements.some(e => e.id === state.focusedId)) {
            state.focusedId = state.elements.length ? state.elements[0].id : null;
        }

        state.elements.forEach((el, i) => {
            const cell = document.createElement('div');
            cell.className = 'at-cell';
            cell.dataset.id = el.id;
            cell.setAttribute('role', 'gridcell');
            cell.tabIndex = (el.id === state.focusedId) ? 0 : -1;
            const isSel = state.selSet.has(el.id);
            cell.setAttribute('aria-selected', isSel ? 'true' : 'false');
            cell.setAttribute('aria-label', cellAriaLabel(el, i));
            if (isSel) cell.classList.add('selected');
            if (el.id === state.selectedId) cell.classList.add('at-primary');
            if (el.id === state.pickBaseId) cell.classList.add('locked');
            else if (state.pickBaseId !== null) cell.classList.add('pickable');

            cell.appendChild(el.canvas);   // live canvas — edits show automatically

            const idx = document.createElement('span');
            idx.className = 'at-idx';
            idx.textContent = i + 1;
            cell.appendChild(idx);

            const badges = document.createElement('span');
            badges.className = 'at-badges';
            if (el.seamless && el.kind !== 'anim') badges.innerHTML += '<span class="at-badge at-badge-s" title="Seamless applied">S</span>';
            if (el.kind === 'transition') badges.innerHTML += '<span class="at-badge at-badge-t" title="Transition tile">T</span>';
            if (el.kind === 'anim') {
                const a = el.anim || {};
                badges.innerHTML += `<span class="at-badge at-badge-a" title="Animated frame ${(a.index || 0) + 1} of ${a.total || 1}">A${a.total > 1 ? (a.index || 0) + 1 : ''}</span>`;
            }
            cell.appendChild(badges);

            const lbl = document.createElement('span');
            lbl.className = 'at-mat-label';
            lbl.textContent = materialLabel(el);
            cell.appendChild(lbl);

            cell.addEventListener('click', e => { setGridFocus(el.id, false); onCellClick(el.id, e); });
            cell.addEventListener('contextmenu', e => {
                e.preventDefault();
                setGridFocus(el.id, false);
                // Right-clicking a tile outside the current multi-selection makes it
                // the single selection, so context actions act on what you clicked.
                if (!state.selSet.has(el.id)) selectSingle(el.id);
                openCtxMenu(el.id, e.clientX, e.clientY);
            });

            // Drag-to-reorder (disabled during transition pick-partner mode).
            cell.draggable = (state.pickBaseId === null);
            cell.addEventListener('dragstart', e => {
                state.dragId = el.id;
                e.dataTransfer.effectAllowed = 'move';
                cell.classList.add('at-dragging');
            });
            cell.addEventListener('dragend', () => {
                state.dragId = null;
                cell.classList.remove('at-dragging');
                grid.querySelectorAll('.at-drop-target').forEach(c => c.classList.remove('at-drop-target'));
            });
            cell.addEventListener('dragover', e => {
                if (state.dragId == null || state.dragId === el.id) return;
                e.preventDefault();
                cell.classList.add('at-drop-target');
            });
            cell.addEventListener('dragleave', () => cell.classList.remove('at-drop-target'));
            cell.addEventListener('drop', e => {
                e.preventDefault();
                cell.classList.remove('at-drop-target');
                reorderElements(state.dragId, el.id);
            });
            grid.appendChild(cell);
        });

        // Persistent "+" add-tile cell at the end of the grid (Phase A).
        const addCell = document.createElement('div');
        addCell.className = 'at-add-cell';
        addCell.tabIndex = 0;
        addCell.setAttribute('role', 'button');
        addCell.setAttribute('aria-label', 'Add image tiles');
        addCell.title = 'Add image tiles';
        addCell.innerHTML = '<span class="at-add-plus">＋</span>';
        addCell.addEventListener('click', triggerAddImages);
        addCell.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerAddImages(); }
        });
        grid.appendChild(addCell);

        if (hadCellFocus && state.focusedId != null) {
            const c = cellById(state.focusedId);
            if (c) c.focus();
        }
        updateBulkBar();
    }

    /* Move the roving-tabindex target without a full re-render. */
    function setGridFocus(id, focusEl = true) {
        state.focusedId = id;
        $('at-grid').querySelectorAll('.at-cell').forEach(c => {
            c.tabIndex = (Number(c.dataset.id) === id) ? 0 : -1;
        });
        if (focusEl) { const c = cellById(id); if (c) c.focus(); }
    }

    function onGridKeydown(e) {
        const cellEl = e.target.closest && e.target.closest('.at-cell');
        if (!cellEl) return;
        const id = Number(cellEl.dataset.id);
        const i = indexOf(id);
        if (i < 0) return;
        const vc = visCols();
        const last = state.elements.length - 1;
        let target = null;

        // Ctrl/Cmd+Arrow = move (reorder) the focused element.
        if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            moveElement(id, e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }

        switch (e.key) {
            case 'ArrowLeft':  target = i - 1; break;
            case 'ArrowRight': target = i + 1; break;
            case 'ArrowUp':    target = i - vc; break;
            case 'ArrowDown':  target = i + vc; break;
            case 'Home':       target = 0; break;
            case 'End':        target = last; break;
            case 'Enter':
            case ' ':          e.preventDefault(); onCellClick(id); return;
            case 'ContextMenu': e.preventDefault(); openCtxMenuForCell(id); return;
            case 'F10':        if (e.shiftKey) { e.preventDefault(); openCtxMenuForCell(id); } return;
            case 's': case 'S': e.preventDefault(); runCtxAction('seamless', id); return;
            case 't': case 'T': e.preventDefault(); runCtxAction('transition', id); return;
            case 'm': case 'M': e.preventDefault(); runCtxAction('material', id); return;
            case 'h': case 'H': e.preventDefault(); runCtxAction('heal', id); return;
            case 'r': case 'R': e.preventDefault(); runCtxAction('reset', id); return;
            case 'Delete':
            case 'Backspace':  e.preventDefault(); runCtxAction('delete', id); return;
            default: return;
        }
        if (target != null) {
            e.preventDefault();
            target = Math.max(0, Math.min(last, target));
            setGridFocus(state.elements[target].id);
        }
    }

    function setupGrid() {
        const grid = $('at-grid');
        grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', 'Atlas elements — arrow keys to move, Enter to select, S/T/M for actions');
        grid.addEventListener('keydown', onGridKeydown);
        $('at-cols-input').addEventListener('change', e => setColumns(parseInt(e.target.value)));
        $('at-rows-input').addEventListener('change', e => setRows(parseInt(e.target.value)));
    }

    /* Reflow the atlas into a new column count (elements keep their order). */
    function setColumns(n) {
        if (!Number.isFinite(n)) { renderGrid(); return; }
        n = Math.max(1, Math.min(12, Math.round(n)));
        if (n === state.cols) { renderGrid(); return; }
        state.cols = n;
        renderGrid();
        pushHistory(`Columns: ${n}`);
    }

    /* Set columns indirectly by target row count (cols = ceil(N / rows)). */
    function setRows(r) {
        if (!Number.isFinite(r)) { renderGrid(); return; }
        const N = Math.max(1, state.elements.length);
        r = Math.max(1, Math.min(99, Math.round(r)));
        const n = Math.max(1, Math.min(12, Math.ceil(N / r)));
        if (n === state.cols) { renderGrid(); return; }
        state.cols = n;
        renderGrid();
        pushHistory(`Rows: ${Math.ceil(N / n)}`);
    }

    /* Effective tile size from the picker: a preset value, or the Custom field,
       clamped to 16–2048. Default 256. */
    function getTileSize() {
        const sel = $('at-tile-size');
        let v = (sel && sel.value === 'custom')
            ? parseInt($('at-tile-size-custom').value)
            : parseInt(sel ? sel.value : '256');
        if (!Number.isFinite(v) || v <= 0) v = 256;
        return Math.max(16, Math.min(2048, v));
    }

    /* Grey filler tile (same look as "Add Blank"), used to pad the atlas to a
       row boundary so a grid-shaped block starts at column 0 and keeps its shape. */
    function makeSpacerTile() {
        const S = state.tileSize;
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
        return { id: state.nextId++, kind: 'tile', canvas, original: cloneCanvas(canvas),
                 seamless: false, edited: false, material: null };
    }

    /* Add a grid-shaped block of tiles that reads best at `width` columns. If the
       atlas already holds tiles in a different column count, ask whether to reflow
       it to `width` so the block lines up. The last row is padded with blank
       spacer tiles when needed so the block starts on a fresh row (otherwise the
       arrangement would shear). Falsy width = just add (no reflow, no padding). */
    function confirmResizeCols(width, addFn) {
        const padThenAdd = () => {
            if (width) while (state.elements.length % width) state.elements.push(makeSpacerTile());
            addFn();
        };
        if (!width || state.cols === width || state.elements.length === 0) {
            if (width && state.elements.length === 0) state.cols = width;
            padThenAdd();
            return;
        }
        const pads = (width - (state.elements.length % width)) % width;
        openConfirm(
            '🧩 Arrange as a grid?',
            `This set reads best as a ${width}-column block, but the atlas is ${state.cols} columns. ` +
            `Resize the atlas to ${width} columns so the tiles line up? Existing tiles reflow into ${width} columns.` +
            (pads ? ` ${pads} blank spacer tile${pads > 1 ? 's' : ''} will pad the last row so the block starts on a fresh row.` : ''),
            `Resize to ${width} columns & add`,
            () => { state.cols = width; padThenAdd(); },
            { danger: false, cancelLabel: 'Cancel' }
        );
    }

    function onCellClick(id, e) {
        if (state.pickBaseId !== null) {
            const base = state.pickBaseId, mode = state.pickMode;
            // Can't pair with itself — except a border set, which can be built
            // from one texture (origami: same texture folded/mirrored for trim).
            if (id === base && mode !== 'borderset') return;
            if (mode === 'wang') openWangModal(base, id);
            else if (mode === 'borderset') openBsetModal(base, id);
            else if (mode === 'anchor') openAnchorModal(base, id);
            else if (mode === 'transgrid') openTransGridModal(base, id);
            else if (mode === 'organic') openOrganicModal(base, id);
            else if (mode === 'heighttrans') openHeightModal(base, id);
            else if (mode === 'recolor') openRecolorModal(base, id);
            else openTransModal(base, id);
            return;
        }
        // Windows-style icon selection: plain click selects one; Ctrl/Cmd toggles;
        // Shift extends a range from the anchor.
        const ctrl = !!(e && (e.ctrlKey || e.metaKey));
        const shift = !!(e && e.shiftKey);
        if (shift && state.selAnchor != null && byId(state.selAnchor)) {
            selectRange(state.selAnchor, id, ctrl);
        } else if (ctrl) {
            toggleInSelection(id);
        } else if (state.selSet.size === 1 && state.selSet.has(id)) {
            clearSelection();                 // click the lone selection again → deselect
        } else {
            selectSingle(id);
        }
        renderGrid();
        updateBulkBar();
    }

    /* ============ SELECTION (Windows-style multi-select) ============ */
    function selectSingle(id) {
        state.selSet.clear();
        if (id != null) state.selSet.add(id);
        state.selectedId = id;
        state.selAnchor = id;
    }
    function clearSelection() {
        if (!state.selSet.size && state.selectedId == null) return;
        state.selSet.clear();
        state.selectedId = null;
        state.selAnchor = null;
    }
    function toggleInSelection(id) {
        if (state.selSet.has(id)) state.selSet.delete(id);
        else state.selSet.add(id);
        state.selectedId = state.selSet.has(id) ? id : (state.selSet.size ? state.selectedId : null);
        state.selAnchor = id;
    }
    function selectRange(anchorId, toId, additive) {
        const a = indexOf(anchorId), b = indexOf(toId);
        if (a < 0 || b < 0) return;
        if (!additive) state.selSet.clear();
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) state.selSet.add(state.elements[i].id);
        state.selectedId = toId;   // anchor stays put for further Shift+clicks
    }
    /* Replace the selection with a set of ids (used by marquee/select-all). */
    function setSelection(ids, additive) {
        if (!additive) state.selSet.clear();
        ids.forEach(id => state.selSet.add(id));
        if (state.selSet.size) { state.selectedId = ids[ids.length - 1] ?? state.selectedId; state.selAnchor = state.selectedId; }
    }
    function selectAll() {
        setSelection(state.elements.map(e => e.id), false);
        renderGrid(); updateBulkBar();
    }
    /* Jump to a transition's source tile: select it, focus it, scroll to it. */
    function gotoSourceTile(srcId) {
        const src = byId(srcId);
        if (!src) { showToast('Source tile not found — was it deleted?', 'error'); return; }
        selectSingle(srcId);
        state.focusedId = srcId;
        renderGrid(); updateBulkBar();
        const cell = cellById(srcId);
        if (cell) {
            cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cell.focus({ preventScroll: true });
        }
        showToast(`Jumped to tile ${indexOf(srcId) + 1} — set its material here`, 'info', 2500);
    }
    /* Selected ids in atlas order (so bulk ops preserve relative order). */
    function selectedIdsInOrder() {
        return state.elements.filter(e => state.selSet.has(e.id)).map(e => e.id);
    }

    /* ---- Bulk-action bar (appears when ≥2 tiles are selected) ---- */
    function updateBulkBar() {
        const bar = $('at-bulk-bar'); if (!bar) return;
        const n = state.selSet.size;
        bar.style.display = n >= 2 ? 'flex' : 'none';
        const cnt = $('at-bulk-count'); if (cnt) cnt.textContent = n;
    }
    function setupBulkBar() {
        $('at-bulk-clear').addEventListener('click', () => { clearSelection(); renderGrid(); });
        $('at-bulk-delete').addEventListener('click', () => { const ids = selectedIdsInOrder(); if (ids.length) confirmDelete(ids); });
        $('at-bulk-material').addEventListener('click', bulkApplyMaterial);
        $('at-bulk-gather').addEventListener('click', gatherSelection);
        $('at-bulk-front').addEventListener('click', () => moveSelection(true));
        $('at-bulk-back').addEventListener('click', () => moveSelection(false));
    }

    /* Gather the selected tiles into one contiguous block at the position of the
       earliest selected tile (relative order preserved). "Group together". */
    function gatherSelection() {
        const ids = selectedIdsInOrder();
        if (ids.length < 2) return;
        const idSet = new Set(ids);
        const anchorIdx = Math.min(...ids.map(indexOf));
        const sel  = state.elements.filter(e => idSet.has(e.id));
        const rest = state.elements.filter(e => !idSet.has(e.id));
        const insertPos = state.elements.slice(0, anchorIdx).filter(e => !idSet.has(e.id)).length;
        rest.splice(insertPos, 0, ...sel);
        state.elements = rest;
        enforceAnimOrder(); enforceTransitionOrder();
        renderGrid();
        pushHistory('Group tiles together');
        showToast(`Grouped ${ids.length} tiles together`, 'success');
    }

    /* Move the selected tiles to the start / end of the atlas (relative order kept). */
    function moveSelection(toFront) {
        const ids = selectedIdsInOrder();
        if (!ids.length) return;
        const idSet = new Set(ids);
        const sel  = state.elements.filter(e => idSet.has(e.id));
        const rest = state.elements.filter(e => !idSet.has(e.id));
        state.elements = toFront ? [...sel, ...rest] : [...rest, ...sel];
        enforceAnimOrder(); enforceTransitionOrder();
        renderGrid();
        pushHistory(toFront ? 'Move to front' : 'Move to back');
        showToast(`Moved ${ids.length} tile${ids.length !== 1 ? 's' : ''} to ${toFront ? 'front' : 'back'}`, 'success');
    }

    /* Open the material modal to apply one material to the whole selection.
       Transition tiles inherit materials, so they're skipped. */
    function bulkApplyMaterial() {
        const ids = selectedIdsInOrder().filter(id => { const el = byId(id); return el && el.kind !== 'transition'; });
        const skipped = state.selSet.size - ids.length;
        if (!ids.length) { showToast('Transition tiles inherit materials — select some plain/animated tiles', 'info'); return; }
        if (skipped > 0) showToast(`${skipped} transition tile${skipped !== 1 ? 's' : ''} will keep their inherited material`, 'info', 3500);
        openMatModalBatch(ids);
    }

    /* ---- Rubber-band marquee selection over the grid background ---- */
    function setupSelectionMarquee() {
        const grid = $('at-grid');
        grid.addEventListener('mousedown', e => {
            if (e.button !== 0 || state.pickBaseId !== null) return;
            if (e.target.closest('.at-cell') || e.target.closest('.at-add-cell')) return;  // drags start on background only
            const additive = e.ctrlKey || e.metaKey || e.shiftKey;
            const baseSel = new Set(state.selSet);
            const start = { x: e.clientX, y: e.clientY };
            let moved = false;
            const box = document.createElement('div');
            box.className = 'at-marquee';
            grid.appendChild(box);
            const onMove = ev => {
                const x0 = Math.min(start.x, ev.clientX), y0 = Math.min(start.y, ev.clientY);
                const x1 = Math.max(start.x, ev.clientX), y1 = Math.max(start.y, ev.clientY);
                if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 4) moved = true;
                const gr = grid.getBoundingClientRect();
                box.style.left = (x0 - gr.left + grid.scrollLeft) + 'px';
                box.style.top  = (y0 - gr.top + grid.scrollTop) + 'px';
                box.style.width = (x1 - x0) + 'px';
                box.style.height = (y1 - y0) + 'px';
                const hit = [];
                grid.querySelectorAll('.at-cell').forEach(c => {
                    const cr = c.getBoundingClientRect();
                    if (cr.right >= x0 && cr.left <= x1 && cr.bottom >= y0 && cr.top <= y1) hit.push(Number(c.dataset.id));
                });
                state.selSet = new Set(additive ? [...baseSel, ...hit] : hit);
                if (hit.length) { state.selectedId = hit[hit.length - 1]; state.selAnchor = state.selectedId; }
                grid.querySelectorAll('.at-cell').forEach(c => c.classList.toggle('selected', state.selSet.has(Number(c.dataset.id))));
                updateBulkBar();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (box.parentNode) box.parentNode.removeChild(box);
                if (!moved && !additive) clearSelection();   // plain click on empty background → clear
                renderGrid();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
        // Ctrl/Cmd+A → select all (when not typing and no modal is open)
        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || (e.key !== 'a' && e.key !== 'A')) return;
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if ($('at-overlay').style.display !== 'none') return;
            if (!state.elements.length || $('at-grid-card').style.display === 'none') return;
            e.preventDefault();
            selectAll();
        });
    }

    /* ============ REORDER (Phase 8) ============
       Keeps the invariant that a transition always follows both its parents
       (so the single in-order refreshTransitions pass stays correct). After a
       free reorder we repair any transition that ended up before a parent.
       Returns true if a repair was needed. */
    function enforceTransitionOrder() {
        let repaired = false;
        for (let guard = 0; guard < state.elements.length + 1; guard++) {
            let moved = false;
            for (let i = 0; i < state.elements.length; i++) {
                const el = state.elements[i];
                if (el.kind !== 'transition') continue;
                const maxParent = Math.max(indexOf(el.base), indexOf(el.overlay));
                if (maxParent > i) {
                    state.elements.splice(i, 1);
                    const insertAt = Math.max(indexOf(el.base), indexOf(el.overlay)) + 1;
                    state.elements.splice(insertAt, 0, el);
                    moved = true; repaired = true;
                    break;
                }
            }
            if (!moved) break;
        }
        return repaired;
    }

    /* Keep each multi-frame animation group contiguous and in frame order. A
       group is re-emitted at the position of its first-encountered member, so
       dragging a group's first frame moves the whole group. Returns true if the
       order was changed. */
    function enforceAnimOrder() {
        const emitted = new Set();
        const result = [];
        for (const el of state.elements) {
            if (el.kind === 'anim' && el.anim && el.anim.total > 1) {
                if (emitted.has(el.anim.group)) continue;   // skip out-of-place members
                emitted.add(el.anim.group);
                const members = state.elements
                    .filter(e => e.kind === 'anim' && e.anim && e.anim.group === el.anim.group)
                    .sort((a, b) => a.anim.index - b.anim.index);
                result.push(...members);
            } else {
                result.push(el);
            }
        }
        let changed = result.length !== state.elements.length;
        for (let i = 0; !changed && i < result.length; i++) if (result[i] !== state.elements[i]) changed = true;
        state.elements = result;
        return changed;
    }

    function reorderElements(dragId, targetId) {
        if (dragId == null || dragId === targetId) return;
        const from = indexOf(dragId);
        if (from < 0) return;
        const [moved] = state.elements.splice(from, 1);
        const insertAt = indexOf(targetId);   // target index after removal → insert before target
        state.elements.splice(insertAt, 0, moved);
        enforceAnimOrder();
        const repaired = enforceTransitionOrder();
        state.focusedId = dragId;
        renderGrid();
        pushHistory('Reorder');
        showToast(repaired ? 'Reordered (transitions kept after their sources)' : 'Reordered', 'success');
    }

    /* Keyboard reorder: move the focused element one slot (Ctrl/Cmd+Arrow). */
    function moveElement(id, dir) {
        const i = indexOf(id), j = i + dir;
        if (i < 0 || j < 0 || j >= state.elements.length) return;
        const a = state.elements;
        [a[i], a[j]] = [a[j], a[i]];
        enforceAnimOrder();
        enforceTransitionOrder();
        state.focusedId = id;
        renderGrid();
        const c = cellById(id); if (c) c.focus();
        pushHistory('Move element');
    }

    /* ============ DELETE (single + iOS-style multi-select) ============
       Transitions reference parent tiles via `base`/`overlay`, so deleting a
       tile must also remove every transition that (transitively) builds on it,
       otherwise refreshTransitions() would dereference a missing parent. */
    function collectDeleteClosure(ids) {
        const set = new Set(ids);
        // Animation groups are atomic: if any frame is deleted, take them all.
        const groups = new Set();
        for (const el of state.elements)
            if (el.kind === 'anim' && el.anim && set.has(el.id)) groups.add(el.anim.group);
        if (groups.size) {
            for (const el of state.elements)
                if (el.kind === 'anim' && el.anim && groups.has(el.anim.group)) set.add(el.id);
        }
        let changed = true;
        while (changed) {
            changed = false;
            for (const el of state.elements) {
                if (el.kind !== 'transition' || set.has(el.id)) continue;
                if (set.has(el.base) || set.has(el.overlay)) { set.add(el.id); changed = true; }
            }
        }
        return set;
    }

    /* Remove the closure of `ids` from the atlas. Returns the count removed. */
    function performDelete(ids) {
        const closure = collectDeleteClosure(ids);
        state.elements = state.elements.filter(e => !closure.has(e.id));
        closure.forEach(id => state.selSet.delete(id));
        if (closure.has(state.selectedId)) state.selectedId = state.selSet.values().next().value ?? null;
        if (closure.has(state.selAnchor)) state.selAnchor = state.selectedId;
        if (!state.elements.some(e => e.id === state.focusedId)) {
            state.focusedId = state.elements.length ? state.elements[0].id : null;
        }
        renderGrid();
        updateBulkBar();
        return closure.size;
    }

    /* Confirm (with dependent-transition warning) then delete. */
    function confirmDelete(ids, fromMode) {
        ids = ids.filter(id => byId(id));
        if (!ids.length) return;
        const closure = collectDeleteClosure(ids);
        const idsSet = new Set(ids);
        // Extra removals split by reason: sibling animation frames vs dependent transitions.
        const extraTrans = [...closure].filter(id => !idsSet.has(id) && byId(id) && byId(id).kind === 'transition').length;
        let msg;
        if (ids.length === 1) {
            const el = byId(ids[0]);
            if (el.kind === 'anim' && el.anim && el.anim.total > 1)
                msg = `Delete this animation — all ${el.anim.total} frames?`;
            else
                msg = `Delete ${el.kind === 'transition' ? 'this transition tile' : 'this tile'}?`;
        } else {
            msg = `Delete ${ids.length} selected tiles?`;
        }
        if (extraTrans > 0) {
            msg += `\n\nThis also removes ${extraTrans} dependent transition${extraTrans !== 1 ? 's' : ''} built on ${ids.length === 1 ? 'it' : 'them'}.`;
        }
        msg += '\n\nYou can undo this with Ctrl+Z.';
        openConfirm('🗑️ Confirm delete', msg, `Delete ${closure.size}`, () => {
            const n = performDelete(ids);
            pushHistory(ids.length > 1 ? 'Delete tiles' : 'Delete element');
            showToast(`Deleted ${n} element${n !== 1 ? 's' : ''}`, 'success');
        });
    }

    /* ============ PICK-PARTNER MODE ============ */
    function enterPickMode(baseId, mode = 'transition') {
        state.pickBaseId = baseId;
        state.pickMode = mode;
        const txt = $('at-pick-text');
        if (txt) txt.textContent = mode === 'wang' ? 'build the Wang set'
            : mode === 'borderset' ? 'be the border / trim texture'
            : mode === 'organic' ? 'build the organic transition'
            : mode === 'heighttrans' ? 'settle into its crevices'
            : mode === 'recolor' ? 'sample its colours'
            : 'build the transition';
        const same = $('at-pick-same');
        if (same) same.style.display = mode === 'borderset' ? '' : 'none';
        $('at-pick-banner').style.display = 'block';
        renderGrid();
    }

    function exitPickMode() {
        state.pickBaseId = null;
        const same = $('at-pick-same');
        if (same) same.style.display = 'none';
        $('at-pick-banner').style.display = 'none';
        renderGrid();
    }

    /* ============ UNDO / REDO HISTORY ============
       Snapshot-based. `stack[index]` is always the current state. We only
       clone tile canvases that have been made seamless (others equal their
       immutable `original`); transition canvases are recomputed on restore
       via refreshTransitions(), so snapshots stay cheap. */
    const history = { stack: [], labels: [], index: -1, limit: 20 };

    function deepCopyMaterial(m) {
        return m ? JSON.parse(JSON.stringify(m)) : null;
    }

    /* Deep-copy a tile's multi-material layer stack (masks are canvases). */
    function cloneMatLayers(layers) {
        if (!Array.isArray(layers)) return null;
        return layers.map(L => ({
            name: L.name, color: L.color, feather: L.feather,
            material: deepCopyMaterial(L.material),
            mask: L.mask ? cloneCanvas(L.mask) : null
        }));
    }

    function snapshotState() {
        return {
            nextId: state.nextId,
            cols: state.cols,
            tileSize: state.tileSize,
            selectedId: state.selectedId,
            selSet: [...state.selSet],
            focusedId: state.focusedId,
            elements: state.elements.map(el => ({
                id: el.id,
                kind: el.kind,
                seamless: el.seamless,
                edited: el.edited,
                material: deepCopyMaterial(el.material),
                matLayers: cloneMatLayers(el.matLayers),                // multi-material region stack
                base: el.base, overlay: el.overlay,
                mode: el.mode, pivot: el.pivot, hardness: el.hardness,
                blendMethod: el.blendMethod,
                wangBits: el.wangBits,
                bset: el.bset ? JSON.parse(JSON.stringify(el.bset)) : null,  // border-set recipe
                customMask: el.customMask || null,                     // immutable ref (set once at add)
                overlayGeom: el.overlayGeom ? { ...el.overlayGeom } : null, // transition overlay re-orient
                emissive: el.emissive ? cloneCanvas(el.emissive) : null, // authored glow (mutable)
                // Animation metadata — frames are regenerated from params on
                // restore (like transitions), so no pixels are snapshotted.
                anim: el.anim ? JSON.parse(JSON.stringify(el.anim)) : null,
                htParams: el.htParams ? JSON.parse(JSON.stringify(el.htParams)) : null, // height-transition recipe (re-editable)
                original: el.original || null,                          // immutable ref (tiles)
                // Snapshot the canvas whenever it diverges from `original`
                // (seamless or healed/transformed); otherwise rebuild from original.
                canvasSnap: (el.kind === 'tile' && (el.seamless || el.edited)) ? cloneCanvas(el.canvas) : null
            }))
        };
    }

    function restoreState(snap) {
        exitPickMode();
        closeCtxMenu();
        state.nextId    = snap.nextId;
        state.cols      = snap.cols;
        state.tileSize  = snap.tileSize;
        state.selectedId = snap.selectedId;
        state.selAnchor  = snap.selectedId;
        state.focusedId  = snap.focusedId;
        state.selSet = new Set((snap.selSet || []).filter(id => snap.elements.some(e => e.id === id)));
        state.elements = snap.elements.map(s => {
            let canvas;
            if (s.kind === 'tile') {
                const src = ((s.seamless || s.edited) && s.canvasSnap) ? s.canvasSnap : s.original;
                canvas = cloneCanvas(src);
            } else {
                canvas = document.createElement('canvas');
                canvas.width = snap.tileSize;
                canvas.height = snap.tileSize;
            }
            return {
                id: s.id, kind: s.kind, canvas,
                original: s.original,
                seamless: s.seamless,
                material: deepCopyMaterial(s.material),
                matLayers: cloneMatLayers(s.matLayers),
                base: s.base, overlay: s.overlay,
                mode: s.mode, pivot: s.pivot, hardness: s.hardness,
                blendMethod: s.blendMethod,
                wangBits: s.wangBits,
                bset: s.bset ? JSON.parse(JSON.stringify(s.bset)) : null,
                customMask: s.customMask || null,
                overlayGeom: s.overlayGeom ? { ...s.overlayGeom } : null,
                emissive: s.emissive ? cloneCanvas(s.emissive) : null,
                anim: s.anim ? JSON.parse(JSON.stringify(s.anim)) : null,
                htParams: s.htParams ? JSON.parse(JSON.stringify(s.htParams)) : null,
                edited: s.edited
            };
        });
        refreshAnims();         // regenerate animation frames from restored params
        refreshTransitions();   // rebuild transition canvases from restored parents
        renderGrid();
    }

    /* Regenerate every animation group's frames from its stored params and draw
       them into the group members' canvases (used after undo/redo + project load
       — frames are derived, never stored as pixels). */
    function refreshAnims() {
        const groups = {};
        state.elements.forEach(el => {
            if (el.kind === 'anim' && el.anim) (groups[el.anim.group] = groups[el.anim.group] || []).push(el);
        });
        for (const g in groups) {
            const members = groups[g].sort((a, b) => a.anim.index - b.anim.index);
            const meta = members[0].anim;
            let frames;
            try {
                const all = TRLE.AnimGen.generateFrames(meta.params);
                frames = meta.single ? [all[0]] : all;
            } catch (e) { console.error(e); continue; }
            members.forEach(el => {
                const src = frames[el.anim.index % frames.length];
                const ctx = el.canvas.getContext('2d');
                ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
                if (src) ctx.drawImage(src, 0, 0, el.canvas.width, el.canvas.height);
            });
        }
    }

    function resetHistory(label) {
        history.stack = [snapshotState()];
        history.labels = [label || 'Start'];
        history.index = 0;
        updateHistoryButtons();
        renderHistory();
    }

    function pushHistory(label) {
        // Drop any redo branch, then append the new current state.
        history.stack = history.stack.slice(0, history.index + 1);
        history.labels = history.labels.slice(0, history.index + 1);
        history.stack.push(snapshotState());
        history.labels.push(label || 'Edit');
        if (history.stack.length > history.limit) { history.stack.shift(); history.labels.shift(); }
        history.index = history.stack.length - 1;
        updateHistoryButtons();
        renderHistory();
    }

    function undo() {
        if (history.index <= 0) return;
        history.index--;
        restoreState(history.stack[history.index]);
        updateHistoryButtons();
        renderHistory();
        showToast('Undo', 'info');
    }

    function redo() {
        if (history.index >= history.stack.length - 1) return;
        history.index++;
        restoreState(history.stack[history.index]);
        updateHistoryButtons();
        renderHistory();
        showToast('Redo', 'info');
    }

    /* Jump to any point in history (click in the right-rail panel). */
    function jumpToHistory(i) {
        if (i < 0 || i >= history.stack.length || i === history.index) return;
        history.index = i;
        restoreState(history.stack[i]);
        updateHistoryButtons();
        renderHistory();
    }

    /* Pick a fitting emoji for a history step from keywords in its label. */
    function historyEmoji(label) {
        const l = (label || '').toLowerCase();
        if (l.includes('start')) return '🏁';
        if (l.includes('slice')) return '✂️';
        if (l.includes('blank atlas')) return '🆕';
        if (l.includes('project loaded')) return '📂';
        if (l.includes('column')) return '↔️';
        if (l.includes('row')) return '↕️';
        if (l.includes('reorder') || l.includes('move')) return '🔀';
        if (l.includes('seamless')) return '♾️';
        if (l.includes('transition')) return '🌗';
        if (l.includes('wang')) return '🧩';
        if (l.includes('border set')) return '🧱';
        if (l.includes('material')) return '🎨';
        if (l.includes('heal')) return '🩹';
        if (l.includes('fade')) return '👻';
        if (l.includes('de-light')) return '💡';
        if (l.includes('variation')) return '🎲';
        if (l.includes('replace')) return '🖼️';
        if (l.includes('rotate')) return '🔄';
        if (l.includes('flip')) return '🪞';
        if (l.includes('offset')) return '🧱';
        if (l.includes('reset') || l.includes('restore')) return '↩️';
        if (l.includes('remove') || l.includes('delete')) return '🗑️';
        if (l.includes('image')) return '🖼️';
        return '•';
    }

    function renderHistory() {
        const list = $('at-history-list');
        if (!list) return;
        list.innerHTML = '';
        history.labels.forEach((label, i) => {
            const b = document.createElement('button');
            b.className = 'at-hist-item' + (i === history.index ? ' current' : (i > history.index ? ' future' : ''));
            b.textContent = `${i + 1}. ${historyEmoji(label)} ${label}`;
            b.title = label;
            b.addEventListener('click', () => jumpToHistory(i));
            list.appendChild(b);
        });
        const cur = list.querySelector('.current');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function updateHistoryButtons() {
        const u = $('at-undo'), r = $('at-redo');
        if (u) u.disabled = history.index <= 0;
        if (r) r.disabled = history.index >= history.stack.length - 1;
    }

    function setupHistoryShortcuts() {
        document.addEventListener('keydown', e => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            if (key !== 'z' && key !== 'y') return;
            // Don't hijack while editing in a modal or typing in a field.
            if ($('at-overlay').style.display !== 'none') return;
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
            e.preventDefault();
            if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
            else undo();
        });
    }

    /* ============ CONTEXT MENU ============ */
    function ctxVisibleItems() {
        return [...$('at-ctx').querySelectorAll('button')]
            .filter(b => !b.disabled && b.offsetParent !== null);
    }

    function openCtxMenu(id, x, y) {
        const el = byId(id);
        if (!el) return;
        state.ctxTargetId = id;
        const menu = $('at-ctx');
        menu.style.display = 'block';

        menu.querySelector('[data-action="material"]').disabled = el.kind === 'transition';
        menu.querySelector('[data-action="material"]').title =
            el.kind === 'transition'
                ? 'Transition tiles pick up their materials automatically from the two tiles they blend. '
                  + 'Set the material on the base or overlay texture instead — this tile will follow along. '
                  + 'Use “Go to Base / Overlay Texture” below to jump straight to them.'
                : '';
        // Transition-only helpers: jump to the tiles this transition was built from.
        menu.querySelectorAll('[data-transonly]').forEach(b => {
            b.style.display = (el.kind === 'transition' && el.base != null) ? '' : 'none';
        });
        menu.querySelectorAll('[data-tileonly]').forEach(b => {
            b.style.display = el.kind === 'tile' ? '' : 'none';
        });
        // Animation frames: hide the tile/transition builders (they'd split the
        // group), show the dedicated "Edit Animation…" entry.
        menu.querySelectorAll('[data-animonly]').forEach(b => {
            b.style.display = el.kind === 'anim' ? '' : 'none';
        });
        menu.querySelectorAll('[data-animhide]').forEach(b => {
            b.style.display = el.kind === 'anim' ? 'none' : '';
        });
        // Edit Height Transition — only on tiles that carry a stored height-transition recipe.
        menu.querySelectorAll('[data-httonly]').forEach(b => {
            b.style.display = el.htParams ? '' : 'none';
        });

        // Clamp to viewport
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
        menu.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';

        const first = ctxVisibleItems()[0];
        if (first) first.focus();
    }

    /* Open the menu anchored to a cell (keyboard ContextMenu / Shift+F10). */
    function openCtxMenuForCell(id) {
        const cell = cellById(id);
        const r = cell ? cell.getBoundingClientRect() : { left: 100, bottom: 120 };
        openCtxMenu(id, r.left + 8, r.bottom - 6);
    }

    function closeCtxMenu() {
        const menu = $('at-ctx');
        if (menu.style.display === 'none') return;
        const wasInMenu = menu.contains(document.activeElement);
        menu.style.display = 'none';
        // Return focus to the source cell when the menu was driven by keyboard.
        if (wasInMenu && state.ctxTargetId != null) {
            const c = cellById(state.ctxTargetId);
            if (c) c.focus();
        }
    }

    /* Shared action runner — used by both menu clicks and cell shortcut keys. */
    function runCtxAction(action, id) {
        const el = byId(id);
        if (!el) return;
        switch (action) {
            case 'seamless':   openSeamlessModal(id); break;
            case 'transition': enterPickMode(id, 'transition'); showToast('Now click the second texture', 'info'); break;
            case 'wang': enterPickMode(id, 'wang'); showToast('Now click the second texture for the Wang set', 'info'); break;
            case 'borderset': enterPickMode(id, 'borderset'); showToast('Click a second texture for the trim — or “Use same texture” for an origami fold', 'info'); break;
            case 'origami':
                if (el.kind !== 'tile') { showToast('Origami Frame works on source tiles only', 'info'); return; }
                openOrigamiModal(id);
                break;
            case 'anchor': enterPickMode(id, 'anchor'); showToast('Now click the second texture for the anchored transition', 'info'); break;
            case 'transgrid': enterPickMode(id, 'transgrid'); showToast('Now click the second texture for the transition grid', 'info'); break;
            case 'organic': enterPickMode(id, 'organic'); showToast('Now click the second texture for the organic transition', 'info'); break;
            case 'heighttrans': enterPickMode(id, 'heighttrans'); showToast('Now click the texture to settle into the crevices (overlay)', 'info'); break;
            case 'edithtrans': if (el.htParams) editHeightModal(el); break;
            case 'editanim':
                if (el.kind !== 'anim' || !el.anim) { showToast('Not an animated tile', 'info'); return; }
                openAnimModal(el.anim.group);
                break;
            case 'material':
                if (el.kind === 'transition') showToast('Transitions inherit materials — set them on the base/overlay texture instead', 'info');
                else openMatModal(id);
                break;
            case 'gotobase':    gotoSourceTile(el.base);    break;
            case 'gotooverlay': gotoSourceTile(el.overlay); break;
            case 'heal':
                if (el.kind !== 'tile') { showToast('Heal works on source tiles only', 'info'); return; }
                openHealModal(id);
                break;
            case 'fade':
                if (el.kind !== 'tile') { showToast('Fade works on source tiles only', 'info'); return; }
                openFadeModal(id);
                break;
            case 'emissive':
                if (el.kind !== 'tile') { showToast('Emissive works on source tiles only', 'info'); return; }
                openEmissiveModal(id);
                break;
            case 'rotate': applyTileTransform(id, c => rotateTile90(c), 'Rotated 90°'); break;
            case 'fliph':  applyTileTransform(id, c => flipTile(c, true), 'Flipped horizontally'); break;
            case 'flipv':  applyTileTransform(id, c => flipTile(c, false), 'Flipped vertically'); break;
            case 'offset': applyTileTransform(id, c => offsetTileHalf(c), 'Offset by ½'); break;
            case 'coloradj':
                if (el.kind !== 'tile') { showToast('Adjust Colours works on source tiles only', 'info'); return; }
                openColorAdjModal(id);
                break;
            case 'recolor':
                if (el.kind !== 'tile') { showToast('Recolor works on source tiles only', 'info'); return; }
                enterPickMode(id, 'recolor'); showToast('Now click the reference texture to sample colours from', 'info');
                break;
            case 'delight':
                if (el.kind !== 'tile') { showToast('De-light works on source tiles only', 'info'); return; }
                openDelightModal(id);
                break;
            case 'variations':
                if (el.kind !== 'tile') { showToast('Variations work on source tiles only', 'info'); return; }
                openVarModal(id);
                break;
            case 'buildpattern':
                if (el.kind !== 'tile') { showToast('Build Pattern works on source tiles only', 'info'); return; }
                openBuildModal(id);
                break;
            case 'replace':
                if (el.kind !== 'tile') { showToast('Replace works on source tiles only', 'info'); return; }
                replaceTileImage(id);
                break;
            case 'download':
                TRLE.Engine.canvasToBlob(el.canvas).then(b => downloadBlob(b, `tile_${indexOf(id) + 1}.png`));
                showToast('Downloading tile PNG', 'info', 1500);
                break;
            case 'reset':
                if (el.kind !== 'tile') return;
                el.canvas.getContext('2d').drawImage(el.original, 0, 0);
                el.seamless = false;
                el.edited = false;
                el.emissive = null;
                refreshTransitions();
                renderGrid();
                pushHistory('Reset tile');
                showToast('Tile restored to original', 'success');
                break;
            case 'delete':
                confirmDelete([id]);
                break;
        }
    }

    function setupCtxMenu() {
        const menu = $('at-ctx');
        menu.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn || btn.disabled) return;
            const id = state.ctxTargetId;
            closeCtxMenu();
            runCtxAction(btn.dataset.action, id);
        });
        // Keyboard navigation within the menu.
        menu.addEventListener('keydown', e => {
            const items = ctxVisibleItems();
            if (!items.length) return;
            const cur = items.indexOf(document.activeElement);
            switch (e.key) {
                case 'ArrowDown': e.preventDefault(); items[(cur + 1) % items.length].focus(); break;
                case 'ArrowUp':   e.preventDefault(); items[(cur - 1 + items.length) % items.length].focus(); break;
                case 'Home':      e.preventDefault(); items[0].focus(); break;
                case 'End':       e.preventDefault(); items[items.length - 1].focus(); break;
                case 'Tab':       e.preventDefault(); closeCtxMenu(); break;
            }
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.at-ctx')) closeCtxMenu();
        });
        window.addEventListener('scroll', closeCtxMenu, true);
    }

    /* ============ TRANSITION PROPAGATION ============
       Transition parents always precede their children in the array,
       so a single in-order pass re-composites everything correctly. */
    function refreshTransitions() {
        const S = state.tileSize;
        state.elements.forEach(el => {
            if (el.kind !== 'transition') return;
            if (el.bset) {   // border-set slot — rebuilt from its recipe
                const c = buildBsetTile(el, S);
                if (c) {
                    const tctx = el.canvas.getContext('2d');
                    tctx.clearRect(0, 0, S, S);
                    tctx.drawImage(c, 0, 0);
                }
                return;
            }
            const base = byId(el.base), overlay = byId(el.overlay);
            if (!base || !overlay) return;
            const mask = el.customMask
                ? softenMask(el.customMask, S)
                : el.wangBits != null
                    ? buildWangMask(S, el.wangBits, el.pivot, el.hardness)
                    : buildTopologyMask(S, el.mode, el.pivot, el.hardness);
            const overlayCanvas = el.overlayGeom ? geomTransform(overlay.canvas, el.overlayGeom) : overlay.canvas;
            const comp = composeTransitionDiffuse(base.canvas, overlayCanvas, mask, S, el.blendMethod);
            const tctx = el.canvas.getContext('2d');
            tctx.clearRect(0, 0, S, S);   // clear so transparent transitions don't keep stale pixels
            tctx.drawImage(comp, 0, 0);
        });
    }

    /* ============ MODAL INFRASTRUCTURE ============ */
    const MODAL_NAMES = ['seamless', 'trans', 'mat', 'heal', 'var', 'build', 'wang', 'bset', 'fade', 'emissive', 'anchor', 'heighttrans', 'grid', 'organic', 'anim', 'coloradj', 'recolor', 'delight', 'import', 'origami', 'confirm'];

    function visibleModal() {
        return MODAL_NAMES
            .map(n => $(`at-modal-${n}`))
            .find(m => m.style.display !== 'none') || null;
    }

    function modalFocusables(modal) {
        if (!modal) return [];
        return [...modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.offsetParent !== null);
    }

    function openModal(name) {
        state.modalReturnFocus = document.activeElement;
        // Lock background scroll so wheeling inside the modal can't drag the atlas
        // behind it (scroll-chaining). Remembered + restored on close.
        state.scrollLockY = window.scrollY;
        document.body.classList.add('at-modal-open');
        $('at-overlay').style.display = 'flex';
        MODAL_NAMES.forEach(n => {
            $(`at-modal-${n}`).style.display = (n === name) ? 'block' : 'none';
        });
        // Move focus into the dialog after it's laid out.
        requestAnimationFrame(() => {
            const f = modalFocusables($(`at-modal-${name}`))[0];
            if (f) f.focus();
        });
    }

    /* Generic confirm dialog. `onYes` runs after the dialog closes. `opts` may
       carry { onNo, cancelLabel, danger } — onNo fires when the user cancels or
       dismisses (so the cancel button can be a real alternative action, not just
       "abort"); danger defaults true (red OK) to keep the delete styling. */
    let confirmCb = null, confirmNoCb = null;
    function openConfirm(title, msg, okLabel, onYes, opts) {
        opts = opts || {};
        confirmCb = onYes;
        confirmNoCb = opts.onNo || null;
        $('at-confirm-title').textContent = title;
        $('at-confirm-msg').textContent = msg;
        $('at-confirm-ok').textContent = okLabel;
        $('at-confirm-ok').classList.toggle('at-btn-danger', opts.danger !== false);
        const cancel = document.querySelector('#at-modal-confirm [data-close]');
        if (cancel) cancel.textContent = opts.cancelLabel || 'Cancel';
        openModal('confirm');
    }

    function closeModal() {
        $('at-overlay').style.display = 'none';
        // Unlock background scroll and restore the pre-open scroll position.
        document.body.classList.remove('at-modal-open');
        if (state.scrollLockY != null) { window.scrollTo(0, state.scrollLockY); state.scrollLockY = null; }
        confirmCb = null;
        const no = confirmNoCb; confirmNoCb = null;   // fired below, after the modal is hidden
        smCleanup();
        matCleanup();
        healCleanup();
        fadeCleanup();
        emissiveCleanup();
        anchorCleanup();
        bsetCleanup();
        htCleanup();
        tgCleanup();
        orgCleanup();
        anCleanup();
        caCleanup();
        rcCleanup();
        dlCleanup();
        importCleanup();
        // Restore focus to whatever opened the modal (usually the source cell).
        const r = state.modalReturnFocus;
        state.modalReturnFocus = null;
        if (r && document.contains(r)) r.focus();
        if (no) no();   // confirm dialog cancelled/dismissed → run its "No" action
    }

    function trapTab(e) {
        const f = modalFocusables(visibleModal());
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first.focus();
        }
    }

    function clickModalPrimary() {
        const m = visibleModal();
        if (!m) return;
        const primary = m.querySelector('.at-modal-actions .btn-primary');
        if (primary && !primary.disabled) primary.click();
    }

    function setupModals() {
        document.querySelectorAll('.at-modal').forEach(modal => {
            // Responsive fit pattern for EVERY modal: wrap the content between the
            // title and the actions in a scrollable .at-modal-body so the title and
            // action buttons stay pinned and only the middle scrolls. Built here so
            // the 15 simpler modals don't each need the wrapper in their HTML. The
            // 4 transition modals already ship a hand-authored body — left as-is.
            if (!modal.querySelector(':scope > .at-modal-body')) {
                const kids = [...modal.children];
                const title   = modal.querySelector(':scope > .at-modal-title');
                const actions = modal.querySelector(':scope > .at-modal-actions');
                const startIdx = title ? kids.indexOf(title) + 1 : 0;
                const endIdx   = actions ? kids.indexOf(actions) : kids.length;
                const body = document.createElement('div');
                body.className = 'at-modal-body';
                for (let i = startIdx; i < endIdx; i++) body.appendChild(kids[i]);  // moves the node
                if (actions) modal.insertBefore(body, actions); else modal.appendChild(body);
            }
            modal.classList.add('at-modal-fit');

            // A ✕ in every modal's corner — a second deliberate exit alongside Cancel.
            const x = document.createElement('button');
            x.type = 'button'; x.className = 'at-modal-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '✕';
            x.addEventListener('click', closeModal);
            modal.appendChild(x);   // appended (not prepended) so initial focus stays on the first real control
        });
        document.querySelectorAll('.at-modal [data-close]').forEach(btn =>
            btn.addEventListener('click', closeModal));
        // NOTE: clicking the backdrop deliberately does NOT close — too easy to hit by
        // accident and lose a half-filled dialog. Exit via Cancel, the ✕, or Esc.
        // Focus trap + Ctrl/Cmd+Enter to confirm, scoped to the open dialog.
        $('at-overlay').addEventListener('keydown', e => {
            if ($('at-overlay').style.display === 'none') return;
            if (e.key === 'Tab') trapTab(e);
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                clickModalPrimary();
            }
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if ($('at-overlay').style.display !== 'none') closeModal();
            else if (state.pickBaseId !== null) exitPickMode();
            else if (state.selSet.size) { clearSelection(); renderGrid(); }
            closeCtxMenu();
        });
    }

    /* ============ SEAMLESS MODAL ============ */
    const SM_HINTS = {
        scattered:   'Best all-round (default). Great for sand, grass, gravel, foliage and rough stone.',
        allsides:    'Preserves centre detail. Best for structured textures — brick, tile, panels.',
        collage:     'Simple half-offset blend. Cheapest; good for smooth, low-contrast surfaces (plaster).',
        materialize: 'Original Materialize-style quadrant blend; may look slightly zoomed at high overlap.',
        splat:       'Rebuilds from random height-blended stamps (Materialize "Splat"). Hides repetition on busy organic textures; loses large-scale structure.'
    };
    const SM_PREVIEW = 512;
    const SM_SEAM_COLOR = [0.91, 0.52, 0.16];

    const sm = { id: null, srcTex: null, resultFBO: null, previewFBO: null };

    function smCleanup() {
        if (sm.srcTex)     { TRLE.Engine.deleteTexture(sm.srcTex); sm.srcTex = null; }
        if (sm.resultFBO)  { TRLE.Engine.deleteFBO(sm.resultFBO); sm.resultFBO = null; }
        if (sm.previewFBO) { TRLE.Engine.deleteFBO(sm.previewFBO); sm.previewFBO = null; }
        sm.id = null;
    }

    function openSeamlessModal(id) {
        smCleanup();
        sm.id = id;
        const el = byId(id);
        $('at-sm-tileno').textContent = indexOf(id) + 1;
        sm.srcTex = TRLE.Engine.createTextureFromImage(el.canvas);
        openModal('seamless');
        smUpdateControls();
        smProcess();
    }

    function smUpdateControls() {
        const m = $('at-sm-method').value;
        $('at-sm-hint').textContent = SM_HINTS[m] || '';
        $('at-sm-overlap-row').style.display     = (m === 'splat') ? 'none' : '';
        $('at-sm-splat-controls').style.display  = (m === 'splat') ? '' : 'none';
    }

    function smProcess() {
        if (sm.id === null) return;
        const S = state.tileSize;
        const temps = [];

        const method   = $('at-sm-method').value;
        const falloff  = parseInt($('at-sm-falloff').value) / 100;
        const overlapX = parseInt($('at-sm-overlapx').value) / 100;
        const overlapY = parseInt($('at-sm-overlapy').value) / 100;

        if (sm.resultFBO)  { TRLE.Engine.deleteFBO(sm.resultFBO); sm.resultFBO = null; }
        if (sm.previewFBO) { TRLE.Engine.deleteFBO(sm.previewFBO); sm.previewFBO = null; }

        const resultFBO = TRLE.Engine.createFBO(S, S);
        if (method === 'materialize') {
            const grayFBO = TRLE.Engine.createFBO(S, S); temps.push(grayFBO);
            TRLE.Engine.blit('desaturate', { u_texture: sm.srcTex, u_gamma: 1.0 }, grayFBO);
            TRLE.Engine.blit('seamlessMaker', {
                u_texture: sm.srcTex, u_heightMap: grayFBO.texture,
                u_overlapX: overlapX, u_overlapY: overlapY, u_falloff: falloff
            }, resultFBO);
        } else if (method === 'allsides') {
            TRLE.Engine.blit('seamlessAllSides', {
                u_texture: sm.srcTex, u_overlapX: overlapX, u_overlapY: overlapY, u_falloff: falloff
            }, resultFBO);
        } else if (method === 'collage') {
            TRLE.Engine.blit('seamlessCollage', {
                u_texture: sm.srcTex, u_overlapX: overlapX, u_overlapY: overlapY, u_falloff: falloff
            }, resultFBO);
        } else if (method === 'splat') {
            const grayFBO = TRLE.Engine.createFBO(S, S); temps.push(grayFBO);
            TRLE.Engine.blit('desaturate', { u_texture: sm.srcTex, u_gamma: 1.0 }, grayFBO);
            TRLE.Engine.blit('seamlessSplat', {
                u_texture: sm.srcTex, u_heightMap: grayFBO.texture,
                u_falloff: falloff,
                u_rotation:       parseInt($('at-sm-splat-rotation').value) / 100,
                u_rotationRandom: parseInt($('at-sm-splat-rotrandom').value) / 100,
                u_scale:          parseInt($('at-sm-splat-scale').value) / 100,
                u_wobble:         parseInt($('at-sm-splat-wobble').value) / 100,
                u_randomize:      parseInt($('at-sm-splat-randomize').value) / 100
            }, resultFBO);
        } else { // 'scattered'
            TRLE.Engine.blit('seamlessScattered', {
                u_texture: sm.srcTex, u_overlapX: overlapX, u_overlapY: overlapY,
                u_falloff: falloff, u_scatterScale: S
            }, resultFBO);
        }
        sm.resultFBO = resultFBO;

        // 2×2 tiled preview with optional seam marker
        const showSeam = $('at-sm-seam-marker').checked ? 1.0 : 0.0;
        const previewFBO = TRLE.Engine.createFBO(SM_PREVIEW, SM_PREVIEW);
        TRLE.Engine.blit('tilePreview', {
            u_texture: resultFBO.texture,
            u_showSeam: showSeam,
            u_seamColor: SM_SEAM_COLOR,
            u_lineHalf: 1.5 / SM_PREVIEW
        }, previewFBO);
        sm.previewFBO = previewFBO;

        const previewCanvas = $('at-sm-preview');
        previewCanvas.getContext('2d').drawImage(TRLE.Engine.fboToCanvas(previewFBO), 0, 0);

        temps.forEach(f => TRLE.Engine.deleteFBO(f));
    }

    function setupSeamlessModal() {
        $('at-sm-method').addEventListener('change', () => { smUpdateControls(); smProcess(); });
        $('at-sm-seam-marker').addEventListener('change', smProcess);

        const wireSlider = (id) => {
            $(id).addEventListener('input', function () {
                const val = $(id + '-val');
                if (val) val.textContent = this.value;
                smProcess();
            });
        };
        ['at-sm-falloff',
         'at-sm-splat-rotation', 'at-sm-splat-rotrandom', 'at-sm-splat-scale',
         'at-sm-splat-wobble', 'at-sm-splat-randomize'].forEach(wireSlider);

        $('at-sm-overlapx').addEventListener('input', function () {
            $('at-sm-overlapx-val').textContent = this.value;
            if ($('at-sm-lock-xy').checked) {
                $('at-sm-overlapy').value = this.value;
                $('at-sm-overlapy-val').textContent = this.value;
            }
            smProcess();
        });
        $('at-sm-overlapy').addEventListener('input', function () {
            $('at-sm-overlapy-val').textContent = this.value;
            if ($('at-sm-lock-xy').checked) {
                $('at-sm-overlapx').value = this.value;
                $('at-sm-overlapx-val').textContent = this.value;
            }
            smProcess();
        });

        $('at-sm-save').addEventListener('click', () => {
            if (!sm.resultFBO || sm.id === null) return;
            const el = byId(sm.id);
            const out = TRLE.Engine.fboToCanvas(sm.resultFBO);
            el.canvas.getContext('2d').drawImage(out, 0, 0);
            el.seamless = true;
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('Make seamless');
            showToast('Tile updated in atlas — transitions refreshed', 'success');
        });
    }

    /* ============ ANIMATED TEXTURE MODAL (Phase 3) ============
       Procedural, seamlessly-looping animated textures (water/lava/clouds…)
       via TRLE.AnimGen + TRLE.AnimPresets. The live preview bakes at ≤256px
       (cheap, debounced); "Add to Atlas" re-bakes at the real tile size and
       pushes a group of `kind:'anim'` elements (frame 0..N-1). Single mode
       emits one seamless tile for UV-rotate. */
    const PREVIEW_CAP = 256;
    const an = { frames: [], playId: null, playIdx: 0, lastTs: 0, regenTimer: null, editGroup: null,
                 color: null,      // { gradient, stops:[{pos,color}], adjust:{...} }
                 selStop: null };  // currently-selected gradient stop (object ref)

    /* Directional-flow vectors (whole tiles per loop). +y points down in the
       tile, so "up" is -y. Diagonals scroll equally on both axes. */
    const AN_DIRS = {
        none: [0, 0], up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
        upleft: [-1, -1], upright: [1, -1], downleft: [-1, 1], downright: [1, 1]
    };

    /* Read the flow dir + speed controls → integer {flowX, flowY}. */
    function anFlowFromControls() {
        const d = AN_DIRS[$('at-anim-flowdir').value] || AN_DIRS.none;
        const s = +$('at-anim-flowspeed').value || 0;
        return { flowX: d[0] * s, flowY: d[1] * s };
    }

    /* Inverse: stored {flowX, flowY} → {dir, speed} for the controls. */
    function anFlowToControls(fx, fy) {
        fx = fx | 0; fy = fy | 0;
        if (!fx && !fy) return { dir: 'none', speed: 2 };
        const sx = Math.sign(fx), sy = Math.sign(fy);
        const dir = Object.keys(AN_DIRS).find(k => AN_DIRS[k][0] === sx && AN_DIRS[k][1] === sy) || 'right';
        return { dir, speed: Math.max(Math.abs(fx), Math.abs(fy)) || 1 };
    }

    function anCleanup() {
        if (an.playId) { cancelAnimationFrame(an.playId); an.playId = null; }
        if (an.regenTimer) { clearTimeout(an.regenTimer); an.regenTimer = null; }
        an.frames = [];
        an.editGroup = null;
    }

    function anPopulatePresets() {
        const sel = $('at-anim-preset');
        if (sel.options.length) return;   // populate once
        TRLE.AnimPresetOrder.forEach(key => {
            const p = TRLE.AnimPresets[key];
            const o = document.createElement('option');
            o.value = key;
            o.textContent = `${p.icon || ''} ${p.label}`.trim();
            sel.appendChild(o);
        });
    }

    function anSyncLabels() {
        $('at-anim-scale-val').textContent    = $('at-anim-scale').value;
        $('at-anim-speed-val').textContent    = $('at-anim-speed').value;
        $('at-anim-octaves-val').textContent  = $('at-anim-octaves').value;
        $('at-anim-gain-val').textContent     = (+$('at-anim-gain').value / 100).toFixed(2);
        $('at-anim-warp-val').textContent     = (+$('at-anim-warp').value / 100).toFixed(2);
        $('at-anim-contrast-val').textContent = (+$('at-anim-contrast').value / 100).toFixed(2);
        $('at-anim-flowspeed-val').textContent = $('at-anim-flowspeed').value;
        $('at-anim-stretch-val').textContent  = $('at-anim-stretch').value;
        $('at-anim-fps-val').textContent      = $('at-anim-fps').value;
    }

    /* Push a preset's params into the controls. */
    function anApplyPreset(key) {
        const p = TRLE.AnimPresets[key];
        if (!p) return;
        const q = p.params;
        $('at-anim-style').value    = String(q.style != null ? q.style : 0);
        $('at-anim-scale').value    = q.spatialPeriod != null ? q.spatialPeriod : 4;
        $('at-anim-speed').value    = q.timePeriod != null ? q.timePeriod : 1;
        $('at-anim-octaves').value  = q.octaves != null ? q.octaves : 4;
        $('at-anim-gain').value     = Math.round((q.gain != null ? q.gain : 0.5) * 100);
        $('at-anim-warp').value     = Math.round((q.warp != null ? q.warp : 0) * 100);
        $('at-anim-contrast').value = Math.round((q.contrast != null ? q.contrast : 1) * 100);
        $('at-anim-stretch').value  = q.stretch != null ? q.stretch : 1;
        const fc = anFlowToControls(q.flowX || 0, q.flowY || 0);
        $('at-anim-flowdir').value  = fc.dir;
        $('at-anim-flowspeed').value = fc.speed;
        $('at-anim-desc').textContent = p.description || '';
        $('at-anim-emissive-note').style.display = p.emissive ? '' : 'none';
        anUpdateMatNote(key);
        anColorFromPreset(key);   // colour follows the chosen preset's default gradient
        anSyncLabels();
    }

    /* Load an existing group's stored params back into the controls (edit mode).
       Unlike anApplyPreset this honours the user's tweaks, not preset defaults. */
    function anSetControls(preset, params, single, frames, seed, fps) {
        const def = TRLE.AnimPresets[preset];
        $('at-anim-preset').value   = preset;
        $('at-anim-desc').textContent = def ? def.description : '';
        $('at-anim-emissive-note').style.display = (def && def.emissive) ? '' : 'none';
        anUpdateMatNote(preset);
        $('at-anim-output').value   = single ? 'single' : 'sequence';
        $('at-anim-frames').value   = single ? 16 : frames;
        if (fps != null) $('at-anim-fps').value = fps;
        $('at-anim-style').value    = String(params.style != null ? params.style : 0);
        $('at-anim-scale').value    = params.spatialPeriod != null ? params.spatialPeriod : 4;
        $('at-anim-speed').value    = params.timePeriod != null ? params.timePeriod : 1;
        $('at-anim-octaves').value  = params.octaves != null ? params.octaves : 4;
        $('at-anim-gain').value     = Math.round((params.gain != null ? params.gain : 0.5) * 100);
        $('at-anim-warp').value     = Math.round((params.warp != null ? params.warp : 0) * 100);
        $('at-anim-contrast').value = Math.round((params.contrast != null ? params.contrast : 1) * 100);
        $('at-anim-stretch').value  = params.stretch != null ? params.stretch : 1;
        const fc = anFlowToControls(params.flowX || 0, params.flowY || 0);
        $('at-anim-flowdir').value  = fc.dir;
        $('at-anim-flowspeed').value = fc.speed;
        $('at-anim-seed').value     = seed != null ? seed : 0;
        anSyncLabels();
    }

    function anFramesVisibility() {
        $('at-anim-frames-wrap').style.display = ($('at-anim-output').value === 'single') ? 'none' : '';
    }

    /* Switch the modal's Shape / Colour tab. */
    function anSetTab(name) {
        document.querySelectorAll('#at-modal-anim .at-anim-tab').forEach(b => {
            const on = b.dataset.animTab === name;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('#at-modal-anim .at-anim-panel').forEach(p => {
            p.style.display = p.dataset.animPanel === name ? '' : 'none';
        });
    }

    /* ---- Colour tab ---- */
    function anColorIdentity() {
        return { hue: 0, sat: 1, val: 1, contrast: 1, gamma: 1, invert: false, posterize: 0 };
    }

    function anPopulateGradients() {
        const sel = $('at-anim-gradient');
        if (sel.options.length) return;   // populate once
        const custom = document.createElement('option');
        custom.value = '__custom__'; custom.textContent = '✎ Custom';
        sel.appendChild(custom);
        TRLE.AnimGradientOrder.forEach(name => {
            const o = document.createElement('option');
            o.value = name; o.textContent = TRLE.AnimGradients[name].label;
            sel.appendChild(o);
        });
    }

    function anColorSyncLabels() {
        $('at-anim-col-hue-val').textContent      = $('at-anim-col-hue').value;
        $('at-anim-col-sat-val').textContent      = (+$('at-anim-col-sat').value / 100).toFixed(2);
        $('at-anim-col-val-val').textContent      = (+$('at-anim-col-val').value / 100).toFixed(2);
        $('at-anim-col-contrast-val').textContent = (+$('at-anim-col-contrast').value / 100).toFixed(2);
        $('at-anim-col-gamma-val').textContent    = (+$('at-anim-col-gamma').value / 100).toFixed(2);
        const pv = +$('at-anim-col-posterize').value;
        $('at-anim-col-posterize-val').textContent = pv >= 2 ? pv + ' levels' : 'Off';
        const sp = +$('at-anim-col-spread').value;
        $('at-anim-col-spread-val').textContent = sp > 0 ? sp + '%' : 'Off';
    }

    /* Push an.color.adjust → the sliders/checkbox (+ gradient dropdown). */
    function anColorSyncControls() {
        const a = an.color.adjust;
        $('at-anim-gradient').value         = an.color.gradient || '__custom__';
        $('at-anim-col-hue').value          = a.hue;
        $('at-anim-col-sat').value          = Math.round(a.sat * 100);
        $('at-anim-col-val').value          = Math.round(a.val * 100);
        $('at-anim-col-contrast').value     = Math.round(a.contrast * 100);
        $('at-anim-col-gamma').value        = Math.round(a.gamma * 100);
        $('at-anim-col-posterize').value    = a.posterize || 0;
        $('at-anim-col-invert').checked     = !!a.invert;
        anColorSyncLabels();
    }

    /* Read the sliders/checkbox → an.color.adjust. */
    function anColorReadAdjust() {
        an.color.adjust = {
            hue:       +$('at-anim-col-hue').value,
            sat:       +$('at-anim-col-sat').value / 100,
            val:       +$('at-anim-col-val').value / 100,
            contrast:  +$('at-anim-col-contrast').value / 100,
            gamma:     +$('at-anim-col-gamma').value / 100,
            invert:    $('at-anim-col-invert').checked,
            posterize: +$('at-anim-col-posterize').value
        };
    }

    /* Reset the colour state to a preset's default gradient + identity adjust. */
    function anColorFromPreset(key) {
        const gname = TRLE.AnimPresets_gradient(key);
        an.color = { gradient: gname, stops: TRLE.AnimGradients_stops(gname), adjust: anColorIdentity() };
        an.selStop = null;
        $('at-anim-col-spread').value = 0;   // colour-spread is opt-in per preset
        anColorSyncControls();
        anStopSyncControls();
        anRenderStops();
        anDrawRamp();
    }

    /* Draw the current ramp into the Colour-tab preview bar (over a checkerboard
       so per-stop alpha is visible). */
    function anDrawRamp() {
        if (!an.color || !an.color.stops) return;
        const c = $('at-anim-ramp'), ctx = c.getContext('2d'), W = c.width, H = c.height, sq = 6;
        for (let y = 0; y < H; y += sq) for (let x = 0; x < W; x += sq) {
            ctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#3a3a3a' : '#2a2a2a';
            ctx.fillRect(x, y, sq, sq);
        }
        const ramp = TRLE.AnimGen.buildRamp(an.color.stops, an.color.adjust);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(ramp, 0, 0, W, H);
    }

    /* ---- Stop editor (full gradient editing) ---- */
    const hex2 = n => (n | 0).toString(16).padStart(2, '0');
    const rgbToHex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
    function hexToRgb(h) {
        const m = /^#?([0-9a-f]{6})$/i.exec(h);
        if (!m) return [0, 0, 0];
        const v = parseInt(m[1], 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    /* Sample the base ramp (no adjustments) at position p∈0..1 → [r,g,b,a], so a
       new stop stores a base colour (adjustments re-apply globally on top). */
    function anSampleRamp(p) {
        const ramp = TRLE.AnimGen.buildRamp(an.color.stops, null);
        const x = Math.max(0, Math.min(255, Math.round(p * 255)));
        const d = ramp.getContext('2d').getImageData(x, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
    }

    /* Manual stop edits make the gradient "custom" (no named preset). */
    function anColorMarkCustom() {
        an.color.gradient = null;
        $('at-anim-gradient').value = '__custom__';
    }

    /* Draw the draggable handle for each stop over the ramp bar. */
    function anRenderStops() {
        const wrap = $('at-anim-ramp-wrap');
        wrap.querySelectorAll('.at-stop-handle').forEach(h => h.remove());
        if (!an.color || !an.color.stops) return;
        an.color.stops.forEach(st => {
            const h = document.createElement('div');
            h.className = 'at-stop-handle' + (st === an.selStop ? ' sel' : '');
            h.style.left = (clamp01(st.pos) * 100) + '%';
            const c = st.color;
            h.style.background = `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
            h.addEventListener('pointerdown', e => { e.preventDefault(); anSelectStop(st); anStartStopDrag(e, st, h); });
            wrap.appendChild(h);
        });
    }

    function anStartStopDrag(e, st, handleEl) {
        const bar = $('at-anim-ramp');
        try { handleEl.setPointerCapture(e.pointerId); } catch {}
        const move = ev => {
            const r = bar.getBoundingClientRect();
            st.pos = clamp01((ev.clientX - r.left) / r.width);
            handleEl.style.left = (st.pos * 100) + '%';
            anColorMarkCustom();
            $('at-anim-stop-pos').value = Math.round(st.pos * 100);
            anDrawRamp(); anScheduleRegen();
        };
        const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            an.color.stops.sort((a, b) => a.pos - b.pos);   // re-sort once dropped
            anRenderStops();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    }

    function anSelectStop(st) {
        an.selStop = st;
        anStopSyncControls();
        anRenderStops();
    }

    /* Populate the selected-stop controls (colour / position / alpha / delete). */
    function anStopSyncControls() {
        const ed = $('at-anim-stop-editor');
        if (!an.selStop) { ed.style.display = 'none'; return; }
        ed.style.display = '';
        const c = an.selStop.color;
        $('at-anim-stop-color').value = rgbToHex(c);
        $('at-anim-stop-pos').value = Math.round(clamp01(an.selStop.pos) * 100);
        const a = c.length > 3 ? c[3] : 255;
        $('at-anim-stop-alpha').value = a;
        $('at-anim-stop-alpha-val').textContent = a;
        $('at-anim-stop-delete').disabled = an.color.stops.length <= 2;
    }

    /* Add a stop at p (colour sampled from the current ramp), select it. */
    function anAddStop(p) {
        const st = { pos: clamp01(p), color: anSampleRamp(p) };
        an.color.stops.push(st);
        an.color.stops.sort((a, b) => a.pos - b.pos);
        anColorMarkCustom();
        anSelectStop(st);
        anRenderStops(); anDrawRamp(); anScheduleRegen();
    }

    /* Build a params bag from the controls. `full` uses the real tile size;
       otherwise the preview is capped for responsiveness. */
    function anBuildParams(full) {
        const key = $('at-anim-preset').value;
        const single = $('at-anim-output').value === 'single';
        const tile = state.tileSize || 256;
        const frames = single ? 2 : TRLE.AnimGen.clampFrames($('at-anim-frames').value);
        const overrides = {
            size: full ? tile : Math.min(tile, PREVIEW_CAP),
            frames: single ? 1 : frames,
            seed: +$('at-anim-seed').value || 0,
            style: +$('at-anim-style').value,
            spatialPeriod: +$('at-anim-scale').value,
            timePeriod: +$('at-anim-speed').value,
            octaves: +$('at-anim-octaves').value,
            gain: +$('at-anim-gain').value / 100,
            warp: +$('at-anim-warp').value / 100,
            contrast: +$('at-anim-contrast').value / 100,
            stretch: +$('at-anim-stretch').value,
            equalize: +$('at-anim-col-spread').value / 100
        };
        Object.assign(overrides, anFlowFromControls());
        // Colour comes from the Colour tab (gradient stops + adjustments).
        if (an.color && an.color.stops) {
            overrides.palette = an.color.stops;
            overrides.colorAdjust = an.color.adjust;
        }
        const params = TRLE.AnimPresets_resolve(key, overrides);
        return { key, params, single, frames };
    }

    /* Generate the frame list for `info`. Single mode keeps just one seamless
       frame (generateFrames enforces a 2-frame minimum, so slice it). */
    function anGenerate(info) {
        const all = TRLE.AnimGen.generateFrames(info.params);
        return info.single ? [all[0]] : all;
    }

    function anRegenerate() {
        if ($('at-overlay').style.display === 'none') return;
        const info = anBuildParams(false);
        try {
            an.frames = anGenerate(info);
        } catch (e) {
            console.error(e); showToast('Generation failed — see console', 'error'); return;
        }
        an.playIdx = 0;
        $('at-anim-status').textContent = info.single
            ? '1 seamless tile · set UV-rotate on it in Tomb Editor'
            : `${an.frames.length} frames · loops seamlessly (last → first)`;
        const verb = an.editGroup ? 'Update' : '➕ Add';
        $('at-anim-add').textContent = info.single ? `${verb} Tile` : `${verb} ${an.frames.length} Frames`;
        anStartPlayback();
    }

    function anScheduleRegen() {
        if (an.regenTimer) clearTimeout(an.regenTimer);
        an.regenTimer = setTimeout(anRegenerate, 110);
    }

    function anStartPlayback() {
        if (an.playId) { cancelAnimationFrame(an.playId); an.playId = null; }
        const pctx = $('at-anim-preview').getContext('2d');
        const tctx = $('at-anim-tiled').getContext('2d');
        const D = 256;
        an.lastTs = 0;
        const step = (ts) => {
            if (an.frames.length) {
                const fps = +$('at-anim-fps').value || 12;
                if (ts - an.lastTs > 1000 / fps) {
                    an.lastTs = ts;
                    const f = an.frames[an.playIdx % an.frames.length];
                    pctx.clearRect(0, 0, D, D);
                    pctx.drawImage(f, 0, 0, D, D);
                    tctx.clearRect(0, 0, D, D);
                    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
                        tctx.drawImage(f, x * (D / 2), y * (D / 2), D / 2, D / 2);
                    an.playIdx++;
                }
            }
            an.playId = requestAnimationFrame(step);
        };
        an.playId = requestAnimationFrame(step);
    }

    /* Map a preset's material hint into an element material object. Decals live
       under the 'decal' aesthetic of the solid table (type stays 'solid'). */
    function anDefaultMaterial(key) {
        const p = TRLE.AnimPresets[key];
        if (!p || !p.material) return null;
        const m = p.material;
        if (m.type === 'liquid') return { type: 'liquid', key: m.key, aesthetic: 'realistic' };
        if (m.type === 'decal')  return { type: 'solid',  key: m.key, aesthetic: 'decal' };
        if (m.type === 'solid')  return { type: 'solid',  key: m.key, aesthetic: 'realistic' };
        return null;
    }

    /* Human label for a preset's suggested material (for the modal note). */
    function anMaterialLabel(key) {
        const m = anDefaultMaterial(key);
        if (!m) return 'None — assign one later with “Set Material…”';
        const p = getPreset(m.type, m.key, m.aesthetic);
        return p ? p.label : m.key;
    }

    /* Refresh the modal's "Suggested material" line for the chosen preset. */
    function anUpdateMatNote(key) {
        const def = TRLE.AnimPresets[key];
        const glow = def && def.emissive ? ' · glows (Emissive map auto-enabled)' : '';
        $('at-anim-mat-note').textContent = 'Suggested material: ' + anMaterialLabel(key) + glow;
    }

    function makeAnimElement(src, S, meta) {
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        canvas.getContext('2d').drawImage(src, 0, 0, S, S);
        return {
            id: state.nextId++, kind: 'anim', canvas, original: null,
            seamless: true, edited: false, material: meta.material,
            anim: { group: meta.group, index: meta.index, total: meta.total,
                    preset: meta.preset, single: meta.single, seed: meta.seed,
                    fps: meta.fps, gradient: meta.gradient, params: meta.params }
        };
    }

    function anAdd() {
        if (!state.tileSize) return;
        const info = anBuildParams(true);
        let frames;
        try {
            frames = anGenerate(info);
        } catch (e) {
            console.error(e); showToast('Generation failed — see console', 'error'); return;
        }
        const S = state.tileSize, total = frames.length;
        const seed = +$('at-anim-seed').value || 0, fps = +$('at-anim-fps').value || 12;
        const gradient = an.color ? an.color.gradient : null;

        // Emissive presets need the Emissive export map on to actually glow.
        if (TRLE.AnimPresets[info.key] && TRLE.AnimPresets[info.key].emissive) {
            const cb = document.querySelector('#at-map-checks input[data-map="emissive"]');
            if (cb && !cb.checked) { cb.checked = true; showToast('Emissive export map enabled for the glow ✨', 'info', 2500); }
        }

        if (an.editGroup) {
            // Replace the group's frames in place, preserving its position + material.
            const old = state.elements
                .filter(e => e.kind === 'anim' && e.anim && e.anim.group === an.editGroup)
                .sort((a, b) => a.anim.index - b.anim.index);
            const material = old.length ? old[0].material : anDefaultMaterial(info.key);
            const pos = old.length ? indexOf(old[0].id) : state.elements.length;   // group is contiguous
            const group = an.editGroup;
            state.elements = state.elements.filter(e => !(e.kind === 'anim' && e.anim && e.anim.group === group));
            const newEls = frames.map((src, i) => makeAnimElement(src, S,
                { group, index: i, total, preset: info.key, single: info.single, seed, fps, gradient, params: info.params, material }));
            state.elements.splice(pos, 0, ...newEls);
            closeModal();
            renderGrid();
            pushHistory('Edit animation');
            showToast('Animation updated 🎞️', 'success');
            return;
        }

        const group = 'anim-' + state.nextId;       // stable token shared by the group
        const material = anDefaultMaterial(info.key);
        const newEls = frames.map((src, i) => makeAnimElement(src, S,
            { group, index: i, total, preset: info.key, single: info.single, seed, fps, gradient, params: info.params, material }));
        state.elements.push(...newEls);
        closeModal();
        renderGrid();
        pushHistory(info.single ? 'Add animated tile' : `Add ${total}-frame animation`);
        showToast(info.single ? 'Added animated tile' : `Added ${total}-frame looping animation 🎞️`, 'success');
    }

    /* Open the modal to create a new animation, or — when `editGroup` is given —
       to edit an existing group in place. */
    function openAnimModal(editGroup) {
        if (!state.tileSize) { showToast('Slice or create an atlas first', 'info'); return; }
        anCleanup();
        anPopulatePresets();
        if (editGroup) {
            const members = state.elements
                .filter(e => e.kind === 'anim' && e.anim && e.anim.group === editGroup)
                .sort((a, b) => a.anim.index - b.anim.index);
            if (!members.length) { showToast('Animation not found', 'error'); return; }
            const m = members[0].anim;
            an.editGroup = editGroup;
            $('at-anim-title').textContent = 'Edit Animation';
            $('at-anim-add').textContent = 'Update';
            anSetControls(m.preset, m.params, m.single, m.total, m.seed, m.fps);
            // Restore the stored colour (gradient name + stops + adjustments).
            // gradient === null means "custom" (edited stops); undefined means a
            // legacy anim with no stored gradient → fall back to the preset's.
            // Deep-copy the stops so editing this session doesn't mutate the
            // element's stored params until the user clicks Update.
            const gname = m.gradient === undefined ? TRLE.AnimPresets_gradient(m.preset) : m.gradient;
            const stops = m.params.palette
                ? m.params.palette.map(s => ({ pos: s.pos, color: s.color.slice() }))
                : TRLE.AnimGradients_stops(gname || TRLE.AnimPresets_gradient(m.preset));
            an.color = { gradient: gname, stops, adjust: Object.assign(anColorIdentity(), m.params.colorAdjust || {}) };
            an.selStop = null;
            $('at-anim-col-spread').value = Math.round((m.params.equalize || 0) * 100);
            anColorSyncControls();
            anStopSyncControls();
            anRenderStops();
            anDrawRamp();
        } else {
            an.editGroup = null;
            $('at-anim-title').textContent = 'Animated Texture';
            if (!$('at-anim-preset').value) $('at-anim-preset').value = TRLE.AnimPresetOrder[0];
            anApplyPreset($('at-anim-preset').value);
        }
        anFramesVisibility();
        anSetTab('shape');
        openModal('anim');
        anRegenerate();
    }

    function setupAnimModal() {
        anPopulatePresets();
        anPopulateGradients();
        document.querySelectorAll('#at-modal-anim .at-anim-tab').forEach(b =>
            b.addEventListener('click', () => anSetTab(b.dataset.animTab)));
        // Colour tab
        $('at-anim-gradient').addEventListener('change', () => {
            const name = $('at-anim-gradient').value;
            if (name === '__custom__') return;   // status-only entry
            an.color.gradient = name;
            an.color.stops = TRLE.AnimGradients_stops(name);
            an.selStop = null;
            anStopSyncControls(); anRenderStops(); anDrawRamp(); anScheduleRegen();
        });
        ['at-anim-col-hue', 'at-anim-col-sat', 'at-anim-col-val', 'at-anim-col-contrast',
         'at-anim-col-gamma', 'at-anim-col-posterize'].forEach(id =>
            $(id).addEventListener('input', () => { anColorSyncLabels(); anColorReadAdjust(); anDrawRamp(); anScheduleRegen(); }));
        $('at-anim-col-invert').addEventListener('change', () => { anColorReadAdjust(); anDrawRamp(); anScheduleRegen(); });
        $('at-anim-col-spread').addEventListener('input', () => { anColorSyncLabels(); anScheduleRegen(); });
        $('at-anim-col-reset').addEventListener('click', () => { anColorFromPreset($('at-anim-preset').value); anScheduleRegen(); });

        // Stop editor
        $('at-anim-ramp').addEventListener('click', e => {
            const r = e.currentTarget.getBoundingClientRect();
            anAddStop((e.clientX - r.left) / r.width);
        });
        $('at-anim-stop-color').addEventListener('input', () => {
            if (!an.selStop) return;
            const rgb = hexToRgb($('at-anim-stop-color').value);
            const a = an.selStop.color.length > 3 ? an.selStop.color[3] : 255;
            an.selStop.color = [rgb[0], rgb[1], rgb[2], a];
            anColorMarkCustom(); anRenderStops(); anDrawRamp(); anScheduleRegen();
        });
        $('at-anim-stop-pos').addEventListener('input', () => {
            if (!an.selStop) return;
            an.selStop.pos = clamp01((+$('at-anim-stop-pos').value || 0) / 100);
            an.color.stops.sort((a, b) => a.pos - b.pos);
            anColorMarkCustom(); anRenderStops(); anDrawRamp(); anScheduleRegen();
        });
        $('at-anim-stop-alpha').addEventListener('input', () => {
            if (!an.selStop) return;
            const c = an.selStop.color;
            an.selStop.color = [c[0], c[1], c[2], +$('at-anim-stop-alpha').value];
            $('at-anim-stop-alpha-val').textContent = $('at-anim-stop-alpha').value;
            anColorMarkCustom(); anRenderStops(); anDrawRamp(); anScheduleRegen();
        });
        $('at-anim-stop-delete').addEventListener('click', () => {
            if (!an.selStop || an.color.stops.length <= 2) return;
            const i = an.color.stops.indexOf(an.selStop);
            if (i >= 0) an.color.stops.splice(i, 1);
            an.selStop = an.color.stops[Math.max(0, i - 1)] || null;
            anColorMarkCustom(); anStopSyncControls(); anRenderStops(); anDrawRamp(); anScheduleRegen();
        });
        $('at-anim-preset').addEventListener('change', () => { anApplyPreset($('at-anim-preset').value); anRegenerate(); });
        $('at-anim-output').addEventListener('change', () => { anFramesVisibility(); anRegenerate(); });
        $('at-anim-style').addEventListener('change', anRegenerate);
        ['at-anim-scale', 'at-anim-speed', 'at-anim-octaves', 'at-anim-gain', 'at-anim-warp', 'at-anim-contrast',
         'at-anim-flowspeed', 'at-anim-stretch'].forEach(id =>
            $(id).addEventListener('input', () => { anSyncLabels(); anScheduleRegen(); }));
        $('at-anim-flowdir').addEventListener('change', anRegenerate);
        $('at-anim-frames').addEventListener('input', anScheduleRegen);
        $('at-anim-frames').addEventListener('change', () => {
            $('at-anim-frames').value = TRLE.AnimGen.clampFrames($('at-anim-frames').value);
            anRegenerate();
        });
        $('at-anim-seed').addEventListener('input', anScheduleRegen);
        $('at-anim-fps').addEventListener('input', anSyncLabels);
        $('at-anim-randomize').addEventListener('click', () => {
            $('at-anim-seed').value = Math.floor(Math.random() * 9999);
            anRegenerate();
        });
        $('at-anim-add').addEventListener('click', anAdd);
    }

    /* ============ TRANSITION MODAL ============ */
    const tr = { baseId: null, overlayId: null, activeMode: 'Top',
                 maskMode: 'dir', customMask: null, brushErase: false, tab: 'single',
                 overlayGeom: { rot: 0, flipH: false, flipV: false } };

    /* Solid mask for the Full Set's plain cells — kept as customMask transitions
       (not pixel copies) so they track edits to, and inherit materials from,
       their source tile. */
    function solidMask(S, white) {
        const c = document.createElement('canvas'); c.width = S; c.height = S;
        const x = c.getContext('2d'); x.fillStyle = white ? '#fff' : '#000';
        x.fillRect(0, 0, S, S);
        return c;
    }

    /* Full-set layouts: topology masks arranged spatially so the added block
       reads as one connected terrain patch (the island's NW tile has the overlay
       poking into its lower-right corner, etc.). '@BASE' / '@OVERLAY' = plain
       cells. Corner style swaps rounded (Diagonal/corner-Full) for sharp 45°
       slope cuts. */
    /* Full-set layout table — pure (no DOM), so the modal and the Learn-page
       capture hook share one source of truth. `@BASE`/`@OVERLAY` = plain cells;
       `sharp` swaps rounded corners for 45° slope cuts. */
    function transSetCells(layout, sharp) {
        const C = { NW: sharp ? 'SlopeBR' : 'DiagonalBottomRight',   // island (outer) corners
                    NE: sharp ? 'SlopeBL' : 'DiagonalBottomLeft',
                    SW: sharp ? 'SlopeTR' : 'DiagonalTopRight',
                    SE: sharp ? 'SlopeTL' : 'DiagonalTopLeft' };
        const H = { NW: sharp ? 'SlopeTL' : 'BottomRightFull',       // hole (inner) corners
                    NE: sharp ? 'SlopeTR' : 'BottomLeftFull',
                    SW: sharp ? 'SlopeBL' : 'TopRightFull',
                    SE: sharp ? 'SlopeBR' : 'TopLeftFull' };
        switch (layout) {
            case 'hole3': return { width: 3, cells: [
                H.NW,       'TopFull',    H.NE,
                'LeftFull', '@BASE',      'RightFull',
                H.SW,       'BottomFull', H.SE] };
            case 'complete5': return { width: 5, cells: [
                C.NW,        'BottomFull', C.NE,       H.NW,    H.NE,
                'RightFull', '@OVERLAY',   'LeftFull', H.SW,    H.SE,
                C.SW,        'TopFull',    C.SE,       '@BASE', '@OVERLAY'] };
            default: return { width: 3, cells: [                 // island3
                C.NW,        'BottomFull', C.NE,
                'RightFull', '@OVERLAY',   'LeftFull',
                C.SW,        'TopFull',    C.SE] };
        }
    }
    function trSetLayout() {
        return transSetCells($('at-tr-set-layout').value, $('at-tr-set-corners').value === 'sharp');
    }

    /* Tab + mask-source combined visibility (they interact: pivot/hardness is
       hidden only for single+custom, panels swap wholesale per tab). */
    function trApplyVisibility() {
        const set = tr.tab === 'set';
        const custom = tr.maskMode === 'custom';
        document.querySelectorAll('#at-modal-trans [data-tr-panel]').forEach(p => {
            p.style.display = (p.dataset.trPanel === tr.tab) ? '' : 'none';
        });
        if (!set) {
            $('at-tr-dir-group').style.display       = custom ? 'none' : '';
            $('at-tr-custom-controls').style.display = custom ? '' : 'none';
        }
        $('at-tr-pivot-row').style.display = (!set && custom) ? 'none' : '';
        $('at-tr-add').textContent = set ? `➕ Add ${trSetLayout().cells.length} Tiles` : '➕ Add to Atlas';
    }

    function trSetTab(name) {
        tr.tab = name;
        document.querySelectorAll('#at-modal-trans .at-anim-tab').forEach(b => {
            const on = b.dataset.trTab === name;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        trApplyVisibility();
        trPreview();
    }

    /* Compose + render the full-set preview grid at the layout's width. */
    function trSetPreview() {
        if (tr.baseId === null) return;
        const P = 192;
        const method   = $('at-tr-method').value;
        const pivot    = parseInt($('at-tr-pivot').value) / 100;
        const hardness = parseInt($('at-tr-hardness').value) / 100;
        const L = trSetLayout();
        const base    = resizeCanvas(byId(tr.baseId).canvas, P, P);
        const overlay = resizeCanvas(trOverlayCanvas(), P, P);
        const wrap = $('at-tr-set-previews');
        wrap.style.gridTemplateColumns = `repeat(${L.width},1fr)`;
        wrap.innerHTML = '';
        for (const cell of L.cells) {
            const c = document.createElement('canvas'); c.width = P; c.height = P;
            c.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:3px;image-rendering:pixelated;';
            const x = c.getContext('2d');
            if (cell === '@BASE') x.drawImage(base, 0, 0);
            else if (cell === '@OVERLAY') x.drawImage(overlay, 0, 0);
            else x.drawImage(composeTransitionDiffuse(base, overlay,
                buildTopologyMask(P, cell, pivot, hardness), P, method,
                method === 'poisson' ? 120 : undefined), 0, 0);
            wrap.appendChild(c);
        }
        $('at-tr-set-count').textContent = L.cells.length;
        $('at-tr-add').textContent = `➕ Add ${L.cells.length} Tiles`;
    }

    /* The overlay (B) canvas re-oriented by the modal's rotate/flip buttons. */
    function trOverlayCanvas() {
        return geomTransform(byId(tr.overlayId).canvas, tr.overlayGeom);
    }

    function openTransModal(baseId, overlayId) {
        exitPickMode();
        tr.baseId = baseId;
        tr.overlayId = overlayId;
        tr.overlayGeom = { rot: 0, flipH: false, flipV: false };
        $('at-tr-base-no').textContent    = indexOf(baseId) + 1;
        $('at-tr-overlay-no').textContent = indexOf(overlayId) + 1;

        $('at-tr-base-thumb').getContext('2d').drawImage(byId(baseId).canvas, 0, 0, 96, 96);
        trDrawOverlayThumb();

        // Reset the custom-mask canvas (black = all base) for a fresh session.
        const mctx = tr.customMask.getContext('2d');
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, tr.customMask.width, tr.customMask.height);
        $('at-tr-mask-source').value = 'dir';
        tr.maskMode = 'dir';
        openModal('trans');
        trSetTab(tr.tab || 'single');   // restores last-used tab, refreshes the right preview
    }

    function trActiveDirs() {
        return [...document.querySelectorAll('#at-tr-dirs .at-dir-btn.active')]
            .map(b => b.dataset.mode);
    }

    /* Mask for the current modal state, at resolution P. */
    function trCurrentMask(P) {
        if (tr.maskMode === 'custom') return softenMask(tr.customMask, P);
        const pivot    = parseInt($('at-tr-pivot').value) / 100;
        const hardness = parseInt($('at-tr-hardness').value) / 100;
        return buildTopologyMask(P, tr.activeMode, pivot, hardness);
    }

    function trSetMaskSource(mode) {
        tr.maskMode = mode;
        const custom = mode === 'custom';
        trApplyVisibility();
        $('at-tr-preview-label').textContent =
            custom ? 'Paint mask — white = overlay (B) shows through' : 'Preview (last clicked direction)';
        $('at-tr-preview').style.cursor = custom ? 'crosshair' : 'default';
        trPreview();
    }

    const TR_HINTS = {
        alpha:   'Straight cross-fade along the topology mask (original behaviour).',
        height:  'Biases the mid-line blend by each texture’s luminance so the edge interlocks instead of cutting straight. Great for organic surfaces.',
        poisson: 'Gradient-domain solve that removes the tonal seam when the two textures differ in brightness. Best for distinct materials (sand ↔ rock); a little slower.'
    };

    function trDrawOverlayThumb() {
        const ctx = $('at-tr-overlay-thumb').getContext('2d');
        ctx.clearRect(0, 0, 96, 96);
        ctx.drawImage(trOverlayCanvas(), 0, 0, 96, 96);
    }

    function trPreview() {
        if (tr.baseId === null) return;
        if (tr.tab === 'set') { trSetPreview(); return; }   // all refresh paths route here
        const P = 256;
        const method   = $('at-tr-method').value;
        const base    = resizeCanvas(byId(tr.baseId).canvas, P, P);
        const overlay = resizeCanvas(trOverlayCanvas(), P, P);
        const mask    = trCurrentMask(P);
        // Lighter Poisson iteration count keeps the live preview responsive.
        const comp    = composeTransitionDiffuse(base, overlay, mask, P, method, method === 'poisson' ? 220 : undefined);
        $('at-tr-preview').getContext('2d').drawImage(comp, 0, 0);
    }

    function setupTransModal() {
        document.querySelectorAll('#at-modal-trans .at-anim-tab').forEach(b =>
            b.addEventListener('click', () => trSetTab(b.dataset.trTab)));
        ['at-tr-set-layout', 'at-tr-set-corners'].forEach(id =>
            $(id).addEventListener('change', () => { trApplyVisibility(); trPreview(); }));
        const dirs = $('at-tr-dirs');
        TRANS_MODES.forEach(({ mode, label }) => {
            const btn = document.createElement('button');
            btn.className = 'at-dir-btn' + (mode === 'Top' ? ' active' : '');
            btn.dataset.mode = mode;
            btn.textContent = label;
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                tr.activeMode = mode;
                trPreview();
            });
            dirs.appendChild(btn);
        });
        $('at-tr-dirs-all').addEventListener('click', () =>
            dirs.querySelectorAll('.at-dir-btn').forEach(b => b.classList.add('active')));
        $('at-tr-dirs-none').addEventListener('click', () =>
            dirs.querySelectorAll('.at-dir-btn').forEach(b => b.classList.remove('active')));

        const trOverlayChanged = () => { trDrawOverlayThumb(); trPreview(); };
        $('at-tr-ov-rot').addEventListener('click', () => { tr.overlayGeom.rot = (tr.overlayGeom.rot + 90) % 360; trOverlayChanged(); });
        $('at-tr-ov-fliph').addEventListener('click', () => { tr.overlayGeom.flipH = !tr.overlayGeom.flipH; trOverlayChanged(); });
        $('at-tr-ov-flipv').addEventListener('click', () => { tr.overlayGeom.flipV = !tr.overlayGeom.flipV; trOverlayChanged(); });

        ['at-tr-pivot', 'at-tr-hardness'].forEach(id => {
            $(id).addEventListener('input', function () {
                $(id + '-val').textContent = this.value;
                trPreview();
            });
        });

        const methodSel = $('at-tr-method');
        const updateTrHint = () => { $('at-tr-method-hint').textContent = TR_HINTS[methodSel.value] || ''; };
        methodSel.addEventListener('change', () => { updateTrHint(); trPreview(); });
        updateTrHint();

        // ---- Mask source + custom-paint controls (Phase 5) ----
        tr.customMask = document.createElement('canvas');
        tr.customMask.width = 256; tr.customMask.height = 256;
        $('at-tr-mask-source').addEventListener('change', e => trSetMaskSource(e.target.value));
        $('at-tr-brush').addEventListener('input', function () { $('at-tr-brush-val').textContent = this.value; });
        $('at-tr-brush-mode').addEventListener('click', function () {
            tr.brushErase = !tr.brushErase;
            this.textContent = tr.brushErase ? '🧽 Erase' : '🖌️ Paint';
            this.setAttribute('aria-pressed', String(tr.brushErase));
        });
        $('at-tr-mask-clear').addEventListener('click', () => {
            const c = tr.customMask.getContext('2d');
            c.fillStyle = '#000'; c.fillRect(0, 0, tr.customMask.width, tr.customMask.height);
            trPreview();
        });
        $('at-tr-mask-invert').addEventListener('click', () => {
            const c = tr.customMask.getContext('2d');
            const d = c.getImageData(0, 0, tr.customMask.width, tr.customMask.height);
            for (let i = 0; i < d.data.length; i += 4) {
                d.data[i] = 255 - d.data[i]; d.data[i+1] = 255 - d.data[i+1]; d.data[i+2] = 255 - d.data[i+2];
            }
            c.putImageData(d, 0, 0);
            trPreview();
        });
        attachMaskBrush($('at-tr-preview'), tr.customMask, {
            active: () => tr.maskMode === 'custom',
            brushSize: () => parseInt($('at-tr-brush').value),
            erase: () => tr.brushErase,
            onPaint: trPreview
        });

        $('at-tr-add').addEventListener('click', () => {
            const S = state.tileSize;
            const method = methodSel.value;

            // --- Full Set tab → the whole spatial arrangement ---
            if (tr.tab === 'set') {
                const L = trSetLayout();
                const pivot    = parseInt($('at-tr-pivot').value) / 100;
                const hardness = parseInt($('at-tr-hardness').value) / 100;
                const geom = geomIsIdentity(tr.overlayGeom) ? null : { ...tr.overlayGeom };
                const baseId = tr.baseId, overlayId = tr.overlayId;
                // Build now, then (optionally) reflow the atlas so the block lines up.
                const els = L.cells.map(cell => {
                    const common = {
                        id: 0, kind: 'transition', canvas: blankCanvas(S), original: null,
                        seamless: false, material: null, base: baseId, overlay: overlayId,
                        blendMethod: method, overlayGeom: geom
                    };
                    if (cell === '@BASE')    return { ...common, mode: 'custom', pivot: 0, hardness: 0, customMask: solidMask(S, false) };
                    if (cell === '@OVERLAY') return { ...common, mode: 'custom', pivot: 0, hardness: 0, customMask: solidMask(S, true) };
                    return { ...common, mode: cell, pivot, hardness };
                });
                confirmResizeCols(L.width, () => {
                    for (const el of els) { el.id = state.nextId++; state.elements.push(el); }
                    closeModal();
                    renderGrid();
                    refreshTransitions();
                    pushHistory(`Transition set (${els.length})`);
                    showToast(`Added ${els.length}-tile transition set to the atlas`, 'success');
                });
                return;
            }

            // --- Custom hand-painted mask → one tile ---
            if (tr.maskMode === 'custom') {
                state.elements.push({
                    id: state.nextId++,
                    kind: 'transition',
                    canvas: blankCanvas(S),
                    original: null,
                    seamless: false,
                    material: null,
                    base: tr.baseId, overlay: tr.overlayId,
                    mode: 'custom', pivot: 0, hardness: 0, blendMethod: method,
                    customMask: cloneCanvas(tr.customMask),
                    overlayGeom: geomIsIdentity(tr.overlayGeom) ? null : { ...tr.overlayGeom }
                });
                closeModal();
                renderGrid();
                refreshTransitions();   // paint into the now-attached canvas (forces repaint)
                pushHistory('Custom transition');
                showToast('Added custom-mask transition tile', 'success');
                return;
            }

            // --- Direction presets → one tile per selected direction ---
            const modes = trActiveDirs();
            if (!modes.length) { showToast('Select at least one direction!', 'error'); return; }
            const pivot    = parseInt($('at-tr-pivot').value) / 100;
            const hardness = parseInt($('at-tr-hardness').value) / 100;

            modes.forEach(mode => {
                state.elements.push({
                    id: state.nextId++,
                    kind: 'transition',
                    canvas: blankCanvas(S),
                    original: null,
                    seamless: false,
                    material: null,
                    base: tr.baseId, overlay: tr.overlayId,
                    mode, pivot, hardness, blendMethod: method,
                    overlayGeom: geomIsIdentity(tr.overlayGeom) ? null : { ...tr.overlayGeom }
                });
            });
            closeModal();
            renderGrid();
            refreshTransitions();   // paint into the now-attached canvases (forces repaint)
            pushHistory(`Add ${modes.length} transition${modes.length > 1 ? 's' : ''}`);
            showToast(`Added ${modes.length} transition tile${modes.length > 1 ? 's' : ''} to the atlas`, 'success');
        });
    }

    /* ============ WANG SET MODAL (Phase 9) ============ */
    const wang = { baseId: null, overlayId: null };

    function wangParams() {
        return {
            method: $('at-wang-method').value,
            pivot: parseInt($('at-wang-pivot').value) / 100,
            hardness: parseInt($('at-wang-hardness').value) / 100
        };
    }

    function openWangModal(baseId, overlayId) {
        exitPickMode();
        wang.baseId = baseId;
        wang.overlayId = overlayId;
        $('at-wang-base-no').textContent    = indexOf(baseId) + 1;
        $('at-wang-overlay-no').textContent = indexOf(overlayId) + 1;
        openModal('wang');
        wangPreview();
    }

    /* Spatial Wang layouts. Bits: N=1 E=2 S=4 W=8; overlay ("sand") fills toward
       the block centre so a placed grid reads as an island of overlay.
       width = the atlas column count the block wants (null = don't reflow). */
    const WANG_LAYOUTS = {
        // Full 16 in a Gray-coded 4×4 so neighbours share edges (overlay blob → SE).
        '4x4':  { width: 4, bits: [0, 2, 10, 8,  4, 6, 14, 12,  5, 7, 15, 13,  1, 3, 11, 9] },
        // 3×3 overlay-in-centre blob (9 tiles); centre = 15 (surrounded → full overlay).
        '3x3':  { width: 3, bits: [6, 4, 12,  2, 15, 8,  3, 1, 9] },
        // Flat 16 in bit order (original behaviour); no reflow.
        'rows': { width: null, bits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
    };
    function wangCurrentLayout() {
        const el = $('at-wang-layout');
        return WANG_LAYOUTS[el ? el.value : '4x4'] || WANG_LAYOUTS['4x4'];
    }

    function wangPreview() {
        if (wang.baseId === null) return;
        const P = 256;
        const { method, pivot, hardness } = wangParams();
        const base    = resizeCanvas(byId(wang.baseId).canvas, P, P);
        const overlay = resizeCanvas(byId(wang.overlayId).canvas, P, P);
        const L = wangCurrentLayout();
        const wrap = $('at-wang-previews');
        wrap.style.gridTemplateColumns = `repeat(${L.width || 4},1fr)`;
        wrap.innerHTML = '';
        for (const bits of L.bits) {
            const mask = buildWangMask(P, bits, pivot, hardness);
            const comp = composeTransitionDiffuse(base, overlay, mask, P, method, method === 'poisson' ? 120 : undefined);
            const c = document.createElement('canvas');
            c.width = P; c.height = P;
            c.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:3px;image-rendering:pixelated;';
            c.getContext('2d').drawImage(comp, 0, 0);
            wrap.appendChild(c);
        }
        const n = L.bits.length;
        if ($('at-wang-count'))    $('at-wang-count').textContent = n;
        if ($('at-wang-addcount')) $('at-wang-addcount').textContent = n;
    }

    function setupWangModal() {
        $('at-wang-method').addEventListener('change', wangPreview);
        $('at-wang-layout').addEventListener('change', wangPreview);
        ['at-wang-pivot', 'at-wang-hardness'].forEach(id => {
            $(id).addEventListener('input', function () {
                $(id + '-val').textContent = this.value;
                wangPreview();
            });
        });
        $('at-wang-add').addEventListener('click', () => {
            if (wang.baseId === null) return;
            const S = state.tileSize;
            const { method, pivot, hardness } = wangParams();
            const L = wangCurrentLayout();
            const baseId = wang.baseId, overlayId = wang.overlayId;
            // Build the tiles now, then (optionally) reflow the atlas so the block lines up.
            const els = L.bits.map(bits => ({
                id: 0, kind: 'transition', canvas: blankCanvas(S), original: null,
                seamless: false, material: null, base: baseId, overlay: overlayId,
                mode: 'wang', wangBits: bits, pivot, hardness, blendMethod: method
            }));
            confirmResizeCols(L.width, () => {
                for (const el of els) { el.id = state.nextId++; state.elements.push(el); }
                closeModal();
                renderGrid();
                refreshTransitions();   // paint into the now-attached canvases (forces repaint)
                pushHistory(`Wang set (${els.length})`);
                showToast(`Added ${els.length}-tile Wang set to the atlas`, 'success');
            });
        });
    }

    /* ============ BORDER SET — "Add Borders & Corners" ============
       Builds a reusable connectivity tile set from ONE fill texture plus a trim
       texture: the trim runs along the boundary of areas painted with the fill.
       Two topologies:
         'frame' — trim hugs the tile edges (9-slice; +4 inner corners = any
                   rectilinear room shape). Roles: TL T TR / L C R / BL B BR
                   + ITL ITR IBL IBR (quarter patch where the border turns
                   through a concave corner).
         'lines' — trim runs through the tile centre connecting edge midpoints
                   (pipes/roads). Same NESW bits as Wang: N=1 E=2 S=4 W=8.
       Each generated element is a kind:'transition' with an `el.bset` recipe,
       so it re-renders from its parents (refreshTransitions) and inherits
       materials via a union mask (deriveMaps), exactly like Wang tiles.
       Per-slot override: a slot can be produced from its own mask ('auto'),
       by rotating/mirroring the canonical family member ('rot'/'mirh'/'mirv' —
       the escape hatch for directional trim), or by copying an atlas tile
       ('tile' + srcId, for hand-authored slots). */

    /* -- geometry tables -- */
    const BSET_ROLE_EDGES = {
        T: ['N'], R: ['E'], B: ['S'], L: ['W'],
        TL: ['N', 'W'], TR: ['N', 'E'], BL: ['S', 'W'], BR: ['S', 'E'],
        ITL: 'NW', ITR: 'NE', IBL: 'SW', IBR: 'SE',   // inner corners (string = corner patch)
        C: []
    };
    /* rotateTile90 turns clockwise, so k steps CW from the canonical member. */
    const BSET_ROT = {
        T: ['T', 0], R: ['T', 1], B: ['T', 2], L: ['T', 3],
        TL: ['TL', 0], TR: ['TL', 1], BR: ['TL', 2], BL: ['TL', 3],
        ITL: ['ITL', 0], ITR: ['ITL', 1], IBR: ['ITL', 2], IBL: ['ITL', 3],
        C: ['C', 0]
    };
    const BSET_MIRH = { L: 'R', R: 'L', TL: 'TR', TR: 'TL', BL: 'BR', BR: 'BL',
                        ITL: 'ITR', ITR: 'ITL', IBL: 'IBR', IBR: 'IBL', T: 'T', B: 'B', C: 'C' };
    const BSET_MIRV = { T: 'B', B: 'T', TL: 'BL', BL: 'TL', TR: 'BR', BR: 'TR',
                        ITL: 'IBL', IBL: 'ITL', ITR: 'IBR', IBR: 'ITR', L: 'L', R: 'R', C: 'C' };

    /* NESW bit helpers (lines topology). CW rotation maps N→E→S→W→N. */
    const bsetRotBitsCW = b => ((b << 1) | (b >> 3)) & 15;
    const bsetMirBitsH  = b => (b & 5)  | ((b & 2) ? 8 : 0) | ((b & 8) ? 2 : 0);
    const bsetMirBitsV  = b => (b & 10) | ((b & 1) ? 4 : 0) | ((b & 4) ? 1 : 0);
    /* Canonical rotation family member + CW steps back to `bits`. */
    function bsetCanonicalBits(bits) {
        let best = bits, k = 0, cur = bits;
        for (let i = 1; i < 4; i++) {
            cur = bsetRotBitsCW(cur);
            if (cur < best) { best = cur; k = i; }
        }
        return { from: best, steps: (4 - k) % 4 };
    }

    /* -- mask math. w = trim width px, f = feather px. -- */
    function bsetMakeMask(S, fn) {
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(S, S);
        const d = img.data;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const byte = Math.round(Math.max(0, Math.min(1, fn(x, y))) * 255);
                const i = (y * S + x) * 4;
                d[i] = byte; d[i + 1] = byte; d[i + 2] = byte; d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }
    const bsetEdgeDist = (dir, x, y, S) =>
        dir === 'N' ? y : dir === 'S' ? S - 1 - y : dir === 'W' ? x : S - 1 - x;
    /* Coverage of an edge band at distance d from its edge. */
    const bsetEdgeVal = (d, w, f) => (w + f / 2 - d) / f;
    /* Distance to a centre-to-edge-midpoint segment (lines topology). */
    function bsetLineDist(dir, x, y, S) {
        const c = (S - 1) / 2;
        switch (dir) {
            case 'N': return Math.hypot(x - c, Math.max(0, y - c));
            case 'S': return Math.hypot(x - c, Math.max(0, c - y));
            case 'W': return Math.hypot(Math.max(0, x - c), y - c);
            default:  return Math.hypot(Math.max(0, c - x), y - c); // E
        }
    }
    const bsetLineVal = (d, w, f) => (w / 2 + f / 2 - d) / f;
    const bsetBitDirs = bits => ['N', 'E', 'S', 'W'].filter((_, i) => bits & (1 << i));

    /* Union mask of every trim region for a slot (white = trim). Used for the
       non-directional single-pass composite and for material-map compositing —
       the region is the same however the diffuse pixels were derived. */
    function bsetUnionMask(S, topo, spec, w, f) {
        if (topo === 'lines') {
            const dirs = bsetBitDirs(spec);
            if (!dirs.length) return bsetMakeMask(S, () => 0);
            return bsetMakeMask(S, (x, y) =>
                Math.max(...dirs.map(d => bsetLineVal(bsetLineDist(d, x, y, S), w, f))));
        }
        const e = BSET_ROLE_EDGES[spec];
        if (typeof e === 'string') {   // inner corner: intersection of the two edge bands
            const [a, b] = e.split('');
            return bsetMakeMask(S, (x, y) => Math.min(
                bsetEdgeVal(bsetEdgeDist(a, x, y, S), w, f),
                bsetEdgeVal(bsetEdgeDist(b, x, y, S), w, f)));
        }
        if (!e || !e.length) return bsetMakeMask(S, () => 0);
        return bsetMakeMask(S, (x, y) =>
            Math.max(...e.map(d => bsetEdgeVal(bsetEdgeDist(d, x, y, S), w, f))));
    }

    /* Composite passes for one slot. When the trim "follows direction",
       vertical runs get the trim texture rotated 90°, and two-edge corners are
       split along a mitre diagonal (picture-frame joint) so each half keeps
       its own trim orientation. `vertical` marks passes wanting rotated trim. */
    function bsetPasses(S, topo, spec, w, f, follow) {
        if (!follow) {
            const mask = bsetUnionMask(S, topo, spec, w, f);
            const empty = (topo === 'lines') ? spec === 0 : !BSET_ROLE_EDGES[spec] || BSET_ROLE_EDGES[spec].length === 0;
            return (empty && typeof BSET_ROLE_EDGES[spec] !== 'string') ? [] : [{ mask, vertical: false }];
        }
        if (topo === 'lines') {
            return bsetBitDirs(spec).map(d => ({
                mask: bsetMakeMask(S, (x, y) => bsetLineVal(bsetLineDist(d, x, y, S), w, f)),
                vertical: d === 'N' || d === 'S'
            }));
        }
        const e = BSET_ROLE_EDGES[spec];
        if (typeof e === 'string') {   // inner corner patch — one pass, horizontal trim
            const [a, b] = e.split('');
            return [{ mask: bsetMakeMask(S, (x, y) => Math.min(
                bsetEdgeVal(bsetEdgeDist(a, x, y, S), w, f),
                bsetEdgeVal(bsetEdgeDist(b, x, y, S), w, f))), vertical: false }];
        }
        if (!e || !e.length) return [];
        if (e.length === 1) {
            const d = e[0];
            return [{ mask: bsetMakeMask(S, (x, y) => bsetEdgeVal(bsetEdgeDist(d, x, y, S), w, f)),
                      vertical: d === 'E' || d === 'W' }];
        }
        // Outer corner: two bands, cross-faded along the mitre diagonal.
        const fm = Math.max(2, f);
        return e.map((d, i) => {
            const other = e[1 - i];
            return {
                mask: bsetMakeMask(S, (x, y) => {
                    const dt = bsetEdgeDist(d, x, y, S), doth = bsetEdgeDist(other, x, y, S);
                    const c = Math.max(0, Math.min(1, 0.5 + (doth - dt) / (2 * fm)));
                    return bsetEdgeVal(dt, w, f) * c;
                }),
                vertical: d === 'E' || d === 'W'
            };
        });
    }

    /* Render one slot's diffuse. `b` = { topo, role|bits, width (0..0.5 of S),
       soft (0..1 of width), follow, slotMode }. Rot/mirror slots re-render the
       canonical/partner slot's mask version, then transform the whole tile. */
    function renderBsetVariant(b, fillC, trimC, S, method) {
        let spec = b.topo === 'lines' ? b.bits : b.role;
        let post = null;
        const rotN = (cv, k) => { for (let i = 0; i < k; i++) cv = rotateTile90(cv); return cv; };
        if (b.slotMode === 'rot') {
            if (b.topo === 'lines') {
                const c = bsetCanonicalBits(b.bits);
                spec = c.from;
                if (c.steps) post = cv => rotN(cv, c.steps);
            } else {
                const [from, k] = BSET_ROT[b.role] || [b.role, 0];
                spec = from;
                if (k) post = cv => rotN(cv, k);
            }
        } else if (b.slotMode === 'mirh') {
            spec = b.topo === 'lines' ? bsetMirBitsH(b.bits) : (BSET_MIRH[b.role] || b.role);
            post = cv => flipTile(cv, true);
        } else if (b.slotMode === 'mirv') {
            spec = b.topo === 'lines' ? bsetMirBitsV(b.bits) : (BSET_MIRV[b.role] || b.role);
            post = cv => flipTile(cv, false);
        }
        const w = Math.max(2, Math.round(b.width * S));
        const f = Math.max(1, b.soft * w);
        const fill = (fillC.width === S && fillC.height === S) ? fillC : resizeCanvas(fillC, S, S);
        let out = document.createElement('canvas');
        out.width = S; out.height = S;
        out.getContext('2d').drawImage(fill, 0, 0);
        const passes = bsetPasses(S, b.topo, spec, w, f, !!b.follow);
        if (passes.length) {
            // Origami (single-texture) sets: the trim IS the fill, rotated 90° so
            // its detail runs parallel to each edge. With "follow" on, vertical
            // runs rotate again (→180°), so ridges/planks stay parallel to every
            // edge and fold through the corners — a continuous concentric frame.
            const trim = b.origami
                ? rotateTile90(fill)
                : ((trimC.width === S && trimC.height === S) ? trimC : resizeCanvas(trimC, S, S));
            let trimV = null;   // trim rotated for vertical runs, built on demand
            for (const p of passes) {
                const t = p.vertical ? (trimV = trimV || rotateTile90(trim)) : trim;
                out = composeTransitionDiffuse(out, t, p.mask, S, method, method === 'poisson' ? 120 : undefined);
            }
        }
        return post ? post(out) : out;
    }

    /* Rebuild a placed border-set element's diffuse from its recipe (called by
       refreshTransitions). Returns null when a parent is missing. */
    function buildBsetTile(el, S) {
        const b = el.bset;
        if (b.slotMode === 'tile') {
            const src = byId(b.srcId);
            if (src) return resizeCanvas(src.canvas, S, S);
            // fall through to 'auto' if the source tile was deleted
        }
        const fill = byId(el.base), trim = byId(el.overlay);
        if (!fill || !trim) return null;
        const mode = (b.slotMode === 'tile') ? 'auto' : b.slotMode;
        return renderBsetVariant(Object.assign({}, b, { slotMode: mode }),
            fill.canvas, trim.canvas, S, el.blendMethod);
    }

    /* Auto-detect whether the source's dominant detail runs vertically (varies
       by column → 'v') or horizontally (varies by row → 'h'), by comparing the
       variance of column-means vs row-means of luminance. Picks the axis whose
       profile carries the ridges so the fold turns them into rings. */
    function origamiDetectAxis(data, S) {
        const colMean = new Float64Array(S), rowMean = new Float64Array(S);
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const i = (y * S + x) * 4;
                const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                colMean[x] += l; rowMean[y] += l;
            }
        }
        const varOf = arr => {
            let m = 0; for (const v of arr) m += v; m /= arr.length;
            let s = 0; for (const v of arr) { const d = v - m; s += d * d; }
            return s / arr.length;
        };
        return varOf(colMean) >= varOf(rowMean) ? 'v' : 'h';
    }

    /* Fold a texture into a concentric "origami" frame. opts:
         shape   'square'|'diamond'|'circle' — ring geometry (Chebyshev / Manhattan
                 / Euclidean distance from the centre)
         repeats 1..N  — mirrored nested copies of the source (seamless, via a
                 triangle wave on the radius so ring boundaries reflect)
         axis    'auto'|'v'|'h' — which source axis carries the detail (radius
                 samples that axis; the perpendicular axis is the along-ring coord)
       The along-ring coordinate is a symmetric min/max of the folded distances,
       so detail wraps continuously through the corners (no diagonal seam) and the
       result is 8-fold symmetric. Source alpha is preserved. */
    function makeOrigamiFrame(srcCanvas, S, opts = {}) {
        const shape = opts.shape || 'square';
        const repeats = Math.max(1, opts.repeats || 1);
        const src = (srcCanvas.width === S && srcCanvas.height === S)
            ? srcCanvas : resizeCanvas(srcCanvas, S, S);
        const sd = src.getContext('2d').getImageData(0, 0, S, S).data;
        const axis = (opts.axis && opts.axis !== 'auto') ? opts.axis : origamiDetectAxis(sd, S);
        const out = document.createElement('canvas');
        out.width = S; out.height = S;
        const octx = out.getContext('2d');
        const od = octx.createImageData(S, S);
        const dd = od.data;
        const c = (S - 1) / 2 || 1;
        const tri = t => { let p = (t * repeats) % 2; if (p < 0) p += 2; return p > 1 ? 2 - p : p; };
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const a = Math.abs(x - c), b = Math.abs(y - c);
                const hi = Math.max(a, b), lo = Math.min(a, b);
                let rn, tn;   // radius + along-ring, normalized 0..1, both symmetric
                if (shape === 'diamond') {
                    rn = (a + b) / (2 * c);
                    tn = Math.abs(a - b) / (2 * c);
                } else if (shape === 'circle') {
                    rn = Math.hypot(a, b) / (Math.SQRT2 * c);
                    tn = (hi ? Math.atan2(lo, hi) : 0) / (Math.PI / 4);
                } else {   // square
                    rn = hi / c;
                    tn = lo / c;
                }
                if (rn > 1) rn = 1; if (tn > 1) tn = 1;
                let u = Math.round(tri(rn) * (S - 1));   // radius → one source axis
                let v = Math.round(tn * (S - 1));        // along-ring → the other axis
                if (u < 0) u = 0; else if (u > S - 1) u = S - 1;
                if (v < 0) v = 0; else if (v > S - 1) v = S - 1;
                const sx = axis === 'h' ? v : u;         // 'v' ridges vary by column
                const sy = axis === 'h' ? u : v;
                const si = (sy * S + sx) * 4, di = (y * S + x) * 4;
                dd[di] = sd[si]; dd[di + 1] = sd[si + 1];
                dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
            }
        }
        octx.putImageData(od, 0, 0);
        return out;
    }

    /* ============ BORDER SET MODAL ============ */
    const bset = { baseId: null, overlayId: null, slots: {}, canvases: {}, regenTimer: null };
    function bsetCleanup() {
        bset.baseId = null; bset.overlayId = null; bset.slots = {}; bset.canvases = {};
        if (bset.regenTimer) { clearTimeout(bset.regenTimer); bset.regenTimer = null; }
    }

    /* Atlas layouts per set type (null = grey spacer so the block stays square).
       frame13 reads as the 3×3 frame block + a 2×2 inner-corner block. */
    const BSET_LAYOUTS = {
        frame9:  { width: 3, topo: 'frame', slots: ['TL', 'T', 'TR', 'L', 'C', 'R', 'BL', 'B', 'BR'] },
        frame13: { width: 5, topo: 'frame', slots: ['TL', 'T', 'TR', 'ITL', 'ITR',
                                                    'L',  'C', 'R',  'IBL', 'IBR',
                                                    'BL', 'B', 'BR', null,  null] },
        // Gray-coded 4×4 like the Wang layout so neighbours share edges.
        lines:   { width: 4, topo: 'lines', slots: [0, 2, 10, 8, 4, 6, 14, 12, 5, 7, 15, 13, 1, 3, 11, 9] }
    };

    /* Demo-wall maps: which slot goes in each cell (null = outside the region). */
    const BSET_DEMOS = {
        frame9: [['TL', 'T', 'T', 'T', 'TR'],
                 ['L',  'C', 'C', 'C', 'R'],
                 ['BL', 'B', 'B', 'B', 'BR']],
        frame13: [['TL', 'T', 'TR',  null, null],
                  ['L',  'C', 'R',   null, null],
                  ['L',  'C', 'ITR', 'T',  'TR'],
                  ['BL', 'B', 'B',   'B',  'BR']],
        lines: [[6, 10, 10, 14, 12],
                [5, 0,  0,  5,  5],
                [3, 10, 10, 15, 9]]
    };

    const BSET_MODES = ['auto', 'rot', 'mirh', 'mirv', 'tile'];
    const BSET_MODE_META = {
        auto: { badge: '⚙',  name: 'Generated from its own mask' },
        rot:  { badge: '↻',  name: 'Rotated copy of the canonical slot' },
        mirh: { badge: '↔',  name: 'Horizontal mirror of the partner slot' },
        mirv: { badge: '↕',  name: 'Vertical mirror of the partner slot' },
        tile: { badge: '🖼', name: 'Uses an atlas tile as-is' }
    };

    function bsetTopoKey() { return $('at-bset-topo').value; }
    function bsetParams() {
        return {
            method: $('at-bset-method').value,
            width:  parseInt($('at-bset-width').value) / 100,
            soft:   parseInt($('at-bset-soft').value) / 100,
            follow: $('at-bset-follow').checked
        };
    }
    function bsetSlotState(key) {
        return bset.slots[key] || (bset.slots[key] = { mode: 'auto', srcId: null });
    }
    function bsetRecipeFor(key, L, p) {
        const s = bsetSlotState(key);
        const b = { topo: L.topo, width: p.width, soft: p.soft, follow: p.follow,
                    slotMode: s.mode, srcId: s.srcId,
                    origami: bset.baseId === bset.overlayId };
        if (L.topo === 'lines') b.bits = key; else b.role = key;
        return b;
    }

    function openBsetModal(baseId, overlayId) {
        exitPickMode();
        bset.baseId = baseId;
        bset.overlayId = overlayId;
        bset.slots = {};
        const origami = baseId === overlayId;
        const titleSrc = $('at-bset-title-src'), origamiHint = $('at-bset-origami-hint');
        if (origami) {
            if (titleSrc) titleSrc.textContent = `Tile ${indexOf(baseId) + 1} (origami — one texture)`;
            if (origamiHint) origamiHint.style.display = '';
        } else {
            if (titleSrc) titleSrc.innerHTML =
                `Tile <span id="at-bset-base-no">${indexOf(baseId) + 1}</span> + trim Tile <span id="at-bset-overlay-no">${indexOf(overlayId) + 1}</span>`;
            if (origamiHint) origamiHint.style.display = 'none';
        }
        openModal('bset');
        bsetPreview();
    }

    function bsetPreview() {
        if (bset.baseId === null) return;
        const P = 96;
        const p = bsetParams();
        const L = BSET_LAYOUTS[bsetTopoKey()];
        const fillEl = byId(bset.baseId), trimEl = byId(bset.overlayId);
        if (!fillEl || !trimEl) return;
        const fill = resizeCanvas(fillEl.canvas, P, P);
        const trim = resizeCanvas(trimEl.canvas, P, P);
        bset.canvases = {};

        const wrap = $('at-bset-previews');
        wrap.style.gridTemplateColumns = `repeat(${L.width},1fr)`;
        wrap.innerHTML = '';
        const keys = [...new Set(L.slots.filter(k => k !== null))];
        for (const key of keys) {
            const s = bsetSlotState(key);
            let tile;
            if (s.mode === 'tile' && byId(s.srcId)) tile = resizeCanvas(byId(s.srcId).canvas, P, P);
            else tile = renderBsetVariant(bsetRecipeFor(key, L, p), fill, trim, P, p.method);
            bset.canvases[key] = tile;
        }
        // Slot grid in layout order (spacers render as empty cells).
        for (const key of L.slots) {
            const cell = document.createElement('div');
            cell.style.cssText = 'position:relative;';
            if (key === null) {
                cell.style.cssText += 'border:1px dashed var(--border);border-radius:3px;opacity:.35;';
                wrap.appendChild(cell);
                continue;
            }
            const s = bsetSlotState(key);
            const c = document.createElement('canvas');
            c.width = P; c.height = P;
            c.style.cssText = 'width:100%;display:block;border:1px solid var(--border);border-radius:3px;image-rendering:pixelated;cursor:pointer;';
            c.getContext('2d').drawImage(bset.canvases[key], 0, 0);
            const meta = BSET_MODE_META[s.mode];
            c.title = `${key} — ${meta.name}. Click to cycle how this slot is made.`;
            const badge = document.createElement('span');
            badge.textContent = meta.badge;
            badge.style.cssText = 'position:absolute;top:2px;right:4px;font-size:0.7rem;color:#fff;background:rgba(0,0,0,.55);border-radius:3px;padding:0 3px;pointer-events:none;' + (s.mode === 'auto' ? 'opacity:.35;' : '');
            cell.appendChild(c);
            cell.appendChild(badge);
            if (s.mode === 'tile') {
                const sel = document.createElement('select');
                sel.style.cssText = 'width:100%;margin-top:2px;font-size:0.7rem;';
                state.elements.forEach((e2, i2) => {
                    const o = document.createElement('option');
                    o.value = e2.id; o.textContent = `Tile ${i2 + 1}`;
                    sel.appendChild(o);
                });
                if (s.srcId != null) sel.value = String(s.srcId);
                else { s.srcId = state.elements[0] ? state.elements[0].id : null; }
                sel.addEventListener('change', () => { s.srcId = parseInt(sel.value); bsetPreview(); });
                sel.addEventListener('click', e => e.stopPropagation());
                cell.appendChild(sel);
            }
            c.addEventListener('click', () => {
                // 'C' (frame) and bits 0 (lines) have no trim — only auto/tile make sense.
                const modes = (key === 'C' || key === 0) ? ['auto', 'tile'] : BSET_MODES;
                s.mode = modes[(modes.indexOf(s.mode) + 1) % modes.length];
                if (s.mode === 'tile' && s.srcId == null && state.elements[0]) s.srcId = state.elements[0].id;
                bsetPreview();
            });
            wrap.appendChild(cell);
        }

        // Demo wall — the set assembled into a sample room / pipe run.
        const demo = BSET_DEMOS[bsetTopoKey()];
        const D = 44;
        const dc = $('at-bset-demo');
        dc.width = demo[0].length * D; dc.height = demo.length * D;
        const dctx = dc.getContext('2d');
        demo.forEach((row, r) => row.forEach((key, cix) => {
            if (key === null) {   // outside the region — dark checker
                dctx.fillStyle = '#181818'; dctx.fillRect(cix * D, r * D, D, D);
                dctx.fillStyle = '#222';
                dctx.fillRect(cix * D, r * D, D / 2, D / 2);
                dctx.fillRect(cix * D + D / 2, r * D + D / 2, D / 2, D / 2);
                return;
            }
            const t = bset.canvases[key];
            if (t) dctx.drawImage(t, cix * D, r * D, D, D);
        }));

        const n = L.slots.filter(k => k !== null).length;
        if ($('at-bset-count'))    $('at-bset-count').textContent = n;
        if ($('at-bset-addcount')) $('at-bset-addcount').textContent = n;
    }

    function bsetPreviewSoon() {
        if (bset.regenTimer) clearTimeout(bset.regenTimer);
        bset.regenTimer = setTimeout(bsetPreview, 90);
    }

    function setupBsetModal() {
        $('at-bset-topo').addEventListener('change', () => { bset.slots = {}; bsetPreview(); });
        $('at-bset-method').addEventListener('change', bsetPreview);
        $('at-bset-follow').addEventListener('change', bsetPreview);
        ['at-bset-width', 'at-bset-soft'].forEach(id => {
            $(id).addEventListener('input', function () {
                $(id + '-val').textContent = this.value;
                bsetPreviewSoon();
            });
        });
        $('at-bset-add').addEventListener('click', () => {
            if (bset.baseId === null) return;
            const S = state.tileSize;
            const p = bsetParams();
            const L = BSET_LAYOUTS[bsetTopoKey()];
            const baseId = bset.baseId, overlayId = bset.overlayId;
            const slots = L.slots.map(key => key === null ? null
                : { key, recipe: bsetRecipeFor(key, L, p) });
            confirmResizeCols(L.width, () => {
                let n = 0;
                for (const slot of slots) {
                    if (slot === null) { state.elements.push(makeSpacerTile()); continue; }
                    state.elements.push({
                        id: state.nextId++, kind: 'transition', canvas: blankCanvas(S),
                        original: null, seamless: false, material: null,
                        base: baseId, overlay: overlayId, blendMethod: p.method,
                        bset: slot.recipe
                    });
                    n++;
                }
                closeModal();
                renderGrid();
                refreshTransitions();   // paint into the now-attached canvases
                pushHistory(`Border set (${n})`);
                showToast(`Added ${n}-tile border set to the atlas`, 'success');
            });
        });
    }

    /* ============ ORGANIC TRANSITION MODAL (Phase 13) ============
       Scatters the overlay into the base as seeded, noise-driven patches.
       An optional painted "hint" biases where the overlay lands; each variation
       uses a distinct seed. Edge-safe keeps patches off the tile border so the
       tiles stay seamless with their neighbours. */
    const org = { baseId: null, overlayId: null, hint: null, sel: new Set(),
                  painting: false, paintVal: 255, hasHint: false, regenTimer: null,
                  seam: null };

    function orgCleanup() {
        org.baseId = null; org.overlayId = null; org.painting = false;
        org.hint = null; org.hasHint = false;
        if (org.regenTimer) { clearTimeout(org.regenTimer); org.regenTimer = null; }
    }

    /* (Re)build the per-side seamless model with `segs` segments a side, all on. */
    function orgSeamInit(segs) {
        const fill = () => new Array(segs).fill(true);
        org.seam = { segs, top: fill(), right: fill(), bottom: fill(), left: fill() };
    }
    const orgSeamActive = () => org.seam && [...org.seam.top, ...org.seam.right, ...org.seam.bottom, ...org.seam.left].some(Boolean);

    function orgParams() {
        return {
            count:     parseInt($('at-org-count').value) || 6,
            method:    $('at-org-method').value,
            coverage:  parseInt($('at-org-coverage').value) / 100,
            scale:     parseInt($('at-org-scale').value) / 100,
            roughness: parseInt($('at-org-roughness').value) / 100,
            edgeMargin: parseInt($('at-org-threshold').value) / 100,
            baseSeed:  Math.max(0, parseInt($('at-org-seed').value) || 0)
        };
    }
    /* Deterministic distinct seed per variation index. */
    const orgSeed = (baseSeed, i) => (Math.imul(baseSeed + 1, 2654435761) + Math.imul(i + 1, 40503)) >>> 0;

    function orgMaskFor(seed, W, H, p) {
        return buildOrganicMask(W, H, {
            seed, scale: p.scale, coverage: p.coverage, roughness: p.roughness,
            edgeMargin: p.edgeMargin, seam: orgSeamActive() ? org.seam : null,
            edgeSafe: false, hint: org.hasHint ? org.hint : null
        });
    }

    /* ---- per-side seamless box model ---- */
    const ORG_BOX = 150, ORG_BOX_M = 24;   // canvas size + inset margin
    function orgDrawSeamBox() {
        const cv = $('at-org-seambox'); if (!cv || !org.seam) return;
        const ctx = cv.getContext('2d');
        const m = ORG_BOX_M, L = ORG_BOX - 2 * m, segs = org.seam.segs, gap = 3;
        ctx.clearRect(0, 0, ORG_BOX, ORG_BOX);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(m, m, L, L);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.strokeRect(m + 0.5, m + 0.5, L, L);
        const seg = L / segs;
        const bar = (x, y, w, h, on) => { ctx.fillStyle = on ? '#e8852a' : '#4a4a4a'; ctx.fillRect(x, y, w, h); };
        for (let i = 0; i < segs; i++) {
            const a = m + i * seg + gap / 2, len = seg - gap, T = 5;
            bar(a, m - T, len, T, org.seam.top[i]);                 // top
            bar(a, ORG_BOX - m, len, T, org.seam.bottom[i]);        // bottom
            bar(m - T, a, T, len, org.seam.left[i]);                // left
            bar(ORG_BOX - m, a, T, len, org.seam.right[i]);         // right
        }
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('seamless edges', ORG_BOX / 2, ORG_BOX / 2 + 3);
    }
    function orgSeamHit(cx, cy) {
        const m = ORG_BOX_M, L = ORG_BOX - 2 * m, segs = org.seam.segs, tol = 14;
        const inX = cx >= m - tol && cx <= ORG_BOX - m + tol;
        const inY = cy >= m - tol && cy <= ORG_BOX - m + tol;
        const cands = [];
        if (inX) { cands.push(['top', Math.abs(cy - m), cx]); cands.push(['bottom', Math.abs(cy - (ORG_BOX - m)), cx]); }
        if (inY) { cands.push(['left', Math.abs(cx - m), cy]); cands.push(['right', Math.abs(cx - (ORG_BOX - m)), cy]); }
        cands.sort((a, b) => a[1] - b[1]);
        if (!cands.length || cands[0][1] > tol) return null;
        const [side, , along] = cands[0];
        const seg = Math.max(0, Math.min(segs - 1, ((along - m) / L * segs) | 0));
        return { side, seg };
    }

    function orgScheduleRender() {
        if (org.regenTimer) clearTimeout(org.regenTimer);
        org.regenTimer = setTimeout(orgRenderPreviews, 110);
    }

    function orgRenderPreviews() {
        if (org.baseId === null) return;
        const p = orgParams();
        const P = 128;
        const base    = resizeCanvas(byId(org.baseId).canvas, P, P);
        const overlay = resizeCanvas(byId(org.overlayId).canvas, P, P);
        const wrap = $('at-org-previews');
        wrap.innerHTML = '';
        // keep only still-valid selections
        const next = new Set();
        for (let i = 0; i < p.count; i++) {
            const seed = orgSeed(p.baseSeed, i);
            const mask = orgMaskFor(seed, P, P, p);
            const comp = composeTransitionDiffuse(base, overlay, mask, P, p.method, p.method === 'poisson' ? 120 : undefined);
            const c = document.createElement('canvas');
            c.width = P; c.height = P;
            c.getContext('2d').drawImage(comp, 0, 0);
            const selected = org.sel.size === 0 ? true : org.sel.has(i);
            if (selected) { next.add(i); c.classList.add('at-org-sel'); }
            c.title = `Variation ${i + 1} (seed ${seed})`;
            c.addEventListener('click', () => {
                if (org.sel.has(i)) org.sel.delete(i); else org.sel.add(i);
                c.classList.toggle('at-org-sel', org.sel.has(i));
                orgUpdateCounts();
            });
            wrap.appendChild(c);
        }
        org.sel = next;
        orgUpdateCounts();
    }

    function orgUpdateCounts() {
        const n = org.sel.size;
        $('at-org-selcount').textContent = n;
        $('at-org-addcount').textContent = n;
    }

    /* ---- hint paint canvas ---- */
    function orgClearHint() {
        const ctx = org.hint.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, org.hint.width, org.hint.height);
        org.hasHint = false;
        orgDrawHint();
        orgScheduleRender();
    }
    /* Overlay the hint canvas onto the base so the user sees what they paint. */
    function orgDrawHint() {
        const cv = $('at-org-hint'), P = cv.width, ctx = cv.getContext('2d');
        const base = resizeCanvas(byId(org.baseId).canvas, P, P);
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(base, 0, 0);
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#e8852a';
        // tint where the hint is painted
        const tmp = document.createElement('canvas'); tmp.width = P; tmp.height = P;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(org.hint, 0, 0);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = '#e8852a'; tctx.fillRect(0, 0, P, P);
        ctx.drawImage(tmp, 0, 0);
        ctx.globalAlpha = 1;
    }
    function orgPaintAt(ev) {
        const cv = $('at-org-hint'), r = cv.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width * cv.width;
        const y = (ev.clientY - r.top) / r.height * cv.height;
        const size = parseInt($('at-org-brushsize').value);
        const erase = document.querySelector('input[name="at-org-brush"]:checked').value === 'erase';
        const ctx = org.hint.getContext('2d');
        ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        if (!erase) org.hasHint = true;
        orgDrawHint();
    }

    function openOrganicModal(baseId, overlayId) {
        exitPickMode();
        org.baseId = baseId; org.overlayId = overlayId;
        org.sel = new Set();        // empty → render treats all as selected
        org.hasHint = false;
        org.hint = document.createElement('canvas');
        org.hint.width = 256; org.hint.height = 256;
        org.hint.getContext('2d').clearRect(0, 0, 256, 256);
        $('at-org-base-no').textContent    = indexOf(baseId) + 1;
        $('at-org-overlay-no').textContent = indexOf(overlayId) + 1;
        const segs = parseInt($('at-org-segs').value) || 2;
        orgSeamInit(segs);
        $('at-org-threshold').value = 12; $('at-org-threshold-val').textContent = '12';
        openModal('organic');
        orgDrawHint();
        orgDrawSeamBox();
        orgRenderPreviews();
    }

    function setupOrganicModal() {
        const slider = (id, suffix) => $(id).addEventListener('input', function () {
            $(id + '-val').textContent = this.value + (suffix || '');
            orgScheduleRender();
        });
        slider('at-org-coverage'); slider('at-org-scale'); slider('at-org-roughness'); slider('at-org-threshold');
        $('at-org-brushsize').addEventListener('input', function () { $('at-org-brushsize-val').textContent = this.value; });
        ['at-org-method', 'at-org-count'].forEach(id =>
            $(id).addEventListener('change', orgScheduleRender));
        $('at-org-seed').addEventListener('input', orgScheduleRender);

        // per-side seamless box model
        $('at-org-segs').addEventListener('change', function () {
            orgSeamInit(parseInt(this.value) || 2); orgDrawSeamBox(); orgScheduleRender();
        });
        const seamBox = $('at-org-seambox');
        seamBox.addEventListener('click', e => {
            if (!org.seam) return;
            const r = seamBox.getBoundingClientRect();
            const cx = (e.clientX - r.left) / r.width * ORG_BOX, cy = (e.clientY - r.top) / r.height * ORG_BOX;
            const hit = orgSeamHit(cx, cy);
            if (!hit) return;
            org.seam[hit.side][hit.seg] = !org.seam[hit.side][hit.seg];
            orgDrawSeamBox(); orgScheduleRender();
        });
        const seamSetAll = on => { if (!org.seam) return; ['top', 'right', 'bottom', 'left'].forEach(s => org.seam[s].fill(on)); orgDrawSeamBox(); orgScheduleRender(); };
        $('at-org-seam-all').addEventListener('click', () => seamSetAll(true));
        $('at-org-seam-none').addEventListener('click', () => seamSetAll(false));
        $('at-org-randomize').addEventListener('click', () => {
            $('at-org-seed').value = Math.floor(Math.random() * 1e6);
            orgScheduleRender();
        });
        $('at-org-clear').addEventListener('click', orgClearHint);

        const cv = $('at-org-hint');
        cv.addEventListener('pointerdown', e => {
            if (org.baseId === null) return;
            org.painting = true; try { cv.setPointerCapture(e.pointerId); } catch {}
            orgPaintAt(e); e.preventDefault();
        });
        cv.addEventListener('pointermove', e => { if (org.painting) { orgPaintAt(e); e.preventDefault(); } });
        const stop = () => { if (org.painting) { org.painting = false; orgScheduleRender(); } };
        cv.addEventListener('pointerup', stop);
        cv.addEventListener('pointercancel', stop);

        $('at-org-add').addEventListener('click', () => {
            if (org.baseId === null) return;
            if (org.sel.size === 0) { showToast('Select at least one variation to add', 'error'); return; }
            const S = state.tileSize, p = orgParams();
            const idxs = [...org.sel].sort((a, b) => a - b);
            for (const i of idxs) {
                const mask = orgMaskFor(orgSeed(p.baseSeed, i), S, S, p);
                state.elements.push({
                    id: state.nextId++, kind: 'transition', canvas: blankCanvas(S),
                    original: null, seamless: false, material: null,
                    base: org.baseId, overlay: org.overlayId,
                    mode: 'custom', pivot: 0, hardness: 0, blendMethod: p.method,
                    customMask: cloneCanvas(mask)
                });
            }
            const n = idxs.length;
            closeModal();
            renderGrid();
            refreshTransitions();
            pushHistory(`Organic transition (${n})`);
            showToast(`Added ${n} organic transition tile${n !== 1 ? 's' : ''}`, 'success');
        });
    }

    /* ============ MATERIAL MODAL ============ */
    // [key, label, min, max, step?]  — step defaults to 1 (integer). Float params
    // (0–1 with a 0.05 step) drive the Materialize-derived normal/AO extras.
    const MAT_PARAMS = [
        ['normalStrength',         'Normal Strength',      1, 50],
        ['normalBlur',             'Normal Blur',          0, 10],
        ['normalAngularity',       'Normal Angularity',    0, 1,   0.05],
        ['normalAngularIntensity', 'Normal Tilt',          0, 1,   0.05],
        ['normalFineDetail',       'Normal Fine Detail',   0, 1,   0.05],
        ['normalLargeScale',       'Normal Large Scale',   0, 1,   0.05],
        ['aoRadius',               'AO Radius',            1, 30],
        ['aoIntensity',            'AO Intensity',         1, 30],
        ['aoNormalBlend',          'AO Normal Mix',        0, 1,   0.05],
        ['roughnessBase',          'Roughness Base',       0, 255],
        ['roughnessContrast',      'Roughness Contrast',   0, 30],
        ['specularBase',           'Specular Base',        0, 255],
        ['specularContrast',       'Specular Contrast',    0, 30],
        ['heightStrength',         'Height Strength',      1, 50],
        ['heightBlur',             'Height Blur',          0, 10],
        ['emissiveStrength',       'Emissive Strength',    0, 100],
        ['emissiveThreshold',      'Emissive Threshold',   0, 255]
    ];
    // Params measured on a 0–1 float scale (need parseFloat, not parseInt).
    const MAT_FLOAT_PARAMS = new Set(['normalAngularity', 'normalAngularIntensity', 'aoNormalBlend', 'normalFineDetail', 'normalLargeScale']);
    const MAT_PREVIEW_MAPS = ['normal', 'ao', 'specular', 'roughness', 'height'];

    const mat = { id: null, batchIds: null, dirty: false, previewTimer: null,
                  gl: null, lightDir: [-0.35, 0.4, 0.85] };

    function matCleanupGL() {
        if (!mat.gl) return;
        if (mat.gl.maps) Object.values(mat.gl.maps).forEach(f => f && TRLE.Engine.deleteFBO(f));
        if (mat.gl.tex) TRLE.Engine.deleteTexture(mat.gl.tex);
        mat.gl = null;
    }

    function matCleanup() {
        clearTimeout(mat.previewTimer);
        matCleanupGL();
        mat3dPause();
        mat.id = null;
        mat.batchIds = null;
    }

    function matPresetKeys(type, aesthetic) {
        if (aesthetic === 'saved') return userPresets.map(p => p.id);
        return type === 'liquid'
            ? TRLE.getLiquidPresetKeys(aesthetic)
            : TRLE.getSolidPresetKeys(aesthetic);
    }

    function matPopulatePresets(selectedKey) {
        const type      = $('at-mat-type').value;
        const aesthetic = $('at-mat-aesthetic').value;
        const sel = $('at-mat-preset');
        sel.innerHTML = '';
        const keys = matPresetKeys(type, aesthetic);
        if (aesthetic === 'saved' && !keys.length) {
            // Empty "My presets" group — show a disabled hint so the picker isn't blank.
            const o = new Option('No saved presets yet — tweak a material, then ⭐ Save', '');
            o.disabled = true; sel.appendChild(o); sel.value = '';
        } else {
            keys.forEach(k => {
                const p = getPreset(type, k, aesthetic);
                sel.appendChild(new Option(p.label, k));
            });
            sel.value = selectedKey && [...sel.options].some(o => o.value === selectedKey)
                ? selectedKey
                : (DEFAULTS[type] && [...sel.options].some(o => o.value === DEFAULTS[type])
                    ? DEFAULTS[type] : sel.options[0] && sel.options[0].value);
        }
        updatePresetBarButtons();
    }

    function matLoadParams(params) {
        MAT_PARAMS.forEach(([key]) => {
            const slider = $(`at-mat-p-${key}`);
            slider.value = params[key] != null ? params[key] : slider.min;
            $(`at-mat-p-${key}-val`).textContent = slider.value;
        });
    }

    function matCollectParams() {
        const out = {};
        MAT_PARAMS.forEach(([key]) => {
            const v = $(`at-mat-p-${key}`).value;
            out[key] = MAT_FLOAT_PARAMS.has(key) ? parseFloat(v) : parseInt(v);
        });
        return out;
    }

    function matCurrentPresetObj() {
        const type      = $('at-mat-type').value;
        const aesthetic = $('at-mat-aesthetic').value;
        const key       = $('at-mat-preset').value;
        const base = getPreset(type, key, aesthetic) || {};
        if (!mat.dirty) return base;
        return Object.assign({}, base, matCollectParams(),
            { label: (base.label || key) + ' (custom)' });
    }

    function matOnPresetChange() {
        const p = matCurrentPresetObjBase();
        if (p) {
            matLoadParams(p);
            $('at-mat-desc').textContent = p.description || '';
        }
        mat.dirty = false;
        matSchedulePreview();
    }

    function matCurrentPresetObjBase() {
        return getPreset($('at-mat-type').value, $('at-mat-preset').value, $('at-mat-aesthetic').value);
    }

    /* ---- Save / rename / delete / import-export user material presets ---- */
    let presetNameMode = null;   // 'save' | 'rename' while the name field is open

    function updatePresetBarButtons() {
        const saved  = $('at-mat-aesthetic') && $('at-mat-aesthetic').value === 'saved';
        const hasSel = saved && !!userPresetById($('at-mat-preset').value);
        const ren = $('at-mat-renamepreset'), del = $('at-mat-delpreset'), exp = $('at-mat-exportpresets');
        if (ren) ren.style.display = hasSel ? '' : 'none';
        if (del) del.style.display = hasSel ? '' : 'none';
        if (exp) exp.disabled = userPresets.length === 0;
    }

    function showPresetName(mode, value) {
        presetNameMode = mode;
        $('at-mat-presetbar').style.display = 'none';
        $('at-mat-nameedit').style.display = 'flex';
        const inp = $('at-mat-presetname');
        inp.value = value || '';
        inp.focus(); inp.select();
    }
    function hidePresetName() {
        presetNameMode = null;
        $('at-mat-nameedit').style.display = 'none';
        $('at-mat-presetbar').style.display = 'flex';
    }
    function commitPresetName() {
        const name = ($('at-mat-presetname').value || '').trim();
        if (!name) { showToast('Give the preset a name', 'error'); return; }
        if (presetNameMode === 'save') {
            const preset = Object.assign({}, matCurrentPresetObj(), { label: name, description: 'Saved material preset' });
            const id = newPresetId();
            userPresets.push({ id, name, preset });
            persistUserPresets();
            $('at-mat-aesthetic').value = 'saved';
            matPopulatePresets(id);
            matOnPresetChange();
            showToast(`Saved preset “${name}” ⭐`, 'success');
        } else if (presetNameMode === 'rename') {
            const u = userPresetById($('at-mat-preset').value);
            if (u) { u.name = name; u.preset.label = name; persistUserPresets(); matPopulatePresets(u.id); }
            showToast('Preset renamed', 'success');
        }
        hidePresetName();
    }
    function deleteCurrentPreset() {
        const u = userPresetById($('at-mat-preset').value);
        if (!u) return;
        openConfirm('Delete preset', `Delete the saved preset “${u.name}”? Tiles already using it keep their material.`, 'Delete', () => {
            userPresets = userPresets.filter(p => p.id !== u.id);
            persistUserPresets();
            matPopulatePresets();
            matOnPresetChange();
            showToast('Preset deleted', 'info');
        });
    }
    function exportUserPresets() {
        if (!userPresets.length) { showToast('No saved presets to export yet', 'info'); return; }
        const blob = new Blob([JSON.stringify({ trleAtlasPresets: 1, presets: userPresets }, null, 2)],
            { type: 'application/json' });
        downloadBlob(blob, 'atlas_material_presets.json');
        showToast(`Exported ${userPresets.length} preset${userPresets.length === 1 ? '' : 's'} ⬇`, 'success');
    }
    function importUserPresets(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = JSON.parse(r.result);
                const list = Array.isArray(data) ? data : (data && data.presets);
                if (!Array.isArray(list)) throw new Error('not a preset file');
                let added = 0;
                list.forEach(p => {
                    if (p && p.name && p.preset && typeof p.preset === 'object') {
                        userPresets.push({ id: newPresetId(), name: String(p.name).slice(0, 40), preset: p.preset });
                        added++;
                    }
                });
                if (!added) { showToast('No usable presets in that file', 'error'); return; }
                persistUserPresets();
                $('at-mat-aesthetic').value = 'saved';
                matPopulatePresets();
                matOnPresetChange();
                showToast(`Imported ${added} preset${added === 1 ? '' : 's'} ⭐`, 'success');
            } catch { showToast('Could not read that preset file', 'error'); }
        };
        r.readAsText(file);
    }

    /* Whether to feather the height map's borders so a tiling texture's parallax
       doesn't cliff at the repeat seam. Shared by preview + export so they match. */
    function heightSeamlessOn() {
        const cb = document.getElementById('at-export-height-seamless');
        return !!(cb && cb.checked);
    }

    function matSchedulePreview() {
        if (matMulti.enabled) mmCaptureEditor();
        clearTimeout(mat.previewTimer);
        mat.previewTimer = setTimeout(matRenderPreview, 250);
        if (mat3d.active) { clearTimeout(mat3d.timer); mat3d.timer = setTimeout(mat3dUpdate, 300); }
    }

    /* Append a labelled thumbnail to the map-preview row. */
    function matMkPrev(wrap, canvas, label, S) {
        const d = document.createElement('div');
        d.className = 'at-mat-prev';
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        c.getContext('2d').drawImage(canvas, 0, 0, S, S);
        d.appendChild(c);
        d.appendChild(document.createTextNode(label));
        wrap.appendChild(d);
    }

    function matRenderPreview() {
        if (mat.id === null) return;
        matCleanupGL();
        const el = byId(mat.id);
        const S = state.tileSize;
        const enabled = {};
        MAT_PREVIEW_MAPS.forEach(m => enabled[m] = true);
        const wrap = $('at-mat-previews');

        let composed;
        if (matMulti.enabled) {
            // Composite all layers (WYSIWYG with the export). Upload each composited
            // map canvas into an FBO so the lit preview can light it.
            composed = composeLayerMaps(el.canvas, matMulti.layers, enabled, S);
            const E = TRLE.Engine;
            const tex = E.createTextureFromImage(el.canvas);
            const maps = {};
            for (const mt of MAT_PREVIEW_MAPS) if (composed[mt]) {
                const t = E.createTextureFromImage(composed[mt]);
                const fbo = E.createFBO(S, S);
                E.blit('copy', { u_texture: t }, fbo);
                E.deleteTexture(t);
                maps[mt] = fbo;
            }
            mat.gl = { tex, maps };
            mmRenderCanvas();
        } else {
            // Empty "My presets" group — nothing to generate from yet.
            if (!matCurrentPresetObjBase()) {
                wrap.innerHTML = '<p class="sm-hint" style="margin:6px 0;">Pick or save a preset to preview its maps.</p>';
                return;
            }
            const preset = Object.assign({}, matCurrentPresetObj(), { flipNormalY: state.flipNormalY, heightSeamless: heightSeamlessOn() });
            const tex = TRLE.Engine.createTextureFromImage(el.canvas);
            const maps = TRLE.Engine.generateMaps(tex, S, S, preset, enabled);
            mat.gl = { tex, maps };
            composed = {};
            for (const m of MAT_PREVIEW_MAPS) if (maps[m]) composed[m] = TRLE.Engine.fboToCanvas(maps[m]);
        }

        wrap.innerHTML = '';
        matMkPrev(wrap, el.canvas, 'Diffuse', S);
        MAT_PREVIEW_MAPS.forEach(m => {
            if (composed[m]) matMkPrev(wrap, composed[m], m.charAt(0).toUpperCase() + m.slice(1), S);
        });
        matRenderLit();
    }

    /* Lit preview using the materialPreview shader + cached maps (Phase 11). */
    function matRenderLit() {
        if (!mat.gl) return;
        const S = state.tileSize;
        const E = TRLE.Engine;
        const m = mat.gl.maps;
        const fallback = mat.gl.tex;
        const has = k => (m[k] ? 1.0 : 0.0);
        const fbo = E.createFBO(S, S);
        E.blit('materialPreview', {
            u_diffuse:   mat.gl.tex,
            u_normal:    m.normal    ? m.normal.texture    : fallback,
            u_ao:        m.ao        ? m.ao.texture        : fallback,
            u_specular:  m.specular  ? m.specular.texture  : fallback,
            u_roughness: m.roughness ? m.roughness.texture : fallback,
            u_emissive:  fallback,
            u_hasNormal: has('normal'), u_hasAO: has('ao'),
            u_hasSpecular: has('specular'), u_hasRoughness: has('roughness'),
            u_hasEmissive: 0.0,
            u_lightDir: mat.lightDir
        }, fbo);
        const lit = $('at-mat-lit');
        lit.getContext('2d').drawImage(E.fboToCanvas(fbo), 0, 0, lit.width, lit.height);
        E.deleteFBO(fbo);
    }

    /* ============ 3D PREVIEW (Babylon.js via TRLE.Preview3D) ============
       Thin wrapper around the shared TRLE.Preview3D module (js/preview3d.js),
       which lazy-loads Babylon on first use and renders a height-displaced PBR
       mesh in its own isolated WebGL context. We only hand it our generated map
       canvases; it never touches TRLE.Engine's GL state. */
    const mat3d = { active: false, ctrl: null, timer: null };

    function mat3dStatus(msg) { const e = $('at-mat-3d-status'); if (e) e.textContent = msg || ''; }
    function mat3dCtrl() {
        if (!mat3d.ctrl) mat3d.ctrl = TRLE.Preview3D.create($('at-mat-3d'), { onStatus: mat3dStatus });
        return mat3d.ctrl;
    }

    /* Lit-preview display size (px). Persisted; defaults to the canvas's native 220. */
    function matPreviewSize() {
        const px = parseInt(prefs.matPreviewSize, 10);
        return (px >= 140 && px <= 380) ? px : 220;
    }
    /* Scale the 2D lit canvas and the 3D wrap to `px` via CSS only — the canvas
       backing resolution and all exported maps are untouched (preview-only). */
    function applyMatPreviewSize(px) {
        const lit = $('at-mat-lit');
        if (lit) { lit.style.width = px + 'px'; lit.style.height = px + 'px'; }
        const wrap = $('at-mat-3d-wrap');
        if (wrap) wrap.style.width = px + 'px';
    }

    /* Relief slider (0–100) ⇄ displacement fraction (0–1). */
    function mat3dReliefFromSlider() { return (parseInt($('at-mat-disp').value, 10) || 0) / 100; }
    /* A sensible starting relief derived from the preset's Height Strength (1–50). */
    function mat3dDefaultReliefSlider() {
        const hs = Number(matCurrentPresetObj().heightStrength) || 20;
        return Math.round(Math.min(90, Math.max(12, hs * 1.8)));
    }

    /* Regenerate the full map set for the current material and push it to Babylon. */
    function mat3dUpdate() {
        if (!mat3d.active || mat.id === null) return;
        const el = byId(mat.id); if (!el) return;
        const S = state.tileSize;
        const enabled = { normal: true, ao: true, roughness: true, emissive: true, height: true };
        let canv;
        if (matMulti.enabled) {
            const c = composeLayerMaps(el.canvas, matMulti.layers, enabled, S);
            canv = { diffuse: el.canvas, normal: c.normal, ao: c.ao, roughness: c.roughness, emissive: c.emissive, height: c.height };
        } else {
            const preset = Object.assign({}, matCurrentPresetObj(), { flipNormalY: state.flipNormalY, heightSeamless: heightSeamlessOn() });
            const tex  = TRLE.Engine.createTextureFromImage(el.canvas);
            const maps = TRLE.Engine.generateMaps(tex, S, S, preset, enabled);
            const toCanvas = k => maps[k] ? TRLE.Engine.fboToCanvas(maps[k]) : null;
            canv = {
                diffuse: el.canvas, normal: toCanvas('normal'), ao: toCanvas('ao'),
                roughness: toCanvas('roughness'), emissive: toCanvas('emissive'), height: toCanvas('height')
            };
            Object.values(maps).forEach(f => f && TRLE.Engine.deleteFBO(f));
            TRLE.Engine.deleteTexture(tex);
        }

        const ctrl = mat3dCtrl();
        ctrl.setRelief(mat3dReliefFromSlider(), false);  // store; setMaps rebuilds once
        ctrl.setMaps(canv);
    }

    function mat3dSetMode(mode) {
        const on = mode === '3d';
        mat3d.active = on;
        $('at-mat-2d').classList.toggle('active', !on);
        $('at-mat-3d-btn').classList.toggle('active', on);
        $('at-mat-lit').style.display = on ? 'none' : 'block';
        $('at-mat-3d-wrap').style.display = on ? 'block' : 'none';
        $('at-mat-prev-hint').textContent = on ? 'drag to orbit · scroll to zoom' : 'drag to move the light';
        if (on) {
            $('at-mat-disp').value = String(mat3dDefaultReliefSlider());  // smart default from the preset
            mat3dCtrl().resume();
            mat3dUpdate();
        } else if (mat3d.ctrl) {
            mat3d.ctrl.pause();
        }
    }

    function mat3dPause() {
        clearTimeout(mat3d.timer);
        mat3d.active = false;            // render loop idles; engine kept alive for fast re-open
        if (mat3d.ctrl) mat3d.ctrl.pause();
    }

    /* Load a material descriptor ({type,aesthetic,key,custom}) into the editor
       controls. Shared by openMatModal and the multi-material layer picker. */
    function matLoadMaterialDescriptor(m) {
        $('at-mat-type').value      = m ? m.type : 'solid';
        $('at-mat-aesthetic').value = m ? m.aesthetic : 'realistic';
        matPopulatePresets(m ? m.key : DEFAULTS.solid);
        if (m && m.custom) {
            matLoadParams(m.custom);
            mat.dirty = true;
            $('at-mat-adv').open = true;
        } else {
            const p = matCurrentPresetObjBase();
            if (p) matLoadParams(p);
            $('at-mat-adv').open = false;
        }
        $('at-mat-desc').textContent = (matCurrentPresetObjBase() || {}).description || '';
    }
    /* Read the editor controls back into a material descriptor. */
    function currentMaterialDescriptor() {
        const fromSaved = $('at-mat-aesthetic').value === 'saved';
        return {
            type:      $('at-mat-type').value,
            aesthetic: $('at-mat-aesthetic').value,
            key:       $('at-mat-preset').value,
            custom:    (fromSaved || mat.dirty) ? Object.assign({}, matCurrentPresetObj()) : null
        };
    }

    function openMatModal(id) {
        mat.id = id;
        mat.batchIds = null;
        mat.dirty = false;
        const el = byId(id);
        $('at-mat-title').textContent = `🎨 Set Material — Tile ${indexOf(id) + 1}`;

        matLoadMaterialDescriptor(el.material);
        mmInit(el);           // set up the multi-material layer state from the tile

        hidePresetName();     // reset the save/rename name field if it was left open
        mat3dSetMode('2d');   // every open starts in 2D; 3D loads Babylon only on demand
        openModal('mat');
        matSchedulePreview();
    }

    /* Open the material modal to apply one material to several tiles at once.
       Seeds the editor from the first tile; Assign writes to every batch tile. */
    function openMatModalBatch(ids) {
        openMatModal(ids[0]);
        mat.batchIds = ids.slice();
        $('at-mat-title').textContent = `🎨 Apply Material — ${ids.length} tiles`;
    }

    /* ============ MULTI-MATERIAL (per-region layers) ============ */
    const MM_COLORS = ['#e8852a', '#4ec9b0', '#c586c0', '#dcdcaa', '#569cd6', '#f44747', '#6a9955', '#d7ba7d'];
    const matMulti = { enabled: false, layers: [], active: 0, tool: 'brush', erase: false, loading: false };

    function mmHexToRgb(hex) {
        const h = hex.replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function mmBlankMask(S) { const c = document.createElement('canvas'); c.width = S; c.height = S; return c; }

    /* Initialise the layer state when the modal opens. An existing multi-material
       tile loads its layers; a plain tile starts with a single Base layer mirroring
       its current material (multi-mode off until the user enables it). */
    function mmInit(el) {
        const S = state.tileSize;
        if (hasMatLayers(el)) {
            matMulti.enabled = true;
            matMulti.layers = cloneMatLayers(el.matLayers);
        } else {
            matMulti.enabled = false;
            matMulti.layers = [{ name: 'Base', color: MM_COLORS[0], feather: 0,
                                 material: el.material ? deepCopyMaterial(el.material) : currentMaterialDescriptor(), mask: null }];
        }
        matMulti.active = 0;
        matMulti.tool = 'brush';
        matMulti.erase = false;
        $('at-mm-enable').checked = matMulti.enabled;
        mmApplyEnabledUI();
        if (matMulti.enabled) mmSelect(0); else mmRenderList();
    }

    function mmApplyEnabledUI() {
        $('at-mat-multi').style.display = matMulti.enabled ? 'block' : 'none';
        $('at-modal-mat').classList.toggle('at-modal-xxl', matMulti.enabled);
        if (matMulti.enabled) { mmSetTool(matMulti.tool || 'brush'); mmRenderList(); }
    }

    function mmEnable(on) {
        matMulti.enabled = on;
        if (on && matMulti.layers.length < 1) {
            matMulti.layers = [{ name: 'Base', color: MM_COLORS[0], feather: 0, material: currentMaterialDescriptor(), mask: null }];
        }
        matMulti.active = Math.min(matMulti.active, matMulti.layers.length - 1);
        mmApplyEnabledUI();
        if (on) mmSelect(matMulti.active);
        matSchedulePreview();
    }

    function mmAddLayer() {
        const S = state.tileSize;
        const idx = matMulti.layers.length;
        matMulti.layers.push({
            name: idx === 0 ? 'Base' : `Layer ${idx}`,
            color: MM_COLORS[idx % MM_COLORS.length],
            feather: 2,
            material: currentMaterialDescriptor(),
            mask: mmBlankMask(S)
        });
        mmSelect(matMulti.layers.length - 1);
        matSchedulePreview();
    }

    function mmDeleteLayer(i) {
        if (i <= 0 || i >= matMulti.layers.length) return;   // never delete the base
        matMulti.layers.splice(i, 1);
        matMulti.active = Math.min(matMulti.active, matMulti.layers.length - 1);
        mmSelect(matMulti.active);
        matSchedulePreview();
    }

    function mmMoveLayer(i, dir) {
        const j = i + dir;
        if (i <= 0 || j <= 0 || i >= matMulti.layers.length || j >= matMulti.layers.length) return; // base stays at 0
        const a = matMulti.layers;
        [a[i], a[j]] = [a[j], a[i]];
        matMulti.active = j;
        mmSelect(j);
        matSchedulePreview();
    }

    /* Make layer i active and load its material into the editor controls. */
    function mmSelect(i) {
        matMulti.active = i;
        const L = matMulti.layers[i];
        if (!L) return;
        matMulti.loading = true;
        mat.dirty = false;
        matLoadMaterialDescriptor(L.material);
        $('at-mm-feather').value = L.feather || 0;
        matMulti.loading = false;
        mmRenderList();
        mmRenderCanvas();
        const base = i === 0;
        $('at-mm-selhint').textContent = base
            ? 'Base layer — its material fills the whole tile. Add a layer to paint a region on top.'
            : `Paint where “${L.name}” applies. It draws over the layers beneath it.`;
    }

    /* Write the editor controls into the active layer's material. */
    function mmCaptureEditor() {
        if (!matMulti.enabled || matMulti.loading) return;
        const L = matMulti.layers[matMulti.active];
        if (L) { L.material = currentMaterialDescriptor(); mmRenderList(); }
    }

    function mmRenderList() {
        const ul = $('at-mm-list');
        if (!ul) return;
        ul.innerHTML = '';
        matMulti.layers.forEach((L, i) => {
            const li = document.createElement('li');
            li.className = 'at-mm-item' + (i === matMulti.active ? ' active' : '');
            const sw = document.createElement('span'); sw.className = 'at-mm-swatch'; sw.style.background = L.color;
            const name = document.createElement('span'); name.className = 'at-mm-name';
            name.textContent = L.name; name.title = 'Double-click to rename';
            const matLbl = document.createElement('span'); matLbl.className = 'at-mm-mat';
            matLbl.textContent = (presetFromMaterial(L.material).label || L.material.key || 'material');
            const up = document.createElement('button'); up.textContent = '▲'; up.title = 'Move up'; up.disabled = i <= 1;
            const dn = document.createElement('button'); dn.textContent = '▼'; dn.title = 'Move down'; dn.disabled = i === 0 || i === matMulti.layers.length - 1;
            const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Delete layer'; del.disabled = i === 0;
            li.append(sw, name, matLbl, up, dn, del);
            li.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') mmSelect(i); });
            name.addEventListener('dblclick', e => { e.stopPropagation(); mmRenameLayer(i); });
            up.addEventListener('click', e => { e.stopPropagation(); mmMoveLayer(i, -1); });
            dn.addEventListener('click', e => { e.stopPropagation(); mmMoveLayer(i, +1); });
            del.addEventListener('click', e => { e.stopPropagation(); mmDeleteLayer(i); });
            ul.appendChild(li);
        });
    }

    function mmRenameLayer(i) {
        const L = matMulti.layers[i]; if (!L) return;
        const name = prompt('Layer name', L.name);
        if (name && name.trim()) { L.name = name.trim().slice(0, 24); mmRenderList(); mmRenderCanvas(); }
    }

    /* Tint a grayscale mask with a layer colour (alpha = mask luminance). */
    function mmTintMask(mask, color, S) {
        const md = mask.getContext('2d').getImageData(0, 0, S, S);
        const c = document.createElement('canvas'); c.width = S; c.height = S;
        const out = c.getContext('2d').createImageData(S, S);
        const [r, g, b] = mmHexToRgb(color);
        for (let i = 0; i < md.data.length; i += 4) {
            out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = md.data[i];
        }
        c.getContext('2d').putImageData(out, 0, 0);
        return c;
    }

    /* Draw the diffuse + each layer's mask (tinted) onto the selection canvas. */
    function mmRenderCanvas() {
        const el = byId(mat.id); if (!el) return;
        const S = state.tileSize;
        const cv = $('at-mat-select');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(el.canvas, 0, 0, S, S);
        matMulti.layers.forEach((L, i) => {
            if (!L.mask) return;
            ctx.globalAlpha = i === matMulti.active ? 0.55 : 0.22;
            ctx.drawImage(mmTintMask(L.mask, L.color, S), 0, 0, S, S);
        });
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, S / 200);
        // lasso in-progress outline
        if (matMulti.tool === 'lasso' && mmLasso.pts.length) {
            ctx.beginPath();
            mmLasso.pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
            ctx.stroke();
        }
        // rectangle / ellipse rubber-band outline
        if (mmDrag.active && (matMulti.tool === 'rect' || matMulti.tool === 'ellipse')) {
            const x = Math.min(mmDrag.x0, mmDrag.x1), y = Math.min(mmDrag.y0, mmDrag.y1);
            const w = Math.abs(mmDrag.x1 - mmDrag.x0), h = Math.abs(mmDrag.y1 - mmDrag.y0);
            ctx.beginPath();
            if (matMulti.tool === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            else ctx.rect(x, y, w, h);
            ctx.stroke();
        }
    }

    /* ---- Selection painting on the canvas (brush · lasso · rect · ellipse · wand) ---- */
    const mmLasso = { pts: [] };
    const mmDrag = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
    function mmCanvasPos(ev) {
        const cv = $('at-mat-select'); const r = cv.getBoundingClientRect();
        return { x: (ev.clientX - r.left) / r.width * cv.width, y: (ev.clientY - r.top) / r.height * cv.height };
    }
    function mmActiveMask() {
        const L = matMulti.layers[matMulti.active];
        if (!L || matMulti.active === 0) return null;     // base has no paintable mask
        if (!L.mask) L.mask = mmBlankMask(state.tileSize);
        return L.mask;
    }
    function mmBrushDab(mask, x, y) {
        const ctx = mask.getContext('2d');
        ctx.globalCompositeOperation = matMulti.erase ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, parseInt($('at-mm-brush').value, 10) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
    function mmFillPolygon(mask, pts) {
        if (pts.length < 3) return;
        const ctx = mask.getContext('2d');
        ctx.globalCompositeOperation = matMulti.erase ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
    /* Fill a dragged rectangle / ellipse into the mask. */
    function mmFillShape(mask, shape, x0, y0, x1, y1) {
        const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (w < 1 || h < 1) return;
        const ctx = mask.getContext('2d');
        ctx.globalCompositeOperation = matMulti.erase ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
    /* Magic wand: select pixels whose diffuse colour is within Tolerance of the
       clicked pixel — contiguous (flood fill) or every matching pixel in the tile. */
    function mmWandSelect(px, py) {
        const mask = mmActiveMask(), el = byId(mat.id);
        if (!mask || !el) return;
        const S = state.tileSize;
        const ix = Math.max(0, Math.min(S - 1, Math.floor(px)));
        const iy = Math.max(0, Math.min(S - 1, Math.floor(py)));
        const src = el.canvas.getContext('2d').getImageData(0, 0, S, S).data;
        const o = (iy * S + ix) * 4, tr = src[o], tg = src[o + 1], tb = src[o + 2];
        const thr = (parseInt($('at-mm-tol').value, 10) / 100) * 441.673;   // max RGB euclidean distance
        const contiguous = $('at-mm-wand-contig').checked;
        const ctx = mask.getContext('2d');
        const md = ctx.getImageData(0, 0, S, S);
        const add = !matMulti.erase;
        const match = p => { const i = p * 4, dr = src[i] - tr, dg = src[i + 1] - tg, db = src[i + 2] - tb; return Math.sqrt(dr * dr + dg * dg + db * db) <= thr; };
        const set = p => { const i = p * 4; const v = add ? 255 : 0; md.data[i] = v; md.data[i + 1] = v; md.data[i + 2] = v; md.data[i + 3] = v; };
        if (contiguous) {
            const seen = new Uint8Array(S * S), stack = [iy * S + ix];
            while (stack.length) {
                const p = stack.pop();
                if (seen[p]) continue;
                seen[p] = 1;
                if (!match(p)) continue;
                set(p);
                const x = p % S, y = (p / S) | 0;
                if (x > 0) stack.push(p - 1); if (x < S - 1) stack.push(p + 1);
                if (y > 0) stack.push(p - S); if (y < S - 1) stack.push(p + S);
            }
        } else {
            for (let p = 0; p < S * S; p++) if (match(p)) set(p);
        }
        ctx.putImageData(md, 0, 0);
    }

    function mmSetTool(tool) {
        matMulti.tool = tool;
        mmLasso.pts = [];
        mmDrag.active = false;
        document.querySelectorAll('#at-mat-multi .at-seg[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $('at-mat-select').classList.toggle('at-mm-brushmode', tool === 'brush');
        $('at-mm-brushwrap').style.display = tool === 'brush' ? '' : 'none';
        $('at-mm-wandwrap').style.display = tool === 'wand' ? '' : 'none';
        $('at-mm-contigwrap').style.display = tool === 'wand' ? '' : 'none';
        const hint = {
            brush: 'Drag to paint the region; toggle Paint/Erase.',
            lasso: 'Click points around the region; double-click or Enter to close.',
            rect: 'Drag a rectangle over the region.',
            ellipse: 'Drag an ellipse over the region.',
            wand: 'Click a colour to select similar pixels (raise Tol to grab more).'
        }[tool];
        if (matMulti.active > 0) $('at-mm-selhint').textContent = hint;
        mmRenderCanvas();
    }

    function setupMultiMaterial() {
        $('at-mm-enable').addEventListener('change', e => mmEnable(e.target.checked));
        $('at-mm-add').addEventListener('click', mmAddLayer);
        document.querySelectorAll('#at-mat-multi .at-seg[data-tool]').forEach(b =>
            b.addEventListener('click', () => mmSetTool(b.dataset.tool)));
        $('at-mm-erase').addEventListener('click', function () {
            matMulti.erase = !matMulti.erase;
            this.textContent = matMulti.erase ? '🧽 Erase' : '🖌 Paint';
            this.setAttribute('aria-pressed', String(matMulti.erase));
        });
        $('at-mm-feather').addEventListener('input', function () {
            const L = matMulti.layers[matMulti.active];
            if (L) { L.feather = parseInt(this.value, 10) || 0; matSchedulePreview(); }
        });
        $('at-mm-fill').addEventListener('click', () => {
            const mask = mmActiveMask(); if (!mask) return;
            const S = state.tileSize, ctx = mask.getContext('2d');
            ctx.globalCompositeOperation = matMulti.erase ? 'destination-out' : 'source-over';
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
            ctx.globalCompositeOperation = 'source-over';
            mmRenderCanvas(); matSchedulePreview();
        });
        $('at-mm-invert').addEventListener('click', () => {
            const mask = mmActiveMask(); if (!mask) return;
            const S = state.tileSize, ctx = mask.getContext('2d');
            const inv = document.createElement('canvas'); inv.width = S; inv.height = S;
            const ix = inv.getContext('2d');
            ix.fillStyle = '#fff'; ix.fillRect(0, 0, S, S);
            ix.globalCompositeOperation = 'destination-out'; ix.drawImage(mask, 0, 0);
            ctx.clearRect(0, 0, S, S); ctx.drawImage(inv, 0, 0);
            mmRenderCanvas(); matSchedulePreview();
        });
        $('at-mm-clear').addEventListener('click', () => {
            const mask = mmActiveMask(); if (!mask) return;
            mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
            mmLasso.pts = [];
            mmRenderCanvas(); matSchedulePreview();
        });

        const cv = $('at-mat-select');
        let painting = false;
        cv.addEventListener('pointerdown', e => {
            const mask = mmActiveMask();
            if (!mask) { showToast('Select a layer above the Base to paint its region', 'info'); return; }
            const p = mmCanvasPos(e);
            switch (matMulti.tool) {
                case 'brush':
                    painting = true; try { cv.setPointerCapture(e.pointerId); } catch {}
                    mmBrushDab(mask, p.x, p.y); mmRenderCanvas(); break;
                case 'lasso':
                    mmLasso.pts.push(p); mmRenderCanvas(); break;
                case 'rect': case 'ellipse':
                    mmDrag.active = true; mmDrag.x0 = mmDrag.x1 = p.x; mmDrag.y0 = mmDrag.y1 = p.y;
                    try { cv.setPointerCapture(e.pointerId); } catch {} break;
                case 'wand':
                    mmWandSelect(p.x, p.y); mmRenderCanvas(); matSchedulePreview(); break;
            }
            e.preventDefault();
        });
        cv.addEventListener('pointermove', e => {
            if (painting && matMulti.tool === 'brush') {
                const mask = mmActiveMask(); if (!mask) return;
                const p = mmCanvasPos(e); mmBrushDab(mask, p.x, p.y); mmRenderCanvas(); e.preventDefault();
            } else if (mmDrag.active && (matMulti.tool === 'rect' || matMulti.tool === 'ellipse')) {
                const p = mmCanvasPos(e); mmDrag.x1 = p.x; mmDrag.y1 = p.y; mmRenderCanvas(); e.preventDefault();
            }
        });
        const endStroke = () => {
            if (painting) { painting = false; matSchedulePreview(); }
            if (mmDrag.active) {
                mmDrag.active = false;
                const mask = mmActiveMask();
                if (mask) mmFillShape(mask, matMulti.tool, mmDrag.x0, mmDrag.y0, mmDrag.x1, mmDrag.y1);
                mmRenderCanvas(); matSchedulePreview();
            }
        };
        cv.addEventListener('pointerup', endStroke);
        cv.addEventListener('pointerleave', endStroke);
        cv.addEventListener('dblclick', () => {   // close the lasso
            if (matMulti.tool === 'lasso' && mmLasso.pts.length >= 3) {
                const mask = mmActiveMask();
                if (mask) { mmFillPolygon(mask, mmLasso.pts); }
                mmLasso.pts = []; mmRenderCanvas(); matSchedulePreview();
            }
        });
        document.addEventListener('keydown', e => {
            if (!matMulti.enabled || $('at-overlay').style.display === 'none') return;
            if (matMulti.tool === 'lasso' && e.key === 'Enter' && mmLasso.pts.length >= 3) {
                const mask = mmActiveMask();
                if (mask) mmFillPolygon(mask, mmLasso.pts);
                mmLasso.pts = []; mmRenderCanvas(); matSchedulePreview();
            } else if (matMulti.tool === 'lasso' && e.key === 'Escape' && mmLasso.pts.length) {
                e.stopPropagation(); mmLasso.pts = []; mmRenderCanvas();   // cancel the in-progress lasso, keep modal open
            }
        }, true);
    }

    function setupMatModal() {
        // Fantasy preset lists are empty placeholders right now — hide the
        // option until presets.js actually defines them
        if (!TRLE.getSolidPresetKeys('fantasy').length && !TRLE.getLiquidPresetKeys('fantasy').length) {
            const fantasyOpt = $('at-mat-aesthetic').querySelector('option[value="fantasy"]');
            if (fantasyOpt) fantasyOpt.remove();
        }

        // Build the advanced slider grid once
        const wrap = $('at-mat-sliders');
        MAT_PARAMS.forEach(([key, label, min, max, step]) => {
            const g = document.createElement('div');
            g.className = 'form-group';
            g.innerHTML = `
                <label>${label} — <span id="at-mat-p-${key}-val">${min}</span></label>
                <input type="range" id="at-mat-p-${key}" min="${min}" max="${max}" step="${step || 1}" value="${min}" style="width:100%;">`;
            wrap.appendChild(g);
            g.querySelector('input').addEventListener('input', function () {
                $(`at-mat-p-${key}-val`).textContent = this.value;
                mat.dirty = true;
                matSchedulePreview();
            });
        });

        $('at-mat-type').addEventListener('change', () => { matPopulatePresets(); matOnPresetChange(); });
        $('at-mat-aesthetic').addEventListener('change', () => { matPopulatePresets(); matOnPresetChange(); });
        $('at-mat-preset').addEventListener('change', () => { matOnPresetChange(); updatePresetBarButtons(); });

        // Save / reuse user material presets
        $('at-mat-savepreset').addEventListener('click', () => {
            if (!matCurrentPresetObjBase()) { showToast('Pick or tweak a material first', 'error'); return; }
            showPresetName('save', '');
        });
        $('at-mat-renamepreset').addEventListener('click', () => {
            const u = userPresetById($('at-mat-preset').value);
            if (u) showPresetName('rename', u.name);
        });
        $('at-mat-delpreset').addEventListener('click', deleteCurrentPreset);
        $('at-mat-nameok').addEventListener('click', commitPresetName);
        $('at-mat-namecancel').addEventListener('click', hidePresetName);
        $('at-mat-presetname').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commitPresetName(); }
            else if (e.key === 'Escape') { e.preventDefault(); hidePresetName(); }
        });
        $('at-mat-exportpresets').addEventListener('click', exportUserPresets);
        $('at-mat-importpresets').addEventListener('click', () => $('at-mat-importpresets-file').click());
        $('at-mat-importpresets-file').addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (f) importUserPresets(f);
            e.target.value = '';   // allow re-importing the same file
        });

        // Drag on the lit preview to move the light (re-lights from cached maps).
        const lit = $('at-mat-lit');
        let lighting = false;
        const setLight = e => {
            const r = lit.getBoundingClientRect();
            const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
            const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
            const x = nx, y = -ny, z = 0.7;
            const len = Math.hypot(x, y, z) || 1;
            mat.lightDir = [x / len, y / len, z / len];
            matRenderLit();
        };
        lit.addEventListener('pointerdown', e => { lighting = true; try { lit.setPointerCapture(e.pointerId); } catch {} setLight(e); e.preventDefault(); });
        lit.addEventListener('pointermove', e => { if (lighting) { setLight(e); e.preventDefault(); } });
        lit.addEventListener('pointerup', () => { lighting = false; });

        // User-resizable lit preview (CSS-only scale; never touches exported maps).
        // Persisted so the chosen size sticks between sessions.
        const sizeSlider = $('at-mat-prev-size');
        sizeSlider.value = String(matPreviewSize());
        applyMatPreviewSize(matPreviewSize());
        sizeSlider.addEventListener('input', () => {
            const px = parseInt(sizeSlider.value, 10) || 220;
            applyMatPreviewSize(px);
            savePref('matPreviewSize', px);
            if (mat3d.active && mat3d.ctrl && mat3d.ctrl.resize) mat3d.ctrl.resize();
        });

        // 2D / 3D preview toggle + relief-depth slider (3D loads Babylon on demand).
        $('at-mat-2d').addEventListener('click', () => mat3dSetMode('2d'));
        $('at-mat-3d-btn').addEventListener('click', () => mat3dSetMode('3d'));
        $('at-mat-disp').addEventListener('input', () => {
            if (mat3d.active && mat3d.ctrl) mat3d.ctrl.setRelief(mat3dReliefFromSlider(), true);
        });
        // Per-map toggles for the 3D preview — isolate each map's contribution.
        document.querySelectorAll('#at-mat-3d-maps input[data-m3d]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (mat3d.ctrl) mat3d.ctrl.setEnabled(cb.dataset.m3d, cb.checked);
            });
        });

        $('at-mat-save').addEventListener('click', () => {
            if (mat.id === null) return;
            if (!matCurrentPresetObjBase()) { showToast('Pick or save a preset first', 'error'); return; }

            // ---- Multi-material: write the layer stack onto the tile (single tile only) ----
            if (matMulti.enabled) {
                mmCaptureEditor();
                const regionLayers = matMulti.layers.filter((L, i) => i === 0 || L.mask);
                const el = byId(mat.id);
                if (regionLayers.length >= 2) {
                    el.matLayers = cloneMatLayers(regionLayers);
                    el.material = deepCopyMaterial(regionLayers[0].material);   // base = single-material fallback
                } else {
                    el.matLayers = null;                                       // collapsed to a single material
                    el.material = deepCopyMaterial(matMulti.layers[0].material);
                }
                closeModal();
                renderGrid();
                pushHistory(`Material: ${materialLabel(el)}`);
                showToast(el.matLayers ? `Multi-material assigned (${el.matLayers.length} layers) 🎭` : `Material assigned: ${materialLabel(el)}`, 'success');
                return;
            }

            const fromSaved = $('at-mat-aesthetic').value === 'saved';
            const material = {
                type:      $('at-mat-type').value,
                aesthetic: $('at-mat-aesthetic').value,
                key:       $('at-mat-preset').value,
                // Saved presets are baked in so the tile keeps its look even if the
                // preset is later edited or deleted; built-ins only bake on tweak.
                custom:    (fromSaved || mat.dirty) ? Object.assign({}, matCurrentPresetObj()) : null
            };
            // Single tile, or the whole batch when applying to a multi-selection.
            const targets = (mat.batchIds && mat.batchIds.length ? mat.batchIds : [mat.id])
                .map(byId).filter(el => el && el.kind !== 'transition');
            targets.forEach(el => {
                el.material = deepCopyMaterial(material);
                el.matLayers = null;   // a flat material clears any prior layer stack
                // An animation's frames share one material — propagate to the group.
                if (el.kind === 'anim' && el.anim && el.anim.total > 1) {
                    state.elements.forEach(s => {
                        if (s !== el && s.kind === 'anim' && s.anim && s.anim.group === el.anim.group)
                            s.material = deepCopyMaterial(el.material);
                    });
                }
            });
            const batch = targets.length > 1;
            closeModal();
            renderGrid();
            pushHistory(batch ? `Material → ${targets.length} tiles` : `Material: ${materialLabel(targets[0])}`);
            showToast(batch ? `Material applied to ${targets.length} tiles 🎨` : `Material assigned: ${materialLabel(targets[0])}`, 'success');
        });
    }

    /* ============ HEAL / FILL MODAL (Phase 6) ============ */
    const HEAL_HINTS = {
        patch:     'Fills from the pixels immediately around the spot, matching local tone & texture. Best all-rounder — handles high-contrast areas where global sampling drags in the wrong shade.',
        diffusion: 'Smoothly interpolates surrounding colours into the painted area. Best for small blemishes, scratches or logos on smoothish surfaces.',
        texture:   'Replaces the painted area with texture re-synthesised from the whole tile. Best for uniformly busy / organic surfaces.'
    };
    const heal = { id: null, maskCanvas: null, resultCanvas: null, brushErase: false };

    function healCleanup() {
        heal.id = null;
        heal.resultCanvas = null;
    }

    function updateHealHint() {
        $('at-heal-hint').textContent = HEAL_HINTS[$('at-heal-method').value] || '';
    }

    /* Paint view: the tile with a translucent red overlay where the mask is set. */
    function healRenderPaint() {
        const el = byId(heal.id);
        if (!el) return;
        const disp = $('at-heal-canvas');
        const P = disp.width;
        const ctx = disp.getContext('2d');
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(el.canvas, 0, 0, P, P);
        const md = heal.maskCanvas.getContext('2d').getImageData(0, 0, P, P).data;
        const od = ctx.getImageData(0, 0, P, P);
        for (let i = 0; i < od.data.length; i += 4) {
            const a = md[i] / 255 * 0.5;
            if (a > 0) {
                od.data[i]     = Math.round(od.data[i]     * (1 - a) + 255 * a);
                od.data[i + 1] = Math.round(od.data[i + 1] * (1 - a));
                od.data[i + 2] = Math.round(od.data[i + 2] * (1 - a));
            }
        }
        ctx.putImageData(od, 0, 0);
        $('at-heal-canvas-label').textContent = 'Paint the area to heal (red = selected)';
    }

    function healRenderResult() {
        if (!heal.resultCanvas) return;
        const disp = $('at-heal-canvas');
        disp.getContext('2d').drawImage(heal.resultCanvas, 0, 0, disp.width, disp.height);
        $('at-heal-canvas-label').textContent = 'Preview (filled) — Save to apply';
    }

    /* Compute the filled tile at full resolution using the chosen method. */
    /* Neighbour-aware fill (local exemplar synthesis, Efros-Leung style).
       Fills the masked hole onion-peel from the boundary inward; each pixel copies
       the best-matching KNOWN pixel found in a small window AROUND it (not the whole
       tile), so a light region heals from light neighbours and a dark one from dark —
       fixing the high-contrast case where a global sampler drags the wrong tones in. */
    function healPatchFill(srcCanvas, maskCanvasRaw, S) {
        const work = resizeCanvas(srcCanvas, S, S);
        const ctx = work.getContext('2d');
        const img = ctx.getImageData(0, 0, S, S);
        const d = img.data;
        const maskData = resizeCanvas(maskCanvasRaw, S, S).getContext('2d').getImageData(0, 0, S, S).data;
        const hole = new Uint8Array(S * S);
        const known = new Uint8Array(S * S);
        let minx = S, miny = S, maxx = 0, maxy = 0, count = 0;
        for (let i = 0; i < S * S; i++) {
            if (maskData[i * 4] > 128) {
                hole[i] = 1;
                const x = i % S, y = (i / S) | 0;
                if (x < minx) minx = x; if (x > maxx) maxx = x;
                if (y < miny) miny = y; if (y > maxy) maxy = y;
                count++;
            } else known[i] = 1;
        }
        if (!count) return work;
        const PR = 2, WR = 12;   // patch radius (5×5 match), search-window radius
        let remaining = count, guard = 0;
        while (remaining > 0 && guard++ < S) {
            const boundary = [];
            for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
                const i = y * S + x;
                if (!hole[i]) continue;
                if ((x > 0 && known[i - 1]) || (x < S - 1 && known[i + 1]) ||
                    (y > 0 && known[i - S]) || (y < S - 1 && known[i + S])) boundary.push(i);
            }
            if (!boundary.length) break;
            const filled = [];
            for (const i of boundary) {
                const px = i % S, py = (i / S) | 0;
                let bestSSD = Infinity, bestJ = -1;
                for (let dy = -WR; dy <= WR; dy++) for (let dx = -WR; dx <= WR; dx++) {
                    const qx = px + dx, qy = py + dy;
                    if (qx < 0 || qy < 0 || qx >= S || qy >= S) continue;
                    const j = qy * S + qx;
                    if (!known[j] || hole[j]) continue;
                    let ssd = 0, n = 0;
                    for (let ky = -PR; ky <= PR; ky++) for (let kx = -PR; kx <= PR; kx++) {
                        const ax = px + kx, ay = py + ky, bx = qx + kx, by = qy + ky;
                        if (ax < 0 || ay < 0 || ax >= S || ay >= S || bx < 0 || by < 0 || bx >= S || by >= S) continue;
                        const ai = ay * S + ax, bi = by * S + bx;
                        if (!known[ai] || !known[bi]) continue;
                        const a4 = ai * 4, b4 = bi * 4;
                        const dr = d[a4] - d[b4], dg = d[a4 + 1] - d[b4 + 1], dbb = d[a4 + 2] - d[b4 + 2];
                        ssd += dr * dr + dg * dg + dbb * dbb; n++;
                    }
                    if (n < 2) continue;
                    ssd /= n;
                    if (ssd < bestSSD) { bestSSD = ssd; bestJ = j; }
                }
                if (bestJ >= 0) {
                    const a4 = i * 4, b4 = bestJ * 4;
                    d[a4] = d[b4]; d[a4 + 1] = d[b4 + 1]; d[a4 + 2] = d[b4 + 2]; d[a4 + 3] = 255;
                    filled.push(i);
                }
            }
            if (!filled.length) break;
            for (const i of filled) { hole[i] = 0; known[i] = 1; remaining--; }
        }
        ctx.putImageData(img, 0, 0);
        return work;
    }

    function healComputeFill() {
        const el = byId(heal.id);
        const S = state.tileSize;
        const E = TRLE.Engine;
        const method = $('at-heal-method').value;
        if (method === 'patch') {
            return healPatchFill(el.canvas, heal.maskCanvas, S);
        }
        const origTex = E.createTextureFromImage(el.canvas);
        let out;
        if (method === 'texture') {
            const maskTex = E.createTextureFromImage(softenMask(heal.maskCanvas, S));
            const grayFBO = E.createFBO(S, S);
            E.blit('desaturate', { u_texture: origTex, u_gamma: 1.0 }, grayFBO);
            const synthFBO = E.createFBO(S, S);
            E.blit('seamlessSplat', {
                u_texture: origTex, u_heightMap: grayFBO.texture,
                u_falloff: 0.2, u_rotation: 0.0, u_rotationRandom: 0.5,
                u_scale: 1.0, u_wobble: 0.3, u_randomize: 0.6
            }, synthFBO);
            const outFBO = E.createFBO(S, S);
            E.blit('transitionComposite', {
                u_base: origTex, u_overlay: synthFBO.texture, u_mask: maskTex
            }, outFBO);
            out = E.fboToCanvas(outFBO);
            E.deleteFBO(grayFBO); E.deleteFBO(synthFBO); E.deleteFBO(outFBO);
            E.deleteTexture(maskTex);
        } else { // diffusion
            const maskTex = E.createTextureFromImage(resizeCanvas(heal.maskCanvas, S, S));
            const fbo = E.inpaintDiffusion(origTex, maskTex, S);
            out = E.fboToCanvas(fbo);
            E.deleteFBO(fbo);
            E.deleteTexture(maskTex);
        }
        E.deleteTexture(origTex);
        return out;
    }

    function openHealModal(id) {
        heal.id = id;
        heal.resultCanvas = null;
        heal.brushErase = false;
        $('at-heal-tileno').textContent = indexOf(id) + 1;
        const mc = heal.maskCanvas.getContext('2d');
        mc.fillStyle = '#000'; mc.fillRect(0, 0, 256, 256);
        const mode = $('at-heal-brush-mode');
        mode.textContent = '🖌️ Paint'; mode.setAttribute('aria-pressed', 'false');
        updateHealHint();
        openModal('heal');
        healRenderPaint();
    }

    function setupHealModal() {
        // Create the mask canvas up-front so attachMaskBrush binds a real object.
        heal.maskCanvas = document.createElement('canvas');
        heal.maskCanvas.width = 256; heal.maskCanvas.height = 256;
        $('at-heal-method').addEventListener('change', () => {
            updateHealHint();
            heal.resultCanvas = null;   // method changed → previous preview invalid
            healRenderPaint();
        });
        $('at-heal-brush').addEventListener('input', function () {
            $('at-heal-brush-val').textContent = this.value;
        });
        $('at-heal-brush-mode').addEventListener('click', function () {
            heal.brushErase = !heal.brushErase;
            this.textContent = heal.brushErase ? '🧽 Erase' : '🖌️ Paint';
            this.setAttribute('aria-pressed', String(heal.brushErase));
        });
        $('at-heal-clear').addEventListener('click', () => {
            const mc = heal.maskCanvas.getContext('2d');
            mc.fillStyle = '#000'; mc.fillRect(0, 0, heal.maskCanvas.width, heal.maskCanvas.height);
            heal.resultCanvas = null;
            healRenderPaint();
        });
        $('at-heal-preview').addEventListener('click', () => {
            heal.resultCanvas = healComputeFill();
            healRenderResult();
        });
        attachMaskBrush($('at-heal-canvas'), heal.maskCanvas, {
            active: () => heal.id !== null && $('at-modal-heal').style.display !== 'none',
            brushSize: () => parseInt($('at-heal-brush').value),
            erase: () => heal.brushErase,
            onPaint: () => { heal.resultCanvas = null; healRenderPaint(); }
        });
        $('at-heal-save').addEventListener('click', () => {
            if (heal.id === null) return;
            const el = byId(heal.id);
            const result = heal.resultCanvas || healComputeFill();
            el.canvas.getContext('2d').drawImage(result, 0, 0);
            el.edited = true;   // canvas now diverges from original → must be snapshotted
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('Heal');
            showToast('Tile healed', 'success');
        });
    }

    /* ============ FADE TO TRANSPARENT MODAL (Phase T3) ============ */
    const fade = { id: null, maskCanvas: null, brushErase: false };

    function fadeCleanup() { fade.id = null; }

    function fadeBuildMask(P) {
        const amount = parseInt($('at-fade-amount').value) / 100;
        const hardness = parseInt($('at-fade-hardness').value) / 100;
        const shape = $('at-fade-shape').value;
        if (shape === 'custom') return softenMask(fade.maskCanvas, P);
        if (shape === 'dir') return buildTopologyMask(P, $('at-fade-dir').value, 1 - amount, hardness);
        return buildEdgeVignetteMask(P, amount, hardness);   // 'edges'
    }

    function fadePreview() {
        if (fade.id === null) return;
        const P = 256;
        const el = byId(fade.id);
        const tile = resizeCanvas(el.canvas, P, P);
        const faded = applyAlphaFade(tile, fadeBuildMask(P));
        const cv = $('at-fade-preview');
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(faded, 0, 0);
    }

    function fadeSetShape() {
        const shape = $('at-fade-shape').value;
        $('at-fade-dir-wrap').style.display = shape === 'dir' ? '' : 'none';
        $('at-fade-custom').style.display = shape === 'custom' ? '' : 'none';
        fadePreview();
    }

    function openFadeModal(id) {
        fade.id = id;
        fade.brushErase = false;
        $('at-fade-tileno').textContent = indexOf(id) + 1;
        const mc = fade.maskCanvas.getContext('2d');
        mc.fillStyle = '#000'; mc.fillRect(0, 0, fade.maskCanvas.width, fade.maskCanvas.height);
        const bm = $('at-fade-brush-mode');
        bm.textContent = '🖌️ Paint'; bm.setAttribute('aria-pressed', 'false');
        fadeSetShape();
        openModal('fade');
        fadePreview();
    }

    function setupFadeModal() {
        fade.maskCanvas = document.createElement('canvas');
        fade.maskCanvas.width = 256; fade.maskCanvas.height = 256;

        const dirSel = $('at-fade-dir');
        TRANS_MODES.forEach(({ mode, label }) => dirSel.appendChild(new Option(label, mode)));
        dirSel.value = 'TopFull';

        $('at-fade-shape').addEventListener('change', fadeSetShape);
        $('at-fade-dir').addEventListener('change', fadePreview);
        $('at-fade-amount').addEventListener('input', function () { $('at-fade-amount-val').textContent = this.value; fadePreview(); });
        $('at-fade-hardness').addEventListener('input', function () { $('at-fade-hardness-val').textContent = this.value; fadePreview(); });
        $('at-fade-brush').addEventListener('input', function () { $('at-fade-brush-val').textContent = this.value; });
        $('at-fade-brush-mode').addEventListener('click', function () {
            fade.brushErase = !fade.brushErase;
            this.textContent = fade.brushErase ? '🧽 Erase' : '🖌️ Paint';
            this.setAttribute('aria-pressed', String(fade.brushErase));
        });
        $('at-fade-clear').addEventListener('click', () => {
            const mc = fade.maskCanvas.getContext('2d');
            mc.fillStyle = '#000'; mc.fillRect(0, 0, fade.maskCanvas.width, fade.maskCanvas.height);
            fadePreview();
        });
        attachMaskBrush($('at-fade-preview'), fade.maskCanvas, {
            active: () => fade.id !== null && $('at-fade-shape').value === 'custom' && $('at-modal-fade').style.display !== 'none',
            brushSize: () => parseInt($('at-fade-brush').value),
            erase: () => fade.brushErase,
            onPaint: fadePreview
        });
        $('at-fade-apply').addEventListener('click', () => {
            if (fade.id === null) return;
            const el = byId(fade.id);
            const S = state.tileSize;
            const faded = applyAlphaFade(el.canvas, fadeBuildMask(S));
            const ctx = el.canvas.getContext('2d');
            ctx.clearRect(0, 0, S, S);
            ctx.drawImage(faded, 0, 0);
            el.edited = true;
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('Fade to transparent');
            showToast('Faded to transparent', 'success');
        });
    }

    /* ============ EMISSIVE MODAL (Emissive phases E1–E3) ============
       Authors a per-tile glow map (state on `el.emissive`). Selection modes:
       pick-colour, hue-range, brightness, paint. Glow source: texture colours
       or a flat tint. Shared strength + feather/bloom. Preview shows the
       emissive on black (how it reads in the dark). */
    const emissive = { id: null, maskCanvas: null, brushErase: false };

    function emissiveCleanup() { emissive.id = null; }

    function emHexToRgb01(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    function emRgb01ToHex(rgb) {
        const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
        return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
    }
    /* Hue (0..1) from 0-255 RGB — matches the shader's rgb2hsv. */
    function emRgbHue(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (d < 1e-6) return 0;
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6; if (h < 0) h += 1;
        return h;
    }

    /* Build the engine opts from the current controls, scaled to `dim`. */
    function emissiveBuildOpts(dim) {
        const mode = $('at-em-mode').value;
        const opts = {
            strength: parseInt($('at-em-strength').value) / 100,
            feather:  parseInt($('at-em-feather').value) * (dim / 256),
            softness: parseInt($('at-em-softness').value) / 100,
            useTint:  $('at-em-source-type').value === 'tint',
            tint:     emHexToRgb01($('at-em-tint').value)
        };
        if (mode === 'brightness') {
            opts.mode = 0;
            opts.threshold = parseInt($('at-em-threshold').value) / 100;
        } else if (mode === 'color') {
            opts.mode = 1;
            opts.target = emHexToRgb01($('at-em-target').value);
            opts.tolerance = parseInt($('at-em-tolerance').value) / 100;
        } else if (mode === 'hue') {
            opts.mode = 2;
            opts.hueCenter = parseInt($('at-em-hue').value) / 360;
            opts.hueWidth = parseInt($('at-em-huewidth').value) / 360;
            opts.satMin = parseInt($('at-em-satmin').value) / 100;
            opts.valMin = parseInt($('at-em-valmin').value) / 100;
        } else { // paint
            opts.maskCanvas = resizeCanvas(emissive.maskCanvas, dim, dim);
        }
        return opts;
    }

    function emissiveCompute(diffuse) {
        return TRLE.Engine.emissiveFromDiffuse(diffuse, emissiveBuildOpts(diffuse.width));
    }

    function emissivePreview() {
        if (emissive.id === null) return;
        const P = 256;
        const el = byId(emissive.id);
        const tile = resizeCanvas(el.canvas, P, P);
        const src = $('at-em-source-canvas').getContext('2d');
        src.clearRect(0, 0, P, P);
        src.drawImage(tile, 0, 0);
        const out = emissiveCompute(tile);
        const ctx = $('at-em-preview').getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, P, P);
        ctx.drawImage(out, 0, 0);
    }

    function emSetMode() {
        const m = $('at-em-mode').value;
        $('at-em-grp-color').style.display = m === 'color' ? '' : 'none';
        $('at-em-grp-hue').style.display = m === 'hue' ? '' : 'none';
        $('at-em-grp-brightness').style.display = m === 'brightness' ? '' : 'none';
        $('at-em-grp-paint').style.display = m === 'paint' ? '' : 'none';
        $('at-em-grp-softness').style.display = m === 'paint' ? 'none' : '';
        $('at-em-source-canvas').style.cursor = m === 'paint' ? 'crosshair' : (m === 'brightness' ? 'default' : 'crosshair');
        emissivePreview();
    }

    function emSetSourceType() {
        $('at-em-grp-tint').style.display = $('at-em-source-type').value === 'tint' ? '' : 'none';
        emissivePreview();
    }

    /* Eyedrop the source preview to set the colour / hue target. */
    function emSampleSource(ev) {
        const mode = $('at-em-mode').value;
        if (mode !== 'color' && mode !== 'hue') return;
        const cv = $('at-em-source-canvas');
        const r = cv.getBoundingClientRect();
        const x = Math.max(0, Math.min(cv.width - 1, Math.floor((ev.clientX - r.left) / r.width * cv.width)));
        const y = Math.max(0, Math.min(cv.height - 1, Math.floor((ev.clientY - r.top) / r.height * cv.height)));
        const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
        if (mode === 'color') {
            $('at-em-target').value = emRgb01ToHex([d[0] / 255, d[1] / 255, d[2] / 255]);
        } else {
            const hue = Math.round(emRgbHue(d[0], d[1], d[2]) * 360);
            $('at-em-hue').value = hue;
            $('at-em-hue-val').textContent = hue;
        }
        emissivePreview();
    }

    function openEmissiveModal(id) {
        emissive.id = id;
        emissive.brushErase = false;
        $('at-em-tileno').textContent = indexOf(id) + 1;
        const mc = emissive.maskCanvas.getContext('2d');
        mc.fillStyle = '#000'; mc.fillRect(0, 0, emissive.maskCanvas.width, emissive.maskCanvas.height);
        const bm = $('at-em-brush-mode');
        bm.textContent = '🖌️ Paint'; bm.setAttribute('aria-pressed', 'false');
        emSetSourceType();
        emSetMode();
        openModal('emissive');
        emissivePreview();
    }

    function setupEmissiveModal() {
        emissive.maskCanvas = document.createElement('canvas');
        emissive.maskCanvas.width = 256; emissive.maskCanvas.height = 256;

        $('at-em-mode').addEventListener('change', emSetMode);
        $('at-em-source-type').addEventListener('change', emSetSourceType);
        $('at-em-tint').addEventListener('input', emissivePreview);
        $('at-em-target').addEventListener('input', emissivePreview);
        const sliders = [
            ['at-em-tolerance', 'at-em-tolerance-val'], ['at-em-hue', 'at-em-hue-val'],
            ['at-em-huewidth', 'at-em-huewidth-val'], ['at-em-satmin', 'at-em-satmin-val'],
            ['at-em-valmin', 'at-em-valmin-val'], ['at-em-threshold', 'at-em-threshold-val'],
            ['at-em-softness', 'at-em-softness-val'], ['at-em-strength', 'at-em-strength-val'],
            ['at-em-feather', 'at-em-feather-val']
        ];
        sliders.forEach(([s, v]) => $(s).addEventListener('input', function () {
            $(v).textContent = this.value; emissivePreview();
        }));
        $('at-em-brush').addEventListener('input', function () { $('at-em-brush-val').textContent = this.value; });
        $('at-em-brush-mode').addEventListener('click', function () {
            emissive.brushErase = !emissive.brushErase;
            this.textContent = emissive.brushErase ? '🧽 Erase' : '🖌️ Paint';
            this.setAttribute('aria-pressed', String(emissive.brushErase));
        });
        $('at-em-clear').addEventListener('click', () => {
            const mc = emissive.maskCanvas.getContext('2d');
            mc.fillStyle = '#000'; mc.fillRect(0, 0, emissive.maskCanvas.width, emissive.maskCanvas.height);
            emissivePreview();
        });
        $('at-em-source-canvas').addEventListener('pointerdown', emSampleSource);
        attachMaskBrush($('at-em-source-canvas'), emissive.maskCanvas, {
            active: () => emissive.id !== null && $('at-em-mode').value === 'paint' && $('at-modal-emissive').style.display !== 'none',
            brushSize: () => parseInt($('at-em-brush').value),
            erase: () => emissive.brushErase,
            onPaint: emissivePreview
        });
        $('at-em-remove').addEventListener('click', () => {
            if (emissive.id === null) return;
            const el = byId(emissive.id);
            el.emissive = null;
            closeModal();
            renderGrid();
            pushHistory('Remove emissive');
            showToast('Emissive glow removed', 'success');
        });
        $('at-em-apply').addEventListener('click', () => {
            if (emissive.id === null) return;
            const el = byId(emissive.id);
            el.emissive = emissiveCompute(cloneCanvas(el.canvas));
            // Auto-enable the Emissive export map so the glow actually ships.
            const cb = document.querySelector('#at-map-checks input[data-map="emissive"]');
            if (cb && !cb.checked) cb.checked = true;
            closeModal();
            renderGrid();
            pushHistory('Emissive map');
            showToast('Emissive map applied (Emissive export map enabled)', 'success');
        });
    }

    /* ============ ANCHORED TRANSITION MODAL ============
       The border between base (A) and overlay (B) is a chain of draggable
       anchors. Seeded from a preset (the "minimum" anchors), the user bends it,
       clicks to add anchors, or right-clicks to remove them. It produces a
       custom mask and adds a standard custom-mask transition tile — reusing all
       the existing transition plumbing (composite, save/load, undo). */
    const ANCHOR_SEEDS = {
        top:      { axis: 'h', swap: false, anchors: () => [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] },
        bottom:   { axis: 'h', swap: true,  anchors: () => [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] },
        left:     { axis: 'v', swap: false, anchors: () => [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }] },
        right:    { axis: 'v', swap: true,  anchors: () => [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }] },
        diagDown: { axis: 'h', swap: false, anchors: () => [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }] },
        diagUp:   { axis: 'h', swap: false, anchors: () => [{ x: 0, y: 0.9 }, { x: 1, y: 0.1 }] }
    };
    const ANCHOR_R = 7;   // handle radius in canvas px
    const anchorTr = { baseId: null, overlayId: null, anchors: [], axis: 'h', swap: false, dragIdx: -1,
                       overlayGeom: { rot: 0, flipH: false, flipV: false } };

    function anchorCleanup() { anchorTr.baseId = null; anchorTr.overlayId = null; anchorTr.dragIdx = -1; anchorTr.curve = null; }

    const clamp01 = v => Math.max(0, Math.min(1, v));

    /* ---- Shared anchor-boundary helpers (straight + curved) ----
       An anchor may carry `curve:true` + a `control{x,y}` point; the segments
       meeting at it then bow toward the control (quadratic on one curved end,
       cubic when both ends are curved), giving smooth organic borders. Used by
       both the Anchored Transition and Transition Grid tools. */
    /* Cycle an anchor through smoothness levels (scroll wheel / middle-click / dbl-click):
       0 = corner (sharp), 1 = smooth, 2 = rounder. The boundary is a Catmull-Rom
       spline through the anchors (see traceCurve), so smooth anchors are passed
       through with matched tangents — organic bows, never the old cusps. */
    const CURVE_TYPES = 3;
    function applyCurveType(a, axis, type) {
        a.curveType = ((type % CURVE_TYPES) + CURVE_TYPES) % CURVE_TYPES;
        a.curve = a.curveType > 0;
        a.control = null;   // tangents are derived from neighbours now, not a free handle
    }
    /* Catmull-Rom tangent strength for an anchor, by smoothness level. */
    function anchorTension(p) { const t = p.curveType || 0; return t === 0 ? 0 : (t === 1 ? 0.5 : 0.85); }
    /* Wheel handler factory shared by the Transition Grid + Anchored Transition.
       getState() returns the tool object ({anchors, axis, dragIdx,…}); hitFn
       maps canvas px → anchor index; render() repaints. */
    function makeCurveWheelHandler(getState, hitFn, posFn, render, hideId) {
        return ev => {
            const S = getState();
            if (!S || S.baseId === null || (hideId && $(hideId).checked)) return;
            const p = posFn(ev);
            const hit = hitFn(p.px, p.py);
            if (hit < 0) return;            // not over an anchor → let the page scroll
            ev.preventDefault();
            const a = S.anchors[hit];
            const dir = ev.deltaY > 0 ? 1 : -1;
            applyCurveType(a, S.axis, (a.curveType || 0) + dir);
            render();
        };
    }
    /* Reusable A→B boundary editor. Wires all the pointer interactions onto a canvas
       against a host state object ({ anchors[], axis, dragIdx }):
         left-drag = move anchor · left-click empty = add · right-click = remove
         middle-click / wheel = cycle smoothness (corner→smooth→rounder) · dbl-click = toggle.
       `getState()` returns the host state, `isActive()` gates editing (e.g. base chosen &&
       not in preview), `render()` repaints. Shared by the Anchored Transition + Height
       Transition tools (Transition Grid keeps its own handler — it mixes in stamps). */
    function attachBoundaryEditor(canvas, getState, isActive, render) {
        const pos = ev => {
            const r = canvas.getBoundingClientRect();
            const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
            return { x: clamp01(nx), y: clamp01(ny), px: nx * canvas.width, py: ny * canvas.height };
        };
        const hit = (px, py) => {
            const S = getState();
            for (let i = 0; i < S.anchors.length; i++) {
                const a = S.anchors[i];
                if (Math.hypot(a.x * canvas.width - px, a.y * canvas.height - py) <= ANCHOR_R + 4) return i;
            }
            return -1;
        };
        canvas.addEventListener('pointerdown', e => {
            if (!isActive()) return;
            e.preventDefault();
            const S = getState(), p = pos(e);
            if (e.button === 1) {                // middle → cycle smoothness
                const h = hit(p.px, p.py);
                if (h < 0) return;
                applyCurveType(S.anchors[h], S.axis, (S.anchors[h].curveType || 0) + 1);
                render(); return;
            }
            if (e.button !== 0) return;
            let h = hit(p.px, p.py);
            if (h < 0) { S.anchors.push({ x: p.x, y: p.y }); h = S.anchors.length - 1; }  // add + grab
            S.dragIdx = h;
            try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
            render();
        });
        canvas.addEventListener('pointermove', e => {
            const S = getState();
            if (S.dragIdx < 0) return;
            e.preventDefault();
            const p = pos(e), a = S.anchors[S.dragIdx];
            a.x = p.x; a.y = p.y;
            render();
        });
        const end = () => { const S = getState(); if (S.dragIdx >= 0) { S.dragIdx = -1; render(); } };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
        canvas.addEventListener('dblclick', e => {
            if (!isActive()) return;
            const S = getState(), p = pos(e), h = hit(p.px, p.py);
            if (h < 0) return;
            applyCurveType(S.anchors[h], S.axis, S.anchors[h].curve ? 0 : 1);
            render();
        });
        canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (!isActive()) return;
            const S = getState(), p = pos(e), h = hit(p.px, p.py);
            if (h >= 0 && S.anchors.length > 2) { S.anchors.splice(h, 1); S.dragIdx = -1; render(); }
        });
        canvas.addEventListener('wheel', e => {
            if (!isActive()) return;
            const p = pos(e), h = hit(p.px, p.py);
            if (h < 0) return;                  // not over an anchor → let the page scroll
            e.preventDefault();
            const S = getState(), a = S.anchors[h];
            applyCurveType(a, S.axis, (a.curveType || 0) + (e.deltaY > 0 ? 1 : -1));
            render();
        }, { passive: false });
        return { pos, hit };
    }
    const sortedAnchors = (anchors, axis) => [...anchors].sort((p, q) => axis === 'h' ? p.x - q.x : p.y - q.y);
    /* Trace the boundary through pts[1..] as a Catmull-Rom spline (expressed as cubic
       beziers). The tangent at each anchor is (next − prev) scaled by its smoothness,
       so the two segments meeting at an anchor SHARE that tangent → no cusps, smooth
       organic bows. A corner anchor (tension 0) has zero tangent, so it stays a sharp
       point and its neighbours run straight into it (preserving the default polyline).
       Controls are clamped along the sort axis so the boundary can't loop back. */
    function traceCurve(ctx, pts, axis, W, H) {
        const n = pts.length;
        const gx = i => pts[Math.max(0, Math.min(n - 1, i))].x * W;
        const gy = i => pts[Math.max(0, Math.min(n - 1, i))].y * H;
        const cl = (v, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
        for (let i = 0; i < n - 1; i++) {
            const x0 = gx(i), y0 = gy(i), x1 = gx(i + 1), y1 = gy(i + 1);
            const t0 = anchorTension(pts[i]), t1 = anchorTension(pts[i + 1]);
            let c1x = x0 + t0 * (gx(i + 1) - gx(i - 1)) / 6, c1y = y0 + t0 * (gy(i + 1) - gy(i - 1)) / 6;
            let c2x = x1 - t1 * (gx(i + 2) - gx(i)) / 6,     c2y = y1 - t1 * (gy(i + 2) - gy(i)) / 6;
            if (axis === 'h') { c1x = cl(c1x, x0, x1); c2x = cl(c2x, x0, x1); }
            else              { c1y = cl(c1y, y0, y1); c2y = cl(c2y, y0, y1); }
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
        }
    }
    /* Closed fill polygon: border (with curves) + tile edges on the overlay side. */
    function traceFillOutline(ctx, anchors, axis, swap, W, H) {
        const pts = sortedAnchors(anchors, axis), n = pts.length;
        ctx.beginPath();
        if (axis === 'h') {
            ctx.moveTo(0, pts[0].y * H); ctx.lineTo(pts[0].x * W, pts[0].y * H);
            traceCurve(ctx, pts, axis, W, H);
            ctx.lineTo(W, pts[n - 1].y * H);
            if (swap) { ctx.lineTo(W, H); ctx.lineTo(0, H); } else { ctx.lineTo(W, 0); ctx.lineTo(0, 0); }
        } else {
            ctx.moveTo(pts[0].x * W, 0); ctx.lineTo(pts[0].x * W, pts[0].y * H);
            traceCurve(ctx, pts, axis, W, H);
            ctx.lineTo(pts[n - 1].x * W, H);
            if (swap) { ctx.lineTo(W, H); ctx.lineTo(W, 0); } else { ctx.lineTo(0, H); ctx.lineTo(0, 0); }
        }
        ctx.closePath();
    }
    /* Draw the visible border line (dark underlay + light line) + curve handles. */
    function drawBoundaryHandles(ctx, anchors, axis, W, H, dragIdx) {
        const pts = sortedAnchors(anchors, axis);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.moveTo(pts[0].x * W, pts[0].y * H); traceCurve(ctx, pts, axis, W, H); ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.moveTo(pts[0].x * W, pts[0].y * H); traceCurve(ctx, pts, axis, W, H); ctx.stroke();
        // anchor handles (square = smooth/curved, circle = sharp corner)
        anchors.forEach((p, idx) => {
            const X = p.x * W, Y = p.y * H;
            ctx.beginPath();
            if (p.curve) ctx.rect(X - ANCHOR_R, Y - ANCHOR_R, ANCHOR_R * 2, ANCHOR_R * 2);
            else ctx.arc(X, Y, ANCHOR_R, 0, Math.PI * 2);
            ctx.fillStyle = idx === dragIdx ? '#e8852a' : '#fff'; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#1e1e1e'; ctx.stroke();
        });
    }

    /* Build the grayscale mask (white = overlay shows) from the anchor chain.
       Horizontal axis: border is y(x), fill above (or below if swapped).
       Vertical axis: border is x(y), fill left (or right if swapped). */
    function buildAnchorMask(P) {
        let c = document.createElement('canvas'); c.width = P; c.height = P;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, P, P);
        const a = anchorTr.anchors;
        if (a.length >= 2) {
            ctx.fillStyle = '#fff';
            traceFillOutline(ctx, a, anchorTr.axis, anchorTr.swap, P, P);
            ctx.fill();
        }
        const organic = parseInt($('at-anchor-organic').value) / 100;
        if (organic > 0) c = warpMaskOrganic(c, P, P, organic, anchorTr.organicSeed || 1);
        const hardness = parseInt($('at-anchor-hardness').value) / 100;
        const blurPx = (1 - hardness) * (P / 12);
        if (blurPx > 0.4) {
            const out = document.createElement('canvas'); out.width = P; out.height = P;
            const o = out.getContext('2d');
            o.filter = `blur(${blurPx}px)`;
            o.drawImage(c, 0, 0);
            return out;
        }
        return c;
    }

    function anchorRender() {
        if (anchorTr.baseId === null) return;
        const cv = $('at-anchor-canvas');
        const P = cv.width;
        const ctx = cv.getContext('2d');
        const base = resizeCanvas(byId(anchorTr.baseId).canvas, P, P);
        const overlay = resizeCanvas(geomTransform(byId(anchorTr.overlayId).canvas, anchorTr.overlayGeom), P, P);
        const method = $('at-anchor-method').value;
        const comp = composeTransitionDiffuse(base, overlay, buildAnchorMask(P), P, method, method === 'poisson' ? 180 : undefined);
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(comp, 0, 0);

        $('at-anchor-count').textContent = anchorTr.anchors.length;
        if ($('at-anchor-hide').checked) return;   // preview mode — texture only
        drawBoundaryHandles(ctx, anchorTr.anchors, anchorTr.axis, P, P, anchorTr.dragIdx);
    }

    function anchorSeed(name) {
        const s = ANCHOR_SEEDS[name] || ANCHOR_SEEDS.top;
        anchorTr.axis = s.axis; anchorTr.swap = s.swap;
        anchorTr.anchors = s.anchors();
        $('at-anchor-axis').value = s.axis;
        anchorRender();
    }

    function openAnchorModal(baseId, overlayId) {
        exitPickMode();
        anchorTr.baseId = baseId; anchorTr.overlayId = overlayId; anchorTr.dragIdx = -1; anchorTr.curve = null;
        anchorTr.overlayGeom = { rot: 0, flipH: false, flipV: false };
        anchorTr.organicSeed = 1;
        $('at-anchor-organic').value = 0; $('at-anchor-organic-val').textContent = '0';
        $('at-anchor-base-no').textContent = indexOf(baseId) + 1;
        $('at-anchor-overlay-no').textContent = indexOf(overlayId) + 1;
        $('at-anchor-hide').checked = false;
        anchorSeed($('at-anchor-preset').value);
        openModal('anchor');
        anchorRender();
    }

    function setupAnchorModal() {
        $('at-anchor-preset').addEventListener('change', function () { anchorSeed(this.value); });
        $('at-anchor-axis').addEventListener('change', function () {
            anchorTr.axis = this.value;
            anchorTr.anchors = this.value === 'h' ? [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] : [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
            anchorRender();
        });
        $('at-anchor-swap').addEventListener('click', () => { anchorTr.swap = !anchorTr.swap; anchorRender(); });
        $('at-anchor-reset').addEventListener('click', () => anchorSeed($('at-anchor-preset').value));
        $('at-anchor-method').addEventListener('change', anchorRender);
        $('at-anchor-hardness').addEventListener('input', function () { $('at-anchor-hardness-val').textContent = this.value; anchorRender(); });
        $('at-anchor-organic').addEventListener('input', function () { $('at-anchor-organic-val').textContent = this.value; anchorRender(); });
        $('at-anchor-organic-seed').addEventListener('click', () => { anchorTr.organicSeed = (Math.random() * 1e9) >>> 0; anchorRender(); });

        $('at-anchor-hide').addEventListener('change', anchorRender);
        $('at-anchor-ov-rot').addEventListener('click', () => { anchorTr.overlayGeom.rot = (anchorTr.overlayGeom.rot + 90) % 360; anchorRender(); });
        $('at-anchor-ov-fliph').addEventListener('click', () => { anchorTr.overlayGeom.flipH = !anchorTr.overlayGeom.flipH; anchorRender(); });
        $('at-anchor-ov-flipv').addEventListener('click', () => { anchorTr.overlayGeom.flipV = !anchorTr.overlayGeom.flipV; anchorRender(); });

        attachBoundaryEditor($('at-anchor-canvas'),
            () => anchorTr,
            () => anchorTr.baseId !== null && !$('at-anchor-hide').checked,
            anchorRender);

        $('at-anchor-add').addEventListener('click', () => {
            if (anchorTr.baseId === null) return;
            const S = state.tileSize;
            const method = $('at-anchor-method').value;
            const mask = buildAnchorMask(S);
            state.elements.push({
                id: state.nextId++, kind: 'transition', canvas: blankCanvas(S),
                original: null, seamless: false, material: null,
                base: anchorTr.baseId, overlay: anchorTr.overlayId,
                mode: 'custom', pivot: 0, hardness: 0, blendMethod: method,
                customMask: cloneCanvas(mask),
                overlayGeom: geomIsIdentity(anchorTr.overlayGeom) ? null : { ...anchorTr.overlayGeom }
            });
            closeModal();
            renderGrid();
            refreshTransitions();
            pushHistory('Anchored transition');
            showToast('Added anchored transition tile', 'success');
        });
    }

    /* ============ HEIGHT TRANSITION MODAL ============
       Drives the transition MASK from a height field rather than a drawn boundary:
       generate a height map from the chosen source, then the overlay shows where the
       height is below (crevices) or above (peaks) a level threshold. Output is a normal
       kind:'transition' element with a baked customMask, so PBR-map derivation, export,
       undo and the 3D preview all reuse the existing pipeline. */
    const heightTr = {
        baseId: null, overlayId: null, editId: null, overlayGeom: { rot: 0, flipH: false, flipV: false },
        hcache: null, hkey: null,  // cached height field + the (source·detail·contrast) key it was built for
        organicSeed: 1,
        curve: { anchors: [{ x: 0, y: 1 }, { x: 1, y: 0 }], axis: 'h', dragIdx: -1 },   // layer C: height→fill (identity)
        drift: { anchors: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], axis: 'h', dragIdx: -1 } // layer D: spatial field
    };

    function htCleanup() { heightTr.baseId = null; heightTr.overlayId = null; heightTr.editId = null; heightTr.hcache = null; heightTr.hkey = null; }

    /* Preset recipes: set the core knobs + a suggested overlay material. */
    const HEIGHT_TRANS_PRESETS = {
        sand_joints:  { label: '🏖️ Sand in the joints', source: 'base',    fill: 'low',  level: 55, hardness: 45, detail: 40, contrast: 55, organic: 25, material: { type: 'solid', key: 'sand' } },
        stones_grass: { label: '🌿 Stones over grass',    source: 'overlay', fill: 'high', level: 50, hardness: 55, detail: 35, contrast: 60, organic: 20, material: { type: 'solid', key: 'stone' } },
        snow_ledges:  { label: '❄️ Snow on the ledges',   source: 'base',    fill: 'high', level: 45, hardness: 40, detail: 45, contrast: 50, organic: 30, material: { type: 'solid', key: 'snow' } },
        water_cracks: { label: '💧 Water in the cracks',  source: 'base',    fill: 'low',  level: 38, hardness: 60, detail: 50, contrast: 60, organic: 15, material: { type: 'liquid', key: 'still_water' } },
        mud_stones:   { label: '🟤 Mud between stones',   source: 'base',    fill: 'low',  level: 55, hardness: 40, detail: 40, contrast: 50, organic: 35, material: { type: 'solid', key: 'mud' } },
        moss_gaps:    { label: '🍃 Moss in the gaps',     source: 'base',    fill: 'low',  level: 50, hardness: 35, detail: 45, contrast: 50, organic: 40, material: { type: 'solid', key: 'grass' } },
        dust:         { label: '🌫️ Dust settling',       source: 'base',    fill: 'low',  level: 65, hardness: 30, detail: 35, contrast: 45, organic: 30, material: { type: 'solid', key: 'dirt' } }
    };
    const HEIGHT_TRANS_ORDER = ['sand_joints', 'stones_grass', 'snow_ledges', 'water_cracks', 'mud_stones', 'moss_gaps', 'dust'];

    /* Push a preset's core knobs into the controls (curve/drift stay manual). */
    function htApplyPreset(key) {
        const pr = HEIGHT_TRANS_PRESETS[key];
        if (!pr) return;
        $('at-ht-source').value = pr.source; $('at-ht-fill').value = pr.fill;
        [['at-ht-level', pr.level], ['at-ht-hardness', pr.hardness], ['at-ht-detail', pr.detail],
         ['at-ht-contrast', pr.contrast], ['at-ht-organic', pr.organic]].forEach(([id, v]) => {
            $(id).value = v; $(id + '-val').textContent = v;
        });
        heightTr.hkey = null;   // detail/contrast changed → force a height regen
    }

    /* Refresh the "Assign … material" label/state for the selected preset. */
    function htUpdateAssign() {
        const pr = HEIGHT_TRANS_PRESETS[$('at-ht-preset').value];
        const mat = pr && getPreset(pr.material.type, pr.material.key, 'realistic');
        $('at-ht-assign-label').textContent = mat
            ? `Assign ${mat.label} material to the overlay (B)` : 'Assign suggested material to the overlay';
        $('at-ht-assign').disabled = !pr;
    }

    /* A manual tweak detaches from the named preset. */
    function htMarkCustom() { if ($('at-ht-preset').value !== 'custom') { $('at-ht-preset').value = 'custom'; htUpdateAssign(); } }

    /* Generate a height field (0..1 grayscale) from a diffuse canvas — the same
       desaturate → blur → simpleHeight path the engine uses for material maps, but
       with neutral params so it's independent of any assigned material. */
    function htGenHeightField(src, detailBlur, contrast) {
        const E = TRLE.Engine, S = src.width;
        const tex = E.createTextureFromImage(src);
        const gray = E.createFBO(S, S);
        E.blit('desaturate', { u_texture: tex, u_gamma: 0.8, u_alphaFlatten: 0.0 }, gray);
        const blurred = E.gaussianBlur(gray.texture, S, S, detailBlur);
        const hfbo = E.createFBO(S, S);
        E.blit('simpleHeight', { u_texture: blurred.texture, u_strength: contrast, u_bias: 0.0, u_invert: 0.0 }, hfbo);
        const canvas = E.fboToCanvas(hfbo);
        E.deleteFBO(gray); E.deleteFBO(blurred); E.deleteFBO(hfbo); E.deleteTexture(tex);
        return canvas;
    }

    /* Read the modal controls. detail→blur (high detail = sharp = less blur);
       contrast→height strength; hardness→smoothstep width (hard = narrow band). */
    function htParams() {
        const detail = parseInt($('at-ht-detail').value);
        const hardness = parseInt($('at-ht-hardness').value);
        return {
            source:   $('at-ht-source').value,           // 'base' | 'overlay'
            fill:     $('at-ht-fill').value,             // 'low' | 'high'
            level:    parseInt($('at-ht-level').value) / 100,
            width:    (1 - hardness / 100) * 0.4 + 0.02,
            blur:     (1 - detail / 100) * 9 + 0.5,
            contrast: parseInt($('at-ht-contrast').value) / 50,
            method:   $('at-ht-method').value,
            organic:  parseInt($('at-ht-organic').value) / 100,  // layer B: edge breakup
            curveOn:  $('at-ht-curve-on').checked,               // layer C: response curve
            driftMode: $('at-ht-drift-mode').value,              // layer D: off | bias | mult
            driftAmt:  parseInt($('at-ht-drift').value) / 100
        };
    }

    /* Layer C — sample the response spline into a 256-entry LUT (input height byte →
       fill 0..1) by filling above the curve and reading the boundary row per column. */
    function htCurveLUT() {
        const N = 256;
        const c = document.createElement('canvas'); c.width = N; c.height = N;
        const x = c.getContext('2d');
        x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
        x.fillStyle = '#fff';
        traceFillOutline(x, heightTr.curve.anchors, 'h', false, N, N); x.fill();
        const d = x.getImageData(0, 0, N, N).data, lut = new Float32Array(N);
        for (let col = 0; col < N; col++) {
            let row = N;
            for (let y = 0; y < N; y++) { if (d[(y * N + col) * 4] < 128) { row = y; break; } }
            lut[col] = clamp01(1 - row / (N - 1));     // higher up the curve = more fill
        }
        return lut;
    }

    /* Layer D — a smooth 0..1 spatial field from the drift boundary (fill one side,
       blur into a soft ramp). Returns the blurred canvas's pixel data (red channel). */
    function htSpatialField(S) {
        const c = document.createElement('canvas'); c.width = S; c.height = S;
        const x = c.getContext('2d');
        x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
        x.fillStyle = '#fff';
        traceFillOutline(x, heightTr.drift.anchors, heightTr.drift.axis, false, S, S); x.fill();
        const E = TRLE.Engine, tex = E.createTextureFromImage(c);
        const fbo = E.gaussianBlur(tex, S, S, S * 0.18);   // big blur → smooth tide-line ramp
        const blurred = E.fboToCanvas(fbo);
        E.deleteFBO(fbo); E.deleteTexture(tex);
        return blurred.getContext('2d').getImageData(0, 0, S, S).data;
    }

    /* Build the grayscale transition mask (white = overlay shows) at size S. */
    function htBuildMask(p, S) {
        // The height field is cached per (source·detail·contrast); only regenerate when those change.
        const srcId = p.source === 'overlay' ? heightTr.overlayId : heightTr.baseId;
        const srcCanvas = p.source === 'overlay'
            ? geomTransform(byId(heightTr.overlayId).canvas, heightTr.overlayGeom)
            : byId(heightTr.baseId).canvas;
        const key = `${srcId}|${p.source}|${p.blur.toFixed(2)}|${p.contrast.toFixed(2)}|${S}|${heightTr.overlayGeom.rot}${heightTr.overlayGeom.flipH}${heightTr.overlayGeom.flipV}`;
        if (heightTr.hkey !== key) {
            heightTr.hcache = htGenHeightField(resizeCanvas(srcCanvas, S, S), p.blur, p.contrast);
            heightTr.hkey = key;
        }
        const d = heightTr.hcache.getContext('2d').getImageData(0, 0, S, S).data;
        const out = document.createElement('canvas'); out.width = S; out.height = S;
        const octx = out.getContext('2d'); const img = octx.createImageData(S, S);
        const lut = p.curveOn ? htCurveLUT() : null;                       // layer C
        const field = p.driftMode !== 'off' ? htSpatialField(S) : null;   // layer D
        const span = Math.max(1e-4, 2 * p.width);
        for (let i = 0; i < d.length; i += 4) {
            const h = lut ? lut[d[i]] : d[i] / 255;
            let level = p.level;
            if (field && p.driftMode === 'bias') level = clamp01(p.level + (field[i] / 255 - 0.5) * p.driftAmt);
            let t = (h - (level - p.width)) / span;    // smoothstep across the band
            t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
            if (p.fill === 'low') t = 1 - t;           // overlay settles in the LOW ground
            if (field && p.driftMode === 'mult') t *= field[i] / 255;      // overlay only in the region
            const v = (t * 255) | 0;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        octx.putImageData(img, 0, 0);
        // Layer B: warp the mask edges with seeded noise so the fill line isn't a clean threshold.
        return p.organic > 0 ? warpMaskOrganic(out, S, S, p.organic, heightTr.organicSeed) : out;
    }

    function htRender() {
        if (heightTr.baseId === null) return;
        const cv = $('at-ht-canvas'), P = cv.width, ctx = cv.getContext('2d');
        const p = htParams();
        const mask = htBuildMask(p, P);
        if ($('at-ht-showmask').checked) { ctx.drawImage(mask, 0, 0); return; }
        const base = resizeCanvas(byId(heightTr.baseId).canvas, P, P);
        const overlay = resizeCanvas(geomTransform(byId(heightTr.overlayId).canvas, heightTr.overlayGeom), P, P);
        const comp = composeTransitionDiffuse(base, overlay, mask, P, p.method, p.method === 'poisson' ? 180 : undefined);
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(comp, 0, 0);
    }

    let htTimer = null;
    function htScheduleRender() { clearTimeout(htTimer); htTimer = setTimeout(htRender, 60); }

    /* Layer-C editor canvas: grid + identity reference + the response spline. */
    function htCurveRender() {
        const cv = $('at-ht-curve'), W = cv.width, H = cv.height, ctx = cv.getContext('2d');
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(W * i / 4, 0); ctx.lineTo(W * i / 4, H); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
        drawBoundaryHandles(ctx, heightTr.curve.anchors, 'h', W, H, heightTr.curve.dragIdx);
        htScheduleRender();
    }

    /* Layer-D editor canvas: the spatial region tinted + the drift boundary. */
    function htDriftRender() {
        const cv = $('at-ht-drift-canvas'), W = cv.width, ctx = cv.getContext('2d');
        ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, W, W);
        ctx.fillStyle = 'rgba(232,133,42,0.30)';
        traceFillOutline(ctx, heightTr.drift.anchors, heightTr.drift.axis, false, W, W); ctx.fill();
        drawBoundaryHandles(ctx, heightTr.drift.anchors, heightTr.drift.axis, W, W, heightTr.drift.dragIdx);
        htScheduleRender();
    }

    function openHeightModal(baseId, overlayId) {
        exitPickMode();
        heightTr.editId = null;
        heightTr.baseId = baseId; heightTr.overlayId = overlayId;
        heightTr.overlayGeom = { rot: 0, flipH: false, flipV: false };
        heightTr.hcache = null; heightTr.hkey = null; heightTr.organicSeed = 1;
        heightTr.curve = { anchors: [{ x: 0, y: 1 }, { x: 1, y: 0 }], axis: 'h', dragIdx: -1 };
        heightTr.drift = { anchors: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], axis: 'h', dragIdx: -1 };
        $('at-ht-base-no').textContent = indexOf(baseId) + 1;
        $('at-ht-overlay-no').textContent = indexOf(overlayId) + 1;
        $('at-ht-showmask').checked = false;
        $('at-ht-curve-on').checked = false;
        $('at-ht-drift-mode').value = 'off'; $('at-ht-drift-axis').value = 'h';
        $('at-ht-assign').checked = true;
        $('at-ht-preset').value = 'sand_joints';   // headline use case as the starting point
        htApplyPreset('sand_joints'); htUpdateAssign();
        $('at-ht-add').textContent = '➕ Add Transition Tile';
        openModal('heighttrans');
        htCurveRender(); htDriftRender(); htRender();
    }

    /* Reopen a previously-added height transition from its stored recipe (Phase 5). */
    function editHeightModal(el) {
        exitPickMode();
        heightTr.editId = el.id;
        heightTr.baseId = el.base; heightTr.overlayId = el.overlay;
        heightTr.hcache = null; heightTr.hkey = null;
        $('at-ht-base-no').textContent = indexOf(el.base) + 1;
        $('at-ht-overlay-no').textContent = indexOf(el.overlay) + 1;
        $('at-ht-showmask').checked = false;
        htLoadParams(el.htParams);
        $('at-ht-add').textContent = '💾 Save Changes';
        openModal('heighttrans');
        htUpdateAssign(); htCurveRender(); htDriftRender(); htRender();
    }

    /* Gather every control + layer state into a serializable recipe. */
    function htCollectParams() {
        return {
            preset: $('at-ht-preset').value,
            source: $('at-ht-source').value, fill: $('at-ht-fill').value,
            level: +$('at-ht-level').value, hardness: +$('at-ht-hardness').value,
            detail: +$('at-ht-detail').value, contrast: +$('at-ht-contrast').value,
            method: $('at-ht-method').value,
            organic: +$('at-ht-organic').value, organicSeed: heightTr.organicSeed,
            curveOn: $('at-ht-curve-on').checked,
            curve: JSON.parse(JSON.stringify(heightTr.curve.anchors)),
            driftMode: $('at-ht-drift-mode').value, driftAmt: +$('at-ht-drift').value, driftAxis: heightTr.drift.axis,
            drift: JSON.parse(JSON.stringify(heightTr.drift.anchors)),
            overlayGeom: { ...heightTr.overlayGeom },
            assign: $('at-ht-assign').checked
        };
    }

    /* Restore the controls + layer state from a stored recipe. */
    function htLoadParams(hp) {
        const set = (id, v) => { $(id).value = v; const l = $(id + '-val'); if (l) l.textContent = v; };
        $('at-ht-preset').value = hp.preset || 'custom';
        $('at-ht-source').value = hp.source; $('at-ht-fill').value = hp.fill;
        set('at-ht-level', hp.level); set('at-ht-hardness', hp.hardness);
        set('at-ht-detail', hp.detail); set('at-ht-contrast', hp.contrast);
        set('at-ht-organic', hp.organic);
        $('at-ht-method').value = hp.method;
        heightTr.organicSeed = hp.organicSeed || 1;
        $('at-ht-curve-on').checked = !!hp.curveOn;
        heightTr.curve = { anchors: JSON.parse(JSON.stringify(hp.curve || [{ x: 0, y: 1 }, { x: 1, y: 0 }])), axis: 'h', dragIdx: -1 };
        $('at-ht-drift-mode').value = hp.driftMode || 'off';
        set('at-ht-drift', hp.driftAmt != null ? hp.driftAmt : 60);
        $('at-ht-drift-axis').value = hp.driftAxis || 'h';
        heightTr.drift = { anchors: JSON.parse(JSON.stringify(hp.drift || [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])), axis: hp.driftAxis || 'h', dragIdx: -1 };
        heightTr.overlayGeom = hp.overlayGeom ? { ...hp.overlayGeom } : { rot: 0, flipH: false, flipV: false };
        $('at-ht-assign').checked = hp.assign !== false;
    }

    function setupHeightModal() {
        // Populate the preset dropdown (Custom is already the first option).
        const presetSel = $('at-ht-preset');
        HEIGHT_TRANS_ORDER.forEach(k => {
            const o = document.createElement('option'); o.value = k; o.textContent = HEIGHT_TRANS_PRESETS[k].label; presetSel.appendChild(o);
        });
        presetSel.addEventListener('change', function () { htApplyPreset(this.value); htUpdateAssign(); htRender(); });

        // Core knobs mark the recipe "custom"; organic/curve/drift are separate layers.
        [['at-ht-level', 'at-ht-level-val'], ['at-ht-hardness', 'at-ht-hardness-val'],
         ['at-ht-detail', 'at-ht-detail-val'], ['at-ht-contrast', 'at-ht-contrast-val']
        ].forEach(([rid, lid]) => {
            $(rid).addEventListener('input', function () { $(lid).textContent = this.value; htMarkCustom(); htScheduleRender(); });
        });
        $('at-ht-organic').addEventListener('input', function () { $('at-ht-organic-val').textContent = this.value; htScheduleRender(); });
        ['at-ht-source', 'at-ht-fill'].forEach(idd => $(idd).addEventListener('change', () => { htMarkCustom(); htRender(); }));
        $('at-ht-method').addEventListener('change', htRender);
        $('at-ht-showmask').addEventListener('change', htRender);
        $('at-ht-organic-seed').addEventListener('click', () => { heightTr.organicSeed = (Math.random() * 1e9) >>> 0; htRender(); });

        // Layer C — response curve editor
        attachBoundaryEditor($('at-ht-curve'), () => heightTr.curve, () => $('at-ht-curve-on').checked, htCurveRender);
        $('at-ht-curve-on').addEventListener('change', () => { htCurveRender(); htRender(); });
        $('at-ht-curve-reset').addEventListener('click', () => {
            heightTr.curve.anchors = [{ x: 0, y: 1 }, { x: 1, y: 0 }]; heightTr.curve.dragIdx = -1; htCurveRender();
        });
        // Layer D — spatial drift editor
        attachBoundaryEditor($('at-ht-drift-canvas'), () => heightTr.drift, () => $('at-ht-drift-mode').value !== 'off', htDriftRender);
        $('at-ht-drift-mode').addEventListener('change', () => { htDriftRender(); htRender(); });
        $('at-ht-drift').addEventListener('input', function () { $('at-ht-drift-val').textContent = this.value; htScheduleRender(); });
        $('at-ht-drift-axis').addEventListener('change', function () {
            heightTr.drift.axis = this.value;
            heightTr.drift.anchors = this.value === 'h' ? [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] : [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
            heightTr.drift.dragIdx = -1; htDriftRender();
        });
        $('at-ht-ov-rot').addEventListener('click', () => { heightTr.overlayGeom.rot = (heightTr.overlayGeom.rot + 90) % 360; htRender(); });
        $('at-ht-ov-fliph').addEventListener('click', () => { heightTr.overlayGeom.flipH = !heightTr.overlayGeom.flipH; htRender(); });
        $('at-ht-ov-flipv').addEventListener('click', () => { heightTr.overlayGeom.flipV = !heightTr.overlayGeom.flipV; htRender(); });

        $('at-ht-add').addEventListener('click', () => {
            if (heightTr.baseId === null) return;
            const S = state.tileSize, p = htParams();
            const mask = htBuildMask(p, S);
            // Assign the preset's suggested material to the overlay tile so its PBR maps
            // read correctly through the mask (sand's roughness in the joints, etc.).
            const pr = HEIGHT_TRANS_PRESETS[$('at-ht-preset').value];
            if ($('at-ht-assign').checked && pr) {
                const ov = byId(heightTr.overlayId);
                if (ov) ov.material = { type: pr.material.type, key: pr.material.key, aesthetic: 'realistic' };
            }
            const hp = htCollectParams();
            const geom = geomIsIdentity(heightTr.overlayGeom) ? null : { ...heightTr.overlayGeom };
            if (heightTr.editId != null) {                 // edit mode → update in place
                const el = byId(heightTr.editId);
                if (el) { el.customMask = cloneCanvas(mask); el.blendMethod = p.method; el.overlayGeom = geom; el.htParams = hp; }
                closeModal(); renderGrid(); refreshTransitions();
                pushHistory('Edit height transition'); showToast('Height transition updated', 'success');
                return;
            }
            state.elements.push({
                id: state.nextId++, kind: 'transition', canvas: blankCanvas(S),
                original: null, seamless: false, material: null,
                base: heightTr.baseId, overlay: heightTr.overlayId,
                mode: 'custom', pivot: 0, hardness: 0, blendMethod: p.method,
                customMask: cloneCanvas(mask), overlayGeom: geom, htParams: hp
            });
            closeModal();
            renderGrid();
            refreshTransitions();
            pushHistory('Height transition');
            showToast('Added height transition tile', 'success');
        });
    }

    /* ============ TRANSITION GRID MODAL ============
       Designs ONE continuous A→B border across a Cols×Rows wall, then slices it
       into per-cell custom-mask transition tiles that connect seamlessly. Anchors
       are global (normalised over the whole grid), so an anchor near a cell edge
       affects both neighbours automatically. */
    const tg = { baseId: null, overlayId: null, anchors: [], axis: 'h', swap: false, dragIdx: -1,
                 cols: 3, rows: 3, shapes: [], tool: 'boundary', stampIdx: -1 };

    function tgCleanup() { tg.baseId = null; tg.overlayId = null; tg.dragIdx = -1; tg.curve = null; tg.stampIdx = -1; }

    function tgSeed(name) {
        const s = ANCHOR_SEEDS[name] || ANCHOR_SEEDS.top;
        tg.axis = s.axis; tg.swap = s.swap; tg.anchors = s.anchors();
        $('at-tg-axis').value = s.axis;
    }

    /* Continuous boundary mask over a W×H rectangle (the whole grid). */
    function buildGridMask(W, H, anchors, axis, swap, hardness, blurUnit, shapes, noBoundary, organic) {
        let c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        if (!noBoundary && anchors.length >= 2) {
            ctx.fillStyle = '#fff';
            traceFillOutline(ctx, anchors, axis, swap, W, H);
            ctx.fill();
        }
        // Additive shapes layer — circles that add (white) or carve (black)
        // overlay independently of the boundary. Radius is normalised to the
        // shorter wall side so stamps stay round on non-square walls.
        if (shapes && shapes.length) {
            const rad = Math.min(W, H);
            for (const s of shapes) {
                ctx.fillStyle = s.mode === 'sub' ? '#000' : '#fff';
                ctx.beginPath(); ctx.arc(s.x * W, s.y * H, Math.max(1, s.r * rad), 0, Math.PI * 2); ctx.fill();
            }
        }
        // Organic edge — warp the whole mask before slicing so cells stay seamless.
        if (organic && organic.amount > 0) c = warpMaskOrganic(c, W, H, organic.amount, organic.seed || 1);
        const blurPx = (1 - hardness) * (blurUnit / 12);
        if (blurPx > 0.4) {
            const o = document.createElement('canvas'); o.width = W; o.height = H;
            const oc = o.getContext('2d');
            oc.filter = `blur(${blurPx}px)`;
            oc.drawImage(c, 0, 0);
            return o;
        }
        return c;
    }

    function tgRender() {
        if (tg.baseId === null) return;
        const cols = tg.cols, rows = tg.rows;
        const pc = Math.max(40, Math.floor(480 / Math.max(cols, rows)));
        const W = cols * pc, H = rows * pc;
        const cv = $('at-tg-canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        const method = $('at-tg-method').value;
        const hardness = parseInt($('at-tg-hardness').value) / 100;
        const base = resizeCanvas(byId(tg.baseId).canvas, pc, pc);
        const overlay = resizeCanvas(byId(tg.overlayId).canvas, pc, pc);
        const noBoundary = $('at-tg-noboundary').checked;
        const organic = { amount: parseInt($('at-tg-organic').value) / 100, seed: tg.organicSeed || 1 };
        const global = buildGridMask(W, H, tg.anchors, tg.axis, tg.swap, hardness, pc, tg.shapes, noBoundary, organic);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const cellMask = document.createElement('canvas'); cellMask.width = pc; cellMask.height = pc;
            cellMask.getContext('2d').drawImage(global, c * pc, r * pc, pc, pc, 0, 0, pc, pc);
            const comp = composeTransitionDiffuse(base, overlay, cellMask, pc, method, method === 'poisson' ? 120 : undefined);
            ctx.drawImage(comp, c * pc, r * pc);
        }
        // cell grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
        for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(c * pc + 0.5, 0); ctx.lineTo(c * pc + 0.5, H); ctx.stroke(); }
        for (let r = 1; r < rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * pc + 0.5); ctx.lineTo(W, r * pc + 0.5); ctx.stroke(); }
        $('at-tg-count').textContent = tg.anchors.length;
        $('at-tg-addcount').textContent = cols * rows;
        if ($('at-tg-hide').checked) return;
        if (!noBoundary) drawBoundaryHandles(ctx, tg.anchors, tg.axis, W, H, tg.dragIdx);
        // stamp outlines (add = orange, subtract = cyan)
        const rad = Math.min(W, H);
        tg.shapes.forEach(s => {
            ctx.lineWidth = 2;
            ctx.strokeStyle = s.mode === 'sub' ? 'rgba(80,200,255,0.95)' : 'rgba(232,133,42,0.95)';
            ctx.beginPath(); ctx.arc(s.x * W, s.y * H, Math.max(1, s.r * rad), 0, Math.PI * 2); ctx.stroke();
        });
    }

    function tgEventPos(ev) {
        const cv = $('at-tg-canvas'); const r = cv.getBoundingClientRect();
        const nx = (ev.clientX - r.left) / r.width, ny = (ev.clientY - r.top) / r.height;
        return { x: clamp01(nx), y: clamp01(ny), px: nx * cv.width, py: ny * cv.height };
    }
    function tgHit(px, py) {
        const cv = $('at-tg-canvas'), W = cv.width, H = cv.height;
        for (let i = 0; i < tg.anchors.length; i++) {
            const a = tg.anchors[i];
            if (Math.hypot(a.x * W - px, a.y * H - py) <= ANCHOR_R + 4) return i;
        }
        return -1;
    }
    /* Topmost stamp whose disc contains (px,py), else -1. */
    function tgStampHit(px, py) {
        const cv = $('at-tg-canvas'), W = cv.width, H = cv.height, rad = Math.min(W, H);
        for (let i = tg.shapes.length - 1; i >= 0; i--) {
            const s = tg.shapes[i];
            if (Math.hypot(s.x * W - px, s.y * H - py) <= s.r * rad + 4) return i;
        }
        return -1;
    }

    function openTransGridModal(baseId, overlayId) {
        exitPickMode();
        tg.baseId = baseId; tg.overlayId = overlayId; tg.dragIdx = -1; tg.curve = null;
        tg.shapes = []; tg.stampIdx = -1; tg.tool = 'boundary'; tg.organicSeed = 1;
        $('at-tg-organic').value = 0; $('at-tg-organic-val').textContent = '0';
        tg.cols = Math.max(1, Math.min(8, parseInt($('at-tg-cols').value) || 3));
        tg.rows = Math.max(1, Math.min(8, parseInt($('at-tg-rows').value) || 3));
        $('at-tg-base-no').textContent = indexOf(baseId) + 1;
        $('at-tg-overlay-no').textContent = indexOf(overlayId) + 1;
        $('at-tg-hide').checked = false;
        $('at-tg-noboundary').checked = false;
        const boundaryRadio = document.querySelector('input[name="at-tg-tool"][value="boundary"]');
        if (boundaryRadio) boundaryRadio.checked = true;
        tgSeed($('at-tg-preset').value);
        openModal('grid');
        tgRender();
    }

    function setupTransGridModal() {
        ['at-tg-cols', 'at-tg-rows'].forEach(id => $(id).addEventListener('input', function () {
            const v = Math.max(1, Math.min(8, parseInt(this.value) || 1));
            if (id === 'at-tg-cols') tg.cols = v; else tg.rows = v;
            tgRender();
        }));
        $('at-tg-preset').addEventListener('change', function () { tgSeed(this.value); tgRender(); });
        $('at-tg-axis').addEventListener('change', function () {
            tg.axis = this.value;
            tg.anchors = this.value === 'h' ? [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] : [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }];
            tgRender();
        });
        $('at-tg-swap').addEventListener('click', () => { tg.swap = !tg.swap; tgRender(); });
        $('at-tg-reset').addEventListener('click', () => { tgSeed($('at-tg-preset').value); tgRender(); });
        $('at-tg-method').addEventListener('change', tgRender);
        $('at-tg-hardness').addEventListener('input', function () { $('at-tg-hardness-val').textContent = this.value; tgRender(); });
        $('at-tg-organic').addEventListener('input', function () { $('at-tg-organic-val').textContent = this.value; tgRender(); });
        $('at-tg-organic-seed').addEventListener('click', () => { tg.organicSeed = (Math.random() * 1e9) >>> 0; tgRender(); });
        $('at-tg-hide').addEventListener('change', tgRender);

        // Stamp tool controls
        document.querySelectorAll('input[name="at-tg-tool"]').forEach(r =>
            r.addEventListener('change', function () { if (this.checked) tg.tool = this.value; tgRender(); }));
        $('at-tg-noboundary').addEventListener('change', tgRender);
        $('at-tg-clear-stamps').addEventListener('click', () => { tg.shapes = []; tgRender(); });

        const cv = $('at-tg-canvas');
        cv.addEventListener('pointerdown', e => {
            if (tg.baseId === null || $('at-tg-hide').checked) return;
            e.preventDefault();
            const p = tgEventPos(e);
            if (tg.tool !== 'boundary' && e.button === 0) {   // place a stamp
                tg.shapes.push({ x: p.x, y: p.y, r: 0.06, mode: tg.tool });
                tg.stampIdx = tg.shapes.length - 1;
                try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
                tgRender();
                return;
            }
            if (e.button === 1) {                // middle → cycle smoothness (corner→smooth→rounder)
                const hit = tgHit(p.px, p.py);
                if (hit < 0) return;
                applyCurveType(tg.anchors[hit], tg.axis, (tg.anchors[hit].curveType || 0) + 1);
                tgRender();
                return;
            }
            if (e.button !== 0) return;
            let hit = tgHit(p.px, p.py);
            if (hit < 0) { tg.anchors.push({ x: p.x, y: p.y }); hit = tg.anchors.length - 1; }
            tg.dragIdx = hit;
            try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
            tgRender();
        });
        cv.addEventListener('pointermove', e => {
            const p = tgEventPos(e);
            if (tg.stampIdx >= 0) {              // drag from centre to size the stamp
                const cvw = cv.width, cvh = cv.height, s = tg.shapes[tg.stampIdx];
                s.r = Math.max(0.02, Math.hypot(p.px - s.x * cvw, p.py - s.y * cvh) / Math.min(cvw, cvh));
                tgRender();
                return;
            }
            if (tg.dragIdx < 0) return;
            e.preventDefault();
            const a = tg.anchors[tg.dragIdx];
            a.x = p.x; a.y = p.y;
            tgRender();
        });
        const endDrag = () => {
            if (tg.stampIdx >= 0) { tg.stampIdx = -1; tgRender(); return; }
            if (tg.dragIdx >= 0) { tg.dragIdx = -1; tgRender(); }
        };
        cv.addEventListener('pointerup', endDrag);
        cv.addEventListener('pointercancel', endDrag);
        cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
        cv.addEventListener('dblclick', e => {
            if (tg.baseId === null || $('at-tg-hide').checked || tg.tool !== 'boundary') return;
            const p = tgEventPos(e);
            const hit = tgHit(p.px, p.py);
            if (hit < 0) return;
            const a = tg.anchors[hit];
            applyCurveType(a, tg.axis, a.curve ? 0 : 1);
            tgRender();
        });
        cv.addEventListener('contextmenu', e => {
            e.preventDefault();
            if ($('at-tg-hide').checked) return;
            const p = tgEventPos(e);
            if (tg.tool !== 'boundary') {        // remove a stamp
                const si = tgStampHit(p.px, p.py);
                if (si >= 0) { tg.shapes.splice(si, 1); tgRender(); }
                return;
            }
            const hit = tgHit(p.px, p.py);
            if (hit >= 0 && tg.anchors.length > 2) { tg.anchors.splice(hit, 1); tg.dragIdx = -1; tgRender(); }
        });
        cv.addEventListener('wheel', e => {
            if (tg.baseId === null || $('at-tg-hide').checked) return;
            const p = tgEventPos(e);
            if (tg.tool !== 'boundary') {        // resize the stamp under the cursor
                const si = tgStampHit(p.px, p.py);
                if (si < 0) return;
                e.preventDefault();
                tg.shapes[si].r = Math.max(0.02, Math.min(0.9, tg.shapes[si].r * (e.deltaY > 0 ? 0.9 : 1.111)));
                tgRender();
                return;
            }
            makeCurveWheelHandler(() => tg, tgHit, tgEventPos, tgRender, 'at-tg-hide')(e);
        }, { passive: false });

        $('at-tg-add').addEventListener('click', () => {
            if (tg.baseId === null) return;
            const S = state.tileSize, cols = tg.cols, rows = tg.rows;
            const method = $('at-tg-method').value;
            const hardness = parseInt($('at-tg-hardness').value) / 100;
            const noBoundary = $('at-tg-noboundary').checked;
            const organic = { amount: parseInt($('at-tg-organic').value) / 100, seed: tg.organicSeed || 1 };
            const baseId = tg.baseId, overlayId = tg.overlayId;
            // Build the cell tiles now (tg.* is cleared on close), then optionally
            // reflow the atlas to `cols` so the grid lines up before adding them.
            const global = buildGridMask(cols * S, rows * S, tg.anchors, tg.axis, tg.swap, hardness, S, tg.shapes, noBoundary, organic);
            const els = [];
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const cellMask = document.createElement('canvas'); cellMask.width = S; cellMask.height = S;
                cellMask.getContext('2d').drawImage(global, c * S, r * S, S, S, 0, 0, S, S);
                els.push({
                    id: 0, kind: 'transition', canvas: blankCanvas(S),
                    original: null, seamless: false, material: null,
                    base: baseId, overlay: overlayId,
                    mode: 'custom', pivot: 0, hardness: 0, blendMethod: method,
                    customMask: cellMask
                });
            }
            confirmResizeCols(cols, () => {
                for (const el of els) { el.id = state.nextId++; state.elements.push(el); }
                closeModal();
                renderGrid();
                refreshTransitions();
                pushHistory(`Transition grid ${cols}×${rows}`);
                showToast(`Added ${cols * rows} transition tiles (${cols}×${rows} grid)`, 'success');
            });
        });
    }

    /* ============ TILE TRANSFORMS (Phase 7) ============ */
    function rotateTile90(c) {
        const S = c.width;
        const t = document.createElement('canvas'); t.width = S; t.height = S;
        const x = t.getContext('2d');
        x.translate(S / 2, S / 2); x.rotate(Math.PI / 2); x.drawImage(c, -S / 2, -S / 2);
        return t;
    }
    function flipTile(c, horizontal) {
        const S = c.width;
        const t = document.createElement('canvas'); t.width = S; t.height = S;
        const x = t.getContext('2d');
        x.translate(horizontal ? S : 0, horizontal ? 0 : S);
        x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
        x.drawImage(c, 0, 0);
        return t;
    }
    function offsetTileHalf(c) {
        const S = c.width, h = S / 2;
        const t = document.createElement('canvas'); t.width = S; t.height = S;
        const x = t.getContext('2d');
        // Roll by half in both axes (wrap) — moves seams to the centre.
        for (let ox = -1; ox <= 0; ox++)
            for (let oy = -1; oy <= 0; oy++)
                x.drawImage(c, h + ox * S, h + oy * S);
        return t;
    }

    /* Apply a canvas→canvas transform to a tile, then refresh dependents + undo. */
    function applyTileTransform(id, fn, label) {
        const el = byId(id);
        if (!el || el.kind !== 'tile') return;
        const out = fn(el.canvas);
        const ctx = el.canvas.getContext('2d');
        ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
        ctx.drawImage(out, 0, 0);
        el.edited = true;
        refreshTransitions();
        renderGrid();
        pushHistory(label);
        showToast(label, 'success');
    }

    /* Replace a tile's source image (keeps its position, material + transitions). */
    function replaceTileImage(id) {
        const el = byId(id);
        if (!el || el.kind !== 'tile') return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.tga';
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            readImageFile(file).then(img => {
                const S = state.tileSize;
                const ctx = el.canvas.getContext('2d');
                ctx.clearRect(0, 0, S, S);
                ctx.drawImage(img, 0, 0, S, S);
                el.original = cloneCanvas(el.canvas);
                el.seamless = false;
                el.edited = false;
                refreshTransitions();
                renderGrid();
                pushHistory('Replace image');
                showToast('Tile image replaced', 'success');
            }).catch(err => showToast(err.message, 'error'));
        });
        input.click();
    }

    /* Generic slider-grid builder for the colour tools.
       params: [key, label, min, max, def, suffix]. Calls onInput on every move. */
    function buildSliderGrid(containerId, params, prefix, onInput) {
        const wrap = $(containerId);
        wrap.innerHTML = '';
        params.forEach(([key, label, min, max, def, suffix]) => {
            const g = document.createElement('div');
            g.className = 'form-group';
            g.innerHTML = `<label>${label} — <span id="at-${prefix}-${key}-val">${def}</span>${suffix || ''}</label>
                <input type="range" id="at-${prefix}-${key}" min="${min}" max="${max}" value="${def}" style="width:100%;">`;
            wrap.appendChild(g);
            const input = g.querySelector('input');
            input.addEventListener('input', () => {
                $(`at-${prefix}-${key}-val`).textContent = input.value;
                onInput();
            });
        });
    }
    /* Reset a slider grid to its defaults. */
    function resetSliderGrid(params, prefix) {
        params.forEach(([key, , , , def]) => {
            $(`at-${prefix}-${key}`).value = def;
            $(`at-${prefix}-${key}-val`).textContent = def;
        });
    }

    /* De-light core: divide by a heavy blur to flatten baked lighting. */
    function delightWhole(srcCanvas, S, strength) {
        const E = TRLE.Engine;
        const tex = E.createTextureFromImage(srcCanvas);
        const blurred = E.gaussianBlur(tex, S, S, Math.max(8, S / 8));
        const outFBO = E.createFBO(S, S);
        E.blit('delight', { u_texture: tex, u_blurred: blurred.texture, u_strength: strength }, outFBO);
        const out = E.fboToCanvas(outFBO);
        E.deleteFBO(blurred); E.deleteFBO(outFBO); E.deleteTexture(tex);
        return out;
    }

    /* ============ COLOUR ADJUST MODAL ============ */
    const CA_PARAMS = [
        ['hue',      'Hue',         -180, 180,   0, '°'],
        ['sat',      'Saturation',     0, 200, 100, '%'],
        ['bright',   'Brightness',  -100, 100,   0, '%'],
        ['contrast', 'Contrast',       0, 200, 100, '%'],
        ['gamma',    'Gamma',         20, 300, 100, '%'],
        ['temp',     'Temperature', -100, 100,   0, ''],
        ['tint',     'Tint',        -100, 100,   0, ''],
        ['vibrance', 'Vibrance',    -100, 100,   0, '']
    ];
    const ca = { id: null, tex: null };
    function caCleanup() {
        if (ca.tex) { TRLE.Engine.deleteTexture(ca.tex); ca.tex = null; }
        ca.id = null;
    }
    function caUniforms() {
        const v = k => parseInt($('at-ca-' + k).value);
        return {
            u_hue: v('hue'), u_sat: v('sat') / 100, u_bright: v('bright') / 100,
            u_contrast: v('contrast') / 100, u_gamma: v('gamma') / 100,
            u_temp: v('temp') / 100, u_tint: v('tint') / 100,
            u_vibrance: v('vibrance') / 100, u_invert: 0
        };
    }
    function caApplyTo(srcCanvas, S) {
        const E = TRLE.Engine;
        const tex = E.createTextureFromImage(srcCanvas);
        const fbo = E.createFBO(S, S);
        E.blit('colorAdjust', Object.assign({ u_texture: tex }, caUniforms()), fbo);
        const out = E.fboToCanvas(fbo);
        E.deleteFBO(fbo); E.deleteTexture(tex);
        return out;
    }
    function caRender() {
        if (ca.id === null) return;
        const E = TRLE.Engine, P = $('at-ca-preview').width;
        const fbo = E.createFBO(P, P);
        E.blit('colorAdjust', Object.assign({ u_texture: ca.tex }, caUniforms()), fbo);
        const out = E.fboToCanvas(fbo);
        $('at-ca-preview').getContext('2d').drawImage(out, 0, 0, P, P);
        E.deleteFBO(fbo);
    }
    function openColorAdjModal(id) {
        const el = byId(id);
        ca.id = id;
        ca.tex = TRLE.Engine.createTextureFromImage(el.canvas);
        $('at-ca-tileno').textContent = indexOf(id) + 1;
        resetSliderGrid(CA_PARAMS, 'ca');
        openModal('coloradj');
        caRender();
    }
    function setupColorAdjModal() {
        buildSliderGrid('at-ca-sliders', CA_PARAMS, 'ca', caRender);
        $('at-ca-reset').addEventListener('click', () => { resetSliderGrid(CA_PARAMS, 'ca'); caRender(); });
        $('at-ca-apply').addEventListener('click', () => {
            if (ca.id === null) return;
            const el = byId(ca.id);
            const out = caApplyTo(el.canvas, state.tileSize);
            el.canvas.getContext('2d').drawImage(out, 0, 0);
            el.edited = true;
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('Adjust colours');
            showToast('Colours adjusted', 'success');
        });
    }

    /* ============ RECOLOR FROM TEXTURE MODAL ============
       Reinhard mean/std colour transfer from a reference tile, with a
       strength + light grade on top. */
    const RC_PARAMS = [
        ['strength', 'Strength',     0, 100, 100, '%'],
        ['bright',   'Brightness', -100, 100,  0, '%'],
        ['contrast', 'Contrast',     0, 200, 100, '%'],
        ['sat',      'Saturation',   0, 200, 100, '%']
    ];
    const rc = { baseId: null, refId: null, stats: null };
    function rcCleanup() { rc.baseId = null; rc.refId = null; rc.stats = null; }
    /* Per-channel mean + std (0..1) of a canvas, sampled at a small size. */
    function computeColorStats(canvas, size) {
        const s = resizeCanvas(canvas, size, size);
        const d = s.getContext('2d').getImageData(0, 0, size, size).data;
        const n = size * size;
        const sum = [0, 0, 0], sumSq = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
            for (let c = 0; c < 3; c++) { const v = d[i + c] / 255; sum[c] += v; sumSq[c] += v * v; }
        }
        const mean = sum.map(x => x / n);
        const std = sumSq.map((sq, c) => Math.sqrt(Math.max(1e-6, sq / n - mean[c] * mean[c])));
        return { mean, std };
    }
    function rcTransferUniforms() {
        const A = rc.stats.A, B = rc.stats.B;
        const scale = [0, 1, 2].map(c => Math.max(0.2, Math.min(3, B.std[c] / A.std[c])));
        return {
            u_meanA: A.mean, u_meanB: B.mean, u_scale: scale,
            u_strength: parseInt($('at-rc-strength').value) / 100
        };
    }
    function rcGradeUniforms() {
        return {
            u_hue: 0, u_sat: parseInt($('at-rc-sat').value) / 100,
            u_bright: parseInt($('at-rc-bright').value) / 100,
            u_contrast: parseInt($('at-rc-contrast').value) / 100,
            u_gamma: 1, u_temp: 0, u_tint: 0, u_vibrance: 0, u_invert: 0
        };
    }
    /* Two-pass: colour transfer → light grade. Returns a canvas. */
    function rcApplyTo(srcCanvas, S) {
        const E = TRLE.Engine;
        const tex = E.createTextureFromImage(srcCanvas);
        const t1 = E.createFBO(S, S);
        E.blit('colorTransfer', Object.assign({ u_texture: tex }, rcTransferUniforms()), t1);
        const t2 = E.createFBO(S, S);
        E.blit('colorAdjust', Object.assign({ u_texture: t1.texture }, rcGradeUniforms()), t2);
        const out = E.fboToCanvas(t2);
        E.deleteFBO(t1); E.deleteFBO(t2); E.deleteTexture(tex);
        return out;
    }
    function rcRender() {
        if (rc.baseId === null) return;
        const P = $('at-rc-preview').width;
        const out = rcApplyTo(byId(rc.baseId).canvas, P);
        $('at-rc-preview').getContext('2d').drawImage(out, 0, 0, P, P);
    }
    function openRecolorModal(baseId, refId) {
        exitPickMode();
        rc.baseId = baseId; rc.refId = refId;
        rc.stats = { A: computeColorStats(byId(baseId).canvas, 64), B: computeColorStats(byId(refId).canvas, 64) };
        $('at-rc-base-no').textContent = indexOf(baseId) + 1;
        $('at-rc-ref-no').textContent = indexOf(refId) + 1;
        const rp = $('at-rc-ref');
        rp.getContext('2d').drawImage(byId(refId).canvas, 0, 0, rp.width, rp.height);
        resetSliderGrid(RC_PARAMS, 'rc');
        openModal('recolor');
        rcRender();
    }
    function setupRecolorModal() {
        buildSliderGrid('at-rc-sliders', RC_PARAMS, 'rc', rcRender);
        $('at-rc-apply').addEventListener('click', () => {
            if (rc.baseId === null) return;
            const el = byId(rc.baseId);
            const out = rcApplyTo(el.canvas, state.tileSize);
            el.canvas.getContext('2d').drawImage(out, 0, 0);
            el.edited = true;
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('Recolor');
            showToast('Recoloured from reference', 'success');
        });
    }

    /* ============ DE-LIGHT MODAL ============
       Whole-texture flatten (divide by blur) OR paint a baked shadow and
       inpaint it away (neighbour-aware fill, reusing healPatchFill). */
    const dl = { id: null, maskCanvas: null, brushErase: false, resultCanvas: null };
    function dlCleanup() { dl.id = null; dl.resultCanvas = null; }
    function dlMode() { return document.querySelector('input[name="at-dl-mode"]:checked').value; }
    function dlRender() {
        const el = byId(dl.id);
        if (!el) return;
        const disp = $('at-dl-canvas'), P = disp.width, ctx = disp.getContext('2d');
        if (dlMode() === 'whole') {
            const out = delightWhole(el.canvas, state.tileSize, parseInt($('at-dl-strength').value) / 100);
            ctx.clearRect(0, 0, P, P);
            ctx.drawImage(out, 0, 0, P, P);
            $('at-dl-canvas-label').textContent = 'Preview (de-lit)';
            return;
        }
        if (dl.resultCanvas) {
            ctx.drawImage(dl.resultCanvas, 0, 0, P, P);
            $('at-dl-canvas-label').textContent = 'Preview (shadow inpainted)';
            return;
        }
        // paint view: tile + red overlay where the mask is set
        ctx.clearRect(0, 0, P, P);
        ctx.drawImage(el.canvas, 0, 0, P, P);
        const md = dl.maskCanvas.getContext('2d').getImageData(0, 0, P, P).data;
        const od = ctx.getImageData(0, 0, P, P);
        for (let i = 0; i < od.data.length; i += 4) {
            const a = md[i] / 255 * 0.5;
            if (a > 0) {
                od.data[i]     = Math.round(od.data[i] * (1 - a) + 255 * a);
                od.data[i + 1] = Math.round(od.data[i + 1] * (1 - a));
                od.data[i + 2] = Math.round(od.data[i + 2] * (1 - a));
            }
        }
        ctx.putImageData(od, 0, 0);
        $('at-dl-canvas-label').textContent = 'Paint the shadow to remove (red = selected)';
    }
    function dlSyncModeUI() {
        const inpaint = dlMode() === 'inpaint';
        $('at-dl-whole-controls').style.display = inpaint ? 'none' : '';
        $('at-dl-inpaint-controls').style.display = inpaint ? '' : 'none';
        dl.resultCanvas = null;
        dlRender();
    }
    function openDelightModal(id) {
        dl.id = id;
        dl.resultCanvas = null;
        dl.brushErase = false;
        $('at-dl-tileno').textContent = indexOf(id) + 1;
        const mc = dl.maskCanvas.getContext('2d');
        mc.fillStyle = '#000'; mc.fillRect(0, 0, dl.maskCanvas.width, dl.maskCanvas.height);
        document.querySelector('input[name="at-dl-mode"][value="whole"]').checked = true;
        $('at-dl-strength').value = 85; $('at-dl-strength-val').textContent = '85';
        const bm = $('at-dl-brush-mode'); bm.textContent = '🖌️ Paint';
        openModal('delight');
        dlSyncModeUI();
    }
    function setupDelightModal() {
        dl.maskCanvas = document.createElement('canvas');
        dl.maskCanvas.width = 256; dl.maskCanvas.height = 256;
        document.querySelectorAll('input[name="at-dl-mode"]').forEach(r =>
            r.addEventListener('change', dlSyncModeUI));
        $('at-dl-strength').addEventListener('input', function () {
            $('at-dl-strength-val').textContent = this.value;
            if (dlMode() === 'whole') dlRender();
        });
        $('at-dl-brush').addEventListener('input', function () { $('at-dl-brush-val').textContent = this.value; });
        $('at-dl-brush-mode').addEventListener('click', function () {
            dl.brushErase = !dl.brushErase;
            this.textContent = dl.brushErase ? '🧽 Erase' : '🖌️ Paint';
        });
        $('at-dl-clear').addEventListener('click', () => {
            const mc = dl.maskCanvas.getContext('2d');
            mc.fillStyle = '#000'; mc.fillRect(0, 0, dl.maskCanvas.width, dl.maskCanvas.height);
            dl.resultCanvas = null; dlRender();
        });
        $('at-dl-preview-btn').addEventListener('click', () => {
            dl.resultCanvas = healPatchFill(byId(dl.id).canvas, dl.maskCanvas, state.tileSize);
            dlRender();
        });
        attachMaskBrush($('at-dl-canvas'), dl.maskCanvas, {
            active: () => dl.id !== null && dlMode() === 'inpaint' && $('at-modal-delight').style.display !== 'none',
            brushSize: () => parseInt($('at-dl-brush').value),
            erase: () => dl.brushErase,
            onPaint: () => { dl.resultCanvas = null; dlRender(); }
        });
        $('at-dl-apply').addEventListener('click', () => {
            if (dl.id === null) return;
            const el = byId(dl.id);
            let out;
            if (dlMode() === 'whole') {
                out = delightWhole(el.canvas, state.tileSize, parseInt($('at-dl-strength').value) / 100);
            } else {
                out = dl.resultCanvas || healPatchFill(el.canvas, dl.maskCanvas, state.tileSize);
            }
            el.canvas.getContext('2d').drawImage(out, 0, 0);
            el.edited = true;
            closeModal();
            refreshTransitions();
            renderGrid();
            pushHistory('De-light');
            showToast(dlMode() === 'whole' ? 'De-lit (baked lighting flattened)' : 'Shadow inpainted', 'success');
        });
    }

    /* ============ VARIATIONS MODAL (Phase 7) ============ */
    const varState = { id: null, variants: [] };

    function makeVariant(src, hueAmt, valAmt, allowRot) {
        const S = src.width;
        const t = document.createElement('canvas'); t.width = S; t.height = S;
        const x = t.getContext('2d');
        const hue = (Math.random() * 2 - 1) * hueAmt;
        const val = 1 + (Math.random() * 2 - 1) * (valAmt / 100);
        x.filter = `hue-rotate(${hue.toFixed(1)}deg) brightness(${val.toFixed(3)})`;
        if (allowRot && Math.random() < 0.6) {
            const r = 1 + Math.floor(Math.random() * 3);
            x.translate(S / 2, S / 2); x.rotate(r * Math.PI / 2); x.drawImage(src, -S / 2, -S / 2);
        } else {
            x.drawImage(src, 0, 0);
        }
        x.filter = 'none';
        return t;
    }

    function varRegen() {
        const el = byId(varState.id);
        if (!el) return;
        const count = parseInt($('at-var-count').value);
        const hueAmt = parseInt($('at-var-hue').value);
        const valAmt = parseInt($('at-var-val').value);
        const allowRot = $('at-var-rotate').checked;
        varState.variants = [];
        for (let i = 0; i < count; i++) {
            varState.variants.push(makeVariant(el.canvas, hueAmt, valAmt, allowRot));
        }
        const wrap = $('at-var-previews');
        wrap.innerHTML = '';
        varState.variants.forEach(v => {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            c.style.cssText = 'border:1px solid var(--border);border-radius:4px;image-rendering:pixelated;';
            c.getContext('2d').drawImage(v, 0, 0, 64, 64);
            wrap.appendChild(c);
        });
    }

    function openVarModal(id) {
        varState.id = id;
        $('at-var-tileno').textContent = indexOf(id) + 1;
        openModal('var');
        varRegen();
    }

    /* ============ ORIGAMI FRAME MODAL ============
       Folds a source tile into a concentric frame (square / diamond / circle
       rings) with a live preview, then appends the result as a new tile. */
    const origamiState = { id: null, canvas: null };
    function origamiOpts() {
        return {
            shape: $('at-origami-shape').value,
            axis: $('at-origami-axis').value,
            repeats: parseInt($('at-origami-repeats').value, 10)
        };
    }
    function origamiPreview() {
        const el = byId(origamiState.id);
        if (!el) return;
        const S = state.tileSize;
        origamiState.canvas = makeOrigamiFrame(el.canvas, S, origamiOpts());
        const cv = $('at-origami-preview');
        cv.width = S; cv.height = S;
        cv.getContext('2d').drawImage(origamiState.canvas, 0, 0);
    }
    function openOrigamiModal(id) {
        const el = byId(id);
        if (!el || el.kind !== 'tile') return;
        origamiState.id = id;
        $('at-origami-tileno').textContent = indexOf(id) + 1;
        openModal('origami');
        origamiPreview();
    }
    function setupOrigamiModal() {
        $('at-origami-shape').addEventListener('change', origamiPreview);
        $('at-origami-axis').addEventListener('change', origamiPreview);
        $('at-origami-repeats').addEventListener('input', function () {
            $('at-origami-repeats-val').textContent = this.value;
            origamiPreview();
        });
        $('at-origami-add').addEventListener('click', () => {
            const el = byId(origamiState.id);
            if (!el || !origamiState.canvas) return;
            const canvas = cloneCanvas(origamiState.canvas);
            const tile = {
                id: state.nextId++, kind: 'tile', canvas, original: cloneCanvas(canvas),
                seamless: false, edited: true, material: deepCopyMaterial(el.material)
            };
            state.elements.splice(indexOf(origamiState.id) + 1, 0, tile);
            state.selectedId = tile.id;
            closeModal();
            renderGrid();
            refreshTransitions();
            pushHistory('Origami frame');
            showToast('Added origami frame tile', 'success');
        });
    }

    function setupVarModal() {
        $('at-var-hue').addEventListener('input', function () { $('at-var-hue-val').textContent = this.value; varRegen(); });
        $('at-var-val').addEventListener('input', function () { $('at-var-val-val').textContent = this.value; varRegen(); });
        $('at-var-count').addEventListener('change', varRegen);
        $('at-var-rotate').addEventListener('change', varRegen);
        $('at-var-shuffle').addEventListener('click', varRegen);
        $('at-var-generate').addEventListener('click', () => {
            if (varState.id === null || !varState.variants.length) return;
            varState.variants.forEach(v => {
                state.elements.push({
                    id: state.nextId++,
                    kind: 'tile',
                    canvas: cloneCanvas(v),
                    original: cloneCanvas(v),
                    seamless: false,
                    edited: false,
                    material: null
                });
            });
            const n = varState.variants.length;
            closeModal();
            renderGrid();
            pushHistory(`Add ${n} variation${n > 1 ? 's' : ''}`);
            showToast(`Added ${n} variation${n > 1 ? 's' : ''}`, 'success');
        });
    }

    /* ============ BUILD PATTERN MODAL (texture-from-texture structure synthesis) ============
       Lays a source tile into a *built* surface — brick wall, tile floor, wood
       planks, metal pipes — by tiling it into CELLS separated by recessed JOINTS,
       each cell a jittered sample of the source so it doesn't read as repeats.
       CPU-canvas (same family as makeVariant); output is one fresh, seamlessly
       tiling tile that flows through the normal pipeline — the dark joints become
       real depth because generateMaps derives height/normal/AO from luminance. */
    const buildState = { id: null, canvas: null, seed: 1 };

    // Which material preset each pattern suggests (for the assign checkbox).
    const BP_PRESET = {
        brick: 'brick', tile: 'tile', planks: 'wood', pipes: 'metal',
        coursed: 'stone', herringbone: 'brick', cobble: 'stone', shingles: 'slate', floor: 'wood'
    };

    /* Small deterministic PRNG so a seed reproduces a pattern exactly. */
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /* HSL(0-360,0-100,0-100) → CSS rgb() string, for the mortar colour sliders. */
    function bpHslCss(h, s, l) {
        s /= 100; l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        const ch = n => Math.round(255 * f(n));
        return `rgb(${ch(0)},${ch(8)},${ch(4)})`;
    }

    /* Average colour of a canvas (1×1 downscale) → {h,s,l} for "sample from texture". */
    function bpAvgHsl(src) {
        const c = document.createElement('canvas'); c.width = c.height = 1;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0, 1, 1);
        const d = x.getImageData(0, 0, 1, 1).data;
        const r = d[0] / 255, g = d[1] / 255, b = d[2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        let h = 0, s = 0;
        if (mx !== mn) {
            const dd = mx - mn;
            s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
            if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
            else if (mx === g) h = (b - r) / dd + 2;
            else h = (r - g) / dd + 4;
            h *= 60;
        }
        return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    /* Lay noise over the mortar (only the joint gaps survive, since cells draw on top). */
    function bpMortarNoise(ctx, S, type, amt) {
        const off = document.createElement('canvas'); off.width = S; off.height = S;
        const octx = off.getContext('2d');
        if (type === 'clouds') {                       // low-freq blotches: random small → smooth upscale
            const ls = Math.max(2, Math.round(S / 16));
            const low = document.createElement('canvas'); low.width = low.height = ls;
            const lctx = low.getContext('2d'), id = lctx.createImageData(ls, ls);
            for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
            lctx.putImageData(id, 0, 0);
            octx.imageSmoothingEnabled = true; octx.drawImage(low, 0, 0, S, S);
        } else {                                       // per-pixel: speckle = hard salt/pepper, grain = soft
            const raw = document.createElement('canvas'); raw.width = S; raw.height = S;
            const rctx = raw.getContext('2d'), id = rctx.createImageData(S, S);
            for (let i = 0; i < id.data.length; i += 4) {
                const v = type === 'speckle' ? (Math.random() < 0.5 ? 0 : 255) : 128 + (Math.random() * 2 - 1) * 90;
                id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
            }
            rctx.putImageData(id, 0, 0);
            // Blur the hard per-pixel noise so it reads as soft mortar grain, not sharp static
            // (scaled by tile size so the look is consistent at 256 / 512 / 1024).
            octx.filter = `blur(${((type === 'speckle' ? 0.6 : 1) * S / 256).toFixed(2)}px)`;
            octx.drawImage(raw, 0, 0);
            octx.filter = 'none';
        }
        ctx.save();
        ctx.globalAlpha = amt / 100;
        ctx.globalCompositeOperation = type === 'speckle' ? 'overlay' : 'soft-light';
        ctx.drawImage(off, 0, 0);
        ctx.restore();
    }

    /* Fill the whole tile with the mortar colour (+ optional noise); this is what
       shows through the joint gaps once cells are drawn over it. */
    function bpMortarFill(ctx, S, p) {
        ctx.fillStyle = bpHslCss(p.mh, p.ms, p.ml);
        ctx.fillRect(0, 0, S, S);
        if (p.noiseAmt > 0 && p.noiseType !== 'none') bpMortarNoise(ctx, S, p.noiseType, p.noiseAmt);
    }

    /* Subtle top-light / bottom-dark bevel inside a cell — fakes rounded relief so
       the generated normal map reads each cell as raised. */
    function bpBevel(ctx, dx, dy, dw, dh) {
        const t = Math.max(1, Math.min(dw, dh) * 0.12);
        ctx.save();
        ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
        const g = ctx.createLinearGradient(0, dy, 0, dy + dh);
        g.addColorStop(0, 'rgba(255,255,255,0.12)');
        g.addColorStop(Math.min(0.49, t / dh), 'rgba(255,255,255,0)');
        g.addColorStop(Math.max(0.51, 1 - t / dh), 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.20)');
        ctx.fillStyle = g; ctx.fillRect(dx, dy, dw, dh);
        ctx.restore();
    }

    /* Draw the source into a dest rect, clipped to the cell. `s.overlay` makes the
       source flow continuously in world space (no slicing — bricks share one
       coherent texture); otherwise a fixed random crop (s.sx/s.sy) is used so seam-
       wrapped pieces stay pixel-identical. */
    function bpDrawSample(ctx, src, dx, dy, dw, dh, s) {
        const S = src.width;
        ctx.save();
        ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
        ctx.filter = `hue-rotate(${s.hue.toFixed(1)}deg) brightness(${s.val.toFixed(3)})`;
        if (s.fx < 0) { ctx.translate(dx + dw / 2, 0); ctx.scale(-1, 1); ctx.translate(-(dx + dw / 2), 0); }
        if (s.overlay) {                            // tile source over the rect, aligned to world origin
            const ox = Math.floor(dx / S) * S, oy = Math.floor(dy / S) * S;
            for (let ty = oy; ty < dy + dh; ty += S)
                for (let tx = ox; tx < dx + dw; tx += S) ctx.drawImage(src, tx, ty);
        } else if (dw <= S && dh <= S) {
            ctx.drawImage(src, s.sx, s.sy, dw, dh, dx, dy, dw, dh);
        } else {                                   // cell bigger than source → tile to cover
            for (let ty = dy; ty < dy + dh; ty += S)
                for (let tx = dx; tx < dx + dw; tx += S) ctx.drawImage(src, tx, ty);
        }
        ctx.restore();
        if (s.bevel) bpBevel(ctx, dx, dy, dw, dh);
    }

    /* A cell at logical (dx) which may straddle the left/right seam → draw the
       wrapped copy with the SAME sample so the tile stays seamless horizontally.
       Always pulls 6 rng values (hue, val, flip, sx, sy, tile-pick) so the sequence
       is stable regardless of fill mode or which cells are skipped. */
    function bpCell(ctx, src, dx, dy, dw, dh, S, p, rng) {
        const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng();
        if (dw <= 0 || dh <= 0) return;
        const overlay = p.fill === 'overlay';
        // Random-tiles: each cell pulls from a random tile in the atlas pool.
        if (p.fill === 'tiles' && p.pool && p.pool.length) src = p.pool[Math.floor(r6 * p.pool.length)];
        const maxsx = Math.max(0, src.width - Math.ceil(dw));
        const maxsy = Math.max(0, src.height - Math.ceil(dh));
        const s = {
            hue: (r1 * 2 - 1) * p.hue,
            val: 1 + (r2 * 2 - 1) * (p.val / 100),
            fx: (p.flip && !overlay && r3 < 0.5) ? -1 : 1,   // flip would break overlay continuity
            sx: Math.floor(r4 * maxsx),
            sy: Math.floor(r5 * maxsy),
            bevel: p.bevel,
            overlay
        };
        bpDrawSample(ctx, src, dx, dy, dw, dh, s);
        if (dx < 0) bpDrawSample(ctx, src, dx + S, dy, dw, dh, s);
        else if (dx + dw > S) bpDrawSample(ctx, src, dx - S, dy, dw, dh, s);
    }

    /* Brick / tile: rectangular cells with a per-row bond offset (0 = stack/tile,
       0.5 = running bond). Rows fill [0,S] exactly and (for offset) are forced even
       so the 2-row period tiles vertically; horizontal wrap is handled per cell. */
    function bpBrick(ctx, src, S, p, rng, square) {
        const cw = S / p.across;
        let rows;
        if (square) { rows = Math.max(1, Math.round(S / cw)); }
        else {
            rows = Math.max(1, Math.round(S / (cw / p.aspect)));
            if (p.offset > 0.01) rows += rows % 2;     // even → running bond tiles vertically
        }
        const ch = S / rows;
        const m = p.joint * Math.min(cw, ch);
        for (let r = 0; r < rows; r++) {
            const y = r * ch;
            const rowShift = (!square && r % 2) ? p.offset * cw : 0;
            for (let k = 0; k < p.across; k++) {
                const x = rowShift + k * cw;
                bpCell(ctx, src, x + m / 2, y + m / 2, cw - m, ch - m, S, p, rng);
            }
        }
    }

    /* Wood planks: full-height strips split by vertical grooves (seamless top↔bottom
       because planks run the whole height). Relief is a *width-wise* edge-darkening
       (uniform down the plank → stays vertically seamless, unlike the top/bottom
       bevel which would put a light row at y=0 and a dark row at y=S). Orientation
       handled by a final rotate. */
    function bpPlanks(ctx, src, S, p, rng) {
        const n = p.across, pw = S / n, m = p.joint * pw;
        for (let k = 0; k < n; k++) {
            const x = k * pw + m / 2, w = pw - m;
            bpCell(ctx, src, x, 0, w, S, S, p, rng);   // p.bevel is false for planks
            if (w > 0) {
                ctx.save();
                ctx.beginPath(); ctx.rect(x, 0, w, S); ctx.clip();
                const edge = 200;                        // rgb of the darkened plank edges
                const g = ctx.createLinearGradient(x, 0, x + w, 0);
                g.addColorStop(0, `rgb(${edge},${edge},${edge})`);
                g.addColorStop(0.12, '#ffffff');
                g.addColorStop(0.88, '#ffffff');
                g.addColorStop(1, `rgb(${edge},${edge},${edge})`);
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = g; ctx.fillRect(x, 0, w, S);
                ctx.restore();
            }
        }
    }

    /* Metal pipes: full-height cylinders. Each pipe gets a rounded diffuse shade
       (multiply: bright centre → dark edges) plus an off-centre specular streak
       (screen) so it reads as a curved metal rod; gaps between pipes are recessed. */
    function bpPipes(ctx, src, S, p, rng) {
        const n = p.across, pw = S / n, gap = p.joint * pw, hi = p.highlight;
        for (let k = 0; k < n; k++) {
            const x = k * pw + gap / 2, w = pw - gap;
            if (w <= 0) { bpCell(ctx, src, 0, 0, 0, 0, S, p, rng); continue; }
            bpCell(ctx, src, x, 0, w, S, S, p, rng);
            ctx.save();
            ctx.beginPath(); ctx.rect(x, 0, w, S); ctx.clip();
            // Rounded shadow: edges multiply down toward `edge`, centre stays white (unchanged).
            const edge = Math.round(255 * (1 - 0.7 * hi));
            const eCol = `rgb(${edge},${edge},${edge})`;
            const sh = ctx.createLinearGradient(x, 0, x + w, 0);
            sh.addColorStop(0, eCol); sh.addColorStop(0.5, '#ffffff'); sh.addColorStop(1, eCol);
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = sh; ctx.fillRect(x, 0, w, S);
            // Specular streak just left of centre.
            const sp = ctx.createLinearGradient(x, 0, x + w, 0);
            sp.addColorStop(0.30, 'rgba(0,0,0,0)');
            sp.addColorStop(0.42, `rgba(255,255,255,${(0.75 * hi).toFixed(3)})`);
            sp.addColorStop(0.54, 'rgba(0,0,0,0)');
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = sp; ctx.fillRect(x, 0, w, S);
            ctx.restore();
        }
    }

    /* Fully-toroidal cell draw: like bpCell but wraps on BOTH axes (patterns whose
       cells can straddle either seam — herringbone, coursed stone, plank floor).
       Pulls a stable 6-value rng sequence, then blits the sample at every ±S offset
       that intersects the tile so a cell crossing any edge reappears on the far side. */
    function bpCellTor(ctx, src, dx, dy, dw, dh, S, p, rng) {
        const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng();
        if (dw <= 0 || dh <= 0) return;
        const overlay = p.fill === 'overlay';
        if (p.fill === 'tiles' && p.pool && p.pool.length) src = p.pool[Math.floor(r6 * p.pool.length)];
        const maxsx = Math.max(0, src.width - Math.ceil(dw));
        const maxsy = Math.max(0, src.height - Math.ceil(dh));
        const s = {
            hue: (r1 * 2 - 1) * p.hue,
            val: 1 + (r2 * 2 - 1) * (p.val / 100),
            fx: (p.flip && !overlay && r3 < 0.5) ? -1 : 1,
            sx: Math.floor(r4 * maxsx),
            sy: Math.floor(r5 * maxsy),
            bevel: p.bevel,
            overlay
        };
        for (let oy = -S; oy <= S; oy += S)
            for (let ox = -S; ox <= S; ox += S) {
                if (dx + ox + dw <= 0 || dx + ox >= S || dy + oy + dh <= 0 || dy + oy >= S) continue;
                bpDrawSample(ctx, src, dx + ox, dy + oy, dw, dh, s);
            }
    }

    /* Straight (axis-aligned) herringbone. Cells are u-wide; bricks are 2u×u. The
       rule key=(i+j)%4 → 0:horizontal brick, 2:vertical brick is a perfect toroidal
       partition when the cell count is a multiple of 4, so the tile stays seamless
       (verified: it reproduces the classic ┃━━┃┃━━┃ weave). */
    function bpHerringbone(ctx, src, S, p, rng) {
        const k = Math.max(1, Math.round(p.across / 2));  // "bricks across" → 2k, cells = 4k
        const C = 4 * k, u = S / C, m = p.joint * u;
        for (let j = 0; j < C; j++)
            for (let i = 0; i < C; i++) {
                const key = ((i + j) % 4 + 4) % 4;
                if (key === 0)                              // horizontal brick (i,j)-(i+1,j)
                    bpCellTor(ctx, src, i * u + m / 2, j * u + m / 2, 2 * u - m, u - m, S, p, rng);
                else if (key === 2)                         // vertical brick (i,j)-(i,j+1)
                    bpCellTor(ctx, src, i * u + m / 2, j * u + m / 2, u - m, 2 * u - m, S, p, rng);
            }
    }

    /* Random coursed / ashlar stone: rows of jittered height (normalised to fill S
       exactly → the y=0/y=S seam is always a mortar joint) each split into stones of
       jittered width (normalised to sum S) with a random per-row shift so the vertical
       joints never line up. Horizontal wrap of the straddling stone via bpCellTor. */
    function bpCoursed(ctx, src, S, p, rng) {
        const avgw = S / p.across;
        const baseH = avgw / p.aspect;
        const rows = Math.max(1, Math.round(S / baseH));
        const hs = []; let htot = 0;
        for (let r = 0; r < rows; r++) { const h = baseH * (0.65 + rng() * 0.7); hs.push(h); htot += h; }
        for (let r = 0; r < rows; r++) hs[r] = hs[r] / htot * S;
        let y = 0;
        for (let r = 0; r < rows; r++) {
            const rh = hs[r];
            const widths = []; let wtot = 0;
            while (wtot < S * 0.999) { const w = avgw * (0.55 + rng() * 0.95); widths.push(w); wtot += w; }
            for (let i = 0; i < widths.length; i++) widths[i] = widths[i] / wtot * S;
            const mm = p.joint * Math.min(avgw, rh);
            let x = rng() * S;
            for (let i = 0; i < widths.length; i++) {
                const w = widths[i];
                bpCellTor(ctx, src, x + mm / 2, y + mm / 2, w - mm, rh - mm, S, p, rng);
                x += w;
            }
            y += rh;
        }
    }

    /* Staggered plank floor: full-width plank columns, each broken along its length
       into boards whose lengths are normalised to sum S (so the tile wraps) with a
       random rotation per column → staggered butt joints, like a real wood floor.
       (Built vertical; the orient='h' rotate in bpGenerate turns it horizontal.) */
    function bpFloor(ctx, src, S, p, rng) {
        const n = p.across, pw = S / n, m = p.joint * pw;
        const avgL = Math.max(0.15, p.boardlen) * S;
        for (let k = 0; k < n; k++) {
            const x = k * pw;
            const lens = []; let ltot = 0;
            while (ltot < S * 0.999) { const l = avgL * (0.6 + rng() * 0.8); lens.push(l); ltot += l; }
            for (let i = 0; i < lens.length; i++) lens[i] = lens[i] / ltot * S;
            let y = rng() * S;
            for (let i = 0; i < lens.length; i++) {
                const l = lens[i];
                bpCellTor(ctx, src, x + m / 2, y + m / 2, pw - m, l - m, S, p, rng);
                y += l;
            }
        }
    }

    /* Read a source canvas's pixels (via a scratch 2D canvas so WebGL-backed sources
       still work). Cached on the element between regens by the caller. */
    function bpCanvasData(cv) {
        const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height;
        const tx = t.getContext('2d'); tx.drawImage(cv, 0, 0);
        return { data: tx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    }

    /* "#rrggbb"/"rgb()" → [r,g,b]. Uses the mortar HSL helper's rgb() output. */
    function bpRgb(css) {
        const m = css.match(/(\d+),\s*(\d+),\s*(\d+)/);
        return m ? [+m[1], +m[2], +m[3]] : [40, 40, 40];
    }

    /* Cobblestone / flagstone: a jittered-grid (Worley) Voronoi tessellation. Each
       pixel finds its nearest of 9 neighbouring sites (toroidal → seamless), samples
       the source through that cell's random offset (so every stone looks different),
       shades it as a rounded mound (bright centre → dark edge = real relief) and drops
       to mortar in the F2−F1 boundary grooves. Rendered to an offscreen with groove
       transparency so the mortar fill (and its noise) shows through the joints. */
    function bpCobble(ctx, src, S, p, rng) {
        const G = Math.max(2, p.across), cw = S / G;
        const sites = [];
        for (let gy = 0; gy < G; gy++) { sites[gy] = []; for (let gx = 0; gx < G; gx++) {
            sites[gy][gx] = {
                jx: 0.5 + (rng() * 2 - 1) * 0.36, jy: 0.5 + (rng() * 2 - 1) * 0.36,
                val: 1 + (rng() * 2 - 1) * (p.val / 100),
                ox: Math.floor(rng() * S), oy: Math.floor(rng() * S)
            };
        } }
        const src2 = (p.fill === 'tiles' && p.pool && p.pool.length) ? p.pool[Math.floor(rng() * p.pool.length)] : src;
        const S2 = bpCanvasData(src2), sw = S2.w, sh = S2.h, sd = S2.data;
        const mort = bpRgb(bpHslCss(p.mh, p.ms, p.ml));
        const gap = Math.max(0.5, p.joint) * cw * 0.5;      // groove half-width
        const round = 0.35 + 0.9 * (p.irregular / 100);      // mound steepness
        const oc = document.createElement('canvas'); oc.width = oc.height = S;
        const out = oc.getContext('2d').createImageData(S, S), od = out.data;
        for (let y = 0; y < S; y++) {
            const gy0 = Math.floor(y / cw);
            for (let x = 0; x < S; x++) {
                const gx0 = Math.floor(x / cw);
                let f1 = 1e18, f2 = 1e18, best = null;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const st = sites[((gy0 + dy) % G + G) % G][((gx0 + dx) % G + G) % G];
                        const px = (gx0 + dx + st.jx) * cw, py = (gy0 + dy + st.jy) * cw;
                        const d = (x - px) * (x - px) + (y - py) * (y - py);
                        if (d < f1) { f2 = f1; f1 = d; best = st; } else if (d < f2) { f2 = d; }
                    }
                const d1 = Math.sqrt(f1), edge = Math.sqrt(f2) - d1;
                const rr = d1 / (cw * 0.72);
                const mound = Math.max(0, 1 - rr * rr * round);
                const shade = 0.5 + 0.5 * mound;
                const sx = ((x + best.ox) % sw + sw) % sw, sy = ((y + best.oy) % sh + sh) % sh;
                const si = (sy * sw + sx) * 4;
                let mF = edge < gap ? 1 - edge / gap : 0; mF = Math.min(1, mF * mF * 1.3);
                const o = (y * S + x) * 4, sc = shade * best.val;
                od[o]     = sd[si]     * sc * (1 - mF) + mort[0] * mF;
                od[o + 1] = sd[si + 1] * sc * (1 - mF) + mort[1] * mF;
                od[o + 2] = sd[si + 2] * sc * (1 - mF) + mort[2] * mF;
                od[o + 3] = Math.round(255 * (1 - mF * 0.85));   // grooves let mortar bg show
            }
        }
        oc.getContext('2d').putImageData(out, 0, 0);
        ctx.drawImage(oc, 0, 0);
    }

    /* Roof shingles / scales: brick-offset rows of round-bottomed tabs. Tabs sit
       strictly inside each row band (top shadow strip + bottom groove both fall on the
       mortar bg) so the y-seam is always bg-to-bg → seamless; horizontal wrap via the
       ±S tab copies. The 'Overlap' slider grows the top shadow so upper rows look like
       they cover the row below. */
    function bpShingles(ctx, src, S, p, rng) {
        const across = p.across, sw = S / across;
        let rows = Math.max(2, Math.round(S / (sw * 0.62)));
        rows += rows % 2;                                    // even → brick offset tiles vertically
        const rh = S / rows, sr = sw * 0.42;                 // corner radius
        const shadow = (0.18 + 0.4 * (p.overlap / 100)) * rh; // top shadow strip height
        const tw = sw * 0.88, tworder = p.fill === 'overlay';
        for (let r = 0; r < rows; r++) {
            const y = r * rh, rowShift = (r % 2) ? sw * 0.5 : 0;
            const ty = y + shadow, th = rh - shadow - 0.12 * rh;
            for (let k = -1; k <= across; k++) {
                // one sample per tab, reused for every seam-wrapped copy so they match
                const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
                if (th <= 0) continue;
                const s = {
                    hue: (r1 * 2 - 1) * p.hue, val: 1 + (r2 * 2 - 1) * (p.val / 100), fx: 1,
                    sx: Math.floor(r3 * Math.max(0, src.width - tw)),
                    sy: Math.floor(r4 * Math.max(0, src.height - th)), bevel: false, overlay: tworder
                };
                const cx = rowShift + k * sw;
                const rad = Math.min(sr, tw / 2, th * 0.7);
                for (let ox = -S; ox <= S; ox += S) {
                    const tx = cx + ox + 0.06 * sw;
                    if (tx + tw <= 0 || tx >= S) continue;
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(tx, ty);
                    ctx.lineTo(tx + tw, ty);
                    ctx.lineTo(tx + tw, ty + th - rad);
                    ctx.arcTo(tx + tw, ty + th, tx + tw - rad, ty + th, rad);
                    ctx.lineTo(tx + rad, ty + th);
                    ctx.arcTo(tx, ty + th, tx, ty + th - rad, rad);
                    ctx.closePath(); ctx.clip();
                    bpDrawSample(ctx, src, tx, ty, tw, th, s);
                    // top-inner shadow + bottom sheen so each scale reads as domed relief
                    const g = ctx.createLinearGradient(0, ty, 0, ty + th);
                    g.addColorStop(0, 'rgba(0,0,0,0.34)');
                    g.addColorStop(0.35, 'rgba(0,0,0,0)');
                    g.addColorStop(0.82, 'rgba(255,255,255,0)');
                    g.addColorStop(1, 'rgba(0,0,0,0.22)');
                    ctx.fillStyle = g; ctx.fillRect(tx, ty, tw, th);
                    ctx.restore();
                }
            }
        }
    }

    /* Read the modal controls into a params object. */
    function bpParams() {
        const pat = $('at-bp-pattern').value;
        return {
            pattern: pat,
            fill:      $('at-bp-fill').value,           // crop | overlay | tiles
            across:    parseInt($('at-bp-across').value),
            aspect:    parseInt($('at-bp-aspect').value) / 10,
            offset:    parseInt($('at-bp-offset').value) / 100,
            orient:    $('at-bp-orient').value,
            joint:     parseInt($('at-bp-joint').value) / 100,
            mh:        parseInt($('at-bp-mh').value),    // mortar hue / sat / lightness
            ms:        parseInt($('at-bp-ms').value),
            ml:        parseInt($('at-bp-ml').value),
            noiseAmt:  parseInt($('at-bp-noise').value),
            noiseType: $('at-bp-noisetype').value,
            hue:       parseInt($('at-bp-hue').value),
            val:       parseInt($('at-bp-val').value),
            highlight: parseInt($('at-bp-highlight').value) / 100,
            irregular: parseInt($('at-bp-irregular').value),      // cobble mound steepness
            overlap:   parseInt($('at-bp-overlap').value),        // shingle coverage
            boardlen:  parseInt($('at-bp-boardlen').value) / 100, // plank-floor board length
            flip:  true,
            bevel: !['pipes', 'cobble', 'shingles', 'planks'].includes(pat)  // these fake their own relief
        };
    }

    function bpGenerate() {
        const el = byId(buildState.id);
        if (!el) return;
        const src = el.canvas, S = src.width;
        if (!buildState.canvas) buildState.canvas = document.createElement('canvas');
        const out = buildState.canvas; out.width = S; out.height = S;
        const ctx = out.getContext('2d');
        const p = bpParams();
        // Random-tiles pool = every source tile in the atlas (so each brick can pull a
        // different texture); falls back to the source itself when there's only one.
        p.pool = state.elements.filter(e => e.kind === 'tile' && e.canvas).map(e => e.canvas);
        const rng = mulberry32(buildState.seed >>> 0);

        ctx.clearRect(0, 0, S, S);
        bpMortarFill(ctx, S, p);                  // mortar colour + noise shows through the joint gaps

        if      (p.pattern === 'brick')       bpBrick(ctx, src, S, p, rng, false);
        else if (p.pattern === 'tile')        bpBrick(ctx, src, S, p, rng, true);
        else if (p.pattern === 'coursed')     bpCoursed(ctx, src, S, p, rng);
        else if (p.pattern === 'herringbone') bpHerringbone(ctx, src, S, p, rng);
        else if (p.pattern === 'cobble')      bpCobble(ctx, src, S, p, rng);
        else if (p.pattern === 'shingles')    bpShingles(ctx, src, S, p, rng);
        else if (p.pattern === 'planks')      bpPlanks(ctx, src, S, p, rng);
        else if (p.pattern === 'floor')       bpFloor(ctx, src, S, p, rng);
        else if (p.pattern === 'pipes')       bpPipes(ctx, src, S, p, rng);

        // Vertically-built patterns are rotated for the horizontal option (stays seamless).
        if (['planks', 'pipes', 'floor', 'herringbone'].includes(p.pattern) && p.orient === 'h') {
            const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
            const tc = tmp.getContext('2d');
            tc.translate(S / 2, S / 2); tc.rotate(Math.PI / 2); tc.drawImage(out, -S / 2, -S / 2);
            ctx.clearRect(0, 0, S, S); ctx.drawImage(tmp, 0, 0);
        }

        const pv = $('at-bp-preview');
        pv.getContext('2d').clearRect(0, 0, pv.width, pv.height);
        pv.getContext('2d').drawImage(out, 0, 0, pv.width, pv.height);
    }

    let bpTimer = null;
    function bpScheduleRegen() { clearTimeout(bpTimer); bpTimer = setTimeout(bpGenerate, 80); }

    /* Show only the controls that apply to the chosen pattern + update labels. */
    function bpSyncControls() {
        const pat = $('at-bp-pattern').value;
        document.querySelectorAll('#at-modal-build [data-bp]').forEach(g => {
            g.style.display = g.getAttribute('data-bp').split(' ').includes(pat) ? '' : 'none';
        });
        $('at-bp-across-label').textContent =
            { brick: 'Bricks across', tile: 'Tiles across', planks: 'Planks', pipes: 'Pipes',
              coursed: 'Stones across', herringbone: 'Bricks across', cobble: 'Stones across',
              shingles: 'Shingles across', floor: 'Planks across' }[pat];
        const al = $('at-bp-aspect-label');
        if (al) al.textContent = pat === 'coursed' ? 'Course flatness' : 'Brick aspect';
        const preset = TRLE.SolidPresets[BP_PRESET[pat]];
        $('at-bp-assign-label').textContent = `Assign ${preset ? preset.label : BP_PRESET[pat]} material preset`;
    }

    function openBuildModal(id) {
        buildState.id = id;
        $('at-bp-tileno').textContent = indexOf(id) + 1;
        openModal('build');
        bpSyncControls();
        bpGenerate();
    }

    function setupBuildModal() {
        // Live-regen on every slider; mirror the value into its label span.
        [['at-bp-across', 'at-bp-across-val'], ['at-bp-aspect', 'at-bp-aspect-val', v => (v / 10).toFixed(1)],
         ['at-bp-offset', 'at-bp-offset-val'], ['at-bp-joint', 'at-bp-joint-val'],
         ['at-bp-mh', 'at-bp-mh-val'], ['at-bp-ms', 'at-bp-ms-val'], ['at-bp-ml', 'at-bp-ml-val'],
         ['at-bp-noise', 'at-bp-noise-val'], ['at-bp-hue', 'at-bp-hue-val'],
         ['at-bp-val', 'at-bp-val-val'], ['at-bp-highlight', 'at-bp-highlight-val'],
         ['at-bp-irregular', 'at-bp-irregular-val'], ['at-bp-overlap', 'at-bp-overlap-val'],
         ['at-bp-boardlen', 'at-bp-boardlen-val']
        ].forEach(([rid, lid, fmt]) => {
            $(rid).addEventListener('input', function () {
                $(lid).textContent = fmt ? fmt(this.value) : this.value;
                bpScheduleRegen();
            });
        });
        $('at-bp-pattern').addEventListener('change', () => { bpSyncControls(); bpGenerate(); });
        $('at-bp-fill').addEventListener('change', bpGenerate);
        $('at-bp-noisetype').addEventListener('change', bpGenerate);
        $('at-bp-orient').addEventListener('change', bpGenerate);
        // Seed the mortar HSL sliders from the source texture's average colour (darkened a touch).
        $('at-bp-sample').addEventListener('click', e => {
            e.preventDefault();
            const el = byId(buildState.id);
            if (!el) return;
            const c = bpAvgHsl(el.canvas);
            $('at-bp-mh').value = c.h; $('at-bp-mh-val').textContent = c.h;
            $('at-bp-ms').value = c.s; $('at-bp-ms-val').textContent = c.s;
            const l = Math.round(c.l * 0.7);            // mortar reads recessed → darker tint of the texture
            $('at-bp-ml').value = l; $('at-bp-ml-val').textContent = l;
            bpGenerate();
        });
        $('at-bp-seed').addEventListener('input', function () { buildState.seed = parseInt(this.value) || 0; bpScheduleRegen(); });
        $('at-bp-random').addEventListener('click', () => {
            buildState.seed = Math.floor(Math.random() * 1e9);
            $('at-bp-seed').value = buildState.seed;
            bpGenerate();
        });
        $('at-bp-add').addEventListener('click', () => {
            if (buildState.id === null || !buildState.canvas) return;
            const pat = $('at-bp-pattern').value;
            const gen = cloneCanvas(buildState.canvas);
            const assign = $('at-bp-assign').checked;
            state.elements.push({
                id: state.nextId++,
                kind: 'tile',
                canvas: gen,
                original: cloneCanvas(gen),
                seamless: true,           // tileable by construction → snapshot keeps its pixels
                edited: false,
                material: assign ? { type: 'solid', key: BP_PRESET[pat], aesthetic: 'realistic' } : null
            });
            closeModal();
            renderGrid();
            pushHistory(`Build ${pat} pattern`);
            showToast(`Added ${pat} pattern tile`, 'success');
        });
    }

    /* ============ MATERIAL MAP DERIVATION ============
       Plain tiles: GPU generateMaps with their preset.
       Transition tiles: parents' maps composited with the same
       topology mask — so parent material changes propagate. */
    function deriveMaps(el, enabledMaps, cache) {
        if (cache[el.id]) return cache[el.id];
        const S = state.tileSize;
        let result = {};

        if (el.kind === 'transition' && el.bset) {
            const b = el.bset;
            if (b.slotMode === 'tile' && byId(b.srcId)) {
                // Authored slot — its maps ARE the source tile's maps.
                result = deriveMaps(byId(b.srcId), enabledMaps, cache);
                cache[el.id] = result;
                return result;
            }
            const base    = deriveMaps(byId(el.base), enabledMaps, cache);
            const overlay = deriveMaps(byId(el.overlay), enabledMaps, cache);
            // The trim region is identical however the diffuse was derived
            // (rot/mirror land the trim in the same place), so the union mask
            // of the slot's own role/bits composites the material maps.
            const w = Math.max(2, Math.round(b.width * S));
            const f = Math.max(1, b.soft * w);
            const mask = bsetUnionMask(S, b.topo, b.topo === 'lines' ? b.bits : b.role, w, f);
            for (const mt of TRLE.MapOrder) {
                if (enabledMaps[mt] && base[mt] && overlay[mt]) {
                    result[mt] = compositeTransition(base[mt], overlay[mt], mask, S);
                }
            }
        } else if (el.kind === 'transition') {
            const base    = deriveMaps(byId(el.base), enabledMaps, cache);
            const overlay = deriveMaps(byId(el.overlay), enabledMaps, cache);
            const mask    = el.customMask
                ? softenMask(el.customMask, S)
                : el.wangBits != null
                    ? buildWangMask(S, el.wangBits, el.pivot, el.hardness)
                    : buildTopologyMask(S, el.mode, el.pivot, el.hardness);
            for (const mt of TRLE.MapOrder) {
                if (enabledMaps[mt] && base[mt] && overlay[mt]) {
                    let om = overlay[mt];
                    if (el.overlayGeom) {
                        om = geomTransform(om, el.overlayGeom);
                        if (mt === 'normal') normalFixGeom(om, el.overlayGeom);
                    }
                    result[mt] = compositeTransition(base[mt], om, mask, S);
                }
            }
        } else if (hasMatLayers(el)) {
            result = composeLayerMaps(el.canvas, el.matLayers, enabledMaps, S);
            if (enabledMaps.emissive && el.emissive) result.emissive = cloneCanvas(el.emissive);
        } else {
            const tex  = TRLE.Engine.createTextureFromImage(el.canvas);
            const preset = Object.assign({}, resolvePreset(el), { flipNormalY: state.flipNormalY, heightSeamless: heightSeamlessOn() });
            const maps = TRLE.Engine.generateMaps(tex, S, S, preset, enabledMaps);
            for (const mt of TRLE.MapOrder) {
                if (maps[mt]) {
                    result[mt] = TRLE.Engine.fboToCanvas(maps[mt]);
                    TRLE.Engine.deleteFBO(maps[mt]);
                }
            }
            TRLE.Engine.deleteTexture(tex);
            // Authored emissive overrides the preset-derived one (which is black
            // unless a preset opts in). Lets a tile glow without a glowing preset.
            if (enabledMaps.emissive && el.emissive) result.emissive = cloneCanvas(el.emissive);
        }
        cache[el.id] = result;
        return result;
    }

    /* ============ EXPORT ============ */
    /* Sanitised base file name from the export "Atlas name" field. Strips path
       separators and other awkward characters; falls back to "atlas" when empty. */
    function exportBaseName() {
        const raw = ($('at-export-name')?.value || '').trim();
        const safe = raw.replace(/[^a-zA-Z0-9 _.-]/g, '').replace(/\s+/g, '_').replace(/^\.+/, '');
        return safe || 'atlas';
    }

    /* ---- Export "conveyor belt" flavour animation --------------------------
       Purely cosmetic: while an export runs we play a little square-slicing
       conveyor on a canvas above the progress bar, plus a rotating quip. Never
       touches the pipeline — it's just there so the wait feels alive. */
    const EXPORT_QUIPS = [
        'Fighting gladiators in the Colosseum.',
        'Locking Winston in the freezer.',
        'Banishing demons in Ireland.',
        'Smashing windows in Venice.',
        'Using the Scion as a frisbee.',
        'Finding the Library of Alexandria.',
        'Reducing the monkey population of India.',
        'Polluting Antarctica with bullet casings.',
        'Giving a girl a break.'
    ];
    const EXPORT_PALETTE = ['#3ec46d', '#e8852a', '#3a9ff5', '#a45cff', '#f24b7d',
                            '#f7c948', '#2dd4bf', '#ff6b3d', '#8b5cf6', '#22c55e'];
    let _exportAnim = null;
    let _exportAnimToken = 0;

    function _hexToRgb(h) {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function _mix(a, b, t) {
        return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }
    function _shuffle(arr) {
        const p = arr.slice();
        for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
        return p;
    }
    function _roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function startExportAnim() {
        stopExportAnim();
        const stage = $('at-export-stage'), canvas = $('at-export-anim'), quipEl = $('at-export-quip');
        if (!stage || !canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const token = ++_exportAnimToken;
        stage.classList.add('active');

        const CYCLE = 2600;               // ms per square lifecycle
        const NEUTRAL = _hexToRgb('#37373c');
        let colors = _shuffle(EXPORT_PALETTE).slice(0, 4).map(_hexToRgb);
        let cycleStart = performance.now();
        const easeInOut = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

        function draw(t) {
            // Keep backing store matched to the responsive display size.
            const cw = Math.max(1, Math.round((canvas.clientWidth || 320) * dpr));
            const ch = Math.max(1, Math.round((canvas.clientHeight || 160) * dpr));
            if (canvas.width !== cw) canvas.width = cw;
            if (canvas.height !== ch) canvas.height = ch;
            const W = canvas.width, H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            const size = Math.min(H * 0.78, W * 0.42);
            const cy = H / 2, centerX = W / 2;
            const P = { enter: 0.22, slice: 0.42, color: 0.58 };

            let x, sliceP = 0, colorP = 0;
            if (t < P.enter) {                       // slide in from the left
                x = -size + (centerX + size) * easeInOut(t / P.enter);
            } else if (t < P.color) {                // sit centre: slice, then colour
                x = centerX;
                if (t < P.slice) sliceP = (t - P.enter) / (P.slice - P.enter);
                else { sliceP = 1; colorP = (t - P.slice) / (P.color - P.slice); }
            } else {                                 // ride off to the right
                sliceP = 1; colorP = 1;
                x = centerX + (W + size - centerX) * easeInOut((t - P.color) / (1 - P.color));
            }

            const gap = easeInOut(colorP) * size * 0.05;
            const q = (size - gap) / 2;
            const left = x - size / 2, top = cy - size / 2;
            const cells = [
                [left, top], [left + q + gap, top],
                [left, top + q + gap], [left + q + gap, top + q + gap]
            ];

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = size * 0.06;
            ctx.shadowOffsetY = size * 0.02;
            for (let i = 0; i < 4; i++) {
                const lp = clamp01(colorP * 1.55 - i * 0.16);   // staggered colour pop
                ctx.fillStyle = _mix(NEUTRAL, colors[i], lp);
                _roundRect(ctx, cells[i][0], cells[i][1], q, q, size * 0.06);
                ctx.fill();
                ctx.shadowColor = 'transparent';                // shadow only under first pass
            }
            ctx.restore();

            // Slicing stroke: a vertical then horizontal cut, fading as colours bloom.
            if (sliceP > 0 && colorP < 1) {
                ctx.save();
                ctx.globalAlpha = 1 - easeInOut(colorP);
                ctx.strokeStyle = '#ffd9a3';
                ctx.lineCap = 'round';
                ctx.lineWidth = size * 0.035;
                ctx.shadowColor = '#e8852a';
                ctx.shadowBlur = size * 0.12;
                const vP = clamp01(sliceP * 2), hP = clamp01(sliceP * 2 - 1);
                if (vP > 0) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + size * vP); ctx.stroke(); }
                if (hP > 0) { ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(left + size * hP, cy); ctx.stroke(); }
                ctx.restore();
            }
        }

        function frame(now) {
            if (_exportAnimToken !== token) return;
            let t = (now - cycleStart) / CYCLE;
            if (t >= 1) { cycleStart = now; colors = _shuffle(EXPORT_PALETTE).slice(0, 4).map(_hexToRgb); t = 0; }
            draw(t);
            _exportAnim.raf = requestAnimationFrame(frame);
        }

        // Rotating quip, ~3s each with a fade.
        let order = _shuffle(EXPORT_QUIPS), qi = 0;
        if (quipEl) {
            quipEl.textContent = order[0];
            requestAnimationFrame(() => quipEl.classList.add('show'));
            _exportAnim = _exportAnim || {};
            _exportAnim.quipTimer = setInterval(() => {
                quipEl.classList.remove('show');
                setTimeout(() => {
                    if (_exportAnimToken !== token) return;
                    qi = (qi + 1) % order.length;
                    quipEl.textContent = order[qi];
                    quipEl.classList.add('show');
                }, 400);
            }, 3200);
        }

        _exportAnim = _exportAnim || {};
        _exportAnim.raf = requestAnimationFrame(frame);
    }

    function stopExportAnim() {
        _exportAnimToken++;                 // invalidate any in-flight loop/timer
        if (_exportAnim) {
            cancelAnimationFrame(_exportAnim.raf);
            clearInterval(_exportAnim.quipTimer);
            _exportAnim = null;
        }
        const stage = $('at-export-stage'), quipEl = $('at-export-quip');
        if (stage) stage.classList.remove('active');
        if (quipEl) quipEl.classList.remove('show');
    }

    async function exportAtlas() {
        if (!state.elements.length) { showToast('Slice an atlas first!', 'error'); return; }

        const enabledMaps = {};
        document.querySelectorAll('#at-map-checks input[data-map]').forEach(cb => {
            enabledMaps[cb.dataset.map] = cb.checked;
        });

        const btn = $('at-export-btn');
        const progress = $('at-progress');
        const fill = $('at-progress-fill');
        setBusy(btn, true, 'Exporting…');
        progress.classList.add('active');
        fill.style.width = '0%';
        startExportAnim();

        try {
            const S = state.tileSize;
            const cols = state.cols;
            const rows = Math.ceil(state.elements.length / cols);
            const cache = {};

            // Per-element maps
            for (let i = 0; i < state.elements.length; i++) {
                deriveMaps(state.elements[i], enabledMaps, cache);
                fill.style.width = ((i + 1) / state.elements.length * 80) + '%';
                if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
            }

            // Assemble atlases
            const zip = new JSZip();
            const buildAtlas = (getTile) => {
                const atlas = document.createElement('canvas');
                atlas.width = cols * S;
                atlas.height = rows * S;
                const ctx = atlas.getContext('2d');
                state.elements.forEach((el, i) => {
                    const tile = getTile(el);
                    if (tile) ctx.drawImage(tile, (i % cols) * S, Math.floor(i / cols) * S);
                });
                return atlas;
            };

            // Optional TombEngine layout nests everything under Textures/.
            const prefix = $('at-export-layout').value === 'ten' ? 'Textures/' : '';
            const fmt = $('at-export-format').value;   // 'png' | 'tga' | 'psd'
            const useMagenta = $('at-export-magenta').checked;
            const baseName = exportBaseName();

            // Diffuse atlas — optional magenta color-key for transparent pixels.
            let diffuse = buildAtlas(el => el.canvas);
            if (useMagenta) diffuse = magentaKey(diffuse);

            if (fmt === 'psd') {
                // One layered PSD: diffuse + each enabled map as its own layer.
                if (!window.agPsd) throw new Error('PSD library not loaded');
                const children = [{ name: 'diffuse', canvas: diffuse }];
                for (const mt of TRLE.MapOrder) {
                    if (!enabledMaps[mt]) continue;
                    children.push({ name: mt, canvas: buildAtlas(el => cache[el.id][mt]) });
                }
                const buf = window.agPsd.writePsd({ width: cols * S, height: rows * S, canvas: diffuse, children });
                zip.file(`${prefix}${baseName}.psd`, new Blob([buf], { type: 'image/vnd.adobe.photoshop' }));
            } else {
                const ext = fmt === 'tga' ? 'tga' : 'png';
                const encode = (canvas) => fmt === 'tga'
                    ? Promise.resolve(TRLE.Engine.encodeTGA(canvas))
                    : TRLE.Engine.canvasToBlob(canvas);
                zip.file(`${prefix}${baseName}.${ext}`, await encode(diffuse));
                for (const mt of TRLE.MapOrder) {
                    if (!enabledMaps[mt]) continue;
                    zip.file(`${prefix}${baseName}${TRLE.MapSuffixes[mt]}.${ext}`, await encode(buildAtlas(el => cache[el.id][mt])));
                }
            }

            // Manifest for reproducibility
            const manifest = state.elements.map((el, i) => ({
                index: i + 1,
                kind: el.kind,
                seamless: el.seamless,
                material: el.kind === 'transition' ? 'inherited' : materialLabel(el),
                ...(el.kind === 'transition' ? {
                    base: indexOf(el.base) + 1,
                    overlay: indexOf(el.overlay) + 1,
                    mode: el.mode, pivot: el.pivot, hardness: el.hardness
                } : {}),
                ...(el.kind === 'anim' ? {
                    animation: {
                        group: el.anim.group, frame: el.anim.index + 1, frames: el.anim.total,
                        preset: el.anim.preset, gradient: el.anim.gradient || 'custom', fps: el.anim.fps,
                        type: el.anim.single ? 'uv-rotate' : 'animated-range'
                    }
                } : {})
            }));

            // Per-group animation summary with 1-based tile ranges + setup hints
            // for Tomb Editor (consecutive frames = an animated range that loops).
            const groups = {};
            state.elements.forEach((el, i) => {
                if (el.kind !== 'anim' || !el.anim) return;
                (groups[el.anim.group] = groups[el.anim.group] ||
                    { preset: el.anim.preset, gradient: el.anim.gradient || 'custom', single: el.anim.single, fps: el.anim.fps, indices: [] }).indices.push(i + 1);
            });
            const animations = Object.entries(groups).map(([group, g]) => {
                const idx = g.indices.sort((a, b) => a - b);
                return {
                    group, preset: g.preset, gradient: g.gradient, fps: g.fps,
                    type: g.single ? 'uv-rotate' : 'animated-range',
                    frames: g.single ? 1 : idx.length,
                    tiles: g.single ? `${idx[0]}` : `${idx[0]}-${idx[idx.length - 1]}`,
                    note: g.single
                        ? 'Single seamless tile — set UV-Rotate on this texture in Tomb Editor.'
                        : 'Select these consecutive tiles as an animated texture range; frames loop seamlessly (last → first).'
                };
            });

            zip.file(`${prefix}manifest.json`, JSON.stringify({
                tileSize: S, cols, rows, elements: manifest,
                ...(animations.length ? { animations } : {})
            }, null, 2));

            fill.style.width = '95%';
            const content = await zip.generateAsync({ type: 'blob' });
            downloadBlob(content, `${baseName}_with_materials.zip`);

            fill.style.width = '100%';
            showToast('Atlas + material maps exported! 📦', 'success');
        } catch (err) {
            console.error(err);
            showToast('Export failed — see console for details', 'error');
        } finally {
            setBusy(btn, false);
            setTimeout(() => { progress.classList.remove('active'); stopExportAnim(); }, 600);
        }
    }

    /* Export every tile as its own image (+ any enabled material maps) so they can
       be edited elsewhere and brought back (Replace Image). Deterministic names
       `tile_r{row}_c{col}` keep a stable round-trip contract. */
    async function exportTilesIndividually() {
        if (!state.elements.length) { showToast('Nothing to export yet!', 'error'); return; }
        const enabledMaps = {};
        document.querySelectorAll('#at-map-checks input[data-map]').forEach(cb => { enabledMaps[cb.dataset.map] = cb.checked; });
        const btn = $('at-export-tiles'), progress = $('at-progress'), fill = $('at-progress-fill');
        setBusy(btn, true, 'Exporting…');
        progress.classList.add('active'); fill.style.width = '0%';
        try {
            const cols = state.cols;
            const fmt = $('at-export-format').value === 'tga' ? 'tga' : 'png';   // per-tile PSD → PNG
            const ext = fmt;
            const encode = (canvas) => fmt === 'tga'
                ? Promise.resolve(TRLE.Engine.encodeTGA(canvas))
                : TRLE.Engine.canvasToBlob(canvas);
            const useMagenta = $('at-export-magenta').checked;
            const prefix = $('at-export-layout').value === 'ten' ? 'Textures/' : '';
            const anyMap = TRLE.MapOrder.some(mt => enabledMaps[mt]);
            const zip = new JSZip();
            const cache = {};
            for (let i = 0; i < state.elements.length; i++) {
                const el = state.elements[i];
                const name = `tile_r${Math.floor(i / cols)}_c${i % cols}`;
                let diffuse = el.canvas;
                if (useMagenta) diffuse = magentaKey(diffuse);
                zip.file(`${prefix}${name}.${ext}`, await encode(diffuse));
                if (anyMap) {
                    deriveMaps(el, enabledMaps, cache);
                    for (const mt of TRLE.MapOrder) {
                        if (!enabledMaps[mt] || !cache[el.id][mt]) continue;
                        zip.file(`${prefix}${name}${TRLE.MapSuffixes[mt]}.${ext}`, await encode(cache[el.id][mt]));
                    }
                }
                fill.style.width = ((i + 1) / state.elements.length * 95) + '%';
                if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
            }
            zip.file(`${prefix}manifest.json`, JSON.stringify({
                tileSize: state.tileSize, cols, rows: Math.ceil(state.elements.length / cols),
                count: state.elements.length, naming: 'tile_r{row}_c{col}'
            }, null, 2));
            const content = await zip.generateAsync({ type: 'blob' });
            downloadBlob(content, `${exportBaseName()}_tiles.zip`);
            fill.style.width = '100%';
            showToast(`Exported ${state.elements.length} tiles individually 🧩`, 'success');
        } catch (err) {
            console.error(err);
            showToast('Export failed — see console for details', 'error');
        } finally {
            setBusy(btn, false);
            setTimeout(() => progress.classList.remove('active'), 600);
        }
    }

    /* ============ PROJECT SAVE / LOAD (Phase 12) ============
       Serialises the whole element graph to a single JSON (PNG data-URLs for
       tile images + custom masks). Transitions/Wang tiles are recomputed from
       their parents on load, so only tiles + masks need pixels. */
    function imgToCanvas(img) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
    }
    function blankCanvas(S) {
        const c = document.createElement('canvas'); c.width = S; c.height = S;
        return c;
    }
    function loadImageURL(src) {
        return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    }

    function saveProject() {
        if (!state.elements.length) { showToast('Slice an atlas first!', 'error'); return; }
        const proj = {
            version: 1, tileSize: state.tileSize, cols: state.cols, nextId: state.nextId,
            elements: state.elements.map(el => {
                const e = {
                    id: el.id, kind: el.kind,
                    seamless: !!el.seamless, edited: !!el.edited,
                    material: el.material || null,
                    base: el.base ?? null, overlay: el.overlay ?? null,
                    mode: el.mode ?? null, pivot: el.pivot ?? null, hardness: el.hardness ?? null,
                    blendMethod: el.blendMethod ?? null, wangBits: el.wangBits ?? null
                };
                if (el.bset) e.bset = el.bset;   // border-set recipe (re-rendered on load)
                if (el.kind === 'tile') {
                    e.original = el.original.toDataURL('image/png');
                    if (el.seamless || el.edited) e.canvas = el.canvas.toDataURL('image/png');
                }
                if (el.customMask) e.customMask = el.customMask.toDataURL('image/png');
                if (el.overlayGeom) e.overlayGeom = el.overlayGeom;
                if (el.emissive) e.emissive = el.emissive.toDataURL('image/png');
                if (hasMatLayers(el)) e.matLayers = el.matLayers.map(L => ({
                    name: L.name, color: L.color, feather: L.feather || 0,
                    material: L.material || null,
                    mask: L.mask ? L.mask.toDataURL('image/png') : null
                }));
                // Animations store only params — frames are regenerated on load.
                if (el.anim) e.anim = el.anim;
                if (el.htParams) e.htParams = el.htParams;   // height-transition recipe (re-editable)
                return e;
            })
        };
        downloadBlob(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'atlas-project.atlasproj.json');
        showToast('Project saved', 'success');
    }

    async function loadProject(file) {
        let proj;
        try { proj = JSON.parse(await file.text()); }
        catch { showToast('Could not read project file', 'error'); return; }
        if (!proj || proj.version !== 1 || !Array.isArray(proj.elements)) {
            showToast('Invalid project file', 'error'); return;
        }
        const S = proj.tileSize;
        const els = [];
        for (const e of proj.elements) {
            const el = {
                id: e.id, kind: e.kind,
                seamless: !!e.seamless, edited: !!e.edited,
                material: e.material || null,
                base: e.base ?? undefined, overlay: e.overlay ?? undefined,
                mode: e.mode ?? undefined, pivot: e.pivot ?? undefined, hardness: e.hardness ?? undefined,
                blendMethod: e.blendMethod ?? undefined,
                wangBits: e.wangBits == null ? undefined : e.wangBits,
                bset: e.bset || null,
                overlayGeom: e.overlayGeom || null,
                anim: e.anim || null,
                htParams: e.htParams || null,
                original: null, canvas: null
            };
            if (e.customMask) { const im = await loadImageURL(e.customMask); if (im) el.customMask = imgToCanvas(im); }
            if (e.emissive) { const im = await loadImageURL(e.emissive); if (im) el.emissive = imgToCanvas(im); }
            if (Array.isArray(e.matLayers)) {
                el.matLayers = [];
                for (const L of e.matLayers) {
                    const mask = L.mask ? imgToCanvas(await loadImageURL(L.mask)) : null;
                    el.matLayers.push({ name: L.name, color: L.color, feather: L.feather || 0, material: L.material || null, mask });
                }
            }
            if (e.kind === 'tile') {
                const oim = await loadImageURL(e.original);
                el.original = oim ? imgToCanvas(oim) : blankCanvas(S);
                const cim = e.canvas ? await loadImageURL(e.canvas) : null;
                el.canvas = cim ? imgToCanvas(cim) : cloneCanvas(el.original);
            } else {
                el.canvas = blankCanvas(S);   // recomputed by refreshTransitions
            }
            els.push(el);
        }
        state.tileSize = S;
        state.cols = proj.cols;
        state.nextId = proj.nextId || (Math.max(0, ...els.map(e => e.id)) + 1);
        state.elements = els;
        state.selectedId = null; state.focusedId = null; state.selSet.clear(); state.selAnchor = null;
        exitPickMode();
        refreshAnims();         // regenerate animation frames from restored params
        refreshTransitions();
        $('at-grid-card').style.display = 'block';
        $('at-export-card').style.display = 'block';
        renderGrid();
        resetHistory('Project loaded');
        showToast(`Project loaded (${els.length} elements)`, 'success');
    }

    /* ============ BLANK ATLAS + DYNAMIC TILES (Phase A) ============ */
    function makeTileFromImage(img) {
        const S = state.tileSize;
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        canvas.getContext('2d').drawImage(img, 0, 0, S, S);
        return { id: state.nextId++, kind: 'tile', canvas, original: cloneCanvas(canvas),
                 seamless: false, edited: false, material: null };
    }

    /* A tile from a sub-rectangle of a source image, resampled to S×S. */
    function makeTileFromRegion(img, sx, sy, sw, sh, S) {
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, S, S);
        return { id: state.nextId++, kind: 'tile', canvas, original: cloneCanvas(canvas),
                 seamless: false, edited: false, material: null };
    }

    /* ============ IMPORT MODAL (grid + cell selection) ============
       Pick which cells of a source atlas image to bring in. Selected cells are
       resampled to the atlas tile size and appended (creating the atlas if empty).
       Covers: rip one texture · grab several from a sheet · stitch from many
       atlases (re-open per source). */
    const imp = { img: null, cols: 1, rows: 1, sel: new Set(), targetSize: 256, isFirst: false };

    function importCleanup() { imp.img = null; imp.sel.clear(); }

    const impKey = (r, c) => r + '_' + c;
    function impSelectAll() {
        imp.sel.clear();
        for (let r = 0; r < imp.rows; r++) for (let c = 0; c < imp.cols; c++) imp.sel.add(impKey(r, c));
    }

    function impRender() {
        if (!imp.img) return;
        const cv = $('at-import-canvas');
        const box = cv.parentElement;   // scroll container
        const iw = imp.img.naturalWidth, ih = imp.img.naturalHeight;
        const cols = imp.cols, rows = imp.rows;
        // Show each cell at a legible fixed size and let the container scroll —
        // the way the main atlas grid does — instead of squashing the whole sheet
        // into one box (which made huge/tall atlases unreadably tiny). Fit the
        // width to the column count, clamp to a sensible per-cell range, then
        // guard against exceeding the browser's max canvas dimension (~16384px).
        const availW = Math.max(320, (box.clientWidth || 700) - 2);
        let cell = Math.max(44, Math.min(120, Math.round(availW / cols)));
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const MAXPX = 16000;
        if (cell * rows * dpr > MAXPX) cell = Math.max(12, Math.floor(MAXPX / (rows * dpr)));
        const W = cell * cols, H = cell * rows, cw = cell, ch = cell;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, W, H);
        // One uniform draw maps each source cell into its square display cell
        // (matches the square resize done on import), keeping a clean grid.
        ctx.drawImage(imp.img, 0, 0, W, H);
        // dim unselected cells
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (!imp.sel.has(impKey(r, c))) {
                ctx.fillStyle = 'rgba(10,10,14,0.62)';
                ctx.fillRect(c * cw, r * ch, cw, ch);
            }
        }
        // grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
        for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(c * cw + 0.5, 0); ctx.lineTo(c * cw + 0.5, H); ctx.stroke(); }
        for (let r = 1; r < rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch + 0.5); ctx.lineTo(W, r * ch + 0.5); ctx.stroke(); }
        // selected outlines
        ctx.strokeStyle = '#e8852a'; ctx.lineWidth = 2;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (imp.sel.has(impKey(r, c))) ctx.strokeRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
        }
        $('at-import-cellsize').textContent = `${Math.round(iw / cols)}×${Math.round(ih / rows)} px`;
        $('at-import-count').textContent = imp.sel.size;
        $('at-import-addcount').textContent = imp.sel.size;

        // Warn when a cell isn't square / doesn't divide evenly — each tile is
        // resized to a square targetSize², so non-square cells get stretched.
        const cellW = iw / cols, cellH = ih / rows;
        const reasons = [];
        if (Math.abs(cellW / cellH - 1) > 0.02)
            reasons.push(`each cell is <strong>${(cellW).toFixed(0)}×${(cellH).toFixed(0)}</strong> (not square) — tiles get stretched to ${imp.targetSize}²`);
        else if (Math.abs(iw % cols) > 0.5 || Math.abs(ih % rows) > 0.5)
            reasons.push(`${iw}×${ih} doesn’t divide evenly into ${cols}×${rows} — cell edges are rounded`);
        const warn = $('at-import-warn');
        if (reasons.length) { warn.innerHTML = '⚠️ ' + reasons.join('; ') + '. Adjust Columns/Rows to match the source for a clean 1:1 slice.'; warn.style.display = 'block'; }
        else warn.style.display = 'none';
    }

    function openImportModal(img, targetSize, isFirst) {
        imp.img = img; imp.targetSize = targetSize; imp.isFirst = isFirst;
        imp.cols = Math.max(1, Math.round(img.naturalWidth / targetSize));
        imp.rows = Math.max(1, Math.round(img.naturalHeight / targetSize));
        $('at-import-cols').value = imp.cols;
        $('at-import-rows').value = imp.rows;
        $('at-import-size').textContent = targetSize;
        impSelectAll();
        openModal('import');
        impRender();
    }

    function setupImportModal() {
        ['at-import-cols', 'at-import-rows'].forEach(id => $(id).addEventListener('input', function () {
            const v = Math.max(1, Math.min(128, parseInt(this.value) || 1));
            if (id === 'at-import-cols') imp.cols = v; else imp.rows = v;
            impSelectAll();   // cell layout changed → reselect everything
            impRender();
        }));
        $('at-import-all').addEventListener('click', () => { impSelectAll(); impRender(); });
        $('at-import-none').addEventListener('click', () => { imp.sel.clear(); impRender(); });
        $('at-import-invert').addEventListener('click', () => {
            const next = new Set();
            for (let r = 0; r < imp.rows; r++) for (let c = 0; c < imp.cols; c++) {
                if (!imp.sel.has(impKey(r, c))) next.add(impKey(r, c));
            }
            imp.sel = next; impRender();
        });
        $('at-import-canvas').addEventListener('click', e => {
            if (!imp.img) return;
            const cv = $('at-import-canvas'), r = cv.getBoundingClientRect();
            const c = Math.min(imp.cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * imp.cols)));
            const rr = Math.min(imp.rows - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * imp.rows)));
            const k = impKey(rr, c);
            if (imp.sel.has(k)) imp.sel.delete(k); else imp.sel.add(k);
            impRender();
        });
        $('at-import-add').addEventListener('click', () => {
            if (!imp.img || imp.sel.size === 0) { showToast('Select at least one cell to import', 'error'); return; }
            const S = imp.targetSize;
            const iw = imp.img.naturalWidth, ih = imp.img.naturalHeight;
            const cw = iw / imp.cols, ch = ih / imp.rows;
            const firstSetup = imp.isFirst || !state.elements.length;
            if (firstSetup) {
                state.tileSize = S;
                state.cols = imp.cols;
                state.elements = [];
                state.nextId = 1;
                state.selectedId = null; state.selSet.clear(); state.selAnchor = null;
                state.focusedId = null;
                exitPickMode();
                $('at-grid-card').style.display = 'block';
                $('at-export-card').style.display = 'block';
            }
            const cells = [...imp.sel].map(k => k.split('_').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const [r, c] of cells) {
                state.elements.push(makeTileFromRegion(imp.img, c * cw, r * ch, cw, ch, S));
            }
            const n = cells.length;
            closeModal();
            renderGrid();
            if (firstSetup) collapseUploadCard(`${state.elements.length} elements — click to slice a different atlas`);
            if (firstSetup) resetHistory(`Imported ${n} tile${n !== 1 ? 's' : ''}`);
            else pushHistory(`Imported ${n} tile${n !== 1 ? 's' : ''}`);
            showToast(`Imported ${n} tile${n !== 1 ? 's' : ''}`, 'success');
        });
    }

    /* Paste an image from the clipboard straight into the atlas. Confirms first,
       then routes the image through the Import modal so the user picks how to
       slice it (with the same aspect-ratio warning). Ignored while typing in a
       field or with a modal open, so normal text paste still works. */
    function setupClipboardPaste() {
        document.addEventListener('paste', e => {
            const ae = document.activeElement;
            if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;   // let text paste into fields
            if ($('at-overlay').style.display !== 'none') return;             // ignore while a modal is open
            const items = (e.clipboardData && e.clipboardData.items) || [];
            let file = null;
            for (const it of items) { if (it.kind === 'file' && /^image\//.test(it.type)) { file = it.getAsFile(); break; } }
            if (!file) return;
            e.preventDefault();
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const isFirst = !state.elements.length;
                const size = state.tileSize || getTileSize() || 256;
                const square = img.naturalWidth === img.naturalHeight;
                openConfirm('📋 Paste image from clipboard',
                    `Add the copied image (${img.naturalWidth}×${img.naturalHeight}px${square ? '' : ' — not square'}) to your atlas? You’ll choose how to slice it into tiles next.`,
                    'Continue', () => openImportModal(img, size, isFirst),
                    { danger: false, cancelLabel: 'Cancel' });
            };
            img.onerror = () => { URL.revokeObjectURL(url); showToast('Could not read the pasted image', 'error'); };
            img.src = url;
        });
    }

    function createBlankAtlas() {
        const S = getTileSize();
        const cols = Math.max(1, Math.min(12, parseInt($('at-blank-cols').value) || 4));
        state.tileSize = S;
        state.cols = cols;
        state.elements = [];
        state.nextId = 1;
        state.selectedId = null; state.selSet.clear(); state.selAnchor = null;
        state.focusedId = null;
        exitPickMode();
        $('at-grid-card').style.display = 'block';
        $('at-export-card').style.display = 'block';
        renderGrid();
        collapseUploadCard('blank atlas — click to upload an atlas instead');
        resetHistory('Blank atlas');
        showToast('Blank atlas created — add tiles with “Add Image(s)”', 'info', 3500);
    }

    /* Load image files into tiles (preserves selection order). */
    /* Commit loaded images as tiles (preserving order). */
    function commitImageTiles(imgs) {
        imgs.forEach(img => state.elements.push(makeTileFromImage(img)));
        renderGrid();
        const n = imgs.length;
        pushHistory(`Add ${n} image${n !== 1 ? 's' : ''}`);
        showToast(`Added ${n} tile${n !== 1 ? 's' : ''}`, 'success');
    }

    /* Heuristic: does a single dropped image look like a whole atlas sheet rather
       than one texture? Returns a human reason, or null. Used to nudge the user
       toward the atlas importer instead of squishing the sheet into one tile. */
    function atlasLikeReason(img) {
        const w = img.naturalWidth, h = img.naturalHeight, S = state.tileSize || getTileSize() || 256;
        if (Math.abs(w / h - 1) > 0.12) return 'it isn’t square — atlas sheets usually aren’t';
        if (Math.max(w, h) >= 3 * S) return 'it’s much larger than a single tile';
        return null;
    }

    function addImageTiles(files) {
        // Accept anything that reports an image MIME type OR is a .tga (whose
        // type is often empty), so TGA files aren't silently dropped here.
        const list = [...files].filter(f =>
            (f.type && f.type.startsWith('image/')) || isTGAFile(f));
        if (!list.length) return;
        if (!state.elements) state.elements = [];
        const slots = new Array(list.length).fill(null);
        let pending = list.length, failed = 0;
        const done = () => {
            if (failed) showToast(`${failed} file${failed > 1 ? 's' : ''} couldn’t be read (unsupported or corrupt).`, 'error');
            const imgs = slots.filter(Boolean);
            if (!imgs.length) return;
            // A single atlas-looking image → offer the tile picker instead of
            // squishing the whole sheet into one tile (honour the original
            // "add as a tile" intent on Cancel/dismiss).
            if (imgs.length === 1) {
                const why = atlasLikeReason(imgs[0]);
                if (why) {
                    const S = state.tileSize || getTileSize();
                    openConfirm('🗺️ Looks like an atlas',
                        `This image is ${imgs[0].naturalWidth}×${imgs[0].naturalHeight} — ${why}. Adding it as one tile resizes the whole sheet down to ${S}². Pick tiles from it as an atlas instead?`,
                        '🗺️ Import from Atlas…',
                        () => openImportModal(imgs[0], S, !state.elements.length),
                        { cancelLabel: 'Add as one tile', danger: false, onNo: () => commitImageTiles(imgs) });
                    return;
                }
            }
            commitImageTiles(imgs);
        };
        list.forEach((file, idx) => {
            readImageFile(file)
                .then(img => { slots[idx] = img; })
                .catch(() => { failed++; })
                .finally(() => { if (--pending === 0) done(); });
        });
    }

    function triggerAddImages() {
        if (!state.tileSize) return;
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*,.tga'; inp.multiple = true;
        inp.addEventListener('change', e => { if (e.target.files.length) addImageTiles(e.target.files); });
        inp.click();
    }

    function addBlankTile() {
        if (!state.tileSize) return;
        const S = state.tileSize;
        const canvas = document.createElement('canvas');
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
        state.elements.push({ id: state.nextId++, kind: 'tile', canvas, original: cloneCanvas(canvas),
                              seamless: false, edited: false, material: null });
        renderGrid();
        pushHistory('Add blank tile');
        showToast('Added blank tile', 'success');
    }

    /* ============ SLICING ============ */
    /* Collapse the Upload-atlas accordion once an atlas exists, so the elements
       grid isn't pushed down by an upload zone the user is done with. */
    function collapseUploadCard(hint) {
        const card = $('at-upload-card');
        if (card) card.open = false;
        if (hint) $('at-upload-summary-hint').textContent = hint;
    }

    async function sliceAtlas() {
        if (!state.image) return;
        const S = getTileSize();
        const img = state.image;
        const cols = Math.floor(img.naturalWidth / S);
        const rows = Math.floor(img.naturalHeight / S);
        if (cols < 1 || rows < 1) {
            showToast(`Atlas is smaller than the ${S}px tile size!`, 'error');
            return;
        }

        const btn = $('at-slice-btn');
        setBusy(btn, true, 'Slicing…');
        // Yield once so the busy state paints before the synchronous slice loop.
        await new Promise(r => requestAnimationFrame(r));

        try {
            state.tileSize = S;
            state.cols = cols;
            state.elements = [];
            state.nextId = 1;
            state.selectedId = null; state.selSet.clear(); state.selAnchor = null;
            exitPickMode();

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const canvas = document.createElement('canvas');
                    canvas.width = S; canvas.height = S;
                    canvas.getContext('2d').drawImage(img, c * S, r * S, S, S, 0, 0, S, S);
                    state.elements.push({
                        id: state.nextId++,
                        kind: 'tile',
                        canvas,
                        original: cloneCanvas(canvas),
                        seamless: false,
                        material: null
                    });
                }
            }

            $('at-grid-card').style.display = 'block';
            $('at-export-card').style.display = 'block';
            renderGrid();
            collapseUploadCard(`${state.elements.length} elements — click to slice a different atlas`);
            resetHistory('Sliced atlas');   // fresh atlas → new undo baseline
            showToast(`Sliced into ${state.elements.length} elements (${cols}×${rows})`, 'success');
        } finally {
            setBusy(btn, false);
        }
    }

    /* ============ INIT ============ */
    function init() {
        const ok = TRLE.Engine.init($('gl-canvas'));
        if (!ok) {
            const banner = $('webgl-compat-banner');
            banner.querySelector('.compat-message').textContent =
                'WebGL 2.0 is not supported by this browser — the Atlas Tool cannot run.';
            banner.style.display = 'flex';
            return;
        }

        setupUpload('at-upload', 'at-file', (img) => {
            state.image = img;
            $('at-slice-btn').disabled = false;
            $('at-pick-btn').disabled = false;
            $('at-upload-summary-hint').textContent =
                `${img.naturalWidth}×${img.naturalHeight} loaded — choose a tile size, then Slice or Pick tiles`;
        });
        $('at-slice-btn').addEventListener('click', sliceAtlas);
        $('at-pick-btn').addEventListener('click', () => {
            if (state.image) openImportModal(state.image, getTileSize(), !state.elements.length);
        });
        $('at-import-atlas').addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*,.tga';
            inp.addEventListener('change', e => {
                const file = e.target.files[0];
                if (!file) return;
                readImageFile(file)
                    .then(img => openImportModal(img, state.tileSize || getTileSize(), !state.elements.length))
                    .catch(err => showToast(err.message, 'error'));
            });
            inp.click();
        });
        $('at-create-blank').addEventListener('click', createBlankAtlas);
        $('at-add-images').addEventListener('click', triggerAddImages);
        $('at-add-blank').addEventListener('click', addBlankTile);
        $('at-add-anim').addEventListener('click', () => openAnimModal());
        $('at-pick-cancel').addEventListener('click', exitPickMode);
        $('at-pick-same').addEventListener('click', () => {
            if (state.pickBaseId !== null && state.pickMode === 'borderset')
                openBsetModal(state.pickBaseId, state.pickBaseId);
        });
        $('at-export-btn').addEventListener('click', exportAtlas);
        $('at-export-tiles').addEventListener('click', exportTilesIndividually);
        $('at-export-flipy').addEventListener('change', e => {
            state.flipNormalY = e.target.checked;
            showToast(e.target.checked
                ? 'Normals will export flipped (DirectX convention)'
                : 'Normals will export OpenGL convention (TombEngine)', 'info');
        });
        // Height map = parallax in-engine → warn about cost + recommend per-texture use.
        const heightCb = document.querySelector('#at-map-checks input[data-map="height"]');
        const heightWarn = $('at-height-warning');
        if (heightCb && heightWarn) {
            const seamlessRow = $('at-height-seamless-row');
            const syncHeightWarn = toast => {
                heightWarn.style.display = heightCb.checked ? 'block' : 'none';
                if (seamlessRow) seamlessRow.style.display = heightCb.checked ? 'flex' : 'none';
                if (toast && heightCb.checked) {
                    showToast('Height maps are GPU-expensive — prefer one texture at a time over a whole atlas', 'warning', 5000);
                }
            };
            heightCb.addEventListener('change', () => syncHeightWarn(true));
            syncHeightWarn(false);   // reflect initial state (height defaults off)
        }
        $('at-save-project').addEventListener('click', saveProject);
        $('at-load-project').addEventListener('click', () => $('at-load-project-file').click());
        $('at-load-project-file').addEventListener('change', e => {
            if (e.target.files[0]) loadProject(e.target.files[0]);
            e.target.value = '';
        });
        $('at-undo').addEventListener('click', undo);
        $('at-redo').addEventListener('click', redo);
        $('at-select-all').addEventListener('click', selectAll);
        setupSelectionMarquee();
        setupBulkBar();
        $('at-confirm-ok').addEventListener('click', () => {
            const cb = confirmCb;
            confirmNoCb = null;       // OK chosen → suppress the "No" action
            closeModal();
            if (cb) cb();
        });
        setupHistoryShortcuts();

        setupGrid();
        setupCtxMenu();
        setupModals();
        setupSeamlessModal();
        setupTransModal();
        setupMatModal();
        setupMultiMaterial();
        setupHealModal();
        setupVarModal();
        setupOrigamiModal();
        setupBuildModal();
        setupWangModal();
        setupBsetModal();
        setupFadeModal();
        setupEmissiveModal();
        setupAnchorModal();
        setupHeightModal();
        setupTransGridModal();
        setupOrganicModal();
        setupAnimModal();
        setupColorAdjModal();
        setupRecolorModal();
        setupDelightModal();
        setupImportModal();
        setupClipboardPaste();
        applyPrefs();
        setupAccessibility();

        // Tutorial-asset capture hook — only active with ?capture in the URL, so
        // it has zero effect on normal use. Lets tools/capture-examples.mjs drive
        // the REAL composition functions over CDP (single-sourced, no drift).
        if (/[?&]capture/i.test(location.search)) installCaptureHook();
    }

    function installCaptureHook() {
        const loadImg = src => new Promise((res, rej) => {
            const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
        });
        const toC = (img, S) => { const c = document.createElement('canvas'); c.width = S; c.height = S; c.getContext('2d').drawImage(img, 0, 0, S, S); return c; };
        const url = c => c.toDataURL('image/png');
        const tile = (canvas, id) => ({ id, kind: 'tile', canvas, original: cloneCanvas(canvas), seamless: false, edited: false, material: null });
        window.TRLE._cap = {
            // tile (just resampled) — used for "before" frames
            async single(src, S) { return url(toC(await loadImg(src), S)); },
            // 2×2 tiled collage — to show seam behaviour
            collage(dataUrl) { return loadImg(dataUrl).then(img => { const S = img.width; const o = document.createElement('canvas'); o.width = S * 2; o.height = S * 2; const x = o.getContext('2d'); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(img, i * S, j * S); return url(o); }); },
            async transition(aSrc, bSrc, S, mode, pivot, hardness, method) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                return url(composeTransitionDiffuse(A, B, buildTopologyMask(S, mode, pivot, hardness), S, method || 'alpha'));
            },
            async organic(aSrc, bSrc, S, opts) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                return url(composeTransitionDiffuse(A, B, buildOrganicMask(S, S, opts), S, 'alpha'));
            },
            async wangMontage(aSrc, bSrc, S, cell) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                const o = document.createElement('canvas'); o.width = cell * 4; o.height = cell * 4; const x = o.getContext('2d');
                for (let bits = 0; bits < 16; bits++) {
                    const comp = composeTransitionDiffuse(A, B, buildWangMask(S, bits, 0.5, 0.0), S, 'alpha');
                    x.drawImage(comp, (bits % 4) * cell, ((bits / 4) | 0) * cell, cell, cell);
                }
                return url(o);
            },
            // 2×2 tiling of the raw resampled source (shows the seams)
            async tiled(src, S) {
                const c = toC(await loadImg(src), S);
                const o = document.createElement('canvas'); o.width = S * 2; o.height = S * 2; const x = o.getContext('2d');
                for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(c, i * S, j * S);
                return url(o);
            },
            // materialize seamless (desaturate → seamlessMaker), tiled 2×2
            async seamless(src, S, overlap, falloff) {
                const E = TRLE.Engine, c = toC(await loadImg(src), S);
                const tex = E.createTextureFromImage(c);
                const gray = E.createFBO(S, S); E.blit('desaturate', { u_texture: tex, u_gamma: 1.0 }, gray);
                const res = E.createFBO(S, S);
                E.blit('seamlessMaker', { u_texture: tex, u_heightMap: gray.texture, u_overlapX: overlap, u_overlapY: overlap, u_falloff: falloff }, res);
                const out = E.fboToCanvas(res);
                E.deleteFBO(gray); E.deleteFBO(res); E.deleteTexture(tex);
                const o = document.createElement('canvas'); o.width = S * 2; o.height = S * 2; const x = o.getContext('2d');
                for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(out, i * S, j * S, S, S);
                return url(o);
            },
            // heal demo: stamp an artificial smudge, then inpaint it away
            async healDemo(src, S, cx, cy, r) {
                const A = toC(await loadImg(src), S);
                const smudged = cloneCanvas(A), sc = smudged.getContext('2d');
                sc.fillStyle = 'rgba(18,12,8,0.88)'; sc.beginPath(); sc.arc(cx * S, cy * S, r * S, 0, Math.PI * 2); sc.fill();
                const mask = document.createElement('canvas'); mask.width = S; mask.height = S;
                const mc = mask.getContext('2d'); mc.fillStyle = '#000'; mc.fillRect(0, 0, S, S);
                mc.fillStyle = '#fff'; mc.beginPath(); mc.arc(cx * S, cy * S, r * S * 1.12, 0, Math.PI * 2); mc.fill();
                return { before: url(smudged), after: url(healPatchFill(smudged, mask, S)) };
            },
            // animated-texture montage (cols×rows frames). animate=false draws the
            // same frame in every cell (static "before"); true draws the real
            // sequence (animated "after"). Same dimensions either way.
            animMontage(presetKey, S, seed, cols, rows, animate) {
                const n = cols * rows;
                const all = TRLE.AnimGen.generateFrames(TRLE.AnimPresets_resolve(presetKey, { size: S, frames: n, seed: seed || 0 }));
                const o = document.createElement('canvas'); o.width = S * cols; o.height = S * rows;
                const x = o.getContext('2d');
                for (let i = 0; i < n; i++) {
                    const f = animate ? all[i] : all[0];
                    x.drawImage(f, (i % cols) * S, ((i / cols) | 0) * S, S, S);
                }
                return url(o);
            },
            // Per-frame data URLs for an animated preset: the looping albedo
            // sequence, plus (if emOpts given) the matching emissive map of each
            // frame — for stitching side-by-side GIFs in the Learn page.
            animFrames(presetKey, S, seed, frames, emOpts) {
                const all = TRLE.AnimGen.generateFrames(TRLE.AnimPresets_resolve(presetKey, { size: S, frames, seed: seed || 0 }));
                return {
                    albedo: all.map(f => url(f)),
                    emissive: emOpts ? all.map(f => url(TRLE.Engine.emissiveFromDiffuse(f, emOpts))) : []
                };
            },
            // Single seamless tile (scattered-edges) — overlap = scatter %, falloff = blend radius.
            async seamlessTile(src, S, overlap, falloff) {
                const E = TRLE.Engine, c = toC(await loadImg(src), S);
                const tex = E.createTextureFromImage(c);
                const gray = E.createFBO(S, S); E.blit('desaturate', { u_texture: tex, u_gamma: 1.0 }, gray);
                const res = E.createFBO(S, S);
                E.blit('seamlessMaker', { u_texture: tex, u_heightMap: gray.texture, u_overlapX: overlap, u_overlapY: overlap, u_falloff: falloff }, res);
                const out = E.fboToCanvas(res);
                E.deleteFBO(gray); E.deleteFBO(res); E.deleteTexture(tex);
                return url(out);
            },
            // A looping pan over the tiled seamless result (frames = data URLs). Pans
            // exactly one tile diagonally so it loops; the tile boundary crosses the
            // viewport — if it's truly seamless, no seam line appears.
            async seamlessPan(src, S, overlap, falloff, frames) {
                const tileUrl = await this.seamlessTile(src, S, overlap, falloff);
                const tile = await loadImg(tileUrl);
                const out = [];
                for (let i = 0; i < frames; i++) {
                    const off = Math.round(i / frames * S);
                    const o = document.createElement('canvas'); o.width = S; o.height = S;
                    const x = o.getContext('2d');
                    for (let gy = 0; gy <= 1; gy++) for (let gx = 0; gx <= 1; gx++)
                        x.drawImage(tile, gx * S - off, gy * S - off, S, S);
                    out.push(url(o));
                }
                return out;
            },
            // Geometric Wang montage: grass (A) centre, sand (B) creeping in from each
            // active side. 3×3 with 2-sided corners; grid lines drawn between cells.
            // Bit encoding (buildWangMask): N=1 E=2 S=4 W=8.
            async wangGeo(aSrc, bSrc, S, cell, line) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                const grid = [[9, 1, 3], [8, 0, 2], [12, 4, 6]];   // NW N NE / W centre E / SW S SE
                const L = line || 0;
                const o = document.createElement('canvas');
                o.width = cell * 3 + L * 4; o.height = cell * 3 + L * 4;
                const x = o.getContext('2d');
                x.fillStyle = '#3c3c3c'; x.fillRect(0, 0, o.width, o.height);   // grid line colour
                for (let r = 0; r < 3; r++) for (let cidx = 0; cidx < 3; cidx++) {
                    const bits = grid[r][cidx];
                    const comp = bits === 0 ? A : composeTransitionDiffuse(A, B, buildWangMask(S, bits, 0.5, 0.0), S, 'alpha');
                    x.drawImage(comp, L + cidx * (cell + L), L + r * (cell + L), cell, cell);
                }
                return url(o);
            },
            // Full-set montage: the same spatial layouts the Make Transition "Full
            // Set" tab adds, stitched into one figure with grid lines. base (A) /
            // overlay (B); layout = island3 | hole3 | complete5; sharp = 45° cuts.
            async transSet(aSrc, bSrc, S, layout, sharp, cell, line) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                const { width, cells } = transSetCells(layout, !!sharp);
                const rows = cells.length / width;
                const L = line || 0;
                const o = document.createElement('canvas');
                o.width = cell * width + L * (width + 1);
                o.height = cell * rows + L * (rows + 1);
                const x = o.getContext('2d');
                x.fillStyle = '#3c3c3c'; x.fillRect(0, 0, o.width, o.height);
                cells.forEach((mode, i) => {
                    const r = (i / width) | 0, cidx = i % width;
                    const comp = mode === '@BASE' ? A : mode === '@OVERLAY' ? B
                        : composeTransitionDiffuse(A, B, buildTopologyMask(S, mode, 0.5, 0.0), S, 'alpha');
                    x.drawImage(comp, L + cidx * (cell + L), L + r * (cell + L), cell, cell);
                });
                return url(o);
            },
            // Recolour base to adopt the reference's palette (mean/std colour transfer).
            async recolor(baseSrc, refSrc, S, strength) {
                const E = TRLE.Engine;
                const A = toC(await loadImg(baseSrc), S), B = toC(await loadImg(refSrc), S);
                const sa = computeColorStats(A, 64), sb = computeColorStats(B, 64);
                const scale = [0, 1, 2].map(c => Math.max(0.2, Math.min(3, sb.std[c] / sa.std[c])));
                const tex = E.createTextureFromImage(A);
                const t1 = E.createFBO(S, S);
                E.blit('colorTransfer', { u_texture: tex, u_meanA: sa.mean, u_meanB: sb.mean, u_scale: scale, u_strength: strength == null ? 0.9 : strength }, t1);
                const out = E.fboToCanvas(t1);
                E.deleteFBO(t1); E.deleteTexture(tex);
                return url(out);
            },
            // Fade a tile's edges to transparent (vignette) — PNG keeps the alpha.
            async fadeEdges(src, S, amount, hardness) {
                const A = toC(await loadImg(src), S);
                return url(applyAlphaFade(A, buildEdgeVignetteMask(S, amount, hardness)));
            },
            async delight(src, S, strength) { return url(delightWhole(toC(await loadImg(src), S), S, strength)); },
            async emissive(src, S, opts) { const A = toC(await loadImg(src), S); return url(TRLE.Engine.emissiveFromDiffuse(A, opts)); },
            // screenshots: build a 2-tile atlas and open a modal
            async setupTwoTiles(aSrc, bSrc, S) {
                const A = toC(await loadImg(aSrc), S), B = toC(await loadImg(bSrc), S);
                state.tileSize = S; state.cols = 2; state.nextId = 3;
                state.elements = [tile(A, 1), tile(B, 2)];
                $('at-grid-card').style.display = 'block';
                renderGrid();
                return true;
            },
            openAnchor() { openAnchorModal(1, 2); return true; },
            openTrans() { openTransModal(1, 2); return true; },
            openCtx(id) { openCtxMenuForCell(id); return true; },
            openGrid() { openTransGridModal(1, 2); return true; },
            openOrganic() { openOrganicModal(1, 2); return true; },
            seamToggle(side, seg) { if (org.seam) org.seam[side][seg] = !org.seam[side][seg]; orgDrawSeamBox(); return org.seam ? org.seam[side][seg] : null; },
            modalRect(name) { const m = $(`at-modal-${name}`); const r = m.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }
        };
    }

    /* ============ ACCESSIBILITY: theme + UI scale (persisted) ============ */
    const SCALE_MIN = 11, SCALE_MAX = 20, SCALE_BASE = 14;

    function applyTheme(theme) {
        const light = theme === 'light';
        document.documentElement.dataset.theme = light ? 'light' : 'dark';
        const btn = $('at-theme-toggle');
        btn.textContent = light ? '☀️' : '🌙';
        btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    }

    function applyScale(px) {
        px = Math.max(SCALE_MIN, Math.min(SCALE_MAX, px));
        document.documentElement.style.fontSize = px + 'px';
        return px;
    }

    function setupAccessibility() {
        // Theme
        let theme = prefs.theme === 'light' ? 'light' : 'dark';
        applyTheme(theme);
        $('at-theme-toggle').addEventListener('click', () => {
            theme = theme === 'light' ? 'dark' : 'light';
            applyTheme(theme);
            savePref('theme', theme);
        });

        // UI scale (root font-size, drives all rem-based sizing)
        let scale = typeof prefs.uiScale === 'number' ? prefs.uiScale : SCALE_BASE;
        scale = applyScale(scale);
        const setScale = v => { scale = applyScale(v); savePref('uiScale', scale); };
        $('at-scale-down').addEventListener('click', () => setScale(scale - 1));
        $('at-scale-up').addEventListener('click', () => setScale(scale + 1));
        $('at-scale-reset').addEventListener('click', () => setScale(SCALE_BASE));
    }

    /* Restore persisted UI choices and keep them in sync. */
    function applyPrefs() {
        // Tile size
        const sizeSel = $('at-tile-size'), sizeCustom = $('at-tile-size-custom');
        if (prefs.tileSize && [...sizeSel.options].some(o => o.value === prefs.tileSize)) {
            sizeSel.value = prefs.tileSize;
        }
        if (prefs.tileSizeCustom) sizeCustom.value = prefs.tileSizeCustom;
        const syncSizeCustom = () => { sizeCustom.style.display = sizeSel.value === 'custom' ? '' : 'none'; };
        syncSizeCustom();
        sizeSel.addEventListener('change', () => { syncSizeCustom(); savePref('tileSize', sizeSel.value); });
        sizeCustom.addEventListener('change', () => savePref('tileSizeCustom', sizeCustom.value));

        // Map checkboxes
        document.querySelectorAll('#at-map-checks input[data-map]').forEach(cb => {
            if (prefs.maps && prefs.maps[cb.dataset.map] != null) cb.checked = prefs.maps[cb.dataset.map];
            cb.addEventListener('change', () => {
                const maps = {};
                document.querySelectorAll('#at-map-checks input[data-map]')
                    .forEach(c => { maps[c.dataset.map] = c.checked; });
                savePref('maps', maps);
            });
        });

        // Seamless method + blend radius (carried between tile edits)
        const methodSel = $('at-sm-method');
        if (prefs.smMethod && [...methodSel.options].some(o => o.value === prefs.smMethod)) {
            methodSel.value = prefs.smMethod;
        }
        methodSel.addEventListener('change', () => savePref('smMethod', methodSel.value));

        const falloff = $('at-sm-falloff');
        if (prefs.smFalloff != null) {
            falloff.value = prefs.smFalloff;
            $('at-sm-falloff-val').textContent = prefs.smFalloff;
        }
        falloff.addEventListener('change', () => savePref('smFalloff', falloff.value));
    }

    document.addEventListener('DOMContentLoaded', init);
})();
