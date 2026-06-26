/* SPDX-License-Identifier: GPL-3.0-only
   TextureTool — Copyright (C) 2026 KainM-77. Licensed under GPL-3.0. See LICENSE. */
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
    }
};

/* Display order for the preset picker. */
TRLE.AnimPresetOrder = [
    'caustic_water', 'deep_water', 'murky_swamp', 'oil_slick',
    'lava', 'molten_metal', 'toxic_sludge',
    'clouds', 'smoke', 'dust', 'magic_energy', 'portal',
    'fire', 'waterfall', 'river_current', 'rising_smoke', 'blowing_sand', 'lava_flow'
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
