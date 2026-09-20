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
- **Room View** — open your atlas on real Tomb Raider room geometry, lit the way Tomb Editor
  bakes a room and shaded the way Tomb Engine draws one. Paint faces, move the bulbs, carry a
  flame around and sweep the sun through a day.
- **Learn page** — an in-app tutorial with before/after examples for every tool.
- **Demo course** — lesson-based walkthroughs that drive the real tool in a sandbox.

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
- A small number of libraries load at runtime from a CDN: JSZip up front, plus
  two that are fetched only when you first use the feature that needs them —
  ag-psd (loading or exporting `.psd`) and Babylon.js (the 3D preview).

## License

**MIT, with one directory excepted.** See [LICENSE](LICENSE). No copyleft strings.

`ten/` is derived from [TombEngine](https://github.com/TombEngine/TombEngine) and carries
TombEngine's licence: Modified MIT, **non-commercial use only** (`ten/LICENSE`). It holds the
shaders that reproduce the engine: the Room View's room lighting, the two parallax previews and
the Material modal's lit composite. Everything outside it is plain MIT and free to reuse.

Nothing in `ten/` generates a material map or touches the export, so **the directory is
separable**: delete it and you keep a working MIT tool, losing only those previews. See
`ten/README.md`.

The project was GPL-3.0 until 2026-09-13, when the two seamless-tiling shaders
adapted from [Materialize](https://github.com/BoundingBoxSoftware/Materialize)
(GPL-3.0) were removed and replaced with independent implementations of published
techniques. Its seamless-transition algorithm was reimplemented from
[TgaBuilder](https://github.com/JohnnyJF10/TgaBuilder) (MIT). Full attribution is
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
