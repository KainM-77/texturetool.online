/* SPDX-License-Identifier: MIT
   TextureTool — Copyright (C) 2026 KainM-77. This file is the author's own work,
   available under the MIT License (see LICENSE-MIT). The tool as a whole ships
   under GPL-3.0 (see LICENSE) only because it also bundles two GPL-3.0 seamless
   shaders derived from Materialize; this file contains none of that code. */
/* ============================================================
   TRLE Texture Tools — Material Presets & Map Descriptions
   Contains 43 solid + 8 liquid material definitions with
   physically-accurate PBR values for Tomb Engine.
   ============================================================ */

window.TRLE = window.TRLE || {};

/* ---- Map Type Descriptions (shown to users) ---- */
TRLE.MapDescriptions = {
    normal: {
        title: '🟦 Normal Map',
        short: 'Simulates surface bumps and grooves without adding geometry.',
        full: `A Normal Map encodes the direction each surface point faces, creating the illusion of 3D detail on flat textures. The RGB channels represent XY surface angles and Z depth — the dominant blue tint means "facing the camera." <strong>Red/green shifts</strong> indicate angled surfaces that catch light differently.<br><br>
<strong>In practice:</strong> For <em>bricks</em>, normal maps create visible mortar lines and rough surface texture. For <em>stone</em>, they add cracks and grain. For <em>wood</em>, they bring out the grain pattern. The stronger the normal map, the more dramatic the lighting response — but too strong can look artificial.`
    },
    ao: {
        title: '🌑 Ambient Occlusion (AO)',
        short: 'Darkens crevices and gaps where ambient light can\'t reach.',
        full: `An AO Map represents how much ambient (indirect) light reaches each surface point. <strong>White = fully exposed</strong>, <strong>dark = occluded/shadowed</strong>. It adds soft contact shadows in grooves, cracks, and where surfaces meet.<br><br>
<strong>In practice:</strong> For <em>bricks</em>, the mortar joints between bricks appear darker. For <em>tiles</em>, grout lines get shadow. For <em>bark</em>, deep crevices in the wood darken naturally. AO is subtle but essential — without it, surfaces look "flat" even with normal maps.`
    },
    specular: {
        title: '✨ Specular Map',
        short: 'Controls how intensely each point reflects direct light.',
        full: `A Specular Map defines the intensity of light reflections at each surface point. <strong>Brighter areas reflect more light</strong> (shinier), <strong>darker areas reflect less</strong> (matte). This doesn't affect the sharpness of reflections — that's roughness.<br><br>
<strong>In practice:</strong> For <em>metal</em>, the entire surface has high specularity. For <em>bricks</em>, glazed surfaces are brighter than mortar. For <em>marble</em>, polished areas have strong specular highlights. For <em>fabric</em>, specularity is very low throughout.`
    },
    roughness: {
        title: '🔲 Roughness Map',
        short: 'Controls the sharpness of reflections — smooth vs. rough.',
        full: `A Roughness Map controls how <em>sharp or blurry</em> reflections appear. <strong>Black (0) = mirror-like</strong> sharp reflections. <strong>White (1) = fully diffuse</strong>, scattered light in all directions.<br><br>
<strong>In practice:</strong> For <em>chrome</em>, roughness is near-zero (mirror reflections). For <em>brushed metal</em>, moderate roughness creates stretched highlights. For <em>concrete</em>, high roughness means no visible reflections. For <em>wet surfaces</em>, lowering roughness adds a glossy wet look.`
    },
    emissive: {
        title: '💡 Emissive Map',
        short: 'Makes surfaces glow and emit light independently of scene lighting.',
        full: `An Emissive Map makes textures <strong>glow or shine on their own</strong>, independent of any scene lighting. Black = no emission, colored pixels glow with that color. Emissive surfaces appear bright even in complete darkness.<br><br>
<strong>In practice:</strong> For <em>windows at night</em>, bright yellow/white areas simulate interior light shining through. For <em>lava</em>, orange-red emission creates a molten glow. For <em>neon signs</em>, colored emission makes them pop. For <em>ceiling lights</em>, the lamp area glows white. Most natural materials have <strong>zero emission</strong> — only use this for light sources, screens, or magical effects.`
    },
    height: {
        title: '⬆️ Height Map (Displacement)',
        short: 'Creates actual 3D depth via parallax occlusion mapping.',
        full: `A Height Map represents the actual elevation of each surface point. <strong>White = high points</strong>, <strong>black = low points</strong>. Unlike normal maps which fake depth, height maps create <em>real parallax depth</em> — surfaces shift as you change viewing angle, and high points occlude low points.<br><br>
<strong>In practice:</strong> For <em>bricks</em>, mortar lines sit lower than brick faces. For <em>cobblestones</em>, each stone rises above the gaps. The effect is dramatic but <strong>GPU-intensive</strong> — each pixel requires multiple texture samples to compute the parallax offset.`
    }
};

