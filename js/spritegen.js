/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (c) 2026 KainM-77. Available under the MIT License
   (see LICENSE). */
/* ============================================================
   TRLE Atlas Tool — Sprite generator (TRLE.SpriteGen)

   Makes SPRITE SEQUENCES for WadTool: the frames Tomb Engine draws as
   billboards for fire, smoke, sparks, snow, twinkles and so on. Not atlas
   tiles: a sprite does not tile, it fades to nothing at its card edge.
   See AtlasTool/docs/SPRITE-PLAN.md for the engine facts this rests on.

   Three facts from that plan shape everything here:

   1. SLOTS ARE FIXED. A sequence replaces a stock slot (FIRE_SPRITES…) or
      fills CUSTOM_SPRITES for Lua. `SLOTS` carries each stock slot's
      measured frame count, size and pixel convention, so picking a slot
      reproduces what the engine expects; every value stays overridable.
   2. THE ENGINE COLOURS THE STOCK SLOTS. Pixel = texture x vertex colour,
      and the effect code picks the colour, so the stock sprites are
      greyscale on opaque black (FIRE: channel difference 0 over 36
      frames). `colour: 'grey'` with `background: 'black'` produces exactly
      that. Custom sprites may be any colour.
   3. MOST SEQUENCES PLAY ONCE OVER A PARTICLE'S LIFE. Frame 0 at birth,
      the last frame at death, never blended. So `sequence: 'lifetime'`
      ends on an empty frame; 'loop' and 'variants' are the other two ways
      the engine picks a frame.

   GUARANTEES, by construction:
   - Same params, same pixels. CPU float maths into ImageData, seeded rng.
   - The outer 2 px of every frame are exactly empty (black, or alpha 0),
     whatever the shape: an edge window in PIXELS, applied per pixel after
     supersampling. A billboard with a lit edge shows its square card.
   - A lifetime sequence with Fade out above 0 ends on an empty frame.

   Families, keyed by `generator`: 'shape' (phase 2: star, orb, ring,
   flare; CPU, analytic) and 'noise' (phase 3: fire, smoke, toxic, magic,
   dust; a density field from the `spriteNoise` shader, then the SAME
   CPU edge window and colour pass). Particle burst and streaks are later
   phases under the same params.
   ============================================================ */

window.TRLE = window.TRLE || {};

