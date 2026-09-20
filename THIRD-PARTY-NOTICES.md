# Licensing & third-party notices

**TRLE Tools / Atlas Tool** — Copyright (c) 2026 KainM-77. MIT licensed.

## Licensing summary

**The repository is MIT licensed with one exception, and the exception is a
directory** — see [LICENSE](LICENSE). Every file is covered, including the
archived v1 tool in `Archive/TextureTool-v1/`, except **`AtlasTool/ten/`**, which
is TombEngine-derived and **non-commercial only**. See the TombEngine section
below.

Until **2026-09-13** the tool as a whole shipped under GPL-3.0, because two
seamless-tiling shaders were ported from Materialize (GPL-3.0) and copyleft
governed the combined program. Those two shaders have been removed; see below.

Third-party components keep their own licenses, all permissive.

---

## TombEngine — `AtlasTool/ten/` only, NON-COMMERCIAL

- Author: Tomb Engine Team
- Source: https://github.com/TombEngine/TombEngine
- License: **Modified MIT License (for non-commercial use only)**, copied verbatim to
  [`AtlasTool/ten/LICENSE`](AtlasTool/ten/LICENSE)

> Commercial use of the Software — including, but not limited to, selling, renting,
> leasing, or using it in a product or service for which you receive payment — is
> strictly prohibited.

**What is derived, and where.** Two files, both PREVIEW code:

| file | what it holds |
|---|---|
| `AtlasTool/ten/room-shading.js` | TombEngine's room lighting: `ROOM_LIGHT_COEFF` (0.7), `SPEC_FACTOR` (64), the `RoughnessToExpMul` curve, the two different distance falloffs, the dynamic light loop and the composite order, from `Rooms.hlsl` / `ShaderLight.hlsli` / `Math.hlsli` |
| `AtlasTool/ten/preview-shaders.js` | `pomPreview` and `pomPreview3D` (`ParallaxOcclusionMapping`, `Materials.hlsli:114-180`), `materialPreview` (TombEngine's Phong specular), and the two march constants |

The room shading is kept untidied on purpose: the two-branch behaviour that
disagrees with itself about specular is the engine's, and a tidied version would
stop reproducing it, which is the point of the preview.

**Nothing in that directory generates a map or touches the export.** That is what
makes it separable.

**The boundary is physical, not documentary, and separability is asserted rather
than claimed.** `AtlasTool/tools/validate-licensing.mjs` blocks every request under
`ten/` — what deleting the directory looks like to a browser — and then drives the
real tool: 40 shaders instead of 43, the atlas still slices, `generateMaps` still
produces normal, AO and roughness, the parallax preview returns `null` and warns
instead of throwing, and there are no page exceptions. **A commercial user can
delete `AtlasTool/ten/` and keep an MIT tool**, losing only the parallax previews
and the Material modal's lit composite.

**What is NOT TombEngine-derived, which is most of the Room View.** The vertex-light
bake in `AtlasTool/js/roomlight.js` was recovered by fitting Tomb Editor's own room
exports to 1e-5, not by reading the engine — and could not have been, because the
editor's bake and the engine's runtime are different light models (the editor's
point lights have no N·L term at all; the engine's do). `js/roomuv.js` was measured
off a textured export the same way. Both are plain MIT.

### What the scan found, and what is left outside

Drawing the boundary on 2026-09-20 meant scanning for it, and the scan found **four
times** what [AtlasTool/PREVIEW-FIDELITY.md](AtlasTool/PREVIEW-FIDELITY.md) §6 had
recorded: eight files, not two. That gap is the argument for enumerating an
exception rather than describing it. All of it predated the boundary and none of it
was Room View's.

**They were moved, not merely noted.** `materialPreview`, `pomPreview` and
`pomPreview3D` left `js/shaders.js` for `AtlasTool/ten/preview-shaders.js`, and
`js/engine.js` stopped carrying TombEngine's march constants. Both files are now
asserted to hold no TombEngine identifier at all.

What remains outside the directory:

| where | what | ships? |
|---|---|---|
| `AtlasTool/js/shaders.js` | one PROSE citation (`Materials.hlsli:159`) explaining why white is a height map's reference plane. A sentence about observable behaviour, not code. | yes |
| `AtlasTool/js/roomview.js` | a comment pointing at `ten/` | yes |
| `AtlasTool/js/engine.js` | one scalar, `POM_REACH_PX = 35.84` | yes |
| `AtlasTool/tools/` (5 files) | `_pom.mjs`, a node-side port of the same march, and the probes and validators using it | **no** |

`POM_REACH_PX` is the one that cannot move, and the reason is worth stating:
`heightEdgeBandFor` uses it to size the white border on an **exported** height map,
so the export path needs it and the export path must stay MIT. What is kept is a
single number describing observed output rather than a piece of the engine's code,
and [AtlasTool/HEIGHT-MAP-AUDIT.md](AtlasTool/HEIGHT-MAP-AUDIT.md) reaches the same
35.8 px by measuring rendered bleed rather than by reading anything.

`tools/validate-licensing.mjs` holds every one of these in an explicit allow-list,
with the reason and whether it ships, and **fails the suite if any further
TombEngine-derived identifier appears in code outside `AtlasTool/ten/`**. It also
fails if an allow-list entry goes stale, so the list cannot outlive what it
excuses.

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
