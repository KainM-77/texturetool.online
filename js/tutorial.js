/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (C) 2026 KainM-77. This file is the author's own work,
   available under the MIT License (see LICENSE-MIT). The tool as a whole ships
   under GPL-3.0 (see LICENSE) only because it also bundles two GPL-3.0 seamless
   shaders derived from Materialize; this file contains none of that code. */
/* ============================================================
   TRLE Atlas Tool — Tutorial page
   Static, vertical-scroll reference. Each tool section shows an
   auto-crossfading "Example" + a drag-to-wipe "Test for yourself"
   (both from pre-generated before/after PNGs in tutorial-img/).
   The Materials section also has one live, interactive widget that runs
   the real WebGL engine (loaded in tutorial.html) to generate maps on
   demand; it degrades to a note if WebGL 2.0 is unavailable.

   Emphasis convention: <strong> = a literal UI control / button / option
   (rendered bold accent), <em> = conceptual emphasis (italic). Keep control
   names matching their on-screen capitalisation.
   ============================================================ */
(function () {
    'use strict';
    const IMG = 'tutorial-img/';

    /* Inherit the tool's saved theme + UI scale so the page matches. */
    (function applyPrefs() {
        let p = {};
        try { p = JSON.parse(localStorage.getItem('trle-atlas-prefs')) || {}; } catch { /* ignore */ }
        document.documentElement.dataset.theme = p.theme === 'light' ? 'light' : 'dark';
        if (typeof p.uiScale === 'number') {
            document.documentElement.style.fontSize = Math.max(11, Math.min(20, p.uiScale)) + 'px';
        }
    })();

    /* before/after → expects `${name}-before.png` + `${name}-after.png` */
    const SECTIONS = [
        {
            id: 'getting-started', icon: '🏁', title: 'Getting started',
            what: 'Every project is an <em>atlas</em> — a grid of equal-size tiles. Start from an existing atlas image or build one from scratch.',
            how: [
                'Drop an atlas image, set the <strong>Tile Size</strong>, and click <strong>Slice Atlas</strong> to cut the whole sheet; or',
                'Click <strong>Pick tiles…</strong> to set a grid and choose exactly which cells to import — rip one texture, grab several, or stitch from multiple atlases (each cell is resized to your tile size). Add more later with <strong>Import from Atlas…</strong>.',
                'Or click <strong>Create Blank Atlas</strong> (choose tile size + columns), then add textures with <strong>Add Image(s)</strong>, <strong>Add Blank</strong>, or the <strong>＋</strong> cell.',
                'You can also <strong>paste an image</strong> (Ctrl/Cmd+V) from your clipboard — confirm, then slice it like an imported atlas.',
                'Each tile is an element you can <strong>right-click</strong> to edit.'
            ],
            tip: 'Everything is non-destructive and fully undoable (<strong>Ctrl/Cmd+Z</strong>). <strong>Pick tiles…</strong> and <strong>Import from Atlas…</strong> append to the current atlas, so you can build one up from several sources.'
        },
        {
            id: 'grid-basics', icon: '🖱️', title: 'Working with the grid',
            what: 'The grid is keyboard- and mouse-friendly. <strong>Right-click</strong> (or focus a tile and press the <strong>Menu</strong> key) for its actions.',
            how: [
                'Arrow keys move focus, <strong>Enter</strong>/<strong>Space</strong> select; <strong>S</strong>/<strong>T</strong>/<strong>M</strong>/<strong>H</strong> trigger Seamless / Transition / Material / Heal.',
                '<strong>Drag</strong> tiles to reorder, or <strong>Ctrl/Cmd+←/→</strong> to nudge; change <strong>Columns</strong> / <strong>Rows</strong> to reflow the whole atlas.',
                '<strong>Replace Image</strong> (right-click) swaps a tile’s texture; <strong>Reset to Original</strong> reverts it.',
                'Remove a tile with right-click → <strong>Delete…</strong> (or press <strong>Delete</strong> on a focused tile); to clear several at once, select them (see below) and hit <strong>Delete</strong> on the bulk bar.',
                '<strong>Undo</strong> / <strong>Redo</strong> sit in the grid header (<strong>Ctrl/Cmd+Z</strong>, <strong>Ctrl/Cmd+Shift+Z</strong>); the <strong>History</strong> panel on the right lists every step — click one to jump back.'
            ],
            tip: 'Deleting a tile that other transitions are built on also removes those transitions (you’re warned first, and it’s fully undoable). Status messages appear in the log on the left, and transition tiles always stay after their source tiles automatically.'
        },
        {
            id: 'batch-select', icon: '☑️', title: 'Select & batch-edit tiles',
            what: 'Work on many tiles at once — like selecting icons on a desktop. Pick a group of tiles and a <strong>bulk-action bar</strong> appears so you can material, reorder, group or delete them together.',
            how: [
                '<strong>Click</strong> a tile to select it; <strong>Ctrl/Cmd+click</strong> to add or remove individual tiles; <strong>Shift+click</strong> to select a whole range.',
                '<strong>Drag a box</strong> across the grid background to rubber-band several tiles at once. <strong>Ctrl/Cmd+A</strong> selects everything; <strong>Esc</strong> clears.',
                'With 2+ selected, use the bar: <strong>🎨 Apply Material</strong> (set one material on all of them — saved ⭐ presets included), <strong>🧲 Group together</strong> (gather them side-by-side), <strong>⏮ To front</strong> / <strong>To back ⏭</strong>, or <strong>🗑️ Delete</strong>.'
            ],
            tip: '<strong>Apply Material</strong> skips transition tiles (they inherit from their sources). <strong>Group together</strong> and the reorder buttons keep animation frames and transitions in their required order automatically. Everything here is one undo step.'
        },
        {
            id: 'seamless', icon: '🔄', title: 'Make Seamless',
            what: 'Removes the visible seam when a texture is tiled, so it repeats cleanly across a surface.',
            how: ['<strong>Right-click</strong> a tile → <strong>Make Seamless</strong>.', 'Pick a method (<strong>Scattered edges</strong> is the all-rounder) and the blend radius.', 'Click <strong>Save to Atlas</strong> — the tile updates in place and any transitions using it refresh.'],
            gallery: [
                { src: 'seamless-orig.png', cap: 'Original (tiled — see the seam)' },
                { src: 'seamless-pan.gif', cap: 'Scattered edges 20% — tiles seamlessly' },
                { src: 'seamless-blend.png', cap: 'Blend radius 100%' },
                { src: 'seamless-final.png', cap: 'Finished tile' }
            ],
            tip: 'The 2×2 tilings show the centre cross, where seams appear. The GIF pans across the tiled result — a seamless tile has no visible repeat line. A higher blend radius hides the seam harder but softens detail, so dial it back if the texture goes muddy.'
        },
        {
            id: 'transitions', icon: '🔀', title: 'Transitions',
            what: 'Blends two textures along an edge or corner so terrain types meet without a hard line.',
            how: ['<strong>Right-click</strong> tile A → <strong>Make Transition with Texture</strong>, then click tile B.', 'Choose <strong>Directions</strong> (or paint a <strong>Custom</strong> mask) and a <strong>Blend method</strong>.', 'Re-orient the overlay (B) with <strong>Rotate</strong> / <strong>Flip</strong> if needed, then click <strong>Add</strong> — one tile per direction.'],
            before: 'transition',
            tip: 'Blend methods: <strong>Alpha</strong> (cross-fade), <strong>Height</strong> (organic interlock), <strong>Poisson</strong> (matches tone when the two differ in brightness). Or switch to the <strong>Full Set</strong> tab (below) to generate a whole patch at once.'
        },
        {
            id: 'transition-sets', icon: '🧱', title: 'Transition sets (full patch)',
            what: 'The <strong>Full Set</strong> tab of Make Transition builds a whole terrain patch in one step and lays it into the atlas <em>spatially</em> — so the arrangement itself shows how the pieces fit, and you can see exactly which tile you’re picking in Tomb Editor. Reach for it when you want a ready-made island, hole or complete set rather than hand-picking single edges.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Transition with Texture</strong>, click tile B, then switch to the <strong>🧩 Full Set</strong> tab.',
                'Pick a <strong>Set layout</strong>: <strong>3×3 Island</strong> (a pocket of the overlay surrounded by the base), <strong>3×3 Hole</strong> (a window of the base inside the overlay), or <strong>5×3 Complete</strong> (island + hole + plain tiles together).',
                'Choose a <strong>Corner style</strong> — <strong>Rounded</strong> (curved blend) or <strong>Sharp 45°</strong> (a clean slope cut) — then shape every edge with <strong>Pivot</strong>, <strong>Hardness</strong> and the <strong>Blend method</strong>. The preview updates as one connected patch.',
                'Click <strong>Add … Tiles</strong>. If the atlas isn’t already the right width, it offers to <strong>resize the columns</strong> (padding the last row with blank spacers) so the block drops in keeping the exact preview shape.'
            ],
            figure: 'transition-set', figureCaption: 'A 3×3 Island set: full overlay (sand) in the centre, the four edges blending outward, and the corners pulling the overlay toward the middle — so the nine tiles read as one sand pocket in a grass field, exactly as they’re laid into the atlas.',
            tip: 'Plain cells (the base/overlay fills in the Complete layout) stay <em>linked</em> to their source tiles, so they still inherit materials and refresh when you edit the source — they’re not flat copies. For an overlay that must flow in every direction at once, use a <strong>Wang set</strong> instead.'
        },
        {
            id: 'wang', icon: '🧩', title: 'Wang sets',
            what: 'Generates the full 16-tile edge set so an overlay terrain connects in every up/down/left/right combination. <strong>Use a Wang set when an overlay needs to flow freely in any direction</strong> across a floor or wall — sand drifting over grass, water pooling on stone — so you can paint the boundary in unpredictable shapes and the tiles still join up. For a single straight or curved seam, a plain Transition or Anchored Transition is simpler; reach for Wang when you need every edge combination on hand.',
            how: ['<strong>Right-click</strong> tile A → <strong>Make Wang Set with Texture</strong>, then click tile B.', 'Set the <strong>Blend method</strong>, <strong>Pivot</strong> and <strong>Hardness</strong> — corners blend smoothly (no diagonal crease) and <strong>Hardness</strong> sets the seam width (0 = wide soft blend, 100 = crisp cut).', 'Click <strong>Add 16 Tiles</strong> — drop the whole set into your level’s palette.'],
            figure: 'wang-geo', figureCaption: 'A full grass→sand Wang set, laid out by where each edge sits: grass in the centre, sand creeping in from each side, and the corners blending two sides at once — so the 9 tiles form one coherent grass patch surrounded by sand.',
            tip: 'Wang tiles inherit materials from both sources, just like transitions.'
        },
        {
            id: 'borderset', icon: '🧱', title: 'Borders & corners (border sets)',
            what: 'Builds a <em>reusable border tile set</em> from just two textures: a <strong>fill</strong> (grass, gravel, carpet) and a <strong>trim</strong> that runs along the boundary — stone edging, rope, a door frame. You get every edge, corner and fill piece needed to outline rooms and areas of any rectilinear shape, laid into the atlas as a readable block. Where a <strong>Wang set</strong> blends two terrains into each other, a border set keeps the trim as a crisp, decorative band <em>on top of</em> the fill.',
            how: [
                '<strong>Right-click</strong> the fill tile → <strong>🧱 Add Borders &amp; Corners</strong>, then click the trim texture.',
                'Pick a <strong>Set type</strong>: <strong>Frame</strong> (9 tiles — border around filled rectangles), <strong>Frame + inner corners</strong> (13 tiles — the border can also turn through concave corners, so <em>any</em> room shape works), or <strong>Lines</strong> (16 tiles — the trim runs <em>between</em> areas through tile centres, pipes/roads style, in every N/E/S/W combination).',
                'Tune the <strong>Border width</strong> and <strong>Softness</strong>, and pick a <strong>Blend method</strong>. <strong>Trim follows direction</strong> rotates the trim texture along vertical runs and mitres the corners like a picture frame — untick it for isotropic trims (gravel, dirt).',
                'The <strong>Sample wall</strong> shows the whole set assembled into a room so you can check the joins before adding. If a slot looks wrong — usually baked lighting fighting a rotated edge — <strong>click it</strong> to cycle how it’s made: own mask → rotated ↻ → mirrored ↔/↕ → hand-picked atlas tile 🖼.',
                'Click <strong>Add … Tiles</strong> — the set drops in as a spatial block (with a column-resize offer so it lines up), ready to place in Tomb Editor.'
            ],
            figure: 'borderset-modal', figureCaption: 'A grass + sand border set (Frame + inner corners): the 13 slots on the left — edges, outer corners, fill and the four inner-corner patches — and the sample wall on the right showing the set assembled into an L-shaped room, the trim turning cleanly through the concave corner.',
            tip: 'Border-set tiles are live transitions: they inherit materials from both sources and re-render when you edit either texture (make the fill seamless <em>first</em> for best results). The trim sits on the tile edges, so two bordered rooms placed side by side share a double-width band — exactly how classic TRLE border sets read.'
        },
        {
            id: 'anchored', icon: '📐', title: 'Anchored transitions',
            what: 'Like a transition, but the border between the two textures is a chain of <em>movable anchors</em> — so you can bend the seam into ridges, coastlines or any custom shape instead of a straight edge.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Anchored Transition</strong>, then click tile B.',
                'Start from a preset, then <strong>drag</strong> an anchor, <strong>click</strong> empty space to add one, or <strong>right-click</strong> an anchor to remove it.',
                'Pick the <strong>Border axis</strong>, <strong>Swap sides</strong>, set the <strong>Edge hardness</strong> and a <strong>Blend method</strong>, then click <strong>Add Transition Tile</strong>.',
                'Re-orient the overlay (B) with <strong>Rotate</strong> / <strong>Flip</strong>, and tick <strong>Hide handles</strong> to preview without the anchor dots in the way.',
                '<strong>Scroll the wheel</strong> over an anchor to cycle its curve (straight → bow out → bow in), or <strong>double-click</strong> it to toggle a curve and <strong>middle-drag</strong> the handle to fine-tune the bend — great for organic, flowing borders.',
                'Raise <strong>🌿 Organic edge</strong> to warp the whole seam into a ragged, natural line (<strong>🎲</strong> rerolls the pattern).'
            ],
            figure: 'anchored-modal', figureCaption: 'The Anchored Transition editor: drag the white anchor dots along the A→B border, click empty space to add one, right-click to remove, and scroll over an anchor to curve it.',
            tip: 'It exports as a normal transition tile (a custom mask), so it composites, saves and undoes exactly like the others.'
        },
        {
            id: 'transgrid', icon: '🗺️', title: 'Transition grids',
            what: 'Designs one continuous A→B border across a whole multi-tile wall, then slices it into tiles that connect seamlessly — perfect for, say, water creeping up a 3×3 stone wall.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Transition Grid</strong>, then click tile B.',
                'Set <strong>Columns × Rows</strong> to match the wall, pick a start preset, then <strong>drag</strong> the anchors — the border flows across cell edges, so neighbours always line up. <strong>Scroll</strong> the wheel over an anchor to cycle its curve (straight → bow out → bow in).',
                'Switch the <strong>Tool</strong> to <strong>Add patch</strong> or <strong>Carve patch</strong> and <strong>drag</strong> to drop a circular patch of the overlay into any single cell (scroll over it to resize, right-click to remove) — or tick <strong>Stamps only</strong> to skip the A→B border entirely and place free-floating islands, like a puddle inside one cell.',
                'Raise <strong>🌿 Organic edge</strong> to warp the whole border into a ragged, natural line (<strong>🎲</strong> rerolls the pattern); the warp is applied across the full wall before slicing, so cells still line up.',
                'Click <strong>Add … Tiles</strong> to drop one transition tile per cell into the atlas (use the <strong>Alpha</strong> blend to keep the seam continuous between cells).'
            ],
            figure: 'transgrid-modal', figureCaption: 'The Transition Grid: set Columns × Rows, drag the border anchors across the whole wall, switch the Tool to drop patch stamps into a single cell, or raise Organic edge for a ragged border.',
            tip: 'Lay the exported tiles out in the same Columns×Rows arrangement in your level and the transition reads as one continuous surface.'
        },
        {
            id: 'organic', icon: '🌿', title: 'Organic transitions',
            what: 'Scatters one texture into another as <em>organic, noise-driven patches</em> instead of a clean line — grass breaking up into sand, moss creeping over stone — and generates several random <em>variations</em> from a seed so no two tiles repeat.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Organic Transition</strong>, then click tile B.',
                'Optionally <strong>paint a hint</strong> on tile A to steer where the overlay lands (or leave it blank for a fully random scatter); tune <strong>Coverage</strong>, <strong>Patch size</strong> and <strong>Roughness</strong>.',
                'Choose how many <strong>Variations</strong> to generate, <strong>🎲 Randomize</strong> or type a <strong>Seed</strong>, then click the previews to pick which ones to keep and press <strong>Add … Tiles</strong>.',
                'Use the <strong>Seamless sides</strong> box to choose <em>which</em> edges stay seamless: click a side-segment to toggle it (lit = the overlay is held back from that edge so it tiles cleanly, dim = patches may reach it). Split each side into more segments for finer control, and set the <strong>Threshold</strong> for how far in from the border the fade reaches.'
            ],
            before: 'organic',
            tip: 'Per-side seamless control lets you, say, keep only the top and left edges tileable while the bottom-right blends freely. Each kept variation is a normal transition tile that inherits both sources’ materials.'
        },
        {
            id: 'heighttrans', icon: '🏔️', title: 'Height transitions',
            what: 'Blends two textures by their <em>height</em> instead of a drawn line: the overlay settles into the <strong>low ground</strong> (mortar joints, cracks) or caps the <strong>high ground</strong> (stones poking through). Perfect for sand pooling between Roman cobbles, or laying stone tiles over grass so the grass shows in the gaps. Because the joints sink in, the generated normal / AO / height maps get real depth for free.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Height Transition</strong>, then click the overlay texture B.',
                'Pick a <strong>Preset</strong> (Sand in the joints, Stones over grass, Snow on ledges, Water in cracks…). Each sets <strong>Height from</strong> (Base or Overlay) × <strong>Fills</strong> (Low/High) plus the level and a suggested overlay material — leave <strong>Assign … material</strong> ticked so the fill’s PBR maps read correctly.',
                'Tune the <strong>Fill level</strong> and <strong>Edge hardness</strong>; open <strong>⛰️ Height field</strong> to set how much <strong>Detail</strong> vs broad shape the height keys off.',
                'Layer in variation: <strong>🌿 Organic breakup</strong> (+🎲) wobbles the fill edges; the <strong>📈 Response curve</strong> reshapes how abruptly the overlay appears as height drops; <strong>🗺️ Spatial drift</strong> makes the fill drift deeper toward one side (a “tide line”) or masks it to a region.',
                'Click <strong>Add Transition Tile</strong>. Later, <strong>right-click → Edit Height Transition</strong> to reopen the exact recipe and tweak it in place.'
            ],
            before: 'heighttrans',
            tip: 'Works best on textures with real relief (cobble/brick flooring). The whole recipe is stored on the tile, so it survives undo and project save and stays fully re-editable.'
        },
        {
            id: 'heal', icon: '🩹', title: 'Heal / Fill',
            what: 'Paints out blemishes, logos or scratches by filling the area with surrounding colour or re-synthesised texture.',
            how: ['<strong>Right-click</strong> a tile → <strong>Heal / Fill</strong>.', 'Paint over the <em>whole</em> blemish so the selection touches clean texture on every side.', 'Pick <strong>Neighbour-aware</strong> (default), <strong>Texture</strong> (whole-tile synthesis) or <strong>Smooth</strong> (diffusion), click <strong>Preview Fill</strong>, then <strong>Save to Tile</strong>.'],
            before: 'heal', tip: '<strong>Neighbour-aware</strong> matches the local tone, so a dark mark on a light surface heals light (and vice-versa) instead of going grey — just be sure to paint over the entire mark.'
        },
        {
            id: 'transforms', icon: '↻', title: 'Transforms',
            what: 'Quick per-tile geometry: rotate 90°, flip, or offset (roll) to move seams to the centre for healing.',
            how: ['<strong>Right-click</strong> a tile → <strong>Rotate 90°</strong>, <strong>Flip Horizontal</strong> / <strong>Vertical</strong>, or <strong>Offset ½</strong>.', 'Each is instant and undoable.'],
            slideshow: 'Examples/Bricks.png', tip: '<strong>Offset ½</strong> then <strong>Heal</strong> is a fast way to kill a stubborn seam. (The demo above cycles through the transforms automatically — hover to pause.)'
        },
        {
            id: 'delight', icon: '☀', title: 'De-light',
            what: 'Flattens baked-in lighting (sun, shadows) so a found texture reacts correctly to Tomb Engine’s dynamic lights.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>De-light</strong>.',
                'Choose <strong>Whole texture</strong> to flatten all baked lighting (set the <strong>Strength</strong>), or <strong>Paint shadow → inpaint</strong> to brush over a single baked shadow and replace just that area with the surrounding texture.'
            ],
            before: 'delight', tip: 'Do this before generating material maps from photo textures. Use the paint-shadow mode when only one cast shadow needs removing and the rest of the lighting is fine.'
        },
        {
            id: 'colour', icon: '🎚', title: 'Colour adjust & recolour',
            what: 'Two ways to re-grade a tile’s colours — handy for rebalancing a preset that blows out, or matching a texture to a level’s palette.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Adjust Colours</strong> for manual control: <strong>Hue</strong>, <strong>Saturation</strong>, <strong>Brightness</strong>, <strong>Contrast</strong>, <strong>Gamma</strong>, <strong>Temperature</strong> / <strong>Tint</strong> and <strong>Vibrance</strong>, with a live preview.',
                '<strong>Right-click</strong> a tile → <strong>Recolor from Texture</strong>, then click a reference tile — its colour palette is sampled and this tile is shifted toward it. Tune <strong>Strength</strong> and the light grade, then <strong>Apply</strong>.'
            ],
            gallery: [
                { src: 'recolor-before.png', cap: 'Original tile' },
                { src: 'recolor-ref.png', cap: 'Reference (Grass)' },
                { src: 'recolor-after.png', cap: 'Recoloured to match' }
            ],
            tip: 'Recolor uses mean / standard-deviation transfer, so it matches the overall tone of the reference rather than copying it pixel-for-pixel — great for making mismatched textures sit together. Above, a stone tile is shifted toward the grass palette.'
        },
        {
            id: 'variations', icon: '✨', title: 'Variations',
            what: 'Creates jittered copies (hue / brightness / rotation) to break up obvious repetition across a wall or floor.',
            how: ['<strong>Right-click</strong> a tile → <strong>Generate Variations</strong>.', 'Set the count and jitter, <strong>Shuffle</strong> to taste, then click <strong>Add</strong>.'],
            before: 'variations', tip: 'Each variation is a fresh source tile you can edit independently.'
        },
        {
            id: 'buildpattern', icon: '🏗️', title: 'Build Pattern',
            what: 'Turns a plain material — stone, sand, metal, timber — into a <em>built surface</em>: a <strong>brick wall</strong>, <strong>coursed</strong> or <strong>cobbled stone</strong>, a <strong>tile floor</strong>, a <strong>herringbone</strong> weave, <strong>wood planks</strong>, a staggered <strong>plank floor</strong>, roof <strong>shingles / scales</strong> or <strong>metal pipes</strong>. It lays the source into cells split by recessed joints so the result is one fresh tile that <strong>tiles seamlessly</strong>, and because the dark joints sink in, the generated normal / AO / height maps get real depth for free.',
            how: [
                '<strong>Right-click</strong> a source tile → <strong>🏗️ Build Pattern</strong>.',
                'Pick a <strong>Pattern</strong> — regular <strong>Brick</strong>, random <strong>Coursed stone</strong> (varied course heights &amp; stone widths, like ashlar rubble), <strong>Cobblestone</strong> (rounded Voronoi stones with mortar), <strong>Tile</strong>, <strong>Herringbone</strong>, <strong>Planks</strong>, <strong>Plank floor</strong> (boards with staggered butt-joints), <strong>Shingles / scales</strong>, or <strong>Pipes</strong> — and a <strong>Fill</strong>: <strong>Slice</strong> gives each cell a different random crop (most variation); <strong>Overlay</strong> lets the whole texture flow unbroken with just the joints carved over it; <strong>Random from atlas tiles</strong> gives each brick a random <em>different</em> tile from your atlas (mix stone &amp; grass bricks, say).',
                'Set the cell count and joint <strong>width</strong>. Per pattern you also get: brick <strong>aspect</strong> &amp; <strong>row offset</strong> (50% = running bond, 0% = stacked); coursed <strong>course flatness</strong>; cobble <strong>stone roundness</strong>; shingle <strong>overlap</strong>; plank-floor <strong>board length</strong>; a <strong>direction</strong> for planks / floor / herringbone / pipes; and a pipe <strong>cylinder-shading</strong> amount.',
                'Open <strong>🧱 Mortar / joint colour</strong> to set the mortar by <strong>Hue / Saturation / Lightness</strong>, <strong>🎨 Sample from texture</strong> to pull a darker tint of the source’s own colour, and add <strong>Noise</strong> (Speckle / Grain / Clouds) so the joints aren’t flat.',
                'Add <strong>hue</strong> / <strong>brightness jitter</strong> so cells vary, reroll the <strong>Seed</strong> (<strong>🎲</strong>) until you like it — the preview updates live — then leave <strong>Assign … material preset</strong> ticked and click <strong>➕ Add Tile</strong>.'
            ],
            before: 'buildpattern',
            tip: 'The output already tiles, so you usually don’t need Make Seamless afterwards. Joints come from the diffuse, so darker / noisier mortar automatically deepens and roughens the recesses in the height/normal maps. Overlay fill tiles best from an already-seamless source.'
        },
        {
            id: 'animated', icon: '🎞️', title: 'Animated textures',
            what: 'Generates a procedural, seamlessly-<em>looping</em> animation — water, lava, clouds, smoke, energy, plus directional effects like <strong>fire, waterfalls and rivers</strong> — as a group of frames you drop straight into the atlas. There’s a wide preset library (caustic/deep/boiling water, lava &amp; molten metal, blood, ice, mercury, honey, poison gas, steam, electric plasma, aurora sky…). Every frame also tiles on its own, so you can emit a <strong>single seamless tile</strong> for UV-rotate instead of a sequence.',
            how: [
                'Click <strong>🎞️ Add Animated…</strong> in the grid header.',
                'Pick a <strong>Preset</strong> (Caustic Water, Lava, Clouds, Blood Pool, Frozen Ice, Steam, Electric Plasma, Aurora Sky…). The live preview loops while the 2×2 panel shows it tiling, and a <strong>Suggested material</strong> is applied automatically (emissive presets also switch the <strong>Emissive</strong> export map on).',
                'On the <strong>🌀 Shape &amp; motion</strong> tab choose the <strong>Output</strong>: an <strong>Animated sequence</strong> (set <strong>Frames</strong>, 2–64) or a <strong>Single seamless tile</strong> for UV-rotate. Shape the look with <strong>Style</strong>, <strong>Pattern scale</strong>, <strong>Churn speed</strong>, <strong>Detail</strong>, <strong>Roughness</strong>, <strong>Swirl</strong>, <strong>Contrast</strong> and the <strong>Seed</strong> (<strong>🎲</strong> rerolls).',
                'For things that <em>travel</em> rather than churn in place, set a <strong>Flow direction</strong> (↑↓←→ or diagonals) and <strong>Flow speed</strong> — the field scrolls that way while staying perfectly seamless and looping. <strong>Stretch ↕</strong> elongates the pattern into vertical streaks; together they make fire, waterfalls, rivers, rising smoke and blowing sand (see those presets).',
                'On the <strong>🎨 Colour</strong> tab pick a <strong>Gradient</strong> (mix any palette onto any structure — clouds shape with a lava palette, say), then micro-edit it: <strong>click the bar</strong> to add a colour stop, <strong>drag</strong> handles to move them, and click a stop to set its colour &amp; <strong>alpha</strong> (for transparent smoke/dust). The <strong>Hue / Saturation / Brightness / Contrast / Gamma / Posterize</strong> sliders and <strong>Invert</strong> re-grade the whole ramp.',
                'Click <strong>Add … Frames</strong> — they’re appended as a group (purple <strong>A</strong> badge). <strong>Right-click</strong> any frame → <strong>Edit Animation…</strong> to regenerate, recolour or change the frame count in place.'
            ],
            before: 'anim',
            gallery: [
                { src: 'lava-still.png', cap: 'Lava — one frame' },
                { src: 'lava-anim.gif', cap: 'Animated, looping' },
                { src: 'lava-emissive.png', cap: 'Emissive map — one frame' },
                { src: 'lava-emissive.gif', cap: 'Emissive, looping' }
            ],
            tip: 'Frames are kept consecutive and loop (last → first). The exported <code>manifest.json</code> lists each animation’s tile range, gradient + fps, so you can set it up as an <em>animated texture range</em> (or <em>UV-Rotate</em>) in Tomb Editor. Deleting one frame removes the whole group, and animations — including any custom gradient — are saved/restored with your project.'
        },
        {
            id: 'materials', icon: '🎨', title: 'Materials (PBR)',
            what: 'Assigns a material so the tile exports Normal / AO / Specular / Roughness (and more) maps for Tomb Engine.',
            how: ['<strong>Right-click</strong> a tile → <strong>Set Material</strong>.', 'Pick an aesthetic (<strong>Realistic</strong>, <strong>Decal</strong> for thin transparent surfaces like cobwebs/dust/leaves, <strong>Fantasy</strong>, …) and a preset, or tweak the advanced sliders.', '<strong>Drag</strong> the lit preview to move the light and check how it reads.', 'In <strong>Export</strong>, tick which maps to generate. The <strong>Height</strong> map drives parallax — it’s GPU-heavy, so prefer it per-texture; when it’s on, keep <strong>Seamless height edges</strong> ticked so a tiling texture doesn’t show a parallax “cliff” where it repeats.'],
            before: 'materials', widget: 'maps',
            tip: '<strong>Decal</strong> presets keep maps flat where the texture is transparent, so the decal’s edges don’t get embossed. Transition &amp; Wang tiles inherit materials from their sources. <strong>Seamless height edges</strong> blurs just the height map’s border toward the wrap so opposite edges meet flush — the interior relief is untouched.'
        },
        {
            id: 'saved-materials', icon: '⭐', title: 'Save & reuse materials',
            what: 'Dial in a material once — a preset plus any advanced-slider tweaks — then <strong>save it as your own preset</strong> and reapply it to any tile, in this project or the next. No more re-tuning the same sandstone on every batch.',
            how: [
                'In <strong>Set Material</strong>, pick a preset and tweak the sliders until it reads right, then click <strong>⭐ Save as preset…</strong> and give it a name.',
                'Your presets live under the <strong>⭐ My presets</strong> aesthetic — pick one and <strong>Assign Material</strong> to apply it to a tile. <strong>Rename</strong> or <strong>Delete</strong> from the same bar.',
                'Use <strong>⬇ Export</strong> to save your whole preset set to a JSON file, and <strong>⬆ Import</strong> to load it on another machine or share it with your team.'
            ],
            tip: 'Saved presets are <em>baked into</em> the tile when you assign them, so a tile keeps its look even if you later edit or delete the preset. Presets are stored in your browser — <strong>Export</strong> them if you want a backup.'
        },
        {
            id: 'multi-material', icon: '🎭', title: 'Multiple materials on one tile',
            what: 'A single texture often mixes surfaces — a wall that is <strong>brick + a wooden door + a metal knob</strong>. Multi-material lets you paint a different material onto each region, so the brick reads as stone, the door as wood and the knob as metal in one tile.',
            how: [
                'In <strong>Set Material</strong>, tick <strong>🎭 Multiple materials</strong>. The <strong>Base</strong> layer covers the whole tile — set its material (e.g. Brick) with the normal controls.',
                '<strong>＋ Add layer</strong> for each extra surface, then <strong>select where it applies</strong> on the texture: <strong>🖌 Brush</strong>, <strong>🪢 Lasso</strong> (click points, double-click/Enter to close), <strong>▭ Rect</strong> / <strong>⬭ Ellipse</strong> (drag a shape), or <strong>🪄 Wand</strong> (click a colour to grab similar pixels — raise <em>Tol</em> to select more, untick <em>Contiguous</em> to grab them tile-wide). With a layer selected, the material controls below edit <em>that</em> layer.',
                '<strong>Order matters</strong> — layers stack bottom→top, each painting over the ones beneath. For a wall it’s <em>Base = Brick → Wooden door → Metal knob</em>. Reorder with ▲▼, soften a boundary with <strong>Feather</strong>, then <strong>Assign</strong>.'
            ],
            tip: 'The lit preview and 🧊 3D preview show the <em>composited</em> result as you paint, so you can see brick meet wood meet metal. Transition/Wang tiles inherit materials and so don’t take layers. Each tile’s layers are saved in your project file.'
        },
        {
            id: 'transparency', icon: '🫥', title: 'Transparency & decals',
            what: 'Author transparent textures — cobwebs, dust, leaves, foliage — that fade into a surface instead of ending at a hard edge, and export them so Tomb Engine / Tomb Editor render the transparency.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Fade to Transparent</strong>; choose <strong>Edges</strong> (vignette), a <strong>Direction / slope</strong>, or paint a <strong>Custom</strong> area, then click <strong>Apply Fade</strong>.',
                'Transitions and Wang sets preserve alpha too — blending a transparent texture stays transparent.',
                'In <strong>Export</strong>, pick <strong>PNG</strong> or <strong>TGA</strong> to keep real alpha, or tick <strong>Magenta color-key</strong> for classic Tomb Editor.'
            ],
            gallery: [
                { src: 'transparency-before.png', cap: 'Leaf tile (opaque)' },
                { src: 'transparency-after.png', cap: 'Faded edges → transparent', checker: true }
            ],
            tip: 'The fade preview’s checkerboard shows exactly where the tile has become transparent — above, the leaves fade out at the edges so the foliage blends onto a wall instead of ending in a hard square.'
        },
        {
            id: 'emissive', icon: '✨', title: 'Emissive (glow)',
            what: 'Authors a glow map so parts of a tile shine on their own — lava, neon, runes, screens, lit windows — independent of scene lighting.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Make Emissive</strong>.',
                'Choose what glows: <strong>Pick a colour</strong> (eyedrop the preview), a <strong>Hue range</strong>, <strong>Bright areas</strong>, or <strong>Paint</strong> it by hand.',
                'Colour it with the <strong>Texture’s own colours</strong> or a flat <strong>Tint</strong>, set <strong>Strength</strong> and <strong>Feather / bloom</strong>, then click <strong>Apply</strong> — the <strong>Emissive</strong> export map switches on automatically.'
            ],
            before: 'emissive',
            tip: 'The preview sits on black because emissive is what you still see in the dark. Most materials glow nowhere — use it only for light sources and effects.'
        },
        {
            id: 'export', icon: '📦', title: 'Export & projects',
            what: 'Export the diffuse atlas plus a matching atlas per material map, in your chosen format, or save your whole session to resume later.',
            how: [
                'Pick the maps, a <strong>Format</strong> (<strong>PNG</strong> keeps transparency · <strong>TGA</strong> 32-bit · <strong>PSD</strong> packs the diffuse + every map as layers), and an <strong>Export layout</strong> (<strong>Flat ZIP</strong> or <strong>TombEngine</strong> <code>Textures/</code>).',
                'Transparent textures export with real alpha; tick <strong>Magenta color-key</strong> to flatten transparent pixels to magenta (which Tomb Editor renders as invisible).',
                'Click <strong>Export Atlas with Material Maps</strong> for a ZIP (atlas + maps + manifest); <strong>Save Project</strong> / <strong>Load Project</strong> keeps every tile, material and transition.',
                'To edit tiles elsewhere, use <strong>Export Tiles Individually</strong> (one image per tile + any enabled maps, named <code>tile_r{row}_c{col}</code>), or right-click a single tile → <strong>Download PNG</strong>; bring edits back with <strong>Replace Image</strong>.'
            ],
            tip: 'Use PNG/TGA alpha for Tomb Engine; use the magenta key for classic Tomb Editor workflows.'
        },
        {
            id: 'accessibility', icon: '♿', title: 'Accessibility',
            what: 'The header has a <strong>Font size</strong> control (A− / A / A+) and a <strong>Dark / light mode</strong> toggle. Both persist — and this tutorial follows them too.',
            how: ['Use the <strong>Font size</strong> and <strong>Dark / light mode</strong> controls (top-right of the tool).', 'Everything is keyboard-navigable with visible focus rings.'],
            tip: ''
        }
    ];

    /* About / colophon — shown after the tutorial, behind a clear divider.
       Author's own words, only grouped under headings (kept verbatim). */
    const ABOUT = [
        {
            id: 'about', icon: '🧭', title: 'About Atlas Tool',
            html: `<p>Atlas Tool is a tool I made while facing problems during crossplatform levelbuilding and tool using. I got the idea to make it whilst learning materials for Tomb Engine usage. I tried to combine batch material making from a Materialize fork with PowerShell scripts.</p>
                   <p>Potato wise, it was really difficult to run Photoshop, Illustrator or the alternatives (Photopea, Affinity) together with Blender and with multiple browser tabs, especially because I had to allocate resources to Windows emulators too.</p>`
        },
        {
            id: 'about-what', icon: '🧰', title: 'What it does',
            html: `<p>The result is a web based tool utilizing WebGL which allows you to do the usual builder stuff within browser either to "feel things out" or utilize for the final version of your level:</p>
                   <ul class="tut-how">
                       <li>cut up texture atlases</li>
                       <li>rearrange texture atlases</li>
                       <li>make textures seamless</li>
                       <li>make texture transitions, including different materials</li>
                       <li>appoint material presets or manually adjust materials</li>
                       <li>debake lighting from textures which have baked shadows</li>
                       <li>export textures with atlases and so on...</li>
                   </ul>
                   <p>This allows for quicker style unit testing if you want to feel a concept out and don't want to spend an hour or two jumping from tool to tool.</p>`
        },
        {
            id: 'about-limits', icon: '⚖️', title: 'Limitations',
            html: `<p>This tool is trying to be as GRID optimized as possible and sacrafices for example materials map functionalities for the sake of being avaliable on web and not being resource heavy. You will always have more micromanaging options and better results if you decide to use dedicated tools for these tasks. I'm not sure how far I'll push the tool but there is a limit since it could just turn into Photoshop and then what's the point :D</p>
                   <p>For example, presets I made for materials is what looked good to me on a couple of textures. Sandstone, marbley and clay bricks look nice but darker ones get blown out so you need to manually adjust them etc.</p>
                   <p>Pushing hardness too hard will make you lose seamlessness etc.</p>`
        },
        {
            id: 'about-thanks', icon: '🙏', title: 'Research & thanks',
            html: `<p><a href="https://github.com/BoundingBoxSoftware/Materialize" target="_blank" rel="noopener"><strong>MATERIALIZE</strong> by BoundingBoxSoftware</a></p>
                   <p>The tool started as an attempt to recreate something simmilar to Materialize, but instead using WebGL over Unity, as the tool seems to be more or less abandoned.</p>
                   <p><a href="https://github.com/JohnnyJF10/TgaBuilder" target="_blank" rel="noopener"><strong>TGA BUILDER</strong> by JohnnyJF10</a></p>
                   <p>Originally I have drawn SVG masks for transitions which worked well for diffuse maps, but started creating problems for material transitions. The transition feature of TGA Builder alleviated this issue and preserved seamlessness.</p>
                   <p style="font-size:0.85rem;opacity:0.85;">Atlas Tool is <strong>dual-licensed</strong>: the tool as a whole is <strong>GPL-3.0</strong> (see <code>LICENSE</code>) because it bundles two seamless-tiling shaders (<code>seamlessMaker</code>, <code>seamlessSplat</code>) ported from Materialize (GPL-3.0). All of the author's own code is <em>also</em> offered under the <strong>MIT License</strong> (see <code>LICENSE-MIT</code>) — those two shaders are the only GPL-only parts. TgaBuilder's reused code is MIT. Full notices ship in <code>THIRD-PARTY-NOTICES.md</code> and <code>Path to MIT.md</code>.</p>`
        },
        {
            id: 'about-contrib', icon: '🤝', title: 'Contributions',
            html: `<p>Any kind of contributions and suggestions are more than welcome, but I'm really new to github so you'll have to hit me up so I set things up.</p>
                   <p>If you have specific knowledge about parts of this tool and want to adapt it in some way, feel free to do so.</p>
                   <details class="tut-spoiler">
                       <summary>📨 How to reach me</summary>
                       <p>Discord: <strong>heyitscrazed</strong></p>
                   </details>`
        }
    ];

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    /* Drag-to-wipe before/after comparison (clip-path based). */
    function buildCompare(name) {
        const wrap = el('div', 'tut-compare');
        wrap.innerHTML = `
            <div class="tut-badge">🖐 Test for yourself</div>
            <div class="cmp-frame" style="--pos:50%">
                <img class="cmp-before" alt="before" src="${IMG}${name}-before.png" draggable="false">
                <img class="cmp-after"  alt="after"  src="${IMG}${name}-after.png" draggable="false">
                <div class="cmp-divider"></div>
            </div>
            <input type="range" class="cmp-range" min="0" max="100" value="50" aria-label="Reveal amount — drag to compare before and after">
            <div class="cmp-foot"><span>Before</span><span>After</span></div>`;
        const frame = wrap.querySelector('.cmp-frame');
        const range = wrap.querySelector('.cmp-range');
        const set = v => frame.style.setProperty('--pos', v + '%');
        range.addEventListener('input', () => set(range.value));
        // Allow dragging on the image directly too.
        const drag = e => {
            const r = frame.getBoundingClientRect();
            const v = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
            range.value = v; set(v);
        };
        let down = false;
        frame.addEventListener('pointerdown', e => { down = true; frame.setPointerCapture(e.pointerId); drag(e); });
        frame.addEventListener('pointermove', e => { if (down) drag(e); });
        frame.addEventListener('pointerup', () => { down = false; });
        return wrap;
    }

    /* Auto-crossfading example (CSS-driven). */
    function buildExample(name) {
        const wrap = el('div', 'tut-example');
        wrap.innerHTML = `
            <div class="tut-badge">▶ Example</div>
            <div class="ex-frame">
                <img class="ex-before" alt="before" src="${IMG}${name}-before.png" draggable="false">
                <img class="ex-after"  alt="after"  src="${IMG}${name}-after.png" draggable="false">
            </div>
            <div class="ex-cap">before&nbsp;⇄&nbsp;after</div>`;
        return wrap;
    }

    /* Interactive material-maps demo: tick which maps to generate for a brick
       texture and see them rendered live by the real engine. */
    function buildMapsWidget() {
        const wrap = el('div', 'tut-maps');
        wrap.innerHTML = `
            <div class="tut-badge">🧪 Try it — generate maps</div>
            <div class="tut-maps-controls">
                <span class="tut-maps-label">Maps to generate:</span>
                <label><input type="checkbox" data-map="normal" checked> Normal</label>
                <label><input type="checkbox" data-map="ao" checked> AO</label>
                <label><input type="checkbox" data-map="specular"> Specular</label>
                <label><input type="checkbox" data-map="roughness"> Roughness</label>
                <label><input type="checkbox" data-map="height"> Height</label>
            </div>
            <div class="tut-maps-grid" id="tut-maps-grid"></div>
            <div class="tut-prev2x">
                <figure><canvas class="tut-prev-2d" width="256" height="256"></canvas><figcaption>2D lit preview (flat)</figcaption></figure>
                <figure><canvas class="tut-prev-3d" width="256" height="256"></canvas><figcaption>🧊 3D displaced preview<span class="tut-3d-status"></span></figcaption></figure>
            </div>
            <p class="tut-maps-note">Left is the flat shaded preview; right is a real <strong>3D engine</strong> (Babylon.js) that displaces a mesh by the height map — drag to orbit, scroll to zoom. It loads when this section scrolls into view.</p>`;
        setTimeout(() => initMapsWidget(wrap), 0);
        return wrap;
    }

    function initMapsWidget(wrap) {
        const grid = wrap.querySelector('.tut-maps-grid');
        const E = window.TRLE && window.TRLE.Engine;
        if (!E || !E.init(document.getElementById('tut-gl'))) {
            grid.innerHTML = '<p class="tut-maps-note">This live preview needs WebGL 2.0 — open the tool itself to try it.</p>';
            return;
        }
        const preset = TRLE.getSolidPreset('brick', 'realistic');
        const LABELS = { normal: 'Normal', ao: 'AO', specular: 'Specular', roughness: 'Roughness', height: 'Height' };
        const S = 256;
        const img = new Image();
        img.onload = () => {
            let diff = el('canvas'); diff.width = S; diff.height = S;
            diff.getContext('2d').drawImage(img, 0, 0, S, S);
            let diffTex;
            try {
                diffTex = E.createTextureFromImage(diff);
            } catch (e) {
                // Opened from file:// → the loaded PNG taints the canvas (file URLs are
                // unique origins), so WebGL upload/readback is blocked. Fall back to a
                // procedural brick on a fresh, untainted canvas so the demo still works.
                console.warn('[tutorial] demo image blocked (file://?); using a procedural brick instead');
                diff = el('canvas'); diff.width = S; diff.height = S;
                drawDemoBrick(diff.getContext('2d'), S);
                diffTex = E.createTextureFromImage(diff);
            }
            const cell = (label, canvas) => {
                const d = el('div', 'tut-maps-cell');
                const cv = el('canvas'); cv.width = canvas.width; cv.height = canvas.height;
                cv.getContext('2d').drawImage(canvas, 0, 0);
                d.appendChild(cv); d.appendChild(el('div', 'tut-maps-cap', label));
                return d;
            };
            const regen = () => {
                const enabled = {};
                wrap.querySelectorAll('input[data-map]').forEach(c => { enabled[c.dataset.map] = c.checked; });
                const maps = E.generateMaps(diffTex, S, S, preset, enabled);
                grid.innerHTML = '';
                grid.appendChild(cell('Diffuse', diff));
                Object.keys(LABELS).forEach(k => {
                    if (enabled[k] && maps[k]) { grid.appendChild(cell(LABELS[k], E.fboToCanvas(maps[k]))); }
                    if (maps[k]) E.deleteFBO(maps[k]);
                });
            };
            wrap.querySelectorAll('input[data-map]').forEach(c => c.addEventListener('change', regen));
            regen();
            buildPreviews(E, diff, diffTex, preset, S, wrap);
        };
        img.onerror = () => { grid.innerHTML = '<p class="tut-maps-note">Could not load the demo texture.</p>'; };
        img.src = 'Examples/Bricks.png';
    }

    /* Procedural brick — the tutorial demo texture used when the bundled image
       can't be uploaded to WebGL (e.g. canvas tainted under file://). */
    function drawDemoBrick(ctx, S) {
        ctx.fillStyle = '#33271a'; ctx.fillRect(0, 0, S, S);              // mortar
        const bw = S / 4, bh = S / 8;
        for (let row = 0; row < 8; row++) {
            const off = (row % 2) ? bw / 2 : 0;
            for (let col = -1; col < 5; col++) {
                const x = col * bw + off + 3, y = row * bh + 3, w = bw - 6, h = bh - 6;
                const base = 110 + Math.random() * 70;
                ctx.fillStyle = 'rgb(' + (base | 0) + ',' + ((base * 0.78) | 0) + ',' + ((base * 0.58) | 0) + ')';
                ctx.fillRect(x, y, w, h);
                for (let k = 0; k < 60; k++) {                            // speckle for grain
                    const v = base - 35 + Math.random() * 70;
                    ctx.fillStyle = 'rgba(' + (v | 0) + ',' + ((v * 0.78) | 0) + ',' + ((v * 0.58) | 0) + ',0.5)';
                    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2);
                }
            }
        }
    }

    /* Paint a short centred message onto a 2D canvas (used for loading/error
       states so a failure shows text instead of a silent black square). Safely
       no-ops if the canvas is already owned by a WebGL context. */
    function tutDrawMsg(canvas, msg, color) {
        if (!canvas) return;
        let ctx; try { ctx = canvas.getContext('2d'); } catch (e) { return; }
        if (!ctx) return;
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = color || '#d08770'; ctx.font = '13px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const words = String(msg).split(' '); const lines = []; let line = '';
        words.forEach(w => { const t = line ? line + ' ' + w : w; if (t.length > 26) { lines.push(line); line = w; } else line = t; });
        if (line) lines.push(line);
        lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 17));
    }

    /* 2D lit (flat) preview + a lazy Babylon 3D displaced preview, side by side.
       Both use the same brick + full map set; the 3D one loads only when the
       section scrolls into view (Babylon is ~8.5 MB). 2D and 3D are isolated so
       one failing can't blank the other, and errors are drawn, not swallowed. */
    function buildPreviews(E, diff, diffTex, preset, S, wrap) {
        const c2d = wrap.querySelector('.tut-prev-2d');
        const c3d = wrap.querySelector('.tut-prev-3d');
        const status = wrap.querySelector('.tut-3d-status');
        const setStatus = m => { if (status) status.textContent = m ? ' — ' + m : ''; };
        if (c2d) { c2d.width = S; c2d.height = S; }
        if (c3d) { c3d.width = 256; c3d.height = 256; }

        let mapCanvas = null;
        // --- 2D lit preview (isolated) ---
        try {
            const full = E.generateMaps(diffTex, S, S, preset,
                { normal: true, ao: true, specular: true, roughness: true, emissive: true, height: true });
            const has = k => full[k] ? 1.0 : 0.0;
            const litFbo = E.createFBO(S, S);
            E.blit('materialPreview', {
                u_diffuse: diffTex,
                u_normal:    full.normal    ? full.normal.texture    : diffTex,
                u_ao:        full.ao        ? full.ao.texture        : diffTex,
                u_specular:  full.specular  ? full.specular.texture  : diffTex,
                u_roughness: full.roughness ? full.roughness.texture : diffTex,
                u_emissive:  diffTex,
                u_hasNormal: has('normal'), u_hasAO: has('ao'), u_hasSpecular: has('specular'),
                u_hasRoughness: has('roughness'), u_hasEmissive: 0.0,
                u_lightDir: [-0.35, 0.4, 0.85]
            }, litFbo);
            if (c2d) c2d.getContext('2d').drawImage(E.fboToCanvas(litFbo), 0, 0, c2d.width, c2d.height);
            E.deleteFBO(litFbo);
            mapCanvas = {
                diffuse:   diff,
                normal:    full.normal    ? E.fboToCanvas(full.normal)    : null,
                ao:        full.ao        ? E.fboToCanvas(full.ao)        : null,
                roughness: full.roughness ? E.fboToCanvas(full.roughness) : null,
                emissive:  full.emissive  ? E.fboToCanvas(full.emissive)  : null,
                height:    full.height    ? E.fboToCanvas(full.height)    : null
            };
            Object.values(full).forEach(f => f && E.deleteFBO(f));
        } catch (err) {
            console.error('[tutorial 2D preview]', err);
            tutDrawMsg(c2d, '2D preview failed: ' + (err && err.message || err));
        }

        // --- 3D preview (isolated; never 2d-draw on c3d once Babylon owns it) ---
        if (!(window.TRLE && TRLE.Preview3D)) { tutDrawMsg(c3d, '3D needs a modern browser', '#999'); return; }
        if (!mapCanvas) { setStatus('no maps'); return; }
        let p3d = null;
        const start = () => {
            if (p3d) return;
            try {
                p3d = TRLE.Preview3D.create(c3d, { relief: 0.5, onStatus: setStatus });
                p3d.setMaps(mapCanvas).then(ok => { if (ok) setTimeout(() => p3d.resize(), 60); else setStatus('failed to load'); });
            } catch (err) { console.error('[tutorial 3D preview]', err); setStatus('error — see console'); }
        };
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(ents => {
                ents.forEach(e => { if (e.isIntersecting) { start(); io.disconnect(); } });
            }, { threshold: 0.15 });
            io.observe(c3d);
        } else {
            start();  // no IO support — just load it
        }
    }

    /* A row of captioned stills/GIFs. Columns adapt to the item count (max 4).
       Set `checker:true` on an item to show it over a transparency checkerboard. */
    function buildGallery(items) {
        const wrap = el('div', 'tut-gallery');
        wrap.style.gridTemplateColumns = `repeat(${Math.min(items.length, 4)}, 1fr)`;
        items.forEach(it => {
            const fig = el('figure', 'tut-gallery-cell' + (it.checker ? ' checker' : ''));
            fig.innerHTML = `<img src="${IMG}${it.src}" alt="${it.cap}" loading="lazy" draggable="false">`;
            fig.appendChild(el('figcaption', null, it.cap));
            wrap.appendChild(fig);
        });
        return wrap;
    }

    /* Live transforms demo: cycles CSS rotate / flip / colour grades on a base
       tile and back to the original — no captured assets needed. */
    const XFORM_STEPS = [
        { label: 'Original',        transform: 'none',       filter: 'none' },
        { label: 'Rotate 90°',      transform: 'rotate(90deg)' },
        { label: 'Rotate 180°',     transform: 'rotate(180deg)' },
        { label: 'Flip horizontal', transform: 'scaleX(-1)' },
        { label: 'Flip vertical',   transform: 'scaleY(-1)' },
        { label: 'Saturate',        filter: 'saturate(2)' },
        { label: 'Desaturate',      filter: 'saturate(0.2)' },
        { label: 'Brighter',        filter: 'brightness(1.4)' }
    ];
    function buildTransformSlideshow(imgSrc) {
        const wrap = el('div', 'tut-xform');
        wrap.innerHTML = `
            <div class="tut-xform-stage"><img alt="transform demo" src="${imgSrc}" draggable="false"></div>
            <div class="tut-xform-cap" aria-live="polite">Original</div>`;
        const img = wrap.querySelector('img'), cap = wrap.querySelector('.tut-xform-cap');
        let i = 0;
        const apply = () => {
            const s = XFORM_STEPS[i];
            img.style.transform = s.transform || 'none';
            img.style.filter = s.filter || 'none';
            cap.textContent = s.label;
        };
        apply();
        let timer = null;
        const play = () => { timer = timer || setInterval(() => { i = (i + 1) % XFORM_STEPS.length; apply(); }, 1400); };
        const stop = () => { clearInterval(timer); timer = null; };
        play();
        // pause on hover so users can read a step, resume on leave
        wrap.addEventListener('mouseenter', stop);
        wrap.addEventListener('mouseleave', play);
        return wrap;
    }

    function render() {
        const toc = document.getElementById('tut-toc');
        const main = document.getElementById('tut-main');
        const tocList = el('ul', 'tut-toc-list');
        toc.appendChild(el('div', 'tut-toc-title', 'Tools'));
        toc.appendChild(tocList);

        SECTIONS.forEach(s => {
            const li = el('li');
            li.innerHTML = `<a href="#${s.id}"><span class="toc-ico">${s.icon}</span>${s.title}</a>`;
            tocList.appendChild(li);

            const sec = el('section', 'tut-section');
            sec.id = s.id;
            sec.appendChild(el('h2', 'tut-h2', `<span class="tut-ico">${s.icon}</span>${s.title}`));
            sec.appendChild(el('p', 'tut-what', s.what));
            if (s.how && s.how.length) {
                const ol = el('ol', 'tut-how');
                s.how.forEach(step => ol.appendChild(el('li', null, step)));
                sec.appendChild(ol);
            }
            if (s.before) {
                const demo = el('div', 'tut-demo');
                demo.appendChild(buildExample(s.before));
                demo.appendChild(buildCompare(s.before));
                sec.appendChild(demo);
            }
            if (s.gallery) sec.appendChild(buildGallery(s.gallery));
            if (s.slideshow) sec.appendChild(buildTransformSlideshow(s.slideshow));
            if (s.figure) {
                const fig = el('figure', 'tut-figure');
                fig.innerHTML = `<img src="${IMG}${s.figure}.png" alt="${s.title} screenshot" loading="lazy">`;
                if (s.figureCaption) fig.appendChild(el('figcaption', null, s.figureCaption));
                sec.appendChild(fig);
            }
            if (s.widget === 'maps') sec.appendChild(buildMapsWidget());
            if (s.tip) sec.appendChild(el('div', 'tut-tip', `<strong>Tip:</strong> ${s.tip}`));
            main.appendChild(sec);
        });

        // ── About / colophon, behind a clear "end of tutorial" divider ──
        const divider = el('div', 'tut-about-divider');
        divider.innerHTML = '<span>End of tutorial — About the tool</span>';
        main.appendChild(divider);

        toc.appendChild(el('div', 'tut-toc-title', 'About'));
        const aboutList = el('ul', 'tut-toc-list');
        toc.appendChild(aboutList);

        ABOUT.forEach(a => {
            const li = el('li');
            li.innerHTML = `<a href="#${a.id}"><span class="toc-ico">${a.icon}</span>${a.title}</a>`;
            aboutList.appendChild(li);

            const sec = el('section', 'tut-section tut-about-section');
            sec.id = a.id;
            sec.appendChild(el('h2', 'tut-h2', `<span class="tut-ico">${a.icon}</span>${a.title}`));
            sec.appendChild(el('div', 'tut-about-body', a.html));
            main.appendChild(sec);
        });

        // Scrollspy: highlight the section currently in view.
        const links = [...toc.querySelectorAll('a')];
        const byId = {};
        links.forEach(a => { byId[a.getAttribute('href').slice(1)] = a; });
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    links.forEach(a => a.classList.remove('active'));
                    const a = byId[en.target.id];
                    if (a) a.classList.add('active');
                }
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        document.querySelectorAll('.tut-section').forEach(s => io.observe(s));
    }

    document.addEventListener('DOMContentLoaded', render);
})();
