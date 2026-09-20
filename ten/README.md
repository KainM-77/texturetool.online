# `AtlasTool/ten/` — the one part of this repository that is not MIT

**Everything in this directory is derived from [TombEngine](https://github.com/TombEngine/TombEngine)
and carries TombEngine's licence: Modified MIT, _for non-commercial use only_.** The full text is
in [LICENSE](LICENSE) beside this file. The clause that matters:

> Commercial use of the Software — including, but not limited to, selling, renting, leasing, or
> using it in a product or service for which you receive payment — is strictly prohibited.

**Every other file in the repository is plain MIT** and carries no such restriction. See
[../../LICENSE](../../LICENSE) and [../../THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

## What is in here

| file | what it is |
|---|---|
| `room-shading.js` | TombEngine's **room** lighting, as GLSL source fragments |
| `preview-shaders.js` | the three **preview** shaders that reproduce TombEngine |
| `LICENSE` | TombEngine's licence, copied verbatim |

`room-shading.js` holds the constants (`ROOM_LIGHT_COEFF`, `SPEC_FACTOR`), the roughness curve
(`RoughnessToExpMul`), the two different distance falloffs, the dynamic light loop and the order
of the final composite, from `Rooms.hlsl`, `ShaderLight.hlsli` and `Math.hlsli`.

`preview-shaders.js` holds `pomPreview` and `pomPreview3D` (TombEngine's
`ParallaxOcclusionMapping`, `Materials.hlsli:114-180`) and `materialPreview` (its Phong
specular), plus the two march constants. They lived in `../js/shaders.js` until 2026-09-20,
which put them in the shared export pipeline; moving them is what made this boundary real
rather than nominal.

**Everything here is a PREVIEW.** Nothing in this directory generates a map or touches the
export. That is what makes it separable, and separable is the whole point.

## Why it is a directory and not a comment

The boundary has to be **physical rather than documentary**, so that anyone reusing this tool can
answer "which files am I not allowed to sell" by looking at a path rather than by reading every
header. One directory, one licence, and nothing in the rest of the tool importing from it.

**`js/engine.js`, `js/shaders.js` and `js/presets.js` must never REQUIRE anything from here.**
They are shared with the export pipeline, which every other feature depends on, so a
non-commercial dependency in any of them would pull the whole tool across the line. They may
point at this directory in a comment; they may not need it to run.

### Delete this directory and the tool still works

That is the claim the whole licensing position rests on, so it is asserted rather than stated.
`../tools/validate-licensing.mjs` blocks every request under `ten/`, which is what deleting it
looks like to a browser, and then drives the real tool. Measured: **40 shaders instead of 43**,
the atlas still slices, `generateMaps` still produces normal, AO and roughness, the parallax
preview returns `null` and warns instead of throwing, and there are **no page exceptions**.

So a commercial user can delete this directory and keep an MIT tool. What they lose is the
parallax previews in the Height modal and the lit composite in the Material modal. Every
generated map, the whole export, and the tool's own correctness are untouched.

## What is NOT derived from TombEngine, and this matters

Most of the Room View was written from **measurement**, not from the engine, and stays MIT:

- **`js/roomlight.js`** — the vertex-light bake, recovered by fitting Tomb Editor's own room
  exports (`tools/fixtures/roomview/`) to 1e-5. It is not TombEngine's model and could not be:
  the editor's bake and the engine's runtime are different light models, which is the finding
  that file's header exists to record.
- **`js/roomuv.js`** — the texture-coordinate rule, measured off a textured export.
- **`js/roomview.js`** — the renderer: its own WebGL context, buffers, camera, picking, gizmo and
  markers. It declares the uniforms and assembles the shader; only the chunks it interpolates
  from here are TombEngine's.
- **`js/roomview-page.js`** — the page's own wiring.

## What is left outside, and why

Drawing this boundary meant scanning for it, and the scan found four times what
`../PREVIEW-FIDELITY.md` §6 had recorded: eight files, not two. They were dealt with rather
than merely noted, and what remains outside this directory is:

- **`../js/shaders.js`** — one PROSE citation (`Materials.hlsli:159`) explaining why white is
  the reference plane for a height map. A sentence describing observable behaviour, not code.
- **`../js/roomview.js`** — a comment pointing here.
- **`../js/engine.js`** — one scalar, `POM_REACH_PX = 35.84`, the page-pixel reach of the
  engine's march at its grazing limit. It **cannot** move here, because `heightEdgeBandFor`
  uses it to size the white border on an **exported** height map, so the export path needs it
  and the export path must stay MIT. What is kept is a number describing observed output, and
  `../HEIGHT-MAP-AUDIT.md` arrives at the same 35.8 px by measuring rendered bleed.
- **five files under `../tools/`** — development tooling, never distributed, `_pom.mjs` and
  the probes and validators that use it.

`../tools/validate-licensing.mjs` holds every one of them in an explicit allow-list with its
reason and whether it ships, fails if **any further** one appears, and fails if an entry goes
stale. `js/engine.js` and `js/presets.js` are asserted to carry no TombEngine identifier at all.

## Upstream

- TombEngine: https://github.com/TombEngine/TombEngine
- Copyright (c) 2025 Tomb Engine Team
- Licence: Modified MIT License (for non-commercial use only)
