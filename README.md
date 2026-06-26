# Texture Tool

A browser-based texture & material workbench for **Tomb Raider Level Editor
(TRLE)** and **Tomb Engine (TEN)** asset prep. Slice a texture atlas, make
elements seamless, build transitions between materials, and generate PBR
material maps (normal / ambient-occlusion / specular / roughness / height /
emissive) — all on the GPU, entirely in your browser.

**Live:** https://texturetool.online

## Features

- **Atlas cutter** — slice an atlas into elements; paste an image straight from
  the clipboard.
- **Seamless maker** — multiple methods (scattered-edge, splat, …) to remove
  visible tiling seams.
- **Transitions** — straight, curved, anchored, Wang-set, and height-driven
  transitions between two materials, with editable spline boundaries.
- **Material maps** — preset-driven PBR map generation using **Tomb Engine
  conventions** (roughness not smoothness, specular not metallic,
  OpenGL-convention normals with an optional DirectX-Y flip).
- **Multi-material painting** — paint different materials onto regions of one
  texture (brush / lasso / rectangle / ellipse / magic-wand), as ordered layers.
- **Animated textures** — procedural, seamlessly-looping animated texture sets.
- **3D preview** — optional displaced-mesh PBR preview (Babylon.js, lazy-loaded).
- **Learn page** — an in-app tutorial with before/after examples for every tool.

## Running locally

No build step, no npm, no bundler — it's plain HTML/CSS/vanilla ES6 that share
a global `TRLE` namespace. Just serve the folder over HTTP (a few features need
HTTP rather than `file://`):

```bash
python3 server.py     # http://localhost:8080  (macOS/Linux)
# or
./serve.sh
```

Then open <http://localhost:8080>.

## Browser requirements

- **WebGL 2.0** with the `EXT_color_buffer_float` and `OES_texture_float_linear`
  extensions (current Chrome / Edge / Firefox / Safari all qualify).
- A small number of libraries load at runtime from a CDN (JSZip, ag-psd, and —
  only on first use of the 3D preview — Babylon.js).

## License

**GNU General Public License v3.0 (GPL-3.0).** See [LICENSE](LICENSE).

The project is GPL-3.0 because its WebGL shaders are adapted from
[Materialize](https://github.com/BoundingBoxSoftware/Materialize) (GPL-3.0), and
its seamless-transition algorithm was reimplemented from
[TgaBuilder](https://github.com/JohnnyJF10/TgaBuilder) (MIT). Full attribution is
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
