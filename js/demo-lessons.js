/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. MIT Licensed (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — demo course content

   DATA ONLY. No behaviour lives here; `demo-runner.js` executes it and
   `demo.js` renders it. It is data because `tools/validate-demo.mjs` has to
   READ it to prove every modal and context-menu action is either taught,
   scheduled, or explicitly excluded — a coverage check cannot read imperative
   script, and the Learn pages' prose-only rule is exactly what it is fixing.

   ---- Step shape -------------------------------------------------------
     id        stable, used by the resume key
     title     rail heading
     say       HTML; the explanation. Tone follows CLAUDE.md's Learn rules:
               technical, casual, concise. <strong> only for literal UI
               controls, <em> for concept emphasis, and NO em dashes at all
               (they were swept out of every user-facing string on 2026-09-17
               after user complaints; use a comma, a colon or parentheses).
               Code comments like this one are not user-facing and keep theirs.
               And NO "X is not Y, it is Z" (banned 2026-09-28): say what a
               thing is and does. audit-lesson-copy.mjs flags it.
     covers    what this step teaches: 'action:<data-action>' | 'modal:<id>'
               | 'ui:<thing>'. The validator's registry.
     requires  'pristine' | 'loaded' | 'sliced' — the EXACT sandbox state this
               step needs. The runner resets the frame if it has gone past it,
               so any step can be reached from any other, in either direction.
     setup     async (api) => …   anything else the step needs set up
     rails     'left' | 'right' | 'both' — show the TOOL's own side rails for
               this step. Absent means hidden, which is the default in the
               course: Session + Messages (left) and History (right) cost 500px
               of a 1400px frame and no step is talking about them until the one
               that teaches them.
     spotlight CSS selector inside the frame, or { modal: '<name>' },
               { grid: <index> }, or null
     spotlightAfter  where to move the ring once `act` has run — for actions
               that destroy what they were pointed at (Slice collapses the card
               holding its own button)
     sweep     { id, from, to, ms }  animate one control (see the cadence rule)
     act       async (api) => …   a scripted click or other one-shot action
     handoff   HTML; what to try yourself. Its presence is what makes the step
               end in free play rather than in another animation.
     expectState  { '<control id>': value } — what the step CLAIMS it set up, in
               the framed tool's own DOM. The runner ignores it; validate-demo
               compares it after the step settles. Opt in wherever a `setup`
               does real work, because "the ring landed on the panel" is also
               true of a setup that silently did nothing, which is what a
               `setup` looks like when it breaks. Booleans read `checked`,
               anything else reads `value`.

   ---- Why the cadence rule exists --------------------------------------
   `sweep` does NOT dispatch one `input` per frame. Measured on the real tool
   (docs/demo/plan.md §1.2): Build Pattern took 56 per-frame dispatches and
   re-rendered ONCE, because its 80 ms trailing-edge debounce never fires while
   something resets it every 16 ms. Set Material was 62 -> 1 against a 250 ms
   debounce. The runner moves the handle every frame and dispatches on a timer
   derived from the frame's own debounce, so the preview actually keeps up.
   ============================================================ */
window.TRLE = window.TRLE || {};

/* Assets every lesson may use. Fetched when a lesson opens, never on page load. */
TRLE.DemoAssets = {
    atlas:       'Examples/ExampleAtlas.png',   // 16 tiles, 4x4, 256px
    notSeamless: 'Examples/NotSeamless.png',
    pulleyMural: 'Examples/PulleyMural.png',
    metalGrate:  'Examples/MetalGrate.png',
    bakedLight:  'Examples/BakedLighting.png'
};

/* ExampleAtlas.png, row-major and 1-indexed, so a step can say "tile 12" and
   mean something. Kept beside the lessons because it is lesson content. */
/* Lesson 2's bench: six textures, each carrying one specific problem, so every
   step has something real to fix rather than a tool shown off on a texture that
   did not need it. Two are cut out of the sample atlas (`cell` is [col, row])
   because that pair only means anything together — the same sand, two tones. */
TRLE.DemoCleanupSet = [
    'Examples/NotSeamless.png',                                        // 1 - visible tiling seam
    'Examples/PulleyMural.png',                                        // 2 - black hole to heal
    { src: 'Examples/ExampleAtlas.png', cell: [0, 1], cellSize: 256 }, // 3 - sand, darker
    { src: 'Examples/ExampleAtlas.png', cell: [1, 1], cellSize: 256 }, // 4 - sand, lighter
    'Examples/BakedLighting.png',                                      // 5 - lighting baked in
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }  // 6 - brick, for grain
];

/* Lesson 3's bench: one source per generator, picked so each step's result is
   obviously the thing that generator is for. Cells are [col, row] in the 4x4
   sample atlas. */
TRLE.DemoGenerateSet = [
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }, // 1 - brick, for Build Pattern
    { src: 'Examples/ExampleAtlas.png', cell: [3, 1], cellSize: 256 }, // 2 - planks
    { src: 'Examples/ExampleAtlas.png', cell: [0, 0], cellSize: 256 }, // 3 - roof tiles, for shingles
    { src: 'Examples/ExampleAtlas.png', cell: [2, 0], cellSize: 256 }, // 4 - stone floor, for Variations
    'Examples/Stonetiles.png',                                         // 5 - cobble, for Origami
    { src: 'Examples/ExampleAtlas.png', cell: [2, 1], cellSize: 256 }  // 6 - grass, colour for the glass
];

/* Lesson 4's bench, shared by both halves so switching between them does not
   rebuild it. Tiles 1 and 2 are the terrain pair every transition tool blends;
   3 and 4 are the fill and trim a border set needs, which is a different job. */
TRLE.DemoBlendSet = [
    { src: 'Examples/ExampleAtlas.png', cell: [2, 1], cellSize: 256 }, // 1 - grass, the base
    { src: 'Examples/ExampleAtlas.png', cell: [0, 1], cellSize: 256 }, // 2 - sand, the overlay
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }, // 3 - brick wall, border fill
    { src: 'Examples/ExampleAtlas.png', cell: [2, 2], cellSize: 256 }, // 4 - metal pipes, border trim
    /* Height Transition drives the blend off the BASE's own relief, and the
       modal says outright that it wants a texture with real relief. The other
       benched textures' joints are too shallow to show anything, so the stone
       floor's deep grout lines are here for that step and that step only. */
    { src: 'Examples/ExampleAtlas.png', cell: [2, 0], cellSize: 256 }, // 5 - stone floor, deep joints
    /* Overlay Texture's example. A grate with real alpha goes over the brick
       with nothing to key, so the step shows stacking at its plainest; sand
       over brick needed a colour key before it showed anything at all. */
    'Examples/MetalGrate.png'                                          // 6 - metal grate, real alpha
];

/* The materials bench, shared by lessons 6, 7 and 8. Shared deliberately: the
   runner only rebuilds the frame when a step needs a state the sandbox has gone
   past, so an identical `requires.tiles` means walking between the three costs
   no reload. They are one subject and people will go back and forth.

   Each texture is here for one job. Brick has the relief that normal and AO live
   on; the pipes are the metal that separates specular from roughness; the sand is
   flat enough that every band suiting the brick is wrong on it, and flat enough to
   make the contrast advisory fire in lesson 8. Water carries the liquid presets and
   the reflective steps, and is the same texture materials.html uses for its own
   water row. The metal door is two obvious regions on one texture, for lesson 8's
   multi-material step. Water.png is 512 where the rest are 256; setupFrom draws
   whatever it is handed into a tile-sized canvas. */
TRLE.DemoMaterialSet = [
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }, // 1 - brick wall
    { src: 'Examples/ExampleAtlas.png', cell: [2, 2], cellSize: 256 }, // 2 - metal pipes
    { src: 'Examples/ExampleAtlas.png', cell: [0, 1], cellSize: 256 }, // 3 - sand, low contrast
    'Examples/Water.png',                                              // 4 - water, for the liquid presets
    { src: 'Examples/ExampleAtlas.png', cell: [0, 3], cellSize: 256 }  // 5 - metal door, red frame
];

/* Opening the Material modal is nine steps' worth of identical setup across
   lessons 6 to 8, so it is one helper rather than nine copies that drift. The
   file is data, but a step's `setup` has always been a closure; this only stops
   the same five lines being written out nine times. */
async function matOpen(api, tileIndex0, presetKey, type) {
    await api.closeMenu();
    await api.cap('openCtx', await api.tileId(tileIndex0));
    await api.wait(240);
    await api.click('#at-ctx button[data-action="material"]');
    await api.wait(1400);
    /* Type first: changing it repopulates the preset list, so setting the preset
       before the type would set it on the list that is about to be thrown away. */
    if (type) { await api.setValue('at-mat-type', type, 'change'); await api.wait(500); }
    await api.setValue('at-mat-preset', presetKey, 'change');
    await api.wait(900);
}

/* The advanced editor is a <details> that also docks into its own column, and
   the summary's click handler TOGGLES. Clicking it blind closes the panel on any
   step the user arrived at with it already open, so check first. */
async function matAdvanced(api) {
    const d = api.doc();
    const det = d && d.getElementById('at-mat-adv');
    if (det && !det.open) { await api.click('#at-mat-adv summary'); await api.wait(700); }
}

/* Three of the animated lesson's steps open the modal on lava with the metal
   grate already set as the overlay, and only differ in what they do next. Same
   reasoning as matOpen above: one helper rather than three copies that drift.

   The grate is `DemoDepthSet[3]`, addressed through api.tileId rather than by
   matching the picker's "Tile 4" label, because the label is generated from the
   element's POSITION and a bench change would silently pick a different
   texture instead of failing. */
async function animOverlayOpen(api, presetKey) {
    await api.closeMenu(); await api.cap('closeModal');
    await api.click('#at-add-anim'); await api.wait(1600);
    await api.setValue('at-anim-preset', presetKey, 'change'); await api.wait(1200);
    await api.click('#at-modal-anim .at-anim-tab[data-anim-tab="overlay"]'); await api.wait(500);
    const grate = await api.tileId(3);
    if (grate != null) await api.setValue('at-anim-ov-tile', grate, 'change');
    const d = api.doc();
    const cb = d && d.getElementById('at-anim-ov-enable');
    if (cb && !cb.checked) { await api.click('#at-anim-ov-enable'); await api.wait(1400); }
}

/* Open an accordion that is closed, and leave one that is already open alone.
   The summary's handler TOGGLES, so clicking blind closes the panel on any step
   the user arrived at with it open — the matAdvanced lesson, applied here. */
async function animOpenAcc(api, id) {
    const d = api.doc();
    const det = d && d.getElementById(id);
    if (det && !det.open) { await api.click('#' + id + ' summary'); await api.wait(600); }
}

/* Lesson 9's bench. Four textures, one job each: brick with deep joints is the
   only one on the atlas with relief worth marching into, the skylight's white
   panes are the easy brightness case for emissive, the foliage is what Fade to
   Transparent is actually FOR (a mural is a rectangle you want to keep whole; a
   leaf cluster is the thing whose edges have to stop existing), and the grate has
   REAL alpha so the maps have holes to flatten inside.

   Lessons 10 and 11 declare the same set, so the last three lessons cost no
   reload between them: the grate is the transparent tile lesson 11's alpha
   warning needs in order to fire, AND the cut-out the animated lesson bakes
   over its lava. */
TRLE.DemoDepthSet = [
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }, // 1 - brick, deep joints
    { src: 'Examples/ExampleAtlas.png', cell: [1, 3], cellSize: 256 }, // 2 - skylight, white panes
    'Examples/tile_249.png',                                           // 3 - foliage, to fade out
    'Examples/MetalGrate.png'                                          // 4 - real alpha
];

/* First element carrying an overlay recipe, or -1. Built out of `inspect` rather
   than a new capture hook, because `inspect` already reports ovParams and the
   only caller needs it once. */
/* Does element `id` carry a sticker layer? (lesson 4's Edit Stickers step builds one when it does not.) */
async function findSticker(api, id) {
    const el = await api.cap('layersEl', id), defs = await api.cap('layersDefs');
    return !!(el && el.layers && defs && el.layers.some(p => defs[p.lid] && defs[p.lid].kind === 'sticker'));
}
async function findOverlay(api) {
    const n = await api.cap('count');
    for (let i = 0; i < (n || 0); i++) {
        const el = await api.cap('inspect', i);
        if (el && el.ovParams) return i;
    }
    return -1;
}

TRLE.DemoAtlasTiles = [
    'roof tiles', 'brick wall', 'stone floor', 'mason block wall',
    'sand (darker)', 'sand (lighter)', 'grass', 'wooden planks',
    'checkered tiles', 'ladder on wall', 'metal pipes', 'metal grate (real alpha)',
    'metal door, red frame', 'metal skylight (white holes)', 'roman artwork', 'forklift door'
];


/* Lesson 12 (Layers) helpers. Each step may be reached from any other, so each one makes sure the layers it talks about exist
   (idempotent: a tile that already carries one is left alone). Text and Adjust Colours go through their real modals. */
async function layerKinds(api) {
    const id = await api.tileId(0);
    const el = await api.cap('layersEl', id), defs = await api.cap('layersDefs');
    return ((el && el.layers) || []).map(p => defs && defs[p.lid] && defs[p.lid].kind);
}
async function layersEnsureText(api) {
    await api.closeMenu(); await api.cap('closeModal');
    if ((await layerKinds(api)).includes('text')) return;
    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
    await api.click('#at-ctx button[data-action="text"]'); await api.wait(900);
    await api.setValue('at-tx-text', 'EXIT'); await api.setValue('at-tx-size-num', 84); await api.setValue('at-tx-size', 84);
    await api.wait(500);
    await api.click('#at-tx-apply'); await api.wait(900);
}
async function layersEnsureGrade(api) {
    await layersEnsureText(api);
    if ((await layerKinds(api)).includes('coloradj')) return;
    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
    await api.click('#at-ctx button[data-action="coloradj"]'); await api.wait(900);
    await api.setValue('at-ca-bright', -30); await api.wait(500);
    await api.click('#at-ca-apply'); await api.wait(900);
}

