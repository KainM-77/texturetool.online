# Licensing & third-party notices

**TRLE Tools / Atlas Tool** — Copyright (C) 2026 KainM-77.

## Licensing summary (dual)

This project is **dual-licensed**:

- **The tool as a whole is distributed under GPL-3.0** — see [LICENSE](LICENSE).
  It has to be: the program bundles two seamless-tiling shaders derived from
  **Materialize** (GPL-3.0), and GPL-3.0 is copyleft, so the combined/running
  program is governed by GPL-3.0. Distributed WITHOUT ANY WARRANTY.
- **All original code by KainM-77 is ALSO available under the MIT License** — see
  [LICENSE-MIT](LICENSE-MIT). Every source file that is the author's own work
  carries an `SPDX-License-Identifier: MIT` header and may be extracted and reused
  under MIT. This is a genuine additional grant, not a downgrade of the GPL.
- **The only GPL-only parts** are the two seamless-tiling shaders `seamlessMaker`
  and `seamlessSplat` in `AtlasTool/js/shaders.js` (marked inline; plus their
  equivalents in the frozen root `js/shaders.js`). They stay GPL-3.0 because they
  are derived from Materialize.

In short: **copy an MIT-marked file → MIT terms; use the seamless maker/splat, or
the whole bundled tool → GPL-3.0 terms.**

---

## Materialize — GPL-3.0

- Author: BoundingBoxSoftware
- Source: https://github.com/BoundingBoxSoftware/Materialize
- License: GNU General Public License v3.0

**Exactly two** WebGL shaders in `AtlasTool/js/shaders.js` are **ported (HLSL→GLSL)**
from Materialize's `Blit_Seamless_Texture_Maker.shader`:

- `seamlessMaker` — from the `frag` pass (the Seamless Texture Maker).
- `seamlessSplat` — from the `frag_splat` pass (the "Splat" seamless method).

These are line-by-line translations and are therefore derivative of GPL-3.0 code,
which is why the combined work is GPL-3.0. The tool's other map-generation shaders
(normal-from-height, Gaussian blur, ambient occlusion, roughness/high-pass, height
combine) are **independent** implementations of standard techniques — they are
**not** derived from Materialize and are MIT-licensed. (An earlier version of this
notice over-stated the borrowing by also listing the normal / high-pass passes;
see `Path to MIT.md` for the full per-shader audit.)

---

## TgaBuilder — MIT

- Author: Jonas Nebel (JohnnyJF10)
- Source: https://github.com/JohnnyJF10/TgaBuilder
- License: MIT

The distance-field seamless-transition **algorithm** was reimplemented from
TgaBuilder's `TransitionHelper.cs` (no source code was copied verbatim; the
approach was ported to WebGL/JS). MIT is compatible with GPL-3.0, and the
upstream notice is preserved below as a courtesy and for clarity of provenance:

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
