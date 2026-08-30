# Tuning vocabulary

Running notes on what your words have meant in terms of actual params, so a
later session doesn't start from zero. Add an entry whenever a phrase
resolves into a concrete change; keep it short — the value is the mapping,
not the prose.

Format: `"phrase" -> scene: setting/param, direction, ~magnitude`

See `docs/tuning.md` for the workflow this feeds into.
"the grid should actually read / not a dark blob" -> mesh: rebuilt as terrain waterfall; HEIGHT_SCALE 10 -> 6 (ridges below the camera, reads as ground), 3-tap bin blur (no cliffs), dots 0.78 -> 0.3
"move the scene a bit behind" -> mesh: cameraDistance 8 -> 16 (was a constant; now Camera Distance / Height / Tilt sliders), ~2x
"still missing a param to just zoom out" -> mesh: zoom (new; focal-length scale with grid width pinned to the zoom-1 frustum, so <1 shrinks the terrain in frame instead of stretching it), 1 -> ~0.5 for a floating-slab read
"can we make circle switch" -> mesh: circle (new boolean; same grid mapped to a disc, newest ring outside, CIRCLE_TILT_DEG 24 so it reads as a disc from the low default camera)
"squeeze the circle a bit into an ellipsoid" -> mesh: CIRCLE_SQUEEZE 1 -> 0.75 (depth radius vs width radius); defaults from mark 1788009526338: waveHeight 1.1 -> 1.3, valley 4 -> 1.5, cameraDistance 16 -> 26, cameraHeight 9 -> 26, cameraTilt -9.5 -> -10, zoom 1 -> 0.9
"put the squeeze in a slider" -> mesh: circleSqueeze (new; was CIRCLE_SQUEEZE), default 0.75
"background mesh barely does anything" -> mesh: BG lattice strength 0.04+0.08*energy -> bgMeshIntensity*(0.3+0.5*energy) (~5x), halo under the hairline, mask covers the whole sky (+ under the disc in circle mode); new bgMeshIntensity slider, default 0.6
"can it be kind of spherical" -> mesh: bgMeshDome (new boolean, sky lattice on a sphere around the camera, DOME_SCALE 14) + sphere (new boolean layout, globe with the newest ring at the equator, SPHERE_RADIUS 30)
"use the last mark as defaults" -> mesh: every default set from mark 1788012595768 (circle/wireframeOnly/contourLines/bgMesh on, zoom 2, cameraHeight 40, cameraTilt -16.5, circleSqueeze 0.55, flow 0.35, noise 2.35, dots 1, contourDensity 0.95); cameraHeight max 40 -> 60, zoom max 2 -> 3
"dome not doming, just a flat wall / behind the mesh" -> mesh: bgMeshDome recast from a sphere around the camera to a DOME_RADIUS 160 ball around the scene (ray-cast, far root), lattice in (az, el) about the ball center so it curves over and under the shape; shapeCover() dims it to 0.15 inside the disc/globe silhouette
"dome more spherical / move it back" -> mesh: Background Dome becomes a globe the camera is outside of (near + far surface drawn, far at 0.35), placed by new domeDistance (default 200) and sized by new domeRadius (default 150) sliders
"can waves go from center to outside" -> mesh: wavesOutward (new boolean, default on): newest ring at the disc center / globe poles, rippling out to the rim / equator
"looks like two dome grids" -> mesh: Background Dome draws only the first face the ray meets (near face from outside, far face from inside); the double near+far pass is gone
"make center spiky" -> mesh: centerSpike (new slider 0..3, default 1): displacement boosted toward the disc center / globe poles instead of faded flat; 0 restores the calm pole
"angle and mesh view like the reference (steep look-down, fine filled mesh, glowing center, dense dome)" -> mesh: new gridDensity (default 2, rebuilds the grid), new domeDensity (default 45, replaces DOME_SCALE), fill max 1 -> 4 (default 3), wireframeOnly off, contourLines off, camera 6/40/-35 zoom 1.4 (cameraTilt min -35 -> -75), circleSqueeze 1, centerSpike 1.5 with a pole glow (vPole) and the disc center fog fade lifted, dome 0/200 at intensity 0.4
"place background dome center same as mesh sphere" -> mesh: dome lattice evaluated in the CIRCLE_TILT frame, so it is co-axial (not just concentric) with the disc/globe; Dome Distance 0 = exactly the shape center
