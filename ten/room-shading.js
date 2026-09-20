/* SPDX-License-Identifier: LicenseRef-TombEngine-NonCommercial
   ------------------------------------------------------------------
   DERIVED FROM TOMBENGINE. NOT MIT. NOT FOR COMMERCIAL USE.

   Copyright (c) 2025 Tomb Engine Team, for the parts derived from
   TombEngine. Modified MIT License (for non-commercial use only) --
   the full text is beside this file in `LICENSE`, and the clause that
   matters is that commercial use is prohibited.

   Everything ELSE in this repository is plain MIT and carries no such
   restriction. See ../../LICENSE and ../../THIRD-PARTY-NOTICES.md.
   ------------------------------------------------------------------
   TRLE.TenRoomShading -- TombEngine's room lighting, as GLSL text.

   WHY THIS FILE EXISTS AT ALL

   The rest of the Room View was written from MEASUREMENT: the vertex
   bake in js/roomlight.js was recovered by fitting Tomb Editor's own
   room exports, and js/roomuv.js by measuring a textured one. Neither
   needed the engine in front of them and neither is derived from it.

   This is the exception. The arithmetic below was taken from reading
   TombEngine's `Rooms.hlsl`, `ShaderLight.hlsli` and `Math.hlsli`:
   the two constants, the roughness curve, the two DIFFERENT falloff
   formulas, the order of the composite, and the two-branch behaviour
   that disagrees with itself about specular. A tidied version would
   not reproduce the engine, and reproducing the engine is the whole
   point of the preview, so it is kept as it is and kept in here.

   It is a separate file rather than a comment because the boundary has
   to be physical: one directory, one licence, nothing else in the tool
   depending on it. js/engine.js, js/shaders.js and js/presets.js are
   shared with the export pipeline and must never import from here.

   THE CONTRACT

   These are GLSL SOURCE FRAGMENTS, interpolated into a shader the
   caller assembles. They are not standalone. The caller declares the
   uniforms and provides these names:

     v_colour   vec3   the interpolated BAKED vertex colour
     v_world    vec3   world position
     N          vec3   the shading normal, normal-mapped if there is one
     tex        vec3   the diffuse sample
     ao, sp     float  occlusion and specular samples
     rgh        float  roughness sample
     emis       vec3   the emissive sample
     lighting   vec3   accumulator, initialised to v_colour
     rgb        vec3   the composite's output

     u_lightCount, u_lightPos[], u_lightColour[], u_lightIntensity[],
     u_lightIn[], u_lightOut[], u_lightSpot[], u_lightAxis[],
     u_lightCosIn[], u_lightCosOut[], u_anySpot, u_camForward

   js/roomview.js is the only caller.
   ------------------------------------------------------------------ */
(function (root) {
    'use strict';
    root.TRLE = root.TRLE || {};

    /* Both constants are the engine's own. SPEC_FACTOR is Math.hlsli's, and
       the roughness curve is ShaderLight.hlsli's RoughnessToExpMul.

       It is PHONG against a reflected light vector, not a microfacet model,
       which is why no PBR library reproduces it and why the tool's own 2D lit
       preview matches it while the Babylon one cannot. */
    function constants() {
        return `
        const float ROOM_LIGHT_COEFF = 0.7;
        const float SPEC_FACTOR = 64.0;

        float roughnessToExpMul(float roughness) {
            float r = max(clamp(roughness, 0.0, 1.0), 0.04);
            float gloss = 1.0 - r;
            return mix(0.04, 4.0, gloss * gloss);
        }`;
    }

    /* The room's dynamic light loop.

       Three details that are easy to get wrong and are taken from the engine:

       - The DIFFUSE falloff is (Out - d) / (Out - In); the SPECULAR falloff is
         (Out - d) / Out. They are different functions of the same two ranges.
       - ROOM_LIGHT_COEFF multiplies the diffuse term only, except in the second
         branch below, where it catches specular as well.
       - The specular exponent is SPEC_FACTOR * RoughnessToExpMul(roughness).

       The spot's angular term is the one piece here that was MEASURED rather
       than read, from the BiggerSpotlight fixture: linear in the cosine between
       the two cone angles. It sits in this file because it is inseparable from
       the loop around it, not because its provenance is the same. */
    function lightLoop(maxLights) {
        return `
            for (int i = 0; i < ${maxLights}; i++) {
                if (i >= u_lightCount) break;
                vec3  toLight = u_lightPos[i] - v_world;
                float dist    = length(toLight);
                vec3  L       = toLight / max(dist, 1e-6);

                float attDiff = clamp((u_lightOut[i] - dist) /
                                      max(u_lightOut[i] - u_lightIn[i], 1e-6), 0.0, 1.0);
                float ndl     = clamp(dot(N, L), 0.0, 1.0);

                /* A spot narrows the diffuse term by the angle off its axis,
                   linear in the COSINE. Note that the runtime spot uses the
                   direction to the surface, while the BAKE uses the axis for
                   its N.L as well -- they really are different models, and
                   RoomLight's header says so. */
                float angleAtt = 1.0;
                if (u_lightSpot[i] > 0.5) {
                    float cosT = dot(-L, u_lightAxis[i]);
                    angleAtt = clamp((cosT - u_lightCosOut[i]) /
                                     max(u_lightCosIn[i] - u_lightCosOut[i], 1e-6), 0.0, 1.0);
                }
                vec3 diff = clamp(u_lightColour[i] * u_lightIntensity[i] * attDiff * angleAtt * ndl,
                                  0.0, 1.0);

                float attSpec = clamp((u_lightOut[i] - dist) / max(u_lightOut[i], 1e-6), 0.0, 1.0);
                float expVal  = max(SPEC_FACTOR * roughnessToExpMul(rgh), 1.0);
                float vr      = clamp(dot(u_camForward, reflect(L, N)), 0.0, 1.0);
                vec3 spec = attSpec * pow(vr, expVal) * u_lightColour[i] * sp * u_lightIntensity[i];

                /* Rooms.hlsl has TWO branches over the room's dynamic lights and
                   they disagree about specular. With only point lights it adds
                   diffuse x ROOM_LIGHT_COEFF and specular at FULL strength. The
                   moment any light is a spot it goes through DoPointAndSpotLight,
                   which folds specular in before the caller multiplies, so
                   specular gets x0.7 as well -- for the point lights too.

                   So adding one spot dims the specular of every other light in
                   the room. Reproduced rather than tidied, because it is what
                   the engine does. */
                lighting += u_anySpot > 0.5 ? (diff + spec) * ROOM_LIGHT_COEFF
                                            : diff * ROOM_LIGHT_COEFF + spec;
            }`;
    }

    /* The end of the room path:

           lighting += emissive
           colour    = texture * lighting * occlusion,  saturated

       The order is the engine's and it is load-bearing. Emissive is added to
       the LIGHTING and then multiplied by the texture, which is why emissive
       lands as diffuse squared on room geometry; occlusion multiplies the
       finished pixel, which is why AO works on baked light alone while normal,
       specular and roughness do not. */
    function composite() {
        return `
            lighting += emis;
            vec3 rgb = clamp(tex * lighting * ao, 0.0, 1.0);`;
    }

    root.TRLE.TenRoomShading = { constants, lightLoop, composite };
})(typeof window !== 'undefined' ? window : globalThis);
