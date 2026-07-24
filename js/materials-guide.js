/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (C) 2026 KainM-77. This file is the author's own work,
   available under the MIT License (see LICENSE-MIT). The tool as a whole ships
   under GPL-3.0 (see LICENSE) only because it also bundles two GPL-3.0 seamless
   shaders derived from Materialize; this file contains none of that code. */
/* ============================================================
   TRLE Atlas Tool — "Learn about materials" page
   A static, vertical-scroll reference that explains what PBR
   material maps are, how the tool derives each one from a plain
   diffuse texture, and how to tune them per material type.
   Reuses the tutorial page's TOC/main layout + .tut-* CSS.

   One interactive "material tuner" widget runs the real WebGL
   engine (loaded in materials.html): pick a texture + preset,
   drag the key sliders, watch every map regenerate live, with a
   2D lit preview and a lazy Babylon 3D displaced preview.
   Degrades to a note if WebGL 2.0 / images are unavailable.

   Emphasis convention (matches the tutorial): <strong> = a literal
   UI control / slider / preset name; <em> = conceptual emphasis.
   ============================================================ */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    /* Inherit the tool's saved theme + UI scale so the page matches. */
    (function applyPrefs() {
        let p = {};
        try { p = JSON.parse(localStorage.getItem('trle-atlas-prefs')) || {}; } catch { /* ignore */ }
        document.documentElement.dataset.theme = p.theme === 'light' ? 'light' : 'dark';
        if (typeof p.uiScale === 'number') {
            document.documentElement.style.fontSize = Math.max(11, Math.min(20, p.uiScale)) + 'px';
        }
    })();

    /* ---- Live tuner config ---- */
    // [key, label, src, defaultPresetKey, kind]
    const TEXTURES = [
        ['bricks', '🧱 Bricks',      'Examples/Bricks.png',     'brick',             'solid'],
        ['stone',  '🪨 Stone tiles', 'Examples/Stonetiles.png', 'floor_stone_rough', 'solid'],
        ['grass',  '🌿 Grass',       'Examples/Grass.png',      'grass',             'solid'],
        ['sand',   '🏖️ Sand',        'Examples/Sand.png',       'sand',              'solid'],
        ['water',  '💧 Water',       'Examples/Water.png',      'still_water',       'liquid']
    ];
    // [key, label, min, max, step] — the knobs that most illustrate each map.
    const TUNER_SLIDERS = [
        ['normalStrength', 'Normal Strength', 1, 50, 1],
        ['normalBlur',     'Normal Blur',     0, 10, 1],
        ['aoIntensity',    'AO Intensity',    1, 30, 1],
        ['aoRadius',       'AO Radius',       1, 30, 1],
        ['roughnessBase',  'Roughness Base',  0, 255, 1],
        ['specularBase',   'Specular Base',   0, 255, 1],
        ['heightStrength', 'Height Strength', 1, 50, 1]
    ];
    const MAP_LABELS = { normal: 'Normal', ao: 'AO', specular: 'Specular', roughness: 'Roughness', height: 'Height', emissive: 'Emissive' };

    /* ---- Archetype recipe table (numbers pulled live from the presets) ---- */
    // [presetKey, kind, note]. `head:true` rows are group sub-headers.
    const RECIPES = [
        { head: 'Core builder set' },
        ['brick', 'solid', 'Deep mortar joints, strong normal and height, matte.'],
        ['stone', 'solid', 'Rugged wall stone with heavy AO in the cracks.'],
        ['floor_stone_rough', 'solid', 'Floor version, lighter AO so joints don’t go black underfoot.'],
        ['wood', 'solid', 'High roughness contrast pulls out the grain.'],
        ['sand', 'solid', 'Gentle relief (high blur), no shine.'],
        ['concrete', 'solid', 'Eroded, cracked, dead matte.'],
        { head: 'Organic & transparent' },
        ['grass', 'solid', 'Deep AO between the blades.'],
        ['leaves', 'decal', 'Decal: flat at the transparent edges, waxy sheen.'],
        ['foliage', 'decal', 'Decal: strands fading out to transparent.'],
        ['moss', 'decal', 'Decal: soft, fuzzy, very matte.'],
        ['cobweb', 'decal', 'Decal: barely any depth, fades into corners.'],
        { head: 'Metals & polished' },
        ['iron', 'solid', 'Hammered, strong specular, mid roughness.'],
        ['steel', 'solid', 'Near-mirror specular, low roughness.'],
        ['chrome', 'solid', 'Mirror finish, almost no relief, roughness near 0.'],
        ['gold', 'solid', 'Warm high specular, low roughness.'],
        ['marble', 'solid', 'Polished: low roughness, strong specular.'],
        ['tile', 'solid', 'Glazed faces with deep grout shadow.'],
        ['glass', 'solid', 'Flat, mirror-smooth, max specular.'],
        { head: 'Liquids & emissive' },
        ['still_water', 'liquid', 'Mirror surface with tiny ripples.'],
        ['running_water', 'liquid', 'Directional flow normals.'],
        ['lava', 'liquid', 'Emissive on, hot cracks glow.'],
        ['slime', 'liquid', 'Glossy, faint bioluminescent glow.']
    ];

    /* ============================================================
       Content — the map-by-map guide.
       Each section: what (intro), derive (how the tool makes it),
       sliders [name, effect], tuning [material, advice], tip.
       Flags: tuner / keys / recipes insert live components.
       ============================================================ */
    const SECTIONS = [
        {
            id: 'intro', icon: '🎨', title: 'What are materials?',
            what: `A <em>material</em> is a set of extra maps that tell Tomb Engine how light hits a surface: where it bumps, where crevices sit in shadow, where it’s shiny, where it’s rough. That’s <strong>PBR</strong> (physically-based rendering). With them, a texture reacts to the level’s dynamic lights instead of staying flat.`,
            derive: `You only ever paint <em>one</em> image, the <strong>diffuse</strong> (the texture itself). Atlas Tool reads the brightness of that texture as a rough “height”, and from that one signal plus your chosen <strong>preset</strong> it works out the rest: a <strong>Normal</strong> map, an <strong>Ambient-Occlusion</strong> map, a <strong>Height</strong> map, a <strong>Specular</strong> and a <strong>Roughness</strong> map, plus an optional <strong>Emissive</strong> glow. A preset is really just a bundle of slider values someone already tuned for a material, and the <strong>Advanced editor</strong> lets you push any slider yourself.`,
            keys: true,
            tip: `Every map atlas has to share the same tile size and layout as the diffuse. Atlas Tool takes care of that for you when you export the maps together. If you export them in mismatched separate passes, Tomb Engine will throw an error and refuse to load them.`
        },
        {
            id: 'tuner', icon: '🧪', title: 'Try it: the live material tuner',
            what: `Here’s a real, working copy of the map generator right on the page. Pick a <strong>texture</strong> and a <strong>preset</strong>, drag the sliders, and watch every map (plus the lit 2D and 3D previews) update as you go. Everything the rest of this page talks about, you can feel here first. It’s the same engine that runs in the tool’s <strong>Set Material</strong> dialog.`,
            tuner: true,
            tip: `Nothing here gets saved, it’s just a sandbox. Have a play, then read on to understand <em>why</em> each slider does what it does.`
        },
        {
            id: 'diffuse', icon: '🖼️', title: 'Diffuse / Albedo (the colour you already know)',
            what: `The <strong>diffuse</strong> map (also called the <strong>albedo</strong>, the <strong>base colour</strong>, or just “the texture”) is the plain image you already drag into Tomb Editor. Bricks look like bricks, grass looks like grass. It only carries <em>colour</em>, no lighting of its own. This is the one map you actually paint by hand, and every other map on this page gets built from it.`,
            derive: `Since everything comes from the diffuse, the cleaner it is, the better your maps turn out. If your texture has <em>baked-in</em> shadows or a painted-on highlight (really common with photos), run <strong>De-light</strong> on it first. Otherwise the tool reads that fake shadow as real depth and doubles it up in the AO and normal maps, and it won’t sit right under Tomb Engine’s own lights either.`,
            tip: `Albedo, diffuse and base colour are three names for the same thing. In the exported ZIP the diffuse keeps your plain name, and the material maps sit next to it with a little suffix (see the naming key up top).`
        },
        {
            id: 'normal', icon: '🟦', title: 'Normal maps (fake 3D bumps)',
            what: `A <strong>normal</strong> map fakes surface relief without adding any actual geometry. Each pixel stores which way that little patch of surface is facing, so a flat wall catches light as if it had mortar grooves, wood grain or pitting. The overall blue tint just means “facing you”, and the red and green shifts are slopes that catch light from the side.`,
            derive: `The tool turns the diffuse’s brightness into slopes. Dark mortar lines become valleys, bright brick faces become raised bits, and it writes each point’s facing direction into RGB. It smooths the source first (that’s the Blur) so you’re shaping broad relief instead of pixel noise.`,
            sliders: [
                ['Normal Strength', 'how deep the bumps read. Low is subtle, high is dramatic. Push it too far and it starts to look like crinkled foil.'],
                ['Normal Blur', 'smooths the diffuse before it reads the slopes. Turn it up to kill grainy noise, down to keep crisp edges.'],
                ['Normal Fine Detail / Large Scale', 'balance tiny surface grain against broad, sweeping shape.'],
                ['Normal Angularity / Tilt', 'sharpen slopes into faceted, chiselled edges (nice for cut stone and brick) instead of soft rounded relief.']
            ],
            tuning: [
                ['Bricks / cut stone', 'high Strength (around 30) with a little Blur (2) so the mortar lines read as deep grooves, plus a touch of Angularity for crisp brick edges.'],
                ['Wood (bring out the grain)', 'moderate Strength (around 22), low Blur (1 to 2) and high Fine Detail so the grain stays sharp. Keep Large Scale low so the plank itself reads flat.'],
                ['Sand / snow', 'low Strength (10 to 14) and high Blur (3 to 4). You want gentle undulation, otherwise every grain looks like a boulder.'],
                ['Foliage / leaves / grass', 'strong-ish Strength for the vein and blade relief, but pair it with a <strong>Decal</strong> preset so the transparent edges stay flat and don’t emboss.'],
                ['Metal / polished', 'very low Strength (chrome around 6, steel around 10). A mirror has almost no relief, and overdoing it makes clean metal look hammered.']
            ],
            tip: `Normal maps give you the most wow for the least effort. Start from the preset, then nudge <strong>Normal Strength</strong> while you drag the light around the preview. Stop the moment it reads as depth, before it turns into tinfoil.`
        },
        {
            id: 'ao', icon: '🌑', title: 'Ambient Occlusion (soft contact shadow)',
            what: `<strong>AO</strong> darkens the nooks a surface can’t get ambient light into: mortar joints, the gaps between cobbles, deep grain. It’s what stops a normal-mapped surface from looking flat and plasticky. White means exposed, dark means tucked away.`,
            derive: `The tool samples around each point using that same brightness-as-depth signal. The more walled-in a spot is (surrounded by higher areas), the darker its AO gets. <strong>Radius</strong> sets how far it looks, <strong>Intensity</strong> sets how dark it goes.`,
            sliders: [
                ['AO Radius', 'how wide the shadow spreads out from a crevice.'],
                ['AO Intensity', 'how dark the crevices get.'],
                ['AO Normal Mix', 'blends in the normal map’s shape so the AO hugs the relief more closely.']
            ],
            tuning: [
                ['Bricks / cobble / stone walls', 'high Radius and Intensity (around 16 and 22) so the joints read nice and deep.'],
                ['Floors and columns', 'pull Intensity down (7 to 16). On a fluted column or a laid floor, full-strength AO turns the grooves pitch black, so the built-in <strong>Column</strong> and <strong>Floor Stone</strong> presets already tame this for you.'],
                ['Sand / fabric / snow', 'low Intensity (around 10). Soft materials have shallow occlusion, and heavy AO just makes them look dirty.'],
                ['Decals (dust, cobweb, moss)', 'very low. A thin overlay has almost no depth to occlude.']
            ],
            tip: `If a texture looks grimy or muddy, it’s usually the AO that’s too strong, not the normal. Back off <strong>AO Intensity</strong> first.`
        },
        {
            id: 'specular', icon: '✨', title: 'Specular (how shiny)',
            what: `The <strong>specular</strong> map sets how strongly each spot bounces direct light back at you, which is the highlight you see. Bright means shiny, dark means matte. This is about how <em>much</em> light reflects, not how sharp the reflection is (that’s roughness, coming up next).`,
            derive: `It’s built from the preset’s <strong>Specular Base</strong> (the overall shininess) plus <strong>Specular Contrast</strong> (how much the texture’s own detail brightens or dulls the highlight, so a glaze reads brighter than the mortar around it).`,
            sliders: [
                ['Specular Base', 'overall reflectivity. Metals and glass sit high (200 to 248), stone, fabric and sand sit low (30 to 55).'],
                ['Specular Contrast', 'how much the surface detail varies the shine across the tile.']
            ],
            tuning: [
                ['Metals (chrome, gold, steel)', 'Base very high, 210 to 248.'],
                ['Marble / tile / ceramic / ice', 'high-ish Base (170 to 225) for a polished gleam.'],
                ['Brick / stone / concrete / wood', 'low Base (40 to 80), mostly matte.'],
                ['Fabric / sand / dirt / paper', 'lowest Base (20 to 50), barely any highlight at all.']
            ],
            tip: `Specular and roughness work together in TEN. High specular with high roughness gives a broad soft sheen like satin. High specular with low roughness gives a tight mirror hotspot.`
        },
        {
            id: 'roughness', icon: '🔲', title: 'Roughness (sharp vs blurry reflection)',
            what: `<strong>Roughness</strong> decides whether reflections come out crisp or scattered. Black is mirror-sharp, white is fully diffuse and matte. It’s the difference between polished marble and chalk.`,
            derive: `It comes from <strong>Roughness Base</strong> (the overall level) and <strong>Roughness Contrast</strong> (how much local texture detail roughens or smooths it, so scratches read rougher than the base metal).`,
            sliders: [
                ['Roughness Base', '0 is a mirror, 255 is dead matte.'],
                ['Roughness Contrast', 'how much the texture’s detail varies roughness locally.']
            ],
            tuning: [
                ['Chrome / glass / mercury / still water', 'near 0 to 15, basically a mirror.'],
                ['Gold / marble / polished stone / ice', 'low, 15 to 40.'],
                ['Brushed or worn metal', 'mid, 50 to 110, for stretched satin highlights.'],
                ['Brick / concrete / sand / fabric / bark', 'high, 190 to 235, no visible reflection.'],
                ['Wet look on anything', 'drop the Base right down to make a dry material glossy, like a rain-soaked cobble floor.']
            ],
            tip: `Roughness is the fastest way to sell “wet”. Take a dry stone preset, pull <strong>Roughness Base</strong> down and nudge <strong>Specular Base</strong> up, and you’ve got a rain-soaked look in seconds.`
        },
        {
            id: 'height', icon: '⬆️', title: 'Height / Parallax (real depth)',
            what: `Where a normal map <em>fakes</em> bumps, a <strong>height</strong> map drives real <strong>parallax</strong>. High points actually shift in front of low ones as the camera moves, so mortar joints genuinely look recessed. It’s the most convincing depth you can get, and also the most expensive.`,
            derive: `Same brightness-as-elevation reading as the normal map, just written out as grayscale (white is high, black is low). <strong>Height Blur</strong> smooths the source first so you get clean relief instead of pixel jitter.`,
            sliders: [
                ['Height Strength', 'how deep the parallax pushes.'],
                ['Height Blur', 'smooths the source first so the relief isn’t noisy.']
            ],
            tuning: [
                ['Bricks / cobble / coursed stone', 'this is the star use. Strong Height (20 and up) so the stones sit proud of the joints.'],
                ['Wood planks / tile', 'moderate, just enough to sink the joints.'],
                ['Sand / fabric / smooth surfaces', 'low. There’s barely any real relief, and parallax on fine noise makes the surface look like it’s swimming.']
            ],
            tip: `Height is GPU-heavy in Tomb Engine, since every pixel does extra samples. Use it on a handful of hero textures per level rather than the whole atlas, and keep <strong>Seamless height edges</strong> ticked so a tiling texture doesn’t show a parallax “cliff” where it repeats. The tool warns you if you switch it on atlas-wide.`
        },
        {
            id: 'emissive', icon: '💡', title: 'Emissive (glow in the dark)',
            what: `An <strong>emissive</strong> map makes parts of a texture glow on their own, ignoring the scene lighting: lava cracks, neon, runes, screens, lit windows. Black means no glow, and coloured pixels glow in that colour even in pitch darkness.`,
            derive: `Most materials emit nothing at all. Emissive gets built from a brightness <strong>Threshold</strong> (only pixels brighter than this glow) times a <strong>Strength</strong>. Liquid presets like <strong>Lava</strong>, <strong>Slime</strong>, <strong>Acid</strong> and <strong>Magic Liquid</strong> already have it switched on, and the <strong>Make Emissive</strong> tool lets you paint it exactly where you want.`,
            sliders: [
                ['Emissive Strength', '0 for nearly everything. Only raise it for actual light sources.'],
                ['Emissive Threshold', 'how bright a pixel has to be before it glows (high means only the very brightest bits).']
            ],
            tuning: [
                ['Lava / molten metal', 'high Strength (80 to 90), low Threshold (around 100) so the hot cracks glow.'],
                ['Slime / acid / poison / magic liquid', 'gentle Strength (20 to 60) for an eerie sheen.'],
                ['Everything else', 'leave it at 0.']
            ],
            tip: `The preview sits on black on purpose, because emissive is exactly what you’d still see with the lights off. If a whole material is glowing, your <strong>Threshold</strong> is set too low. <strong>Set Material</strong> shows the emissive alongside the other maps in its preview sheet, and the lit preview lights up with it, so a glow you painted with <strong>Make Emissive</strong> is visible before you export. Emissive can <em>animate</em>: an animated texture is a stack of tiles, and its glow exports as a matching per-frame atlas, so a lava range’s cracks glow as they shift (the animated-texture <strong>✨ Glow</strong> tab, with an optional pulse).`
        },
        {
            id: 'cookbook', icon: '📋', title: 'Quick-reference recipe table',
            what: `A cheat-sheet of the built-in presets, grouped by material family, showing the values that matter most at a glance. <em>N</em> is Normal Strength, <em>AO</em> is AO Intensity, <em>R</em> is Roughness Base, <em>S</em> is Specular Base, <em>H</em> is Height Strength. These are the actual numbers the presets use, so they make a great starting point to copy and tweak.`,
            recipes: true,
            tip: `You’ll spot the patterns pretty quickly. Shiny things (metal, marble, glass) run high S and low R. Rough matte things (brick, sand, concrete) run low S and high R. Deep-relief things (brick, stone) run high N and H. Soft things (sand, snow, fabric) keep everything low.`
        },
        {
            id: 'where', icon: '🎛️', title: 'Where to tune this in the tool',
            what: `Everything above lives in one place: right-click a tile and hit <strong>Set Material</strong>. Pick a <strong>type</strong> (Solid or Liquid), an <strong>aesthetic</strong> (Realistic, Fantasy, Decal or your ⭐ saved presets) and a <strong>preset</strong>, then open the <strong>Advanced editor</strong>. The sliders there map one-to-one to the names on this page.`,
            derive: `Drag the lit preview to move the light around and see how it reads, or flip the <strong>🧊 3D</strong> toggle to watch the height map displace a real mesh. Once you’ve dialled it in, hit <strong>⭐ Save as preset…</strong> to reuse that exact recipe on any tile, in this project or the next. Saved presets stay in your browser between sessions and appear as one-click chips along the top of <strong>Set Material</strong>, so a “my rock” or “my sand” is always one click away (<strong>⬇ Export</strong> writes them to a JSON file for backup or sharing). In the <strong>Export</strong> panel you choose which maps actually get generated.`,
            tip: `Transition, Wang and border tiles inherit their materials from their source tiles, so you tune the sources rather than the blended tiles. If one texture mixes surfaces (a brick wall with a wooden door and a metal knob), use <strong>🎭 Multiple materials</strong> to paint a different material onto each region. To put the same material on many tiles, select them and use <strong>🎨 Apply Material</strong>, or right-click any of them: the menu acts on the whole selection. <strong>🎨 Apply Last Material</strong> repeats your previous choice with no modal at all.`
        }
    ];

    /* ---- small DOM helper ---- */
    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    /* ---- Map-naming key (diffuse + suffixes) ---- */
    function buildSuffixKeys() {
        const wrap = el('div', 'mat-keys');
        wrap.appendChild(el('span', 'mat-key', '<code>name</code> Diffuse / albedo'));
        const names = { normal: 'Normal', ao: 'Ambient occlusion', specular: 'Specular', roughness: 'Roughness', emissive: 'Emissive', height: 'Height' };
        (TRLE.MapOrder || Object.keys(names)).forEach(k => {
            const suf = (TRLE.MapSuffixes && TRLE.MapSuffixes[k]) || '';
            wrap.appendChild(el('span', 'mat-key', `<code>${suf}</code> ${names[k] || k}`));
        });
        return wrap;
    }

    /* ---- Archetype recipe table (built from the live presets) ---- */
    function presetByKind(key, kind) {
        if (kind === 'liquid') return TRLE.getLiquidPreset(key, 'realistic');
        if (kind === 'decal') return TRLE.getSolidPreset(key, 'decal');
        return TRLE.getSolidPreset(key, 'realistic');
    }
    function buildRecipeTable() {
        const wrap = el('div', 'mat-table-wrap');
        const t = el('table', 'mat-table');
        t.innerHTML = `<thead><tr>
            <th>Material</th><th title="Normal Strength">N</th><th title="AO Intensity">AO</th>
            <th title="Roughness Base">R</th><th title="Specular Base">S</th><th title="Height Strength">H</th>
            <th>Notes</th></tr></thead>`;
        const tb = el('tbody');
        RECIPES.forEach(row => {
            if (row.head) {
                const tr = el('tr');
                tr.appendChild(el('td', null, `<strong style="color:var(--accent)">${row.head}</strong>`)).colSpan = 7;
                tb.appendChild(tr);
                return;
            }
            const [key, kind, note] = row;
            const p = presetByKind(key, kind);
            if (!p) return;
            const tr = el('tr');
            const cells = [p.label || key, p.normalStrength, p.aoIntensity, p.roughnessBase, p.specularBase, p.heightStrength];
            cells.forEach((c, i) => tr.appendChild(el('td', null, i === 0 ? c : String(c))));
            tr.appendChild(el('td', 'mt-note', note));
            tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        return wrap;
    }

    /* ============================================================
       Live material tuner — runs the real WebGL engine.
       ============================================================ */
    function buildTuner() {
        const wrap = el('div', 'mat-tuner');
        wrap.innerHTML = `
            <div class="tut-badge">🧪 Live — the real engine</div>
            <div class="mt-row">
                <label>Texture:</label>
                <div class="mt-tex-btns" id="mt-tex"></div>
            </div>
            <div class="mt-row">
                <label for="mt-preset">Material preset:</label>
                <select id="mt-preset"></select>
                <button class="mt-tex-btn" id="mt-reset" title="Reset the sliders to this preset's values">↺ Reset to preset</button>
            </div>
            <div class="mt-desc" id="mt-desc"></div>
            <div class="mt-sliders" id="mt-sliders"></div>
            <div class="tut-maps-grid" id="mt-maps"></div>
            <div class="tut-prev2x">
                <figure><canvas class="tut-prev-2d" id="mt-2d" width="256" height="256"></canvas><figcaption>2D lit preview (flat)</figcaption></figure>
                <figure><canvas class="tut-prev-3d" id="mt-3d" width="256" height="256"></canvas><figcaption>🧊 3D displaced preview<span class="tut-3d-status" id="mt-3d-status"></span></figcaption></figure>
            </div>
            <p class="tut-maps-note">Left is the flat shaded preview. Right is a real <strong>3D engine</strong> (Babylon.js) that displaces a mesh using the height map, so you can drag to orbit and scroll to zoom. It loads once this widget scrolls into view.</p>`;
        setTimeout(() => initTuner(wrap), 0);
        return wrap;
    }

    function initTuner(wrap) {
        const S = 256;
        const mapsGrid = wrap.querySelector('#mt-maps');
        const E = window.TRLE && window.TRLE.Engine;
        if (!E || !E.init(document.getElementById('mat-gl'))) {
            mapsGrid.innerHTML = '<p class="tut-maps-note">This live tuner needs WebGL 2.0 — open the tool itself to try it.</p>';
            return;
        }

        // Build the texture buttons + preset dropdown.
        const texBtns = wrap.querySelector('#mt-tex');
        TEXTURES.forEach((tx, i) => {
            const b = el('button', 'mt-tex-btn' + (i === 0 ? ' active' : ''), tx[1]);
            b.dataset.i = i;
            texBtns.appendChild(b);
        });
        const presetSel = wrap.querySelector('#mt-preset');
        const addOpts = (label, keys, kind) => {
            const g = document.createElement('optgroup'); g.label = label;
            keys.forEach(k => {
                const p = presetByKind(k, kind); if (!p) return;
                const o = new Option(p.label || k, k); o.dataset.kind = kind; g.appendChild(o);
            });
            presetSel.appendChild(g);
        };
        addOpts('Solid', TRLE.getSolidPresetKeys('realistic'), 'solid');
        addOpts('Decal (transparent)', TRLE.getSolidPresetKeys('decal'), 'decal');
        addOpts('Liquid', TRLE.getLiquidPresetKeys('realistic'), 'liquid');

        // Build the sliders.
        const slidersWrap = wrap.querySelector('#mt-sliders');
        const sliderEls = {};
        TUNER_SLIDERS.forEach(([key, label, min, max, step]) => {
            const row = el('div', 'mt-slider');
            row.innerHTML = `<span>${label}</span><span class="mt-val" id="mt-val-${key}">–</span>
                <input type="range" id="mt-s-${key}" min="${min}" max="${max}" step="${step}">`;
            slidersWrap.appendChild(row);
            sliderEls[key] = row.querySelector('input');
        });

        const descEl = wrap.querySelector('#mt-desc');
        const c2d = wrap.querySelector('#mt-2d');
        const c3d = wrap.querySelector('#mt-3d');
        const status = wrap.querySelector('#mt-3d-status');
        const setStatus = m => { if (status) status.textContent = m ? ' — ' + m : ''; };

        // ---- state ----
        let curKind = 'solid';
        let curPreset = null;   // resolved preset object for the selected preset key
        let diffCanvas = null;  // current diffuse canvas
        let diffTex = null;     // its GL texture
        let regenTimer = null, p3d = null, latestMaps = null, p3dTimer = null;

        function selectPreset(key, kind) {
            curKind = kind;
            curPreset = presetByKind(key, kind);
            presetSel.value = key;
            descEl.textContent = curPreset && curPreset.description ? curPreset.description : '';
            loadSlidersFromPreset();
            scheduleRegen();
        }
        function loadSlidersFromPreset() {
            TUNER_SLIDERS.forEach(([key]) => {
                const v = curPreset && curPreset[key] != null ? curPreset[key] : sliderEls[key].min;
                sliderEls[key].value = v;
                const lbl = wrap.querySelector('#mt-val-' + key);
                if (lbl) lbl.textContent = v;
            });
        }
        function activePreset() {
            const p = Object.assign({}, curPreset);
            TUNER_SLIDERS.forEach(([key]) => { p[key] = parseFloat(sliderEls[key].value); });
            return p;
        }

        // Swap the diffuse texture (loads image, procedural-brick fallback for file://).
        function loadTexture(i, then) {
            const tx = TEXTURES[i];
            const img = new Image();
            img.onload = () => {
                let cv = el('canvas'); cv.width = S; cv.height = S;
                cv.getContext('2d').drawImage(img, 0, 0, S, S);
                let tex;
                try { tex = E.createTextureFromImage(cv); }
                catch (e) {
                    // file:// taints the canvas → fall back to a procedural brick.
                    console.warn('[materials] demo image blocked (file://?); using a procedural texture');
                    cv = el('canvas'); cv.width = S; cv.height = S;
                    drawDemoBrick(cv.getContext('2d'), S);
                    tex = E.createTextureFromImage(cv);
                }
                if (diffTex) E.deleteTexture(diffTex);
                diffCanvas = cv; diffTex = tex;
                if (then) then();
            };
            img.onerror = () => { mapsGrid.innerHTML = '<p class="tut-maps-note">Could not load the demo texture.</p>'; };
            img.src = tx[2];
        }

        function scheduleRegen() { clearTimeout(regenTimer); regenTimer = setTimeout(regen, 70); }

        function cell(label, canvas) {
            const d = el('div', 'tut-maps-cell');
            const cv = el('canvas'); cv.width = canvas.width; cv.height = canvas.height;
            cv.getContext('2d').drawImage(canvas, 0, 0);
            d.appendChild(cv); d.appendChild(el('div', 'tut-maps-cap', label));
            return d;
        }

        function regen() {
            if (!diffTex) return;
            const preset = activePreset();
            const emis = (preset.emissiveStrength || 0) > 0;
            const enabled = { normal: true, ao: true, specular: true, roughness: true, height: true, emissive: emis };
            let maps;
            try { maps = E.generateMaps(diffTex, S, S, preset, enabled); }
            catch (err) { console.error('[materials tuner]', err); mapsGrid.innerHTML = '<p class="tut-maps-note">Map generation failed — see console.</p>'; return; }

            // 2D lit preview from the freshly-generated map textures.
            try {
                const has = k => maps[k] ? 1.0 : 0.0;
                const litFbo = E.createFBO(S, S);
                E.blit('materialPreview', {
                    u_diffuse: diffTex,
                    u_normal:    maps.normal    ? maps.normal.texture    : diffTex,
                    u_ao:        maps.ao        ? maps.ao.texture        : diffTex,
                    u_specular:  maps.specular  ? maps.specular.texture  : diffTex,
                    u_roughness: maps.roughness ? maps.roughness.texture : diffTex,
                    u_emissive:  maps.emissive  ? maps.emissive.texture  : diffTex,
                    u_hasNormal: has('normal'), u_hasAO: has('ao'), u_hasSpecular: has('specular'),
                    u_hasRoughness: has('roughness'), u_hasEmissive: has('emissive'),
                    u_lightDir: [-0.35, 0.4, 0.85]
                }, litFbo);
                c2d.getContext('2d').drawImage(E.fboToCanvas(litFbo), 0, 0, c2d.width, c2d.height);
                E.deleteFBO(litFbo);
            } catch (err) { console.error('[materials tuner 2D]', err); }

            // Thumbnails (diffuse + each generated map) and 3D map set.
            mapsGrid.innerHTML = '';
            mapsGrid.appendChild(cell('Diffuse', diffCanvas));
            const mc = { diffuse: diffCanvas };
            ['normal', 'ao', 'specular', 'roughness', 'height', 'emissive'].forEach(k => {
                if (!maps[k]) return;
                const cv = E.fboToCanvas(maps[k]);
                mapsGrid.appendChild(cell(MAP_LABELS[k], cv));
                if (k === 'normal' || k === 'ao' || k === 'roughness' || k === 'emissive' || k === 'height') mc[k] = cv;
            });
            Object.values(maps).forEach(f => f && E.deleteFBO(f));

            // Push to the 3D preview (debounced — setMaps is heavier).
            latestMaps = mc;
            if (p3d) { clearTimeout(p3dTimer); p3dTimer = setTimeout(() => { if (p3d && latestMaps) p3d.setMaps(latestMaps); }, 220); }
        }

        // Wire events.
        texBtns.addEventListener('click', e => {
            const b = e.target.closest('.mt-tex-btn'); if (!b) return;
            texBtns.querySelectorAll('.mt-tex-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            const i = +b.dataset.i;
            loadTexture(i, () => selectPreset(TEXTURES[i][3], TEXTURES[i][4]));
        });
        presetSel.addEventListener('change', () => {
            const o = presetSel.selectedOptions[0];
            selectPreset(presetSel.value, o ? o.dataset.kind : 'solid');
        });
        wrap.querySelector('#mt-reset').addEventListener('click', () => { loadSlidersFromPreset(); scheduleRegen(); });
        Object.entries(sliderEls).forEach(([key, inp]) => {
            inp.addEventListener('input', () => {
                const lbl = wrap.querySelector('#mt-val-' + key);
                if (lbl) lbl.textContent = inp.value;
                scheduleRegen();
            });
        });

        // Lazy-start the Babylon 3D preview when the widget scrolls into view.
        const start3D = () => {
            if (p3d || !(window.TRLE && TRLE.Preview3D)) { if (!(window.TRLE && TRLE.Preview3D)) tutDrawMsg(c3d, '3D needs a modern browser', '#999'); return; }
            try {
                p3d = TRLE.Preview3D.create(c3d, { relief: 0.5, onStatus: setStatus });
                if (latestMaps) p3d.setMaps(latestMaps).then(ok => { if (ok) setTimeout(() => p3d.resize(), 60); });
            } catch (err) { console.error('[materials 3D]', err); setStatus('error — see console'); }
        };
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) { start3D(); io.disconnect(); } }), { threshold: 0.15 });
            io.observe(c3d);
        } else { start3D(); }

        // Kick things off with the first texture + its default preset.
        loadTexture(0, () => selectPreset(TEXTURES[0][3], TEXTURES[0][4]));
    }

    /* ---- Procedural brick fallback (file:// taints the bundled images) ---- */
    function drawDemoBrick(ctx, S) {
        ctx.fillStyle = '#33271a'; ctx.fillRect(0, 0, S, S);
        const bw = S / 4, bh = S / 8;
        for (let row = 0; row < 8; row++) {
            const off = (row % 2) ? bw / 2 : 0;
            for (let col = -1; col < 5; col++) {
                const x = col * bw + off + 3, y = row * bh + 3, w = bw - 6, h = bh - 6;
                const base = 110 + Math.random() * 70;
                ctx.fillStyle = 'rgb(' + (base | 0) + ',' + ((base * 0.78) | 0) + ',' + ((base * 0.58) | 0) + ')';
                ctx.fillRect(x, y, w, h);
                for (let k = 0; k < 60; k++) {
                    const v = base - 35 + Math.random() * 70;
                    ctx.fillStyle = 'rgba(' + (v | 0) + ',' + ((v * 0.78) | 0) + ',' + ((v * 0.58) | 0) + ',0.5)';
                    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2);
                }
            }
        }
    }

    /* Draw a short centred message onto a canvas (safe no-op if GL owns it). */
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

    /* ---- Render a labelled bullet list (sliders / tuning) ---- */
    function labelledList(lead, pairs) {
        const box = el('div');
        box.appendChild(el('p', 'tut-what', `<strong>${lead}</strong>`));
        const ul = el('ul', 'tut-how');
        pairs.forEach(([name, txt]) => ul.appendChild(el('li', null, `<strong>${name}</strong>: ${txt}`)));
        box.appendChild(ul);
        return box;
    }

    function render() {
        const toc = document.getElementById('tut-toc');
        const main = document.getElementById('tut-main');
        toc.appendChild(el('div', 'tut-toc-title', 'Materials guide'));
        const tocList = el('ul', 'tut-toc-list');
        toc.appendChild(tocList);

        SECTIONS.forEach(s => {
            const li = el('li');
            li.innerHTML = `<a href="#${s.id}"><span class="toc-ico">${s.icon}</span>${s.title}</a>`;
            tocList.appendChild(li);

            const sec = el('section', 'tut-section');
            sec.id = s.id;
            sec.appendChild(el('h2', 'tut-h2', `<span class="tut-ico">${s.icon}</span>${s.title}`));
            if (s.what) sec.appendChild(el('p', 'tut-what', s.what));
            if (s.keys) sec.appendChild(buildSuffixKeys());
            if (s.tuner) sec.appendChild(buildTuner());
            if (s.derive) sec.appendChild(el('p', 'tut-what', `<em>How the tool makes it:</em> ${s.derive}`));
            if (s.sliders) sec.appendChild(labelledList('The sliders', s.sliders));
            if (s.tuning) sec.appendChild(labelledList('Tuning per material', s.tuning));
            if (s.recipes) sec.appendChild(buildRecipeTable());
            if (s.tip) sec.appendChild(el('div', 'tut-tip', `<strong>Tip:</strong> ${s.tip}`));
            main.appendChild(sec);
        });

        // Scrollspy — highlight the section currently in view.
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
        document.querySelectorAll('.tut-section').forEach(sec => io.observe(sec));
    }

    document.addEventListener('DOMContentLoaded', render);
})();
