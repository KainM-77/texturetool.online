/* SPDX-License-Identifier: GPL-3.0-only
   TextureTool — Copyright (C) 2026 KainM-77. Licensed under GPL-3.0. See LICENSE. */
/* ============================================================
   TRLE Atlas Tool — Animated Texture Gradient Library
   Named colour gradients, decoupled from the noise presets, so
   structure (Tab 1) and colour (Tab 2) can be mixed and matched.
   Each noise preset references one of these as its default; the
   Colour tab can swap it, edit the stops, or tweak HSV on top.

   Stops are compact pairs: [pos 0..1, [r,g,b] | [r,g,b,a] (0-255)].
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.AnimGradients = {
    /* ---- defaults referenced by the built-in noise presets ---- */
    caustic_blue: { label: 'Caustic Blue', stops: [[0,[8,28,64]], [0.5,[24,84,150]], [0.82,[110,175,215]], [1,[235,248,255]]] },
    water_deep:   { label: 'Deep Water',   stops: [[0,[6,24,48]], [0.5,[16,60,104]], [0.85,[40,110,150]], [1,[120,175,200]]] },
    swamp_green:  { label: 'Swamp Green',  stops: [[0,[18,26,16]], [0.45,[40,54,30]], [0.8,[70,84,48]], [1,[100,114,66]]] },
    oil_dark:     { label: 'Oil / Tar',    stops: [[0,[3,3,6]], [0.55,[12,12,20]], [0.85,[30,30,46]], [1,[78,70,92]]] },
    lava_hot:     { label: 'Lava',         stops: [[0,[20,4,2]], [0.4,[120,18,6]], [0.7,[220,70,10]], [0.9,[255,170,40]], [1,[255,240,170]]] },
    molten:       { label: 'Molten Metal', stops: [[0,[30,26,24]], [0.5,[120,70,40]], [0.8,[220,150,80]], [1,[255,240,210]]] },
    toxic_green:  { label: 'Toxic Green',  stops: [[0,[8,24,8]], [0.5,[40,110,30]], [0.8,[120,200,60]], [1,[200,255,150]]] },
    cloud_white:  { label: 'Clouds',       stops: [[0,[120,140,170]], [0.5,[185,200,220]], [0.82,[230,238,248]], [1,[255,255,255]]] },
    smoke_grey:   { label: 'Smoke',        stops: [[0,[40,40,44,0]], [0.45,[70,70,76,90]], [0.8,[120,120,128,205]], [1,[170,170,178,255]]] },
    dust_tan:     { label: 'Dust / Sand',  stops: [[0,[120,100,70,0]], [0.6,[150,130,95,80]], [1,[190,168,128,170]]] },
    magic_violet: { label: 'Magic Violet', stops: [[0,[20,4,40]], [0.4,[80,20,140]], [0.7,[150,60,230]], [0.9,[120,180,255]], [1,[230,240,255]]] },
    portal_cyan:  { label: 'Portal Cyan',  stops: [[0,[6,10,40]], [0.4,[30,60,160]], [0.7,[80,160,230]], [1,[210,250,255]]] },

    /* ---- extra library gradients (mix-and-match) ---- */
    ice_blue:   { label: 'Ice Blue',   stops: [[0,[150,190,220]], [0.5,[205,230,248]], [1,[245,252,255]]] },
    blood_red:  { label: 'Blood',      stops: [[0,[20,2,2]], [0.5,[110,10,8]], [0.8,[170,20,15]], [1,[210,60,50]]] },
    mercury:    { label: 'Mercury',    stops: [[0,[60,62,68]], [0.5,[140,145,155]], [0.8,[200,205,215]], [1,[245,248,255]]] },
    ember_fire: { label: 'Ember Fire', stops: [[0,[10,2,1]], [0.35,[90,15,4]], [0.6,[200,60,8]], [0.8,[255,150,30]], [1,[255,235,150]]] },
    aurora:     { label: 'Aurora',     stops: [[0,[5,10,30]], [0.4,[20,120,90]], [0.7,[60,200,150]], [0.9,[140,120,220]], [1,[220,240,255]]] },
    rainbow:    { label: 'Rainbow',    stops: [[0,[255,0,0]], [0.17,[255,200,0]], [0.34,[0,200,0]], [0.5,[0,200,200]], [0.67,[0,80,255]], [0.84,[160,0,255]], [1,[255,0,160]]] },
    sepia:      { label: 'Sepia',      stops: [[0,[30,20,10]], [0.5,[140,100,60]], [1,[245,225,190]]] },
    neon_pink:  { label: 'Neon Pink',  stops: [[0,[20,0,20]], [0.5,[200,20,160]], [1,[255,180,240]]] },
    mono_grey:  { label: 'Mono (B→W)', stops: [[0,[0,0,0]], [1,[255,255,255]]] }
};

/* Order for the gradient picker. */
TRLE.AnimGradientOrder = [
    'caustic_blue', 'water_deep', 'swamp_green', 'oil_dark', 'lava_hot', 'molten',
    'ember_fire', 'toxic_green', 'cloud_white', 'smoke_grey', 'dust_tan',
    'magic_violet', 'portal_cyan', 'ice_blue', 'blood_red', 'mercury',
    'aurora', 'rainbow', 'sepia', 'neon_pink', 'mono_grey'
];

/* Normalised stops ({pos,color}) for a gradient name (falls back to mono). */
TRLE.AnimGradients_stops = function (name) {
    const g = TRLE.AnimGradients[name] || TRLE.AnimGradients.mono_grey;
    return g.stops.map(s => ({ pos: s[0], color: s[1].slice() }));
};