TRLE.SpriteGen = (function () {
    'use strict';

    const LIMITS = { MIN_SIZE: 8, MAX_SIZE: 1024, MIN_FRAMES: 1, MAX_FRAMES: 128, CLASSIC_MAX: 256, MAX_PARTICLES: 400 };

    /* The stock slots, as MEASURED from Tomb Editor's TombEngine.wad2
       (SPRITE-PLAN §1.2). `play` is how the engine picks a frame (§1.3).
       RAIN and FIREFLY are absent from the stock wad, so their sizes are
       our suggestion and say so. */
    const SLOTS = [
        /* A LOOP by default (author, 2026-09-28): the burning torch cycles these
           frames on a clock, and flame particles fade and shrink themselves at the
           end of their life (tomb4fx.cpp), so a loop serves both uses. The stock
           sequence is birth to death; Plays as switches to that. */
        { key: 'fire',      name: 'FIRE_SPRITES',      id: 1360, frames: 36, w: 171, h: 171, sequence: 'loop', background: 'black', stock: true, tint: '#ff8a2a',
          note: 'Flames. The burning torch cycles these frames as a loop, and flame particles fade and shrink on their own, so a loop works for both. Set Plays as to once over a life for a stock-style birth to death.' },
        { key: 'explosion', name: 'EXPLOSION_SPRITES', id: 1364, frames: 24, w: 48,  h: 48,  sequence: 'lifetime', background: 'black', stock: true, tint: '#ffc070',
          note: 'Explosions. Played once over each particle\'s life, fading to black at the end.' },
        { key: 'smoke',     name: 'SMOKE_SPRITES',     id: 1361, frames: 4,  w: 32,  h: 32,  sequence: 'lifetime', background: 'clear', stock: true, tint: '#a0a0a0',
          note: 'Smoke. Drawn with alpha blending, so it needs transparency rather than a black background. Played once over each puff\'s life.' },
        { key: 'snow',      name: 'SNOW_SPRITES',      id: 1386, frames: 5,  w: 64,  h: 64,  sequence: 'variants', background: 'black', stock: true, tint: '#ffffff',
          note: 'Snowflakes. Each flake picks ONE frame at random, so the frames are variants, not an animation.' },
        { key: 'rain',      name: 'RAIN_SPRITES',      id: 1387, frames: 4,  w: 16,  h: 64,  sequence: 'variants', background: 'black', stock: true, tint: '#c8dcff', suggested: true,
          note: 'Raindrops. Each drop picks one frame at random. Not in the stock wad (the engine falls back to DRIP_SPRITE), so this size is a suggestion.' },
        { key: 'spark',     name: 'SPARK_SPRITE',      id: 1362, frames: 1,  w: 9,   h: 36,  sequence: 'still',    background: 'clear', stock: true, tint: '#ffd060',
          note: 'Sparks. One image, stretched along the spark\'s direction of travel.' },
        { key: 'drip',      name: 'DRIP_SPRITE',       id: 1363, frames: 1,  w: 9,   h: 36,  sequence: 'still',    background: 'clear', stock: true, tint: '#b0d0ff',
          note: 'Drips. One image, stretched along the drip\'s direction of travel.' },
        { key: 'firefly',   name: 'FIREFLY_SPRITES',   id: 1379, frames: 1,  w: 32,  h: 32,  sequence: 'still',    background: 'black', stock: true, tint: '#c8ff60', suggested: true,
          note: 'Fireflies. Not in the stock wad, so this size is a suggestion.' },
        { key: 'custom',    name: 'CUSTOM_SPRITES',    id: 1356, frames: 16, w: 256, h: 256, sequence: 'loop',     background: 'clear', stock: false, tint: '#ffffff',
          note: 'Your own sequence, for Lua (EmitParticle / EmitAdvancedParticle, DisplaySprite). The engine does not colour it for you, so any colour works.' },
    ];
    const slotByKey = k => SLOTS.find(s => s.key === k) || SLOTS[SLOTS.length - 1];

    const SEQUENCES = ['lifetime', 'loop', 'variants', 'still'];
    const SHAPES = ['star', 'orb', 'ring', 'flare'];
    const GENERATORS = ['shape', 'noise', 'particles'];
    const BODIES = ['round', 'flame', 'column', 'cloud'];   // spriteNoise u_body 0..3

    const DEFAULTS = {
        generator: 'shape',
        slot: 'custom',
        width: 256, height: 256,
        frames: 16,
        sequence: 'loop',
        background: 'clear',     // 'black' = opaque black (Additive); 'clear' = alpha
        colour: 'gradient',      // 'grey' = the engine colours it; 'gradient' = baked colour
        gradient: 'spark_hot',
        seed: 1,
        crisp: null,             // null = auto (on at 64 px and below)
        blur: 0,                 // Gaussian sigma, % of the smaller card side; 0 = the unblurred path, byte for byte

        shape: 'star',
        size: 0.10,              // core radius (star, flare) / radius (orb, ring), card units
        glow: 0.6,
        glowSize: 0.35,
        brightness: 1,
        rotation: 0,             // degrees
        points: 4,
        spikeLength: 0.95,       // star spikes / flare streak, card units
        spikeWidth: 0.35,        // 0 = needle, 1 = broad lobe
        irregular: 0,            // 0 = even spikes; 1 = lengths vary a lot, per seed
        softness: 0.5,           // orb edge
        ringWidth: 0.08,
        cross: 0.3,              // flare: the vertical streak's strength

        // lifetime
        startScale: 0.35, endScale: 1, fadeIn: 0.1, fadeOut: 0.5, spin: 0,
        // loop
        pulse: 0.5, pulseCycles: 1,
        // variants
        jitter: 0.5,

        // noise body (phase 3). Unused by 'shape', so phase 2's pixels do not move.
        body: 'round',
        noiseStyle: 0,           // 0 fBm, 1 ridged, 2 billow
        noiseScale: 4,           // lattice cells across the card
        octaves: 5,
        roughness: 0.5,
        warp: 0.6,
        detail: 0.8,             // how much the noise shows inside the body
        contrast: 1.3,
        ragged: 0.5,             // how far the noise pushes the silhouette
        feather: 0.35,
        rise: 1,                 // lattice periods the pattern climbs over the sequence
        evolve: 1,               // time periods the pattern churns through (integer)
        erodeStart: 0,           // burn-away threshold at birth (and throughout a loop)
        erodeEnd: 0.6,           // ... at death
        erodeSoft: 0.2,

        // particle burst (phase 4). Unused by 'shape'/'noise', so their pixels
        // do not move. RADIAL and NON-WRAPPING throughout: a particle's path
        // runs outward from an origin and is clipped at the card edge, never
        // tiled back in (the field generator in js/animparticles.js is the
        // opposite: toroidal, for a texture that has to tile).
        count: 60,               // particles per burst
        burstAngle: 0,           // degrees, the cone's centre direction (0 = up)
        burstSpread: 1,          // 0 = a narrow jet; 1 = the full circle
        travel: 0.8,             // distance travelled at localAge 1, card half-widths
        travelSpread: 0.4,       // per-particle variance on travel, 0..1
        dotSize: 0.02,           // particle radius, card half-widths
        dotSizeSpread: 0.4,
        streak: 0,               // 0 = round dot; >0 = a comet tail, x travel
        offsetX: 0, offsetY: 0,  // burst origin, card half-widths from centre
        gravity: 0,              // pulls particles +Y (down) as they age; negative lifts them
        brightJitter: 0.5,
        spawnSpread: 0.15,       // lifetime: how staggered the particles' births are
        burstCycles: 2,          // loop: births per particle per loop (integer, keeps it closing)
    };

    /* Named starting points. A look sets the shape and its sliders and the
       motion values, never the size, frame count, background or colour, so it
       can be tried on any slot. The two FIRE looks also set Plays as, because
       each only reads right one way (Fire lick is a life, Fire loop a flicker). */
    const LOOKS = {
        twinkle:  { label: 'Twinkle star',  params: { generator: 'shape', shape: 'star', points: 4, size: 0.08, glow: 0.5, glowSize: 0.3, spikeLength: 0.95, spikeWidth: 0.3, irregular: 0, rotation: 0, pulse: 0.7, pulseCycles: 1, startScale: 0.2, endScale: 1, fadeIn: 0.25, fadeOut: 0.6, spin: 0 } },
        sparkle:  { label: 'Sparkle burst', params: { generator: 'shape', shape: 'star', points: 8, size: 0.07, glow: 0.45, glowSize: 0.25, spikeLength: 0.85, spikeWidth: 0.45, irregular: 0.55, rotation: 0, pulse: 0.5, pulseCycles: 2, startScale: 0.3, endScale: 1.1, fadeIn: 0.1, fadeOut: 0.6, spin: 0 } },
        flare:    { label: 'Lens flare',    params: { generator: 'shape', shape: 'flare', size: 0.07, glow: 0.7, glowSize: 0.25, spikeLength: 1, spikeWidth: 0.2, cross: 0.25, rotation: 0, pulse: 0.3, pulseCycles: 1, startScale: 0.5, endScale: 1, fadeIn: 0.15, fadeOut: 0.5, spin: 0 } },
        orb:      { label: 'Soft orb',      params: { generator: 'shape', shape: 'orb', size: 0.3, softness: 0.8, glow: 0.6, glowSize: 0.5, pulse: 0.4, pulseCycles: 1, startScale: 0.3, endScale: 1, fadeIn: 0.2, fadeOut: 0.6, spin: 0 } },
        pulse:    { label: 'Magic pulse ring', params: { generator: 'shape', shape: 'ring', size: 0.5, ringWidth: 0.06, glow: 0.5, glowSize: 0.1, pulse: 0.6, pulseCycles: 1, startScale: 0.2, endScale: 1.1, fadeIn: 0.05, fadeOut: 0.7, spin: 0 } },
        ember:    { label: 'Ember dot',     params: { generator: 'shape', shape: 'orb', size: 0.45, softness: 1, glow: 0.2, glowSize: 0.6, pulse: 0.5, pulseCycles: 2, startScale: 1, endScale: 0.6, fadeIn: 0.1, fadeOut: 0.8, spin: 0 } },
    };

    /* Noise-body looks (phase 3). Same rule: shape and motion, never slot fields.
       Tuned SOFT after the author's verdict that the first set felt "too HD-y"
       next to classic flames (phase 3b): 3 octaves, a light Blur, soft burn-away,
       bodies kept inside the card (a body that reaches the edge guard shows a
       square outline). Blur 0 and more octaves get the detailed look back. */
    Object.assign(LOOKS, {
        fire:   { label: 'Fire lick',    params: { sequence: 'lifetime', generator: 'noise', body: 'flame', noiseStyle: 0, noiseScale: 3, octaves: 3, roughness: 0.5, warp: 0.8, detail: 0.8, contrast: 1.5, ragged: 0.7, feather: 0.5, rise: 2, evolve: 2, erodeStart: 0.02, erodeEnd: 0.5, erodeSoft: 0.3, brightness: 1.15, blur: 1.3, startScale: 0.7, endScale: 1.4, fadeIn: 0.08, fadeOut: 0.35, pulse: 0.2, pulseCycles: 1, jitter: 0.4 } },
        fireloop: { label: 'Fire loop',  params: { sequence: 'loop', generator: 'noise', body: 'flame', noiseStyle: 0, noiseScale: 3, octaves: 3, roughness: 0.5, warp: 0.8, detail: 0.8, contrast: 1.5, ragged: 0.7, feather: 0.5, rise: 3, evolve: 3, erodeStart: 0.15, erodeEnd: 0.5, erodeSoft: 0.3, brightness: 1.15, blur: 1.3, startScale: 0.7, endScale: 1.4, fadeIn: 0.08, fadeOut: 0.35, pulse: 0.1, pulseCycles: 1, jitter: 0.4 } },
        smoke:  { label: 'Smoke puff',   params: { generator: 'noise', body: 'round', noiseStyle: 2, noiseScale: 3, octaves: 3, roughness: 0.55, warp: 1.0, detail: 0.7, contrast: 1.1, ragged: 0.6, feather: 0.6, rise: 1, evolve: 1, erodeStart: 0, erodeEnd: 0.45, erodeSoft: 0.4, brightness: 1, blur: 1.5, startScale: 0.35, endScale: 1.15, fadeIn: 0.15, fadeOut: 0.6, pulse: 0.2, pulseCycles: 1, jitter: 0.5 } },
        toxic:  { label: 'Toxic cloud',  params: { generator: 'noise', body: 'cloud', noiseStyle: 2, noiseScale: 3, octaves: 3, roughness: 0.55, warp: 1.3, detail: 0.65, contrast: 1.2, ragged: 0.5, feather: 0.55, rise: 0, evolve: 1, erodeStart: 0.05, erodeEnd: 0.4, erodeSoft: 0.4, brightness: 1, blur: 1.5, startScale: 0.45, endScale: 1.15, fadeIn: 0.2, fadeOut: 0.5, pulse: 0.3, pulseCycles: 1, jitter: 0.5 } },
        magic:  { label: 'Magic swirl',  params: { generator: 'noise', body: 'round', noiseStyle: 1, noiseScale: 4, octaves: 3, roughness: 0.55, warp: 1.6, detail: 0.9, contrast: 1.8, ragged: 0.4, feather: 0.4, rise: 0, evolve: 2, erodeStart: 0.12, erodeEnd: 0.5, erodeSoft: 0.25, brightness: 0.9, blur: 0.8, startScale: 0.35, endScale: 1.1, fadeIn: 0.1, fadeOut: 0.5, pulse: 0.4, pulseCycles: 2, jitter: 0.5 } },
        dust:   { label: 'Dust puff',    params: { generator: 'noise', body: 'cloud', noiseStyle: 0, noiseScale: 4, octaves: 3, roughness: 0.55, warp: 0.5, detail: 0.6, contrast: 1.0, ragged: 0.7, feather: 0.7, rise: 0, evolve: 1, erodeStart: 0, erodeEnd: 0.55, erodeSoft: 0.5, brightness: 0.9, blur: 1.8, startScale: 0.45, endScale: 1.2, fadeIn: 0.1, fadeOut: 0.7, pulse: 0.2, pulseCycles: 1, jitter: 0.5 } },
        plume:  { label: 'Steam plume',  params: { generator: 'noise', body: 'column', noiseStyle: 2, noiseScale: 3, octaves: 3, roughness: 0.5, warp: 1.1, detail: 0.6, contrast: 1.1, ragged: 0.7, feather: 0.6, rise: 2, evolve: 1, erodeStart: 0, erodeEnd: 0.45, erodeSoft: 0.45, brightness: 1, blur: 1.5, startScale: 0.55, endScale: 1.1, fadeIn: 0.15, fadeOut: 0.5, pulse: 0.2, pulseCycles: 1, jitter: 0.4 } },
    });

    /* Particle-burst looks (phase 4): sparks, embers, motes, twinkle clusters,
       the four families SPRITE-PLAN §5 names. Same rule as the other families:
       motion and shape only, never the slot fields. */
    Object.assign(LOOKS, {
        spark_burst:     { label: 'Spark burst',     params: { generator: 'particles', sequence: 'lifetime', count: 70, burstAngle: 0, burstSpread: 1, travel: 0.85, travelSpread: 0.5, dotSize: 0.012, dotSizeSpread: 0.5, streak: 0.7, offsetX: 0, offsetY: 0, gravity: 0.5, brightJitter: 0.5, spawnSpread: 0.12, brightness: 1.3, fadeIn: 0.02, fadeOut: 0.55, blur: 0 } },
        embers:          { label: 'Embers',          params: { generator: 'particles', sequence: 'loop', count: 26, burstAngle: 0, burstSpread: 0.35, travel: 0.9, travelSpread: 0.3, dotSize: 0.035, dotSizeSpread: 0.4, streak: 0, offsetX: 0, offsetY: -0.25, gravity: -0.5, brightJitter: 0.5, burstCycles: 2, brightness: 1.4, pulse: 0, blur: 0.6 } },
        dust_motes:      { label: 'Dust motes',      params: { generator: 'particles', sequence: 'loop', count: 45, burstAngle: 0, burstSpread: 1, travel: 0.3, travelSpread: 0.6, dotSize: 0.035, dotSizeSpread: 0.6, streak: 0, offsetX: 0, offsetY: 0, gravity: 0.08, brightJitter: 0.7, burstCycles: 1, brightness: 1.1, pulse: 0, blur: 0.3 } },
        twinkle_cluster: { label: 'Twinkle cluster', params: { generator: 'particles', sequence: 'loop', count: 90, burstAngle: 0, burstSpread: 1, travel: 0.15, travelSpread: 0.3, dotSize: 0.02, dotSizeSpread: 0.5, streak: 0, offsetX: 0, offsetY: 0, gravity: 0, brightJitter: 0.8, burstCycles: 3, brightness: 1.5, pulse: 0, blur: 0.5 } },
    });

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

    /* Sanitise any params object (a slider bag, a loaded file) into a complete,
       clamped one. The file loader goes through this, so a hand-edited or
       future-version file cannot push a value out of range. */
    function normalise(p) {
        const q = Object.assign({}, DEFAULTS, p || {});
        q.width = Math.round(clamp(num(+q.width, 256), LIMITS.MIN_SIZE, LIMITS.MAX_SIZE));
        q.height = Math.round(clamp(num(+q.height, 256), LIMITS.MIN_SIZE, LIMITS.MAX_SIZE));
        if (!SEQUENCES.includes(q.sequence)) q.sequence = DEFAULTS.sequence;
        q.frames = q.sequence === 'still' ? 1
            : Math.round(clamp(num(+q.frames, 16), LIMITS.MIN_FRAMES, LIMITS.MAX_FRAMES));
        if (q.background !== 'black') q.background = 'clear';
        if (q.colour !== 'grey') q.colour = 'gradient';
        if (!SHAPES.includes(q.shape)) q.shape = 'star';
        if (!GENERATORS.includes(q.generator)) q.generator = 'shape';
        if (!BODIES.includes(q.body)) q.body = 'round';
        q.noiseStyle = Math.round(clamp(num(+q.noiseStyle, 0), 0, 2));
        q.noiseScale = Math.round(clamp(num(+q.noiseScale, 4), 1, 16));
        q.octaves = Math.round(clamp(num(+q.octaves, 5), 1, 8));
        q.evolve = Math.round(clamp(num(+q.evolve, 1), 1, 6));
        q.roughness = clamp(num(+q.roughness, 0.5), 0.2, 0.85);
        q.warp = clamp(num(+q.warp, 0.6), 0, 3);
        q.contrast = clamp(num(+q.contrast, 1.3), 0.3, 4);
        q.feather = clamp(num(+q.feather, 0.35), 0.02, 1);
        q.erodeSoft = clamp(num(+q.erodeSoft, 0.2), 0.005, 1);
        for (const k of ['detail', 'ragged', 'erodeStart', 'erodeEnd']) q[k] = clamp(num(+q[k], DEFAULTS[k]), 0, 1);
        // A loop only closes on whole lattice periods of climb.
        q.rise = q.sequence === 'loop' ? Math.round(clamp(num(+q.rise, 1), -4, 4)) : clamp(num(+q.rise, 1), -4, 4);
        if (!SLOTS.some(s => s.key === q.slot)) q.slot = 'custom';
        q.seed = Math.round(num(+q.seed, 1)) >>> 0;
        q.points = Math.round(clamp(num(+q.points, 4), 2, 16));
        q.pulseCycles = Math.round(clamp(num(+q.pulseCycles, 1), 1, 8));
        // A loop only closes on whole turns.
        q.spin = q.sequence === 'loop' ? Math.round(num(+q.spin, 0)) : num(+q.spin, 0);
        for (const k of ['size', 'glowSize', 'spikeLength', 'ringWidth']) q[k] = clamp(num(+q[k], DEFAULTS[k]), 0.005, 1.5);
        for (const k of ['spikeWidth', 'irregular', 'softness', 'cross', 'fadeIn', 'fadeOut', 'pulse', 'jitter'])
            q[k] = clamp(num(+q[k], DEFAULTS[k]), 0, 1);
        q.glow = clamp(num(+q.glow, DEFAULTS.glow), 0, 3);
        q.brightness = clamp(num(+q.brightness, 1), 0, 4);
        q.startScale = clamp(num(+q.startScale, DEFAULTS.startScale), 0.02, 2);
        q.endScale = clamp(num(+q.endScale, DEFAULTS.endScale), 0.02, 2);
        q.rotation = num(+q.rotation, 0);
        q.blur = clamp(num(+q.blur, 0), 0, 20);
        q.count = Math.round(clamp(num(+q.count, 60), 0, LIMITS.MAX_PARTICLES));
        q.burstAngle = num(+q.burstAngle, 0);
        q.burstSpread = clamp(num(+q.burstSpread, 1), 0.005, 1);
        q.travel = clamp(num(+q.travel, 0.8), 0, 2);
        q.travelSpread = clamp(num(+q.travelSpread, 0.4), 0, 1);
        q.dotSize = clamp(num(+q.dotSize, 0.02), 0.002, 0.3);
        q.dotSizeSpread = clamp(num(+q.dotSizeSpread, 0.4), 0, 1);
        q.streak = clamp(num(+q.streak, 0), 0, 3);
        q.offsetX = clamp(num(+q.offsetX, 0), -1.5, 1.5);
        q.offsetY = clamp(num(+q.offsetY, 0), -1.5, 1.5);
        q.gravity = clamp(num(+q.gravity, 0), -1, 1);
        q.brightJitter = clamp(num(+q.brightJitter, 0.5), 0, 1);
        q.spawnSpread = clamp(num(+q.spawnSpread, 0.15), 0, 0.9);
        q.burstCycles = Math.round(clamp(num(+q.burstCycles, 2), 1, 8));
        if (q.crisp !== true && q.crisp !== false) q.crisp = null;
        return q;
    }

    /* The settings a slot implies. Only the slot-shaped fields: the shape and
       its sliders are left as they are, so switching slot keeps the look. */
    function slotParams(key) {
        const s = slotByKey(key);
        return {
            slot: s.key, width: s.w, height: s.h, frames: s.frames, sequence: s.sequence,
            background: s.background, colour: s.stock ? 'grey' : 'gradient',
        };
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* How frame i of N looks: its scale, brightness, rotation and spike seed.
       This is where the three engine playback modes differ (SPRITE-PLAN §1.3). */
    function frameState(p, i, N) {
        const st = { scale: 1, intensity: 1, rot: p.rotation, spikeSeed: p.seed, age: 0, loop: false };
        if (p.sequence === 'lifetime' && N > 1) {
            const a = i / (N - 1);
            const e = 1 - (1 - a) * (1 - a);                      // ease out: grows fast, settles
            st.scale = p.startScale + (p.endScale - p.startScale) * e;
            // Fades counted in FRAMES, so frame 0 is never blank (a birth, not
            // nothing) and the last frame is exactly empty whenever Fade out > 0.
            const nIn = Math.max(1, Math.round(p.fadeIn * N));
            const nOut = Math.round(p.fadeOut * N);
            const fin = Math.min(1, (i + 1) / nIn);
            const fout = nOut > 0 ? Math.min(1, (N - 1 - i) / nOut) : 1;
            st.intensity = fin * fout;
            st.rot = p.rotation + 360 * p.spin * a;
            st.age = a;
        } else if (p.sequence === 'loop' && N > 1) {
            const a = i / N;                                       // frame N would be frame 0
            const tw = 0.5 - 0.5 * Math.cos(2 * Math.PI * p.pulseCycles * a);
            st.intensity = 1 - p.pulse * tw;
            st.scale = 1 - 0.35 * p.pulse * tw;
            st.rot = p.rotation + 360 * p.spin * a;
            st.age = a; st.loop = true;
        } else if (p.sequence === 'variants') {
            const r = mulberry32((p.seed * 7919 + i * 104729) | 0);
            st.rot = p.rotation + p.jitter * 360 * r();
            st.scale = 1 - p.jitter * 0.4 * r();
            st.intensity = 1 - p.jitter * 0.25 * r();
            st.spikeSeed = (p.seed + (i + 1) * 7919) | 0;
        }
        return st;
    }

    /* Per-spike length multipliers for `irregular`, one per spike, per seed. */
    function spikeLengths(p, seed) {
        const r = mulberry32(seed | 0);
        const out = new Float32Array(p.points);
        for (let k = 0; k < p.points; k++) out[k] = 1 - p.irregular * 0.85 * r();
        return out;
    }

    /* The shape's value at card position (x, y) in [-1,1]², y up, already
       rotated and divided by the frame's scale. Unbounded above; clamped later. */
    function shapeValue(p, x, y, lens, spikeExp) {
        const r = Math.sqrt(x * x + y * y);
        const glowR = p.glowSize;
        switch (p.shape) {
            case 'orb': {
                const R = p.size, inner = R * (1 - p.softness) - 1e-4;
                const t = clamp((r - inner) / (R - inner), 0, 1);
                const disc = 1 - t * t * (3 - 2 * t);
                return disc + p.glow * Math.exp(-(r / glowR) * (r / glowR));
            }
            case 'ring': {
                const d = (r - p.size) / p.ringWidth;
                const ring = Math.exp(-d * d);
                const h = (r - p.size) / (p.ringWidth + glowR);
                return ring + p.glow * 0.6 * Math.exp(-h * h);
            }
            case 'flare': {
                const thin = 0.004 + 0.08 * p.spikeWidth;
                const len = p.spikeLength;
                const streak = (u, v) => {
                    const t = 1 - Math.abs(u) / len;
                    if (t <= 0) return 0;
                    const q = v / (thin * (0.4 + 0.6 * t));        // tapers toward the tips
                    return Math.exp(-q * q) * Math.pow(t, 1.5);
                };
                const core = Math.exp(-(r / p.size) * (r / p.size));
                return streak(x, y) + p.cross * streak(y, x) + core + p.glow * Math.exp(-(r / glowR) * (r / glowR));
            }
            default: {   // star
                const n = p.points;
                const phi = Math.atan2(y, x);
                // |cos(n·φ/2)| has exactly n lobes round the circle, for odd n too.
                const lobe = Math.abs(Math.cos(n * phi / 2));
                const k = ((Math.round(phi * n / (2 * Math.PI)) % n) + n) % n;
                const t = 1 - r / (p.spikeLength * lens[k]);
                const spikes = t > 0 ? Math.pow(lobe, spikeExp * (1 + 3 * r)) * t * t : 0;
                const core = Math.exp(-(r / p.size) * (r / p.size));
                return spikes + core + p.glow * Math.exp(-(r / glowR) * (r / glowR));
            }
        }
    }

    /* 256-entry colour lookup over the shape value. 'grey' is plain white, so
       over black it IS the value and every channel is equal (the stock
       convention); a gradient comes from TRLE.AnimGradients, read at call time. */
    function colourLUT(p) {
        const lut = new Uint8ClampedArray(256 * 4);
        let stops = null;
        if (p.colour === 'gradient' && TRLE.AnimGradients && TRLE.AnimGradients[p.gradient]) {
            stops = TRLE.AnimGradients_stops(p.gradient);
        }
        for (let i = 0; i < 256; i++) {
            let c = [255, 255, 255, 255];
            if (stops && stops.length) {
                const v = i / 255;
                let a = stops[0], b = stops[stops.length - 1];
                for (let s = 0; s < stops.length - 1; s++) {
                    if (v >= stops[s].pos && v <= stops[s + 1].pos) { a = stops[s]; b = stops[s + 1]; break; }
                }
                const span = b.pos - a.pos, f = span > 0 ? clamp((v - a.pos) / span, 0, 1) : 0;
                c = [0, 1, 2, 3].map(ch => {
                    const ca = ch < 3 ? a.color[ch] : (a.color[3] == null ? 255 : a.color[3]);
                    const cb = ch < 3 ? b.color[ch] : (b.color[3] == null ? 255 : b.color[3]);
                    return ca + (cb - ca) * f;
                });
            }
            lut.set(c, i * 4);
        }
        return lut;
    }

    function ssFor(p) {
        const crisp = p.crisp == null ? Math.min(p.width, p.height) <= 64 : p.crisp;
        if (!crisp) return 1;
        return Math.min(p.width, p.height) <= 64 ? 4 : 2;
    }

    /* One frame as ImageData-shaped bytes (RGBA, not premultiplied). */
    function renderFrame(p, i, N, lut) {
        const W = p.width, H = p.height;
        const st = frameState(p, i, N);
        const lens = spikeLengths(p, st.spikeSeed);
        const spikeExp = 2 + 400 * Math.pow(1 - p.spikeWidth, 3);
        const th = -st.rot * Math.PI / 180, ct = Math.cos(th), sn = Math.sin(th);
        const inv = 1 / Math.max(1e-3, st.scale);
        const gain = p.brightness * st.intensity;
        const ss = ssFor(p);
        const fadePx = Math.max(2, Math.round(0.06 * Math.min(W, H)));
        const out = new Uint8ClampedArray(W * H * 4);
        if (p.blur > 0) {
            // Blurred: the whole field first (the rim feeds the blur), then the
            // blur, then the edge window, so the 2 px guarantee still holds.
            const field = new Float64Array(W * H);
            if (gain > 0) for (let j = 0; j < H; j++) for (let i2 = 0; i2 < W; i2++) {
                let acc = 0;
                for (let sy = 0; sy < ss; sy++) {
                    const y0 = 1 - 2 * (j + (sy + 0.5) / ss) / H;
                    for (let sx = 0; sx < ss; sx++) {
                        const x0 = 2 * (i2 + (sx + 0.5) / ss) / W - 1;
                        const x = (x0 * ct - y0 * sn) * inv, y = (x0 * sn + y0 * ct) * inv;
                        acc += Math.min(1, gain * shapeValue(p, x, y, lens, spikeExp));
                    }
                }
                field[j * W + i2] = acc / (ss * ss);
            }
            return finishField(p, field, lut);
        }
        for (let j = 0; j < H; j++) {
            for (let i2 = 0; i2 < W; i2++) {
                const w = edgeWindow(i2, j, W, H, fadePx);
                let v = 0;
                if (w > 0 && gain > 0) {
                    let acc = 0;
                    for (let sy = 0; sy < ss; sy++) {
                        const y0 = 1 - 2 * (j + (sy + 0.5) / ss) / H;
                        for (let sx = 0; sx < ss; sx++) {
                            const x0 = 2 * (i2 + (sx + 0.5) / ss) / W - 1;
                            const x = (x0 * ct - y0 * sn) * inv, y = (x0 * sn + y0 * ct) * inv;
                            acc += Math.min(1, gain * shapeValue(p, x, y, lens, spikeExp));
                        }
                    }
                    v = w * acc / (ss * ss);
                }
                writePixel(out, (j * W + i2) * 4, v, lut, p.background);
            }
        }
        return out;
    }

    /* Edge window in PIXELS: rings 0 and 1 are exactly 0 (guarantee 2). Shared
       by both families, so the guarantee is one piece of code. */
    function edgeWindow(i2, j, W, H, fadePx) {
        const d = Math.min(i2, W - 1 - i2, j, H - 1 - j);
        const w = clamp((d - 1) / fadePx, 0, 1);
        return w * w * (3 - 2 * w);
    }

    /* A value in [0,1] to one RGBA pixel, through the colour LUT. */
    function writePixel(out, o, v, lut, background) {
        const li = Math.round(clamp(v, 0, 1) * 255) * 4;
        const alpha = (lut[li + 3] / 255) * clamp(v, 0, 1);
        if (background === 'black') {
            // The clear version composited over black: what Additive shows.
            out[o] = Math.round(lut[li] * alpha);
            out[o + 1] = Math.round(lut[li + 1] * alpha);
            out[o + 2] = Math.round(lut[li + 2] * alpha);
            out[o + 3] = 255;
        } else {
            const a8 = Math.round(alpha * 255);
            if (a8 > 0) { out[o] = lut[li]; out[o + 1] = lut[li + 1]; out[o + 2] = lut[li + 2]; }
            out[o + 3] = a8;   // RGB left 0 under alpha 0, as WadTool writes it
        }
    }

    /* Blur (the classic soft plume, SPRITE-PLAN phase 3b): a Gaussian of sigma
       `blur`% of the smaller side, as three box passes per axis (Wells 1986),
       with zero outside the card. Then the edge window and colour, exactly as
       the unblurred paths apply them. Float64 throughout: same params, same bytes. */
    function boxSizes(sigma) {
        const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
        let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
        const wu = wl + 2;
        const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
        return [0, 1, 2].map(k => (k < m ? wl : wu));
    }
    function boxPass(src, dst, W, H, r, horizontal) {
        const len = horizontal ? W : H, lines = horizontal ? H : W, norm = 1 / (2 * r + 1);
        for (let l = 0; l < lines; l++) {
            const at = k => horizontal ? l * W + k : k * W + l;
            let acc = 0;
            for (let k = -r; k <= r; k++) if (k >= 0 && k < len) acc += src[at(k)];
            for (let k = 0; k < len; k++) {
                dst[at(k)] = acc * norm;
                const add = k + r + 1, sub = k - r;
                if (add < len) acc += src[at(add)];
                if (sub >= 0) acc -= src[at(sub)];
            }
        }
    }
    function blurField(field, W, H, sigma) {
        if (sigma < 0.3) return field;
        let a = field, b = new Float64Array(field.length);
        for (const w of boxSizes(sigma)) {
            const r = (w - 1) >> 1;
            if (r < 1) continue;
            boxPass(a, b, W, H, r, true); boxPass(b, a, W, H, r, false);
        }
        return a;
    }
    function finishField(p, field, lut) {
        const W = p.width, H = p.height;
        const sigma = p.blur / 100 * Math.min(W, H);
        const f = blurField(field, W, H, sigma);
        const fadePx = Math.max(2, Math.round(0.06 * Math.min(W, H)));
        const out = new Uint8ClampedArray(W * H * 4);
        for (let j = 0; j < H; j++) for (let i2 = 0; i2 < W; i2++) {
            const w = edgeWindow(i2, j, W, H, fadePx);
            writePixel(out, (j * W + i2) * 4, w > 0 ? w * f[j * W + i2] : 0, lut, p.background);
        }
        return out;
    }

    const wrap01 = x => x - Math.floor(x);

    /* The noise body's uniforms for frame i of N. Every uniform, every call:
       blit() leaves the previous draw's values bound. In a loop the time and
       climb are wrapped with fract here, so a = 1 hands the shader exactly the
       numbers a = 0 does (the loop closes by construction, not by luck). */
    function noiseUniforms(p, i, N) {
        const st = frameState(p, i, N);
        const period = p.noiseScale;
        let timeZ, climb, erode;
        /* Time never sits on a lattice plane. At z = 0 EVERY octave lands on an
           integer z (0, 0, 0…), where gradient noise loses the z term, so the
           frame at t = 0 came out statistically calmer than its neighbours:
           measured, the two steps either side of frame 0 were 2x the rest
           (4.25 and 4.85 against ~2). A constant phase keeps the period (z is
           taken mod evolve) and keeps the loop closing byte for byte. */
        const PHASE = 0.371;
        if (st.loop) {
            timeZ = wrap01(st.age) * p.evolve + PHASE;
            climb = wrap01(p.rise * st.age);
            erode = p.erodeStart;
        } else if (p.sequence === 'lifetime') {
            timeZ = st.age * p.evolve + PHASE;
            climb = p.rise * st.age;
            erode = p.erodeStart + (p.erodeEnd - p.erodeStart) * st.age;
        } else {
            timeZ = PHASE; climb = 0; erode = p.erodeStart;
        }
        // Variants re-seed per frame; the lattice offset stays small and whole
        // so float precision holds (a 1e9 seed would wreck the lattice maths).
        const seed = p.sequence === 'variants' ? (p.seed + (i + 1) * 7919) % 997 : p.seed % 997;
        return {
            u_period: period, u_timeZ: timeZ, u_timePeriod: p.evolve,
            u_shift: [0, -climb * period],
            u_octaves: p.octaves, u_gain: p.roughness, u_style: p.noiseStyle, u_warp: p.warp,
            u_seed: seed, u_body: BODIES.indexOf(p.body),
            u_scale: st.scale, u_ragged: p.ragged, u_feather: p.feather, u_detail: p.detail,
            u_contrast: p.contrast, u_erode: erode, u_erodeSoft: p.erodeSoft,
            u_bright: p.brightness * st.intensity,
        };
    }

    /* One noise-body frame: density on the GPU, then supersample, edge window
       and colour on the CPU, exactly as the shape family does them. */
    function renderNoiseFrame(p, i, N, lut) {
        const E = TRLE.Engine;
        if (!E || !E.programs || !E.programs().spriteNoise) {
            throw new Error('the spriteNoise shader is unavailable (is the engine initialised?)');
        }
        const W = p.width, H = p.height, f = ssFor(p), RW = W * f, RH = H * f;
        const fbo = E.createFBO(RW, RH);
        let px;
        try {
            E.blit('spriteNoise', noiseUniforms(p, i, N), fbo, RW, RH);
            px = E.readPixels(fbo);
        } finally { E.deleteFBO(fbo); }
        const fadePx = Math.max(2, Math.round(0.06 * Math.min(W, H)));
        if (p.blur > 0) {
            const field = new Float64Array(W * H);
            for (let j = 0; j < H; j++) for (let i2 = 0; i2 < W; i2++) {
                let acc = 0;
                for (let sy = 0; sy < f; sy++) {
                    const row = RH - 1 - (j * f + sy);
                    for (let sx = 0; sx < f; sx++) acc += px[(row * RW + i2 * f + sx) * 4];
                }
                field[j * W + i2] = acc / (f * f * 255);
            }
            return finishField(p, field, lut);
        }
        const out = new Uint8ClampedArray(W * H * 4);
        for (let j = 0; j < H; j++) {
            for (let i2 = 0; i2 < W; i2++) {
                const w = edgeWindow(i2, j, W, H, fadePx);
                let v = 0;
                if (w > 0) {
                    let acc = 0;
                    for (let sy = 0; sy < f; sy++) {
                        const row = RH - 1 - (j * f + sy);          // GL rows are bottom-up
                        for (let sx = 0; sx < f; sx++) acc += px[(row * RW + i2 * f + sx) * 4];
                    }
                    v = w * acc / (f * f * 255);
                }
                writePixel(out, (j * W + i2) * 4, v, lut, p.background);
            }
        }
        return out;
    }

    /* ================================================================
       PARTICLE BURST (SPRITE-PLAN phase 4): sparks, embers, motes, twinkle
       clusters. RADIAL and NON-WRAPPING -- the opposite convention from
       js/animparticles.js, whose whole point is a toroidal field that tiles.
       Here a particle's path runs outward from an origin (card centre plus
       the Offset controls) and is CLIPPED at the card edge, never tiled back
       in, which is what "Done when: no particle writes past the card edge"
       means literally: the rasteriser below cannot address a pixel outside
       the buffer, by construction, not by a later mask.

       Timing reuses frameState()/wrap01() exactly as the noise body does,
       rather than inventing a second clock: a loop's particles are given an
       INTEGER number of births per particle (the same trick `twinkle` in
       animparticles.js uses), so frame N's local age equals frame 0's for
       every particle -- the loop closes by construction, not by comparing
       frame N to frame 0 after the fact. A lifetime burst instead uses the
       shared fadeIn/fadeOut envelope (the same one shape and noise already
       use), so all three generators end a life-cycle sequence the same way. */

    /* One streak, clipped to [0,Rw) x [0,Rh) -- the non-wrapping sibling of
       animparticles.js's rasterCapsule. Same capsule maths (distance to the
       segment from head (cx,cy) back along -(nx,ny) for L px, max-blended so
       overlapping particles cannot blow out and draw order does not matter);
       the only change is the bounds, which CLIP instead of wrapping with a
       modulo, and Rw/Rh may differ (a sprite need not be square). */
    function rasterDiscClamped(buf, Rw, Rh, cx, cy, nx, ny, L, w, bright) {
        if (bright <= 0) return;
        const w2 = w * w;
        const tx = cx - nx * L, ty = cy - ny * L;
        const yLo = Math.max(0, Math.ceil(Math.min(cy, ty) - w));
        const yHi = Math.min(Rh - 1, Math.floor(Math.max(cy, ty) + w));
        const dy = ty - cy;
        const invL2 = L > 0 ? 1 / (L * L) : 0;
        for (let gy = yLo; gy <= yHi; gy++) {
            let u0 = 0, u1 = 1;
            if (Math.abs(dy) > 1e-9) {
                const a = (gy - w - cy) / dy, b = (gy + w - cy) / dy;
                u0 = Math.max(0, Math.min(a, b)); u1 = Math.min(1, Math.max(a, b));
                if (u0 > u1) continue;
            } else if (Math.abs(gy - cy) > w) continue;
            const xa = cx - nx * L * u0, xb = cx - nx * L * u1;
            const xLo = Math.max(0, Math.ceil(Math.min(xa, xb) - w));
            const xHi = Math.min(Rw - 1, Math.floor(Math.max(xa, xb) + w));
            const row = gy * Rw;
            const qy = gy - cy;
            for (let gx = xLo; gx <= xHi; gx++) {
                const qx = gx - cx;
                let u = L > 0 ? -(qx * nx + qy * ny) * L * invL2 : 0;
                u = u < 0 ? 0 : u > 1 ? 1 : u;
                const ex = qx + nx * L * u, ey = qy + ny * L * u;
                const d2 = ex * ex + ey * ey;
                if (d2 >= w2) continue;
                const a = (1 - Math.sqrt(d2) / w) * bright;
                if (a <= 0) continue;
                const k = row + gx;
                if (a > buf[k]) buf[k] = a;
            }
        }
    }

    /* Box-average an Rw x Rh field down to W x H, f per side -- the same
       block-average boxDownField in animparticles.js does on its (square,
       toroidal) field, generalised to a possibly-non-square card. */
    function downsampleField(src, Rw, W, H, f) {
        const out = new Float64Array(W * H), n = f * f;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let acc = 0;
                for (let j = 0; j < f; j++) {
                    let p2 = (y * f + j) * Rw + x * f;
                    for (let i = 0; i < f; i++, p2++) acc += src[p2];
                }
                out[y * W + x] = acc / n;
            }
        }
        return out;
    }

    /* One frame of a burst, at Rw x Rh (supersampled), then handed to
       finishField for the SAME blur / edge-window / colour pass the noise
       body uses (Blur 0 is a no-op there, so the unblurred case costs nothing
       extra). Every particle draws EXACTLY FIVE rng values, always, the same
       discipline animparticles.js documents for its own particles: adding a
       sixth later must not re-roll every saved seed. */
    function renderParticleFrame(p, i, N, lut) {
        const W = p.width, H = p.height, f = ssFor(p), Rw = W * f, Rh = H * f;
        const st = frameState(p, i, N);
        const field = new Float64Array(Rw * Rh);
        const count = Math.min(LIMITS.MAX_PARTICLES, Math.max(0, Math.round(p.count)));
        // variants/still re-seed per frame, exactly as the shape family's
        // spikeSeed already does -- reused rather than invented twice.
        const seed = (p.sequence === 'variants' || p.sequence === 'still') ? st.spikeSeed : p.seed;
        const rnd = mulberry32(((seed >>> 0) ^ 0x2545f491) >>> 0);
        const coneCenter = p.burstAngle * Math.PI / 180;
        const cx = Rw / 2 + p.offsetX * Rw / 2, cy = Rh / 2 - p.offsetY * Rh / 2;
        const travelPx = p.travel * Math.min(Rw, Rh) / 2;
        const sizePx0 = p.dotSize * Math.min(Rw, Rh) / 2;
        const gravityPx = p.gravity * Math.min(Rw, Rh) * 0.4;
        const gain = p.brightness * st.intensity;
        const baseCycles = Math.max(1, Math.round(p.burstCycles));
        for (let k = 0; k < count; k++) {
            const rAngle = rnd(), rSize = rnd(), rTravel = rnd(), rBright = rnd(), rPhase = rnd();
            const theta = coneCenter + (rAngle - 0.5) * 2 * Math.PI * p.burstSpread;
            const dx = Math.sin(theta), dy = -Math.cos(theta);   // 0deg = up, clockwise
            let localAge;
            if (st.loop) {
                // An INTEGER number of births per particle keeps age(N) ===
                // age(0) for every particle (the twinkle trick), so the loop
                // closes by construction rather than by comparing frames after.
                const cycles = baseCycles + Math.floor(rPhase * baseCycles);
                localAge = wrap01(cycles * st.age + rPhase);
            } else if (p.sequence === 'lifetime') {
                // Staggered by spawnT, but NEVER gated off: a particle whose
                // turn has not come yet still draws, sitting at localAge 0 (at
                // the origin), which is what "has not left yet" looks like and
                // is what keeps frame 0 lit -- gating brightness to 0 before
                // spawnT would leave frame 0 empty for any spawnSpread > 0,
                // since a continuous spawnT is almost never exactly 0.
                const spawnT = rPhase * p.spawnSpread;
                localAge = clamp((st.age - spawnT) / Math.max(1e-3, 1 - spawnT), 0, 1);
            } else {
                // variants / still: one frozen mid-flight moment per particle.
                localAge = rPhase;
            }
            // Peaked envelope in loop mode only: it is what makes a particle's
            // respawn (age snapping from 1 back to 0) invisible -- brightness
            // is exactly 0 at both ends of every cycle, not just continuous.
            const shapeAge = 1 - (1 - localAge) * (1 - localAge);       // ease-out flight
            const env = st.loop ? 4 * localAge * (1 - localAge) : 1;
            const bright = gain * env * ((1 - p.brightJitter) + p.brightJitter * rBright);
            if (bright <= 0) continue;
            const travel = travelPx * shapeAge * (1 + p.travelSpread * (rTravel - 0.5));
            const px = cx + dx * travel, py = cy + dy * travel + gravityPx * localAge * localAge;
            const w = Math.max(0.5, sizePx0 * (1 + p.dotSizeSpread * (rSize - 0.5)));
            const L = p.streak > 0 ? p.streak * Math.max(1, travel) : 0;
            rasterDiscClamped(field, Rw, Rh, px, py, dx, dy, L, w, bright);
        }
        return finishField(p, downsampleField(field, Rw, W, H, f), lut);
    }

    /* The whole sequence as canvases. */
    function generateFrames(params) {
        const p = normalise(params);
        const N = p.frames;
        const lut = colourLUT(p);
        const frames = [];
        for (let i = 0; i < N; i++) {
            const cv = document.createElement('canvas');
            cv.width = p.width; cv.height = p.height;
            const px = p.generator === 'noise' ? renderNoiseFrame(p, i, N, lut)
                : p.generator === 'particles' ? renderParticleFrame(p, i, N, lut) : renderFrame(p, i, N, lut);
            cv.getContext('2d').putImageData(new ImageData(px, p.width, p.height), 0, 0);
            frames.push(cv);
        }
        return frames;
    }

    /* Frame i of the sequence as it would be if the sequence went on: i = N is
       the frame after the last. For a loop that must be frame 0 again, which is
       what validate-sprite checks. */
    function frameAt(params, i) {
        const p = normalise(params);
        const lut = colourLUT(p);
        const px = p.generator === 'noise' ? renderNoiseFrame(p, i, p.frames, lut)
            : p.generator === 'particles' ? renderParticleFrame(p, i, p.frames, lut) : renderFrame(p, i, p.frames, lut);
        const cv = document.createElement('canvas');
        cv.width = p.width; cv.height = p.height;
        cv.getContext('2d').putImageData(new ImageData(px, p.width, p.height), 0, 0);
        return cv;
    }

    /* Atlas cost: Tomb Engine packs every sprite of a level into ONE atlas, so
       this is the number that grows it (SPRITE-PLAN §1.5). */
    function budget(params) {
        const p = normalise(params);
        return { frames: p.frames, width: p.width, height: p.height, pixels: p.frames * p.width * p.height,
                 classicOk: p.width <= LIMITS.CLASSIC_MAX && p.height <= LIMITS.CLASSIC_MAX };
    }

    /* ---------- the sprite file (.atlassprites.json, SPRITE-PLAN D8) ----------
       Settings only: every generator is deterministic, so the settings ARE the
       sprite. `sequences` is a list so a later version can hold a set; this one
       writes one and reads the first. The atlas project format is untouched. */
    const FILE_FORMAT = 'atlassprites', FILE_VERSION = 1, FILE_EXT = '.atlassprites.json';
    function toFile(name, params) {
        return { format: FILE_FORMAT, version: FILE_VERSION,
                 sequences: [{ name: String(name || 'sprites'), params: normalise(params) }] };
    }
    function fromFile(obj) {
        if (!obj || obj.format !== FILE_FORMAT) throw new Error('Not a sprite file');
        if (obj.version !== FILE_VERSION) throw new Error(`Sprite file version ${obj.version} is not supported`);
        const s = Array.isArray(obj.sequences) && obj.sequences[0];
        if (!s || typeof s !== 'object') throw new Error('The sprite file holds no sequence');
        return { name: String(s.name || 'sprites'), params: normalise(s.params), count: obj.sequences.length };
    }

    return { LIMITS, SLOTS, SEQUENCES, SHAPES, GENERATORS, BODIES, DEFAULTS, LOOKS, slotByKey, slotParams, normalise,
             generateFrames, frameAt, budget, toFile, fromFile, FILE_EXT, ssFor };
})();
