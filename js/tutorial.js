/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). The whole tool is MIT as of 2026-09-13: the two GPL-3.0
   seamless shaders ported from Materialize were removed and replaced with
   independent implementations. */
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
            what: 'Every project is an <em>atlas</em>, a grid of equal-size tiles. The start screen gives you three ways in: <strong>Upload an atlas</strong>, <strong>Create a new atlas</strong>, or <strong>Load existing atlas project</strong> if you have been here before.',
            how: [
                'Coming back to earlier work? <strong>Load existing atlas project</strong> takes the export ZIP the tool gave you, or a saved <code>.atlasproj.json</code>, and restores every tile, material and transition. You do not need to re-slice anything.',
                'Set the <strong>Tile Size</strong> first if you are starting fresh. Every map atlas in a set has to share it, and a saved project brings its own.',
                'Drop an atlas image and click <strong>Slice Atlas</strong> to cut the whole sheet; or',
                'Click <strong>Pick tiles…</strong> to set a grid and choose exactly which cells to import, rip one texture, grab several, or stitch from multiple atlases (each cell is resized to your tile size). Add more later with <strong>Import from Atlas…</strong>.',
                'Or click <strong>Create Blank Atlas</strong> under <strong>Create a new atlas</strong> (set the columns), then click an empty slot to add an image there, drop files on it, or point at it and paste. <strong>Add Image(s)</strong> and <strong>Add Blank</strong> add after the last tile.',
                'You can also <strong>paste an image</strong> (Ctrl/Cmd+V) from your clipboard, confirm, then slice it like an imported atlas. With the pointer on an empty slot, the paste goes into that slot as one tile instead.',
                'Each tile is an element you can <strong>right-click</strong> to edit.',
                'PNG, JPG, BMP, WebP, TGA and PSD all load. A layered PSD brings its material maps in with it, see <em>File types</em>.'
            ],
            tip: 'Everything is non-destructive and fully undoable (<strong>Ctrl/Cmd+Z</strong>). <strong>Pick tiles…</strong> and <strong>Import from Atlas…</strong> append to the current atlas, so you can build one up from several sources.'
        },
        {
            id: 'grid-basics', icon: '🖱️', title: 'Working with the grid',
            what: 'The grid is a set of <em>slots</em>, <strong>Columns</strong> × <strong>Rows</strong>, and a slot can be empty. Tiles stay in the slot you put them in. <strong>Right-click</strong> a tile (or focus it and press the <strong>Menu</strong> key) for its actions.',
            how: [
                'Right-click opens a searchable menu: type to jump straight to an action, search works from anywhere, not just the open category, or hover <strong>File</strong>, <strong>Transform</strong>, <strong>Edit</strong>, <strong>Draw</strong>, <strong>Transitions</strong>, <strong>Create</strong> or <strong>Material</strong> to open it. Up to three recent actions sit under the search box, and resting on an action for 2 seconds opens a small preview of what it does. Groups that do not apply are hidden: an animation frame or a transition tile offers fewer of them.',
                '<strong>File</strong> also holds <strong>View…</strong> (the tile at its own resolution plus a 2×2 tiled repeat, so you can spot a seam without leaving the atlas; anything over 512px is scaled down for the preview), <strong>Copy Image</strong> (puts the tile on your clipboard as a PNG, splitting into <strong>Copy Original</strong> / <strong>Copy Modified</strong> once the tile is edited) and <strong>Duplicate</strong> (adds an unlinked copy right after the tile, likewise splitting into <strong>Duplicate Original</strong> / <strong>Duplicate Modified</strong>: editing one afterward never touches the other).',
                'Arrow keys walk the slots, empty ones included; <strong>Enter</strong>/<strong>Space</strong> select; <strong>S</strong>/<strong>T</strong>/<strong>M</strong>/<strong>H</strong> trigger Seamless / Transition / Material / Heal.',
                '<strong>Drag</strong> a tile onto another to swap them. Drop it in the gap beside a tile to insert it there (the row pushes right), or in the gap above or below one to insert it in the column (the column pushes down). A push stops at the first empty slot, so tiles past it stay put. Drop on an empty slot to just put it there. While you drag, an orange dashed outline shows where each tile will land, and a grey dashed one marks each slot it will leave empty. <strong>Ctrl/Cmd+Arrow</strong> nudges a tile one slot.',
                'Raising <strong>Columns</strong> or <strong>Rows</strong> adds empty slots; nothing reflows. Lowering <strong>Columns</strong> moves any textures in the removed columns to new rows at the bottom, in order (a group moves whole, keeping its shape). Lowering <strong>Rows</strong> moves the textures in the removed rows up into empty slots, and adds columns on the right only if there are not enough.',
                'The 🔓 beside Columns and Rows locks them. With <strong>Columns</strong> locked, a push that runs off the end of a full row wraps into the next row instead of adding a column (a locked <strong>Rows</strong> does the same down the columns). Lock both and a drop with nowhere to go is refused.',
                'Empty slots are dashed. <strong>Click</strong> one to add an image there, <strong>drop files</strong> from your desktop on it, or point at it and <strong>paste</strong> (an image that is not tile-sized gets resized, after asking). Right-click one for <strong>Add Blank</strong>, <strong>Paste</strong> and, when its whole row or column is empty, <strong>Delete Empty Row</strong> / <strong>Delete Empty Column</strong>.',
                'Empty slots <em>between</em> your textures have to become something in the exported sheet, so the first export asks, once per project (or any time from <strong>🔲 Empty slots…</strong> in the Layout row): <strong>🧲 Compact</strong> moves everything up to close the gaps (a group moves as one piece, to the first place its shape fits), <strong>⬛ Fill black</strong> and <strong>🔳 Fill transparent</strong> put a tile in each. Filling renumbers the grid, and every map atlas stays aligned with the diffuse. Empty slots after the last texture never need an answer.',
                'Tiles outlined in orange move as one piece: a transition set, an animation’s frames, or a group you made (see <em>Select & batch-edit</em>). Drag any of them and the whole group comes along, keeping its shape, and pushes loose tiles out of its way. Right-click → <strong>Ungroup</strong> (<strong>Ctrl/Cmd+Shift+G</strong>) frees them. Ungrouping an animation warns first: moved apart, its frames could lose their seamlessness.',
                'No column cap: an atlas can be as wide as 16384 px allows, which matters for classic levels full of 32 or 64 px tiles. A grid wider than the window scrolls sideways, with the scrollbar or by holding <strong>Space</strong> and dragging.',
                'With <strong>Animations</strong> on, the tiles also slide to show the result before you let go. <strong>Animations</strong> in the accessibility bar turns that off (along with every other animation in the tool) and leaves the outlines and drop markers.',
                '<strong>Replace Image</strong> (right-click) swaps a tile’s texture; <strong>Reset to Original</strong> reverts it.',
                'Remove a tile with right-click → <strong>Delete…</strong> (or press <strong>Delete</strong> on a focused tile), which leaves its slot empty; to clear several at once, select them (see below) and hit <strong>Delete</strong> on the bulk bar.',
                '<strong>👁️ Preview atlas</strong>, on the right of the Layout row, swaps the tiles for the stitched sheet exactly as it exports: same slots, same columns, no gaps or badges, with <strong>Magenta key</strong> beside it for the transparent parts. <strong>▦ Back to tiles</strong>, or Esc, returns to the grid.',
                '<strong>Undo</strong> / <strong>Redo</strong> sit in the grid header (<strong>Ctrl/Cmd+Z</strong>, <strong>Ctrl/Cmd+Shift+Z</strong>); the <strong>History</strong> panel on the right lists every step, click one to jump back.'
            ],
            tip: 'Deleting a tile that other transitions are built on also removes those transitions (you’re warned first, and it’s fully undoable). Older projects may hold black spacer tiles from before empty slots existed; they stay black tiles and ship in the export, and new sets no longer make them. Status messages appear in the log on the left.'
        },
        {
            id: 'batch-select', icon: '☑️', title: 'Select & batch-edit tiles',
            what: 'Work on many tiles at once, like selecting icons on a desktop. Pick a group of tiles and a <strong>bulk-action bar</strong> appears so you can material, reorder, group or delete them together.',
            how: [
                '<strong>Click</strong> a tile to select it; <strong>Ctrl/Cmd+click</strong> to add or remove individual tiles; <strong>Shift+click</strong> to select a whole range.',
                '<strong>Drag a box</strong> across the grid background to rubber-band several tiles at once. <strong>Ctrl/Cmd+A</strong> selects everything; <strong>Esc</strong> clears.',
                'With 2+ selected, use the bar: <strong>🎨 Apply Material</strong> (set one material on all of them, saved ⭐ presets included), <strong>🔗 Group</strong> (tie them together so they move as one piece; Ctrl/Cmd+G), <strong>⏮ To front</strong> / <strong>To back ⏭</strong> (the first or last occupied slots; empty slots stay put), or <strong>🗑️ Delete</strong>. The bar sticks below the header, so it stays reachable while you scroll a tall atlas.',
                '<strong>Drag</strong> any selected tile and the whole selection moves with it, keeping its shape. A group made with <strong>🔗 Group</strong> or <strong>Ctrl/Cmd+G</strong> (or right-click → <strong>Group</strong>) does the same without a selection, until you ungroup it. A tile can be in one group at a time.',
                '<strong>Right-clicking any selected tile</strong> works on the whole selection. Any menu entry that can run on several tiles says so, it reads <em>“· N tiles”</em> and applies to all of them: <strong>Set Material</strong>, <strong>Adjust Colours</strong> (in its Simple and Channel levels modes), <strong>Recolor from Texture</strong>, <strong>De-light</strong>, <strong>Surface Noise</strong>, <strong>Make Seamless</strong>, the four <strong>Transform</strong> entries, <strong>Download PNG</strong> and <strong>Reset to Original</strong>. Right-clicking a tile <em>outside</em> the selection drops back to that one tile.',
                'Entries with no count are per-tile by nature, <strong>Heal</strong>, <strong>Fade</strong>, <strong>Make Emissive</strong>, <strong>Build Pattern</strong>, <strong>Stained Glass</strong> and the transition builders all need something painted or picked on one specific texture.',
                'Once you have assigned a material, <strong>🎨 Apply Last Material</strong> appears in the right-click menu and as <strong>↺ Repeat</strong> on the bar. It reapplies the last material with no modal, on one tile or a whole selection.'
            ],
            tip: 'A batch modal shows the settings on one tile and applies them to all of them, so tune against the preview then hit Apply once. <strong>Recolor</strong> adds a choice for this: <em>Match each tile to the reference</em> measures every tile separately so they all land on the reference’s tone (good for making mismatched textures sit together), while <em>Apply the same shift to every tile</em> keeps deliberate variants apart. <strong>Apply Material</strong> skips transition tiles (they inherit from their sources). Everything here is one undo step.'
        },
        {
            id: 'seamless', icon: '🔄', title: 'Make Seamless',
            what: 'Removes the visible seam when a texture is tiled, so it repeats cleanly across a surface.',
            how: ['<strong>Right-click</strong> a tile → <strong>Make Seamless</strong>.', 'Pick a method (<strong>Scattered edges</strong> is the all-rounder) and the blend radius.', 'Click <strong>Save to Atlas</strong>, the tile updates in place and any transitions using it refresh.'],
            gallery: [
                { src: 'seamless-orig.png', cap: 'Original (tiled, see the seam)' },
                { src: 'seamless-pan.gif', cap: 'Scattered edges 20%, tiles seamlessly' },
                { src: 'seamless-blend.png', cap: 'Blend radius 100%' },
                { src: 'seamless-final.png', cap: 'Finished tile' }
            ],
            tip: 'The 2×2 tilings show the centre cross, where seams appear. The GIF pans across the tiled result, a seamless tile has no visible repeat line. A higher blend radius hides the seam harder but softens detail, so dial it back if the texture goes muddy.'
        },
        {
            id: 'transitions', icon: '🔀', title: 'Transitions',
            what: 'Blends two textures along an edge or corner so terrain types meet without a hard line.',
            how: ['<strong>Right-click</strong> tile A → <strong>Make Transition with Texture</strong>, then click tile B.', 'Choose <strong>Directions</strong> (or paint a <strong>Custom</strong> mask) and a <strong>Blend method</strong>.', 'Re-orient the overlay (B) with <strong>Rotate</strong> / <strong>Flip</strong> if needed, then click <strong>Add</strong>, one tile per direction.', 'Building an island or a hole by hand from corner tiles? Tick <strong>Seamless corners</strong>. The corner and full-edge buttons then make the same shapes as the Full Set’s <strong>Seamless</strong> corner style, so each corner meets the edge tile beside it exactly. Unticked, you get the original shapes.'],
            before: 'transition',
            tip: 'Blend methods: <strong>Alpha</strong> (cross-fade), <strong>Height</strong> (organic interlock), <strong>Poisson</strong> (matches tone when the two differ in brightness). Or switch to the <strong>Full Set</strong> tab (below) to create a whole patch at once.'
        },
        {
            id: 'transition-sets', icon: '🧱', title: 'Transition sets (full patch)',
            what: 'The <strong>Full Set</strong> tab of Make Transition builds a whole terrain patch in one step and lays it into the atlas <em>spatially</em>, so the arrangement itself shows how the pieces fit, and you can see exactly which tile you’re picking in Tomb Editor. Reach for it when you want a ready-made island, hole or complete set rather than hand-picking single edges.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Transition with Texture</strong>, click tile B, then switch to the <strong>🧩 Full Set</strong> tab.',
                'Pick a <strong>Set layout</strong>: <strong>3×3 Island</strong> (a pocket of the overlay surrounded by the base), <strong>3×3 Hole</strong> (a window of the base inside the overlay), or <strong>5×3 Complete</strong> (island + hole + plain tiles together).',
                'Leave <strong>Corner style</strong> on <strong>Seamless</strong>. It puts the boundary state on the four tile corners, so a corner cell and the edge cell beside it agree exactly and the nine tiles read as one shape. <strong>Rounded</strong> and <strong>Sharp 45°</strong> are the older styles, kept so existing projects still open; their corner cells run the overlay along their whole inner edges, which shows as a step wherever a corner meets an edge.',
                'Shape every edge with <strong>Pivot</strong>, <strong>Hardness</strong> and the <strong>Blend method</strong>. The preview updates as one connected patch.',
                'Click <strong>Add … Tiles</strong>. If the atlas isn’t already the right width, it offers to <strong>resize the columns</strong> (padding the last row with blank spacers) so the block drops in keeping the exact preview shape.'
            ],
            figure: 'transition-set', figureCaption: 'A 3×3 Island set on the Seamless corner style: full overlay (sand) in the centre, the four edges blending outward, the corners pulling the overlay toward the middle. The nine tiles are drawn here with no gaps between them, so any mismatch at a corner would be visible as a step.',
            tip: 'Plain cells (the base/overlay fills in the Complete layout) stay <em>linked</em> to their source tiles, so they still inherit materials and refresh when you edit the source, not flat copies. The <strong>5×3 Complete</strong> layout packs two separate patches side by side (a 3×3 island in the first three columns, a 2×2 hole in the last two) plus two spare plain tiles, so cells that sit next to each other across that split are not meant to join up. For an overlay that must flow in every direction at once, use a <strong>Wang set</strong> instead.'
        },
        {
            id: 'organic-edge', icon: '🌿', title: 'Organic edges (blobby set boundaries)',
            what: 'The boundary a transition draws is a clean curve, which reads as generated. The <strong>🌿 Organic edge</strong> panel breaks it up into a ragged, flecked, hand-painted one. It is on the <strong>Single Tiles</strong> and <strong>Full Set</strong> tabs of Make Transition, in <strong>Make Anchored Transition</strong>, <strong>Make Transition Grid</strong>, <strong>Make Wang Set</strong>, <strong>Add Borders &amp; Corners</strong> and <strong>Fade to Transparent</strong>, and on the animated texture’s <strong>🖼 Overlay</strong> tab. It is a different thing from <strong>Make Organic Transition</strong> below: that scatters the overlay into loose patches across a single tile, this reshapes a boundary while keeping every tile joined to its neighbours.',
            how: [
                'On <strong>Single Tiles</strong>, pick your <strong>Directions</strong> and open <strong>🌿 Organic edge</strong>. On <strong>Full Set</strong>, build the set with <strong>Corner style</strong> on <strong>Seamless</strong> first. Every slider starts at 0 and nothing changes until you move one.',
                'The panel is hidden for a <strong>Custom</strong> painted mask, that mask is already whatever shape you drew.',
                'On <strong>Make Anchored Transition</strong> it sits under <strong>🌊 Border warp</strong>, which is a different control: the warp bends the whole line into a slow wave, the organic edge roughens it. The roughening fades out toward the tile border, so the line still meets the edge exactly where your anchors put it. <strong>Make Transition Grid</strong> works the same way on the whole wall, stamps included, before it is cut into tiles: the tiles join each other exactly and the roughening fades out only at the edge of the wall.',
'Pick an <strong>Edge style</strong>. <strong>Blobs</strong> gives soft rounded lobes, <strong>Spikes</strong> short tapered teeth, <strong>Drips</strong> long reaching fingers, <strong>Clumps</strong> chunky lobes with gaps, <strong>Fray</strong> a fine ragged fringe. Each one loads its own suggested settings and a line saying what it suits.',
                'Teeth and fingers point <em>away</em> from the overlay, following the boundary wherever it runs, so an overlay coming up from the bottom spikes upward, and a corner spikes outward along its curve. Nothing is locked to a world direction, because a TRLE texture can be rotated freely.',
                '<strong>Amount</strong> sets how far the style pushes the boundary. <strong>Drift</strong> stops it crossing each tile edge at dead centre, which is the main tell that a set was generated. <strong>Scatter</strong> throws flecks of the overlay out past the edge.',
                '<strong>Detail softness</strong> softens the parts the style moved, and only those. <strong>Hardness</strong> above widens the blend across the whole tile instead, which flattens the shape you just made.',
                '<strong>Contact shadow</strong> darkens the base just outside the boundary so the overlay sits <em>on</em> it rather than inlaid into it. Turn it up and you get a <strong>Colour</strong>, a <strong>Blend</strong> and a <strong>Sits on</strong> control: <strong>Multiply</strong> darkens toward the colour and keeps the texture under it, <strong>Tint</strong> paints over and can lighten. A pale colour on Tint with <strong>Sits on</strong> near 100 gives a lit rim on the overlay instead of a shadow on the base.',
                '<strong>Apply to</strong> decides where the shadow goes, and it matters more than it looks. In the <strong>Diffuse</strong> it is painted into the texture, which is what classic TRLE wants. But if you export relief maps, the map generator reads that darkening back out of the diffuse luminance and turns it into <em>geometry</em>, a band that looked right flat comes out as a trench in the normals. Send it to the <strong>AO map</strong> instead and the engine applies it as occlusion, leaving the diffuse clean. The panel tells you which case you are in.',
                '<strong>Feature size</strong> sets how many blobs fit across a tile; <strong>🎲 Reroll</strong> draws a new pattern.',
                '<strong>Alternates</strong> adds the whole set more than once, each copy drawn with different noise. Cycle them along a boundary instead of repeating one tile. They are still seamless with each other, and with the originals.'
            ],
            before: 'organic-edge',
            figureCaption: 'The same 3×3 island with the organic sliders off and on. Both are exactly seamless: the noise is faded out at each tile border, which is the one place a neighbouring tile’s pixels would be needed.',
            tip: 'Only the <strong>Full Set</strong> tab gets <strong>Drift</strong> and <strong>Alternates</strong>. Drift is the one control that reaches the tile border, so it is safe only where the whole set is generated together, a Wang tile, a single directional tile or a border slot is laid next to tiles it was not drawn with. Alternates is a set idea for the same reason. An organic edge makes <em>repetition</em> more obvious, not less: a straight boundary tiles invisibly, a distinctive blob does not, so a long run of one organic tile reads as a repeating motif. Keep the sliders modest for edges you will lay in long runs, and save the strong settings for a boundary that appears once or twice.'
        },
        {
            id: 'wang', icon: '🧩', title: 'Wang sets',
            what: 'Creates the full 16-tile edge set so an overlay terrain connects in every up/down/left/right combination. <strong>Use a Wang set when an overlay needs to flow freely in any direction</strong> across a floor or wall, sand drifting over grass, water pooling on stone, so you can paint the boundary in unpredictable shapes and the tiles still join up. For a single straight or curved seam, a plain Transition or Anchored Transition is simpler; reach for Wang when you need every edge combination on hand.',
            how: ['<strong>Right-click</strong> tile A → <strong>Make Wang Set with Texture</strong>, then click tile B.', 'Set the <strong>Blend method</strong>, <strong>Pivot</strong> and <strong>Hardness</strong>, corners blend smoothly (no diagonal crease) and <strong>Hardness</strong> sets the seam width (0 = wide soft blend, 100 = crisp cut).', 'Click <strong>Add 16 Tiles</strong>, drop the whole set into your level’s palette.'],
            figure: 'wang-geo', figureCaption: 'A full grass→sand Wang set, laid out by where each edge sits: grass in the centre, sand creeping in from each side, and the corners blending two sides at once, so the 9 tiles form one coherent grass patch surrounded by sand.',
            tip: 'Wang tiles inherit materials from both sources, just like transitions.'
        },
        {
            id: 'borderset', icon: '🧱', title: 'Borders & corners (border sets)',
            what: 'Builds a <em>reusable border tile set</em> from just two textures: a <strong>fill</strong> (grass, gravel, carpet) and a <strong>trim</strong> that runs along the boundary, stone edging, rope, a door frame. You get every edge, corner and fill piece needed to outline rooms and areas of any rectilinear shape, laid into the atlas as a readable block. Where a <strong>Wang set</strong> blends two terrains into each other, a border set keeps the trim as a crisp, decorative band <em>on top of</em> the fill.',
            how: [
                '<strong>Right-click</strong> the fill tile → <strong>Create</strong> → <strong>🧱 Add Borders &amp; Corners</strong>, then click the trim texture. (It sits in <strong>Create</strong>, not <strong>Transitions</strong>: it builds a set from two textures rather than blending one terrain into another.)',
                'Pick a <strong>Set type</strong>: <strong>Frame</strong> (9 tiles, border around filled rectangles), <strong>Frame + inner corners</strong> (13 tiles, the border can also turn through concave corners, so <em>any</em> room shape works), or <strong>Lines</strong> (16 tiles, the trim runs <em>between</em> areas through tile centres, pipes/roads style, in every N/E/S/W combination).',
                'Tune the <strong>Border width</strong> and <strong>Softness</strong>, and pick a <strong>Blend method</strong>. <strong>Trim follows direction</strong> rotates the trim texture along vertical runs and mitres the corners like a picture frame, untick it for isotropic trims (gravel, dirt).',
                'Open <strong>🌿 Organic edge</strong> to fray the trim where it meets the fill, with the same edge styles the transition tools use. Only the <em>inner</em> contour moves: the edge sitting on the tile border stays flush, so a border down the left of a tile goes ragged on its <em>right</em> and two bordered rooms still meet cleanly. Good for moss creeping off a stone edging or a worn carpet border; leave it at 0 for cut stone and tilework.',
                'The <strong>Sample wall</strong> shows the whole set assembled into a room so you can check the joins before adding. If a slot looks wrong, usually baked lighting fighting a rotated edge, <strong>click it</strong> to cycle how it’s made: own mask → rotated ↻ → mirrored ↔/↕ → hand-picked atlas tile 🖼. In that last mode a small button under the slot shows the tile it uses; click it to pick another from thumbnails.',
                'Click <strong>Add … Tiles</strong>, the set drops in as a spatial block (with a column-resize offer so it lines up), ready to place in Tomb Editor.'
            ],
            before: 'bset-organic',
            figure: 'borderset-modal', figureCaption: 'A grass + sand border set (Frame + inner corners): the 13 slots on the left, edges, outer corners, fill and the four inner-corner patches, and the sample wall on the right showing the set assembled into an L-shaped room, the trim turning cleanly through the concave corner.',
            tip: 'Border-set tiles are live transitions: they inherit materials from both sources and re-render when you edit either texture (make the fill seamless <em>first</em> for best results). The trim sits on the tile edges, so two bordered rooms placed side by side share a double-width band, exactly how classic TRLE border sets read.'
        },
        {
            id: 'anchored', icon: '📐', title: 'Anchored transitions',
            what: 'Like a transition, but the border between the two textures is a chain of <em>movable anchors</em>, so you can bend the seam into ridges, coastlines or any custom shape instead of a straight edge.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Anchored Transition</strong>, then click tile B.',
                'Start from a preset, then <strong>drag</strong> an anchor, <strong>click</strong> empty space to add one, or <strong>right-click</strong> an anchor to remove it.',
                '<strong>Drag the border line itself</strong> (between the anchors) to slide the whole border across the tile without changing its shape. The cursor turns into a move arrow when you are on it. A click on the line that does not move still adds an anchor there.',
                'Pick the <strong>Border axis</strong>, <strong>Swap sides</strong>, set the <strong>Edge hardness</strong> and a <strong>Blend method</strong>, then click <strong>Add Transition Tile</strong>.',
                'Re-orient the overlay (B) with <strong>Rotate</strong> / <strong>Flip</strong>, and tick <strong>Hide handles</strong> to preview without the anchor dots in the way.',
                '<strong>Scroll the wheel</strong> over an anchor to cycle its curve (straight → bow out → bow in), or <strong>double-click</strong> it to toggle a curve and <strong>middle-drag</strong> the handle to fine-tune the bend, great for organic, flowing borders.',
                'Raise <strong>🌊 Border warp</strong> to bend the whole seam into a slow, natural wave (<strong>🎲</strong> rerolls the pattern). It moves the <em>shape</em> of the border rather than roughening it, for a ragged, flecked edge use <strong>🌿 Organic edge</strong> on a plain Transition instead.'
            ],
            figure: 'anchored-modal', figureCaption: 'The Anchored Transition editor: drag the white anchor dots along the A→B border, click empty space to add one, right-click to remove, and scroll over an anchor to curve it.',
            tip: 'It exports as a normal transition tile (a custom mask), so it composites, saves and undoes exactly like the others.'
        },
        {
            id: 'transgrid', icon: '🗺️', title: 'Transition grids',
            what: 'Designs one continuous A→B border across a whole multi-tile wall, then slices it into tiles that connect seamlessly, perfect for, say, water creeping up a 3×3 stone wall.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Transition Grid</strong>, then click tile B.',
                'Set <strong>Columns × Rows</strong> to match the wall, pick a start preset, then <strong>drag</strong> the anchors, the border flows across cell edges, so neighbours always line up. <strong>Drag the line itself</strong> to move the whole border at once, and <strong>scroll</strong> the wheel over an anchor to cycle its curve (straight → bow out → bow in).',
                'Switch the <strong>Tool</strong> to <strong>Add patch</strong> or <strong>Carve patch</strong> and <strong>drag</strong> to drop a circular patch of the overlay into any single cell (scroll over it to resize, right-click to remove), or tick <strong>Stamps only</strong> to skip the A→B border entirely and place free-floating islands, like a puddle inside one cell.',
                'Raise <strong>🌊 Border warp</strong> to bend the whole border into a slow, natural wave (<strong>🎲</strong> rerolls the pattern); the warp is applied across the full wall before slicing, so cells still line up.',
                'Click <strong>Add … Tiles</strong> to drop one transition tile per cell into the atlas (use the <strong>Alpha</strong> blend to keep the seam continuous between cells).'
            ],
            figure: 'transgrid-modal', figureCaption: 'The Transition Grid: set Columns × Rows, drag the border anchors across the whole wall, switch the Tool to drop patch stamps into a single cell, or raise Border warp to bend the whole seam.',
            tip: 'Lay the exported tiles out in the same Columns×Rows arrangement in your level and the transition reads as one continuous surface.'
        },
        {
            id: 'organic', icon: '🌿', title: 'Organic transitions',
            what: 'Scatters one texture into another as <em>organic, noise-driven patches</em> instead of a clean line, grass breaking up into sand, moss creeping over stone, and creates several random <em>variations</em> from a seed so no two tiles repeat.',
            how: [
                '<strong>Right-click</strong> tile A → <strong>Make Organic Transition</strong>, then click tile B.',
                'Optionally <strong>paint a hint</strong> on tile A to steer where the overlay lands (or leave it blank for a fully random scatter); tune <strong>Coverage</strong>, <strong>Patch size</strong> and <strong>Roughness</strong>.',
                'Choose how many <strong>Variations</strong> to create, <strong>🎲 Randomize</strong> or type a <strong>Seed</strong>, then click the previews to pick which ones to keep and press <strong>Add … Tiles</strong>.',
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
                'Pick a <strong>Preset</strong> (Sand in the joints, Stones over grass, Snow on ledges, Water in cracks…). Each sets <strong>Height from</strong> (Base or Overlay) × <strong>Fills</strong> (Low/High) plus the level and a suggested overlay material, leave <strong>Assign … material</strong> ticked so the fill’s PBR maps read correctly.',
                '<strong>Height from</strong> also offers <strong>Both (whichever is higher)</strong>: at each pixel the height comes from whichever texture stands prouder of its own surface, so snow catches on the stones <em>and</em> on its own drifts. Each texture is measured against itself first, or the brighter one would win everywhere. The combined height is never lower than either source alone, so at the same <strong>Fill level</strong> it puts more overlay on the high ground and less in the low ground. Nudge the level to compensate.',
                'Tune the <strong>Fill level</strong> and <strong>Edge hardness</strong>; open <strong>⛰️ Height field</strong> to set how much <strong>Detail</strong> vs broad shape the height keys off.',
                'Layer in variation: <strong>🌿 Organic breakup</strong> (+🎲) wobbles the fill edges; the <strong>📈 Response curve</strong> reshapes how abruptly the overlay appears as height drops; <strong>🗺️ Spatial drift</strong> makes the fill drift deeper toward one side (a “tide line”) or masks it to a region. Both editors take the same anchors as the transition tools, so you can drag the line itself to shift the whole curve.',
                'Click <strong>Add Transition Tile</strong>. Later, <strong>right-click → Edit Height Transition</strong> to reopen the exact recipe and tweak it in place.'
            ],
            before: 'heighttrans',
            tip: 'Works best on textures with real relief (cobble/brick flooring). The whole recipe is stored on the tile, so it survives undo and project save and stays fully re-editable.'
        },
        {
            id: 'overlay', icon: '\u{1F5BC}', title: 'Overlay textures',
            what: 'Lays one texture <em>on top of</em> another instead of blending between them. A decal on a wall, a mural on stone, grime over brick. The other transition tools cross-fade two terrains; this one stacks them, so the overlay\u2019s own transparency is respected and nothing underneath is tinted where the overlay isn\u2019t.',
            how: [
                '<strong>Right-click</strong> the background texture \u2192 <strong>Overlay Texture</strong>, then click the texture to lay on top.',
                'If the top texture already has transparency, leave <strong>What shows through</strong> on <strong>Whole overlay</strong>. Everything else is for cutting a shape out of an opaque texture.',
                '<strong>Pick a colour</strong> or <strong>Hue range</strong> keys it by colour: click the source preview to eyedrop, set the <strong>Tolerance</strong>, and tick <strong>Invert the selection</strong> if you sampled the background rather than the subject. <strong>Bright areas</strong> keys by luminance. <strong>Paint it</strong> gives you the brush, lasso and wand.',
                '<strong>Read colours from</strong> decides which texture gets sampled. Reading <em>the overlay</em> cuts a decal off its own background; reading <em>the base</em> puts the overlay only where the background matches, which is how you get grime in mortar joints and moss on the dark stones.',
                'Set <strong>Opacity</strong>, and a <strong>Blend</strong> if you want one: <strong>Multiply</strong> for dirt and stains, <strong>Screen</strong> for dust and light, <strong>Overlay</strong> for weathering. Then <strong>Add Overlay Tile</strong>.'
            ],
            before: 'overlay',
            tip: 'The result is a live recipe, not baked pixels: recolour or heal either source and the overlay tile follows. <strong>Right-click \u2192 Edit Overlay</strong> reopens it. Blend affects colour only, so the generated normal / AO / roughness maps describe whatever is actually on top.'
        },
        {
            id: 'heal', icon: '🩹', title: 'Heal / Fill',
            what: 'Paints out blemishes, logos or scratches by filling the area with surrounding colour or re-synthesised texture.',
            how: ['<strong>Right-click</strong> a tile → <strong>Heal / Fill</strong>.', 'Paint over the <em>whole</em> blemish so the selection touches clean texture on every side.', 'Pick a method: <strong>Healing brush</strong> (default), <strong>Neighbour-aware</strong>, <strong>Texture</strong> (whole-tile synthesis) or <strong>Smooth</strong> (diffusion), then <strong>Save to Tile</strong>.', 'The result on the right updates as you paint. <strong>Drag the divider</strong> across it to wipe between before and after, or press and hold <strong>👁 Hold to see the original</strong> to flick the whole tile back, both land on the same pixels, which is how you spot a smear or a seam. Raise <strong>Edge softness</strong> to feather the selection edge; <strong>Paint</strong> and <strong>Erase</strong> are separate buttons.'],
            before: 'heal', tip: '<strong>Healing brush</strong> works like the one in Photoshop or Photopea: it copies real texture from a matching spot elsewhere on the tile, then blends its colour into the edge so there is no seam. Everything it does scales with the size of the spot, so it behaves the same on a 64px tile and a 1024px one. <strong>Smooth</strong> is flat on purpose (it has no texture to copy), so keep it for a scratch on a plain surface. Paint over the entire mark either way.'
        },
        {
            id: 'transforms', icon: '↻', title: 'Transforms',
            what: 'Quick per-tile geometry: rotate 90°, flip, or offset (roll) to move seams to the centre for healing.',
            how: ['<strong>Right-click</strong> a tile → <strong>Rotate 90°</strong>, <strong>Flip Horizontal</strong> / <strong>Vertical</strong>, or <strong>Offset ½</strong>.', 'Each is instant and undoable.'],
            slideshow: 'Examples/Bricks.png', tip: '<strong>Offset ½</strong> then <strong>Heal</strong> is a fast way to kill a stubborn seam. (The demo above cycles through the transforms automatically, hover to pause.)'
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
            what: 'Two ways to re-grade a tile’s colours: drive them by hand, or sample another texture and move toward it. Handy for rebalancing a preset that blows out, or making textures from different sources sit together.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Edit</strong> › <strong>Adjust Colours</strong>. The <strong>Mode</strong> dropdown picks one of four.',
                '<strong>Simple</strong> is the default: <strong>Hue</strong>, <strong>Saturation</strong>, <strong>Brightness</strong>, <strong>Contrast</strong>, <strong>Gamma</strong>, <strong>Temperature</strong>, <strong>Tint</strong> and <strong>Vibrance</strong> over the whole tile.',
                '<strong>Channel levels</strong> gives red, green and blue their own <strong>Dark cutoff</strong>, <strong>Bright cutoff</strong> and <strong>Gamma</strong>. Below its Dark cutoff a channel reads as 0, above its Bright cutoff it reads as full. Every Simple slider is symmetric, <strong>Temperature</strong> moves red up and blue down together, so there is no way to touch one channel at one end of the range. This is how you take a cast out of the shadows and leave the highlights alone.',
                '<strong>Paint a region</strong> marks part of the texture and works on that alone. Paint straight onto the preview with the usual brush, lasso, rectangle and wand. <strong>Grade it</strong> applies the Simple sliders inside the region only, everything outside comes out unchanged to the pixel. <strong>Match the surroundings</strong> keeps the region’s light and shade and gives it the colour of the texture around it.',
                '<strong>Curves</strong> works like it does in Photoshop, Photopea and Affinity. Left to right is the brightness going in, up is what comes out. Press anywhere on the graph to add a point and drag it: an S-shape adds contrast, lifting the left end brightens the shadows. Pick <strong>Red</strong>, <strong>Green</strong> or <strong>Blue</strong> to bend one channel on its own, which is the quickest way to pull a cast out of the dark end only. They apply first, <strong>RGB</strong> on top.',
                '<strong>Right-click</strong> a tile → <strong>Recolor from Texture</strong>, then click a reference tile. Its palette is sampled and this tile is shifted toward it. Tune <strong>Strength</strong> and the light grade, then <strong>Apply</strong>.',
                'Simple, Channel levels, Curves and Recolor all work on a <strong>whole selection</strong>: select the tiles first, then right-click one of them. The menu entry reads <em>“· N tiles”</em> and the modal says how many it will write. <strong>Paint a region</strong> is the exception and is greyed out with several tiles selected, since a painted region is drawn on one specific texture. Recolor offers <strong>Match each tile to the reference</strong> (every tile lands on the reference’s tone, even if they started far apart) or <strong>Apply the same shift to every tile</strong> (variants keep their differences). The reference tile is never recoloured, even if it is selected.'
            ],
            gallery: [
                { src: 'ca-channel-before.png', cap: 'A blue cast' },
                { src: 'ca-channel-after.png', cap: 'Channel levels: blue dark cutoff raised' },
                { src: 'ca-match-before.png', cap: 'A green patch' },
                { src: 'ca-match-after.png', cap: 'Match the surroundings' },
                { src: 'recolor-before.png', cap: 'Original tile' },
                { src: 'recolor-ref.png', cap: 'Reference (Grass)' },
                { src: 'recolor-after.png', cap: 'Recoloured to match' }
            ],
            tip: '<strong>Match the surroundings</strong> is the one for remaster textures. A lot of them were AI upscaled and carry colour blotches that were never in the original art, green or pink patches that no amount of saturation will fix because they are baked into the pixels. Paint over the patch and it takes the wall’s colour while keeping its grain. Paint the patch itself, not a box around it: the same shift is applied everywhere you painted, so clean texture caught in a sloppy selection comes back over-corrected. It fixes colour, not brightness, so a patch that is also darker stays darker.'
        },
        {
            id: 'draw', icon: '🖌', title: 'Draw',
            what: 'Paints on your texture with a photo editor’s brush. Strokes go on a layer over the tile and nothing changes until <strong>💾 Apply</strong>. Select several tiles first and one stroke runs across all of them, laid out as they sit in the grid, so a blood trail can cross from brick onto stone and on into grass.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Draw…</strong>. For several tiles, select them and right-click one; the entry reads <em>“· N tiles”</em>. Transitions, sets and animation frames inside that area show dimmed and locked: they are rebuilt from their recipe, so paint on them would be lost.',
                'Pick <strong>🖌 Brush</strong>, <strong>🧽 Eraser</strong> or <strong>💧 Pick</strong> (the eyedropper). The colour takes <strong>Hex</strong>, RGB or HSV; <strong>⇄ Swap</strong> and <strong>◩ Default</strong> do what X and D do in Photoshop.',
                'The <strong>Brush</strong> list above the canvas draws each brush as a stroke: <strong>Hard round</strong>, <strong>Pencil</strong>, <strong>Ink pen</strong>, <strong>Liquid</strong> (it pools where you slow down, for blood and oil), <strong>Chalk</strong>, <strong>Dry brush</strong>, <strong>Spray</strong>, <strong>Scratches</strong> and more. Loading one sets the brush\u2019s shape and dynamics and keeps your colour, opacity and smoothing.',
                '<strong>Size</strong>, <strong>Hardness</strong>, <strong>Opacity</strong>, <strong>Flow</strong>, <strong>Spacing</strong> and <strong>Smoothing</strong> work as in Photoshop. <strong>Opacity</strong> caps a whole stroke however often it crosses itself; <strong>Flow</strong> is what each dab lays down, so a low flow builds up. <strong>🎛 Brush dynamics</strong> holds the rest: jitter, scattering, tips, textures, a dual brush, tapers and wet edges.',
                'The layer has its own <strong>Opacity</strong>, <strong>Blend</strong> and <strong>Material</strong>. A material turns what you painted into a material layer on each tile it covers, so blood can be glossy on a matte wall. <strong>Wrap at the edges</strong> carries a stroke off one side and back in on the other, so a seamless tile stays seamless.',
                'The shortcuts are Photoshop’s: <strong>B</strong>, <strong>E</strong>, <strong>I</strong> (or hold <strong>Alt</strong>), <strong>[</strong> and <strong>]</strong> for size, <strong>Shift</strong>+click for a straight line, <strong>Space</strong>+drag to pan, the wheel to zoom, <strong>Ctrl+Z</strong> for the last stroke. Leaving with paint on the layer asks first.'
            ],
            before: 'draw',
            beforeLabel: 'Four tiles selected',
            afterLabel: 'One Liquid stroke across all four',
            tip: 'Apply writes the tiles’ pixels, like <strong>Adjust Colours</strong>: one <strong>Undo</strong> takes the whole Apply back and <strong>Reset to Original</strong> clears it per tile. A mouse has no pressure, so thin ends come from the tapers and from speed: a quick flick with <strong>Ink pen</strong> comes out thinner. A selection wider or taller than 4096 px is refused.'
        },
        {
            id: 'variations', icon: '✨', title: 'Variations',
            what: 'Creates jittered copies (hue / brightness / saturation / contrast / grain / rotation) to break up obvious repetition across a wall or floor. Seeded: the same <strong>Seed</strong> always reproduces the same set.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Create Variations</strong>.',
                'Set the count and the jitters. <strong>Grain</strong> adds a subtle per-copy noise overlay; <strong>Random wrap shift</strong> offsets each copy with wrap-around, so a seamless tile stays seamless but its repeats stop lining up.',
                '<strong>🎲 Shuffle</strong> rerolls the <strong>Seed</strong> (or type one to get the exact same set back later), then click <strong>Add</strong>.'
            ],
            before: 'variations', tip: 'Each variation is a fresh source tile you can edit independently. Variations of a seamless tile keep the seamless badge, every jitter preserves tileability.'
        },
        {
            id: 'buildpattern', icon: '🏗️', title: 'Build Pattern',
            what: 'Turns a plain material, stone, sand, metal, timber, into a <em>built surface</em>: a <strong>brick wall</strong>, <strong>coursed</strong> or <strong>cobbled stone</strong>, a <strong>tile floor</strong>, a <strong>herringbone</strong> weave, <strong>wood planks</strong>, a staggered <strong>plank floor</strong>, roof <strong>shingles / scales</strong> or <strong>metal pipes</strong>. It lays the source into cells split by recessed joints so the result is one fresh tile that <strong>tiles seamlessly</strong>, and because the dark joints sink in, the generated normal / AO / height maps get real depth for free.',
            how: [
                '<strong>Right-click</strong> a source tile → <strong>🏗️ Build Pattern</strong>.',
                'Pick a <strong>Pattern</strong>, regular <strong>Brick</strong>, random <strong>Coursed stone</strong> (varied course heights &amp; stone widths, like ashlar rubble), <strong>Cobblestone</strong> (rounded Voronoi stones with mortar), <strong>Tile</strong>, <strong>Herringbone</strong>, <strong>Planks</strong>, <strong>Plank floor</strong> (boards with staggered butt-joints), <strong>Shingles / scales</strong>, or <strong>Pipes</strong>, and a <strong>Fill</strong>: <strong>Slice</strong> gives each cell a different random crop (most variation); <strong>Overlay</strong> lets the whole texture flow unbroken with just the joints carved over it; <strong>Random from atlas tiles</strong> gives each brick a random <em>different</em> tile from your atlas (mix stone &amp; grass bricks, say).',
                'Set the cell count, the joint <strong>width</strong> and the <strong>Edge irregularity</strong>, a seeded wobble on the joint lines so cells read hand-laid instead of ruler-drawn (masonry defaults higher, planks lower, pipes straight; it stays seamless). Per pattern you also get: brick <strong>aspect</strong> &amp; <strong>row offset</strong> (50% = running bond, 0% = stacked); coursed <strong>course flatness</strong>; cobble <strong>stone roundness</strong>; shingle <strong>overlap</strong>; plank-floor <strong>board length</strong>; a <strong>direction</strong> for planks / floor / herringbone / pipes; and a pipe <strong>cylinder-shading</strong> amount.',
                '<strong>🏚️ Age &amp; deformation</strong> breaks up the machine-perfect grid. Flush and straight is right for a city wall; a temple that has been standing for two thousand years is not. <strong>Course sag</strong> makes rows wander instead of running dead level, and bricks tilt to follow the slope. <strong>Laying jitter</strong> nudges each cell within its joint so nothing lines up exactly. <strong>Tilt</strong> turns cells a degree or two. <strong>Depth variation</strong> pushes them proud or sunk, which becomes real relief in the height and normal maps. <strong>Missing pieces</strong> leaves cells out. <strong>Edge erosion</strong> crumbles corners and edges away, corners first, like real masonry. All of it is seeded and stays seamless, and all of it is off at zero, an existing build is unchanged until you touch a slider.',
                'Under <strong>🧱 Behind the cells</strong>, <strong>Backing</strong> decides what shows through the joints, and through anything <strong>Missing pieces</strong> took out. <em>Blurred source</em> and <em>Flat colour</em> are the old behaviour; <em>Atlas tile…</em> lets you pick another texture from your atlas, clicking <strong>Backing tile</strong> to choose from thumbnails, so sandstone blocks sit on a sandstone wall instead of on a smear. The <strong>Hue shift / Saturation / Brightness</strong> sliders below tint it, drop the brightness to push it back behind the cells. The backing is read when you build the tile and is not linked afterwards, so you can delete it later without touching what you made.',
                'Open <strong>🧱 Mortar / joints</strong> to tune the mortar. The default, <strong>Natural (from texture)</strong>, fills the joints with a blurred, desaturated, darkened copy of the texture itself plus seeded grain, so the mortar shares the material’s character; the <strong>Hue shift / Saturation / Brightness</strong> sliders re-tint it. <strong>Flat colour</strong> is the plain fill (with <strong>🎨 Sample from texture</strong> to pull a darker tint of the source’s own colour). Either way, joints also get a soft ambient-occlusion darkening so they read recessed. <strong>Noise</strong> (Speckle / Grain / Clouds) is seeded and adjustable in both modes.',
                'Add <strong>hue</strong> / <strong>brightness jitter</strong> so cells vary, reroll the <strong>Seed</strong> (<strong>🎲</strong>) until you like it, the preview updates live, then leave <strong>Assign … material preset</strong> ticked and click <strong>➕ Add Tile</strong>.'
            ],
            before: 'buildpattern',
            tip: 'The output already tiles, so you usually don’t need Make Seamless afterwards. Joints come from the diffuse, so darker / noisier mortar automatically deepens and roughens the recesses in the height/normal maps. Overlay fill tiles best from an already-seamless source.'
        },
        {
            id: 'origami', icon: '🪞', title: 'Origami Frame',
            what: 'Folds a texture into a concentric frame: a ridge, stripe or plank texture becomes nested rings, as if the strip were folded around all four edges. Fold lines meet cleanly through the corners.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Origami Frame</strong>.',
                'Pick a <strong>Ring shape</strong> (Square / Diamond / Circle). <strong>Detail axis</strong> tells it which way the source’s ridges run (Auto usually gets it right), and <strong>Repeats</strong> mirrors the source into more nested rings.',
                '<strong>Ring thickness</strong> biases ring widths toward the centre or the rim, <strong>Origin X/Y</strong> moves the fold centre off-middle (the frame still reaches all four edges), and <strong>Outer shape</strong> morphs the rings from one shape at the centre into another at the rim: circle centre flowing into a square frame, say.',
                'Click <strong>➕ Add Folded Tile</strong>, it lands next to the source and inherits its material.'
            ],
            before: 'origami',
            tip: 'Works best on textures with directional detail: planks, mouldings, ridges, rope. The single-texture mode of Borders &amp; Corners uses the same fold to build a whole trim set.'
        },
        {
            id: 'stainedglass', icon: '🪟', title: 'Stained Glass',
            what: 'Splits a tile into glass panes separated by lead came. Colours come from the texture itself (each pane becomes a jewel-toned average of what’s under it) or from a built-in palette, so it works both as <em>stained-glassify this texture</em> and as a from-scratch window generator. The committed tile carries a glass + metal multi-material and an emissive map, so the panes glow in the dark.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>🪟 Stained Glass</strong>.',
                'Pick a <strong>Cell pattern</strong>: <strong>Glass blobs</strong> (organic Voronoi), <strong>Rect / Diamond / Hex quarry</strong> (classic window lattices), <strong>Rose window</strong> (concentric rings and spokes, cathedral style) or <strong>Follow image</strong> (panes trace the picture’s colour regions). Everything except the rose window tiles seamlessly.',
                'Set <strong>Cells across</strong>, <strong>Jitter</strong>, the <strong>Leading width</strong> and the <strong>Came metal</strong>, lead, pewter, copper or gold; this also picks the metal material preset for the strips.',
                '<strong>Glass colours</strong>: <strong>From texture</strong> tints each pane from the source, with <strong>Source detail</strong> blending a faint copy of the original back into the glass; or pick a palette (Jewel, Medieval, Amber, Emerald, Ruby).',
                '<strong>Mottling</strong> streaks each pane so the glass doesn’t read flat, and <strong>Glow strength</strong> sets how bright the emissive map is (0 = no glow map). Reroll the <strong>Seed</strong> (<strong>🎲</strong>), then click <strong>➕ Add Stained Glass Tile</strong>.',
                '<strong>Right-click</strong> the result → <strong>🪟 Edit Stained Glass</strong> to reopen the exact recipe and change it in place.'
            ],
            before: 'stainedglass',
            tip: 'The tile arrives with a two-layer material (glass panes + metal came) and the <strong>Emissive</strong> export map already switched on. Rose windows are centred, so use them as a single wall panel rather than a repeating surface.'
        },
        {
            id: 'pushmarks', icon: '📦', title: 'Pushable Markings',
            what: 'The scrape marks a pushed block leaves on the floor, the hint that tells a player <em>this one moves</em>. From one floor tile it builds a set of 16: every way a track can enter and leave a tile (straight runs, corners, T junctions, a cross, dead ends), with the marks joining up across every tile border. The marks are carved into the height, normal and AO maps as grooves.',
            how: [
                '<strong>Right-click</strong> a floor tile → <strong>📦 Add Pushable Markings…</strong>.',
                'Pick a <strong>Preset</strong> under <strong>Pushed block</strong>: <strong>Scratched tiles</strong>, <strong>Wood grooves</strong>, <strong>Scuffed polish</strong>, <strong>Sand</strong> or <strong>Snow</strong>. Then shape it: <strong>Block shape</strong>, <strong>Track width</strong>, how many <strong>Scratches</strong> and how wide, <strong>Strength</strong>, and <strong>Rigid ↔ Struggle</strong>, from clean ruled lines to a track that wobbles, skips and judders.',
                '<strong>Corners</strong> are <strong>Curved</strong> or <strong>Sharp (L)</strong>. <strong>Dead ends</strong>, where the block stopped, are <strong>Blunt</strong>, <strong>Fade out</strong>, <strong>Fan out</strong> or <strong>Curl</strong>, with an optional outline where it rests.',
                '<strong>Floor style</strong> moves the floor itself along the track: <strong>Sand ripples</strong>, a <strong>Snow channel</strong> with raised sides, or <strong>Liquify (smear)</strong>. <strong>Amount</strong> sets how much.',
                '<strong>Marks from</strong> <strong>A colour</strong> or <strong>An atlas tile</strong> (the marks are cut from that texture). <strong>Mark material</strong> gives the marks their own finish, <strong>Blend</strong> sets how they sit on the floor, and <strong>Groove depth</strong> sets how deep they cut; 0 is colour only.',
                'The <strong>Slots</strong> sheet shows the whole set laid out as it tiles. Untick a slot to leave it out, give it more copies (<strong>×2</strong> to <strong>×4</strong>, the same edges with different scratches inside), click one to see it lit on the right. <strong>🖌 Draw on the set…</strong> opens Draw on the whole sheet, so your own strokes run across slots and still join.',
                '<strong>🎲 Randomize</strong> gives a new set, then <strong>➕ Add</strong>. The tiles arrive as one group; <strong>Right-click</strong> any of them → <strong>Edit Pushable Markings…</strong> reopens it.'
            ],
            before: 'pushmarks',
            beforeLabel: 'The floor tile',
            afterLabel: 'Four tiles of the set: a corner, two T junctions, a cross',
            tip: 'Lara only pushes along the grid, so this is the whole vocabulary a track needs. Every rotation is its own tile with its own scratches, so you never have to rotate a face in Tomb Editor, though you can. The empty slot is your floor tile unchanged, so it starts unticked. Start from a plain floor tile: the set is rebuilt from it whenever it changes, so edit the floor and the set follows. A source with several materials on it keeps its regions on the marked tiles, but not its own <strong>Make Height Map</strong> settings. <strong>🖌 Draw on the set…</strong> works up to 1024px tiles, since it paints the whole 4×4 sheet at once.'
        },
        {
            id: 'drips', icon: '💧', title: 'Drips',
            what: 'A leak running down a wall: oil from a tank, blood from a ledge. It is a second kind of set in <strong>Pushable Markings</strong>, a column of tiles that join top to bottom. Drips stand out of the height map rather than carving in, and take the liquid’s material, so oil is glossy on a dry wall.',
            how: [
                '<strong>Right-click</strong> a wall tile → <strong>📦 Add Pushable Markings…</strong>, then pick <strong>Oil</strong> or <strong>Blood</strong> under <strong>Drips</strong> in <strong>Preset</strong>. The controls switch to drips: <strong>Spread</strong>, how many <strong>Drips</strong> and how wide, <strong>Strength</strong>, <strong>Straight ↔ Wavy</strong>, <strong>Length</strong> and <strong>Thickness</strong>.',
                'The <strong>Slots</strong> sheet becomes one column, top to bottom: your tile above the leak, the source (drips run out of a smear), drips running through, and drips stopping, each on a drop at its own length. Stack them the same way on the wall; use the middle one as often as you need for a long run.',
                'Give each slot more copies for variety, as with the tracks. To start the drips from something of your own (a crack, a pipe), paint it with <strong>🖌 Draw on the set…</strong>.'
            ],
            before: 'drips',
            beforeLabel: 'The wall',
            afterLabel: 'Oil: four copies of the run, top to bottom',
            tip: 'The drips only run down, so the tiles only join top to bottom; a tile to either side should be the plain wall. At <strong>Thickness</strong> 0 the drips add no relief of their own. Choosing a <strong>Pushed block</strong> preset again switches back to tracks.'
        },
        {
            id: 'surfacenoise', icon: '🌾', title: 'Surface noise',
            what: 'Lays procedural grain into a texture: grit, pitting, wood grain, cracks, scuffs, weave. All of it tiles seamlessly, and all of it is optional. Material maps are generated <em>from</em> the diffuse, so a flat or heavily cleaned-up texture gives the map generator nothing to read. This is what gives it something.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>🌾 Surface Noise</strong>. The before/after previews sit side by side.',
                'Pick a <strong>Preset</strong> (Brick grit, Stone pitting, Concrete mottle, Wood grain, Brushed metal, Dust &amp; dirt, Damp stains, Scratches, Fabric weave, Hairline cracks, Film grain). It loads a full recipe you can then take apart.',
                '<strong>Strength</strong> is the subtle-to-dramatic control. <strong>Scale</strong> sets feature size, <strong>Contrast</strong> how hard the grain reads, and <strong>Blend</strong> how it combines: <strong>Overlay</strong> and <strong>Soft light</strong> keep the texture\'s brightness, <strong>Multiply</strong> only darkens (dirt, damp), <strong>Screen</strong> only lightens (scuffs).',
                'Directional types (wood grain, streaks, scratches, weave) get a <strong>Grain direction</strong>. It only offers vertical and horizontal, because rotating the grain off-axis would break the seamless tiling.',
                'Reroll the <strong>Seed</strong> (<strong>🎲</strong>), then <strong>🌾 Apply Noise</strong>. It changes the tile in place; tick <strong>Add as a new tile</strong> to keep the clean one too. <strong>Undo</strong> and <strong>Reset to Original</strong> both take it back.',
                'In <strong>🏗️ Build Pattern</strong> the same engine sits in the <strong>🌾 Surface noise</strong> accordion, off by default. Choosing a pattern suggests a matching preset without switching it on. <strong>Applies to</strong> chooses <strong>Cells only</strong>, which leaves the mortar joints their own grain, or <strong>Whole tile</strong>, which washes over everything.'
            ],
            before: 'noise',
            tip: 'Watch out for double-counting. If the tile also exports material maps, the preset reads this same grain back out of the diffuse and amplifies it through Normal and Roughness, so it lands twice and a value that looked fine in the diffuse can come out as a violently pitted normal map. The tool detects this and the line under <strong>Strength</strong> tells you which case you are in: with maps on, keep it low; on a diffuse-only texture nothing downstream amplifies it, so judge it by eye. It is off by default in Build Pattern on purpose, since most people build bricks from a texture that is already bricky.'
        },
        {
            id: 'heightmap', icon: '🏔️', title: 'Height maps (parallax)',
            what: 'A <strong>height map</strong> drives real <strong>parallax</strong> in Tomb Engine: high points shift in front of low ones as the camera moves, so mortar joints, ladder rungs and carved reliefs genuinely recede instead of being faked by shading. White is the polygon surface, darker is deeper, parallax only ever carves <em>in</em>, it never pushes a texel out in front of the wall.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Material</strong> › <strong>🏔️ Make Height Map…</strong>. The Height sliders in <strong>Set Material</strong> still work; this is the per-texture editor, and it is where the edge controls live.',
                '<strong>What the relief is read from</strong> decides which part of the texture becomes deep. <strong>Light &amp; dark</strong> uses the whole texture. <strong>A colour I pick</strong> and <strong>A hue range</strong> select one thing, click the tile to eyedrop the mortar, say, so the joints carve in while the stones stay flat, which light-and-dark cannot do on a wall whose stones are darker than its joints. <strong>Which side sinks</strong> flips it, and the line underneath spells out what ends up deep and what ends up on the surface.',
                '<strong>Relief depth</strong> is how far the recesses sit below the surface. <strong>Smoothing</strong> blurs the texture before reading it as elevation, raise it if the relief looks noisy, because parallax on fine grain reads as the surface swimming.',
                '<strong>Edges, fade to white</strong> is the part you cannot skip, and it is on by default. Tomb Engine marches the UV <em>out of the texture\'s own box</em> in the atlas page, so without a white border it samples whatever the packer put next door: the black and smeared bars along texture edges. White is the surface plane, so a white border stops the march dead.',
                'The <strong>Band</strong> defaults to what your tile size actually needs and warns if you go under it. This is not a preference: the march is a fixed distance in <em>atlas-page</em> pixels (~36px), so it eats 3.5% of a 1024px texture and 14% of a 256px one. Below 128px there is barely any interior left, which is why parallax wants big textures.',
                '<strong>Profile</strong> shapes the fade. <strong>Smooth</strong> is the default and matches the Tomb Engine team\'s own reference images. <strong>Tight</strong> keeps more interior on large textures, <strong>Rough</strong> wanders in and out for rubble, and <strong>Joint-aware</strong> ends the fade on a mortar line instead of slicing a stone in half, it needs a texture with real coursed joints and quietly falls back to Smooth on anything else.',
                'Untick an edge under <strong>Fade these edges</strong> if the texture never shows it, a floor tile that always meets a wall on one side keeps its detail there.',
                'Paint a region under the tile and <strong>Raise or lower the painted area</strong> pushes it proud or sinks it: an alcove, a deeper joint, a panel. The full paint toolbar is there, and its <strong>Value</strong> slider sets how deep <em>that</em> region goes, so a shallow dent and a deep alcove can live on one tile. The slider itself is the master for all of them.',
                'The <strong>In Tomb Engine</strong> pane is the real parallax shader, not an approximation, and you <strong>grab it and turn it</strong>, live, like any 3D view (arrow keys work too; double-click or <strong>⟳ Reset view</strong> to recentre). Watch the relief flatten as you rotate away: that is what parallax does in game, not a fault in your map. It is deliberately not a 3D model, because Tomb Engine never moves geometry, a parallax wall keeps a flat silhouette, and a displaced mesh would look better and be wrong. Drop <strong>Amount</strong> to 0 to watch the edge artifact appear.'
            ],
            before: 'heightmap',
            beforeLabel: 'White edge off, the texture\'s right border smears',
            afterLabel: 'The shipped default, same parallax, clean border',
            tip: 'Use it sparingly. Parallax is expensive, and it also switches <strong>SSAO off</strong> for that material and disables <strong>bullet holes, explosion marks and other decals</strong> on it. It cannot be combined with animated, double-sided or mirror textures either. A handful of hero surfaces per level, a brick wall you walk past, a ladder, a carved door, not the whole atlas.'
        },
        {
            id: 'animated', icon: '🎞️', title: 'Animated textures',
            what: 'Generates a procedural, seamlessly-<em>looping</em> animation, water, lava, clouds, smoke, energy, plus directional effects like <strong>fire, waterfalls and rivers</strong>, as a group of frames you drop straight into the atlas. This section covers the <strong>noise field</strong> generator; for rain, snow, sparks and drips, and for laying a static texture over an animation, see <a href="#animoverlay">Rain, sparks and overlays</a>. There’s a wide preset library (caustic/deep/boiling water, lava &amp; molten metal, blood, ice, mercury, honey, poison gas, steam, electric plasma, aurora sky…). Every frame also tiles on its own, so you can emit a <strong>single seamless tile</strong> for UV-rotate instead of a sequence.',
            how: [
                'Click <strong>🎞️ Add Animated…</strong> in the grid header.',
                'Pick a <strong>Preset</strong> (Caustic Water, Lava, Clouds, Blood Pool, Frozen Ice, Steam, Electric Plasma, Aurora Sky…). The live preview loops while the 2×2 panel shows it tiling, and a <strong>Suggested material</strong> is applied automatically (emissive presets also switch the <strong>Emissive</strong> export map on).',
                'On the <strong>🌀 Shape &amp; motion</strong> tab choose the <strong>Output</strong>: an <strong>Animated sequence</strong> (set <strong>Frames</strong>, 2–128) or a <strong>Single seamless tile</strong> for UV-rotate. Shape the look with <strong>Style</strong>, <strong>Pattern scale</strong>, <strong>Churn speed</strong>, <strong>Detail</strong>, <strong>Roughness</strong>, <strong>Swirl</strong>, <strong>Contrast</strong> and the <strong>Seed</strong> (<strong>🎲</strong> rerolls).',
                'For things that <em>travel</em> rather than churn in place, set a <strong>Flow direction</strong> (↑↓←→ or diagonals) and <strong>Flow speed</strong>, the field scrolls that way while staying perfectly seamless and looping. <strong>Stretch ↕</strong> elongates the pattern into vertical streaks; together they make fire, waterfalls, rivers, rising smoke and blowing sand (see those presets).',
                'On the <strong>🎨 Colour</strong> tab pick a <strong>Gradient</strong> (mix any palette onto any structure, clouds shape with a lava palette, say), then micro-edit it: <strong>click the bar</strong> to add a colour stop, <strong>drag</strong> handles to move them, and click a stop to set its colour &amp; <strong>alpha</strong> (for transparent smoke/dust). The <strong>Hue / Saturation / Brightness / Contrast / Gamma / Posterize</strong> sliders and <strong>Invert</strong> re-grade the whole ramp.',
                'On the <strong>✨ Glow</strong> tab tick <strong>Emissive glow</strong> to bake a glow map onto every frame. Each frame’s glow is derived from that frame, so it moves with the animation, a lava range glows along its shifting cracks. Choose what glows (<strong>Bright areas</strong> or a <strong>Hue range</strong>), the glow colour (the texture’s own or a flat <strong>Tint</strong>), <strong>Strength</strong> and <strong>Bloom</strong>. Tick <strong>💓 Pulse</strong> to throb the glow on a sine over the loop (set <strong>cycles</strong> and <strong>depth</strong>), a beacon or breathing lava that changes even when the surface barely moves. The <strong>Emissive</strong> export map switches on automatically.',
                '<strong>📼 Glitch</strong>, under the shape sliders, corrupts the field: blocks torn out and dragged elsewhere, pixelated, colour-swapped or inverted, rows torn sideways, the colour channels split apart, scanlines. <strong>Corruption</strong> sets how much, <strong>Block size</strong> how big, and <strong>Bursts</strong> how many separate hits per loop, each held for a few frames; <strong>Calm bursts</strong> leaves some of them clean so the damage comes in fits. <strong>Noise</strong> at 100% keeps the field underneath, and lower mixes in a collage of flat, striped and graded blocks, until at 0% there is no noise at all. Every block wraps round the tile edges, so it still tiles. It is off by default; the <strong>Glitch / Corrupted</strong> and <strong>Glitch Collage</strong> presets switch it on.',
                'Building low-res, in the spirit of the classics? The preview shows real pixels, so a 32 or 64px tile looks chunky here because it <em>will</em> be chunky in-engine. <strong>Preview at</strong> re-bakes at another size (handy for checking how a 256px texture reads at 64) without changing what gets exported. The line under <strong>Detail</strong> tells you how many pixels each feature gets at your tile size, and warns when <strong>Pattern scale</strong> is set so fine the result turns to confetti: as a rule keep it at or under tile size ÷ 8, so 4 at 32px, 8 at 64px. <strong>✨ Crisp</strong> renders at 4× and averages down for a cleaner small tile; it defaults on at 64px and below.',
                '<strong>Frames per row</strong> sets the shape the frames make in the atlas: they land as one block on a fresh row (16 frames at 4 per row is a 4 × 4 block), and the sketch beside it shows the shape. Until you change it, it follows the frame count, as square as the count allows.',
                'Click <strong>Add … Frames</strong>, they’re added as a group (purple <strong>A</strong> badge). <strong>Right-click</strong> any frame → <strong>Edit Animation…</strong> to regenerate, recolour, retune the glow or change the frame count in place.'
            ],
            before: 'anim',
            gallery: [
                { src: 'lava-still.png', cap: 'Lava, one frame' },
                { src: 'lava-anim.gif', cap: 'Animated, looping' },
                { src: 'lava-emissive.png', cap: 'Emissive map, one frame' },
                { src: 'lava-emissive.gif', cap: 'Emissive, looping' },
                { src: 'anim-glitch.png', cap: 'Glitch / Corrupted (top) and Glitch Collage, no noise (bottom), each tiled 2×2' }
            ],
            tip: 'Frames are kept consecutive and loop (last → first). The exported <code>manifest.json</code> lists each animation’s tile range, gradient + fps, so you can set it up as an <em>animated texture range</em> (or <em>UV-Rotate</em>) in Tomb Editor. An animation isn’t one image, it’s <em>N</em> tiles, and every map (normal, emissive, …) exports as a matching atlas with the same layout, so a glow lines up frame-for-frame with the diffuse and animates with it. Deleting one frame removes the whole group, and animations, including the gradient and glow recipe, are saved/restored with your project.'
        },
        {
            id: 'animoverlay', icon: '\u{1F327}', title: 'Rain, sparks and overlays',
            what: 'The same modal, two things the noise field cannot do. The <strong>particle</strong> generator draws individual streaks and specks (rain, drizzle, snow, ash, sparks, embers, bubbles, wall drips) instead of a churning field, and the <strong>\u{1F5BC} Overlay</strong> tab bakes a static texture into every frame: a rim around the water, stepping stones on lava, a grate the liquid shows through, a wall behind the rain.',
            how: [
                'Open <strong>\u{1F39E}\uFE0F Add Animated\u2026</strong> as usual. The <strong>Preset</strong> list has two groups: the noise presets, and <strong>Particles</strong> (<strong>Rain, drizzle</strong>, <strong>Rain, downpour</strong>, <strong>Rain on glass</strong>, <strong>Snow</strong>, <strong>Ash / Cinders</strong>, <strong>Sparks</strong>, <strong>Sparks, twinkling</strong>, <strong>Bubbles</strong>, <strong>Drips</strong>, and the three deep ones below). Picking one swaps the Shape tab over to the particle controls.',
                'Particle controls: <strong>Direction</strong> is a ladder of fixed slants (straight down, 14\u00B0, 18\u00B0, 27\u00B0, 34\u00B0, 45\u00B0 and their mirrors, plus up, left and right). <strong>Amount</strong>, <strong>Speed</strong> and <strong>Depth spread</strong> set how many and how fast, <strong>Streak length</strong>, <strong>Thickness</strong> and <strong>Tail fade</strong> shape each one, and <strong>Brightness spread</strong> stops them all looking identical. Speed reads out in <em>tiles per frame</em>, which is the number that decides whether it falls or strobes, and a line under it warns when a setting is about to break up into dashes.',
                '<strong>Sway</strong> and <strong>Gusts</strong> add drift: sway wobbles each particle on its way down (good for snow and ash), gusts pulse the whole sheet in waves (good for a storm). Both take a whole number of cycles over the loop, which is what keeps the last frame meeting the first.',
                '<strong>Twinkle</strong> makes each particle flash on its own beat, and <strong>Flashes</strong> sets how often: each particle flashes between that number and twice it, minus one, times per loop, so neighbours drift in and out of step. It is off by default. The line under it warns when the flashes outrun the frames: past half the frame count a flash is shorter than a frame and it strobes on and off instead of twinkling. <strong>Sparks, twinkling</strong> ships with it on.',
                '<strong>Size by depth</strong> and <strong>Depth blur</strong> turn a flat streak into something that reads as near or far. Every particle already carries a depth (it is what <strong>Depth spread</strong> sorts them by, so the near ones fall faster), and these two read the same number: far particles come out smaller and dimmer, and the far planes get softened while the nearest stays sharp. Both are off by default. They are aimed at 256px and up, because at 128 or below a blurred particle is just a smudge. <strong>Rain on glass (deep)</strong>, <strong>Rain, soft slant</strong> and <strong>Snow, deep</strong> ship with both on, and Rain on glass runs at <strong>Speed</strong> 0, which is beads holding on the glass rather than rain falling past it.',
                'To lay a texture over it, go to the <strong>\u{1F5BC} Overlay</strong> tab, tick <strong>Lay a texture over this animation</strong> and click <strong>Texture</strong> to pick one from your atlas by its thumbnail. <strong>Where it sits</strong> chooses in front (a grate over lava) or behind (a wall behind rain). The texture stays live: edit it later and every frame updates. It can be a transition tile too, a grate already blended into a wall, and editing either of that transition\u2019s textures updates the animation as well.',
                '<strong>Where it shows</strong> is the same colour / hue / brightness picker as Make Emissive. <strong>All of it</strong> uses the texture\u2019s own transparency, which is what a cut-out grate or rim already has. <strong>Read colours from</strong> decides which of the two is sampled, and reading <em>the animation</em> makes the coverage follow the moving image frame by frame, which is how a splash follows the water.',
                '<strong>Where the surface is deep or raised</strong> is the mode that puts liquid into a wall rather than over it. It builds a height field from the texture, the same way the height-map transition does, and shows the texture on one side of a threshold: on <strong>the raised parts</strong> the bricks stay dry and the animation finds the mortar joints and the cracks. <strong>Detail</strong> is what decides whether that works, because it is a blur radius in pixels and a joint narrower than it gets smoothed away first (mortar is 2 to 3 px at 256); the line under the sliders gives you the radius for your tile size. This mode reads the texture and never the animation, so there is no <strong>Read colours from</strong> with it. If the texture already has a height map from <strong>\u{1F3D4}\uFE0F Make Height Map</strong>, that one is used instead of a second derived one.',
                '<strong>\u{1F30A} Moving level</strong> sweeps a line across the tile over the loop and hides the texture behind it, so the animation floods over and drains back: lava climbing out of a grate. Pick a <strong>Direction</strong>, a <strong>Motion</strong> (smooth, or rise-hold-fall-hold), the <strong>Low</strong> and <strong>High</strong> reach and how many <strong>Cycles</strong>. A straight line cannot repeat across the edge it travels towards, so use <strong>Spreads out from the shape</strong> if the tile has to tile. Turn it on while <strong>Where the surface is deep or raised</strong> is selected and it stops sweeping a line: it drives the depth threshold instead, so the liquid rises and falls through the texture\u2019s own relief.',
                'How long all of this takes is arithmetic, and the tool now says it. A loop lasts <em>frames divided by fps</em>, so the default 16 frames at 12 fps is 1.3 seconds, and the line under <strong>Preview speed</strong> prints that as you change either. <strong>Cycles</strong> divides it again, and cannot go below 1 because a whole number of cycles over the loop is what makes the last frame meet the first. To slow something down you have four levers: lower the <strong>fps</strong> (which slows the churn with it), add <strong>Frames</strong> up to 128 (one atlas tile each, and it decouples the two), set <strong>Repeat</strong> on the frames in Tomb Editor (it holds each frame for several ticks and costs no atlas space at all, only frame slots out of the engine\u2019s 256), or narrow <strong>Low</strong> and <strong>High</strong> so the swell covers less ground in the same time, which costs nothing.',
                '<strong>\u{1F33F} Organic edge</strong> roughens whichever contour the overlay has, the edge of <strong>Where it shows</strong> and the level line, into a ragged water line or creeping grime. Same panel as the transition sets: <strong>Amount</strong>, <strong>Scatter</strong>, <strong>Feature size</strong> and five edge styles. <strong>Contact shadow</strong> darkens whatever sits <em>under</em> the texture, so a rim shades the water it stands in; send it to the <strong>AO map</strong> rather than the diffuse if you are exporting relief maps.',
                '<strong>\u{1F39E}\uFE0F Second animated layer</strong>, at the top of the modal, runs a second generator in the same animation: steam in front of lava, rain over a flickering fire. <strong>Edit layer 1</strong> and <strong>Edit layer 2</strong> point the <strong>Preset</strong>, <strong>Shape</strong> and <strong>Colour</strong> tabs at one layer or the other, and each keeps its own settings while you edit the other. <strong>Layer 2 sits</strong> behind layer 1, in front of it, or <strong>On top of everything, the overlay too</strong>, which is how steam goes over the grate the lava shows through. Both layers share the frame count, so the loop still closes and nothing extra goes into the atlas. Give layer 2 a gradient with a transparent end, or it hides layer 1.',
                '<strong>Emissive-only</strong>: on the <strong>\u2728 Glow</strong> tab, set <strong>Diffuse</strong> to <strong>A static texture, only the glow moves</strong> and pick the texture. Every frame then shows that texture unchanged, with the same material maps, and only its glow animates: blinking panels, pulsing runes, lit windows that flicker. <strong>Glow follows</strong> either <strong>The pulse</strong> (the glow tab\u2019s own pulse, so turn <strong>Pulse</strong> on) or <strong>The animation\u0027s brightness</strong>, which runs the moving field across the glowing parts. What glows is still picked by the controls below it, from the static texture.',
                'Click <strong>Add \u2026 Frames</strong>. Everything above is stored on the animation, so <strong>Right-click</strong> \u2192 <strong>Edit Animation\u2026</strong> reopens it with the overlay, level and organic settings intact.'
            ],
            before: 'animoverlay',
            beforeLabel: 'Lava on its own',
            afterLabel: 'Grate baked in, lava rising',
            gallery: [
                { src: 'anim-rain.png', cap: 'Rain over a wall (the wall is the overlay, behind)' },
                { src: 'anim-organic.png', cap: 'The same lava line with an organic edge, Drips style' },
                { src: 'anim-particle-depth.png', cap: 'The same rain with the depth sliders off, then on' },
                { src: 'anim-depth.png', cap: 'Lava rising through a brick wall\u2019s own mortar' },
                { src: 'anim-twinkle.png', cap: 'Sparks, twinkling: six frames, each spark on its own beat' },
                { src: 'anim-layer2.png', cap: 'Two layers: lava under the grate, steam on top of everything' },
                { src: 'anim-still.png', cap: 'Emissive-only: the glow map alone, three frames. The windows stay put, their light ripples' }
            ],
            tip: 'An overlay forces the <strong>Animated sequence</strong> output. UV-rotate scrolls the whole texture, so a rim baked into the tile would slide around with the water, and <strong>Single seamless tile</strong> is disabled while one is set. Tomb Engine only swaps UVs, it has no way to layer two textures at runtime, so anything on top has to be baked into every frame, and a second variant (lava, and lava with stepping stones) costs a second full set of tiles. The material maps follow <em>where the texture shows</em> and ignore the blend mode: a multiply pass changes how a surface looks, not what it is.'
        },
        {
            id: 'materials', icon: '🎨', title: 'Materials (PBR)',
            what: 'Assigns a material so the tile exports Normal / AO / Specular / Roughness (and more) maps for Tomb Engine.',
            how: ['<strong>Right-click</strong> a tile → <strong>Set Material</strong>.', 'Pick an aesthetic (<strong>Realistic</strong>, <strong>Decal</strong> for thin transparent surfaces like cobwebs/dust/leaves, <strong>Fantasy</strong>, …) and a preset, or tweak the advanced sliders.', '<strong>Drag</strong> the lit preview to move the light and check how it reads.', 'In <strong>Export</strong>, tick which maps to generate. The <strong>Height</strong> map drives parallax, it’s GPU-heavy, so prefer it per-texture; when it’s on, keep <strong>Fade height edges to white</strong> ticked: white is the wall’s own surface, so parallax stops at the texture’s border instead of reading into whatever sits next to it in the atlas.'],
            before: 'materials', widget: 'maps',
            tip: 'Any tile with transparency gets flat maps inside its holes, whatever the preset, so cutout edges don’t get embossed. Transition &amp; Wang tiles inherit materials from their sources.'
        },
        {
            id: 'saved-materials', icon: '⭐', title: 'Save & reuse materials',
            what: 'Dial in a material once, a preset plus any advanced-slider tweaks, then <strong>save it as your own preset</strong> and reapply it to any tile, in this project or the next. No more re-tuning the same sandstone on every batch.',
            how: [
                'In <strong>Set Material</strong>, pick a preset and tweak the sliders until it reads right, then click <strong>⭐ Save as preset…</strong> and give it a name.',
                'Your presets live under the <strong>⭐ My presets</strong> aesthetic, and also appear as one-click chips along the top of <strong>Set Material</strong> once you have saved any. Click a chip to load that preset, then <strong>Assign Material</strong>. <strong>Rename</strong> or <strong>Delete</strong> from the same bar.',
                'Use <strong>⬇ Export</strong> to save your whole preset set to a JSON file, and <strong>⬆ Import</strong> to load it on another machine or share it with your team.'
            ],
            tip: 'Saved presets are <em>baked into</em> the tile when you assign them, so a tile keeps its look even if you later edit or delete the preset. Presets are stored in your browser, <strong>Export</strong> them if you want a backup.'
        },
        {
            id: 'paint-tools', icon: '🖌', title: 'The paint tools (shared by every brush)',
            what: 'Nine places in the tool let you paint a region: <strong>Set Material</strong>\u2019s multi-material layers, <strong>Make Emissive</strong>, <strong>Heal</strong>, <strong>Fade to Transparent</strong>, <strong>De-light</strong>, <strong>Make Height Map</strong>, <strong>Overlay Texture</strong>, <strong>Adjust Colours</strong>\u2019 Paint a region, and a transition\u2019s custom mask. They all run the same toolbar, so what you learn once works everywhere: the same tools, the same modifier keys and the same undo.',
            how: [
'<strong>🖌 Brush</strong> paints freehand; <strong>Edge softness</strong> feathers the stroke, and 0% is a crisp edge. <strong>🪨 Stamp</strong> lays an irregular blob instead of a disc, for things that should not look drawn: moss, rust, rubble, pitting. Click for one, drag for a scattered run. <strong>Roughness</strong> takes it from a clean pebble to a ragged clump, and no two are the same shape.',
                '<strong>🪢 Lasso</strong> takes either gesture and you can mix them in one outline: click to drop straight corners, or press and drag to trace freehand. It closes and fills when you land on the <em>start dot</em>, or press <strong>Enter</strong>. <strong>Escape</strong> throws the outline away. <strong>▭ Rect</strong> and <strong>⬭ Ellipse</strong> just drag.',
                '<strong>🪄 Wand</strong> grabs a colour region. A plain click <em>replaces</em> what was selected, <strong>Shift</strong>+click adds another region and <strong>Alt</strong>+click removes one. Raise <strong>Tolerance</strong> to take in more of the texture; untick <strong>Only the patch I click</strong> to take that colour everywhere in the tile.',
                '<strong>Alt</strong> erases with any tool while you hold it, so you do not have to keep switching <strong>🖌️ Paint</strong> / <strong>🧽 Erase</strong>. <strong>Ctrl+Z</strong> and <strong>Ctrl+Shift+Z</strong> undo and redo inside the modal, per stroke rather than per dab.',
                'Two surfaces add a slider for <em>how much</em> the stroke lays down, named after what it paints: <strong>Brightness</strong> in Make Emissive, <strong>Depth</strong> in Make Height Map. Paint one area at 100 and another at 30 and you get a bright glow and a dim one, or a deep alcove and a shallow dent, on the same tile. Overlapping strokes stay at the level you set instead of building toward full.'
            ],
            before: 'painttools',
            beforeLabel: 'One intensity for the whole map',
            afterLabel: 'Three stamps painted at Brightness 100, 55 and 25',
            tip: 'The slider marked <strong>Master strength</strong> (Emissive) or <strong>Raise or lower</strong> (Height) scales <em>everything</em> at once, painted areas included. Use <strong>Brightness</strong> / <strong>Depth</strong> for the difference between regions and the master for the overall level. Note you cannot paint a lower level over a higher one, erase that area first.'
        },
        {
            id: 'multi-material', icon: '🎭', title: 'Multiple materials on one tile',
            what: 'A single texture often mixes surfaces, a wall that is <strong>brick + a wooden door + a metal knob</strong>. Multi-material lets you paint a different material onto each region, so the brick reads as stone, the door as wood and the knob as metal in one tile.',
            how: [
                'In <strong>Set Material</strong>, tick <strong>🎭 Multiple materials</strong>. The <strong>Base</strong> layer covers the whole tile, set its material (e.g. Brick) with the normal controls.',
                '<strong>＋ Add layer</strong> for each extra surface, then <strong>select where it applies</strong> using the shared paint tools above, brush, stamp, lasso, rectangle, ellipse or wand. With a layer selected, the material controls below edit <em>that</em> layer.',
                '<strong>Order matters</strong>, layers stack bottom→top, each painting over the ones beneath. For a wall it’s <em>Base = Brick → Wooden door → Metal knob</em>. Reorder with ▲▼, soften a boundary with <strong>Feather</strong>, then <strong>Assign</strong>.'
            ],
            tip: 'The lit preview and 🧊 3D preview show the <em>composited</em> result as you paint, so you can see brick meet wood meet metal. Transition/Wang tiles inherit materials and so don’t take layers. Each tile’s layers are saved in your project file.'
        },
        {
            id: 'transparency', icon: '🫥', title: 'Transparency & decals',
            what: 'Make parts of a texture see-through: fences, grates, foliage, cobwebs, dust. Transparency is stored in the texture’s <em>alpha</em>, a fourth value per pixel from 0 (clear) to 255 (solid). Export as PNG or TGA and it travels with the texture. How Tomb Engine then draws it is up to the blending mode you pick in Tomb Editor: see the suggestion below.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Fade to Transparent</strong>; choose <strong>Edges</strong> (vignette), a <strong>Direction / slope</strong>, or paint a <strong>Custom</strong> area, then click <strong>Apply Fade</strong>. The preview’s checkerboard shows exactly where the tile has become transparent.',
                'Transitions and Wang sets keep alpha too: blending a transparent texture stays transparent.',
                'In <strong>Export</strong>, <strong>PNG</strong> and <strong>TGA</strong> keep the alpha. Magenta is how the old editor marked clear pixels; Tomb Editor reads real alpha, which is simpler. If you still work with magenta, tick <strong>Magenta color-key</strong>, and Tomb Editor’s <strong>Magenta to alpha</strong> (Level Settings, on by default) turns exact 255, 0, 255 back into clear pixels. A resaved or resampled magenta will not key, and a magenta you wanted in a texture gets punched out.'
            ],
            gallery: [
                { src: 'transparency-before.png', cap: 'Leaf tile (opaque)' },
                { src: 'transparency-after.png', cap: 'Faded edges → transparent', checker: true }
            ],
            tipLabel: 'Performance suggestion',
            tip: 'Tomb Editor’s <strong>Blending mode</strong> dropdown (texture panel, set to <strong>Normal</strong> unless you change it) decides how each face is drawn, and the choices cost different amounts:<ul>'
                + '<li><strong>Alpha Test</strong> is cheap. Anything more than half solid is drawn fully solid, which hardly shows on holes: fences, grates, plants, a window frame. On a fade it shows as a step where the fade crosses half.</li>'
                + '<li><strong>Normal</strong> on a texture with partly see-through pixels is drawn blended (Alpha Blend; there is no separate entry for it). It keeps glass, curtains, smoke and faded edges looking right, but it is sorted every frame, so it costs more when there are many of them.</li>'
                + '<li><strong>Additive</strong> is cheap too. Black and clear parts vanish and the rest brightens what is behind, which suits light shafts, fog and pale cobwebs.</li>'
                + '</ul>Blending is per face, so the opaque textures on the same atlas are not affected by any of it.'
        },
        {
            id: 'emissive', icon: '✨', title: 'Emissive (glow)',
            what: 'Authors a glow map so parts of a tile shine on their own, lava, neon, runes, screens, lit windows, independent of scene lighting.',
            how: [
                '<strong>Right-click</strong> a tile → <strong>Make Emissive</strong>.',
                'Choose what glows: <strong>Pick a colour</strong> (eyedrop the preview), a <strong>Hue range</strong>, <strong>Bright areas</strong>, or <strong>Paint</strong> it by hand.',
                'Colour it with the <strong>Texture’s own colours</strong> or a flat <strong>Tint</strong>, set <strong>Master strength</strong> and <strong>Feather / bloom</strong>, then click <strong>Apply</strong>, the <strong>Emissive</strong> export map switches on automatically.',
                'In <strong>Paint</strong> mode the toolbar carries a <strong>Value</strong> slider. That is what makes one rune brighter than the next: <strong>Master strength</strong> scales the whole map together, <strong>Value</strong> is per region. See <em>The paint tools</em> above.'
            ],
            before: 'emissive',
            tip: 'The preview sits on black because emissive is what you still see in the dark. Most materials glow nowhere, use it only for light sources and effects.'
        },
        {
            id: 'roomview', icon: '🏛', title: 'Room View',
            what: 'Opens your atlas on real Tomb Raider room geometry, lit the way Tomb Editor bakes a room and shaded the way Tomb Engine draws one. It is the only preview here that can show you what the material maps do <em>in a room</em>, because a tile preview always lights the tile directly and a room does not.',
            how: [
                'Slice an atlas, then click <strong>🏛 Room View</strong> on the toolbar. It opens a second window and carries your atlas and its maps across. Press it again after editing and the same window refreshes, it does not open a second one.',
                'Texture it the way you would in Tomb Editor: pick a tile on the right, then <strong>drag across faces</strong> to paint them. Hold <strong>Shift</strong> and drag a box to select a group, <strong>Alt</strong> to take faces back out, then <strong>Apply to selection</strong>. <strong>Apply to all</strong> does a whole role (walls, floors, ceilings) at once. One tile covers one sector, and a short face shows the part of the tile it covers rather than a squashed copy.',
                'Lights live in the strip along the bottom. Add a <strong>Point</strong>, <strong>Spot</strong>, <strong>Sun</strong> or <strong>Shadow</strong>, set its colour, <strong>Intensity</strong>, ranges and angles, and drag the coloured handles in the view to move it. A <strong>Sun</strong> and a <strong>Spot</strong> get a yellow handle to aim them instead, since direction is all a sun has.',
                '<strong>Quality</strong> is how many shadow samples a bulb takes. Leave it on <strong>Default</strong> while you work; the view drops to it during a drag anyway and goes back to full when you let go.',
                '<strong>🔥 Flame emitters</strong> are the one light that reaches room geometry while the room is running. Tick <strong>Carry it in a circle</strong> to walk one around the room and watch your maps under a moving light.',
                'The map checkboxes on the left turn <strong>Normal</strong>, <strong>AO</strong>, <strong>Specular</strong>, <strong>Roughness</strong> and <strong>Emissive</strong> on and off one at a time, so you can see what each one is actually worth on this texture.',
                '<strong>🌅 Time of day</strong> swings the first <strong>Sun</strong> through a day and re-lights as it goes, with <strong>Play</strong> to animate it. The angles are Tomb Editor’s <strong>Dir X</strong> and <strong>Dir Y</strong>. <strong>Warm at the horizon</strong> is ours, not the editor’s, so untick it to see the sun you actually built.'
            ],
            before: 'roomview',
            tip: 'The example above is the same room, the same camera and the same two flames, with the maps off and then on. Notice where the difference is: on the floor the flames reach, and almost nowhere else. That is not this preview being cautious, it is how a room works. A bulb you place in Tomb Editor reaches room geometry only through vertex colours baked at compile time, and a vertex colour cannot respond to a normal map. <strong>Normal</strong>, <strong>Specular</strong> and <strong>Roughness</strong> are read only where a dynamic light reaches, which in a real level means a flame, a flare or gunfire. <strong>AO</strong> and <strong>Emissive</strong> work everywhere, because one multiplies the finished pixel and the other is added to it. The panel says which case you are in as you tick the boxes.'
        },
        {
            id: 'export', icon: '📦', title: 'Export & projects',
            what: 'Export the diffuse atlas plus a matching atlas per material map, in your chosen format, or save your whole session to resume later.',
            how: [
                'Set the <strong>Project name</strong> first. It names everything: the atlas, every material map, the per-tile files and the saved project. Use the folder name you want under <code>assets/textures</code>.',
                'Pick the maps, a <strong>Format</strong> (<strong>PNG</strong> keeps transparency · <strong>TGA</strong> 32-bit, keeps it too · <strong>PSD</strong> packs the diffuse + every map as layers), and an <strong>Export layout</strong> (<strong>Flat ZIP</strong> or <strong>TombEngine</strong> <code>Textures/</code>).',
                'Transparent textures keep their alpha. <strong>Magenta color-key</strong> turns the clear pixels magenta instead, for anyone who works that way; <em>Transparency &amp; decals</em> above has the details, and what to pick in Tomb Editor.',
                'Click <strong>Export Atlas with Material Maps</strong> for a ZIP (atlas + maps + manifest). <strong>Include the project file</strong> is on by default, so the ZIP also carries the <code>.atlasproj.json</code> and can be reopened and edited later.',
                '<strong>Save Project</strong> asks for a name, then downloads <code>yourname.atlasproj.json</code> with every tile, material and transition. <strong>Load Project</strong> restores it, name included.',
                '<strong>Load Project</strong> takes either file: the <code>.atlasproj.json</code>, or an export ZIP that was made with the project file included. One ZIP is both the textures you ship and the session you keep editing. If you have unsaved edits, it asks before replacing them.',
                'To edit tiles elsewhere, use <strong>Export Tiles Individually</strong> (one image per tile + any enabled maps, named <code>tile_r{row}_c{col}</code>), or right-click a single tile → <strong>Download PNG</strong>; bring edits back with <strong>Replace Image</strong>. With <strong>PSD</strong> selected you get one layered PSD per tile instead, maps included.',
                'The tool autosaves to your browser as you work. If it crashes or you close the tab by accident, the next visit offers to restore that session. It is a safety net, not a filing system: one session is kept, and saving to a file clears it. The <strong>Session</strong> block at the top of the left rail shows when it last saved and how much is held, with <strong>Clear stored session</strong> to drop it by hand.',
                'Browsers can discard stored data when disk space runs low. <strong>Protect from cleanup</strong> asks yours not to, Firefox will ask your permission, Chrome decides on its own. Optional either way: it only affects the autosave, never your files.'
            ],
            tip: 'An <strong>● unsaved changes</strong> marker sits next to <strong>Save Project</strong> whenever you have edits that are not in a save file, and the browser asks before you close the tab. Autosave covers crashes, not backups, clearing your browser data deletes it, so keep real work in exported files.'
        },
        {
            id: 'filetypes', icon: '🗂️', title: 'File types',
            what: 'What each format does on the way in and on the way out, and which one to reach for.',
            how: [
                '<strong>PNG</strong>, lossless, keeps alpha. Loads and exports. This is the default and the right answer unless you need something specific.',
                '<strong>TGA</strong>, lossless, 32-bit, keeps alpha. Loads and exports. Uncompressed, so files are several times larger than the same PNG.',
                '<strong>JPG</strong>, loads only, never exports. Lossy: it throws away detail every time it is saved, and the damage accumulates across saves. It also has no alpha. Fine as a photo you are about to turn into a texture, bad as the texture itself.',
                '<strong>BMP</strong> and <strong>WebP</strong>, load only. Both come in fine; pick PNG or TGA to go back out.',
                '<strong>PSD</strong>, loads and exports, with layers. Exporting as PSD packs the diffuse and every enabled map into one file as separate layers instead of writing a folder of images.',
                'Loading a PSD reads those layers back. Any layer named <code>diffuse</code>, <code>normal</code>, <code>ao</code>, <code>specular</code>, <code>roughness</code>, <code>emissive</code> or <code>height</code> is picked up as that map, as is any layer whose name ends in the export suffix (<code>_n</code>, <code>_ao</code>, <code>_s</code>, <code>_r</code>, <code>_e</code>, <code>_h</code>). Everything else is ignored.',
                'An imported map <em>replaces</em> the one the tool would have generated. Export a PSD, repaint the normal map by hand in Photoshop, load it back, and your version is what ships. Slicing an atlas PSD cuts every map layer on the same grid, so tile positions stay lined up.',
                '<strong>Replace Image</strong> drops a tile\'s imported maps, since they described the old pixels. Resetting a tile keeps them: they came in with the file.'
            ],
            tip: 'PSD is the slow one. PNG, JPG and the rest are decoded by the browser itself; PSD is parsed and written in JavaScript, so a large atlas takes noticeably longer both ways. It runs in the background and will not freeze the tool, and the library it needs (about 170 KB) downloads the first time you touch a PSD and not before. If a PSD loads blank or flattens oddly, it was probably saved with <em>Maximize PSD File Compatibility</em> switched off, the tool rebuilds the image from the layers, but unusual blend modes can only be approximated. Flatten a copy in Photoshop if you need an exact match.<br><br>Please contact me if you face issues, PSD implementation threw a fit a couple of times!'
        },
        {
            id: 'accessibility', icon: '♿', title: 'Accessibility',
            what: 'The header has a <strong>Font size</strong> control (A− / A / A+) and a <strong>Dark / light mode</strong> toggle. Both persist, and this tutorial follows them too.',
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
 <p style="font-size:0.85rem;opacity:0.85;">Atlas Tool is <strong>MIT licensed</strong> (see <code>LICENSE</code>), all of it, including the seamless-tiling shaders. It was GPL-3.0 until 2026-09-13 because two shaders were ported from Materialize; those were replaced with independent implementations, so there are no copyleft strings on reusing anything the tool ships. TgaBuilder's reused code is MIT. Full notices ship in <code>THIRD-PARTY-NOTICES.md</code>.</p>`
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

    /* Drag-to-wipe before/after comparison (clip-path based).
       `labels` is optional: most pairs are self-evident, but some show a subtle
       difference where naming what you are looking at is the whole point. */
    function buildCompare(name, labels) {
        const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
 const capBefore = labels && labels[0] ? esc(labels[0]) : 'Before';
 const capAfter = labels && labels[1] ? esc(labels[1]) : 'After';
 const wrap = el('div', 'tut-compare');
 wrap.innerHTML = `
 <div class="tut-badge">🖐 Test for yourself</div>
 <div class="cmp-frame" style="--pos:50%">
 <img class="cmp-before" alt="before" src="${IMG}${name}-before.png" draggable="false">
 <img class="cmp-after" alt="after" src="${IMG}${name}-after.png" draggable="false">
 <div class="cmp-divider"></div>
 </div>
 <input type="range" class="cmp-range" min="0" max="100" value="50" aria-label="Reveal amount, drag to compare before and after">
 <div class="cmp-foot"><span>${capBefore}</span><span>${capAfter}</span></div>`;
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
 <img class="ex-after" alt="after" src="${IMG}${name}-after.png" draggable="false">
 </div>
 <div class="ex-cap">before&nbsp;⇄&nbsp;after</div>`;
 return wrap;
 }

 /* Interactive material-maps demo: tick which maps to generate for a brick
 texture and see them rendered live by the real engine. */
 function buildMapsWidget() {
 const wrap = el('div', 'tut-maps');
 wrap.innerHTML = `
 <div class="tut-badge">🧪 Try it, generate maps</div>
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
 <p class="tut-maps-note">Left is the flat shaded preview; right is a real <strong>3D engine</strong> (Babylon.js) that displaces a mesh by the height map, drag to orbit, scroll to zoom. It loads when this section scrolls into view.</p>`;
 setTimeout(() => initMapsWidget(wrap), 0);
 return wrap;
 }

 function initMapsWidget(wrap) {
 const grid = wrap.querySelector('.tut-maps-grid');
 const E = window.TRLE && window.TRLE.Engine;
 if (!E || !E.init(document.getElementById('tut-gl'))) {
 grid.innerHTML = '<p class="tut-maps-note">This live preview needs WebGL 2.0. Open the tool itself to try it.</p>';
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
        const setStatus = m => { if (status) status.textContent = m ? ', ' + m : ''; };
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
            } catch (err) { console.error('[tutorial 3D preview]', err); setStatus('error, see console'); }
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
                demo.appendChild(buildCompare(s.before, [s.beforeLabel, s.afterLabel]));
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
            if (s.tip) sec.appendChild(el('div', 'tut-tip', `<strong>${s.tipLabel || 'Tip'}:</strong> ${s.tip}`));
            main.appendChild(sec);
        });

        // ── About / colophon, behind a clear "end of tutorial" divider ──
        const divider = el('div', 'tut-about-divider');
        divider.innerHTML = '<span>End of tutorial, About the tool</span>';
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
