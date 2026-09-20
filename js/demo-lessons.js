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
    { src: 'Examples/ExampleAtlas.png', cell: [2, 3], cellSize: 256 }, // 5 - roman artwork, for Origami
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
    { src: 'Examples/ExampleAtlas.png', cell: [2, 0], cellSize: 256 }  // 5 - stone floor, deep joints
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

/* Lesson 9's bench. Four textures, one job each: brick with deep joints is the
   only one on the atlas with relief worth marching into, the skylight's white
   panes are the easy brightness case for emissive, the foliage is what Fade to
   Transparent is actually FOR (a mural is a rectangle you want to keep whole; a
   leaf cluster is the thing whose edges have to stop existing), and the grate has
   REAL alpha so the maps have holes to flatten inside.

   Lesson 10 declares the same set, so the last two lessons cost no reload
   between them, and the grate is exactly the transparent tile lesson 10's
   alpha warning needs in order to fire. */
TRLE.DemoDepthSet = [
    { src: 'Examples/ExampleAtlas.png', cell: [1, 0], cellSize: 256 }, // 1 - brick, deep joints
    { src: 'Examples/ExampleAtlas.png', cell: [1, 3], cellSize: 256 }, // 2 - skylight, white panes
    'Examples/tile_249.png',                                           // 3 - foliage, to fade out
    'Examples/MetalGrate.png'                                          // 4 - real alpha
];

/* First element carrying an overlay recipe, or -1. Built out of `inspect` rather
   than a new capture hook, because `inspect` already reports ovParams and the
   only caller needs it once. */
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