TRLE.DemoLessons = [
    {
        id: 'start-grid',
        icon: '🏁',
        title: 'Start & the grid',
        blurb: 'Load a sheet, cut it into tiles, and learn how the grid works: slots, moves, empty slots and groups.',
        steps: [
            {
                id: 'what-is-an-atlas',
                title: 'Everything starts with an atlas',
                covers: ['ui:start-screen', 'ui:tile-size'],
                requires: 'pristine',
                say: `An <em>atlas</em> is one image holding a grid of tiles. Tomb Editor wants your
 textures packed this way in a grid, so the whole tool is built around it.<br><br>
 The start screen has three ways in: bring your own sheet, create a blank
 atlas, or reopen a project. <strong>Tile size</strong> is the one thing to set
 first, every map atlas (for example emissive textures or normals) in a set has
 to share it, otherwise Tomb Editor will throw an error during compiling the
 level.<br><br>
 If your textures or materials do not show up in game, press <strong>Build level</strong>
 in Tomb Editor rather than <strong>Build level and play</strong>, and read the errors it
 lists. They also go to <code>TombEditorLog.txt</code>, which sits in your Tomb Editor
 folder next to the program.`,
                spotlight: '#at-upload-card'
            },
            {
                id: 'load-sheet',
                title: 'Load a sheet',
                covers: ['ui:upload'],
                requires: 'loaded',
                say: `Normally you'd drop a PNG or TGA here, or paste one with
 <strong>Ctrl/Cmd+V</strong>. PNG, JPG, BMP, WebP and PSD all load.<br><br>
 We've loaded a sample sheet for you: 16 textures in a 4×4 grid at 256px.
 A browser won't let a script open your file picker, so this is the one
 thing in the course that happens for you rather than by you.`,
                spotlight: '#at-upload'
            },
            {
                id: 'slice',
                title: 'Slice it into tiles',
                covers: ['ui:slice'],
                say: `<strong>Slice Atlas</strong> cuts the whole sheet on the tile size, 1024 ÷ 256
 gives 4 columns and 4 rows, so 16 elements.<br><br>
 If you only wanted some of the cells, <strong>Pick tiles…</strong> lets you
 choose them instead, and you can stitch tiles in from several sheets.`,
                requires: 'loaded',
                spotlight: '#at-slice-btn',
                act: async api => { await api.click('#at-slice-btn'); await api.wait(1100); },
                spotlightAfter: '#at-grid',
                handoff: `Sixteen elements, each one editable on its own. Have a look at the grid.`
            },
            {
                id: 'right-click',
                title: 'Every tile has a menu',
                covers: ['ui:context-menu', 'ui:ctx-search', 'action:download'],
                say: `<strong>Right-click</strong> any tile for everything you can do to it. Type to
 search, from anywhere, <strong>colour</strong> finds Adjust Colours without you touching
 the mouse.<br><br>
 With nothing typed, the menu opens on <strong>File</strong>, <strong>Transform</strong>,
 <strong>Edit</strong>, <strong>Draw</strong>, <strong>Transitions</strong>,
 <strong>Create</strong> and <strong>Material</strong>. Hover one to open it; groups
 that don't apply to this tile are hidden, so an animation frame or a transition tile
 offers fewer of them.<br><br>
 Up to three <strong>recent</strong> actions sit under the search box, so repeating
 something you just did is one click. Rest on any action for 2 seconds and a small
 preview shows what it does, with a <strong>Learn more</strong> link into the Learn page.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); },
                act: async api => { await api.cap('openCtx', await api.tileId(1)); await api.wait(250); },
                spotlight: '#at-ctx',
                handoff: `Right-click a different tile, then try typing <strong>seam</strong> to jump
 straight to <strong>Make Seamless</strong>. <strong>Esc</strong> closes it.`
            },
            {
                id: 'view-copy-duplicate',
                title: 'View, Copy and Duplicate',
                covers: ['action:view', 'modal:view', 'action:copy', 'action:copyorig',
                         'action:duplicate', 'action:duporig', 'action:addanim'],
                say: `<strong>File</strong> opens with the tile itself. <strong>View…</strong> shows
 it at its own resolution plus a 2×2 tiled repeat, so you can check a seam without
 leaving the atlas; anything over 512px is scaled down for the preview.<br><br>
 <strong>Copy Image</strong> puts the tile on your clipboard as a PNG, ready to paste
 into another program. Edit the tile first and it splits into
 <strong>Copy Original</strong> and <strong>Copy Modified</strong>, so either version is
 one click away.<br><br>
 <strong>Duplicate</strong> drops a second copy right after the tile in the grid. It's a
 plain, unlinked tile: editing one afterward never touches the other, even if the
 original was part of a group or a transition. An edited tile offers
 <strong>Duplicate Original</strong> and <strong>Duplicate Modified</strong> the same
 way.<br><br>
 <strong>Add Animated…</strong> sits at the bottom of the menu, opening the same
 generator as the header button of the same name.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('closeModal'); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(200);
                    await api.click('#at-ctx button[data-action="view"]'); await api.wait(500);
                },
                spotlight: '#at-modal-view',
                handoff: `Close the preview, then right-click a tile and try <strong>Duplicate</strong>:
 a second copy lands right beside it, free to edit on its own.`
            },
            {
                id: 'select-batch',
                title: 'Work on many tiles at once',
                covers: ['ui:selection', 'ui:bulk-bar'],
                say: `Tiles select like icons on a desktop. <strong>Click</strong> one,
 <strong>Ctrl/Cmd+click</strong> to add or remove, <strong>Shift+click</strong>
 for a run in atlas order, or <strong>drag a box</strong> from any empty spot in the grid's card.
 <strong>Ctrl/Cmd+A</strong> takes everything and <strong>Esc</strong> clears.<br><br>
 With two or more selected, a <em>bulk bar</em> appears. Right-clicking any
 selected tile then acts on the whole selection, and every menu entry that can
 do that says so in its own label, usually as <em>“ · N tiles”</em>.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); },
                act: async api => { await api.cap('selectIdx', [4, 5, 6]); await api.wait(300); },
                spotlight: '#at-bulk-bar',
                handoff: `Try <strong>Ctrl/Cmd+A</strong>, then <strong>Esc</strong>.`
            },
            {
                id: 'transforms',
                title: 'Rotate, flip, offset',
                covers: ['action:rotate', 'action:fliph', 'action:flipv', 'action:offset'],
                say: `Under <strong>Transform</strong>: <strong>Rotate 90°</strong>,
 <strong>Flip Horizontal</strong>, <strong>Flip Vertical</strong> and
 <strong>Offset ½</strong>.<br><br>
 <strong>Offset ½</strong> is the useful one. It rolls the texture by half a tile
 so whatever was at the edges lands in the middle, which is how you <em>see</em>
 a tiling seam, and the first half of fixing one. All four work on a whole
 selection at once.`,
                requires: 'sliced',
                setup: async api => { await api.cap('selectIdx', [1]); await api.closeMenu(); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(200);
                    await api.click('#at-ctx button[data-action="offset"]'); await api.wait(500);
                },
                spotlight: { grid: 1 },
                handoff: `That's tile 2 rolled by half. Right-click it → <strong>Offset ½</strong> again to put it back.`
            },
            {
                id: 'move-tiles',
                title: 'Drag to swap or insert',
                covers: ['ui:drag-move', 'ui:motion-toggle'],
                say: `<strong>Drag</strong> a tile onto another and the two swap. Drop it in the
 <em>gap</em> between tiles and it goes in there: the gap beside a tile pushes the
 row right, the gap above or below pushes the column down. A push stops at the
 first empty slot, so the tiles past it keep their place, and so does every level
 built on this sheet.<br><br>
 While you drag, an orange dashed outline shows where each tile will land. With
 <strong>Animations</strong> on (in the accessibility bar) the tiles also slide to
 show the result before you let go. <strong>Ctrl/Cmd+Arrow</strong> moves a
 focused tile one slot without the mouse.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('dropAt', [await api.tileId(0)], 'swap', 1); await api.wait(400);
                },
                spotlight: '#at-grid',
                handoff: `The first two textures just swapped places. The numbers stay with the
 slots: they count textures in reading order. Now drag a tile into the gap between
 two others and watch the row make room.`
            },
            {
                id: 'layout-blocks',
                title: 'Columns, rows and locks',
                covers: ['ui:layout', 'ui:locks'],
                say: `<strong>Columns</strong> and <strong>Rows</strong> add empty slots on the right
 and at the bottom. Nothing already in the atlas moves, so a level built on this
 sheet keeps every texture where it was.<br><br>
 Lowering them never strands a texture. Lower <strong>Columns</strong> and anything
 in the removed columns moves to new rows at the bottom. Lower
 <strong>Rows</strong> and anything in the removed rows moves up into empty slots,
 with columns added only if they run out.<br><br>
 The 🔓 beside each one locks it. With <strong>Columns</strong> locked, a push that
 runs off the end of a full row wraps into the next row instead of widening the
 atlas.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                spotlight: '.at-layout-row',
                sweep: { id: 'at-cols-input', from: 4, to: 6, ms: 1400 },
                handoff: `Put <strong>Columns</strong> back to 4, or leave it, nothing here is precious.`
            },
            {
                id: 'empty-slots',
                title: 'Empty slots take textures',
                covers: ['action:slot-image', 'action:slot-blank', 'action:slot-paste', 'action:slot-delrow', 'action:slot-delcol'],
                say: `Empty slots are dashed, and each one is a place for a texture.
 <strong>Click</strong> one to add an image there, drop files from your desktop on
 it, or point at it and paste with <strong>Ctrl/Cmd+V</strong>. An image that is not
 256×256 gets resized to fit, and the tool asks first.<br><br>
 Right-click one for this menu. <strong>Delete Empty Column</strong> is offered
 because that whole column is empty; a row or column with a texture in it is not
 deleted from here.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); await api.cap('setCols', 6); await api.wait(200); },
                act: async api => { await api.cap('openSlotMenu', 4); await api.wait(250); },
                spotlight: '#at-slot-ctx',
                handoff: `Click an empty slot to open the file picker, or press <strong>Esc</strong>.`
            },
            {
                id: 'empty-fill',
                title: 'Gaps at export',
                covers: ['modal:emptyfill'],
                say: `An exported atlas has no such thing as an empty slot, so the gaps
 <em>between</em> your textures have to become something. The first export asks, once
 per project, and <strong>🔲 Empty slots…</strong> in the Layout row asks any time.<br><br>
 <strong>🧲 Compact</strong> moves everything up to close the gaps; a group moves as
 one piece, keeping its shape. <strong>⬛ Fill black</strong> and
 <strong>🔳 Fill transparent</strong> put a tile in each gap and move nothing.
 Filling renumbers the grid, and every map atlas stays lined up with it. Empty
 slots after the last texture never need an answer.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); await api.cap('setCols', 6); await api.wait(200); },
                act: async api => { await api.click('#at-empty-slots'); await api.wait(400); },
                spotlight: '#at-modal-emptyfill',
                handoff: `Pick one, or close it. Either way it is one undo step.`
            },
            {
                id: 'groups',
                title: 'Groups move as one piece',
                covers: ['action:group', 'action:ungroup', 'ui:blocks'],
                say: `Some tiles belong together. A transition set only reads right in its own
 shape, and an animation's frames play in order, so both are <em>groups</em>,
 outlined in orange. Drag any tile of a group and the whole group comes along,
 keeping its shape and pushing loose tiles out of its way.<br><br>
 You can make your own: select some tiles, then <strong>🔗 Group</strong> on the bulk
 bar or in the right-click menu, or <strong>Ctrl/Cmd+G</strong>. Right-click →
 <strong>✂️ Ungroup</strong> or <strong>Ctrl/Cmd+Shift+G</strong> undoes it.
 Ungrouping an animation warns first, because moved apart its frames could lose
 their seamlessness.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('setCols', 4); await api.cap('selectIdx', [0, 1, 4]); await api.wait(200); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(250);
                    await api.click('#at-ctx button[data-action="group"]'); await api.wait(400);
                },
                spotlight: '#at-grid',
                handoff: `Tiles 1, 2 and 5 are one group now. Drag one of them and watch the
 other two follow.`
            },
            {
                id: 'undo-history',
                title: 'Nothing is permanent',
                covers: ['ui:undo', 'ui:history', 'ui:messages'],
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); },
                /* The only step in the course that shows the tool's own rails.
                   They are hidden everywhere else, which is where the grid gets
                   the width back; here they are the subject. */
                rails: 'both',
                say: `Every edit is undoable. <strong>Ctrl/Cmd+Z</strong> steps back,
 <strong>Ctrl/Cmd+Shift+Z</strong> forward, and the <strong>History</strong> panel
 on the right lists every step, click one to jump straight to it.<br><br>
 The two side panels are only showing for this step. <strong>Session</strong> and
 <strong>Messages</strong> on the left are what the tool tells you: what it just
 did, what went wrong, and when it last autosaved. In the real tool they are
 always there.<br><br>
 That's the whole grid. From here each lesson takes one tool and shows what its
 dials actually do.`,
                spotlight: '.at-rail-right',
                handoff: `Click around the <strong>History</strong> list, then pick another lesson above.`
            }
        ]
    },

    {
        id: 'cleanup',
        icon: '\u{1F9F9}',
        title: 'Clean up a texture',
        blurb: 'Take six flawed textures and make each one usable: seams, blemishes, colour, baked light, grain.',
        steps: [
            {
                id: 'the-bench',
                title: 'Six textures, six problems',
                covers: ['ui:cleanup-bench'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Textures from games that are not grid based can be problematic in a TRLE. They
 were drawn to sit in one specific place, so they tile badly, they carry marks
 where something was bolted through them, and they often have lighting painted
 straight into the pixels.<br><br>
 These six each carry one specific fault, and the rest of the lesson fixes them one
 at a time. Nothing here is destructive. Every tile keeps its original, and
 <strong>Reset to Original</strong> is the last step.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                spotlight: '#at-grid',
                handoff: `Have a look at the six. The first one is the wall we start with.`
            },
            {
                id: 'see-the-seam',
                title: 'First, see the seam',
                covers: ['action:offset'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Texture 1's left edge does not match its right, and its top does not match its
 bottom. Tile it across a wall and every one of those mismatches lines up into a grid.
 It is measurable rather than a matter of taste: the wrap is the <em>sharpest</em> step
 in this texture, on both axes, against a typical interior step about half its size.<br><br>
 <strong>Offset ½</strong> rolls the texture by half a tile, dragging whatever was
 at the edges into the middle where you can see it. That is the diagnosis step,
 and it works on any texture you are unsure about.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', [0]); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="offset"]'); await api.wait(600);
                },
                spotlight: { grid: 0 },
                handoff: `That band through the middle was the seam. <strong>Offset ½</strong> again puts it back.`
            },
            {
                id: 'seamless',
                title: 'Make Seamless',
                covers: ['action:seamless', 'modal:seamless'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `<strong>Make Seamless</strong> rebuilds the edges so opposite sides match.<br><br>
 <strong>Scattered edges</strong> is the default and usually right.
 <strong>Multi-band edge blend</strong> is the one for a stubborn seam: it blends
 low and high frequencies separately, so it can hide a brightness step without
 smearing the detail.<br><br>
 <strong>Overlap X</strong> and <strong>Overlap Y</strong> are how far in from each
 edge it works. That band is swapped for texture from the middle of the tile, which
 already matches across the wrap. The sweep starts them at the minimum, where the
 seam still shows as a frame, and brings them up to the default.<br><br>
 <strong>Blend Radius</strong> is how softly that band meets the rest: low is a
 scattered dither, higher is a smooth cross-fade. Watch it rise second.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="seamless"]'); await api.wait(900);
                    /* Method and Blend Radius are remembered prefs, so a visit that
                       changed them would otherwise start this step from there. */
                    await api.setValue('at-sm-method', 'scattered', 'change');
                    await api.setValue('at-sm-falloff', 10);
                    const d = api.doc();
                    const lock = d && d.getElementById('at-sm-lock-xy');
                    if (lock && !lock.checked) await api.click('#at-sm-lock-xy');
                    await api.setValue('at-sm-overlapx', 3);   // the lock carries Y along
                    await api.wait(500);
                },
                act: async api => {
                    api.status('Overlap 3% to 20%');
                    await api.sweep({ id: 'at-sm-overlapx', from: 3, to: 20, ms: 1800 }, '#at-sm-preview');
                    api.status('Blend Radius 10% to 30%');
                    await api.sweep({ id: 'at-sm-falloff', from: 10, to: 30, ms: 1600 }, '#at-sm-preview');
                },
                expectState: { 'at-sm-method': 'scattered', 'at-sm-overlapx': '20', 'at-sm-overlapy': '20' },
                spotlight: '#at-sm-overlap-row',
                handoff: `Try <strong>Multi-band edge blend</strong> in the method list and watch the
 preview. <strong>Save</strong> writes it back; closing throws it away.`
            },
            {
                id: 'paint-tools',
                title: 'The paint tools, once',
                covers: ['ui:mask-editor'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Nine places in the app let you paint a region, and they all use this same
 toolbar, so this is the one place worth learning it.<br><br>
 <strong>Brush</strong> and <strong>Stamp</strong> are freehand; <strong>Lasso</strong>
 takes clicks for corners or a drag to trace; <strong>Rect</strong> and
 <strong>Ellipse</strong> drag out a shape; <strong>🪄 Wand</strong> picks pixels by
 colour, which is how you grab a watermark in one click.<br><br>
 <strong>Edge softness</strong> at 0 is a crisp edge; raise it to feather the
 stroke. Hold <strong>Alt</strong> to erase, and the toolbar has its own undo.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="heal"]'); await api.wait(900);
                },
                spotlight: '#at-heal-tools',
                handoff: `Pick a tool and scribble on the texture. Nothing is committed until
 <strong>Save</strong>.`
            },
            {
                id: 'heal',
                title: 'Heal a blemish',
                covers: ['action:heal', 'modal:heal'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Texture 2 is a mural with a hole where the pulley chain passed through. To reuse
 it as plain wall, paint over the hole and let the tool invent what belongs
 there.<br><br>
 The method matters here. <strong>Healing brush</strong>, the default, copies real
 texture from a matching spot elsewhere on the tile and blends its colour into the
 edge, the way the healing brush in Photoshop or Photopea does. That is right for
 almost everything, but this hole sits in the one place on the mural that appears
 nowhere else, so there is nothing to copy and it pastes a stray piece of pattern.
 <strong>Neighbour-aware</strong> grows the fill in from the edge instead, so the lines
 running into the hole carry on through it. <strong>Smooth (diffusion, flat fill)</strong>
 spreads colour inward and leaves a grey smear here.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="heal"]'); await api.wait(900);
                },
                spotlight: '#at-heal-method',
                handoff: `Paint over the dark hole, then switch the method and watch the preview
 change. Cover the whole mark, a missed edge is what leaves a ring.`
            },
            {
                id: 'coloradj',
                title: 'Adjust Colours',
                covers: ['action:coloradj', 'modal:coloradj'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Eight sliders over the whole texture: hue, saturation, brightness, contrast,
 gamma, temperature, tint and vibrance.<br><br>
 Say you want to reuse your brick texture for a water area too. Swing
 <strong>Hue</strong> round toward green and lift <strong>Saturation</strong> a
 little, and the same wall reads as slimy, algae-covered brick, with every crack
 and chip still where it was.<br><br>
 <strong>Temperature</strong> is the other one worth knowing. Photo textures carry
 the colour of the light they were shot in, and nudging it warm or cool is what
 makes a wall from one photo sit beside a floor from another.<br><br>
 If you are not sure how a texture should look, pull it toward grey here and let the
 light bulbs in Tomb Editor put the colour back. Neutral pixels take whatever light you
 give them, a strongly tinted texture fights it.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="coloradj"]'); await api.wait(800);
                },
                act: async api => {
                    api.status('Hue 0° to 65°');
                    await api.sweep({ id: 'at-ca-hue', from: 0, to: 65, ms: 1600 }, '#at-ca-preview');
                    api.status('Saturation 100% to 120%');
                    await api.sweep({ id: 'at-ca-sat', from: 100, to: 120, ms: 1000 }, '#at-ca-preview');
                },
                expectState: { 'at-ca-hue': '65', 'at-ca-sat': '120' },
                spotlight: '#at-ca-sliders',
                handoff: `Drag any of them. <strong>Reset</strong> puts them all back to neutral.`
            },
            {
                id: 'ca-channel',
                title: 'Channel levels',
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `The <strong>Mode</strong> dropdown has a second set of controls:
 <strong>Channel levels</strong>, a dark cutoff, bright cutoff and gamma for red, green
 and blue separately.<br><br>
 Every slider on the Simple side moves the whole picture at once.
 <strong>Temperature</strong> pushes red up and blue down together, so it cannot lift
 just the blue in the shadows. That is what this mode is for: a cast that sits in one
 part of the range rather than across the whole texture.<br><br>
 <strong>Dark cutoff</strong> is where that channel reads as 0, <strong>Bright
 cutoff</strong> where it reads as full, and <strong>Gamma</strong> bends everything
 between them without moving either end.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="coloradj"]'); await api.wait(800);
                    await api.setValue('at-ca-mode', 'channel', 'change'); await api.wait(400);
                },
                spotlight: '#at-ca-levels',
                sweep: { id: 'at-ca-bgamma', from: 100, to: 225, ms: 1600 },
                preview: '#at-ca-preview',
                handoff: `Blue gamma is lifting the midtones only, so the texture cools off
 without its darkest and brightest pixels moving. Switching modes resets both sets of
 sliders, so you are always starting from neutral.`
            },
            {
                id: 'ca-paint',
                title: 'Grading part of a texture',
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `The third mode, <strong>Paint a region</strong>, marks part of the texture
 and works on that alone. Paint straight onto the preview with the usual brush, lasso,
 rectangle and wand.<br><br>
 A region is already painted here. Watch <strong>Hue</strong> move: the marked patch
 shifts and the rest of the wall does not, right down to the pixel.<br><br>
 The other option, <strong>Match the surroundings</strong>, is the useful one for
 remaster textures. It keeps the region's light and shade and gives it the colour of
 the wall around it, which is how you kill a green or pink patch an upscaler invented
 without flattening the grain.<br><br>
 This one works on a single tile, since a painted region is drawn on one specific
 texture. The mode is greyed out if you have several tiles selected.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="coloradj"]'); await api.wait(800);
                    await api.setValue('at-ca-mode', 'mask', 'change'); await api.wait(400);
                    await api.cap('caMaskRect', [56, 60, 120, 110]); await api.wait(300);
                },
                spotlight: '#at-ca-tools',
                sweep: { id: 'at-ca-hue', from: 0, to: 140, ms: 1600 },
                preview: '#at-ca-preview',
                handoff: `<strong>Clear</strong> starts the region again, <strong>Invert</strong>
 flips it so you grade everything except what you painted.`
            },
            {
                id: 'recolor',
                title: 'Recolor from another texture',
                covers: ['action:recolor', 'modal:recolor'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Say the sand at the foot of a brick wall should look like the wall has been
 crumbling into it. Rather than guessing with colour sliders,
 <strong>Recolor from Texture</strong> measures the brick's colour and moves the
 sand onto it, so the two read as the same place.<br><br>
 <strong>Strength</strong> is how far to go. Part way keeps some of the sand's own
 character, which is usually what you want for dust rather than rubble. On a
 selection you also choose how it reads: <em>match each tile to the reference</em>
 makes mismatched textures agree, while <em>apply the same shift to every tile</em>
 keeps deliberate variants apart.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('selectIdx', [2]);
                    await api.cap('openRecolor', await api.tileId(2), await api.tileId(5));
                    await api.wait(900);
                },
                spotlight: '#at-rc-sliders',
                sweep: { id: 'at-rc-strength', from: 0, to: 100, ms: 1800 },
                preview: '#at-rc-preview',
                handoff: `Watch the sand take on the brick's colour, then drag
 <strong>Strength</strong> back down until it reads as dust rather than paint.`
            },
            {
                id: 'delight',
                title: 'De-light',
                covers: ['action:delight', 'modal:delight'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Plenty of textures have shadows painted straight into them, because older engines
 could not light a scene well enough to produce them. That is a stylistic choice and
 you are free to keep it. A hand painted shadow can look better than a real one.<br><br>
 It matters if you are going to use <strong>materials</strong>. The normal, AO and
 roughness maps are all read out of this texture's own contrast, so a painted
 shadow gets read as depth and comes back amplified as fake geometry, lit a second
 time by the engine.<br><br>
 <strong>De-light</strong> divides out the slow brightness change and leaves the
 detail behind. Run it before you assign a material, not after.<br><br>
 It is opt in on purpose. It does not remove detail, it renormalises local contrast,
 so a texture that never needed it comes out <em>stronger</em> rather than
 unchanged.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(4)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="delight"]'); await api.wait(900);
                },
                spotlight: '#at-dl-whole-controls',
                sweep: { id: 'at-dl-strength', from: 0, to: 100, ms: 1600 },
                preview: '#at-dl-canvas',
                handoff: `<strong>Paint the shadow</strong> mode is for when one cast shadow is wrong
 and the rest of the lighting is worth keeping.`
            },
            {
                id: 'noise',
                title: 'Surface noise',
                covers: ['action:surfacenoise', 'modal:noise'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Grit, pitting, wood grain, cracks, scuffs, laid into the texture itself, and
 seamless by construction, so it never adds a seam of its own.<br><br>
 <strong>Strength</strong> has two sensible ranges and the tool says which one you
 are in. On a plain texture the grain is the whole detail budget; on one that also
 exports material maps it lands twice, because the normal and roughness maps read
 the same grain back out of the diffuse and amplify it.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="surfacenoise"]'); await api.wait(900);
                },
                spotlight: '#at-sn-preset',
                sweep: { id: 'at-sn-strength', from: 0, to: 60, ms: 1600 },
                preview: '#at-sn-preview',
                handoff: `Try <strong>🧱 Brick grit</strong> or <strong>🕸️ Hairline cracks</strong> in the
 preset list. <strong>Make a new tile</strong> keeps the original alongside.`
            },
            {
                id: 'oil',
                title: 'Oil Paint',
                covers: ['action:oil', 'modal:oil'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `<strong>Oil Paint</strong> is in the <strong>Filter</strong> category. It smears the
 colours along the texture's own edges into brush strokes. <strong>Stylization</strong> is how long
 the strokes are, <strong>Cleanliness</strong> smooths the picture first and <strong>Scale</strong>
 sets how big the shapes are that the strokes follow.<br><br>
 <strong>Lighting</strong> is off. Ticking it bakes shading into the colour, which
 <strong>De-light</strong> would then have to take out again, so leave it off for textures you
 export. The result is a layer, so you can hide it later.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="oil"]'); await api.wait(1200);
                },
                spotlight: '#at-oil-rows',
                sweep: { id: 'at-oil-stylization', from: 1, to: 10, ms: 1800 },
                preview: '#at-oil-after',
                handoff: `Tick <strong>Show 2 × 2</strong> to check that it still tiles, then
 <strong>💾 Apply</strong>.`
            },
            {
                id: 'tone',
                title: 'Dodge & Burn',
                covers: ['action:tone', 'modal:tone'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `<strong>Dodge &amp; Burn</strong> is in the <strong>Edit</strong> category, right
 after <strong>Heal</strong>. You paint over the texture with Draw's brush: <strong>Dodge</strong>
 lightens, <strong>Burn</strong> darkens, <strong>Sponge</strong> adds or takes away colour, and
 <strong>Blur</strong> and <strong>Sharpen</strong> soften and crisp up. The soft blob here is a
 Dodge stroke.<br><br>
 <strong>Range</strong> picks shadows, midtones or highlights, and <strong>Protect tones</strong>
 keeps the hue from shifting. Each tool you paint with becomes its own layer when you press
 <strong>Apply</strong>.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="tone"]'); await api.wait(900);
                    await api.cap('toneDemo'); await api.wait(400);
                },
                spotlight: '#at-tn-tools',
                sweep: { id: 'at-tn-exposure', from: 10, to: 100, ms: 1800 },
                preview: '#at-tn-surface',
                handoff: `Pick <strong>Burn</strong> and paint a second blob, then <strong>💾 Apply</strong>:
 two layers appear.`
            },
            {
                id: 'liquify',
                title: 'Liquify',
                covers: ['action:liquify', 'modal:liquify'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `<strong>Liquify</strong> is in the <strong>Transform</strong> category. Paint on
 the texture to push it around: <strong>Forward Warp</strong> drags, the twirl tools turn,
 <strong>Pucker</strong> pinches in and <strong>Bloat</strong> pushes out. The drag here is a Forward
 Warp.<br><br>
 Strokes wrap across the tile edges, so a bent tile still tiles. Anything on the tile (text,
 drawings, glow) moves with it. It works on one tile at a time.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="liquify"]'); await api.wait(900);
                    await api.cap('liquifyDemo'); await api.wait(500);
                },
                spotlight: '#at-lq-tools',
                preview: '#at-lq-surface',
                handoff: `Switch to <strong>Pucker</strong> and hold the button down on the picture, then
 <strong>💾 Apply</strong>.`
            },
            {
                id: 'draw',
                title: 'Draw on it',
                covers: ['action:draw', 'modal:draw'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Sometimes the fix is to paint something in by hand: a crack, a stain, a trail.
 <strong>🖌 Draw…</strong> sits on its own in the menu and paints with a photo editor's
 brush. Strokes go on a layer over the tile, and nothing changes until
 <strong>💾 Apply</strong>.<br><br>
 The two sand floors are selected, so Draw has opened on both of them, laid out as they
 sit in the grid. One stroke runs across the join and is written into each tile.<br><br>
 The <strong>Brush</strong> list draws every brush as a stroke. <strong>Liquid</strong>
 is loaded, in a dark red: it pools where you slow down, which is what blood and oil do.
 It also sets the layer's <strong>Material</strong> to <strong>🩸 Blood</strong>, so on
 Apply the paint reads wet in the material maps, not just red in the texture.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('selectIdx', [2, 3]);
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="draw"]'); await api.wait(900);
                    await api.setValue('at-draw-preset', 'liquid', 'change'); await api.wait(200);
                    await api.setValue('at-draw-hex', '#6e0a0c', 'change'); await api.wait(200);
                },
                expectState: { 'at-draw-preset': 'liquid', 'at-draw-fg': '#6e0a0c', 'at-draw-material': 'liquid:blood' },
                spotlight: '.at-draw-optbar',
                handoff: `Drag across both tiles, slowing down near the end. <strong>Ctrl+Z</strong>
 takes back a stroke; leaving with paint on the layer asks first.`
            },
            {
                id: 'reset',
                title: 'Undo all of it',
                covers: ['action:reset'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Every tile keeps its untouched original, however many edits you stack on it.
 <strong>Reset to Original</strong> under <strong>File</strong> throws the
 lot away and hands back the texture you started with, and it works on a whole
 selection at once.<br><br>
 That is the safety net under this entire lesson: nothing you did to these six is
 permanent, and neither is anything you do to your own.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(280);
                    await api.cap('ctxOpenCat', 'file'); await api.wait(120);
                },
                spotlight: '#at-ctx .at-ctx-sub[data-cat="file"]',
                handoff: `<strong>Reset to Original</strong> is the second-to-last entry. Try it on
 texture 1, then pick another lesson above.`
            }
        ]
    },

    {
        id: 'generate',
        icon: '\u{1F3D7}\u{FE0F}',
        title: 'Make a new texture',
        blurb: 'Bring one texture, leave with many: walls, floors, variants, frames and glass.',
        steps: [
            {
                id: 'the-generators',
                title: 'One texture in, a set out',
                covers: ['ui:generate-column'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `The <strong>Create</strong> category builds new textures out of the ones you
                      already have. A single brick photo becomes a whole wall, a wall becomes six
                      walls that do not repeat, a flat panel becomes a carved frame.<br><br>
                      This is the category to reach for when you need a lot of texture and you have
                      one good one. These six are the sources for the rest of the lesson.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(280);
                    await api.cap('ctxOpenCat', 'generate'); await api.wait(120);
                },
                spotlight: '#at-ctx .at-ctx-sub[data-cat="generate"]',
                handoff: `Look down the list. Everything in it makes a <em>new</em> tile and leaves
                          the one you right-clicked alone.`
            },
            {
                id: 'build-pattern',
                title: 'Build Pattern: a wall from a brick',
                covers: ['action:buildpattern', 'modal:build'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `<strong>Build Pattern</strong> lays copies of your texture into a course: brick,
                      coursed stone, cobbles, tile floor, herringbone, planks, shingles or pipes.<br><br>
                      <strong>Bricks across</strong> is the count that sets the scale. Fewer, larger
                      bricks read as a cyclopean wall; more, smaller ones as engineering brick. Watch
                      the preview: the joints stay where they should be at every count, because the
                      pattern is laid out rather than scaled.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="buildpattern"]'); await api.wait(1100);
                },
                spotlight: '#at-bp-pattern',
                sweep: { id: 'at-bp-across', from: 3, to: 11, ms: 1800 },
                preview: '#at-bp-preview',
                handoff: `Change <strong>Pattern</strong> and watch the whole thing relay itself.
                          <strong>Fill</strong> decides whether each cell is a random crop, the whole
                          texture, or a different tile from your atlas.`
            },
            {
                id: 'build-deform',
                title: 'Age it, or it reads as new',
                covers: ['ui:build-deform'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `A freshly laid pattern is machine perfect, which is exactly wrong for a ruin.
                      The <strong>Age &amp; deformation</strong> panel breaks the grid up.<br><br>
                      <strong>Course sag</strong> bows the rows, <strong>Laying jitter</strong> nudges
                      each block off its mark, <strong>Tilt</strong> turns them, <strong>Missing
                      pieces</strong> knocks blocks out and <strong>Edge erosion</strong> eats the
                      corners. Every one of them sits at 0 by default, so a flush city wall is still
                      what you get without touching them.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="buildpattern"]'); await api.wait(1100);
                    await api.click('#at-bp-deform-wrap > summary'); await api.wait(600);
                },
                spotlight: '#at-bp-deform-wrap',
                sweep: { id: 'at-bp-missing', from: 0, to: 22, ms: 1600 },
                preview: '#at-bp-preview',
                handoff: `Push <strong>Course sag</strong> and <strong>Edge erosion</strong> up too.
                          Open <strong>Behind the cells</strong> and set <strong>Backing</strong> to
                          another atlas tile, so a missing block shows the wall behind it rather than a
                          blur.`
            },
            {
                id: 'variations',
                title: 'Variations: the same wall, six times',
                covers: ['action:variations', 'modal:var'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `One texture repeated across a room reads as one texture repeated across a room.
                      <strong>Create Variations</strong> makes several tiles that are recognisably the
                      same material and visibly not the same tile.<br><br>
                      <strong>Hue jitter</strong>, <strong>Brightness jitter</strong>,
                      <strong>Saturation jitter</strong> and <strong>Contrast jitter</strong> drift the
                      colour a little per tile. <strong>Random 90° rotations</strong> and
                      <strong>Random wrap shift</strong> move the content itself, which is what stops the
                      eye finding the repeat. It is seeded, so the same <strong>Seed</strong> gives the
                      same set back.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(3)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="variations"]'); await api.wait(800);
                },
                spotlight: '#at-modal-var .at-modal-body',
                sweep: { id: 'at-var-hue', from: 0, to: 40, ms: 1400 },
                handoff: `Variations of a seamless tile stay seamless, every jitter preserves the wrap.
                          Set a <strong>Count</strong> and click <strong>Add Variations</strong> to add them.`
            },
            {
                id: 'origami',
                title: 'Origami Frame: fold a texture like paper',
                covers: ['action:origami', 'modal:origami'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `<strong>Origami Frame</strong> folds a texture like paper and adds the result as a
                      new tile. <strong>Fold type</strong> picks the fold: <strong>Frame</strong> wraps it
                      into nested rings, <strong>Pleats</strong> fold it in parallel strips,
                      <strong>Kaleidoscope</strong> mirrors it into a grid and <strong>Fan</strong> folds
                      it around a point.<br><br>
                      On Frame, <strong>Ring size</strong> set to <strong>Keep texture size</strong> lays
                      the cobble down at its own scale, so <strong>Repeats</strong> gives more, narrower
                      rings and the stones stay stones. <strong>Fit whole texture</strong> squeezes all of
                      it into every ring instead.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(4)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="origami"]'); await api.wait(900);
                    await api.setValue('at-origami-size', 'keep', 'change'); await api.wait(300);
                },
                spotlight: '#at-origami-type',
                sweep: { id: 'at-origami-repeats', from: 1, to: 4, ms: 1400 },
                preview: '#at-origami-preview',
                handoff: `Switch <strong>Fold type</strong> to Pleats and set <strong>Spacing</strong> to
                          Irregular, or try Fan and raise <strong>Crease shading</strong>.`
            },
            {
                id: 'stainedglass',
                title: 'Stained Glass',
                covers: ['action:stainedglass', 'modal:stainedglass'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `Builds a leaded glass panel: cells, came between them, and colour.<br><br>
                      <strong>Cell pattern</strong> gives you organic blobs, rectangular, diamond or hex
                      quarries, a rose window, or <strong>🖼 Follow image</strong>, which cuts the cells
                      along the shapes already in your texture. <strong>Glass colours</strong> either
                      samples your texture or takes one of the fixed palettes.<br><br>
                      <strong>Glow strength</strong> is what makes it a window rather than a picture of
                      one. It writes an emissive map, so the glass lights up in a dark room, and the
                      tile carries a glass and metal multi-material for the cells and the came.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="stainedglass"]'); await api.wait(1000);
                },
                spotlight: '#at-sg-pattern',
                sweep: { id: 'at-sg-cells', from: 3, to: 16, ms: 1900 },
                preview: '#at-sg-preview',
                handoff: `Try <strong>🌹 Rose window</strong>, then push <strong>Leading width</strong> up.
                          <strong>Add Stained Glass Tile</strong> puts it in the atlas.`
            },
            {
                id: 'what-you-get',
                title: 'Three kinds of output',
                covers: ['action:editstainedglass'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `These tools do not all leave the same thing behind, and it matters when you want
                      to change your mind.<br><br>
                      <strong>Build Pattern</strong> and <strong>Origami Frame</strong> bake pixels. The
                      result is an ordinary tile with no memory of how it was made, so to change it you
                      build it again.<br><br>
                      <strong>Stained Glass</strong> keeps its recipe. Right-click the tile it made and
                      <strong>🪟 Edit Stained Glass</strong> reopens every slider where you left it.<br><br>
                      <em>Animated textures</em> keep a recipe too, but they arrive as a whole group
                      of linked frames rather than one tile. They get a lesson of their own.`,
                setup: async api => { await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []); },
                spotlight: '#at-grid',
                handoff: `Anything you added is at the end of the grid. Right-click one and see which
                          entries its menu offers, that is the quickest way to tell which kind it is.`
            }
        ]
    },

    {
        id: 'blend',
        icon: '\u{1F500}',
        title: 'Blend two textures',
        blurb: 'Make one tile that is grass on one side and sand on the other, and control exactly where the join sits.',
        steps: [
            {
                id: 'pick-a-partner',
                title: 'Two textures, one tile',
                covers: ['action:transition', 'ui:pick-partner'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `A <em>transition</em> tile is two of your textures on one tile with a boundary
                      between them. Lay it next to a plain grass tile and a plain sand tile and the
                      three read as one continuous surface.<br><br>
                      Every transition tool starts the same way: right-click the texture you want
                      underneath, pick the tool, then click the texture to lay over it. The first tile
                      goes teal to show it is locked, and a banner tells you what it is waiting for.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="transition"]'); await api.wait(500);
                },
                spotlight: '#at-pick-banner',
                handoff: `Click texture 2, the sand, to finish the pick. <strong>Esc</strong> cancels if
                          you change your mind.`
            },
            {
                id: 'directions',
                title: 'Which side the overlay covers',
                covers: ['modal:trans'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `<strong>Mask Source</strong> holds twenty directions: the four sides, the four
                      corners, the same eight again as full halves, and four diagonal slopes for
                      sloped floors.<br><br>
                      Tick as many as you want. You get one tile per direction, which is how you build
                      a small run of pieces in a single pass rather than reopening the tool for each
                      one.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openTrans', await api.tileId(0), await api.tileId(1));
                    await api.wait(900);
                },
                spotlight: '#at-tr-mask-source',
                handoff: `<strong>All</strong> and <strong>None</strong> are above the grid. The preview
                          shows whichever direction you last touched.`
            },
            {
                id: 'pivot-hardness',
                title: 'Where the join sits, and how sharp it is',
                covers: ['ui:pivot-hardness'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `<strong>Pivot</strong> moves the boundary. At 50% the two textures get half the
                      tile each; drop it and the overlay becomes a thin strip along its edge.<br><br>
                      <strong>Hardness</strong> is how quickly one becomes the other. At 0% it is a wide
                      soft gradient, which suits sand drifting onto grass. Push it up for a hard line,
                      which is what you want where a stone floor meets a wall.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openTrans', await api.tileId(0), await api.tileId(1));
                    await api.wait(900);
                },
                spotlight: '#at-tr-pivot',
                sweep: { id: 'at-tr-pivot', from: 50, to: 22, ms: 1600 },
                preview: '#at-tr-preview',
                handoff: `Now drag <strong>Hardness</strong> from 0 to 80 and watch the same boundary go
                          from a drift to a line.`
            },
            {
                id: 'organic-edge',
                title: 'Break the boundary up',
                covers: ['ui:organic-edge'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `A clean curve reads as generated, because nothing outdoors has one. The
                      <strong>🌿 Organic edge</strong> panel replaces it with a ragged, flecked one.<br><br>
                      <strong>Edge style</strong> picks the character: <strong>Blobs</strong> for the
                      general case, <strong>Spikes</strong> for frost creeping over rock,
                      <strong>Drips</strong> for slime or melting snow, <strong>Clumps</strong> for moss
                      and rubble, <strong>Fray</strong> for a fine fringe. <strong>Amount</strong> is how
                      far it pushes, <strong>Scatter</strong> throws flecks past the edge.<br><br>
                      It stays seamless. Teeth and fingers point away from the overlay wherever the
                      boundary runs, so a corner spikes outward along its own curve.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openTrans', await api.tileId(0), await api.tileId(1));
                    await api.wait(900);
                    await api.click('#at-tr-sorg-acc > summary'); await api.wait(600);
                },
                spotlight: '#at-tr-sorg-acc',
                sweep: { id: 'at-tr-sorg-wobble', from: 0, to: 55, ms: 1700 },
                preview: '#at-tr-preview',
                handoff: `Try <strong>Contact shadow</strong> too. It darkens the base just outside the
                          boundary, so the overlay sits <em>on</em> the surface rather than inlaid into
                          it.`
            },
            {
                id: 'live-transitions',
                title: 'A transition stays linked',
                covers: ['action:gotobase', 'action:gotooverlay'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `The tile it adds is not a flat copy. It remembers which two textures it was built
                      from, so editing either source re-renders every transition made from it. Make the
                      grass seamless afterwards and the transitions follow.<br><br>
                      It inherits materials the same way. You assign a material to the grass and to the
                      sand, and the transition's material maps are composited from both using the same
                      boundary. You do not assign a material to a transition tile: the menu's
                      <strong>🎨 Set Material…</strong> entry is greyed out on one, and hovering it
                      explains that the tile follows its two sources.<br><br>
                      <strong>🧭 Go to Base Texture</strong> and <strong>🧭 Go to Overlay Texture</strong>
                      jump back to the sources, which is how you find them again in a large atlas.`,
                setup: async api => { await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []); },
                spotlight: '#at-grid',
                handoff: `Right-click a transition tile and compare its menu with a plain tile's. Fewer
                          entries, and a <strong>Go to</strong> group that plain tiles do not have.`
            },
            {
                id: 'overlay',
                title: 'Overlay Texture: stacking, not blending',
                covers: ['action:overlay', 'modal:overlay'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Every tool so far in this lesson blends two terrains <em>into</em> each other.
                      <strong>🖼 Overlay Texture</strong> does the other thing: it lays one texture on
                      top of another and leaves the base alone underneath. That is why it has a
                      category of its own, <strong>Overlay</strong>, just after Transitions, and it is the
                      one you want for grates, decals, posters, grime and moss rather than for a shoreline.<br><br>
                      Right-click the base, then click the texture to put over it. Here that is tile
                      6's metal grate over tile 3's brick. The grate already has transparency, so
                      <strong>What shows through</strong> stays on <strong>Whole overlay</strong> and
                      the brick shows through the holes with nothing to set up. The sweep fades the
                      grate in with <strong>Opacity</strong>.<br><br>
                      An overlay with no transparency of its own needs telling what to keep:
                      <strong>Pick a colour</strong>, <strong>Hue range</strong>, <strong>Bright
                      areas</strong> or <strong>Paint it</strong>. Those modes add <strong>Read colours
                      from</strong>. Reading from <em>the overlay</em> keys a decal off its own
                      background; reading from <em>the base</em> puts the overlay only where the wall
                      matches, which is how grime ends up in the mortar joints.<br><br>
                      <strong>Blend</strong> is separate from coverage. <strong>Multiply</strong> for
                      dirt and stains, <strong>Screen</strong> for dust and light leaks. The generated
                      maps follow the <em>coverage</em> and ignore the blend, which is correct: a
                      multiply changes how a surface looks, not what it is made of.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openOverlay', await api.tileId(2), await api.tileId(5));
                    await api.wait(1500);
                    await api.setValue('at-ov-mode', 'all', 'change'); await api.wait(500);
                    await api.setValue('at-ov-blend', 'normal', 'change'); await api.wait(500);
                },
                expectState: { 'at-ov-mode': 'all', 'at-ov-blend': 'normal', 'at-ov-opacity': '100' },
                spotlight: '#at-ov-preview',
                sweep: { id: 'at-ov-opacity', from: 0, to: 100, ms: 2000 },
                preview: '#at-ov-preview',
                handoff: `Set <strong>Blend</strong> to <strong>Multiply</strong> and the bars darken the
                          brick instead of covering it. Then try <strong>Bright areas</strong> under
                          <strong>What shows through</strong> to see an overlay keyed by colour.`
            },
            {
                id: 'edit-overlay',
                title: 'It stays a recipe',
                covers: ['action:editoverlay'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `An overlay is added to the atlas as a new tile, and it is not a flattened picture.
                      It carries the recipe: which two textures, what coverage, which blend. So
                      <strong>🖼 Edit Overlay…</strong> reopens it with every control where you left it,
                      and changing the base or the overlay texture later re-renders it.<br><br>
                      That is the same arrangement every other tool in this lesson used, and it has the
                      same two consequences. Editing a source updates everything built from it. And the
                      new tile <em>inherits</em> the material from its sources rather than carrying
                      its own, so material the brick and the grate first and the overlay arrives already
                      carrying both.<br><br>
                      Only paint mode stores actual pixels. Colour, hue and brightness coverage are
                      recomputed from the recipe, so the project file does not carry a mask it could
                      regenerate.`,
                setup: async api => {
                    await api.closeMenu();
                    /* Guarantee the overlay tile exists: the dots let anyone arrive here
                       first, and Edit Overlay is data-ovonly, so on a bench that has
                       never had one built the menu entry is absent and the ring would
                       silently have nothing to point at. */
                    let idx = await findOverlay(api);
                    if (idx < 0) {
                        await api.cap('openOverlay', await api.tileId(2), await api.tileId(5));
                        await api.wait(1500);
                        await api.click('#at-ov-add');
                        await api.wait(1800);
                        await api.closeMenu();
                        idx = await findOverlay(api);
                    }
                    if (idx < 0) return;
                    await api.cap('openCtx', await api.tileId(idx));
                    await api.wait(400);
                },
                spotlight: '#at-ctx button[data-action="editoverlay"]',
                handoff: `Open it, change the blend to <strong>Screen</strong> and press
                          <strong>Update</strong>. The tile in the grid changes, and the recipe is still
                          there next time.`
            },
            {
                id: 'sticker-cut',
                title: 'Make Sticker: a piece of one tile',
                covers: ['action:stickercut', 'modal:stickercut'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Overlay Texture stacks a whole texture. A <em>sticker</em> is something smaller you
                      place by hand: a rivet, a plaque, a crack, a sign. Stickers live in the project's
                      gallery, and one way to fill it is to cut a piece out of a tile you already have.<br><br>
                      <strong>✂️ Make Sticker…</strong> is in the same <strong>Overlay</strong> category.
                      Select what to cut with the mask tools; here an <strong>Ellipse</strong> round one
                      rivet on tile 4's pipes. The preview on the right is the sticker, trimmed to what you
                      selected.<br><br>
                      <strong>Keep its maps</strong> brings the pipes' material maps along, so the rivet can
                      keep its own relief wherever you put it. <strong>Lift it off and heal the hole</strong>
                      also takes it off this tile, as a Heal layer you can hide later. Left unticked, the
                      tile does not change.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []);
                    await api.cap('openCtx', await api.tileId(3)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="stickercut"]'); await api.wait(600);
                    await api.cap('stcSelect', 'ellipse', 10, 108, 38, 136); await api.wait(300);
                },
                spotlight: '#at-stcut-preview',
                handoff: `Tick <strong>Keep its maps</strong> and press <strong>➕ Add to the gallery</strong>.`
            },
            {
                id: 'sticker-gallery',
                title: 'The Sticker Gallery',
                covers: ['action:stickerlib', 'modal:stickerlib'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `<strong>📚 Sticker Gallery…</strong> holds every sticker in the project. Besides cuts,
                      <strong>➕ Add images…</strong> takes PNG, JPG, WebP and TGA files, <strong>📁 Add a
                      folder…</strong> a whole folder, and a PSD gives one sticker per layer. An image with
                      a file beside it named like <em>bolt_normal.png</em> gets that file as its normal
                      map.<br><br>
                      The gallery is saved with the project. To use the same stickers in another project,
                      <strong>💾 Save pack</strong> writes them all to one file and <strong>📦 Load
                      pack…</strong> reads it there.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('stickerSeed', await api.tileId(3));
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="stickerlib"]'); await api.wait(500);
                },
                spotlight: '#at-stl-grid',
                handoff: `Click the rivet to see its size and the maps it carries, and to rename it.`
            },
            {
                id: 'stickers',
                title: 'Add Stickers: place, size, recolour',
                covers: ['action:stickers', 'modal:stickers'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `<strong>🏷️ Add Stickers…</strong> puts gallery images on the tile. Click one in the
                      strip, or drag it onto the texture, then drag it where you want it. A corner resizes
                      it and keeps its shape, <strong>Shift</strong> stretches it, just outside a corner
                      turns it, and <strong>Alt</strong>-drag makes a copy. The sweep fades the rivet in
                      with <strong>Opacity</strong>.<br><br>
                      Each sticker has its own settings, in four tabs. <strong>Colour</strong> recolours it.
                      <strong>Maps</strong> decides what it does to the material maps: <strong>Follow the
                      tile</strong>, <strong>A material preset</strong>, or <strong>Its own maps</strong>,
                      the ones it was cut with. <strong>Effects</strong> adds a shadow, a glow or an
                      outline.<br><br>
                      Nothing changes until <strong>💾 Apply</strong>, which adds one layer to the tile
                      with every sticker in it.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []);
                    await api.cap('stickerSeed', await api.tileId(3));
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="stickers"]'); await api.wait(600);
                    await api.click('#at-st-strip .at-st-chip'); await api.wait(300);
                    await api.setValue('at-st-w', 56, 'change'); await api.setValue('at-st-h', 56, 'change'); await api.wait(300);
                },
                spotlight: '#at-st-view',
                sweep: { id: 'at-st-op', from: 0, to: 100, ms: 1800 },
                preview: '#at-st-view',
                handoff: `Open the <strong>Effects</strong> tab, tick <strong>Drop shadow</strong>, and press
                          <strong>💾 Apply</strong>.`
            },
            {
                id: 'edit-stickers',
                title: 'Stickers stay editable',
                covers: ['action:editstickers'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `The stickers become a layer on the tile, in its <strong>Text and drawings</strong>
                      group, so hiding, moving and deleting them work as for any layer.
                      <strong>Edit Stickers…</strong> reopens the window with every sticker where you left
                      it. The gallery image was copied into the layer, so deleting it from the gallery later
                      changes no tile.<br><br>
                      Stickers are also the one layer that goes on a transition or an animation frame. On
                      an animation they appear on every frame, at the same place.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []);
                    const brick = await api.tileId(2);
                    if (!(await findSticker(api, brick))) {
                        await api.cap('stickerSeed', await api.tileId(3));
                        await api.cap('openCtx', brick); await api.wait(240);
                        await api.click('#at-ctx button[data-action="stickers"]'); await api.wait(600);
                        await api.click('#at-st-strip .at-st-chip'); await api.wait(300);
                        await api.click('#at-st-apply'); await api.wait(1200);
                        await api.closeMenu();
                    }
                    await api.cap('openCtx', brick); await api.wait(400);
                },
                spotlight: '#at-ctx button[data-action="editstickers"]',
                handoff: `Open it, drag the rivet somewhere else and press <strong>💾 Apply</strong>. The
                          layer changes in place.`
            }
        ]
    },

    {
        id: 'sets',
        icon: '\u{1F9E9}',
        title: 'Build a set',
        blurb: 'One tile cannot cover every way two terrains meet. These build the whole family at once.',
        steps: [
            {
                id: 'why-a-set',
                title: 'Why one tile is not enough',
                covers: ['ui:why-sets'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `A single transition covers one arrangement. A real patch of sand on grass needs
                      the middle, the four sides, the outer corners and the inner corners, and they all
                      have to agree where they touch.<br><br>
                      That is what a <em>set</em> is, and the tools below build the whole family in one
                      pass with the edges already matching. Which one you want depends on the shape you
                      are covering, so this lesson is a tour rather than a recipe.`,
                setup: async api => { await api.closeMenu(); await api.cap('closeModal'); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(280);
                    await api.cap('ctxOpenCat', 'transitions'); await api.wait(120);
                },
                spotlight: '#at-ctx .at-ctx-sub[data-cat="transitions"]',
                handoff: `Six builders. The rest of the lesson is one step each.`
            },
            {
                id: 'full-set',
                title: 'Full Set: a patch you can lay out',
                covers: ['ui:full-set'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `The second tab of Make Transition builds a spatial arrangement rather than loose
                      tiles. <strong>3×3 Island</strong> is a pocket of the overlay surrounded by the
                      base, <strong>3×3 Hole</strong> is the reverse, <strong>5×3 Complete</strong> packs
                      both plus spares.<br><br>
                      Leave <strong>Corner style</strong> on <strong>Seamless</strong>. It puts the
                      boundary state on the four tile corners, so a corner cell and the edge cell beside
                      it compute the same profile from the same two corners and the nine tiles read as
                      one shape. The older styles are kept only so existing projects still open.<br><br>
                      The tiles arrive in the atlas laid out exactly like the preview.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openTrans', await api.tileId(0), await api.tileId(1));
                    await api.wait(900);
                    await api.click('#at-modal-trans [data-tr-tab="set"]'); await api.wait(700);
                },
                spotlight: '#at-modal-trans .at-anim-tabs',
                handoff: `Switch <strong>Set layout</strong> between the three and watch the preview
                          relay itself.`
            },
            {
                id: 'wang',
                title: 'Wang set: flows in every direction',
                covers: ['action:wang', 'modal:wang'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Sixteen tiles covering every combination of which edges the overlay touches. Lay
                      them in any arrangement and they join up, so you can paint an unpredictable shape
                      rather than an island of a fixed size.<br><br>
                      Reach for this when the overlay has to wander: sand drifting across grass, water
                      pooling on stone. For one straight or curved seam a plain transition is simpler,
                      and the sixteen tiles cost sixteen tiles of atlas.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openWang', await api.tileId(0), await api.tileId(1));
                    await api.wait(1200);
                },
                spotlight: '#at-wang-layout',
                sweep: { id: 'at-wang-hardness', from: 0, to: 70, ms: 1600 },
                handoff: `The preview is the whole sheet. <strong>Layout</strong> only changes how the
                          sixteen are arranged in the atlas, not what they contain.`
            },
            {
                id: 'borderset',
                title: 'Borders & Corners: a fill and a trim',
                covers: ['action:borderset', 'modal:bset'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `This one is not a blend between two terrains, which is why it sits under
                      <strong>Create</strong> rather than <strong>Transitions</strong>. It takes a fill
                      and a trim and builds the connectivity set a classic TRLE border uses: edges, outer
                      corners, inner corners and the plain fill.<br><br>
                      Here it is metal banding run around a brick wall, which is the kind of pairing that
                      reads as built rather than decorated. Pick a trim that would plausibly be bolted
                      or mortared onto the fill, and the set does the rest.<br><br>
                      <strong>Set type</strong> switches between a frame around each tile and pipes
                      running through them. <strong>Border width</strong> and <strong>Softness</strong>
                      shape the band. The trim sits on the tile edges, so two bordered rooms placed side
                      by side share a double width band, which is how those sets always read.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openBset', await api.tileId(2), await api.tileId(3));
                    await api.wait(1200);
                },
                spotlight: '#at-bset-topo',
                sweep: { id: 'at-bset-width', from: 20, to: 42, ms: 1600 },
                handoff: `The right-hand preview is a sample wall with the set assembled into an L-shaped
                          room, so you can see the trim turn through a concave corner.`
            },
            {
                id: 'pushmarks',
                title: 'Pushable Markings: the marks a block leaves',
                covers: ['action:pushmarks', 'modal:push', 'action:editpushmarks'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Giving players a hint about which objects can be pushed is useful, like the
 pushable lamp in Alexandria. This creates a set of pushable markings from one floor
 tile: sixteen tiles covering straight runs, corners, T junctions, a cross and dead
 ends, so they join up wherever two of them meet.<br><br>
 The marks carve into the height, normal and AO maps as grooves.
 <strong>Floor style</strong> moves the floor itself along the track:
 <strong>Sand ripples</strong>, a <strong>Snow channel</strong> with raised sides,
 <strong>Liquify</strong> a smear.<br><br>
 <strong>Oil</strong> or <strong>Blood</strong> under <strong>Drips</strong> in the same
 <strong>Preset</strong> list makes a leak running down a wall, a column of tiles that
 join top to bottom.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openCtx', await api.tileId(4)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="pushmarks"]'); await api.wait(900);
                },
                expectState: { 'at-push-surface': 'tiles' },
                spotlight: '#at-push-sheet',
                sweep: { id: 'at-push-struggle', from: 15, to: 90, ms: 1600 },
                preview: '#at-push-sheet',
                handoff: `Watch the tracks wobble and judder as <strong>Rigid ↔ Struggle</strong>
 climbs. <strong>🎲 Randomize</strong> gives a new set, <strong>Add</strong> writes the
 tiles, and right-clicking any of them afterwards reopens the same recipe to change it.`
            },
            {
                id: 'anchored',
                title: 'Anchored: drag the boundary yourself',
                covers: ['action:anchor', 'modal:anchor'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Everything so far picked the boundary for you. <strong>Anchored Transition</strong>
                      hands it over: the border is a line of anchor points you drag.<br><br>
                      Drag a dot to move it, click empty space to add one, right-click to remove, and
                      scroll over a dot to curve it. The line between them is a spline, so it stays
                      smooth rather than kinking at each point.<br><br>
                      This is the one to use when the shape has to match something specific, a road, a
                      shoreline, a crack across a floor.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openAnchor', await api.tileId(0), await api.tileId(1));
                    await api.wait(1100);
                },
                spotlight: '#at-anchor-canvas',
                handoff: `Drag one of the white dots. <strong>Hide handles</strong> shows the result
                          without them in the way.`
            },
            {
                id: 'transgrid',
                title: 'Transition Grid: a whole wall at once',
                covers: ['action:transgrid', 'modal:grid'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `The same boundary editor over a grid of tiles instead of one. Set
                      <strong>Columns</strong> and <strong>Rows</strong>, drag the border across the whole
                      wall, and it is sliced into tiles at the end.<br><br>
                      Because the boundary is drawn on the wall and cut afterwards, it can run at any
                      angle across any number of tiles, which a per-tile tool cannot do. The
                      <strong>🟠 Add patch</strong> and <strong>🔵 Carve patch</strong> tools drop shapes
                      into single cells on top of it.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openGrid', await api.tileId(0), await api.tileId(1));
                    await api.wait(1100);
                },
                spotlight: '#at-tg-canvas',
                handoff: `Change <strong>Columns</strong> to 4 and drag the line across it.`
            },
            {
                id: 'organic-trans',
                title: 'Organic: scattered patches',
                covers: ['action:organic', 'modal:organic'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Not a boundary at all. This scatters the overlay across the tile as loose patches,
                      for moss on stone, puddles on a floor, rust on metal.<br><br>
                      <strong>Coverage</strong> is how much of the tile it takes, <strong>Patch size</strong>
                      how big each one is, <strong>Roughness</strong> how ragged their edges are. It makes
                      several <strong>Variations</strong> at once so a wall of them does not repeat.<br><br>
                      The <strong>Segments</strong> box along each side controls which edges the patches
                      are allowed to cross, so you can keep a tile's own edges clean.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openOrganic', await api.tileId(0), await api.tileId(1));
                    await api.wait(1100);
                },
                spotlight: '#at-org-coverage',
                sweep: { id: 'at-org-coverage', from: 20, to: 65, ms: 1600 },
                handoff: `Click the segment boxes around the edge of the seam diagram to stop patches
                          crossing that side.`
            },
            {
                id: 'heighttrans',
                title: 'Height Transition: let the surface decide',
                covers: ['action:heighttrans', 'modal:heighttrans', 'action:edithtrans'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `The boundary comes from the base texture's own relief rather than from a shape you
                      chose. Sand settles into the mortar joints and leaves the stones proud; water fills
                      the low ground first.<br><br>
                      <strong>Height from</strong> decides what counts as low, <strong>Fill level</strong>
                      is how far up the overlay comes, and <strong>Edge hardness</strong> is how sharply
                      it stops. Raise the level and the overlay climbs the texture the way a real
                      material would.<br><br>
                      <strong>Fill level</strong> is touchier than it looks. On most textures everything
                      interesting happens inside a narrow band, with nothing below it and a flooded tile
                      above, so move it in small steps and watch rather than dragging it to a number.<br><br>
                      It keeps its recipe, so <strong>Edit Height Transition</strong> reopens every
                      slider where you left it.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.cap('openHeightTrans', await api.tileId(4), await api.tileId(1));
                    await api.wait(1200);
                },
                spotlight: '#at-ht-preset',
                /* 20 to 36, and the range is measured rather than chosen to look
                   reasonable. On stone floor + sand the overlay share is 0 up to
                   25%, 8.7% at 30, 26.7% at 35, 67.7% at 40 and a total flood
                   from 50 up. So the whole story happens in about twelve points
                   of the slider, and a sweep that ends anywhere past 45 finishes
                   on a tile of pure sand with the step's own point, that the
                   stones stay proud of it, no longer on screen. */
                sweep: { id: 'at-ht-level', from: 20, to: 36, ms: 1700 },
                handoff: `<strong>Show mask</strong> draws where the overlay is winning, which is the
                          quickest way to understand what <strong>Fill level</strong> is doing.`
            }
        ]
    },

    {
        id: 'materials-what',
        icon: '\u{1F3A8}',
        title: 'What a material is',
        blurb: 'Six images generated from your one texture, and what each of them tells the engine.',
        steps: [
            {
                id: 'six-images',
                title: 'Materials enhance your textures',
                covers: ['ui:material-maps', 'modal:mat'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `A texture is one image: what colour the surface is. A <em>material</em> adds more
                      images generated from that same texture, each answering a different question. Which
                      way does this bit of surface face, where do shadows collect, how shiny is it, how
                      deep is it.<br><br>
                      The engine reads them together, so the wall lights like a wall instead of like a flat
                      photo of one. You do not draw any of them: pick a material and the tool derives the
                      lot.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'brick', 'change'); await api.wait(700);
                },
                spotlight: '#at-mat-previews',
                handoff: `Those thumbnails are the maps, generated live from tile 1. The rest of this
                          lesson is one of them at a time.`
            },
            {
                id: 'diffuse',
                title: 'Diffuse: the colour, and only the colour',
                covers: ['ui:map-diffuse'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `The texture itself is the <strong>diffuse</strong> map, sometimes called albedo. It
                      is what colour the surface is when nothing is shining on it.<br><br>
                      That last part is the catch. If your texture has a bright side and a dark side
                      painted into it, the engine lights it again on top and you get two lightings
                      fighting. It is also read by every other map here, so a painted shadow comes back
                      as fake geometry.<br><br>
                      That is what <strong>☀ De-light</strong> in lesson 2 is for, and why it is worth
                      doing before you assign a material rather than after.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'brick', 'change'); await api.wait(700);
                },
                spotlight: '#at-mat-lit',
                handoff: `Drag on the preview to move the light around. That is the engine lighting the
                          material, not the picture.`
            },
            {
                id: 'normal',
                title: 'Normal: relief that is not there',
                covers: ['ui:map-normal'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `A <strong>normal</strong> map stores, for every pixel, which way that scrap of
                      surface is pointing. The geometry stays perfectly flat and the lighting behaves as
                      if it were not.<br><br>
                      A still picture of a lit surface cannot show you this, because a picture of shading
                      and actual shading look the same until something moves. So watch the light swing
                      around: with the normal map on, the shadows inside the mortar joints move to the
                      far side of the light. With it off, the whole tile just gets brighter and darker.<br><br>
                      That is the whole trick, and it is the map that does the most for the least.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'brick', 'change'); await api.wait(700);
                },
                act: async api => {
                    api.status('Light moving, normal map ON');
                    await api.orbitLight({ turns: 1, ms: 2600 });
                    api.status('Same light, normal map OFF');
                    await api.cap('matPreviewShow', { normal: false });
                    await api.orbitLight({ turns: 1, ms: 2600 });
                    api.status('And back on');
                    await api.cap('matPreviewShow', null);
                    await api.orbitLight({ turns: 1, ms: 2600 });
                },
                spotlight: '#at-mat-lit',
                handoff: `Drag on the preview to move the light yourself. The joints should always
                          shadow away from it.`
            },
            {
                id: 'ao',
                title: 'Ambient occlusion: where light cannot reach',
                covers: ['ui:map-ao'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `A normal map says which way a surface faces, but not that a joint is a narrow slot
                      with walls on both sides. <strong>Ambient occlusion</strong> is the map that says
                      so: white where the surface is open to the room, dark where it is buried.<br><br>
                      It does not follow the light, which is the point. Watch the joints as it goes off
                      and on while the light holds still: they lighten slightly and the wall flattens.<br><br>
                      This is a <em>quiet</em> map. On this brick it moves about 2 levels out of 255 on
                      average, and you will notice it most by its absence, in a surface that looks
                      subtly like a printed picture of bricks.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'brick', 'change'); await api.wait(700);
                    await api.cap('matLight', -0.55, 0.45, 0.7);
                },
                act: async api => {
                    for (const off of [true, false, true, false]) {
                        api.status(off ? 'AO off' : 'AO on');
                        await api.cap('matPreviewShow', off ? { ao: false } : null);
                        await api.wait(900);
                    }
                },
                spotlight: '#at-mat-lit',
                handoff: `The AO thumbnail in the map row is the map itself: white surfaces, dark joints.`
            },
            {
                id: 'specular',
                title: 'Specular: how much light comes back',
                covers: ['ui:map-specular'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Specular</strong> is how much light a surface throws back at you. Metal
                      throws back a lot, cloth almost none.<br><br>
                      A highlight only exists when the surface, the light and your eye line up, so this
                      time the light swings up through head on and back out. The pipes flash as it
                      passes and go dead again on the way out. On the oblique angles either side there
                      is no highlight to see at all, which is worth knowing before you conclude a
                      specular map is not working.<br><br>
                      The <strong>Specular</strong> thumbnail is the honest read: bright means "returns
                      light here". Switch the preset to <strong>Cotton</strong> and watch it go nearly
                      black.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'metal', 'change'); await api.wait(900);
                },
                act: async api => {
                    api.status('Light swinging up through head on');
                    await api.orbitLight({ turns: 1, ms: 3200, throughAxis: true });
                },
                spotlight: '#at-mat-lit',
                handoff: `Drag the light into the middle of the preview to hold the highlight, then out
                          to the edge to lose it.`
            },
            {
                id: 'roughness',
                title: 'Roughness: sharp highlight or broad',
                covers: ['ui:map-roughness'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Roughness</strong> decides the <em>shape</em> of that highlight, where
                      specular decided its strength. Black is polished and gives a tight bright point;
                      white is matte and smears the same light into a broad dull sheen.<br><br>
                      The pair is the thing most often got backwards. A surface that looks plasticky
                      usually has specular too high, not roughness too low; a metal that looks like grey
                      paint usually has specular too low however the roughness is set.<br><br>
                      This one barely shows in a small preview, so read the <strong>Roughness</strong>
                      thumbnail instead: it is a map, not a number, and the light and dark in it are the
                      polished and worn parts of the surface. Compare <strong>Chrome</strong> with
                      <strong>Concrete</strong> and the two thumbnails are nearly negatives of each
                      other.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'metal', 'change'); await api.wait(700);
                },
                act: async api => {
                    for (const [k, label] of [['chrome', 'Chrome, polished'], ['concrete', 'Concrete, matte'],
                                              ['chrome', 'Chrome again'], ['metal', 'back to Metal']]) {
                        api.status(label);
                        await api.setValue('at-mat-preset', k, 'change');
                        await api.wait(1100);
                    }
                },
                spotlight: '#at-mat-previews',
                handoff: `Step through the preset list and watch only the Roughness and Specular
                          thumbnails. That pair is most of what separates one material from another.`
            },
            {
                id: 'the-other-three',
                title: 'Height and emissive',
                covers: ['ui:map-height-emissive'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Two more maps ride in the same set. <strong>Height</strong> gives real depth:
                      the engine shifts the surface as the camera moves, so a recess sits behind the
                      wall. <strong>Emissive</strong> is light the surface makes itself, so it glows in a
                      dark room.<br><br>
                      A preset sets their strengths along with the rest. Each also has its own editor,
                      in lesson 9, because you often want only one of them: a glowing sign needs no
                      roughness work.<br><br>
                      The <strong>🧊 3D</strong> button beside the preview is for <em>height</em>
                      specifically: it displaces a real mesh, which is the one thing a flat preview
                      cannot fake. For the other maps stay on 2D, which lights the tile the way the
                      engine does.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'brick', 'change'); await api.wait(700);
                },
                spotlight: '#at-mat-previews',
                handoff: `The <strong>Height</strong> thumbnail is already in that row, made from the
                          preset without opening the height editor.`
            },
            {
                id: 'from-the-diffuse',
                title: 'All of it comes out of the diffuse',
                covers: ['ui:contrast-advisory'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Every map in this lesson is derived from one thing: the light and dark in your
                      texture. Nothing is invented. A preset does not <em>add</em> detail, it decides how
                      hard to read the detail that is already there.<br><br>
                      So the same preset lands differently on different textures. On a punchy brick it
                      finds plenty to work with; on flat sand there is almost nothing to amplify and the
                      maps come out gentle. The tool measures this and says so, in the line under the
                      preset picker. It only advises, it never corrects anything for you.<br><br>
                      Two consequences worth carrying: De-light before you assign a material, and if a
                      material looks weak, look at the texture's contrast before you reach for the
                      sliders.<br><br>
                      And take the preview for what it is. It lights the tile with <em>one</em> light,
                      using the same highlight maths the engine uses, but a real room has several at
                      different angles and colours and adds its own corner shading on top. The preview
                      is for comparing two materials against each other, not for judging how bright a
                      wall will be.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="material"]'); await api.wait(1400);
                    await api.setValue('at-mat-preset', 'sand', 'change'); await api.wait(700);
                },
                spotlight: '#at-mat-contrast',
                handoff: `That is the flat sand. Close this, open the same modal on tile 1's brick, and
                          compare what the line says. For the reference version of everything here, the
                          <strong>🎨 Materials</strong> page in the header goes map by map with a live
                          tuner.`
            }
        ]
    },

    {
        id: 'materials-advanced',
        icon: '\u{2699}',
        title: 'Tuning maps by hand',
        blurb: 'The advanced editor, one slider group at a time, on textures that want opposite settings.',
        steps: [
            {
                id: 'adv-panel',
                title: 'Under every preset is this panel',
                covers: ['ui:mat-advanced-editor'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `A preset is one row of numbers, and this panel shows that row.
                      Open <strong>⚙️ Advanced editor</strong> and the modal widens, the sliders dock
                      into their own column beside the preview, and every value you can see came from
                      the preset you picked.<br><br>
                      Move any one of them and the material becomes <em>custom</em>, which assigns like
                      any other. Nothing is committed until
                      <strong>Assign Material</strong>, so this whole lesson is safe to poke at.<br><br>
                      Nineteen sliders in four groups, normal, AO, roughness and specular, plus height
                      and emissive at the bottom. Those last two work exactly like the rest, and they
                      get their own tools in lesson 9 because you usually want one of them on its own.<br><br>
                      Picking between the presets is lesson 8. Here we are borrowing one to take apart.`,
                setup: async api => { await matOpen(api, 0, 'brick'); await matAdvanced(api); },
                spotlight: '#at-mat-sliders',
                handoff: `Scroll the slider column. Every label names a map from lesson 6, and the
                          thumbnails redraw as you move anything.`
            },
            {
                id: 'normal-strength',
                title: 'Normal Strength: how hard to read the relief',
                covers: ['ui:mat-normal-strength'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Normal Strength</strong> sets how strongly the light and dark already in
                      the texture get turned into slopes. Brick ships at
                      <strong>32</strong> with <strong>Normal Blur</strong> at 2, because mortar joints
                      are real relief and there is plenty there to read.<br><br>
                      Watch the top of the sweep. Past about 40 the surface reads as crinkled foil:
                      every scratch in the clay is now a ridge, and the joints are lost among them.<br><br>
                      The stopping rule is the same one the Learn page gives: raise it until it reads
                      as depth, then stop.`,
                setup: async api => { await matOpen(api, 0, 'brick'); await matAdvanced(api); },
                spotlight: '#at-mat-p-normalStrength',
                sweep: { id: 'at-mat-p-normalStrength', from: 1, to: 50, ms: 3000 },
                preview: '#at-mat-lit',
                handoff: `Put it back around 32 and drag the light across the preview. The joints should
                          shadow away from it without the faces breaking up.`
            },
            {
                id: 'normal-sand',
                title: 'The same slider on sand is wrong',
                covers: ['ui:mat-normal-blur'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Sand's relief is fine grain, and <strong>Normal Strength</strong> reads that
                      grain as thousands of tiny slopes. Push it and the tile glitters, and
                      in game it shimmers as the light or the camera moves, because every grain is now
                      catching a highlight like a pebble. Sand ships at <strong>14</strong>.<br><br>
                      Often the better fix is <strong>Normal Blur</strong>. It smooths the texture
                      <em>before</em> the slopes are read, so it takes out the grain and leaves the
                      broader shape. Watch the second sweep: same strength, sparkle gone. Sand ships
                      Blur at 3, brick at 2.<br><br>
                      Rule of thumb: if it glitters, blur it. If it looks like foil, then cut strength.`,
                setup: async api => {
                    await matOpen(api, 2, 'sand');
                    await matAdvanced(api);
                    await api.setValue('at-mat-p-normalBlur', 0);
                    await api.wait(600);
                },
                act: async api => {
                    api.status('Normal Strength 14 to 50, no blur');
                    await api.sweep({ id: 'at-mat-p-normalStrength', from: 14, to: 50, ms: 2400 }, '#at-mat-lit');
                    api.status('Same strength, Normal Blur 0 to 8');
                    await api.sweep({ id: 'at-mat-p-normalBlur', from: 0, to: 8, ms: 2400 }, '#at-mat-lit');
                },
                spotlight: '#at-mat-p-normalBlur',
                handoff: `Drop Blur back to 0 and watch the glitter come back. That is the same texture
                          and the same strength, read at two different scales.`
            },
            {
                id: 'normal-shape',
                title: 'The four sliders no preset will ever set for you',
                covers: ['ui:mat-normal-shape'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Strength and Blur decide how much relief and how fine. Four more decide its
                      <em>character</em>, and they are worth knowing because <strong>not one preset in
                      the tool touches them</strong>. They sit at zero until you move them, so nothing
                      here is undoing a preset's work.<br><br>
                      <strong>Normal Fine Detail</strong> and <strong>Normal Large Scale</strong> are a
                      balance: grain against broad shape. Wood wants fine detail high and large scale
                      low, so the grain stays sharp while the plank itself reads flat. A dune wants the
                      opposite.<br><br>
                      <strong>Normal Angularity</strong> and <strong>Normal Tilt</strong> sharpen soft
                      rounded bumps into facets, which suits cut stone and brick and spoils sand and
                      cloth. They are a pair in the strict sense:
                      <em>Tilt does nothing at all while Angularity is 0</em>, which is where
                      every preset leaves it. Angularity alone moves this preview by about 5 levels out
                      of 255, and Tilt on top of it moves another 34.<br><br>
                      So the sweep runs Angularity up first, then Tilt.`,
                setup: async api => { await matOpen(api, 0, 'brick'); await matAdvanced(api); },
                act: async api => {
                    api.status('Normal Angularity 0 to 1');
                    await api.sweep({ id: 'at-mat-p-normalAngularity', from: 0, to: 1, ms: 2200 }, '#at-mat-lit');
                    api.status('Now Normal Tilt, on top of it');
                    await api.sweep({ id: 'at-mat-p-normalAngularIntensity', from: 0, to: 1, ms: 2200 }, '#at-mat-lit');
                },
                spotlight: '#at-mat-p-normalAngularIntensity',
                handoff: `Put Angularity back to 0 and move Tilt again. Nothing happens, which is the
                          point. Then try Fine Detail against Large Scale on this brick and on the sand
                          in tile 3.`
            },
            {
                id: 'ao-radius',
                title: 'AO Radius is the width of the gap',
                covers: ['ui:mat-ao-radius'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Ambient occlusion asks, for each pixel, how walled in it is.
                      <strong>AO Radius</strong> is how far it looks while asking, so it should match
                      the size of the gap you want shaded. Brick ships <strong>16</strong>, sand
                      <strong>12</strong>.<br><br>
                      Both ends of this sweep are wrong in different ways. Too small and a mortar joint
                      gets a thin dark line drawn along it. Too large and the shadow climbs out of the
                      joint and washes across the brick faces, which reads as a dirty wall.<br><br>
                      Match it to the size of the feature. Darkness is the next slider.<br><br>
                      Watch the <strong>Ao</strong> thumbnail, where the ring is. AO is a quiet map in a
                      lit view: this sweep moves the preview by about 2 levels out of 255 and the AO map
                      itself by about 32, so the thumbnail is where you can see it.`,
                setup: async api => { await matOpen(api, 0, 'brick'); await matAdvanced(api); },
                spotlight: '#at-mat-previews [data-map="ao"]',
                sweep: { id: 'at-mat-p-aoRadius', from: 1, to: 30, ms: 2800 },
                preview: '#at-mat-lit',
                handoff: `Drag <strong>AO Radius</strong> yourself and watch the joints in that
                          thumbnail widen and then bleed onto the faces.`
            },
            {
                id: 'ao-intensity',
                title: 'Grimy means too much AO',
                covers: ['ui:mat-ao-intensity'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>AO Intensity</strong> is how dark the occluded parts go. On sand there is
                      almost nothing genuinely occluded, so intensity has nothing to find and just
                      darkens whatever is slightly darker already. Watch the tile go muddy. Sand ships
                      <strong>10</strong> against brick's <strong>22</strong>.<br><br>
                      This is the single most common way a material goes wrong, and it is worth knowing
                      which way to reach. If a texture looks grimy, the cause is nearly always AO, so
                      back off Intensity first.<br><br>
                      If the opposite is true and the crevices look shallow, Intensity will not help
                      much once it has saturated. <strong>AO Depth</strong> is the cap on how far AO is
                      allowed to darken at all, sitting at 0.5 by default so a crevice bottoms out at
                      mid grey. Raise Depth for real contact shadow, drop it toward 0 for flat stylised
                      shading.<br><br>
                      Same instrument as the last step: the <strong>Ao</strong> thumbnail moves about 42
                      levels over this sweep and the lit preview about 2. In game the AO map multiplies
                      the whole lit result, and the engine's own screen space occlusion multiplies it
                      again, so a map that looks like nothing here can still read as filth on a wall.`,
                setup: async api => { await matOpen(api, 2, 'sand'); await matAdvanced(api); },
                spotlight: '#at-mat-previews [data-map="ao"]',
                sweep: { id: 'at-mat-p-aoIntensity', from: 1, to: 30, ms: 2800 },
                preview: '#at-mat-lit',
                handoff: `Leave it high, then pull <strong>AO Depth</strong> down and watch the map lift
                          while the shape stays. Intensity shapes the shadow, Depth caps how dark it
                          gets.`
            },
            {
                id: 'spec-rough',
                title: 'Specular and Roughness are one decision',
                covers: ['ui:mat-specular-roughness'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Specular Base</strong> is how much light comes back.
                      <strong>Roughness Base</strong> is what shape it comes back in: 0 is a mirror and
                      gives a tight bright point, 255 is dead matte and smears the same light into a
                      broad sheen. Neither means "shiny" on its own.<br><br>
                      The light is put head on for this step, deliberately. The highlight is a lobe
                      aimed back at your eye, so at the preview's usual angle it is off screen and
                      pushing specular from 30 to 220 changes the image by 0.6 levels out of 255. Head
                      on it changes it by 47. The engine behaves the same way, which is why a specular
                      map can look broken until something lines up.<br><br>
                      So: first sweep pushes specular up. Past about 200 the map is nearly white, and in
                      engine a white specular lays white over your texture and drains the colour out of
                      it. That is why even the metals top out around 180.<br><br>
                      Then roughness runs the full range on the same tile. Point to sheen, nothing else
                      changed, and it is the loudest slider in this lesson by a distance.<br><br>
                      The two failures, so you can name them when you see them: plasticky is specular
                      too high, and metal that looks like grey paint is specular too low, whatever the
                      roughness says.`,
                setup: async api => {
                    await matOpen(api, 1, 'metal');
                    await matAdvanced(api);
                    /* Head on, or the sweep below is invisible: measured 0.64 mean delta at the
                       default oblique light against 46.98 at (0,0,1). Same Phong lobe that made
                       lesson 6's specular step swing the light THROUGH the axis. */
                    await api.cap('matLight', 0, 0, 1);
                    await api.wait(400);
                },
                act: async api => {
                    api.status('Specular Base 30 to 220, light head on');
                    await api.sweep({ id: 'at-mat-p-specularBase', from: 30, to: 220, ms: 2600 }, '#at-mat-lit');
                    api.status('Back to 151, the preset value');
                    await api.setValue('at-mat-p-specularBase', 151);
                    await api.wait(700);
                    api.status('Roughness Base 0 to 255');
                    await api.sweep({ id: 'at-mat-p-roughnessBase', from: 0, to: 255, ms: 2600 }, '#at-mat-lit');
                },
                spotlight: '#at-mat-p-roughnessBase',
                handoff: `Drag the light into the middle of the preview first, then move Roughness. The
                          highlight has to be on screen for this pair to mean anything.`
            },
            {
                id: 'water-tune',
                title: 'Water is those two sliders, pushed',
                covers: ['ui:mat-liquid-presets'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Switch <strong>Type</strong> to <strong>Liquid</strong> and the preset list changes
                      to water, lava, tar and the rest. Same pipeline, same sliders, different table.
                      The tier dropdown drops its solid-only options, because a liquid's character comes
                      from the texture.<br><br>
                      <strong>💧 Still Water</strong> is Roughness Base <strong>15</strong> and Specular
                      Base <strong>169</strong>: nearly a mirror, throwing back most of the light that
                      hits it. Watch roughness go to 120 and back, which is the whole distance between
                      still water and swamp water.<br><br>
                      Normal Strength is most of what separates one body of water from another:
                      <strong>Pool</strong> ships 3, <strong>Still Water</strong> 4,
                      <strong>Running Water</strong> 12, <strong>Waterfall</strong> 20.`,
                setup: async api => { await matOpen(api, 3, 'still_water', 'liquid'); await matAdvanced(api); },
                act: async api => {
                    api.status('Roughness Base 15 to 120, still water to swamp');
                    await api.sweep({ id: 'at-mat-p-roughnessBase', from: 15, to: 120, ms: 2400 }, '#at-mat-lit');
                    api.status('And back to 15');
                    await api.sweep({ id: 'at-mat-p-roughnessBase', from: 120, to: 15, ms: 2400 }, '#at-mat-lit');
                },
                spotlight: '#at-mat-p-roughnessBase',
                handoff: `Step through the liquid presets and watch the Specular and Roughness
                          thumbnails. Lava and tar are the two that break the pattern.`
            },
            {
                id: 'water-reflective',
                title: 'Reflective water in Tomb Engine',
                covers: ['ui:ten-reflective'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `This is the part the preview cannot show you, because the tool has no room to
                      reflect.<br><br>
                      In Tomb Engine a texture can be flagged <em>reflective</em>, and on a reflective
                      material your <strong>specular map is the reflection amount</strong>: the blend
                      between your texture and the environment. Still
                      Water's 169 is about two thirds reflection. Tomb Editor invents a flat 128 when
                      you give a reflective material no specular map at all, so 128 is roughly the
                      middle of the road and anything above it is a deliberate mirror.<br><br>
                      Two things people get wrong here. Roughness only shapes the
                      highlight, so a rough water surface still mirrors sharply. And on a room surface the normal map only bends the reflection by
                      about a tenth of its strength, so ripples show up in the highlight far more than
                      in the mirrored image.<br><br>
                      In Tomb Editor: the texture panel, <strong>Materials</strong>, then
                      <strong>Material type</strong>. <strong>Reflective</strong> mirrors the room,
                      <strong>Skybox Reflective</strong> mirrors the sky.<br><br>
                      Two things that save time. The maps this tool exports are already named the way
                      Tomb Editor looks for them, so dropping them beside the texture is enough and you
                      only need that dialog to change the type. And the dialog's own intensity boxes do
                      nothing in the current engine, so the numbers you set here are the numbers that
                      ship.`,
                setup: async api => { await matOpen(api, 3, 'still_water', 'liquid'); },
                spotlight: '#at-mat-previews',
                handoff: `The <strong>Specular</strong> thumbnail is the reflection mask for a
                          reflective material. Anywhere it is dark, your texture shows through instead
                          of the sky.`
            }
        ]
    },

    {
        id: 'materials-using',
        icon: '\u{1F58C}',
        title: 'Using materials',
        blurb: 'Picking one, judging whether it landed, and putting it on 30 tiles without doing it 30 times.',
        steps: [
            {
                id: 'preset-picker',
                title: 'Three dropdowns, in that order',
                covers: ['action:material', 'ui:mat-preset-picker'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Type</strong> picks the table: <strong>Solid</strong> for surfaces you
                      walk on and bump into, <strong>Liquid</strong> for water, lava, tar and the rest.
                      <strong>Aesthetic</strong> re-cuts that table three ways, which is the next step.
                      <strong>Preset</strong> is the material itself, 51 of them for solids.<br><br>
                      Pick by <em>what the surface is</em>, not by how you want it to look. The presets
                      are named after materials because the numbers in them describe how that material
                      behaves in light, and a stone that you wanted shinier is still stone: tune it
                      afterwards, in the panel lesson 7 opened.<br><br>
                      The line under the picker is the preset's own description. It is worth reading
                      once per material, because it tells you what the numbers were chosen for.`,
                setup: async api => { await matOpen(api, 0, 'brick'); },
                spotlight: '#at-mat-pickrow',
                handoff: `Scroll the preset list. Most of them are ordinary building materials, and
                          the fastest way to learn the list is to watch the map thumbnails while you
                          arrow through it.`
            },
            {
                id: 'tiers',
                title: 'Tiers: the same materials, pushed harder or softer',
                covers: ['ui:mat-tiers'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `The <strong>Aesthetic</strong> dropdown re-cuts the same solid list three ways.
                      <strong>📷 Realistic</strong> is the calibrated default and the right answer for
                      most TR-style packs. <strong>🗿 Dramatic</strong> deepens the crevice shadows and
                      strengthens the relief. <strong>✨ Fantasy</strong> goes the other way: soft
                      relief, flat shading, a brighter sheen, and a little glow on the precious
                      materials. <strong>🫥 Decal</strong> is a separate short list for transparent
                      overlays, not a tier.<br><br>
                      A tier is mostly an <em>ambient occlusion</em> decision, which is why the ring is
                      on that thumbnail. Watch it, not the lit preview. On this brick, Realistic to
                      Dramatic moves the AO map by 74 levels out of 255.<br><br>
                      It also only does anything to materials that have relief to push.
                      <strong>Chrome</strong> between Realistic and Dramatic moves the AO map by 2 and
                      the normal map by <em>zero</em>. Nothing is broken, a mirror simply has nothing
                      to deepen.<br><br>
                      Tier is per tile, so a Dramatic stone wall can sit next to a Realistic metal door.`,
                setup: async api => { await matOpen(api, 0, 'brick'); },
                act: async api => {
                    for (const [a, label] of [['dramatic', 'Dramatic'], ['fantasy', 'Fantasy'],
                                              ['realistic', 'Realistic again']]) {
                        api.status(label);
                        await api.setValue('at-mat-aesthetic', a, 'change');
                        await api.wait(500);
                        /* The tier change repopulates the preset list and lands on its first
                           entry, so the material has to be re-picked or this compares Brick
                           against Asphalt. */
                        await api.setValue('at-mat-preset', 'brick', 'change');
                        await api.wait(1200);
                    }
                },
                spotlight: '#at-mat-previews [data-map="ao"]',
                handoff: `Switch to <strong>Chrome</strong> and run the same three tiers. The
                          thumbnails barely move, which is the honest answer for a polished surface.`
            },
            {
                id: 'contrast-advice',
                title: 'When the tool says the texture is too flat',
                covers: ['ui:mat-contrast-advisory'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Every map is derived from the light and dark already in your texture, so the same
                      preset lands differently depending on how much contrast that texture has. The
                      presets are calibrated for a luminance spread of about 20.<br><br>
                      This sand measures <strong>9</strong>, and the tool says so in the line under the
                      picker. It is the only tile on this bench that triggers it. Nothing is corrected
                      for you, and that is deliberate: auto-correction here was built once, shipped,
                      and reverted.<br><br>
                      What to actually do about it, in order: check whether the texture has baked
                      lighting and run <strong>☀ De-light</strong> if it does, since that raises local
                      contrast; consider <strong>🌾 Surface Noise</strong> if the texture is genuinely
                      featureless; or accept it and raise <strong>Normal Strength</strong> and
                      <strong>AO Intensity</strong> by hand, knowing you are amplifying very little
                      signal and will hit grain before you hit depth.`,
                setup: async api => { await matOpen(api, 2, 'sand'); },
                spotlight: '#at-mat-contrast',
                handoff: `Open the same modal on tile 1's brick and the line is gone. Same preset, same
                          code, different texture.`
            },
            {
                id: 'three-ways',
                title: 'Three ways to work, and which one to use',
                covers: ['ui:mat-workflow'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `<strong>Take the preset.</strong> This should be most of your atlas. The presets
                      are calibrated against each other, so a wall and a floor picked straight off the
                      list will sit together in the same room.<br><br>
                      <strong>Start from a preset and tune.</strong> Pick the nearest material, open
                      <strong>⚙️ Advanced editor</strong>, move the two or three sliders that are wrong
                      for your texture. This is the normal case for a hero texture, and it is what
                      lesson 7 was about. The moment you move anything the material is labelled
                      <em>custom</em>.<br><br>
                      <strong>Build it yourself.</strong> Rare and entirely allowed. Worth it when you
                      are inventing a surface that has no real-world equivalent.<br><br>
                      One rule that saves the most time: <em>fix the texture before you tune the
                      material</em>. Baked lighting, low contrast and visible seams all come through
                      into every map, and no slider in this panel removes them.`,
                setup: async api => { await matOpen(api, 0, 'brick'); },
                spotlight: '#at-mat-adv',
                handoff: `Open the advanced editor and look at how few sliders are actually wrong for
                          this brick. That is what "start from a preset" buys you.`
            },
            {
                id: 'batch',
                title: 'One material onto a whole selection',
                covers: ['ui:mat-batch'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Assigning materials one tile at a time is the slowest part of preparing an atlas,
                      and it is unnecessary. Select several tiles, right-click any one of them, and the
                      menu entry reads <strong>🎨 Set Material: 3 tiles…</strong>. The modal opens with
                      a banner saying the same thing, and the preview shows one of them.<br><br>
                      Three tiles are selected here: the brick, the pipes and the sand. They are
                      deliberately three different materials, because the point is that the
                      <em>mechanism</em> is per selection while the <em>choice</em> is still yours. A
                      selection of six brick variants is the case this was built for.<br><br>
                      The whole batch is one undo step, not one per tile.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('selectIdx', [0, 1, 2]);
                    await api.wait(300);
                    await api.cap('openCtx', await api.tileId(0));
                    await api.cap('ctxOpenCat', 'material');
                    await api.wait(400);
                },
                spotlight: '#at-ctx button[data-action="material"]',
                act: async api => {
                    await api.click('#at-ctx button[data-action="material"]');
                    await api.wait(1400);
                },
                spotlightAfter: '#at-modal-mat .at-batch-note',
                handoff: `Pick a material and press <strong>Assign Material</strong>, then Ctrl+Z once.
                          All three revert together.`
            },
            {
                id: 'apply-last',
                title: 'Apply Last Material: the two-click repeat',
                covers: ['action:lastmaterial'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Once you have assigned a material, the tool remembers it, and a second entry
                      appears in the context menu: <strong>🎨 Apply Last Material</strong>, with that
                      material's name in brackets so you can see what you are about to repeat. No
                      modal, no picker, no preview. Right-click a tile, click it, done.<br><br>
                      This is the fastest way to work through an atlas of mixed textures, because the
                      real pattern is not "40 tiles of stone" but "stone, stone, wood, stone". Set the
                      material properly once, then spend two clicks per tile that matches.<br><br>
                      It respects a selection like everything else in this menu, so it also applies to
                      as many tiles as you have highlighted.<br><br>
                      It is hidden until there <em>is</em> a last material, which is why it was not in
                      the menu the first time you looked.`,
                setup: async api => {
                    /* Guarantee the state this step describes, rather than inheriting it from
                       the previous one: the dots let anyone arrive here first, and the menu
                       entry is display:none until a material has actually been assigned. */
                    await api.closeMenu();
                    await api.cap('selectIdx', []);
                    if (!(await api.cap('lastMaterial'))) {
                        await matOpen(api, 0, 'brick');
                        await api.click('#at-mat-save');
                        await api.wait(900);
                    }
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(3));
                    await api.cap('ctxOpenCat', 'material');
                    await api.wait(400);
                },
                spotlight: '#at-ctx button[data-action="lastmaterial"]',
                handoff: `Click it, then right-click another tile and click it again. Two clicks per
                          tile is the whole point.`
            },
            {
                id: 'multi-material',
                title: 'Two materials on one texture',
                covers: ['ui:mat-multi'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Tile 5 is a metal door in a painted frame. One material cannot describe both: the
                      frame wants the roughness of paint and the door wants the sheen of metal, and
                      whichever you pick is wrong for half the tile.<br><br>
                      <strong>🎭 Multiple materials</strong> paints them separately. The modal widens
                      into a Material Layer list: the <strong>Base</strong> covers the whole tile, and each Material Layer
                      above it paints its own material over a region you select. Order matters, bottom
                      to top, like layers in a photo editor.<br><br>
                      The selection tools are the same ones lesson 2 used for Heal and De-light, so the
                      <strong>Wand</strong> is usually the quickest start here: the frame is a different
                      colour from the door, so one click takes most of it.<br><br>
                      The maps are composited per Material Layer at generation time, so what exports is one
                      normal map and one roughness map for the tile, with both materials in them.`,
                setup: async api => {
                    await matOpen(api, 4, 'metal');
                    await api.wait(200);
                    const d = api.doc();
                    const box = d && d.getElementById('at-mm-enable');
                    if (box && !box.checked) { await api.click('#at-mm-enable'); await api.wait(1200); }
                },
                spotlight: '#at-mat-multi',
                handoff: `Press <strong>＋ Add Material Layer</strong>, give it a different material, then wand
                          the red frame on the canvas. The lit preview updates as you paint.`
            },
            {
                id: 'saved-presets',
                title: 'Save the one you tuned',
                covers: ['ui:mat-saved-presets'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `A custom material is worth keeping the moment you use it twice.
                      <strong>⭐ Save as preset…</strong> names the current settings, sliders included,
                      and files them under the <strong>⭐ My presets</strong> aesthetic. Saved ones also
                      appear as one-click chips at the top of this modal, so they are not buried behind
                      a dropdown.<br><br>
                      <strong>✎ Rename</strong> and <strong>🗑 Delete</strong> appear once a saved preset
                      is the one selected. Deleting is safe for work you have already done: tiles using
                      that material keep it.<br><br>
                      <strong>⬇ Export</strong> writes every saved preset to a JSON file and
                      <strong>⬆ Import</strong> reads one back, which is how a team shares a house
                      style, or how you move your presets to another machine. The course does not press
                      Export, because it would put a file in your downloads folder.`,
                setup: async api => { await matOpen(api, 0, 'brick'); await matAdvanced(api); },
                spotlight: '#at-mat-presetbar',
                handoff: `Move a slider, then press <strong>⭐ Save as preset…</strong> and name it. The
                          chip row appears at the top of the modal, and your preset is in the picker
                          under <strong>⭐ My presets</strong>.`
            },
            {
                id: 'what-it-produces',
                title: 'What you actually get',
                covers: ['ui:mat-output'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Assigning a material does not change your texture. It attaches a recipe, and the
                      maps in this row are generated from it on demand. The diffuse you see in the grid
                      is untouched, and nothing is written to disk until you export.<br><br>
                      That has three consequences worth knowing. Changing your mind is free, so
                      reassigning a material costs nothing. Editing the texture afterwards is fine,
                      because the maps regenerate from the edited pixels. And a transition or a border
                      set <em>inherits</em> from the textures it was built from, so material the sources
                      first and the generated tiles arrive already carrying it.<br><br>
                      Which maps actually leave the tool is a separate decision, made on the export
                      card. That, and what Tomb Editor does with the files, is lesson 10.`,
                setup: async api => { await matOpen(api, 0, 'brick'); },
                spotlight: '#at-mat-previews',
                handoff: `Close this and look at the tile in the grid. The label under it names the
                          material, and the picture is exactly the one you started with.`
            }
        ]
    },

    {
        id: 'depth-glow',
        icon: '\u{1F30B}',
        title: 'Depth, glow & transparency',
        blurb: 'The two material maps with their own editor, the tool that makes holes, and what holes do to the rest.',
        steps: [
            {
                id: 'three-more',
                title: 'These are materials too',
                covers: ['ui:depth-glow-intro'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>Height</strong> and <strong>emissive</strong> are material maps like
                      normal, AO, roughness and specular. Same pipeline, same export, and a preset
                      already sets <strong>Height Strength</strong> and <strong>Emissive Strength</strong>
                      along with everything else. You moved both sliders in lesson 7.<br><br>
                      They get their own editors because each authors a map for <em>one</em> texture out
                      of something you pick or paint, which is a different activity from choosing a
                      material for a surface. And people want them on their own, constantly: a glowing
                      sign needs no roughness work, a parallax wall needs no emissive.<br><br>
                      <strong>Transparency is the odd one out: it lives in your texture's own
                      alpha.</strong> Nothing is generated for it and nothing extra is exported.
                      It is in this lesson because the tool that authors it,
                      <strong>🫥 Fade to Transparent</strong>, lives here, and because a cutout changes
                      what the other maps do inside the hole.<br><br>
                      Four textures on the bench: brick with deep joints for depth, a skylight with
                      bright panes to light up, foliage to fade out, and a grate with real holes in it.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: { grid: 0 },
                handoff: `Right-click any of them. <strong>🏔️ Make Height Map</strong> and
                          <strong>✨ Make Emissive</strong> are under <strong>Material</strong>,
                          <strong>🫥 Fade to Transparent</strong> is under <strong>Edit</strong> with the
                          other tools that change the picture itself.`
            },
            {
                id: 'heightmap',
                title: 'Height: depth the engine walks into',
                covers: ['action:heightmap', 'modal:heightmap'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `A normal map fakes relief by lying about which way the surface faces. A
                      <strong>height</strong> map is read differently: Tomb Engine marches into the
                      surface along your view, so a near stone genuinely slides in front of the joint
                      behind it as you walk past. It is the most convincing depth available and the most
                      expensive.<br><br>
                      One rule governs everything else here. <strong>White is the wall.</strong> The
                      engine only ever carves <em>in</em>, so nothing is pushed out in front of the
                      polygon, and the tool puts your texture's high points on white so the whole depth
                      range goes into relief instead of sinking the surface.<br><br>
                      The panel on the left builds the map, the tile and its map sit side by side in the
                      middle, and the preview on the right is running Tomb Engine's own parallax shader.
                      Grab it and turn it.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="heightmap"]'); await api.wait(1600);
                },
                spotlight: '#at-hg-map',
                handoff: `Black is deep, white is the wall surface. Compare it against the tile beside
                          it: the mortar should be the dark part.`
            },
            {
                id: 'height-turn',
                title: 'Turn it, or you are looking at a picture',
                covers: ['ui:height-preview'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Parallax exists in the difference between two viewing angles, so a still frame of
                      it is worth nothing. Watch the preview swing: the stones slide across the joints,
                      the joints disappear behind them at a grazing angle, and the outline of the tile
                      never changes.<br><br>
                      The engine does exactly that: the
                      geometry stays a flat quad. Relief is an illusion painted inside the polygon, so a
                      parallax wall seen edge on is still dead flat, which is why the tool previews it
                      with this shader instead of a bumpy 3D mesh that would promise something the
                      engine never delivers.<br><br>
                      The view is state, not a control. There are no Turn and Tilt sliders because you
                      turn a 3D view by grabbing it, and the readout tells you how far off square you
                      are.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="heightmap"]'); await api.wait(1600);
                },
                act: async api => {
                    api.status('Turning the surface');
                    /* Reduced motion gets one off-square angle instead of a sweep: the
                       relief still reads, nothing animates. Same rule as orbitLight. */
                    if (api.reduced()) { await api.cap('hgView', 55, 20); return; }
                    const t0 = Date.now();
                    for (;;) {
                        const t = Math.min(1, (Date.now() - t0) / 5200);
                        const a = Math.sin(t * Math.PI * 2);
                        await api.cap('hgView', 35 + a * 45, 18 + Math.cos(t * Math.PI * 2) * 12);
                        if (t >= 1 || api.aborted()) break;
                        await api.wait(30);
                    }
                    await api.cap('hgView', 35, 18);
                },
                spotlight: '#at-hg-pom',
                handoff: `Drag on it yourself, or focus it and use the arrow keys.
                          <strong>Reset view</strong> puts it back to square.`
            },
            {
                id: 'height-source',
                title: 'Which part sinks is a choice',
                covers: ['ui:height-source'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `By default the map is read from light and dark: bright is high, dark is deep. That
                      works on this brick because the mortar happens to be darker than the stones.<br><br>
                      It is not always true. Plenty of walls have pale mortar between dark stones, and
                      read by luminance those come out inside out, with the joints standing proud of the
                      wall. So the source can be <strong>a colour I pick</strong> or
                      <strong>a hue range</strong> instead, and <strong>Which side sinks</strong> says
                      which of the two parts ends up deep.<br><br>
                      The line under those controls always states the result in words, because "invert"
                      is ambiguous and this is the setting people get backwards.<br><br>
                      <strong>Blur</strong> is worth a look too. Height is marched per pixel, so noise in
                      the source becomes a surface that swims. Smooth it first.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="heightmap"]'); await api.wait(1600);
                },
                spotlight: '#at-hg-source',
                sweep: { id: 'at-hg-strength', from: 10, to: 50, ms: 2600 },
                preview: '#at-hg-map',
                handoff: `That sweep was <strong>Depth</strong>. Switch the source to a colour and pick
                          the mortar, then watch the map redraw around that choice instead of around
                          brightness.`
            },
            {
                id: 'height-edges',
                title: 'The white border, and why parallax dies on small tiles',
                covers: ['ui:height-edge-band'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The march walks the texture coordinate <em>across the atlas page</em>, and it walks
                      a long way: about 14 pixels at a 45 degree view and 36 at the grazing limit,
                      against the 8 pixels of bleed a packed atlas leaves you. Without protection it
                      reads straight into whatever texture is packed next door, which is where black
                      bars along texture edges come from.<br><br>
                      <strong>Fade height edges to white</strong> is the fix, and it is on by default.
                      White is depth zero, so it terminates the march at the border rather than letting
                      it wander.<br><br>
                      That band is a fixed number of pixels, so the smaller the tile the bigger a
                      fraction of it the band eats: <strong>3.5% at 1024, 14% at 256, over half a 64px
                      tile</strong>. The advisory under the slider says so. <em>Parallax does not
                      survive on small textures</em>, and the honest answer there is to not use height
                      on them.<br><br>
                      The profile picker matters on coursed masonry: <strong>Joint-aware</strong> ends
                      the fade on a mortar line so the border reads as a joint rather than as a smear.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="heightmap"]'); await api.wait(1600);
                    const d = api.doc();
                    const acc = d && d.getElementById('at-hg-edge-acc');
                    if (acc && !acc.open) { await api.click('#at-hg-edge-acc summary'); await api.wait(700); }
                },
                spotlight: '#at-hg-band',
                sweep: { id: 'at-hg-band', from: 4, to: 34, ms: 2600 },
                preview: '#at-hg-map',
                handoff: `Height also switches <strong>SSAO off</strong> for that material in engine and
                          disables bullet holes and explosion marks on it. Use it on a handful of hero
                          textures per level, never the whole atlas.`
            },
            {
                id: 'emissive',
                title: 'Emissive: light the surface makes itself',
                covers: ['action:emissive', 'modal:emissive'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `An <strong>emissive</strong> map glows regardless of the lighting in the room.
                      Lava cracks, runes, screens, neon, and this skylight's panes. Black means no glow,
                      and a coloured pixel glows in its own colour in pitch darkness.<br><br>
                      Tile 2 is the easy case: the panes are the brightest thing in the texture, so
                      <strong>Bright areas</strong> picks them out with one slider. Watch the threshold
                      sweep down and the glow spread from the panes onto the frame around them, which is
                      the moment you have gone too far.<br><br>
                      The other three modes exist for when brightness is not the distinguishing feature:
                      pick a colour, pick a hue range, or paint it by hand. Runes on a dark wall are
                      usually a hue; a specific broken lamp is usually paint.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="emissive"]'); await api.wait(1400);
                    await api.setValue('at-em-mode', 'brightness', 'change'); await api.wait(800);
                },
                spotlight: '#at-em-preview',
                sweep: { id: 'at-em-threshold', from: 95, to: 35, ms: 3000 },
                preview: '#at-em-preview',
                handoff: `Pull the threshold back up until only the panes glow, then drop
                          <strong>Strength</strong> until it looks like glass rather than a light bulb.`
            },
            {
                id: 'emissive-paint',
                title: 'Painting a glow, and painting how much',
                covers: ['ui:emissive-paint'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Switch the mode to <strong>Paint it</strong> and you get the same brush, wand,
                      lasso and rectangle that Heal and De-light use, so nothing new to learn.<br><br>
                      One control here is worth knowing about because it is easy to miss:
                      <strong>Brightness</strong> in the brush toolbar paints an <em>intensity</em> into
                      the mask, not just "glowing or not". Paint at 40 and that region glows at 40% of
                      the master <strong>Strength</strong>. That is how you get a lamp with a hot centre
                      and a dimmer rim without two passes.<br><br>
                      The catch, and the UI says it too: you cannot paint a lower value over a higher
                      one. Strokes accumulate upward. Erase first, then repaint.<br><br>
                      A tile with an authored glow gets an <strong>E</strong> badge in the grid, because
                      the glow never touches the picture and you would otherwise have no way to see that
                      it is there.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(1)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="emissive"]'); await api.wait(1400);
                    await api.setValue('at-em-mode', 'paint', 'change'); await api.wait(900);
                },
                spotlight: '#at-em-tools',
                handoff: `Paint over a pane, then drop <strong>Brightness</strong> to 40 and paint the
                          frame. Two intensities, one mask.`
            },
            {
                id: 'fade',
                title: 'Fade to transparent: edges that stop existing',
                covers: ['action:fade', 'modal:fade'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>🫥 Fade to Transparent</strong> fades part of a texture to alpha 0, so
                      it can sit over another surface without a visible rectangle around it: foliage,
                      grime, dust, a poster, a scorch mark.<br><br>
                      Three shapes. <strong>Direction / slope</strong> fades along one direction, and it
                      is what this foliage wants. Leaves grow out of something, so here they stay solid
                      in the bottom-left corner and fade out diagonally toward the top-right, the way a
                      bush sits against a wall and floor. That is <strong>◹ Slope TR</strong>.
                      <strong>Edges (vignette)</strong> fades all four sides inward, for a decal that
                      floats in the middle of a wall. <strong>Custom (paint)</strong> hands you the
                      brush.<br><br>
                      <strong>Fade amount</strong> and <strong>Shape edge hardness</strong> are easy to
                      confuse. Amount is how far the fade reaches into the tile, which is what the sweep
                      moves; hardness is how abruptly it happens, 0 being a wide soft gradient and high
                      being close to a cut. (The brush toolbar in <strong>Custom (paint)</strong> has its
                      own <strong>Edge softness</strong>, which feathers the stroke.)<br><br>
                      <strong>🌿 Organic edge</strong> breaks the outline up with the same styles the
                      transition tools use: blobs, spikes, drips, clumps, fray. A mathematically
                      straight fade line is what gives foliage away, and this is the fix.<br><br>
                      This changes the texture's own alpha, so everything downstream follows: the maps
                      flatten inside it, which is the next step.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="fade"]'); await api.wait(1400);
                    await api.setValue('at-fade-shape', 'dir', 'change'); await api.wait(300);
                    await api.setValue('at-fade-dir', 'SlopeTR', 'change');
                    await api.setValue('at-fade-edgehard', 40);
                    await api.wait(400);
                },
                expectState: { 'at-fade-shape': 'dir', 'at-fade-dir': 'SlopeTR', 'at-fade-edgehard': '40' },
                spotlight: '#at-fade-preview',
                sweep: { id: 'at-fade-amount', from: 5, to: 45, ms: 2600 },
                preview: '#at-fade-preview',
                handoff: `Open <strong>🌿 Organic edge</strong> and push <strong>Amount</strong> up, so the
                          diagonal breaks up into leaves. Then try <strong>Edges (vignette)</strong> for
                          the floating-decal version.`
            },
            {
                id: 'transparency',
                title: 'Your alpha, and what the maps do inside a hole',
                covers: ['ui:transparency-maps'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Your texture's alpha is the whole of its transparency. Nothing is generated for
                      it, nothing extra is exported, and Tomb Editor reads it straight off the diffuse.
                      What a cutout changes is the <em>other</em> maps, and that is worth seeing
                      once.<br><br>
                      Tile 4 is a grate with real holes in it. Open its material and look at the
                      thumbnails: every map generated for it is fully opaque, and the areas under the
                      holes are white rather than dark.<br><br>
                      Both halves of that are deliberate. A map is <em>data</em>, not a picture, so a
                      hole in it would mean nothing to the engine. And a transparent pixel arrives as
                      pure black, which is the deepest value there is, so left alone every hole would
                      become the deepest pit in the height map and every cutout edge a cliff. The tool
                      detects alpha and flattens those regions to white instead, the wall's own surface,
                      so they carry no relief. There is nothing to switch on.<br><br>
                      Performance suggestion, for Tomb Editor's <strong>Blending mode</strong>. Left on
                      <strong>Normal</strong>, a texture like this grate is drawn blended (Alpha Blend;
                      there is no separate entry for it): sorted every frame, no depth writes.
                      <strong>Alpha Test</strong> is cheap and suits holes like these, fences, grates,
                      plants, without much loss: anything more than half solid just draws fully solid.
                      <strong>Additive</strong> is cheap too, and suits glow and haze instead of holes.
                      Working with magenta rather than alpha? Tick <strong>Magenta color-key</strong> on
                      export, and Normal already gives Alpha Test, since Tomb Editor's <strong>Magenta to
                      alpha</strong> (on by default) turns the keyed pixels clear.<br><br>
                      One real warning, and the export card repeats it: <em>be careful pairing Height
                      with a cutout</em>. Parallax shifts the texture coordinate before the holes are
                      cut, so a cutout's edges move with the relief and can be eaten away or show
                      through. Normal and AO are safe. If a fence looks wrong in game, drop Height first
                      and keep the rest.`,
                setup: async api => {
                    await matOpen(api, 3, 'metal');
                },
                spotlight: '#at-mat-previews [data-map="height"]',
                handoff: `Compare the Height thumbnail against the tile: the bars carry relief and the
                          gaps are flat. Now look at Normal, which does the same thing.`
            },
        ]
    },

    /* ============ LESSON 10 — animated textures ============
       Split out of lesson 3 on 2026-09-22. It was ONE step there, written when
       there was one generator and no overlay; there are now two generators, a
       Colour tab, a Glow tab, an Overlay tab with a moving level and an organic
       contour, and an export story (a second variant costs a second full set of
       tiles) that no other lesson has a place for.

       ELEVEN steps as of 2026-09-23, up from eight, from user testing. The
       reported sticking point was "waves that go in and out", which is the
       interaction of Direction, Motion, Low/High, Cycles, Frames and fps — four
       controls and two global settings that were all compressed into one step
       whose sweep moved High alone. So `anim-level` is now two: what the level
       DOES, then how far it goes and how long it takes, which is where the loop
       duration finally gets said out loud. The other two new steps are the
       particle depth and defocus sliders (the classic-versus-HD note from the
       same round) and the height-map coverage mode.

       Position matters: it sits after Depth & glow and before Export, because
       the Glow tab is the emissive idea from lesson 9 applied per frame, the
       overlay steps need the cutout idea from the same lesson, and the last
       step hands straight over to the export lesson. It also declares
       DemoDepthSet, so walking 9 -> 10 -> 11 costs no reload and the grate the
       overlay steps need is already on the bench. */
    {
        id: 'animated',
        icon: '\u{1F39E}\u{FE0F}',
        title: 'Animated textures',
        blurb: 'Water, lava, rain and sparks as looping frames, and how to bake a static texture into every one of them.',
        steps: [
            {
                id: 'anim-what',
                title: 'An animation is N tiles',
                covers: ['ui:add-anim', 'modal:anim', 'ui:anim-perrow'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Tomb Engine animates a texture by <em>swapping which part of the atlas a face
                      reads</em>, frame by frame. So an animation is a set of ordinary tiles, and
                      the engine steps through them. They land as one
                      block on a fresh row: <strong>Frames per row</strong>, beside
                      <strong>Frames</strong>, sets its width (16 frames default to 4 × 4), and the
                      sketch next to it shows the shape.<br><br>
                      That is the whole mental model, and everything else follows from it. Each
                      frame has to tile on its own, the last frame has to meet the first, and the
                      material maps ship as matching atlases with the same layout so a normal map
                      lines up frame for frame.<br><br>
                      <strong>Pattern scale</strong> is the one control to respect early: the line
                      under it says how many pixels each feature gets, and under about six the
                      animation turns to confetti on a small tile. At 32px the useful ceiling is
                      around 4.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'lava', 'change'); await api.wait(1200);
                },
                spotlight: '#at-anim-preset',
                sweep: { id: 'at-anim-scale', from: 3, to: 9, ms: 1800 },
                preview: '#at-anim-tiled',
                handoff: `Change <strong>Preset</strong> and watch both canvases. The second one is a
                          2x2 tiling, which is where you check the seam. <strong>Output</strong> can
                          also emit a <em>Single seamless tile</em> for UV-rotate instead of a
                          sequence: one tile that scrolls.`
            },
            {
                id: 'anim-colour',
                title: 'Structure and colour are separate',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The <strong>Shape &amp; motion</strong> tab makes a moving greyscale field. The
                      <strong>Colour</strong> tab decides what that field looks like. They are
                      independent, which is more useful than it sounds: put a lava palette on cloud
                      structure and you have something nobody has a preset for.<br><br>
                      The gradient bar is editable. Click it to add a stop, drag to move one, click a
                      stop to set its colour and its <em>alpha</em>, which is how you get smoke and
                      dust that you can see through. The sliders under it re-grade the whole ramp.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'clouds', 'change'); await api.wait(1200);
                    await api.click('#at-modal-anim .at-anim-tab[data-anim-tab="colour"]'); await api.wait(500);
                    await api.setValue('at-anim-gradient', 'lava_hot', 'change'); await api.wait(900);
                },
                expectState: { 'at-anim-preset': 'clouds', 'at-anim-gradient': 'lava_hot' },
                spotlight: '#at-anim-ramp-wrap',
                sweep: { id: 'at-anim-col-hue', from: 0, to: 140, ms: 2000 },
                preview: '#at-anim-preview',
                handoff: `Cloud structure, lava palette. Try <strong>Posterize</strong> for banded
                          retro water, and drop a stop's <strong>Alpha</strong> to zero to punch a
                          hole through the animation.`
            },
            {
                id: 'anim-glow',
                title: 'Glow that moves with it',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Lesson 9 painted an emissive map onto a still texture. Here it is derived from
                      <em>each frame</em>, so the glow travels with the motion: a lava range lights
                      along its shifting cracks rather than glowing through a fixed stencil.<br><br>
                      <strong>Pulse</strong> throbs the whole thing on a sine over the loop. It takes
                      a whole number of <strong>cycles</strong> for the same reason the animation does,
                      so the last frame still meets the first. Useful when the surface barely moves
                      but you want it alive: a beacon, breathing lava, a power core.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'lava', 'change'); await api.wait(1200);
                    await api.click('#at-modal-anim .at-anim-tab[data-anim-tab="glow"]'); await api.wait(500);
                    const d = api.doc();
                    const cb = d && d.getElementById('at-anim-glow-enable');
                    if (cb && !cb.checked) { await api.click('#at-anim-glow-enable'); await api.wait(900); }
                },
                expectState: { 'at-anim-glow-enable': true, 'at-anim-preset': 'lava' },
                spotlight: '#at-anim-glow-strength',
                sweep: { id: 'at-anim-glow-strength', from: 40, to: 180, ms: 1800 },
                preview: '#at-anim-glow-strip',
                handoff: `Tick <strong>Pulse</strong> and set <strong>cycles</strong> to 2. The
                          <strong>Emissive</strong> export map switches itself on, because a glow you
                          cannot export is not a glow.`
            },
            {
                id: 'anim-particles',
                title: 'The second generator: particles',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `A noise field churns. It cannot draw a straight streak, count its own raindrops
                      or fall at an angle, so rain has a generator of its own.<br><br>
                      Pick anything from the <strong>Particles</strong> group and the
                      <strong>Shape</strong> tab swaps over: <strong>Amount</strong>,
                      <strong>Direction</strong> on a ladder of fixed slants, <strong>Speed</strong>,
                      <strong>Streak length</strong>, <strong>Thickness</strong> and
                      <strong>Tail fade</strong>, plus sway and gusts.<br><br>
                      Speed reads out in <em>tiles per frame</em>, which is the number that decides
                      whether it falls or strobes past. The line under the sliders warns you before
                      it does either.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'rain_drizzle', 'change'); await api.wait(1400);
                },
                expectState: { 'at-anim-preset': 'rain_drizzle' },
                spotlight: '#at-anim-particle-controls',
                sweep: { id: 'at-anim-p-count', from: 60, to: 600, ms: 2000 },
                preview: '#at-anim-preview',
                handoff: `Push <strong>Speed</strong> up until the advisory line complains, then read
                          what it says: a fast particle with a short trail jumps between frames
                          instead of falling. <strong>Sway</strong> is what makes snow look like snow.`
            },
            {
                id: 'anim-particle-depth',
                title: 'Near and far, and why it looks real',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Every particle is already given a depth. <strong>Depth spread</strong> has
                      always used it to sort them into that many speed bands, so the near ones fall
                      faster than the far ones. Two more sliders read the same number.<br><br>
                      <strong>Size by depth</strong> makes far particles smaller and dimmer.
                      <strong>Depth blur</strong> softens the far bands and leaves the nearest one
                      sharp, which is what a camera does and what the eye reads as distance. Both
                      are off by default, so the eight original presets come out byte for byte as
                      they always did.<br><br>
                      This is the difference between a streak of one flat colour and rain on glass.
                      At 128px or smaller a blurred particle is a smudge, so this is aimed at 256
                      and up. Try the <strong>Rain on glass (deep)</strong>, <strong>Rain, soft slant</strong> and
                      <strong>Snow, deep</strong> presets, which ship with both turned on.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'rain_glass', 'change'); await api.wait(1600);
                    await api.reveal('#at-anim-p-dscale');
                },
                expectState: { 'at-anim-preset': 'rain_glass' },
                spotlight: '#at-anim-p-depth-hint',
                sweep: { id: 'at-anim-p-defocus', from: 0, to: 12, ms: 2200 },
                preview: '#at-anim-preview',
                handoff: `<strong>Rain on glass (deep)</strong> has <strong>Speed</strong> at 0, which is
                          legal and deliberate: beads that hold still on the glass rather than rain
                          falling past it. Raise <strong>Depth spread</strong> to get more distinct
                          planes, since that slider is also what sets how many there are.`
            },
            {
                id: 'anim-overlay',
                title: 'Bake a texture into every frame',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The engine only swaps UVs. There is no second sampler and no blend stage, so
                      there is no way to lay a grate over lava at runtime: whatever sits on top has
                      to be baked into every frame before export.<br><br>
                      That is what the <strong>Overlay</strong> tab does. Pick a texture from the
                      atlas, say whether it sits in front of the animation or behind it, and it is
                      composited into all sixteen frames. The texture stays <em>live</em>: recolour
                      it later and every frame follows.<br><br>
                      <strong>Where it shows</strong> is the colour / hue / brightness picker from
                      Make Emissive. <strong>All of it</strong> uses the texture's own transparency,
                      which is what the metal grate on the bench already has, so the lava shows
                      through its holes untouched.`,
                setup: async api => { await animOverlayOpen(api, 'lava'); await api.reveal('#at-anim-ov-body'); },
                expectState: { 'at-anim-ov-enable': true, 'at-anim-preset': 'lava' },
                spotlight: '#at-anim-ov-body',
                sweep: { id: 'at-anim-ov-opacity', from: 100, to: 40, ms: 1800 },
                preview: '#at-anim-preview',
                handoff: `Switch <strong>Where it sits</strong> to <em>Behind it</em> and pick a
                          particle preset instead: that is rain on a window, with the window as the
                          overlay. <strong>Single seamless tile</strong> goes grey while an overlay is
                          set, because UV-rotate would scroll the grate along with the lava.`
            },
            {
                id: 'anim-level',
                title: 'Lava climbing out of the grate',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>Moving level</strong> sweeps a line across the tile over the loop and
                      hides the overlay behind it. Above the line the grate draws normally; below it
                      the grate is gone and you are looking at raw lava. Over sixteen frames that
                      reads as the liquid welling up through the grate and draining back.<br><br>
                      Both motions close the loop by construction, so there is no snap on the wrap
                      frame whatever cycle count you pick.<br><br>
                      One honest limit, and the tool says it in the panel: a straight line cannot
                      repeat across the edge it travels towards. Stack two copies and liquid at the
                      bottom of one meets dry texture at the top of the next. Fine for a single tile,
                      a grate, a pool, a well. <strong>Spreads out from the shape</strong> swells the
                      overlay's own outline instead and repeats on every edge.`,
                setup: async api => {
                    await animOverlayOpen(api, 'lava');
                    await animOpenAcc(api, 'at-anim-lv-acc');
                    await api.setValue('at-anim-lv-dir', 'up', 'change'); await api.wait(1200);
                    await api.reveal('#at-anim-lv-acc');
                },
                expectState: { 'at-anim-ov-enable': true, 'at-anim-lv-dir': 'up' },
                spotlight: '#at-anim-lv-dir',
                sweep: { id: 'at-anim-lv-high', from: 20, to: 90, ms: 2000 },
                preview: '#at-anim-preview',
                handoff: `The level works in every mode, so it also cuts a painted or colour-keyed
                          overlay. Next: how far it travels, and how long it takes.`
            },
            {
                id: 'anim-level-time',
                title: 'How far it goes, and how long it takes',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `This is the step that answers "it moves too fast", and the answer is
                      arithmetic rather than taste.<br><br>
                      A loop lasts <em>frames ÷ fps</em> seconds. The line under
                      <strong>Preview speed</strong> now says so: 16 frames at 12 fps is 1.3
                      seconds, which is the default and is quick. <strong>Cycles</strong> divides
                      that again, so 2 cycles over the same loop is a swell every 0.7 seconds.
                      Cycles cannot go below 1, because a whole number of them over the loop is
                      what makes the last frame meet the first.<br><br>
                      So there are four levers. Lower the <strong>fps</strong>, which slows the
                      churn with it. Add <strong>Frames</strong>, up to 128, which decouples the
                      two and costs one atlas tile each. Set <strong>Repeat</strong> on the frames
                      in Tomb Editor, which holds each one for several ticks and costs no atlas
                      space at all, only frame slots out of the engine's 256. Or narrow
                      <strong>Low</strong> and <strong>High</strong>: a swell from 40% to 60% covers
                      20% of the tile where the default 0 to 70 covers 70%, in exactly the same
                      time, so it reads as slower and costs nothing at all.`,
                setup: async api => {
                    await animOverlayOpen(api, 'lava');
                    await animOpenAcc(api, 'at-anim-lv-acc');
                    await api.setValue('at-anim-lv-dir', 'up', 'change'); await api.wait(1200);
                    await api.setValue('at-anim-lv-low', 35, 'input');
                    await api.setValue('at-anim-lv-high', 65, 'input'); await api.wait(1400);
                    await api.reveal('#at-anim-lv-time');
                },
                expectState: { 'at-anim-lv-dir': 'up', 'at-anim-lv-low': '35', 'at-anim-lv-high': '65' },
                spotlight: '#at-anim-lv-time',
                sweep: { id: 'at-anim-lv-cycles', from: 1, to: 4, ms: 1800 },
                preview: '#at-anim-preview',
                handoff: `Watch the readout while you drag <strong>Preview speed</strong>: that fps
                          is also written into the export manifest, and it is what you set on the
                          range in Tomb Editor.`
            },
            {
                id: 'anim-depth-mode',
                title: 'Water in the mortar',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The last coverage mode reads the texture's own <em>height</em>, and it is the
                      one that makes a wall look wet rather than painted.<br><br>
                      <strong>Where the surface is deep or raised</strong> builds a height field
                      from the texture, exactly the way the height-map transition does, and shows
                      the texture on one side of a threshold. On <strong>the raised parts</strong>
                      the bricks stay dry and the liquid finds the mortar joints and the cracks.
                      <strong>Detail</strong> is the control that decides whether that works: it is
                      a blur radius in pixels, and a joint narrower than it gets smoothed away
                      before the threshold ever sees it. The line under the sliders gives you the
                      radius in pixels for your tile size.<br><br>
                      It reads the texture and never the animation, so there is no
                      <strong>Read colours from</strong> here.<br><br>
                      Now put the two together. Turn on <strong>Moving level</strong> and it stops
                      sweeping a straight line and drives the threshold instead, so the liquid
                      rises and falls through the texture's own relief. That is lava welling up out
                      of the mortar of a brick wall, and it needs no control the tool did not
                      already have.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'lava', 'change'); await api.wait(1200);
                    await api.click('#at-modal-anim .at-anim-tab[data-anim-tab="overlay"]'); await api.wait(500);
                    // The BRICK, not the grate: this mode is about a texture with
                    // joints in it. Addressed by tileId, never by the picker's label.
                    const brick = await api.tileId(0);
                    if (brick != null) await api.setValue('at-anim-ov-tile', brick, 'change');
                    const d = api.doc();
                    const cb = d && d.getElementById('at-anim-ov-enable');
                    if (cb && !cb.checked) { await api.click('#at-anim-ov-enable'); await api.wait(1400); }
                    await api.setValue('at-anim-ov-mode', 'depth', 'change'); await api.wait(1600);
                    await api.reveal('#at-anim-ov-grp-depth');
                },
                expectState: { 'at-anim-ov-enable': true, 'at-anim-ov-mode': 'depth',
                               'at-anim-ov-ddetail': '80' },
                spotlight: '#at-anim-ov-grp-depth',
                sweep: { id: 'at-anim-ov-dlevel', from: 20, to: 75, ms: 2200 },
                preview: '#at-anim-preview',
                handoff: `If the texture already has a height map from <strong>Make Height Map</strong>,
                          this uses that one instead of deriving a second, and says so.
                          <strong>In the low ground</strong> flips it: the texture settles into the
                          hollows and the animation takes the high ground.`
            },
            {
                id: 'anim-organic',
                title: 'A water line that looks like water',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `A computed edge is a clean curve, and liquid does not have one.
                      <strong>Organic edge</strong> roughens whichever contour the overlay has, the
                      edge of <strong>Where it shows</strong> and the level line, into something
                      ragged.<br><br>
                      It is the same panel the transition sets use, so the five styles mean the same
                      thing here: <em>Blobs</em> for a general wobble, <em>Drips</em> for long
                      fingers reaching past the line, <em>Fray</em> for a fine fringe.<br><br>
                      <strong>Contact shadow</strong> darkens whatever sits <em>under</em> the
                      texture, so a rim shades the water it stands in and stays clean itself. If you
                      are exporting relief maps, send it to the <strong>AO map</strong>: the map
                      generator reads darkening in the diffuse back out as geometry, and a painted
                      shadow becomes a trench.`,
                setup: async api => {
                    await animOverlayOpen(api, 'lava');
                    await animOpenAcc(api, 'at-anim-lv-acc');
                    await api.setValue('at-anim-lv-dir', 'up', 'change'); await api.wait(900);
                    await animOpenAcc(api, 'at-anorg-acc');
                    await api.setValue('at-anorg-style', 'drips', 'change'); await api.wait(1200);
                    await api.reveal('#at-anorg-acc');
                },
                expectState: { 'at-anim-ov-enable': true, 'at-anim-lv-dir': 'up',
                               'at-anorg-style': 'drips' },
                spotlight: '#at-anorg-acc',
                sweep: { id: 'at-anorg-wobble', from: 0, to: 80, ms: 2200 },
                preview: '#at-anim-preview',
                handoff: `Watch the level line grow fingers as <strong>Amount</strong> rises.
                          <strong>Feature size</strong> changes how often they happen,
                          <strong>Scatter</strong> breaks them up, and <strong>Reroll</strong> gives
                          you a different set of them.`
            },
            {
                id: 'anim-what-you-get',
                title: 'What lands in the atlas',
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Adding them puts sixteen ordinary tiles in the atlas with a purple
                      <strong>A</strong> badge, kept consecutive and in order. Delete one and the
                      whole group goes, because half an animation is not a thing.<br><br>
                      Right-click any frame for <strong>Edit Animation</strong> and every tab comes
                      back where you left it, overlay and all, so you can regenerate the group in
                      place instead of rebuilding it.<br><br>
                      The export manifest lists each animation's tile range, gradient and fps, which
                      is what you need to set it up as an animated range in Tomb Editor. Every
                      material map ships as a matching atlas with the same layout.<br><br>
                      Worth knowing before you plan a level: because the engine only swaps UVs, a
                      <em>second</em> version of an animation, lava, and the same lava with stepping
                      stones on it, costs a second full set of tiles. There is no cheap variant.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                    await api.setValue('at-anim-preset', 'caustic_water', 'change'); await api.wait(1200);
                },
                act: async api => {
                    await api.click('#at-anim-add'); await api.wait(2200);
                },
                spotlight: { modal: 'anim' },
                spotlightAfter: '#at-grid',
                handoff: `The frames are at the end of the grid. Right-click one to see
                          <strong>Edit Animation</strong>, and note that the seamless and transition
                          entries are hidden on a frame: its pixels are regenerated from the recipe,
                          so editing them by hand would be thrown away.`
            }
        ]
    },

    {
        id: 'export-projects',
        icon: '\u{1F4E6}',
        title: 'Export & projects',
        blurb: 'Getting the files out, getting them into Tomb Editor, and not losing the work.',
        steps: [
            {
                id: 'export-card',
                title: 'One name for everything',
                covers: ['ui:export-card'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The export card only exists once there are tiles, which is why you have not seen
                      it before now.<br><br>
                      <strong>Project name</strong> is the one field worth setting first, because it
                      names everything at once: the atlas image, every material-map image beside it, the
                      per-tile files, and the saved project. Use the folder name you want under
                      <em>assets/textures</em> and the whole export arrives already matching it.<br><br>
                      Everything below it is a decision about what leaves the tool. None of it changes
                      your tiles, so you can come back and export a different combination without
                      redoing any work.<br><br>
                      <em>This course never presses the export buttons.</em> Nothing in these steps
                      writes a file to your machine.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: '#at-export-name',
                handoff: `Type a name. It is used verbatim, so whatever convention your level uses is
                          the one to type here.`
            },
            {
                id: 'which-maps',
                title: 'Which maps leave the tool',
                covers: ['ui:export-maps'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Normal, AO, specular and roughness are ticked by default because almost every
                      material wants all four and they cost nothing in engine beyond texture memory.
                      Emissive and height are off by default because most surfaces do not glow and
                      parallax is expensive.<br><br>
                      The rule in the blue notice is the one that bites people, so read it once:
                      <strong>every map atlas must share the same dimensions</strong>. Export them
                      together here and that is guaranteed. Export the normal map now and the roughness
                      map later at a different tile size or column count, and Tomb Engine will refuse to
                      load your material maps.<br><br>
                      Ticking a map does not generate anything now. The maps are derived at export time
                      from each tile's material, which is why changing a material is free right up until
                      you press the button.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: '#at-map-checks',
                act: async api => {
                    api.status('Ticking Height');
                    await api.setChecks('#at-map-checks input', { height: true });
                    await api.wait(1200);
                },
                spotlightAfter: '#at-height-warning',
                handoff: `That warning appeared because Height is now ticked. Untick it and it goes
                          away.`
            },
            {
                id: 'height-cost',
                title: 'The two warnings worth reading',
                covers: ['ui:export-height-warning'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>Height is not just a framerate cost.</strong> A height map also switches
                      <strong>SSAO off</strong> for that material and disables bullet holes, explosion
                      marks and other decals on it, and it is incompatible with animated, double-sided
                      and mirror textures. That is a lot to spend on a whole atlas, so apply height to
                      individual textures and judge each one.<br><br>
                      The second warning counts your transparent tiles, and this bench has one: the
                      grate. Their holes are kept flat in the height map, but parallax shifts the
                      texture before the holes are cut, so a cutout's edges move with the relief and
                      can be eaten away or show through. Check fences and foliage in game, and drop
                      height for those.<br><br>
                      A blue tip further down names the same grate for a different reason: it has
                      transparency at all, Height ticked or not, and points at Tomb Editor's
                      <strong>Blending mode</strong>. <strong>Alpha Test</strong> is the cheap choice
                      for a cutout like this one, which is the thing worth carrying into Tomb
                      Editor.<br><br>
                      <strong>Fade height edges to white</strong> appears with Height and should stay
                      ticked. White is the wall plane, so a white border stops the parallax march at the
                      texture's edge instead of letting it read into whatever is packed next door. That
                      is the black-bars-along-edges bug, prevented.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.setChecks('#at-map-checks input', { height: true });
                    await api.wait(900);
                },
                spotlight: '#at-height-alpha-warning',
                handoff: `<strong>Flip normal Y</strong> above is the other engine-level switch: leave
                          it off for Tomb Engine, tick it only if you are taking the maps somewhere that
                          wants the DirectX convention.`
            },
            {
                id: 'format-layout',
                title: 'Format, layout and the magenta key',
                covers: ['ui:export-format'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>Format.</strong> PNG for everything normally. TGA if your pipeline wants
                      it. PSD packs the diffuse and every enabled map into one layered file for the
                      whole atlas, with the maps as named layers, for editing elsewhere and bringing
                      back.<br><br>
                      <strong>Export layout.</strong> Flat ZIP puts everything in one folder.
                      <strong>TombEngine</strong> arranges it into a <em>Textures/</em> folder so it
                      drops into a level project without rearranging.<br><br>
                      <strong>Magenta color-key</strong> turns clear pixels magenta instead of
                      exporting real alpha, the old colour-key workflow. Tomb Editor's <strong>Magenta
                      to alpha</strong> turns it back, and Normal blending then already gives Alpha
                      Test, the cheap option this lesson keeps coming back to. Leave it off if your
                      pipeline handles alpha; ticking it is destructive to the exported image, so only
                      do it if you mean to.<br><br>
                      <strong>Include the project file</strong> puts the <em>.atlasproj.json</em> inside
                      the ZIP, so the export can be reopened and edited later. It embeds the tile
                      images, so it costs a few megabytes and is almost always worth it.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: '#at-export-layout',
                handoff: `Switch the layout to <strong>TombEngine</strong> if that is where this is
                          going. Nothing else about the export changes.`
            },
            {
                id: 'atlas-preview',
                title: 'See the sheet before you ship it',
                covers: ['ui:atlas-view'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>👁️ Preview atlas</strong> swaps the tiles for the sheet exactly as it
                      will export: same slots, same columns, no gaps, badges or labels, nothing drawn
                      on top. It is the last chance to notice two tiles in the wrong place.<br><br>
                      <strong>Magenta key</strong> appears beside it while the sheet is showing and
                      previews what that export option does to your transparent areas, which is easier
                      to judge here than after the fact.<br><br>
                      Transparency shows as a checkerboard, and so does an empty slot past your last
                      texture. If you see checkerboard where you expected solid pixels, find out which
                      one it is, a tile with alpha you did not know about, or a gap in the layout,
                      before the atlas is in a level. <strong>▦ Back to tiles</strong>, or Esc, returns
                      to the grid.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('atlasView', true);
                    await api.wait(600);
                },
                spotlight: '#at-atlas-view',
                handoff: `Tick <strong>Magenta key</strong> and watch the grate's holes. That is what
                          Tomb Editor would treat as invisible.`
            },
            {
                id: 'room-view',
                title: 'And see it on a wall, not on a sheet',
                covers: ['ui:room-view'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>\u{1F3DB} Room View</strong> opens your atlas on real Tomb Raider room
                      geometry, in a second window, lit the way Tomb Editor bakes a room and shaded
                      the way Tomb Engine draws one. Paint faces by dragging, move the bulbs with
                      their handles, and swing the sun through a day.<br><br>
                      It is the only preview here that can answer "what do these maps do
                      <em>in a room</em>", and the answer is usually narrower than people expect.
                      A bulb you place in Tomb Editor reaches room geometry only through vertex
                      colours baked at compile time, and a vertex colour cannot respond to a normal
                      map. So <strong>Normal</strong>, <strong>Specular</strong> and
                      <strong>Roughness</strong> show up only where a <em>dynamic</em> light reaches,
                      which in a level means a flame, a flare or gunfire.<br><br>
                      <strong>AO</strong> and <strong>Emissive</strong> are the exceptions and work
                      everywhere: one multiplies the finished pixel, the other is added to it.<br><br>
                      The course stops at this button, the same way it stops at Export. It opens a
                      window, which is yours to do when you want it.`,
                // The previous step leaves the sheet showing in place of the tiles.
                setup: async api => { await api.closeMenu(); await api.cap('atlasView', false); },
                spotlight: '#at-room-view',
                handoff: `Open it, drop a flame in the room and tick <strong>Carry it in a circle</strong>.
                          Watching your normal map under a moving light is the fastest way to tell
                          whether it is too strong.`
            },
            {
                id: 'what-you-get',
                title: 'What lands in the ZIP, and what Tomb Editor does with it',
                covers: ['ui:export-output'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>📥 Export Atlas with Material Maps</strong> gives you the stitched sheet
                      plus one image per ticked map, named <em>yourname.png</em>,
                      <em>yourname_n.png</em>, <em>yourname_ao.png</em> and so on.
                      <strong>🧩 Export Tiles Individually</strong> gives you the same thing per tile
                      instead, for editing elsewhere.<br><br>
                      Those suffixes are not ours. <em>Tomb Editor looks for exactly them</em>,
                      <em>_N _H _S _AO _R _E</em> beside a texture, and picks the maps up with no
                      material file at all. So the usual answer to "how do I hook these up" is that you
                      already did: put the files next to each other.<br><br>
                      You only need Tomb Editor's <strong>Materials</strong> dialog to change the
                      material <em>type</em>, which is where the reflective water in lesson 7 was set.
                      Its normal-strength and specular-intensity boxes are read by no shader in the
                      current engine, so whatever you baked here is what renders.<br><br>
                      The course stops at this button. Pressing it downloads a ZIP, which is yours to
                      do when you want it.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: '#at-export-btn',
                handoff: `Press it if you want the file. Everything on this bench is sample content, so
                          nothing here is precious.`
            },
            {
                id: 'import-more',
                title: 'Adding more tiles later',
                covers: ['modal:import'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `An atlas is rarely finished in one sitting. <strong>🗺️ Import from Atlas…</strong>
                      takes another sheet, lets you set the grid that matches it, and adds only the
                      cells you click. <strong>🖼 Add Image(s)</strong> adds whole files as single
                      tiles.<br><br>
                      Set <strong>Columns</strong> and <strong>Rows</strong> to match the source, not to
                      match your atlas. The readout tells you the cell size it worked out, which is the
                      quickest way to tell you got the grid wrong: if it is not a round number, it
                      usually is.<br><br>
                      Everything imported is resized to your atlas's tile size, so a 4096 sheet and a
                      512 one can feed the same project.<br><br>
                      If the source image brings material maps with it, by filename suffix or as PSD
                      layers, those come along and override the generated ones for those tiles.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openImport', 'Examples/ExampleAtlas.png', 256);
                    await api.wait(1400);
                    await api.setValue('at-import-cols', 4, 'change'); await api.wait(400);
                    await api.setValue('at-import-rows', 4, 'change'); await api.wait(800);
                },
                spotlight: '#at-import-canvas',
                handoff: `Click a few cells, then <strong>Cancel</strong>. The count on the Add button
                          tracks what you picked.`
            },
            {
                id: 'replace',
                title: 'Swapping one texture without losing what is attached to it',
                covers: ['action:replace'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>🖼 Replace Image…</strong> swaps the picture inside an existing tile and
                      keeps the tile. That matters because a tile is more than its pixels by this point:
                      it has a material, possibly a painted glow or height recipe, and possibly
                      transitions and border sets built from it.<br><br>
                      Replace the image and all of that stays pointed at the same tile, so the
                      transitions re-render from the new texture instead of breaking. Delete the tile
                      and add a new one instead, and everything built from it is orphaned.<br><br>
                      This is the right tool when an artist hands you version 2 of a texture, which is
                      most of the time.<br><br>
                      It opens your file browser, so the course stops at the menu entry rather than
                      putting a file dialog over the lesson.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0));
                    await api.cap('ctxOpenCat', 'file');
                    await api.wait(400);
                },
                spotlight: '#at-ctx button[data-action="replace"]',
                handoff: `<strong>↺ Reset to Original</strong> a few entries down is the related one: it
                          throws away your edits and puts the tile back to the pixels it arrived with.`
            },
            {
                id: 'projects',
                title: 'Not losing the work',
                covers: ['ui:projects', 'ui:session'],
                requires: { tiles: TRLE.DemoDepthSet },
                /* This step names a control that lives in the left rail, and the
                   course hides the rails everywhere else. Naming a button that
                   is not on screen is worse than not naming it. */
                rails: 'left',
                say: `A project is a <em>file</em>, <em>.atlasproj.json</em>, and
                      <strong>💾 Save Project</strong> writes it. It holds every tile, every material,
                      every recipe. <strong>📂 Load Project</strong> opens one, and it also accepts an
                      export ZIP that has one inside, so the ZIP the tool handed you is reopenable.<br><br>
                      The <strong>● unsaved changes</strong> dot appears when you have edits made
                      since you last saved a file. It is the honest signal: the tool autosaves, but autosave
                      is <em>crash recovery</em>, one slot, overwritten, not a project library. If the
                      tab dies you are offered it back when you return. That is all it promises, and the
                      filesystem is where your work actually lives.<br><br>
                      The <strong>Session</strong> panel on the left is showing for this step, which
                      is where the autosave reports itself. One button on it this course deliberately
                      never presses: <strong>🔒 Protect from cleanup</strong>. It asks the browser not
                      to evict the autosave, and in Firefox that raises a permission prompt, so it
                      belongs to you and not to a demo.<br><br>
                      That is the course. The <strong>📖 How to use the tool</strong> and
                      <strong>🎨 Materials</strong> buttons in the header are the reference versions of
                      everything here.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: '#at-save-project',
                handoff: `Press <strong>💾 Save Project</strong> and it asks for a name before it writes
                          anything, so you can look and cancel. Then go and build something.`
            }
        ]
    }

    ,{
        id: 'layers',
        icon: '\u{1F5C2}',
        title: 'Layers',
        blurb: 'Every edit stays editable: text, colour grades and effects you can reopen, hide and reorder.',
        steps: [
            {
                id: 'what-is-a-layer',
                title: 'An edit you can still change',
                covers: ['ui:layers-panel'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Tile 1 now has the word EXIT on it. In most tools that would be pixels and nothing
 more. Here it is a <em>layer</em>: the tool kept the words, the font and the size, so
 you can change them later.<br><br>
 The <strong>Layers</strong> panel in the left rail lists them for the selected tile.
 <strong>Text and drawings</strong> sit on top of the picture. <strong>Original</strong>
 at the bottom is the picture underneath everything.`,
                setup: async api => {
                    await layersEnsureText(api);
                    await api.cap('selectIds', [await api.tileId(0)]); await api.wait(300);
                },
                rails: 'left',
                spotlight: '#at-layers',
                handoff: `Click another tile and the panel follows it. Click back, and the layer is still there.`
            },
            {
                id: 'edit-a-layer',
                title: 'Change it later',
                covers: ['action:edittext', 'action:editdrawing'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Right-click the tile and choose <strong>Edit Text…</strong>, or click the layer's row in
 the panel. The text tool reopens with the words and settings exactly as you left them.
 <strong>Apply</strong> replaces that layer, and nothing else on the tile moves.<br><br>
 A drawing works the same way through <strong>Edit Drawing…</strong>. The menu shows
 whichever of the two the tile carries.`,
                setup: async api => {
                    await layersEnsureText(api);
                    await api.cap('selectIds', [await api.tileId(0)]);
                },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="edittext"]'); await api.wait(900);
                    await api.setValue('at-tx-text', 'WAY OUT'); await api.wait(600);
                },
                spotlight: '#at-tx-text',
                handoff: `Change the words and press <strong>Apply</strong>. Closing the window instead leaves the tile as it was.`
            },
            {
                id: 'hide-and-delete',
                title: 'Hide, show, delete',
                covers: ['ui:layers-eye'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `The 👁 on a row hides that layer, and the tile redraws as if it had never been added.
 Click it again and the layer comes back, with every setting intact.<br><br>
 The 🗑 that shows when you point at a row deletes the layer from this tile. Both
 are one <strong>Undo</strong>.`,
                setup: async api => {
                    await layersEnsureText(api);
                    await api.cap('selectIds', [await api.tileId(0)]); await api.wait(300);
                },
                act: async api => {
                    await api.click('#at-layers-body .at-ly-eye'); await api.wait(900);
                    await api.click('#at-layers-body .at-ly-eye'); await api.wait(900);
                },
                rails: 'left',
                spotlight: '#at-layers-body .at-ly-layer',
                handoff: `Hide the text yourself and look at the tile, then show it again.`
            },
            {
                id: 'picture-edits',
                title: 'Edits to the picture sit underneath',
                covers: ['ui:layers-zones'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `A colour grade belongs to the picture, so it runs <em>under</em> the lettering. Adjust
 Colours was just applied to this tile after the text, and the text kept its colour.<br><br>
 The panel groups layers by what they do, and the tool puts each one in its group:
 <strong>Picture edits</strong> (colour tools, Noise, Heal, Make Seamless, Slope Blur,
 Scatter, HD Look), <strong>Text and drawings</strong>, then <strong>Finish</strong> (Fade to
 Transparent, Classic Look), which goes over everything. Text and drawings drag above or
 below each other by their ⠿ grip. A picture edit or a Finish layer drags over or under
 the text and drawings (or click its ↑ or ↓), for the times you want a grade on the
 lettering too. HD Look is the exception: it always stays under the text.<br><br>
 Right-click a group, or click its ⋯, to move the whole group at once or to
 <strong>Flatten into the Original…</strong>, which bakes that group and everything under
 it into the picture. It asks first, and <strong>Undo</strong> brings the layers back.`,
                setup: async api => {
                    await layersEnsureGrade(api);
                    await api.cap('selectIds', [await api.tileId(0)]); await api.wait(300);
                },
                rails: 'left',
                spotlight: '#at-layers',
                handoff: `Hide <strong>Adjust Colours</strong> and watch the brick brighten while the text stays put.`
            },
            {
                id: 'effects-and-glow',
                title: 'Effects, and glowing in game',
                covers: ['ui:layer-effects'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Text and Draw both have a <strong>✨ Layer effects</strong> panel on the Style tab:
 drop and inner shadows, outer and inner glows, a stroke, a colour overlay. They are part
 of the layer, so editing the text later keeps them.<br><br>
 The two glows have <strong>Also glow in game</strong>. Ticked, the glow is also added to
 the tile's emissive map, but only where the glow is, so the rest of the map stays as it
 was. A glow on the picture alone never shines in the engine, and this makes it shine.
 Apply also ticks the <strong>Emissive</strong> export map, so the glow ships.`,
                setup: async api => {
                    await layersEnsureText(api);
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="edittext"]'); await api.wait(900);
                    await api.click('#at-modal-text [data-tx-tab="style"]'); await api.wait(400);
                    const d = api.doc();
                    const acc = d && d.getElementById('at-tx-fxacc');
                    if (acc && !acc.open) { await api.click('#at-tx-fxacc summary'); await api.wait(700); }
                    const on = d && d.getElementById('at-txfx-outerGlow-on');
                    if (on && !on.checked) { await api.click('#at-txfx-outerGlow-on'); await api.wait(500); }
                    const em = d && d.getElementById('at-txfx-outerGlow-emit');
                    if (em && !em.checked) { await api.click('#at-txfx-outerGlow-emit'); await api.wait(500); }
                    await api.reveal('#at-txfx-outerGlow-emit');
                },
                expectState: { 'at-txfx-outerGlow-on': true, 'at-txfx-outerGlow-emit': true },
                spotlight: '#at-txfx-outerGlow-emit',
                handoff: `Press <strong>Apply</strong>, then open <strong>Set Material</strong> on this tile: the glow is in
 the Emissive thumbnail.`
            },
            {
                id: 'moves-with-the-tile',
                title: 'Layers turn with the tile',
                covers: ['ui:layers-transform'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `Rotate, Flip, Offset and the free transforms move the whole stack. The text turns with
 the brick, and it stays editable: open <strong>Edit Text…</strong> afterwards and the
 words come up turned the same way.<br><br>
 Besides <strong>Flatten into the Original…</strong>, two things end a layer's editability.
 <strong>Reset to Original</strong> removes every layer on the tile. A Distort driven by
 another tile turns text and drawings into plain pixels.`,
                setup: async api => {
                    await layersEnsureText(api);
                    await api.cap('selectIds', [await api.tileId(0)]); await api.closeMenu();
                },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="rotate"]'); await api.wait(800);
                },
                spotlight: { grid: 0 },
                handoff: `Rotate it three more times to bring it back. The layer never moves out of the list.`
            },
            {
                id: 'layers-menu',
                title: 'Layers… when the rail is hidden',
                covers: ['modal:layers', 'action:layers'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `On a narrow window the side rails are hidden. Right-click a tile and choose
 <strong>🗂 Layers…</strong> for the same list in a window. Clicking a layer there opens its
 tool, the eye and the bin work the same way, and nothing differs from the rail.`,
                setup: async api => { await layersEnsureText(api); await api.closeMenu(); await api.cap('selectIds', [await api.tileId(0)]); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="layers"]'); await api.wait(700);
                },
                spotlight: '#at-layers-modal-body',
                handoff: `Close it with <strong>Close</strong>. Layers are saved with the project, so they are here when you load it again.`
            }
        ]
    }
];