/* ---- Tomb Engine Material Order ---- */
TRLE.MapOrder = ['normal', 'ao', 'specular', 'roughness', 'emissive', 'height'];
TRLE.MapSuffixes = {
    normal: '_n',
    ao: '_ao',
    specular: '_s',
    roughness: '_r',
    emissive: '_e',
    height: '_h'
};

/* ---- Solid Material Presets (43 types) ----
   Values are in 0-255 range (mapped to 0-1 in shaders).
   normalStrength: How pronounced bumps are (1-50)
   normalBlur: Smoothing applied before normals (0-10 px)
   aoRadius: How far AO samples reach (1-30 px)
   aoIntensity: How dark AO shadows get (1-30)
   roughnessBase: Base roughness level (0-255)
   roughnessContrast: How much texture detail affects roughness (0-30)
   specularBase: Base specularity (0-255)
   specularContrast: How much detail affects specular (0-30)
   heightStrength: Height map intensity (1-50)
   heightBlur: Pre-blur before height computation (0-10)
   emissiveStrength: Emission intensity (0-100) — 0 for most materials
   emissiveThreshold: Brightness cutoff for emission (0-255)
   ----------------------------------------------------------- */

TRLE.SolidPresets = {
    asphalt:       { label: '🛣️ Asphalt',        normalStrength: 22, normalBlur: 2, aoRadius: 14, aoIntensity: 16, roughnessBase: 215, roughnessContrast: 10, specularBase: 45,  specularContrast: 5,  heightStrength: 16, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Rough road surface with visible aggregate. Deep pitting, very matte, gritty surface detail.' },
    bark:          { label: '🪵 Bark',           normalStrength: 38, normalBlur: 1, aoRadius: 20, aoIntensity: 24, roughnessBase: 225, roughnessContrast: 14, specularBase: 35,  specularContrast: 5,  heightStrength: 32, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Deep creviced tree bark. Very strong normals, heavy AO in deep fissures, pronounced ridges.' },
    brick:         { label: '🧱 Brick',          normalStrength: 32, normalBlur: 2, aoRadius: 16, aoIntensity: 22, roughnessBase: 190, roughnessContrast: 12, specularBase: 55,  specularContrast: 6,  heightStrength: 22, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Clay bricks with deep mortar joints. Strong depth, weathered matte surface.' },
    brushed_metal: { label: '⚙️ Brushed Metal',  normalStrength: 14, normalBlur: 1, aoRadius: 8,  aoIntensity: 10, roughnessBase: 85,  roughnessContrast: 14, specularBase: 210, specularContrast: 12, heightStrength: 10, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Metal with deep directional scratches. Strong specular sheen with visible wear patterns.' },
    cardboard:     { label: '📦 Cardboard',      normalStrength: 14, normalBlur: 2, aoRadius: 12, aoIntensity: 10, roughnessBase: 220, roughnessContrast: 8,  specularBase: 30,  specularContrast: 3,  heightStrength: 10, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Corrugated or flat cardboard. Very matte with visible fiber ridges and creases.' },
    carbon_fiber:  { label: '🏎️ Carbon Fiber',   normalStrength: 16, normalBlur: 1, aoRadius: 10, aoIntensity: 14, roughnessBase: 55,  roughnessContrast: 12, specularBase: 200, specularContrast: 10, heightStrength: 12, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Woven carbon fiber weave. Deep cross-hatch pattern, strong specular highlights.' },
    cement:        { label: '🏗️ Cement',         normalStrength: 22, normalBlur: 2, aoRadius: 14, aoIntensity: 16, roughnessBase: 200, roughnessContrast: 12, specularBase: 50,  specularContrast: 5,  heightStrength: 16, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Rough cement surface. Heavy granular texture with deep pitting and cracks.' },
    ceramic:       { label: '🏺 Ceramic',        normalStrength: 14, normalBlur: 2, aoRadius: 10, aoIntensity: 12, roughnessBase: 45,  roughnessContrast: 10, specularBase: 190, specularContrast: 10, heightStrength: 10, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Glazed ceramic. Sharp glaze edges, strong specular with visible imperfections.' },
    chrome:        { label: '🪞 Chrome',         normalStrength: 6,  normalBlur: 2, aoRadius: 6,  aoIntensity: 8,  roughnessBase: 8,   roughnessContrast: 6,  specularBase: 248, specularContrast: 4,  heightStrength: 4,  heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Mirror-polished chrome. Near-perfect reflections with subtle surface distortion.' },
    concrete:      { label: '🏗️ Concrete',       normalStrength: 28, normalBlur: 2, aoRadius: 14, aoIntensity: 20, roughnessBase: 205, roughnessContrast: 10, specularBase: 40,  specularContrast: 5,  heightStrength: 20, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Weathered poured concrete. Deep cracks, heavy surface erosion, dark recesses.' },
    cotton:        { label: '🧶 Cotton',         normalStrength: 14, normalBlur: 3, aoRadius: 12, aoIntensity: 10, roughnessBase: 230, roughnessContrast: 8,  specularBase: 25,  specularContrast: 3,  heightStrength: 10, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Woven cotton fabric. Visible fiber texture, deep weave shadows.' },
    denim:         { label: '👖 Denim',          normalStrength: 18, normalBlur: 2, aoRadius: 14, aoIntensity: 14, roughnessBase: 215, roughnessContrast: 10, specularBase: 40,  specularContrast: 5,  heightStrength: 14, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Twill-woven denim fabric. Pronounced weave pattern, deep thread shadows.' },
    dirt:          { label: '🟤 Dirt',           normalStrength: 24, normalBlur: 2, aoRadius: 16, aoIntensity: 18, roughnessBase: 225, roughnessContrast: 10, specularBase: 30,  specularContrast: 4,  heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Loose or packed dirt/soil. Deep clumps, heavy shadows between debris, rough surface.' },
    fabric:        { label: '🧵 Fabric',         normalStrength: 16, normalBlur: 2, aoRadius: 12, aoIntensity: 10, roughnessBase: 215, roughnessContrast: 10, specularBase: 40,  specularContrast: 5,  heightStrength: 12, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Generic woven fabric. Visible fiber structure with depth in the weave.' },
    foam:          { label: '🧽 Foam',           normalStrength: 16, normalBlur: 3, aoRadius: 18, aoIntensity: 18, roughnessBase: 235, roughnessContrast: 6,  specularBase: 20,  specularContrast: 3,  heightStrength: 16, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Open or closed cell foam. Deep porous cavities, heavy AO in pores.' },
    frosted_glass: { label: '🧊 Frosted Glass',  normalStrength: 8,  normalBlur: 3, aoRadius: 6,  aoIntensity: 6,  roughnessBase: 120, roughnessContrast: 10, specularBase: 175, specularContrast: 10, heightStrength: 6,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Sandblasted glass. Visible etch pattern, diffused but strong specular.' },
    glass:         { label: '🪟 Glass',          normalStrength: 3,  normalBlur: 3, aoRadius: 4,  aoIntensity: 4,  roughnessBase: 5,   roughnessContrast: 3,  specularBase: 245, specularContrast: 3,  heightStrength: 2,  heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Smooth clear glass. Near-perfect reflections, almost no surface detail.' },
    gold:          { label: '🥇 Gold',           normalStrength: 10, normalBlur: 1, aoRadius: 8,  aoIntensity: 10, roughnessBase: 22,  roughnessContrast: 10, specularBase: 245, specularContrast: 8,  heightStrength: 8,  heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished gold. Sharp surface detail, very strong specular, rich warm reflections.' },
    granite:       { label: '🪨 Granite',        normalStrength: 26, normalBlur: 2, aoRadius: 14, aoIntensity: 18, roughnessBase: 140, roughnessContrast: 12, specularBase: 95,  specularContrast: 8,  heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished granite with pronounced crystalline grain and deep fractures.' },
    grass:         { label: '🌿 Grass',          normalStrength: 22, normalBlur: 2, aoRadius: 18, aoIntensity: 18, roughnessBase: 195, roughnessContrast: 14, specularBase: 50,  specularContrast: 6,  heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Dense grass blades. Deep shadows between blades, pronounced individual strands.' },
    ice:           { label: '❄️ Ice',            normalStrength: 12, normalBlur: 3, aoRadius: 12, aoIntensity: 10, roughnessBase: 30,  roughnessContrast: 12, specularBase: 225, specularContrast: 10, heightStrength: 10, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Cracked ice. Deep fracture lines, strong glossy reflections, dramatic depth.' },
    iron:          { label: '⚙️ Iron',           normalStrength: 18, normalBlur: 1, aoRadius: 12, aoIntensity: 14, roughnessBase: 110, roughnessContrast: 14, specularBase: 180, specularContrast: 12, heightStrength: 14, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Cast or forged iron. Deep hammer marks, strong metallic specular, heavy surface detail.' },
    leather:       { label: '🧳 Leather',        normalStrength: 24, normalBlur: 2, aoRadius: 16, aoIntensity: 18, roughnessBase: 165, roughnessContrast: 14, specularBase: 80,  specularContrast: 8,  heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Tanned leather with deep grain. Pronounced creases, heavy wear shadows.' },
    leaves:        { label: '🍃 Leaves',         normalStrength: 26, normalBlur: 1, aoRadius: 18, aoIntensity: 20, roughnessBase: 170, roughnessContrast: 14, specularBase: 70,  specularContrast: 8,  heightStrength: 20, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Overlapping leaves. Deep layering shadows, pronounced veins and waxy sheen.' },
    linen:         { label: '🧵 Linen',          normalStrength: 16, normalBlur: 2, aoRadius: 12, aoIntensity: 10, roughnessBase: 210, roughnessContrast: 10, specularBase: 35,  specularContrast: 4,  heightStrength: 12, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Natural linen weave. Visible cross-thread pattern with depth between threads.' },
    marble:        { label: '🏛️ Marble',         normalStrength: 12, normalBlur: 3, aoRadius: 10, aoIntensity: 10, roughnessBase: 25,  roughnessContrast: 8,  specularBase: 220, specularContrast: 10, heightStrength: 8,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished marble with deep veining. Strong reflections, visible depth in vein channels.' },
    metal:         { label: '⚙️ Metal (Generic)', normalStrength: 14, normalBlur: 1, aoRadius: 10, aoIntensity: 12, roughnessBase: 80,  roughnessContrast: 14, specularBase: 210, specularContrast: 12, heightStrength: 10, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Generic worked metal. Deep scratches and dents, strong specular sheen.' },
    mud:           { label: '🟤 Mud',            normalStrength: 22, normalBlur: 3, aoRadius: 16, aoIntensity: 16, roughnessBase: 195, roughnessContrast: 12, specularBase: 65,  specularContrast: 8,  heightStrength: 18, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Wet or dried mud. Deep cracks, heavy displacement, wet areas catch light.' },
    paper:         { label: '📄 Paper',          normalStrength: 10, normalBlur: 3, aoRadius: 8,  aoIntensity: 8,  roughnessBase: 225, roughnessContrast: 6,  specularBase: 30,  specularContrast: 3,  heightStrength: 8,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Paper or parchment. Visible fiber texture with subtle creasing and wear.' },
    plastic:       { label: '🧴 Plastic',        normalStrength: 10, normalBlur: 2, aoRadius: 8,  aoIntensity: 10, roughnessBase: 90,  roughnessContrast: 12, specularBase: 175, specularContrast: 12, heightStrength: 8,  heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Molded plastic. Sharp mold lines, strong specular highlights on curved surfaces.' },
    porcelain:     { label: '🏺 Porcelain',      normalStrength: 8,  normalBlur: 3, aoRadius: 8,  aoIntensity: 10, roughnessBase: 20,  roughnessContrast: 6,  specularBase: 230, specularContrast: 8,  heightStrength: 6,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Glazed porcelain. Very smooth with strong specular, subtle glaze pooling visible.' },
    rubber:        { label: '🛞 Rubber',         normalStrength: 18, normalBlur: 2, aoRadius: 14, aoIntensity: 14, roughnessBase: 210, roughnessContrast: 10, specularBase: 35,  specularContrast: 4,  heightStrength: 14, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Vulcanized rubber. Deep pebbled texture, heavy surface wear shadows.' },
    rusted_metal:  { label: '🟧 Rusted Metal',   normalStrength: 34, normalBlur: 2, aoRadius: 18, aoIntensity: 22, roughnessBase: 210, roughnessContrast: 14, specularBase: 45,  specularContrast: 6,  heightStrength: 24, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Heavily corroded metal. Deep pitting, flaking rust layers, dramatic decay.' },
    sand:          { label: '🏖️ Sand',           normalStrength: 14, normalBlur: 3, aoRadius: 12, aoIntensity: 10, roughnessBase: 215, roughnessContrast: 8,  specularBase: 45,  specularContrast: 4,  heightStrength: 10, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Fine or coarse sand. Visible individual grains with shadows between them.' },
    silk:          { label: '🧵 Silk',           normalStrength: 10, normalBlur: 3, aoRadius: 8,  aoIntensity: 8,  roughnessBase: 70,  roughnessContrast: 12, specularBase: 175, specularContrast: 14, heightStrength: 8,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Smooth silk fabric. Strong directional sheen with visible weave at angles.' },
    silver:        { label: '🥈 Silver',         normalStrength: 10, normalBlur: 1, aoRadius: 8,  aoIntensity: 10, roughnessBase: 18,  roughnessContrast: 10, specularBase: 245, specularContrast: 8,  heightStrength: 8,  heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished silver. Sharp surface detail, near-maximum specular, cool-toned.' },
    skin:          { label: '🧑 Skin',           normalStrength: 18, normalBlur: 3, aoRadius: 14, aoIntensity: 14, roughnessBase: 155, roughnessContrast: 12, specularBase: 85,  specularContrast: 8,  heightStrength: 14, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Human skin with visible pores and wrinkles. Subtle oily specular highlights.' },
    slate:         { label: '🪨 Slate',          normalStrength: 28, normalBlur: 2, aoRadius: 14, aoIntensity: 20, roughnessBase: 170, roughnessContrast: 12, specularBase: 70,  specularContrast: 7,  heightStrength: 20, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Layered slate stone. Deep cleavage planes, pronounced stratification.' },
    snow:          { label: '🌨️ Snow',           normalStrength: 10, normalBlur: 4, aoRadius: 12, aoIntensity: 10, roughnessBase: 175, roughnessContrast: 6,  specularBase: 110, specularContrast: 8,  heightStrength: 10, heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Fresh or packed snow. Sparkle from ice crystals, soft undulating drifts with depth.' },
    steel:         { label: '🔩 Steel',          normalStrength: 10, normalBlur: 1, aoRadius: 8,  aoIntensity: 10, roughnessBase: 50,  roughnessContrast: 12, specularBase: 230, specularContrast: 10, heightStrength: 8,  heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished steel. Sharp surface marks, near-maximum specular, industrial feel.' },
    stone:         { label: '🪨 Stone',          normalStrength: 30, normalBlur: 2, aoRadius: 16, aoIntensity: 22, roughnessBase: 180, roughnessContrast: 12, specularBase: 55,  specularContrast: 6,  heightStrength: 22, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Natural stone. Deep cracks, heavy weathering, dramatic surface relief.' },
    tile:          { label: '🔲 Tile',           normalStrength: 22, normalBlur: 2, aoRadius: 14, aoIntensity: 18, roughnessBase: 65,  roughnessContrast: 10, specularBase: 170, specularContrast: 10, heightStrength: 16, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Ceramic tiles with deep grout lines. Strong glaze specular, heavy grout shadows.' },
    wood:          { label: '🪵 Wood',           normalStrength: 22, normalBlur: 2, aoRadius: 14, aoIntensity: 16, roughnessBase: 165, roughnessContrast: 16, specularBase: 80,  specularContrast: 8,  heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Natural wood with deep grain. Pronounced annual rings, heavy grain shadows.' },

    /* ---- Columns ---- */
    column_stone:  { label: '🏛️ Column (Stone)',  normalStrength: 18, normalBlur: 2, aoRadius: 12, aoIntensity:  8, roughnessBase: 175, roughnessContrast: 10, specularBase:  70, specularContrast:  6, heightStrength: 14, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Stone column with carved grooves. Reduced AO prevents deep flutes from going pitch-black — surface detail stays readable.' },
    column_marble: { label: '🏛️ Column (Marble)', normalStrength: 10, normalBlur: 2, aoRadius: 10, aoIntensity:  7, roughnessBase:  35, roughnessContrast:  8, specularBase: 210, specularContrast: 10, heightStrength:  8, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Polished marble column. Controlled AO keeps fluted channels bright; smooth specular preserves the polished feel.' },

    /* ---- Metal variants ---- */
    metal_gold:    { label: '🥇 Metal (Gold)',    normalStrength:  8, normalBlur: 1, aoRadius:  6, aoIntensity:  8, roughnessBase:  20, roughnessContrast: 10, specularBase: 245, specularContrast:  8, heightStrength:  6, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Regal polished gold. Very low roughness, near-maximum specular, crisp surface detail for a rich warm gleam.' },
    metal_silver:  { label: '🥈 Metal (Silver)',  normalStrength:  8, normalBlur: 1, aoRadius:  6, aoIntensity:  7, roughnessBase:  15, roughnessContrast:  8, specularBase: 248, specularContrast:  6, heightStrength:  6, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Highly reflective polished silver. Near-mirror roughness, maximum specular, cool-toned bright highlights.' },
    metal_bronze:  { label: '🥉 Metal (Bronze)',  normalStrength: 16, normalBlur: 1, aoRadius: 12, aoIntensity: 14, roughnessBase: 130, roughnessContrast: 14, specularBase: 140, specularContrast: 10, heightStrength: 12, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Aged bronze with a dingy, weathered finish. Higher roughness and AO bring out patina in recesses and worn surface texture.' },
    metal_fence:   { label: '⛓️ Metal (Fence/Gate)', normalStrength: 10, normalBlur: 3, aoRadius:  8, aoIntensity:  8, roughnessBase:  70, roughnessContrast: 10, specularBase: 215, specularContrast: 10, heightStrength:  6, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Iron fence or gate bars. Higher blur softens harsh edges on cylindrical rods, rounding out the silhouette without losing the metallic sheen.' },

    /* ---- Floor stone ---- */
    floor_stone_smooth: { label: '🪨 Floor Stone (Smooth)', normalStrength: 16, normalBlur: 4, aoRadius: 12, aoIntensity: 10, roughnessBase: 155, roughnessContrast:  8, specularBase:  85, specularContrast:  6, heightStrength: 12, heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Worn-flat laid stone floor. Softer normals and reduced AO keep mortar joints from going too dark — smooth, walkable surface feel.' },
    floor_stone_rough:  { label: '🪨 Floor Stone (Rough)',  normalStrength: 26, normalBlur: 2, aoRadius: 14, aoIntensity: 16, roughnessBase: 185, roughnessContrast: 12, specularBase:  60, specularContrast:  6, heightStrength: 18, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Rough-cut stone floor with prominent mortar grooves. Strong surface detail while keeping AO lighter than wall stone so joints do not dominate.' },

    /* ---- Marble variants ---- */
    marble_decorative: { label: '🏛️ Marble (Decorative)', normalStrength: 10, normalBlur: 4, aoRadius:  8, aoIntensity:  5, roughnessBase:  35, roughnessContrast:  6, specularBase: 195, specularContrast:  8, heightStrength:  4, heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Marble tile with painted faces or carved reliefs. Very low normal generation and AO let the artist’s detail read clearly instead of being swallowed by generated shadows.' },
    marble_surface:    { label: '🏛️ Marble (Surface)',    normalStrength:  8, normalBlur: 4, aoRadius:  8, aoIntensity:  6, roughnessBase:  15, roughnessContrast:  6, specularBase: 235, specularContrast:  8, heightStrength:  6, heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Smooth polished marble slab. High blur and very low roughness eliminate the grainy AO noise, giving a clean glass-smooth reflective surface.' }
};

/* ---- Liquid Material Presets (8 types) ---- */
TRLE.LiquidPresets = {
    still_water:   { label: '💧 Still Water',    normalStrength: 4,  normalBlur: 5, aoRadius: 4,  aoIntensity: 3,  roughnessBase: 15,  roughnessContrast: 4,  specularBase: 235, specularContrast: 3,  heightStrength: 3,  heightBlur: 5, emissiveStrength: 0, emissiveThreshold: 250, description: 'Calm, still water. Very low roughness for mirror-like reflections, extremely subtle ripples.' },
    running_water: { label: '🌊 Running Water',  normalStrength: 12, normalBlur: 3, aoRadius: 6,  aoIntensity: 4,  roughnessBase: 30,  roughnessContrast: 8,  specularBase: 220, specularContrast: 6,  heightStrength: 10, heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Flowing river or stream. Low roughness with visible flow ripples, strong directional normals.' },
    swamp_water:   { label: '🐊 Swamp Water',    normalStrength: 8,  normalBlur: 4, aoRadius: 10, aoIntensity: 8,  roughnessBase: 120, roughnessContrast: 10, specularBase: 100, specularContrast: 8,  heightStrength: 8,  heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Murky swamp water. Higher roughness from surface scum, reduced specular, organic debris texture.' },
    lava:          { label: '🌋 Lava',           normalStrength: 18, normalBlur: 2, aoRadius: 14, aoIntensity: 12, roughnessBase: 180, roughnessContrast: 14, specularBase: 60,  specularContrast: 8,  heightStrength: 16, heightBlur: 2, emissiveStrength: 90, emissiveThreshold: 100, description: 'Molten lava with cooling crust. High roughness on cooled areas, strong emission from cracks. Bright areas glow orange-red.' },
    quicksand:     { label: '🏜️ Quicksand',      normalStrength: 6,  normalBlur: 5, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 200, roughnessContrast: 4,  specularBase: 55,  specularContrast: 4,  heightStrength: 6,  heightBlur: 5, emissiveStrength: 0, emissiveThreshold: 250, description: 'Wet sand/mud mixture. High roughness, slight sheen from moisture, slow-moving viscous surface.' },
    sewage:        { label: '🚽 Sewage',         normalStrength: 10, normalBlur: 4, aoRadius: 10, aoIntensity: 8,  roughnessBase: 140, roughnessContrast: 8,  specularBase: 90,  specularContrast: 6,  heightStrength: 8,  heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Dark sewage/waste water. Moderate roughness from surface film, muted specular, murky appearance.' },
    slime:         { label: '🟢 Slime',          normalStrength: 8,  normalBlur: 4, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 50,  roughnessContrast: 8,  specularBase: 200, specularContrast: 10, heightStrength: 8,  heightBlur: 4, emissiveStrength: 20, emissiveThreshold: 180, description: 'Viscous slime or ooze. Low roughness (glossy), high specular, slight bioluminescent glow in bright areas.' },
    tar:           { label: '🖤 Tar',            normalStrength: 10, normalBlur: 4, aoRadius: 10, aoIntensity: 8,  roughnessBase: 60,  roughnessContrast: 6,  specularBase: 180, specularContrast: 6,  heightStrength: 10, heightBlur: 4, emissiveStrength: 0, emissiveThreshold: 250, description: 'Thick black tar. Low roughness (glossy black surface), high specular, viscous bubbling texture.' },
    ocean_deep:    { label: '🌊 Ocean (Deep)',     normalStrength: 8,  normalBlur: 4, aoRadius: 6,  aoIntensity: 4,  roughnessBase: 20,  roughnessContrast: 6,  specularBase: 230, specularContrast: 4,  heightStrength: 6,  heightBlur: 4, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Deep ocean water with gentle rolling swell. Very low roughness for mirror-like surface reflections, subtle directional wave normals.' },
    pool_water:    { label: '🏊 Pool / Reservoir', normalStrength: 3,  normalBlur: 5, aoRadius: 4,  aoIntensity: 3,  roughnessBase: 10,  roughnessContrast: 3,  specularBase: 240, specularContrast: 2,  heightStrength: 2,  heightBlur: 5, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Calm pool or underground reservoir. Near-perfect reflections, almost no surface detail — ideal for still temple pools.' },
    waterfall:     { label: '💦 Waterfall',        normalStrength: 20, normalBlur: 2, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 80,  roughnessContrast: 14, specularBase: 160, specularContrast: 10, heightStrength: 16, heightBlur: 2, emissiveStrength: 5,  emissiveThreshold: 220, description: 'Fast-flowing waterfall with foam and spray. High roughness from turbulence, strong vertical normals for cascading flow patterns.' },
    rain_puddle:   { label: '🌧️ Rain Puddle',      normalStrength: 6,  normalBlur: 4, aoRadius: 5,  aoIntensity: 4,  roughnessBase: 25,  roughnessContrast: 6,  specularBase: 220, specularContrast: 5,  heightStrength: 4,  heightBlur: 4, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Thin film of rainwater on stone or ground. Very low roughness, high specular with subtle concentric ripple rings.' },
    muddy_water:   { label: '🟤 Muddy Water',      normalStrength: 10, normalBlur: 3, aoRadius: 10, aoIntensity: 8,  roughnessBase: 140, roughnessContrast: 8,  specularBase: 80,  specularContrast: 6,  heightStrength: 8,  heightBlur: 3, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Turbid brown water with suspended sediment. Higher roughness from suspended particles, reduced specular clarity.' },
    ice_water:     { label: '🧊 Ice Water',        normalStrength: 5,  normalBlur: 5, aoRadius: 5,  aoIntensity: 3,  roughnessBase: 12,  roughnessContrast: 4,  specularBase: 235, specularContrast: 3,  heightStrength: 3,  heightBlur: 5, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Near-freezing crystal-clear water. Very low roughness, high specular, faint surface crystallization patterns.' },
    acid:          { label: '🧪 Acid',             normalStrength: 10, normalBlur: 3, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 40,  roughnessContrast: 10, specularBase: 200, specularContrast: 8,  heightStrength: 8,  heightBlur: 3, emissiveStrength: 40, emissiveThreshold: 140, description: 'Corrosive acid pool. Low roughness (glossy surface), moderate emissive glow from chemical reactions, bubbling surface.' },
    blood:         { label: '🩸 Blood',            normalStrength: 8,  normalBlur: 4, aoRadius: 10, aoIntensity: 8,  roughnessBase: 80,  roughnessContrast: 6,  specularBase: 170, specularContrast: 6,  heightStrength: 6,  heightBlur: 4, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Pool of blood. Moderate roughness from viscosity, strong specular on fresh blood, dark red. No emission.' },
    oil:           { label: '🛢️ Oil',              normalStrength: 6,  normalBlur: 4, aoRadius: 6,  aoIntensity: 4,  roughnessBase: 25,  roughnessContrast: 6,  specularBase: 220, specularContrast: 6,  heightStrength: 4,  heightBlur: 4, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Dark crude or machine oil. Very low roughness (glossy black), high specular, slow viscous surface movement.' },
    mercury:       { label: '🌡️ Mercury',          normalStrength: 4,  normalBlur: 5, aoRadius: 4,  aoIntensity: 3,  roughnessBase: 8,   roughnessContrast: 3,  specularBase: 248, specularContrast: 2,  heightStrength: 3,  heightBlur: 5, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Liquid mercury (quicksilver). Near-perfect mirror reflections, extremely low roughness, metallic sheen.' },
    honey:         { label: '🍯 Honey / Resin',    normalStrength: 6,  normalBlur: 5, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 35,  roughnessContrast: 4,  specularBase: 200, specularContrast: 4,  heightStrength: 6,  heightBlur: 5, emissiveStrength: 0,  emissiveThreshold: 250, description: 'Golden honey or amber resin. Low roughness (glossy), high specular, thick viscous surface with slow flow.' },
    molten_metal:  { label: '🔥 Molten Metal',     normalStrength: 16, normalBlur: 2, aoRadius: 12, aoIntensity: 10, roughnessBase: 140, roughnessContrast: 14, specularBase: 100, specularContrast: 10, heightStrength: 14, heightBlur: 2, emissiveStrength: 80, emissiveThreshold: 110, description: 'Liquid molten metal. High roughness on cooling crust, strong emission from superheated exposed areas, metallic sheen between.' },
    poison:        { label: '☠️ Poison',           normalStrength: 8,  normalBlur: 4, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 50,  roughnessContrast: 8,  specularBase: 190, specularContrast: 8,  heightStrength: 6,  heightBlur: 4, emissiveStrength: 30, emissiveThreshold: 160, description: 'Toxic green liquid. Low roughness (glossy), subtle eerie glow from bright areas, bubbling surface texture.' },
    magic_liquid:  { label: '🔮 Magic Liquid',     normalStrength: 10, normalBlur: 3, aoRadius: 8,  aoIntensity: 6,  roughnessBase: 30,  roughnessContrast: 10, specularBase: 210, specularContrast: 8,  heightStrength: 8,  heightBlur: 3, emissiveStrength: 60, emissiveThreshold: 130, description: 'Mystical glowing liquid. Low roughness, high specular, strong emissive glow — ideal for magical pools, potions, or enchanted water.' }
};

TRLE.FantasySolidPresets = {};
TRLE.FantasyLiquidPresets = {};

/* ---- Decal presets (thin / transparent surfaces) ----
   `decal: true` makes material-map generation alpha-aware (the height signal is
   flattened toward neutral where the diffuse is transparent, so AO/normal/height
   don't emboss the decal's silhouette). All kept low-AO / low-height since a thin
   decal has little real depth. */
TRLE.DecalPresets = {
    cobweb:  { label: '🕸️ Cobweb',  decal: true, normalStrength: 12, normalBlur: 1, aoRadius: 6, aoIntensity: 4,  roughnessBase: 225, roughnessContrast: 8,  specularBase: 30,  specularContrast: 4,  heightStrength: 6,  heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Fine spider silk. Barely any depth, very matte, subtle thread relief — fades into corners.' },
    dust:    { label: '💨 Dust',    decal: true, normalStrength: 6,  normalBlur: 3, aoRadius: 5, aoIntensity: 3,  roughnessBase: 235, roughnessContrast: 5,  specularBase: 20,  specularContrast: 2,  heightStrength: 3,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Settled dust / dirt film. Flat and matte, almost no relief — overlay onto floors and ledges.' },
    leaves:  { label: '🍃 Leaves',  decal: true, normalStrength: 20, normalBlur: 1, aoRadius: 8, aoIntensity: 6,  roughnessBase: 165, roughnessContrast: 12, specularBase: 75,  specularContrast: 8,  heightStrength: 10, heightBlur: 1, emissiveStrength: 0, emissiveThreshold: 250, description: 'Scattered leaves. Waxy sheen, pronounced veins, soft transparent edges.' },
    foliage: { label: '🍃 Foliage', decal: true, normalStrength: 18, normalBlur: 2, aoRadius: 8, aoIntensity: 6,  roughnessBase: 185, roughnessContrast: 12, specularBase: 55,  specularContrast: 6,  heightStrength: 10, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Grass / plant overlay. Strands fading to transparency at the edges.' },
    ice:     { label: '🧊 Ice (thin)', decal: true, normalStrength: 10, normalBlur: 3, aoRadius: 6, aoIntensity: 4, roughnessBase: 35,  roughnessContrast: 10, specularBase: 215, specularContrast: 10, heightStrength: 6,  heightBlur: 3, emissiveStrength: 0, emissiveThreshold: 250, description: 'Thin frost / ice sheet. Glossy, translucent, gentle relief.' },
    moss:    { label: '🌿 Moss',    decal: true, normalStrength: 16, normalBlur: 2, aoRadius: 8, aoIntensity: 6,  roughnessBase: 215, roughnessContrast: 10, specularBase: 35,  specularContrast: 4,  heightStrength: 10, heightBlur: 2, emissiveStrength: 0, emissiveThreshold: 250, description: 'Soft moss patches. Matte, slightly fuzzy relief, ragged transparent edges.' }
};

/* ---- Helpers ---- */
// Presets kept in the data (so tiles already using them still resolve) but
// hidden from the picker for now.
TRLE.HiddenSolidPresets = new Set(['denim', 'linen']);
// Returns sorted keys for a preset type, optionally filtered by aesthetic
TRLE.getSolidPresetKeys = function(aesthetic) {
    const visible = obj => Object.keys(obj).filter(k => !TRLE.HiddenSolidPresets.has(k)).sort();
    if (aesthetic === 'decal') return visible(TRLE.DecalPresets);
    if (aesthetic === 'fantasy') return visible(TRLE.FantasySolidPresets);
    return visible(TRLE.SolidPresets); // realistic (default)
};

TRLE.getLiquidPresetKeys = function(aesthetic) {
    if (aesthetic === 'fantasy') return Object.keys(TRLE.FantasyLiquidPresets).sort();
    if (aesthetic === 'realistic') return Object.keys(TRLE.LiquidPresets).sort();
    return Object.keys(TRLE.LiquidPresets).sort();
};

// Returns the preset object for a key + aesthetic combination
TRLE.getSolidPreset = function(key, aesthetic) {
    if (aesthetic === 'decal') return TRLE.DecalPresets[key] || TRLE.SolidPresets[key];
    if (aesthetic === 'fantasy') return TRLE.FantasySolidPresets[key] || TRLE.SolidPresets[key];
    return TRLE.SolidPresets[key];
};

TRLE.getLiquidPreset = function(key, aesthetic) {
    if (aesthetic === 'fantasy') return TRLE.FantasyLiquidPresets[key] || TRLE.LiquidPresets[key];
    return TRLE.LiquidPresets[key];
};