TRLE.DemoLessons = [
    {
        id: 'start-grid',
        icon: '🏁',
        title: 'Start & the grid',
        blurb: 'Load a sheet, cut it into tiles, and learn to move around the grid.',
        steps: [
            {
                id: 'what-is-an-atlas',
                title: 'Everything starts with an atlas',
                covers: ['ui:start-screen', 'ui:tile-size'],
                requires: 'pristine',
                say: `An <em>atlas</em> is one image holding a grid of tiles. Tomb Editor wants your
 textures packed this way in a grid, so the whole tool is built around it.<br><br>
 The start screen has three ways in: bring your own sheet, generate a blank
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
                covers: ['ui:context-menu', 'action:download'],
                say: `<strong>Right-click</strong> any tile for everything you can do to it. The menu
 is grouped into columns, <strong>Transitions</strong>, <strong>Generate</strong>,
 <strong>Transform</strong>, <strong>Adjust</strong>, <strong>Material</strong>,
 <strong>File</strong>, so nothing is buried in a scrolling list.<br><br>
 Groups that don't apply are hidden, so an animation frame or a transition tile
 shows fewer columns than a plain tile.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); },
                act: async api => { await api.cap('openCtx', await api.tileId(1)); await api.wait(250); },
                spotlight: '#at-ctx',
                handoff: `Right-click a different tile and read down the columns. <strong>Esc</strong> closes it.`
            },
            {
                id: 'select-batch',
                title: 'Work on many tiles at once',
                covers: ['ui:selection', 'ui:bulk-bar'],
                say: `Tiles select like icons on a desktop. <strong>Click</strong> one,
 <strong>Ctrl/Cmd+click</strong> to add or remove, <strong>Shift+click</strong>
 for a range, or <strong>drag a box</strong> across the grid background.
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
                id: 'layout-blocks',
                title: 'Columns, rows and blocks',
                covers: ['ui:layout', 'ui:blocks', 'ui:preview-atlas'],
                say: `<strong>Columns</strong> and <strong>Rows</strong> reflow the whole atlas. Tiles
 added by a set builder are outlined in orange: they form a <em>block</em> that
 only reads correctly at its own width, and changing the columns keeps each
 block's shape, padding its rows with black spacer tiles.<br><br>
 <strong>👁️ Preview atlas</strong> stitches everything into one image exactly as
 it exports, same order, same columns, same pixels.`,
                requires: 'sliced',
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                spotlight: '.at-layout-row',
                sweep: { id: 'at-cols-input', from: 4, to: 6, ms: 1400 },
                handoff: `Put <strong>Columns</strong> back to 4, or leave it, nothing here is precious.`
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
 <strong>Blend Radius</strong> is how far in from each edge it works, wide enough
 to hide the join, narrow enough to keep the texture.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="seamless"]'); await api.wait(900);
                },
                spotlight: '#at-sm-method',
                sweep: { id: 'at-sm-falloff', from: 10, to: 45, ms: 1600 },
                preview: '#at-sm-preview',
                handoff: `Try <strong>Multi-band edge blend</strong> in the method list and watch the
 preview. <strong>Save</strong> writes it back; closing throws it away.`
            },
            {
                id: 'paint-tools',
                title: 'The paint tools, once',
                covers: ['ui:mask-editor'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Eight places in the app let you paint a region, and they all use this same
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
 The method matters here. <strong>Smooth (diffusion, flat fill)</strong> spreads surrounding
 colour inward, fine on a flat surface, but on this it leaves a grey smear.
 <strong>Neighbour-aware</strong> samples the area around the spot, so it matches
 the local tone rather than the tile average, which is what a dark hole on a light
 mural needs. <strong>Texture</strong> samples the whole tile, good for repeating
 detail.`,
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
 <strong>Temperature</strong> is the one worth knowing. Photo textures carry the
 colour of the light they were shot in, and nudging it warm or cool is what makes
 a wall from one photo sit beside a floor from another.<br><br>
 If you are not sure how a texture should look, pull it toward grey here and let the
 light bulbs in Tomb Editor put the colour back. Neutral pixels take whatever light you
 give them, a strongly tinted texture fights it.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(5)); await api.wait(220);
                    await api.click('#at-ctx button[data-action="coloradj"]'); await api.wait(800);
                },
                spotlight: '#at-ca-sliders',
                sweep: { id: 'at-ca-temp', from: 0, to: -70, ms: 1500 },
                preview: '#at-ca-preview',
                handoff: `Drag any of them. <strong>Reset</strong> puts them all back to neutral.`
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
                id: 'reset',
                title: 'Undo all of it',
                covers: ['action:reset'],
                requires: { tiles: TRLE.DemoCleanupSet },
                say: `Every tile keeps its untouched original, however many edits you stack on it.
 <strong>Reset to Original</strong> in the <strong>File</strong> column throws the
 lot away and hands back the texture you started with, and it works on a whole
 selection at once.<br><br>
 That is the safety net under this entire lesson: nothing you did to these six is
 permanent, and neither is anything you do to your own.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(280);
                },
                spotlight: '#at-ctx .at-ctx-col[data-col="file"]',
                handoff: `<strong>Reset to Original</strong> is the second-to-last entry. Try it on
 texture 1, then pick another lesson above.`
            }
        ]
    },

    {
        id: 'generate',
        icon: '\u{1F3D7}\u{FE0F}',
        title: 'Make a new texture',
        blurb: 'Bring one texture, leave with many: walls, floors, variants, frames, glass and animation.',
        steps: [
            {
                id: 'the-generators',
                title: 'One texture in, a set out',
                covers: ['ui:generate-column'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `The <strong>Generate</strong> column builds new textures out of the ones you
                      already have. A single brick photo becomes a whole wall, a wall becomes six
                      walls that do not repeat, a flat panel becomes a carved frame.<br><br>
                      This is the column to reach for when you need a lot of texture and you have
                      one good one. These six are the sources for the rest of the lesson.`,
                setup: async api => { await api.closeMenu(); await api.cap('selectIdx', []); },
                act: async api => {
                    await api.cap('openCtx', await api.tileId(0)); await api.wait(280);
                },
                spotlight: '#at-ctx .at-ctx-col[data-col="generate"]',
                handoff: `Read down the column. Everything in it makes a <em>new</em> tile and leaves
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
                      <strong>Generate Variations</strong> makes several tiles that are recognisably the
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
                          Set a <strong>Count</strong> and click <strong>Generate</strong> to add them.`
            },
            {
                id: 'origami',
                title: 'Origami Frame: fold a texture into rings',
                covers: ['action:origami', 'modal:origami'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `<strong>Origami Frame</strong> mirrors a texture in on itself to build nested
                      rings, which is how you get a carved panel or a framed inset out of a flat one.<br><br>
                      <strong>Ring shape</strong> picks square, diamond or circle. <strong>Detail
                      axis</strong> tells it which way the source's ridges run, and Auto usually gets
                      it right. <strong>Repeats</strong> folds the source into more rings.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(4)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="origami"]'); await api.wait(900);
                },
                spotlight: '#at-origami-shape',
                sweep: { id: 'at-origami-repeats', from: 1, to: 4, ms: 1400 },
                preview: '#at-origami-preview',
                handoff: `Switch <strong>Ring shape</strong> to Circle and watch it become a medallion.`
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
                id: 'animated',
                title: 'Animated textures',
                covers: ['ui:add-anim', 'modal:anim'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `Water, lava, clouds, smoke, portals. Generated as a looping sequence of frames
                      that each tile on their own, so you can drop them into an animated range in
                      Tomb Editor.<br><br>
                      Start from a preset and tune from there. <strong>Pattern scale</strong> is the
                      one to respect: the tool tells you how many pixels each feature gets, and below
                      about six the animation turns to confetti at small tile sizes. At 32px the
                      useful ceiling is around scale 4.`,
                setup: async api => {
                    await api.closeMenu(); await api.cap('closeModal');
                    await api.click('#at-add-anim'); await api.wait(1600);
                },
                spotlight: '#at-anim-preset',
                sweep: { id: 'at-anim-scale', from: 3, to: 9, ms: 1800 },
                preview: '#at-anim-tiled',
                handoff: `Change <strong>Preset</strong> and watch the live preview. The second canvas
                          is a 2×2 tiling, which is where you check the seam. <strong>✨ Crisp</strong>
                          renders larger and averages down, worth it at small tile sizes.`
            },
            {
                id: 'what-you-get',
                title: 'Three kinds of output',
                covers: ['action:editstainedglass'],
                requires: { tiles: TRLE.DemoGenerateSet },
                say: `Generators do not all leave the same thing behind, and it matters when you want
                      to change your mind.<br><br>
                      <strong>Build Pattern</strong> and <strong>Origami Frame</strong> bake pixels. The
                      result is an ordinary tile with no memory of how it was made, so to change it you
                      build it again.<br><br>
                      <strong>Stained Glass</strong> keeps its recipe. Right-click the tile it made and
                      <strong>🪟 Edit Stained Glass</strong> reopens every slider where you left it.<br><br>
                      <em>Animated textures</em> arrive as a group of frames that stay linked,
                      so you can reopen the group and regenerate all of them at once.`,
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
                          columns, and a <strong>Go to</strong> group that plain tiles do not have.`
            },
            {
                id: 'overlay',
                title: 'Overlay Texture: stacking, not blending',
                covers: ['action:overlay', 'modal:overlay'],
                requires: { tiles: TRLE.DemoBlendSet },
                say: `Every tool so far in this lesson blends two terrains <em>into</em> each other.
                      <strong>🖼 Overlay Texture</strong> does the other thing: it lays one texture on
                      top of another and leaves the base alone underneath. It is in the same
                      <strong>Transitions</strong> column for that reason, and it is the one you want
                      for grime, decals, posters and moss rather than for a shoreline.<br><br>
                      Right-click the base, then click the texture to put over it. Here that is tile
                      2's sand over tile 3's brick.<br><br>
                      The interesting control is <strong>Read colours from</strong>, because it is two
                      genuinely different jobs. Reading from <em>the overlay</em> keys a decal off its
                      own background, which is how you drop a painted sign onto a wall. Reading from
                      <em>the base</em> puts the overlay only where the wall matches, which is grime in
                      the mortar and moss on the dark stones. This step reads from the base, inverted,
                      so the sand collects in the joints.<br><br>
                      Watch the threshold sweep: the grime creeps out of the joints and onto the brick
                      faces. Stop before it does.<br><br>
                      <strong>Blend</strong> is separate from coverage. <strong>Multiply</strong> for
                      dirt and stains, <strong>Screen</strong> for dust and light leaks. The generated
                      maps follow the <em>coverage</em> and ignore the blend, which is correct: a
                      multiply changes how a surface looks, not what it is made of.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openOverlay', await api.tileId(2), await api.tileId(1));
                    await api.wait(1500);
                    await api.setValue('at-ov-mode', 'bright', 'change'); await api.wait(700);
                    await api.setValue('at-ov-sample', 'base', 'change'); await api.wait(500);
                    const d = api.doc();
                    const inv = d && d.getElementById('at-ov-selinvert');
                    if (inv && !inv.checked) { await api.click('#at-ov-selinvert'); await api.wait(500); }
                    await api.setValue('at-ov-blend', 'multiply', 'change'); await api.wait(700);
                },
                spotlight: '#at-ov-preview',
                sweep: { id: 'at-ov-threshold', from: 20, to: 75, ms: 2800 },
                preview: '#at-ov-preview',
                handoff: `Switch <strong>Read colours from</strong> back to the overlay and watch the
                          result stop making sense. That one dropdown is most of this tool.`
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
                      generated tile <em>inherits</em> the material from its sources rather than carrying
                      its own, so material the brick and the sand first and the overlay arrives already
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
                        await api.cap('openOverlay', await api.tileId(2), await api.tileId(1));
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
                },
                spotlight: '#at-ctx .at-ctx-col[data-col="transitions"]',
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
                      <strong>Generate</strong> rather than <strong>Transitions</strong>. It takes a fill
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
                      It keeps its recipe, so <strong>🏔️ Edit Height Transition</strong> reopens every
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
                title: 'Height and emissive are materials too',
                covers: ['ui:map-height-emissive'],
                requires: { tiles: TRLE.DemoMaterialSet },
                say: `Two more maps ride in the same set, and the course teaches them separately for a
                      reason worth knowing.<br><br>
                      <strong>Height</strong> is real depth: the engine walks into the surface so a
                      recess is genuinely behind the wall, not shaded to look like it.
                      <strong>Emissive</strong> is light the surface makes itself, so it glows in a dark
                      room.<br><br>
                      They are material maps like every other one here. Same pipeline, same export, and a
                      preset sets their strengths along with the rest. The tool gives each of them its own
                      editor because you paint or pick something for one specific texture, and because you
                      very often want <em>only</em> one: a glowing sign needs no roughness work, and a
                      parallax wall needs no emissive.<br><br>
                      <strong>Transparency is not on this list, and it is not a map.</strong> It lives in
                      your texture's own alpha, and there is nothing extra to author or export for it.
                      What a cutout <em>does</em> change is how these maps behave inside the hole, which
                      is taught next to the tool that makes holes.<br><br>
                      Both maps, and cutouts, are lesson 9.<br><br>
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
                handoff: `The <strong>Height</strong> thumbnail is in that row already, generated from the
                          preset, even though nobody has opened the height editor.`
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
                say: `A preset is not a mode. It is one row of numbers, and this panel is the row.
                      Open <strong>⚙️ Advanced editor</strong> and the modal widens, the sliders dock
                      into their own column beside the preview, and every value you can see came from
                      the preset you picked.<br><br>
                      Move any one of them and the material becomes <em>custom</em>: still yours, still
                      assignable, just no longer the preset. Nothing is committed until
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
                say: `<strong>Normal Strength</strong> does not invent depth, it decides how strongly
                      the light and dark already in the texture get turned into slopes. Brick ships at
                      <strong>32</strong> with <strong>Normal Blur</strong> at 2, because mortar joints
                      are real relief and there is plenty there to read.<br><br>
                      Watch the top of the sweep. Past about 40 the surface stops reading as brick and
                      starts reading as crinkled foil: every scratch in the clay is now a ridge, and
                      the joints have stopped being the deepest thing in the tile.<br><br>
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
                say: `Sand has no joints. What it has is fine grain, and <strong>Normal Strength</strong>
                      reads that grain as thousands of tiny slopes. Push it and the tile glitters, and
                      in game it shimmers as the light or the camera moves, because every grain is now
                      catching a highlight like a pebble. Sand ships at <strong>14</strong>.<br><br>
                      The fix is not always less strength. <strong>Normal Blur</strong> smooths the
                      texture <em>before</em> the slopes are read, so it takes out the grain and leaves
                      the broader shape. Watch the second sweep: same strength, sparkle gone. Sand ships
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
                      <strong>Normal Angularity</strong> and <strong>Normal Tilt</strong> sharpen slopes
                      into facets instead of soft rounded bumps, which is what cut stone and brick want
                      and what sand and cloth do not. They are a pair in the strict sense:
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
                      gets a thin dark line drawn on it instead of a shadow sitting in it. Too large and
                      the shadow climbs out of the joint and washes across the brick faces, which reads
                      as a dirty wall rather than a deep one.<br><br>
                      Match it to the feature, not to how dark you want it. Darkness is the next slider.<br><br>
                      Watch the <strong>Ao</strong> thumbnail rather than the lit preview, which is what
                      the ring is on. AO is a quiet map in a lit view: this sweep moves the preview by
                      about 2 levels out of 255 and the AO map itself by about 37. The map is the honest
                      instrument here.`,
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
                      which way to reach. If a texture looks grimy, it is nearly always AO too strong
                      rather than the normal map too strong, so back off Intensity first.<br><br>
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
                          while the shape stays. Those two sliders are not two strengths.`
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
                      on it changes it by 47. That is not a preview quirk, it is how the engine behaves,
                      and it is why a specular map can look broken until something lines up.<br><br>
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
                      from the texture rather than from a stylistic cut.<br><br>
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
                      material your <strong>specular map is the reflection amount</strong>. Not the
                      highlight, the actual blend between your texture and the environment. Still
                      Water's 169 is about two thirds reflection. Tomb Editor invents a flat 128 when
                      you give a reflective material no specular map at all, so 128 is roughly the
                      middle of the road and anything above it is a deliberate mirror.<br><br>
                      Two things people get wrong here. <strong>Roughness does not blur that
                      reflection</strong>, it only shapes the highlight, so a rough water surface still
                      mirrors sharply. And on a room surface the normal map only bends the reflection by
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
                      Dramatic moves the AO map by 59 levels out of 255 and the lit preview by 4.<br><br>
                      It also only does anything to materials that have relief to push.
                      <strong>Chrome</strong> between Realistic and Dramatic moves the AO map by 1 and
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
                      into a layer list: the <strong>Base</strong> covers the whole tile, and each layer
                      above it paints its own material over a region you select. Order matters, bottom
                      to top, exactly like layers anywhere else.<br><br>
                      The selection tools are the same ones lesson 2 used for Heal and De-light, so the
                      <strong>Wand</strong> is usually the quickest start here: the frame is a different
                      colour from the door, so one click takes most of it.<br><br>
                      The maps are composited per layer at generation time, so what exports is one
                      normal map and one roughness map for the tile, with both materials in them.`,
                setup: async api => {
                    await matOpen(api, 4, 'metal');
                    await api.wait(200);
                    const d = api.doc();
                    const box = d && d.getElementById('at-mm-enable');
                    if (box && !box.checked) { await api.click('#at-mm-enable'); await api.wait(1200); }
                },
                spotlight: '#at-mat-multi',
                handoff: `Press <strong>＋ Add layer</strong>, give it a different material, then wand
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
                      <strong>Transparency is the odd one out and it is not a map.</strong> It is your
                      texture's own alpha, nothing is generated for it and nothing extra is exported.
                      It is in this lesson because the tool that authors it,
                      <strong>🫥 Fade to Transparent</strong>, lives here, and because a cutout changes
                      what the other maps do inside the hole.<br><br>
                      Four textures on the bench: brick with deep joints for depth, a skylight with
                      bright panes to light up, foliage to fade out, and a grate with real holes in it.`,
                setup: async api => { await api.closeMenu(); },
                spotlight: { grid: 0 },
                handoff: `Right-click any of them. <strong>🏔️ Make Height Map</strong> and
                          <strong>✨ Make Emissive</strong> are in the <strong>Material</strong> column,
                          <strong>🫥 Fade to Transparent</strong> is in <strong>Adjust</strong> with the
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
                      That last part is not a limitation of the preview, it is what the engine does. The
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
                say: `<strong>🫥 Fade to Transparent</strong> takes alpha out of a texture rather than
                      colour. It is how you make a decal that sits on a wall without a visible rectangle
                      around it: grime, dust, a poster, a scorch mark, a patch of damp.<br><br>
                      Three shapes. <strong>Edges (vignette)</strong> fades all four sides inward, which
                      is the decal case and the one sweeping here. <strong>Direction / slope</strong>
                      fades along one axis, for something that trails off downward like a water stain.
                      <strong>Custom (paint)</strong> hands you the brush.<br><br>
                      <strong>Fade amount</strong> and <strong>Shape edge hardness</strong> are easy to
                      confuse. Amount is how far in from the edge the fade reaches; hardness is how
                      abruptly it happens, 0 being a wide soft gradient and high being close to a cut.
                      Hard at a large amount is just a shrunken rectangle, which is rarely what you
                      wanted. (The brush toolbar in <strong>Custom (paint)</strong> has its own
                      <strong>Edge softness</strong>; that one feathers the stroke, not the shape.)<br><br>
                      <strong>🌿 Organic edge</strong> breaks the outline up with the same styles the
                      transition tools use: blobs, spikes, drips, clumps, fray. A mathematically
                      straight vignette is what gives a foliage decal away, and this is the fix.<br><br>
                      This changes the texture's own alpha, so everything downstream follows: the maps
                      flatten inside it, which is the next step.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.cap('openCtx', await api.tileId(2)); await api.wait(240);
                    await api.click('#at-ctx button[data-action="fade"]'); await api.wait(1400);
                },
                spotlight: '#at-fade-preview',
                sweep: { id: 'at-fade-amount', from: 5, to: 70, ms: 2600 },
                preview: '#at-fade-preview',
                handoff: `Try <strong>Direction / slope</strong> on the same leaves, then open
                          <strong>🌿 Organic edge</strong> and push <strong>Amount</strong> up. A
                          straight vignette on foliage is the giveaway; a ragged one is not.`
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
                      thumbnails: every map is fully opaque, and the areas under the holes are flat mid
                      grey rather than dark.<br><br>
                      Both halves of that are deliberate. A map is <em>data</em>, not a picture, so a
                      hole in it would mean nothing to the engine. And a transparent pixel arrives as
                      pure black, which is the deepest value there is, so left alone every hole would
                      become the deepest pit in the height map and every cutout edge a cliff. The tool
                      detects alpha and flattens those regions to neutral. There is nothing to switch
                      on.<br><br>
                      <strong>Alpha or magenta is your choice, and Tomb Editor takes both.</strong>
                      Magenta is the older convention because the classic level formats had no alpha
                      channel, only one reserved palette slot meaning "invisible", so the texture had to
                      name a colour. Tomb Editor still converts it, and <strong>Magenta to alpha</strong>
                      in Level Settings is on by default for every texture you add. Which means magenta
                      needs no setup, and also that a pure magenta pixel you actually wanted will be
                      punched out. The match is exact, so a resaved magenta will not key. Export from
                      here as PNG or TGA with alpha, or tick the magenta key on the export card.<br><br>
                      One real warning, and the export card repeats it: <em>be careful pairing Height
                      with a cutout</em>. Parallax shifts the texture coordinate, and near a hole that
                      drags pixels across the alpha boundary, so you get a milky fringe or a view
                      straight through to the skybox. Normal and AO are safe. If a fence looks wrong in
                      game, drop Height first and keep the rest.`,
                setup: async api => {
                    await matOpen(api, 3, 'metal');
                },
                spotlight: '#at-mat-previews [data-map="height"]',
                handoff: `Compare the Height thumbnail against the tile: the bars carry relief and the
                          gaps are flat. Now look at Normal, which does the same thing.`
            },
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
                      grate. Their holes are kept flat in the height map, but parallax on an
                      alpha-tested texture is still fragile, because the coordinate offset drags pixels
                      across the cutout edge. Check fences and foliage in game, and drop height for
                      those.<br><br>
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
                      it. PSD writes one layered file per tile, with the maps as named layers, for
                      editing elsewhere and bringing back.<br><br>
                      <strong>Export layout.</strong> Flat ZIP puts everything in one folder.
                      <strong>TombEngine</strong> arranges it into a <em>Textures/</em> folder so it
                      drops into a level project without rearranging.<br><br>
                      <strong>Magenta color-key</strong> flattens transparent pixels to magenta, which
                      is Tomb Editor's invisible colour. Tick it if you are working the classic way with
                      a colour key rather than real alpha. Leave it off if your pipeline handles alpha,
                      because it is destructive to the exported image.<br><br>
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
                covers: ['modal:atlaspreview'],
                requires: { tiles: TRLE.DemoDepthSet },
                say: `<strong>👁️ Preview atlas</strong> stitches the whole thing exactly as it will
                      export: same tile order, same column count, same pixel size. It is the last chance
                      to notice that two tiles are in the wrong order or that a transition set got split
                      across a row.<br><br>
                      <strong>Tile boundaries</strong> and <strong>Tile numbers</strong> are drawn on
                      top and are not in the export. <strong>Magenta key</strong> previews what that
                      checkbox does to your transparent areas, which is easier to judge here than after
                      the fact.<br><br>
                      Transparency shows as a checkerboard. If you see checkerboard where you expected
                      solid pixels, that is a tile with alpha you did not know about, and it is worth
                      finding out before the atlas is in a level.`,
                setup: async api => {
                    await api.closeMenu();
                    await api.click('#at-preview-atlas');
                    await api.wait(1200);
                },
                spotlight: '#at-ap-canvas',
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
                setup: async api => { await api.closeMenu(); },
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
                      The <strong>● unsaved changes</strong> dot appears when you have edits that are
                      not in a saved file yet. It is the honest signal: the tool autosaves, but autosave
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

       As of 2026-09-19 this table is EMPTY: all ten lessons are built and every
       modal and menu action is either taught or excluded. That is the state it
       should be kept in. A new feature goes here the moment it is written, named
       against the lesson that will teach it, and comes out when that step lands. */
};

TRLE.DemoExclusions = {
    'action:editanim':   'Reached from an animation frame, which only exists after the anim lesson builds one; the anim lesson covers editing in place.',
    'action:delete':     'One click and a confirm. Lesson 1 teaches the menu; a step that deletes the sample is worse than a sentence.',
    'modal:confirm':     'Infrastructure. It is the dialog other features ask questions with, not a feature.'
};