/* ---- Coverage registry -------------------------------------------------
   `tools/validate-demo.mjs` enumerates every `#at-modal-*` id and every
   `[data-action]` in index.html and requires each to appear in exactly one of:
     (a) some lesson step's `covers`
     (b) DEMO_PLANNED — assigned to a lesson that is not built yet
     (c) DEMO_EXCLUSIONS — deliberately never demoed, with a reason

   (b) is what makes the check honest while the course is being written: it
   fails on anything NEW rather than on everything unbuilt, and the planned
   count visibly shrinks as lessons land. A new feature with no entry anywhere
   fails the suite, which is the enforcement the Learn pages never had. */
TRLE.DemoPlanned = {
    /* Materials is THREE lessons: what a material IS (concept), tuning the maps
       by hand (the advanced editor), then how to USE one (presets, tiers, batch,
       multi-material). Someone who does not know what a normal map is cannot
       choose between 51 presets across three tiers, and the modal does not teach
       that. The sliders come before the presets on purpose: a preset is one row
       of those values, so seeing them move is what turns that list from opaque
       names into starting points. See docs/demo/plan.md §7.

       Lessons 7 and 8 add no entry here: everything they teach lives inside
       `modal:mat`, and their two menu actions (`action:material`,
       `action:lastmaterial`) are now covered by lesson 8's steps.

       As of 2026-09-19 this table is EMPTY: every lesson is built and every
       modal and menu action is either taught or excluded. That is the state it
       should be kept in. A new feature goes here the moment it is written, named
       against the lesson that will teach it, and comes out when that step lands. */

    /* Animated textures were ONE step inside lesson 3 until 2026-09-22, written
       when the modal had one generator and three tabs. They are lesson 10 now
       (`id: 'animated'`), covering both generators, the Colour and Glow tabs,
       the Overlay tab with its moving level and organic contour, and the export
       consequence: the engine only swaps UVs, so a second variant of an
       animation costs a second full set of tiles.

       Worth keeping in mind for the NEXT feature that lands inside an existing
       modal. Everything phases 1 to 3 added lives inside `modal:anim`, so the
       coverage walk below was satisfied the whole time it was untaught — it
       enumerates `#at-modal-*` ids and `[data-action]`s, and a new control
       inside a modal it already knows about is invisible to it. That is the
       case this registry is weaker at than a missing modal, and the only
       instrument for it is writing the gap down here. */

    /* 🎇 Sprites (SPRITE-PLAN, 2026-09-28). Built in phases 2 to 6; the lesson
       that teaches it is SPRITE-PLAN phase 7, and this entry comes out then. */
    sprites: ['modal:sprite', 'action:addsprite'],

    /* 🕹️ Classic Look (CLASSIC-LOOK-PLAN, 2026-10-01): Edit > Classic Look…, an HD
       texture made to look low-res at the same tile size. Belongs with the colour
       lesson's in-place edits (Adjust Colours, Recolor); comes out when its step
       lands. */
    classic: ['modal:classic', 'action:classic'],
    /* 🔎 HD Look (HD-LOOK-PLAN, 2026-10-06): Edit > HD Look…, a low-res tile made to
       look HD at the same tile size. Phase 10 left it here. The author decided on
       2026-10-07 that it gets a step, placed right after Classic Look's; both come
       out of this table when those steps land. */
    hdlook: ['modal:hdlook', 'action:hdlook', 'modal:importadvice'],
    /* ⤡ Free Transform (TRANSFORMS-PLAN, 2026-10-02): Transform > Free Transform…,
       any-angle rotate, scale, skew and move. Belongs with the transforms in the
       first lesson that turns a tile; comes out when its step lands. */
    xform: ['modal:xform', 'action:xform'],
    /* ⬚ Perspective (TRANSFORMS-PLAN, 2026-10-02): straighten a photographed
       wall or distort a tile's corners. Same lesson as Free Transform. */
    persp: ['modal:persp', 'action:persp'],
    /* 〰️ Distort (TRANSFORMS-PLAN, 2026-10-02): Wave, Ripple, Displace by a
       tile. Same lesson as Free Transform. */
    distort: ['modal:distort', 'action:distort'],
    /* 🔤 Text (TEXT-PLAN, 2026-10-02): lettering below Draw…, spanning a selection
       like Draw. Belongs with Draw's lesson; comes out when its step lands. */
    text: ['modal:text', 'action:text'],

    /* 💧 Slope Blur (WEATHERING-PLAN, 2026-10-02): Edit > Slope Blur…, wear and
       erosion along a slope. Belongs with the in-place edits; comes out when its
       step lands. */
    slope: ['modal:slope', 'action:slope'],
    /* 🍂 Scatter (WEATHERING-PLAN, 2026-10-02): Edit > Scatter…, soft patches of a
       tile stamped over another. Same lesson as Slope Blur. */
    scatter: ['modal:scatter', 'action:scatter'],

    /* 📚 Stickers (STICKERS-PLAN, 2026-10-08): the Sticker Gallery in the new Overlay
       category (phase 3); Add Stickers and Make Sticker join it in phases 4 and 9.
       Belongs with Overlay Texture's step; comes out when its step lands (phase 10). */

    /* NOT VISIBLE TO THE COVERAGE WALK (new controls inside a known modal, see
       above): the Material modal's Relief detail bands (HEIGHT-BANDS-PLAN) and
       Cavity and edges sliders (CAVITY-PLAN), both 2026-10-01. The tuning lesson
       (advanced editor) does not teach them yet. Written down here so the gap is
       not invisible; no registry key is needed for them. */

};

TRLE.DemoExclusions = {
    'action:editanim':   'Reached from an animation frame, which only exists after the anim lesson builds one; the anim lesson covers editing in place.',
    'action:delete':     'One click and a confirm. Lesson 1 teaches the menu; a step that deletes the sample is worse than a sentence.',
    'modal:folderpick':  'Native folder picker and a chooser behind it: neither can run inside the course frame, and the course never writes to a folder.',
    'modal:confirm':     'Infrastructure. It is the dialog other features ask questions with, not a feature.'
};
