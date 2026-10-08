/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). The whole tool is MIT as of 2026-09-13: the two GPL-3.0
   seamless shaders ported from Materialize were removed and replaced with
   independent implementations. */
/* ============================================================
   TRLE Atlas Tool — Animated Texture Presets (Phase 2)
   Curated param bags consumed by TRLE.AnimGen. Each entry's
   `params` is merged over AnimGen.DEFAULTS; the UI supplies the
   per-use bits (size from the atlas tile size, user-chosen frame
   count, randomisable seed). Colour comes from a named gradient
   in TRLE.AnimGradients (Tab 2 can swap/edit it).

   `material` is a hint into the existing PBR preset tables
   (TRLE.LiquidPresets / SolidPresets / DecalPresets) so the
   modal can suggest a sensible material. `emissive` marks
   presets that should glow (lava, magic…).
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimPresets = {
    caustic_water: {
        label: 'Caustic Water', icon: '💧', gradient: 'caustic_blue',
        description: 'Bright rippling caustics for clear pools and shallow water. Ridged veins of light that drift and shimmer.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.6, contrast: 1.35 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    deep_water: {
        label: 'Deep Water', icon: '🌊', gradient: 'water_deep',
        description: 'Slow rolling swell for deep ocean or large lakes. Soft fBm undulation, gentle reflections.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 1, octaves: 5, gain: 0.55, warp: 0.35, contrast: 1.05 },
        material: { type: 'liquid', key: 'ocean_deep' }
    },
    murky_swamp: {
        label: 'Murky Swamp', icon: '🥬', gradient: 'swamp_green',
        description: 'Stagnant green-brown swamp water with floating scum. Low contrast, sluggish movement.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.55, warp: 0.45, contrast: 0.95 },
        material: { type: 'liquid', key: 'swamp_water' }
    },
    oil_slick: {
        label: 'Oil / Tar', icon: '🛢️', gradient: 'oil_dark',
        description: 'Thick glossy black oil with a slow viscous churn and a faint sheen.',
        params: { style: 2, spatialPeriod: 3, timePeriod: 1, octaves: 4, gain: 0.5, warp: 0.5, contrast: 1.15 },
        material: { type: 'liquid', key: 'oil' }
    },
    lava: {
        label: 'Lava', icon: '🌋', gradient: 'lava_hot',
        description: 'Molten lava with a cooling crust and glowing cracks. Slow churn, strong emission.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.4, contrast: 1.45 },
        material: { type: 'liquid', key: 'lava' }, emissive: true
    },
    molten_metal: {
        label: 'Molten Metal', icon: '🔥', gradient: 'molten',
        description: 'Liquid metal with superheated bright zones between a darker cooling sheen.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.45, contrast: 1.4 },
        material: { type: 'liquid', key: 'molten_metal' }, emissive: true
    },
    toxic_sludge: {
        label: 'Toxic Sludge', icon: '☣️', gradient: 'toxic_green',
        description: 'Bubbling radioactive green ooze with an eerie glow.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 2, octaves: 4, gain: 0.55, warp: 0.6, contrast: 1.25 },
        material: { type: 'liquid', key: 'acid' }, emissive: true
    },
    clouds: {
        label: 'Clouds / Fog', icon: '☁️', gradient: 'cloud_white',
        description: 'Soft drifting cloud or fog cover. High domain warp, gentle contrast.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 1, octaves: 5, gain: 0.55, warp: 1.0, contrast: 0.9 },
        material: null
    },
    smoke: {
        label: 'Smoke', icon: '💨', gradient: 'smoke_grey',
        description: 'Rising smoke that fades to transparent at the thin edges (alpha ramp). Drifts and billows.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.55, warp: 1.2, contrast: 1.05 },
        material: null
    },
    dust: {
        label: 'Dust / Sand', icon: '🌫️', gradient: 'dust_tan',
        description: 'Faint drifting dust or blowing sand, fading to transparent. Subtle, slow.',
        params: { style: 2, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.5, warp: 0.6, contrast: 1.0 },
        material: { type: 'decal', key: 'dust' }
    },
    magic_energy: {
        label: 'Magic Energy', icon: '✨', gradient: 'magic_violet',
        description: 'Swirling arcane energy — violet to cyan glow with fast churn. Great for runes and effects.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 3, octaves: 5, gain: 0.5, warp: 1.0, contrast: 1.4 },
        material: { type: 'liquid', key: 'magic_liquid' }, emissive: true
    },
    portal: {
        label: 'Portal / Vortex', icon: '🌀', gradient: 'portal_cyan',
        description: 'Deep swirling vortex with heavy domain warp — teleporters and rifts.',
        params: { style: 1, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.5, warp: 1.6, contrast: 1.3 },
        material: { type: 'liquid', key: 'magic_liquid' }, emissive: true
    },

    /* ---- Batch B: directional flow (scroll + vertical stretch) ---- */
    fire: {
        label: 'Fire / Flames', icon: '🔥', gradient: 'ember_fire',
        description: 'Licking flames that rise and flicker — stretched ridged noise flowing upward. Glows.',
        params: { style: 1, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.5, warp: 0.5, contrast: 1.5, flowY: -3, stretch: 3 },
        material: null, emissive: true
    },
    waterfall: {
        label: 'Waterfall', icon: '🚿', gradient: 'caustic_blue',
        description: 'Falling water — bright foamy streaks scrolling downward over a tall stretched field.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 1, octaves: 5, gain: 0.55, warp: 0.3, contrast: 1.15, flowY: 3, stretch: 3 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    river_current: {
        label: 'River Current', icon: '🏞️', gradient: 'water_deep',
        description: 'Water drifting steadily downstream — gentle swell scrolling sideways. Set the flow direction to taste.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.55, warp: 0.4, contrast: 1.05, flowX: 2, stretch: 1 },
        material: { type: 'liquid', key: 'ocean_deep' }
    },
    rising_smoke: {
        label: 'Rising Smoke', icon: '💨', gradient: 'smoke_grey',
        description: 'Smoke that actually climbs — soft billows drifting upward, fading at the thin edges.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 1, octaves: 5, gain: 0.55, warp: 1.0, contrast: 1.0, flowY: -2, stretch: 2 },
        material: null
    },
    blowing_sand: {
        label: 'Blowing Sand', icon: '🏜️', gradient: 'dust_tan',
        description: 'Wind-driven sand or dust streaking across the surface, fading to transparent.',
        params: { style: 2, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.5, warp: 0.5, contrast: 1.0, flowX: 3, stretch: 1 },
        material: { type: 'decal', key: 'dust' }
    },
    lava_flow: {
        label: 'Lava Flow', icon: '🌋', gradient: 'lava_hot',
        description: 'Molten lava creeping downhill — glowing cracks slowly advancing. Strong emission.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.4, contrast: 1.45, flowY: 1, stretch: 2 },
        material: { type: 'liquid', key: 'lava' }, emissive: true
    },

    /* ---- Batch C: extra liquids, gases, magic & sky (reuse of the
       library gradients that previously had no preset, plus steam/electric) ---- */
    blood_pool: {
        label: 'Blood Pool', icon: '🩸', gradient: 'blood_red',
        description: 'A still pool of dark blood with a slow viscous roll and a faint glossy sheen. Low contrast, sluggish.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.55, warp: 0.4, contrast: 1.1 },
        material: { type: 'liquid', key: 'blood' }
    },
    frozen_ice: {
        label: 'Frozen Ice', icon: '❄️', gradient: 'ice_blue',
        description: 'A frozen surface with slow shimmering cracks catching the light. Ridged veins, very slow drift.',
        params: { style: 1, spatialPeriod: 5, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.3, contrast: 1.25 },
        material: { type: 'liquid', key: 'ice_water' }
    },
    quicksilver: {
        label: 'Quicksilver', icon: '⚪', gradient: 'mercury',
        description: 'Reflective liquid metal — soft rolling blobs of mercury with a bright metallic sheen.',
        params: { style: 2, spatialPeriod: 3, timePeriod: 1, octaves: 4, gain: 0.55, warp: 0.45, contrast: 1.1 },
        material: { type: 'liquid', key: 'mercury' }
    },
    boiling_water: {
        label: 'Boiling Water', icon: '🫧', gradient: 'caustic_blue',
        description: 'Rapidly roiling, bubbling water — tight fast billows for cauldrons and hot springs.',
        params: { style: 2, spatialPeriod: 5, timePeriod: 3, octaves: 4, gain: 0.55, warp: 0.6, contrast: 1.2 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    whirlpool: {
        label: 'Whirlpool', icon: '🌀', gradient: 'water_deep',
        description: 'A dark swirling vortex of water dragged into a spiral by heavy domain warp. Drains and rapids.',
        params: { style: 1, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.5, warp: 1.6, contrast: 1.2 },
        material: { type: 'liquid', key: 'ocean_deep' }
    },
    honey_flow: {
        label: 'Honey / Amber', icon: '🍯', gradient: 'sepia',
        description: 'Thick golden honey oozing slowly downward — glossy, translucent, sluggish.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.5, warp: 0.35, contrast: 1.15, flowY: 1, stretch: 2 },
        material: { type: 'liquid', key: 'honey' }
    },
    steam: {
        label: 'Steam / Vapour', icon: '♨️', gradient: 'steam_white',
        description: 'Hot white steam billowing upward and fading to transparent — vents, geysers, boiling pots.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.55, warp: 1.2, contrast: 1.05, flowY: -2, stretch: 2 },
        material: null
    },
    poison_gas: {
        label: 'Poison Gas', icon: '🟢', gradient: 'toxic_green',
        description: 'A creeping cloud of toxic green gas drifting sideways with an eerie glow. Set the flow direction to taste.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 2, octaves: 4, gain: 0.55, warp: 0.9, contrast: 1.1, flowX: 2, stretch: 1 },
        material: { type: 'liquid', key: 'poison' }, emissive: true
    },
    electric_plasma: {
        label: 'Electric Plasma', icon: '⚡', gradient: 'electric',
        description: 'Crackling arcs of blue-white plasma — fast ridged energy for machinery, shields and Tesla effects. Glows.',
        params: { style: 1, spatialPeriod: 4, timePeriod: 4, octaves: 5, gain: 0.5, warp: 1.1, contrast: 1.6 },
        material: { type: 'liquid', key: 'magic_liquid' }, emissive: true
    },
    /* ---- Batch D: PARTICLES -------------------------------------------
       A different generator (js/animparticles.js), selected by
       `params.generator`. fBm cannot make a straight streak, an honest
       particle count or a slant, and those three are what rain is. Every
       `dirX`/`dirY` here is a pair of small INTEGERS so the velocity stays
       whole tiles per loop and the sequence closes exactly; see the header
       of animparticles.js. These all want a transparent gradient, because a
       particle field is mostly empty and the gaps have to show what is
       behind them. */
    rain_drizzle: {
        label: 'Rain, drizzle', icon: '🌦️', gradient: 'rain_clear',
        description: 'Fine light rain drifting down. Sparse thin streaks over transparency, for windows and wet stone.',
        params: { generator: 'particles', count: 65, dirX: 1, dirY: 4, speed: 1, speedSpread: 1,
                  length: 0.9, width: 0.9, taper: 0.7, brightJitter: 0.6 },
        material: null
    },
    rain_downpour: {
        label: 'Rain, downpour', icon: '🌧️', gradient: 'rain_storm',
        description: 'Heavy driving rain. Dense fast streaks with a strong slant. Turn Gusts up for rain that comes in waves.',
        params: { generator: 'particles', count: 190, dirX: 1, dirY: 3, speed: 1, speedSpread: 2,
                  length: 1.15, width: 1.2, taper: 0.55, brightJitter: 0.5,
                  gustCycles: 2, gustDepth: 0.35 },
        material: null
    },
    rain_window: {
        label: 'Rain on glass', icon: '🪟', gradient: 'rain_clear',
        description: 'Slow heavy drops creeping down a pane, with a few running fast. Made to lay over a window texture.',
        params: { generator: 'particles', count: 70, dirX: 0, dirY: 1, speed: 1, speedSpread: 3,
                  length: 2.4, width: 2.0, taper: 0.8, brightJitter: 0.7 },
        material: null
    },
    snow_fall: {
        label: 'Snow', icon: '❄️', gradient: 'snow_white',
        description: 'Flakes drifting down and swaying sideways as they fall. Round, not streaked.',
        params: { generator: 'particles', count: 190, dirX: 0, dirY: 1, speed: 1, speedSpread: 2,
                  length: 0, width: 2.0, taper: 0, brightJitter: 0.55,
                  sway: 0.05, swayCycles: 2 },
        material: null
    },
    ash_fall: {
        label: 'Ash / Cinders', icon: '🌋', gradient: 'ash_grey',
        description: 'Fine ash settling through the air, slower and dirtier than snow. Ruined cities, volcano levels.',
        params: { generator: 'particles', count: 170, dirX: 1, dirY: 4, speed: 1, speedSpread: 1,
                  length: 0.35, width: 1.5, taper: 0.4, brightJitter: 0.7,
                  sway: 0.035, swayCycles: 3 },
        material: null
    },
    sparks_rising: {
        label: 'Sparks', icon: '✨', gradient: 'spark_hot',
        description: 'Embers climbing off a fire and fading out. Rises rather than falls. Glows.',
        params: { generator: 'particles', count: 85, dirX: 0, dirY: -1, speed: 2, speedSpread: 3,
                  length: 0.9, width: 1.2, taper: 0.85, brightJitter: 0.75,
                  sway: 0.045, swayCycles: 2 },
        material: null, emissive: true
    },
    /* Round three (2026-09-24). A NEW preset rather than a retune of
       sparks_rising, by the author's decision: additive, so every tile made
       with Sparks stays what it was. Slower and shorter than Sparks so each
       flash reads as a point of light rather than a streak blinking. Flashes 2
       gives each spark 2-3 flashes per loop, inside the N/2 strobe limit at the
       default 16 frames. */
    sparks_twinkle: {
        label: 'Sparks, twinkling', icon: '🎇', gradient: 'spark_hot',
        description: 'Sparks drifting up and flickering on and off, each on its own beat. Glitter off a forge or a magic effect. Glows.',
        params: { generator: 'particles', count: 110, dirX: 0, dirY: -1, speed: 1, speedSpread: 3,
                  length: 0.5, width: 1.3, taper: 0.7, brightJitter: 0.5,
                  sway: 0.04, swayCycles: 2, twinkle: 0.85, twinkleCycles: 2 },
        material: null, emissive: true
    },
    bubbles_rising: {
        label: 'Bubbles', icon: '🫧', gradient: 'bubble_pale',
        description: 'Bubbles wobbling up through water. Round and slow, for underwater walls and vents.',
        params: { generator: 'particles', count: 70, dirX: 0, dirY: -1, speed: 1, speedSpread: 2,
                  length: 0, width: 3.4, taper: 0, brightJitter: 0.4,
                  sway: 0.04, swayCycles: 3 },
        material: null
    },
    drips_wall: {
        label: 'Drips', icon: '💧', gradient: 'rain_clear',
        description: 'Occasional drops running down a wet wall. Very sparse, slow, long trails.',
        params: { generator: 'particles', count: 35, dirX: 0, dirY: 1, speed: 1, speedSpread: 2,
                  length: 3.2, width: 1.5, taper: 0.9, brightJitter: 0.6 },
        material: null
    },

    /* ---- Batch E: DEPTH (2026-09-23) ----------------------------------
       Three presets for 256 px and up, which is where "the particles all look
       the same" was reported from. They are the only ones that set depthScale
       and defocus; the eight above are deliberately untouched, because the
       classic-resolution builders they were tuned for are happy with them and a
       retune would move every tile already made with one.

       All three lean on Depth spread, which sorts particles into that many
       speed bands: the band is also the size, the brightness and the blur, so
       one control buys the whole parallax. ------------------------------- */
    rain_glass: {
        label: 'Rain on glass (deep)', icon: '🌧️', gradient: 'rain_clear',
        description: 'Beads holding on the pane while a few run, at four depths, the far ones out of focus. For 256px and up, over a window or a wall.',
        params: { generator: 'particles', count: 150, dirX: 0, dirY: 1, speed: 0, speedSpread: 3,
                  length: 1.6, width: 4.5, taper: 0.5, brightJitter: 0.8,
                  depthScale: 0.8, defocus: 5 },
        material: null
    },
    rain_soft: {
        label: 'Rain, soft slant', icon: '🌦️', gradient: 'rain_clear',
        description: 'A slanting sheet with real depth: near drops sharp and bright, far ones small and blurred. The photographic one.',
        /* (1,3) not (1,4), spread 3 not 4, length 0.95 not 1.3: the first
           attempt was 1.03 tiles per FRAME and the advisory caught it, exactly
           as it caught ash_fall when the particle presets first shipped. The
           depth bands cost one plane and the slant is barely shallower. */
        params: { generator: 'particles', count: 150, dirX: 1, dirY: 3, speed: 1, speedSpread: 3,
                  length: 0.95, width: 2.6, taper: 0.6, brightJitter: 0.7,
                  depthScale: 0.75, defocus: 6 },
        material: null
    },
    snow_deep: {
        label: 'Snow, deep', icon: '🌨️', gradient: 'snow_white',
        description: 'Flakes at four distances, swaying, the far ones soft and dim. Reads as weather rather than as dots.',
        params: { generator: 'particles', count: 170, dirX: 0, dirY: 1, speed: 1, speedSpread: 4,
                  length: 0.25, width: 3.4, taper: 0.2, brightJitter: 0.5,
                  sway: 0.06, swayCycles: 2, depthScale: 0.85, defocus: 7 },
        material: null
    },

    /* ---- Batch F: GLITCH (2026-09-24) --------------------------------
       The noise field plus the glitch stage (js/animglitch.js), selected by a
       `glitch` object. Hard blocks, torn rows and split channels on a torus, so
       the tile still repeats. The second one sets noiseMix 0, so it has no
       Perlin in it at all: a collage of flat, striped and graded blocks. ---- */
    glitch_corrupt: {
        label: 'Glitch / Corrupted', icon: '📼', gradient: 'glitch_neon',
        description: 'Corrupted signal: blocks torn out and dragged across the frame, colour channels split, scanlines. Bursts of damage between calmer frames. Still tiles.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 5, gain: 0.5, warp: 0.6, contrast: 1.4,
                  glitch: { amount: 0.5, blocks: 6, bursts: 4, calm: 0.25, split: 0.02, tear: 0.5, scan: 0.35, noiseMix: 0.75 } },
        material: null, emissive: true
    },
    glitch_collage: {
        label: 'Glitch Collage', icon: '🧩', gradient: 'glitch_vhs',
        description: 'A cut-up collage of flat, striped and graded blocks that reshuffles every burst. No noise underneath. Datamosh walls, broken screens.',
        params: { style: 0, spatialPeriod: 4, timePeriod: 1, octaves: 4, gain: 0.5, warp: 0, contrast: 1,
                  glitch: { amount: 0.7, blocks: 5, bursts: 8, calm: 0.1, split: 0.012, tear: 0.3, scan: 0, noiseMix: 0 } },
        material: null, emissive: true
    },

    /* ---- Batch G: CAUSTICS (WATER-CAUSTICS-PLAN phase 5c, 2026-10-03) ----
       The third generator (js/animcaustics.js), REFRACTION model: light through
       a moving wave surface, landing on the floor. On BLACK, for faces laid
       with Additive blending. Pool Floor is tuned against the classic reference
       collage on six measures (§2, phase 5c's table); the rest are variations.
       The Cells model stays reachable through the modal's Model select. */
    caustic_pool: {
        label: 'Pool Floor', icon: '✨', gradient: 'caustic_teal',
        description: 'Light through a gently moving pool surface, landing on the floor: soft curved lines, brighter where they focus. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.03, waveMax: 7, black: 0.1, toneGain: 0.6, exposure: 0.65 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    caustic_sea: {
        label: 'Sea Bed', icon: '🐚', gradient: 'caustic_aqua',
        description: 'Big, slow swells over a sandy sea bed: wide soft cells in blue-green light. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.04, waveMax: 4, blur: 0.004, black: 0.1, toneGain: 0.6, exposure: 0.65 },
        material: { type: 'liquid', key: 'ocean_deep' }
    },
    caustic_shallows: {
        label: 'Sunlit Shallows', icon: '☀️', gradient: 'caustic_sun',
        description: 'Strong sun through shallow water: sharp, folded lines of warm light. The brightest of the set. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.06, waveMax: 6, waveSpeed: 2, black: 0.15, toneGain: 0.7, exposure: 0.75 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    caustic_wall: {
        label: 'Wall Reflection', icon: '🧱', gradient: 'caustic_aqua',
        description: 'Light thrown up onto a wall beside water: long, soft horizontal bands drifting with the wind. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.03, waveMax: 6, stretch: -3, windX: 1, windY: 0, wind: 0.6,
                  blur: 0.005, waveSpeed: 2, black: 0.1, toneGain: 0.7, exposure: 0.7 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    caustic_calm: {
        label: 'Calm Surface', icon: '🪷', gradient: 'caustic_teal',
        description: 'A still surface with a slow, faint swell: broad patches of light rather than lines. For water seen from above. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.025, waveMax: 4, slope: 4, blur: 0.004, black: 0.05, toneGain: 0.8, exposure: 0.8 },
        material: { type: 'liquid', key: 'pool_water' }
    },
    caustic_choppy: {
        label: 'Choppy Surface', icon: '🌬️', gradient: 'caustic_teal',
        description: 'Wind-driven, fast water: a busy network of small cells with fine ripples on top. Made for Additive blending.',
        params: { generator: 'caustics', model: 'refraction', depth: 0.035, waveMax: 8, slope: 1.5, waveSpeed: 3, windX: 1, windY: 1, wind: 0.4,
                  black: 0.1, toneGain: 0.7, exposure: 0.7 },
        material: { type: 'liquid', key: 'pool_water' }
    },

    aurora_sky: {
        label: 'Aurora Sky', icon: '🌌', gradient: 'aurora',
        description: 'Slow shimmering curtains of aurora light drifting across the sky — ceilings, skyboxes and magical vistas. Glows.',
        params: { style: 0, spatialPeriod: 3, timePeriod: 2, octaves: 5, gain: 0.55, warp: 1.3, contrast: 1.15, flowX: 1, stretch: 3 },
        material: null, emissive: true
    }
};

/* Display order for the preset picker. */
TRLE.AnimPresetOrder = [
    'caustic_water', 'deep_water', 'murky_swamp', 'oil_slick',
    'lava', 'molten_metal', 'toxic_sludge',
    'clouds', 'smoke', 'dust', 'magic_energy', 'portal',
    'fire', 'waterfall', 'river_current', 'rising_smoke', 'blowing_sand', 'lava_flow',
    'blood_pool', 'frozen_ice', 'quicksilver', 'boiling_water', 'whirlpool', 'honey_flow',
    'steam', 'poison_gas', 'electric_plasma', 'aurora_sky',
    'rain_drizzle', 'rain_downpour', 'rain_window', 'snow_fall', 'ash_fall',
    'sparks_rising', 'sparks_twinkle', 'bubbles_rising', 'drips_wall',
    'rain_glass', 'rain_soft', 'snow_deep',
    'caustic_pool', 'caustic_sea', 'caustic_shallows', 'caustic_wall', 'caustic_calm', 'caustic_choppy',
    'glitch_corrupt', 'glitch_collage'
];

/* Merge a preset's params with overrides (size/frames/seed/style/…) into a bag
   ready for TRLE.AnimGen.generateFrames(). If no palette override is supplied,
   the preset's default gradient is resolved into stops. Overrides may pass a
   `palette` (already-normalised {pos,color} stops from the Colour tab) and a
   `colorAdjust` object — both flow straight through to the ramp builder. */
TRLE.AnimPresets_resolve = function (key, overrides) {
    const p = TRLE.AnimPresets[key];
    if (!p) throw new Error('Unknown anim preset: ' + key);
    const params = Object.assign({}, p.params, overrides || {});
    if (!params.palette) {
        params.palette = TRLE.AnimGradients_stops(p.gradient);
    } else if (Array.isArray(params.palette[0])) {
        // compact [pos,color] pairs → {pos,color}
        params.palette = params.palette.map(s => ({ pos: s[0], color: s[1] }));
    }
    return params;
};

/* The default gradient name for a preset (for the Colour tab's picker). */
TRLE.AnimPresets_gradient = function (key) {
    const p = TRLE.AnimPresets[key];
    return p ? p.gradient : 'mono_grey';
};
