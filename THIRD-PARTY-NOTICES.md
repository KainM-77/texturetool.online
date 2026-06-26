# Licensing & third-party notices

**TRLE Tools / Atlas Tool** — Copyright (C) 2026 KainM-77.

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU General Public License, version 3** as published by the
Free Software Foundation. See [LICENSE](LICENSE) for the full text. This program
is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.

The project is licensed under the GPL-3.0 because it contains shader code ported
and adapted from **Materialize** (see below), which is GPL-3.0. GPL-3.0 is a
copyleft license, so the combined work must also be distributed under GPL-3.0.

---

## Materialize — GPL-3.0

- Author: BoundingBoxSoftware
- Source: https://github.com/BoundingBoxSoftware/Materialize
- License: GNU General Public License v3.0

Several WebGL shaders in `js/shaders.js` (and the AtlasTool copy) are **ported /
adapted** from Materialize's `Blit_Seamless_Texture_Maker.shader` and related
passes — including the Seamless Texture Maker, the "Splat" seamless method, and
the normal / high-pass derivation passes. Because this is derivative of GPL-3.0
code, the whole project is distributed under GPL-3.0.

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
| **ag-psd** | Photoshop `.psd` export | MIT | https://github.com/Agamnentzar/ag-psd |
| **JSZip** | `.zip` packaging of exported maps | MIT / GPL-3.0 (dual) | https://github.com/Stuk/jszip |

The Babylon studio `.env` IBL is loaded from `assets.babylonjs.com` (Babylon.js
asset host) for preview lighting only.
