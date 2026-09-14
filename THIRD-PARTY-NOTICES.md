# Licensing & third-party notices

**TRLE Tools / Atlas Tool** — Copyright (c) 2026 KainM-77. MIT licensed.

## Licensing summary

**The whole repository is MIT licensed** — see [LICENSE](LICENSE). Every file is
covered, including the archived v1 tool in `Archive/TextureTool-v1/`. There are no
copyleft strings and no per-file exceptions.

Until **2026-09-13** the tool as a whole shipped under GPL-3.0, because two
seamless-tiling shaders were ported from Materialize (GPL-3.0) and copyleft
governed the combined program. Those two shaders have been removed; see below.

Third-party components keep their own licenses, all permissive.

---

## Materialize — REMOVED 2026-09-13 (no longer bundled)

- Author: BoundingBoxSoftware
- Source: https://github.com/BoundingBoxSoftware/Materialize
- License: GNU General Public License v3.0

Two WebGL shaders in `AtlasTool/js/shaders.js` used to be ported (HLSL→GLSL) from
Materialize's `Blit_Seamless_Texture_Maker.shader` — `seamlessMaker` (the `frag`
pass) and `seamlessSplat` (the `frag_splat` pass). Being line-by-line
translations, they were derivative of GPL-3.0 code, and they were the sole reason
the tool shipped under GPL-3.0.

**Both were deleted on 2026-09-13** — from the live tool and from the archived v1
copy — and replaced with independent implementations of published techniques:

| removed (GPL-3.0) | replacement (MIT) | technique |
|---|---|---|
| `seamlessMaker` | `wrapShift` + `seamBandMask` + `bandBlend` + `bandDiff`, orchestrated by `TRLE.Engine.seamlessMultiBand` | multi-band (Laplacian pyramid) blending — Burt & Adelson 1983; GPU formulation per "GPU-Friendly Laplacian Texture Blending", JCGT 14(1), 2025 |
| `seamlessSplat` | `seamlessStamp` | variance-preserving ("histogram-preserving") blending of randomly rotated stamps — Heitz & Neyret, High-Performance Graphics 2018 |

The replacements were written from the published descriptions of those techniques,
not from Materialize's source, and share no code or algorithm with it. **No
Materialize code remains anywhere in this repository.** The unmodified GPL-3.0
originals are reachable only through git history (`git show d9abf70:js/shaders.js`).

The tool's other map-generation shaders (normal-from-height, Gaussian blur,
ambient occlusion, roughness/high-pass, height combine) were never derived from
Materialize — they are independent implementations of standard techniques. (An
earlier version of this notice over-stated the borrowing by also listing the
normal / high-pass passes; see `Path to MIT.md` for the full per-shader audit.)

---

## TgaBuilder — MIT

- Author: Jonas Nebel (JohnnyJF10)
- Source: https://github.com/JohnnyJF10/TgaBuilder
- License: MIT

The distance-field seamless-transition **algorithm** was reimplemented from
TgaBuilder's `TransitionHelper.cs` (no source code was copied verbatim; the
approach was ported to WebGL/JS). The upstream notice is preserved below as a
courtesy and for clarity of provenance:

```
MIT License

Copyright (c) 2026 Jonas Nebel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Runtime dependencies (loaded from CDN, not bundled in this repo)

These libraries are fetched at runtime from a CDN and are **not redistributed**
in this repository, so their licenses impose no bundling obligation here. They
are credited for transparency:

| Library | Use | License | Source |
|---|---|---|---|
| **Babylon.js** | 3D material preview (lazy-loaded on first 3D use) | Apache-2.0 | https://github.com/BabylonJS/Babylon.js |
| **ag-psd** | Photoshop `.psd` import + export (lazy-loaded on first PSD use, runs in a Web Worker) | MIT | https://github.com/Agamnentzar/ag-psd |
| **JSZip** | `.zip` packaging of exported maps | MIT / GPL-3.0 (dual) | https://github.com/Stuk/jszip |

The Babylon studio `.env` IBL is loaded from `assets.babylonjs.com` (Babylon.js
asset host) for preview lighting only.
