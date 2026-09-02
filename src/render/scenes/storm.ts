import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import {
  COMMON_UNIFORMS_GLSL,
  ROOM_UV_GLSL,
  SAMPLE_BANDS_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "../sceneCommon.ts";

// A storm cloud lit from the inside by lightning on every beat — the intra-
// cloud kind, with a hard attack, a couple of return-stroke flickers and an
// afterglow that fades — plus the bolt itself: a jagged polyline that fires
// on the beat in every mode, so the flash is something you see rather than
// something you infer from the gas going bright.
//
// The cloud has one silhouette and several faces (the `mode` setting, options
// MODES). Filaments, the default, traces hair-thin strands through a curl
// field and draws them as additive 1px lines on near-black — the cloud as a
// lit tangle, and nothing else. Mesh is that silhouette contoured on
// the CPU into a lattice of glowing lines and nodes — the cloud as a
// wireframe of itself. Gas is the raymarched volume. Voxel is the same march
// with the sample position quantized and the shading posterized, so the gas
// comes out blocky. Points is the volume's own lobes sampled as a point
// cloud. Whatever the mode, the strike pool is the same and the bolt pass
// draws over the top.
//
// How it's built:
//
//  - Gas and Voxel are one fullscreen pass. For each fragment, a ray is
//    built in the camera's own space and pushed back into *cloud space*
//    (unrotate() undoes CAMERA_GLSL's swirl/tilt and the bass swell), so the
//    density field, the strikes and the march all live in the one space the
//    strike pool stores its segments in. CAMERA_GLSL therefore holds both
//    directions of the same transform, and every geometry pass projects
//    through its forward half (PROJECT_GLSL).
//  - The density is the classic two-part cloud: a silhouette (shapeAt — a
//    smooth union of the lobes, each with its underside falling off faster
//    than its top, so the mass reads as cumulus on a flat base rather than a
//    heap of balls) eroded by fbm read from a tileable 3D RG8 noise texture
//    (buildNoiseVolume). R is value-noise fbm, G is inverted Worley;
//    Schneider's perlin-worley remap of one against the other is what turns
//    filaments into rounded billows. The noise volume tiles, so REPEAT wrap
//    makes the texture coordinate a plain scale of the cloud-space position.
//  - The silhouette is *baked* into its own 3D texture at init rather than
//    evaluated per step: it is entirely static in cloud space (the lobes
//    never move, and the bass swell scales the space, not the field), and
//    running the lobe loop per step — three times over, counting the shadow
//    taps — cost more than everything else in the march put together.
//  - There is not one silhouette but SHAPE_VARIANTS of them, one per channel
//    of a single RGBA8 volume (buildShapeVolume over buildLobeSets), and the
//    `cloudShape` setting walks a phase along them. shapePhaseWeights turns
//    that phase into per-channel weights, uploaded as uShapeMix, so shape()
//    stays one fetch and one dot however the cloud is morphing. On top of
//    the slider sits morphPhase, this scene's own accumulator
//    (advanceMorphPhase): Morph speed sets the rate it glides at and Morph
//    on beat kicks it forward a step on each beat, so the cloud keeps
//    changing with the slider parked and lurches on the music. It is an
//    accumulated phase advanced by a live rate, never elapsed time scaled by
//    one (caustics.ts's driftPhase makes the same point at length), and it
//    wraps, so the variants are a loop rather than a line.
//  - Spectrum -> space (spectrumGain): with the `spectrumMap` switch on, the
//    cloud's resting light is scaled by the band level that belongs where
//    the sample sits — across the screen (Screen) or across the cloud's own
//    x axis, pre-rotation, so the mapping rides the swirl (Cloud). It
//    multiplies the ambient/emissive side of the lighting only, never
//    extinction and never the strike light, so it colours how the cloud is
//    lit without changing what shape it is or how the lightning carries.
//  - shapeAt fades into the bounding ellipsoid the march is clipped to
//    (BOUND_*), so the silhouette is never cut flat by the march bound. The
//    bound is per-axis: wide enough in x/z to hold the outermost lobe's
//    reach, tall enough in y for the tallest, and always inside CAM_DIST even
//    at full swell so the camera never starts the march inside it.
//  - Lightning is a JS-side pool of strikes (createStrikePool), each a short
//    line segment buried in the cloud that acts as a light source. Per-slot
//    strength follows strikeEnvelope — the flicker/afterglow shaping happens
//    on the CPU — and the shader only does the spatial part per march step:
//    distance to each live segment gives a broad in-scattered glow (Flash
//    reach) plus a tight emissive core, the bolt itself, which mostly stays
//    buried but streaks through where the gas above it is thin. The geometry
//    passes light themselves with exactly that formula, factored out as
//    STRIKE_LIGHT_GLSL so the lattice and the points can't drift from it.
//  - What the march adds on top of that falloff, and what the geometry
//    passes can't: a phase term (henyeyGreenstein) so a bolt behind the gas
//    in-scatters harder than one in front of it, and one shadow tap toward
//    the brightest live strike so a clump between here and the channel
//    darkens. Both fade in over STRIKE_SHADE_MIN..FULL rather than switching
//    on, or the gate itself draws a ring. Every mode does share the colour:
//    flashTint grades one flash from white-hot at the channel through the
//    storm's blue to a violet fringe at the edge of its reach, so the gas,
//    the lattice and the points redden alike. The gas's own body is lit by a
//    sun ramp whose shadowed end is a cool blue floor (SHADE_COL) rather
//    than black — bounced skylight is what a cloud's interior is actually
//    lit by, and that colour shift with depth is most of what makes the mass
//    read as a body instead of a grey card. depthFade is the geometry modes'
//    stand-in for the same cue.
//  - Ambient glow reaches a genuine ember. Every resting-light term used to
//    carry a hard floor, so the cloud was always legible and a strike could
//    only brighten it; those floors now slide (ambientFloor — see the
//    "Resting light" block, where AMB_FLOOR_KNEE pins the old value at the
//    setting's own default and AMB_FLOOR_NORM carries the same anchor to the
//    lattice's additive floor). The strike side — the in-scattered glow, the
//    bolt core, the afterglow, every geometry pass's strikeLight — is
//    deliberately not scaled by any of it, which is what lets lightning
//    *reveal* a cloud you couldn't see.
//  - The cloud does not rest evenly lit. It is cut into cells — a Voronoi
//    partition over CELL_SITES read at a noise-warped position, so the
//    borders are torn rather than planar, and Lloyd-relaxed so no cell is a
//    sliver (the "Dark sections" block has the design, and cellIndexAt /
//    sectionGain are its two agreeing halves). Each cell carries a glow
//    envelope: a beat lights a couple at random, a mid or treble rise lights
//    one more gently in between, and every strike lights the cells its own
//    channel runs through — so a bolt leaves its section glowing long after
//    the flash. The envelopes decay on this scene's own measured render
//    interval, slowly enough that a lit section reads as an afterglow over a
//    beat or two. Where it lands: the resting light of every mode and
//    nothing else, on the same terms the spectrum gain multiplies, which is
//    what keeps lightning able to reveal a section the sections have gone
//    dark. How dark that is comes off the `sections` setting, whose Off stop
//    is an exact identity, and it fades out under the ember end of Ambient
//    glow — a cloud already dimmed to nothing can't be sectioned.
//  - What the gas is made of is the `gasType` setting, resolved through
//    GAS_RECIPES: a handful of plain uniforms (GAS_UNIFORMS_GLSL), no extra
//    texture and no change to what buildNoiseVolume bakes. Each field is a
//    factor on an expression the march already had — the noise frequency and
//    per-axis stretch in flowSpace, the Worley weight in puffMask, the
//    erosion, the extinction, the powder, and a tint on the scattered colour
//    (never on the flash). Cumulus's entry is all identity values, which is
//    where "the default is unchanged" is enforced: it is arithmetic that
//    cancels, not a value that happens to match.
//  - Everything accumulates front-to-back with `T` as remaining transmittance
//    (early-out at T < 0.02) over a background of sky gradient plus a faint
//    per-strike haze, and a tighter second lobe of it that stands in for a
//    lens bloom — the only way to give a bolt presence in the geometry modes
//    without a post pass this repo doesn't have. The composite is tonemapped
//    (tonemap) instead of clipped, so a big flash saturates toward white
//    while holding its hue, rather than holding flat white the way the
//    additive geometry passes do (they have no tonemap behind them, which is
//    why their own gains are kept modest).
//  - Cost is bounded by uMaxSteps (MAX_STEPS is the compile-time cap) and by
//    two cheap gates: a step whose silhouette is ~0 costs one fetch and then
//    strides on at double length, and lighting is skipped where the density
//    is negligible. Octave count and the number of shadow taps come off
//    uDetail, so the low preset marches a genuinely cheaper cloud.
//  - Beat trigger: a low-band onset or a broadband beat fires one strike; the
//    pool's refractory window folds the two into a single strike when they
//    land on adjacent frames (they usually do). A drop fires a burst of
//    STRIKE_DROP_BURST strikes that bypass the refractory.
//  - Beats are detected as *rises* in anim.beatPulse / lowPulse / dropPulse
//    rather than from the one-shot flags (frame.beat, anim.lowOnset,
//    anim.dropOnset), and the pool is aged by this scene's own render
//    interval rather than anim.dtSec. Both for the same reason: app.ts/tv.ts
//    advance the anim clock on every rAF tick but rate-cap scene.render()
//    (framePace.ts), so on a 120Hz display a one-shot that lands on a
//    skipped tick never reaches render(), and anim.dtSec is the tick
//    interval, not the time since this scene last drew. A pulse that has
//    risen since the last draw can't be missed, whichever tick it rose on.
//
// The bolt (every mode): a trigger also draws a branched tree — buildBoltTree
// — into the pool's per-slot `path` storage and marks the slot dirty. The
// main channel is a midpoint-displacement polyline between the segment's own
// endpoints; primary branches leave interior vertices of it at an angle and
// may fork once more, all of it deterministic in the strike's rng and packed
// into a fixed per-strike budget (BOLT_PATH_VERTS). render() re-uploads only
// the dirty slots into a DYNAMIC_DRAW VBO and draws each live slot as one
// TRIANGLE_STRIP: line width is stuck at 1 on WebGL whatever gl.lineWidth is
// asked for, so BOLT_VERT expands the path into a camera-facing ribbon
// instead — two vertices per path vertex, pushed apart along the screen-space
// normal of the path's own direction, by a width that tapers to nothing at
// every tip. Brightness is the slot's strikeEnvelope value times the `bolt`
// setting, riding uBeatPulse on top so it visibly answers the beat; `bolt`
// also sets how wide the ribbon draws and how far the branches come up, so
// the one slider spans a bare thin channel to a thick forked tree. The wide
// screen-space halo around a channel is a separate thing entirely — it comes
// off the strike endpoints in the volume pass's background().
//
// The lattice (Mesh mode): the same silhouette, contoured on the CPU. What
// the mesher contours is baked per variant into meshDensityGrids — analytic
// lobes eroded by the retained noise volume, over a MESH_RES^3 lattice — so a
// re-mesh is a lerp between two grids plus buildSurfaceNet, not a re-run of
// the lobe loop. Re-meshing is throttled to shape-phase moves past
// MESH_PHASE_STEP, at most one every MESH_MIN_INTERVAL; the slow drift alone
// trips that about once a second, and between re-meshes MESH_VERT's own churn
// keeps the lattice breathing.
//
// The tangle (Filaments mode): the same seed points, each traced FIL_STEPS
// Euler steps through a curl-noise flow volume (buildFlowVolume) and drawn as
// a run of additive 1px gl.LINES. The trace happens in the vertex shader —
// the buffer holds a seed point, a per-strand random value and a step index,
// nothing more (buildFilamentVertices) — so the tangle re-traces itself every
// frame as the field crawls, with no CPU work and no re-upload. A strand's
// brightness is multiplied by the same baked silhouette the march reads, so
// cloudShape and the morph accumulator eat the tangle into a different mass
// for free; a strike shoves each vertex along its own flow direction, bounded
// by FIL_IMPULSE_MAX, so the lightning moves the hair rather than only
// lighting it. Hairs are faint one at a time and the mass comes from their
// overlap; nothing is drawn behind them — no gas, no dimmed march — so the
// tangle sits on the same flat background every other geometry mode gets and
// the strands are the whole image.
//
// The point cloud (Points mode) is a static VBO sampled at init from the same
// lobes variant 0's silhouette was baked from (buildCloud, seeded with
// CLOUD_SEED so the two agree). Any prefix of the buffer is a representative
// subsample — that is what lets Cloud density simply shrink the draw count.
// The budget comes from ctx.quality.maxParticles through
// particleCountForQuality and is baked at init (switching preset mid-run only
// lands on the next scene switch, the same caveat meshGrid.ts's grid size
// has); uCountBoost inflates sparse clouds so a gallery tile still reads as a
// cloud rather than dust.
const ID = "storm";

const MAX_STRIKES = 8;
const LOBE_COUNT = 9;
const MAX_PARTICLES = 120_000;
const MIN_PARTICLES = 4_000;
// Samples that fall outside the bounding ellipsoid are redrawn this many
// times before being pulled back to the surface — pulling on the first miss
// piled every gaussian tail onto the ellipsoid and drew a hard, dense rim.
const SAMPLE_RETRIES = 8;
/** The `mode` setting's options, in value order. Filaments is the default;
 *  it is appended rather than put first so every mode that shipped before it
 *  keeps the index a saved setting already refers to. */
const MODES: readonly string[] = ["Mesh", "Gas", "Voxel", "Points", "Filaments"];
/** The `spectrumMap` setting's options, in value order — see spectrumGain. */
const SPECTRUM_MAPS: readonly string[] = ["Off", "Screen", "Cloud"];
/** The `gasType` setting's options, in value order — one per entry of
 *  GAS_RECIPES, which is what each of them actually means. */
export const GAS_TYPES: readonly string[] = ["Cumulus", "Wisp", "Smoke", "Nebula"];
const SPECTRUM_MAP_CLOUD = 2;
const MODE_MESH = 0;
const MODE_VOXEL = 2;
const MODE_POINTS = 3;
const MODE_FILAMENTS = 4;
// Bounding ellipsoid half-extents of the cloud, in cloud-space units — where
// the lobe centres are allowed to sit and where the strikes are kept. The
// camera (CAMERA_GLSL) is placed so this fills a comfortable share of the
// frame with room for the bass swell.
const CLOUD_EXTENT_X = 1.6;
const CLOUD_EXTENT_Y = 0.8;
const CLOUD_EXTENT_Z = 1.2;
// The march bound: the lobes' density reaches past CLOUD_EXTENT_*, so the
// clipped volume has to be larger or the silhouette would be sliced flat.
// Per-axis rather than one margin: y needs the most headroom (the extent is
// smallest there but a lobe's reach is the same in every direction), while
// x/z stay comfortably inside CAM_DIST even at full swell, so the camera is
// never inside the bound.
const BOUND_X = CLOUD_EXTENT_X * 1.35;
const BOUND_Y = CLOUD_EXTENT_Y * 1.7;
const BOUND_Z = CLOUD_EXTENT_Z * 1.45;
const STRIKE_REFRACTORY_SEC = 0.06;
const STRIKE_DROP_BURST = 3;
// How long a strike's segment is: a channel that crosses most of the cloud
// rather than one lobe of it. sampleStrikeSegment still keeps both endpoints
// inside the bounding ellipsoid, so however long the draw comes out the light
// source is buried in gas at both ends. Exported for tests/storm.test.ts.
const STRIKE_LEN_MIN = 0.55;
export const STRIKE_LEN_MAX = 1.3;
const CAM_DIST = 3.2;
const CAM_FOV_DEG = 50;
// Compile-time cap on the march; the live count is uMaxSteps (quality.ts).
const MAX_STEPS = 72;
// Cloud-space frequency of the noise volume's base octave: the texture tiles
// over one unit of texture coordinate, so this is "one repeat every 1/f
// cloud units" — kept long enough that the repeat isn't legible across a
// cloud only a few units wide.
const BASE_FREQ = 0.55;
// Edge of the noise volume, in texels. 64^3 RG8 is 512 KB — small enough to
// build on the CPU at init and upload once.
const NOISE_SIZE = 64;
// Edge of the baked shape volume (see shapeAt): the field is smooth over
// roughly a lobe radius, so this only has to be fine enough that trilinear
// filtering doesn't facet it. RGBA8, one silhouette per channel.
const SHAPE_SIZE = 64;
/** How many silhouettes `cloudShape` morphs through — one per channel of the
 *  shape volume, which is what fixes this at four. */
export const SHAPE_VARIANTS = 4;
// The morph accumulator (advanceMorphPhase), in variants:
//  - MORPH_BASE_RATE is the glide rate per second that Morph speed scales,
//    over a mix(0.2, 3.0) span: the fastest setting walks the whole loop of
//    silhouettes in a few seconds, the slowest is about the barely-there
//    drift a parked slider used to get on its own.
//  - MORPH_BEAT_KICK is the largest step one beat can add, and
//  - MORPH_MAX_STEP caps the total of glide plus kick in a single frame, so
//    a drop's burst of beats nudges the shape along instead of teleporting
//    it past a variant (which the re-mesh throttle would then chase).
//  - MORPH_OFF_KNEE gives the slider a genuine Off stop: below it the glide
//    ramps to a true zero, so "Morph speed 0, Morph on beat 0" is a frozen
//    silhouette rather than a slow crawl.
const MORPH_BASE_RATE = 0.12;
const MORPH_BEAT_KICK = 0.3;
export const MORPH_MAX_STEP = 0.35;
const MORPH_OFF_KNEE = 0.05;
// How far past its radius a lobe's density reaches, and how wide the smooth
// union between two lobes is — both in the same cloud-space units as Lobe.r.
const SHAPE_REACH = 1.9;
const SHAPE_BLEND = 0.35;
// Lattices the two channels are built from. Each count wraps over the whole
// volume (see buildNoiseVolume), which is what makes the texture tileable.
const NOISE_VALUE_CELLS = [4, 8, 16];
const NOISE_VALUE_AMPS = [0.5, 0.3, 0.2];
const NOISE_WORLEY_CELLS = [4, 8];
const NOISE_WORLEY_AMPS = [0.65, 0.35];
// Fixes the lobe layout across mounts, so switching in and out of the
// gallery doesn't reshuffle the cloud.
const CLOUD_SEED = 1;

// --- Filaments -------------------------------------------------------------
//
// The flow volume (buildFlowVolume): the curl of a tileable value-noise
// potential, one potential per axis. Curl noise is divergence-free by
// construction, which is exactly what a strand wants to follow — a
// plain-gradient field would funnel every strand into the same sinks, where
// curl keeps them swirling past each other. Same lattice-wrapping trick as
// buildNoiseVolume, so REPEAT wrap makes the coordinate a plain scale of the
// cloud-space position here too.
const FLOW_SIZE = 48;
// Amplitudes fall exactly as fast as the cell counts rise, so every octave
// contributes the same amount of *gradient* — the curl is what gets sampled,
// and an fbm weighted for a flat value spectrum has its finest octave
// dominate the derivative.
const FLOW_VALUE_CELLS = [3, 6, 12];
const FLOW_VALUE_AMPS = [0.6, 0.3, 0.15];
// The fixed scale the raw curl is divided by before it is encoded into
// 0..255. Fixed rather than measured per volume so the field a given seed
// produces never depends on what else is in it: measured over the built
// volume, this puts the bulk of the distribution inside [-1, 1] with only
// the extreme tail clipping.
const FLOW_NORM = 5;
// Steps along the flow each strand is traced for, and how far one step
// carries in cloud units. Their product is a strand's length, kept well
// under the cloud's own width so a hair reads as a hair rather than as a
// wire strung across the whole mass — and short, because the trace is
// O(FIL_STEPS^2) fetches per strand.
const FIL_STEPS = 10;
const FIL_STEP_LEN = 0.06;
// Cloud units -> flow texture coordinate. One repeat of the volume every
// 1/FLOW_FREQ units, with the coarsest lattice (FLOW_VALUE_CELLS[0]) setting
// the largest swirl in it.
const FLOW_FREQ = 1.1;
// One strand costs 2 * FIL_STEPS vertices, so the budget buys a fraction of
// what Points gets particles. The floor is where the tangle stops reading as
// one mass on the cheap presets, and the ceiling is where adding strands
// stops making it look any denser and only costs vertex-stage fetches.
const FIL_STRAND_DIVISOR = 6;
const FIL_MIN_STRANDS = 1_200;
const FIL_MAX_STRANDS = 12_000;
// The largest displacement a strike's light can shove a strand along its own
// flow direction, in cloud units.
const FIL_IMPULSE_MAX = 0.1;
// How much of the gas type's frequency multiplier (GAS_RECIPES.freq) reaches
// the strands' own flow field — see flowCoord in FILAMENT_VERT.
const GAS_FREQ_STRANDS = 0.5;

/** Segments in a bolt's main channel; the channel is this many vertices plus
 *  one. */
export const BOLT_SEGMENTS = 16;
/** Segments in one branch, main or sub — every branch is the same length in
 *  vertices so a branch slot is a fixed stride into the strike's budget. */
export const BOLT_BRANCH_SEGMENTS = 6;
/** Branch slots a strike's tree is allowed. Primary branches and their
 *  sub-branches draw from the one pool, so a bolt with fewer primaries can
 *  spend the difference going a level deeper. */
export const BOLT_MAX_BRANCHES = 6;
/** Path vertices one strike's whole tree is packed into: the main channel
 *  plus every branch slot, filled or not. Fixed, so a slot's slice of the
 *  shared vertex buffer never moves. */
export const BOLT_PATH_VERTS = BOLT_SEGMENTS + 1 + BOLT_MAX_BRANCHES * (BOLT_BRANCH_SEGMENTS + 1);
/** Ribbon vertices per strike: buildBoltTree writes every path vertex twice,
 *  once per side of the ribbon (see its header). */
export const BOLT_RIBBON_VERTS = BOLT_PATH_VERTS * 2;
/** Floats per ribbon vertex: position, tangent, signed half-width, level. */
export const BOLT_VERT_FLOATS = 8;
// Sideways displacement of the coarsest midpoint, as a fraction of the
// polyline's own length — halved at every finer level, so no vertex ends up
// further than about twice this off the straight line. Branches kink harder
// for their length than the channel they came off, which is what keeps a
// short branch from reading as a straight whisker.
const BOLT_JITTER = 0.22;
const BOLT_BRANCH_JITTER = 0.34;
// How many primary branches leave the main channel, and how likely each of
// them is to fork once more while a branch slot is left.
const BOLT_BRANCH_MIN = 3;
const BOLT_BRANCH_MAX = 4;
const BOLT_SUB_CHANCE = 0.65;
// A branch's length as a fraction of its parent's, and how far off the
// parent's own direction it leaves, in radians. Both ends of the angle range
// stay well short of a right angle: a branch that leaves sideways reads as a
// separate bolt rather than as part of this one.
const BOLT_BRANCH_LEN_MIN = 0.22;
const BOLT_BRANCH_LEN_MAX = 0.5;
const BOLT_BRANCH_ANGLE_MIN = 0.35;
const BOLT_BRANCH_ANGLE_MAX = 0.95;
// A branch's peak width as a fraction of its parent's width where it leaves.
const BOLT_BRANCH_WIDTH = 0.62;
// The width profile along a polyline: sin(pi * t) raised to this, so a
// channel is 0 wide at both tips (which is what lets one triangle strip run
// through every polyline in the tree — the joins between them collapse) and
// broad across its middle rather than a lens. Below 1 it plateaus; the lower
// it goes the more of the channel is at full width.
const BOLT_TAPER_POW = 0.35;
// The ribbon's half-width in pixels across the width of its plateau, at the
// two ends of the `bolt` setting, on a 1080-tall slice. Half-width: the drawn
// channel is twice this, and the fragment shader's core sits inside it.
const BOLT_HALF_MIN_PX = 1.2;
const BOLT_HALF_MAX_PX = 7.0;

// The lattice: cells along each axis of the bounding box at full detail and
// at the cheap presets. The mesher is O(res^3) and the baked density grids
// are (res+1)^3 floats per variant, so this is the one number that decides
// what Mesh mode costs.
const MESH_RES_HIGH = 40;
const MESH_RES_LOW = 24;
// Where the lattice sits in the density field, how far the shape phase has to
// move before a re-mesh is worth it, and the shortest gap between re-meshes
// (a slider drag would otherwise re-contour every frame).
const MESH_ISO = 0.34;
const MESH_PHASE_STEP = 0.02;
const MESH_MIN_INTERVAL = 0.12;
// Capacity of the lattice's buffers. A surface through a res^3 lattice puts
// vertices on the order of res^2 cells, so these hold several times what the
// full-detail mesh actually comes to; anything past them is dropped rather
// than reallocating mid-frame.
const MESH_MAX_VERTS = 20_000;
const MESH_MAX_INDICES = 80_000;

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small
// throughout: it floors near 0.9 on any locked-tempo track (see the Focus
// snap comment in caustics.ts), so a large pulse weight is really a constant
// offset in disguise.
const SETTINGS: SceneSetting[] = [
  // "Look" leads so the picker sits at the top of the device menu: it decides
  // what the rest of the settings are even acting on.
  {
    key: "mode",
    label: "Mode",
    description: "Filaments traces the cloud as a tangle of glowing strands; Mesh is a digital lattice; Gas is the raymarched volume; Voxel is that volume gone blocky; Points is a point cloud.",
    group: "Look",
    type: "enum",
    options: MODES,
    min: 0,
    max: MODES.length - 1,
    step: 1,
    default: MODE_FILAMENTS,
  },
  {
    // Manual by design, like every enum: an auto table would be picking a
    // mapping for the viewer, and Off/Screen/Cloud are three different looks
    // rather than three amounts of one.
    key: "spectrumMap",
    label: "Spectrum map",
    description: "Lights the cloud by frequency: Screen splits the spectrum left-to-right across the frame, Cloud pins it to the cloud so it spins with the swirl.",
    group: "Look",
    type: "enum",
    options: SPECTRUM_MAPS,
    min: 0,
    max: SPECTRUM_MAPS.length - 1,
    step: 1,
    default: 1,
  },
  {
    key: "strike",
    label: "Strike intensity",
    description: "How hard each beat's lightning lights the cloud",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.75,
    auto: { attack: 0.3, pulse: 0.15 },
  },
  {
    key: "reach",
    label: "Flash reach",
    description: "How far into the cloud a strike's light carries",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.65,
    auto: { density: -0.2, dynamics: 0.2 },
  },
  {
    key: "flicker",
    label: "Flicker",
    description: "Return strokes: how many times a strike re-flashes before it fades",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.25 },
  },
  {
    key: "afterglow",
    label: "Afterglow",
    description: "How long a strike keeps glowing after the flash",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: -0.3, pulse: 0.15 },
  },
  {
    key: "bolt",
    label: "Bolt",
    description: "How much bolt each beat draws: from a thin bare channel up to a thick, brightly forked one",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.3 },
  },
  {
    key: "sections",
    label: "Dark sections",
    description: "Rests the cloud in dark regions and lights them one or two at a time — on beats, on treble hits, and wherever a bolt lands",
    group: "Beat",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { dynamics: 0.3, attack: 0.2 },
  },
  {
    // Manual by design, like every enum (see spectrumMap): the four gases are
    // four characters, not four amounts of one thing, and GAS_RECIPES is what
    // each of them means.
    key: "gasType",
    label: "Gas",
    description: "What the cloud is made of: Cumulus is the puffy default, Wisp a thin streaky stratus, Smoke a dark torn charcoal, Nebula a glowing translucent haze",
    group: "Cloud",
    type: "enum",
    options: GAS_TYPES,
    min: 0,
    max: GAS_TYPES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "density",
    label: "Cloud density",
    description: "How thick the gas is — and, in Points mode, how many particles are drawn",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.3 },
  },
  {
    key: "cloudShape",
    label: "Cloud shape",
    description: "Morphs the cloud through its silhouettes — a different mass at every setting",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { density: 0.3, dynamics: 0.2 },
  },
  {
    key: "morphSpeed",
    label: "Morph speed",
    description: "How fast the cloud glides from one silhouette to the next — Off holds the shape still",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.3 },
  },
  {
    key: "morphBeat",
    label: "Morph on beat",
    description: "How far each beat lurches the cloud's shape forward",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { pulse: 0.2, attack: 0.2 },
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the filament tangle crawls along its flow field, and how hard a strike shoves it",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "swirl",
    label: "Swirl speed",
    description: "How fast the cloud turns",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.35, pulse: 0.15 },
  },
  {
    key: "swell",
    label: "Bass swell",
    description: "How much the low band puffs the cloud up",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: -0.35 },
  },
  {
    key: "ambient",
    label: "Ambient glow",
    description: "Resting brightness of the cloud between strikes — near zero leaves an ember for the lightning to reveal",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { loudness: 0.3, brightness: 0.2 },
  },
  {
    // Keyed `grain`, not `detail`: settingUniformName would make that
    // `uDetail`, which COMMON_UNIFORMS_GLSL already owns as the quality proxy
    // — two declarations of the same name is a shader compile error.
    key: "grain",
    label: "Detail",
    description: "How hard the noise erodes the cloud into billows, how big a voxel is, how big each point or lattice node draws, and how brightly a filament burns",
    group: "Cloud",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
  },
  {
    key: "spark",
    label: "Treble wisps",
    description: "Fine detail the high band frays into the cloud's edges — a shimmer across the lattice in Mesh mode",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.35 },
  },
  {
    key: "spectrumGlow",
    label: "Spectrum glow",
    description: "How hard the band level under a part of the cloud drives how brightly it is lit (needs Spectrum map)",
    group: "Sparkle",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25, density: 0.2 },
  },
  {
    key: "dropStorm",
    label: "Drop reactivity",
    description: "Size of the lightning burst on a detected drop",
    group: "Dynamics",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.45 },
  },
];

const settingByKey = new Map(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const spec = settingByKey.get(key);
  if (!spec) throw new Error(`storm: unknown setting "${key}"`);
  return spec;
}

// --- Resting light ---------------------------------------------------------
//
// Every term that lights the cloud between strikes used to carry a hard floor
// — mix(0.35, 1.0, uAmbient) in the march, a bare 0.18 in the lattice — so
// Ambient glow at 0 still left a legible grey cloud, and lightning could only
// ever brighten something already visible. What replaced the constant floor
// is a floor that *moves* with the slider (ambientFloor in AMBIENT_LIFT_GLSL,
// which every one of those terms now goes through):
//
//   mix(AMB_FLOOR_REST, AMB_FLOOR_FULL, min(1.0, a / AMB_FLOOR_KNEE))
//
// The knee is the `ambient` setting's own default, and AMB_FLOOR_FULL is the
// exact floor the march has always had — so at and above the default every
// lighting expression evaluates to what it evaluated to before, not merely
// close to it, and the range the change actually unlocks is the quarter of
// the slider underneath, where the floor slides away to AMB_FLOOR_REST and
// the cloud stops being a cloud and becomes an ember. Anchoring by clamping
// rather than by solving an exponent is what buys the "identical above the
// knee" half; it costs a corner in the slider's response at the knee, which
// is the same trade MORPH_OFF_KNEE makes at the other end of its own slider.
//
// Nothing on the strike side goes through any of it (see STRIKE_LIGHT_GLSL
// and `flash` in the march): that independence is the whole point, since it
// is what lets a bolt *reveal* an ember-dark cloud rather than merely
// brighten a lit one.
const AMB_FLOOR_REST = 0.03;
const AMB_FLOOR_FULL = 0.35;
/** Where the floor reaches AMB_FLOOR_FULL and stops: the `ambient` setting's
 *  own default, so the default frame is the frame it always was. */
const AMB_FLOOR_KNEE = settingFor("ambient").default;

// ---------------------------------------------------------------------------
// Pure helpers — no GL at import time, exported for tests/storm.test.ts.

/** What one `gasType` option does to the cloud. Every field is a *factor* on
 *  an expression the march already had, never a replacement for one, so the
 *  whole system collapses to a no-op at identity — which is exactly what the
 *  Cumulus entry is, and what tests/storm.test.ts pins. */
export interface GasRecipe {
  /** Multiplies the noise frequency in flowSpace(), so the same field reads
   *  as bigger or smaller billows — and, at half strength, how tightly the
   *  Filaments strands curl. */
  freq: number;
  /** Per-axis stretch on top of `freq`, applied in the same place: a value
   *  below 1 on an axis draws the noise out along it. Flattening y while
   *  drawing x/z out is what makes a stratus sheet out of a cumulus. */
  stretch: [number, number, number];
  /** Multiplies erosionAmount() — how deep the fbm eats into the
   *  silhouette, so how torn the mass is. */
  erosion: number;
  /** Weight on the inverted-Worley channel inside puffMask(): the perlin-
   *  worley remap's low end. Above 1 the Worley cells fill in and the mass
   *  rounds off; below 1 they cut, and the billows tear into filaments. */
  worley: number;
  /** Multiplies the extinction coefficient — how much light one unit of gas
   *  swallows, so how solid or how translucent the cloud reads. */
  extinction: number;
  /** Scales how hard the powder term darkens thin gas. Near zero the gas
   *  stops self-shading and glows from the inside instead. */
  powder: number;
  /** Multiplies the scattered colour — the sun ramp and the skylight, never
   *  the strike. Components above 1 lift that gas type's resting response as
   *  well as tinting it. */
  tint: [number, number, number];
}

/** One recipe per GAS_TYPES entry, in the same order (the setting's value is
 *  the index). Cumulus is all identity values by construction: every
 *  expression the recipe touches reduces to what it was before the setting
 *  existed, which is what makes the default frame unchanged rather than
 *  merely close. */
export const GAS_RECIPES: readonly GasRecipe[] = [
  // Cumulus — today's puffy cauliflower, untouched.
  { freq: 1, stretch: [1, 1, 1], erosion: 1, worley: 1, extinction: 1, powder: 1, tint: [1, 1, 1] },
  // Wisp — stratus: finer noise drawn out sideways and flattened hard in y,
  // thin enough to see through, with the Worley cutting rather than filling.
  {
    freq: 1.5,
    stretch: [0.5, 2.4, 0.75],
    erosion: 1.2,
    worley: 0.7,
    extinction: 0.65,
    powder: 0.85,
    tint: [0.85, 0.95, 1.15],
  },
  // Smoke — charcoal: dense, deeply eroded so it curls and tears, and lit
  // down to a desaturated grey so the mass reads dark against its own flash.
  {
    freq: 1.15,
    stretch: [0.9, 1.3, 0.9],
    erosion: 1.3,
    worley: 0.85,
    extinction: 1.9,
    powder: 1.25,
    tint: [0.78, 0.74, 0.76],
  },
  // Nebula — the opposite end: coarse and translucent, barely self-shading,
  // with the sun ramp graded magenta at the lit end and teal-violet at the
  // shadowed one so it glows from within instead of turning.
  {
    freq: 0.7,
    stretch: [1, 1, 1],
    erosion: 0.8,
    worley: 1.3,
    extinction: 0.45,
    powder: 0.3,
    tint: [1.6, 0.95, 1.75],
  },
];

/** mulberry32: a small deterministic PRNG so the cloud (and tests) are
 *  reproducible for a given seed. Returns values in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic [0,1) hash of a (seed, index) pair — what strikeEnvelope
 *  uses to place return strokes, so a given strike flickers the same way on
 *  every tick rather than jittering. */
function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface Lobe {
  cx: number;
  cy: number;
  cz: number;
  /** Radius of the lobe: the shader's shape() reaches somewhat past this. */
  r: number;
}

/** Pushes a point back inside the bounding ellipsoid (scaled by `margin`)
 *  along the ray from its centre. Points already inside are untouched. */
function clampToEllipsoid(p: [number, number, number], margin = 1): [number, number, number] {
  const ex = CLOUD_EXTENT_X * margin;
  const ey = CLOUD_EXTENT_Y * margin;
  const ez = CLOUD_EXTENT_Z * margin;
  const e = (p[0] / ex) ** 2 + (p[1] / ey) ** 2 + (p[2] / ez) ** 2;
  if (e <= 1) return p;
  const s = 1 / Math.sqrt(e);
  return [p[0] * s, p[1] * s, p[2] * s];
}

/** True when a point lies within the bounding ellipsoid (with a hair of
 *  tolerance for float rounding). */
export function insideCloud(x: number, y: number, z: number): boolean {
  return (x / CLOUD_EXTENT_X) ** 2 + (y / CLOUD_EXTENT_Y) ** 2 + (z / CLOUD_EXTENT_Z) ** 2 <= 1 + 1e-6;
}

export function buildLobes(rng: () => number, count = LOBE_COUNT): Lobe[] {
  const lobes: Lobe[] = [];
  for (let i = 0; i < count; i++) {
    // Centres sit well inside the ellipsoid so the lobes' own falloff, not
    // the centres, defines the silhouette.
    const c = clampToEllipsoid([
      (rng() * 2 - 1) * CLOUD_EXTENT_X * 0.85,
      (rng() * 2 - 1) * CLOUD_EXTENT_Y * 0.6,
      (rng() * 2 - 1) * CLOUD_EXTENT_Z * 0.85,
    ], 0.8);
    const r = 0.25 + rng() * 0.25;
    lobes.push({ cx: c[0], cy: c[1], cz: c[2], r });
  }
  return lobes;
}

/** The silhouettes `cloudShape` morphs through, in channel order. Variant 0
 *  is the plain CLOUD_SEED layout — the one buildCloud samples — so the point
 *  cloud and the gas still agree at phase 0. */
export function buildLobeSets(seed = CLOUD_SEED, variants = SHAPE_VARIANTS): Lobe[][] {
  const sets: Lobe[][] = [];
  for (let i = 0; i < variants; i++) sets.push(buildLobes(createRng(seed + i * 7919)));
  return sets;
}

/** Picks a lobe uniformly — every lobe gets its turn at hosting a strike,
 *  instead of the biggest one taking most of the lightning. */
function pickLobe(rng: () => number, lobes: Lobe[]): Lobe {
  return lobes[Math.min(lobes.length - 1, Math.floor(rng() * lobes.length))];
}

/** Picks a lobe by volume (r^3), so a big lobe gets its share of the particle
 *  budget and the point cloud reads as one mass rather than a ring of equal
 *  puffs. Strikes use the uniform pickLobe instead. */
function pickLobeByVolume(rng: () => number, lobes: Lobe[]): Lobe {
  let total = 0;
  for (const l of lobes) total += l.r ** 3;
  let x = rng() * total;
  for (const l of lobes) {
    x -= l.r ** 3;
    if (x <= 0) return l;
  }
  return lobes[lobes.length - 1];
}

/** Samples the particle cloud. Positions are xyz triples in cloud space;
 *  seeds are per-particle [0,1) values the shader uses for size, churn phase
 *  and sparkle selection. Deterministic for a given seed, and — because
 *  buildLobes is the first thing drawn from the seeded rng, as in
 *  buildLobeSets' first variant — the lobes it returns for CLOUD_SEED are
 *  exactly the ones variant 0 of the silhouette volume was baked from, so
 *  points and gas share a cloud. Particles are laid down in no lobe order, so
 *  any prefix of the buffer is a representative subsample and Cloud density
 *  can just shorten the draw. */
export function buildCloud(count: number, seed = CLOUD_SEED): {
  positions: Float32Array;
  seeds: Float32Array;
  lobes: Lobe[];
} {
  const rng = createRng(seed);
  const lobes = buildLobes(rng);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const l = pickLobeByVolume(rng, lobes);
    let p: [number, number, number] = [0, 0, 0];
    for (let attempt = 0; attempt <= SAMPLE_RETRIES; attempt++) {
      p = [l.cx + l.r * gaussian(rng), l.cy + l.r * 0.7 * gaussian(rng), l.cz + l.r * gaussian(rng)];
      if (insideCloud(p[0], p[1], p[2])) break;
    }
    p = clampToEllipsoid(p);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    seeds[i] = rng();
  }
  return { positions, seeds, lobes };
}

/** The particle budget this scene actually allocates for a quality preset's
 *  `maxParticles`: enough that the floor preset still reads as a cloud, and
 *  capped where additive fill rate stops paying for itself. */
export function particleCountForQuality(maxParticles: number): number {
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.floor(maxParticles)));
}

/** How many strands Filaments mode traces out of the same budget. A strand
 *  costs 2 * FIL_STEPS vertices where a particle costs one, so this is a
 *  fraction of the particle count — with its own floor, since the cheap
 *  presets' budgets divide down to a handful of hairs. */
export function filamentStrandCount(maxParticles: number): number {
  const n = Math.floor(particleCountForQuality(maxParticles) / FIL_STRAND_DIVISOR);
  return Math.max(FIL_MIN_STRANDS, Math.min(FIL_MAX_STRANDS, n));
}

/** The strand vertex buffers, laid out for one gl.LINES draw: for strand `s`
 *  and step `j`, the pair of vertices (j, j+1). Both carry the strand's seed
 *  point and per-strand random value unchanged — where the vertex actually
 *  lands is the shader's business (it integrates `step` steps along the flow
 *  volume), so nothing here has to be rebuilt when the field moves.
 *
 *  Strands are taken as a prefix of the point cloud's own samples, which
 *  buildCloud guarantees is a representative subsample — so Cloud density can
 *  shorten the draw here exactly as it does in Points. */
export function buildFilamentVertices(
  seedPositions: Float32Array,
  seedValues: Float32Array,
  strands: number,
  steps = FIL_STEPS,
): { positions: Float32Array; seeds: Float32Array; steps: Float32Array } {
  const verts = strands * steps * 2;
  const positions = new Float32Array(verts * 3);
  const seeds = new Float32Array(verts);
  const stepIndex = new Float32Array(verts);
  let o = 0;
  for (let s = 0; s < strands; s++) {
    const x = seedPositions[s * 3];
    const y = seedPositions[s * 3 + 1];
    const z = seedPositions[s * 3 + 2];
    const seed = seedValues[s];
    for (let j = 0; j < steps; j++) {
      for (let end = 0; end < 2; end++) {
        positions[o * 3] = x;
        positions[o * 3 + 1] = y;
        positions[o * 3 + 2] = z;
        seeds[o] = seed;
        stepIndex[o] = j + end;
        o++;
      }
    }
  }
  return { positions, seeds, steps: stepIndex };
}

// --- The noise volume -------------------------------------------------------
//
// Two channels, both tileable: R is value-noise fbm ("where is there gas at
// all"), G is inverted Worley ("where are the billow cores"). The shader
// pairs them with Schneider's remap so the value noise's filaments are
// rounded into puffs. Tileability comes from every lattice wrapping modulo
// its own cell count over the [0,1) volume: the field is periodic with period
// 1, so texel `size` is texel 0 and REPEAT wrap has no seam.

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** cells^3 random lattice values, in x-fastest order. */
function valueLattice(rng: () => number, cells: number): Float32Array {
  const table = new Float32Array(cells * cells * cells);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  return table;
}

/** One jittered feature point per cell, as an in-cell [0,1) offset triple. */
function worleyPoints(rng: () => number, cells: number): Float32Array {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  return pts;
}

/** Trilinear value noise at (x,y,z) in [0,1), wrapping at the volume edge. */
function sampleValue(table: Float32Array, cells: number, x: number, y: number, z: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const fz = z * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = smootherstep(fx - ix);
  const ty = smootherstep(fy - iy);
  const tz = smootherstep(fz - iz);
  const x0 = wrapIndex(ix, cells);
  const x1 = wrapIndex(ix + 1, cells);
  const y0 = wrapIndex(iy, cells);
  const y1 = wrapIndex(iy + 1, cells);
  const z0 = wrapIndex(iz, cells);
  const z1 = wrapIndex(iz + 1, cells);
  const at = (xi: number, yi: number, zi: number) => table[(zi * cells + yi) * cells + xi];
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = mix(at(x0, y0, z0), at(x1, y0, z0), tx);
  const c10 = mix(at(x0, y1, z0), at(x1, y1, z0), tx);
  const c01 = mix(at(x0, y0, z1), at(x1, y0, z1), tx);
  const c11 = mix(at(x0, y1, z1), at(x1, y1, z1), tx);
  return mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
}

/** Distance to the nearest feature point, in cell units, clamped to 1 —
 *  searched over the 27 neighbouring cells with wrapped indices so the field
 *  is periodic. */
function sampleWorley(pts: Float32Array, cells: number, x: number, y: number, z: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const fz = z * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const o = ((wrapIndex(cz, cells) * cells + wrapIndex(cy, cells)) * cells + wrapIndex(cx, cells)) * 3;
        const ex = cx + pts[o] - fx;
        const ey = cy + pts[o + 1] - fy;
        const ez = cz + pts[o + 2] - fz;
        const e = ex * ex + ey * ey + ez * ez;
        if (e < best) best = e;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

/** The 3D noise volume, `size`^3 texels of RG8 in x-fastest order (the layout
 *  texImage3D wants). Deterministic for a given seed; pure and node-safe so
 *  tests/storm.test.ts can check it without a GL context. */
export function buildNoiseVolume(size: number = NOISE_SIZE, seed = 1): Uint8Array {
  const rng = createRng(seed);
  const valueTables = NOISE_VALUE_CELLS.map((cells) => valueLattice(rng, cells));
  const worleyTables = NOISE_WORLEY_CELLS.map((cells) => worleyPoints(rng, cells));
  const data = new Uint8Array(size * size * size * 2);
  let o = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        let value = 0;
        for (let k = 0; k < NOISE_VALUE_CELLS.length; k++) {
          value += NOISE_VALUE_AMPS[k] * sampleValue(valueTables[k], NOISE_VALUE_CELLS[k], u, v, w);
        }
        let puff = 0;
        for (let k = 0; k < NOISE_WORLEY_CELLS.length; k++) {
          puff += NOISE_WORLEY_AMPS[k] * (1 - sampleWorley(worleyTables[k], NOISE_WORLEY_CELLS[k], u, v, w));
        }
        data[o++] = Math.max(0, Math.min(255, Math.round(value * 255)));
        data[o++] = Math.max(0, Math.min(255, Math.round(puff * 255)));
      }
    }
  }
  return data;
}

/** Trilinear read of one channel of a `size`^3 RG8 volume at a texture
 *  coordinate, wrapping — the CPU twin of the shader's texture(uNoise, ...),
 *  down to sampling at texel centres, so the lattice sits in the same billows
 *  the march draws. Returns 0..1. */
function noiseAt(data: Uint8Array, size: number, x: number, y: number, z: number, channel: number): number {
  const fx = x * size - 0.5;
  const fy = y * size - 0.5;
  const fz = z * size - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const ty = fy - iy;
  const tz = fz - iz;
  const x0 = wrapIndex(ix, size);
  const x1 = wrapIndex(ix + 1, size);
  const y0 = wrapIndex(iy, size);
  const y1 = wrapIndex(iy + 1, size);
  const z0 = wrapIndex(iz, size);
  const z1 = wrapIndex(iz + 1, size);
  const at = (xi: number, yi: number, zi: number) => data[(((zi * size + yi) * size + xi) * 2) + channel] / 255;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = mix(at(x0, y0, z0), at(x1, y0, z0), tx);
  const c10 = mix(at(x0, y1, z0), at(x1, y1, z0), tx);
  const c01 = mix(at(x0, y0, z1), at(x1, y0, z1), tx);
  const c11 = mix(at(x0, y1, z1), at(x1, y1, z1), tx);
  return mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
}

// --- The flow volume --------------------------------------------------------
//
// Filaments mode's field: the curl of a vector potential whose three
// components are independent tileable value-noise fbms. Curl noise is
// divergence-free, so a strand traced through it swirls past its neighbours
// instead of being funnelled into a sink the way a plain gradient field would
// funnel it — that difference is the whole reason the tangle reads as hair
// rather than as a comb.
//
// The potential is evaluated onto a grid first and the curl taken as central
// differences *on that grid*, one texel apart with wrapped indices. Both
// halves of that matter: sampling the potential once per texel instead of six
// times per derivative is what keeps the build affordable, and differencing
// wrapped grid neighbours is what makes the curl itself periodic — a field
// sampled with REPEAT has no seam to cross.

/** The flow field, `size`^3 texels of RGB8 in x-fastest order: a curl-noise
 *  vector per texel, each component scaled by FLOW_NORM and encoded from
 *  [-1, 1] into 0..255 the way a normal map is. Deterministic for a given
 *  seed; pure and node-safe, like buildNoiseVolume. */
export function buildFlowVolume(size: number = FLOW_SIZE, seed = 1): Uint8Array {
  const rng = createRng(seed);
  const n = size * size * size;
  // Three potentials, sampled onto the same grid the curl is taken over.
  const pot: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    const tables = FLOW_VALUE_CELLS.map((cells) => valueLattice(rng, cells));
    const grid = new Float32Array(n);
    let o = 0;
    for (let z = 0; z < size; z++) {
      const w = z / size;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          let s = 0;
          for (let k = 0; k < FLOW_VALUE_CELLS.length; k++) {
            s += FLOW_VALUE_AMPS[k] * sampleValue(tables[k], FLOW_VALUE_CELLS[k], u, v, w);
          }
          grid[o++] = s;
        }
      }
    }
    pot.push(grid);
  }

  const at = (c: number, x: number, y: number, z: number) =>
    pot[c][(wrapIndex(z, size) * size + wrapIndex(y, size)) * size + wrapIndex(x, size)];
  // Central difference over two texels, in the same units the potential's
  // domain is measured in (the volume spans 1).
  const inv = size / 2;
  const data = new Uint8Array(n * 3);
  let o = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dxdy = (at(0, x, y + 1, z) - at(0, x, y - 1, z)) * inv;
        const dxdz = (at(0, x, y, z + 1) - at(0, x, y, z - 1)) * inv;
        const dydx = (at(1, x + 1, y, z) - at(1, x - 1, y, z)) * inv;
        const dydz = (at(1, x, y, z + 1) - at(1, x, y, z - 1)) * inv;
        const dzdx = (at(2, x + 1, y, z) - at(2, x - 1, y, z)) * inv;
        const dzdy = (at(2, x, y + 1, z) - at(2, x, y - 1, z)) * inv;
        const cx = dzdy - dydz;
        const cy = dxdz - dzdx;
        const cz = dydx - dxdy;
        data[o++] = encodeSigned(cx / FLOW_NORM);
        data[o++] = encodeSigned(cy / FLOW_NORM);
        data[o++] = encodeSigned(cz / FLOW_NORM);
      }
    }
  }
  return data;
}

/** [-1, 1] -> 0..255, clamping outside. The exact inverse of the shader's
 *  `texture(...).rgb * 2.0 - 1.0`. */
function encodeSigned(v: number): number {
  return Math.max(0, Math.min(255, Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * 255)));
}

// --- The shape field -------------------------------------------------------
//
// The analytic silhouette, baked once into a 3D texture. It is entirely
// static in cloud space — the lobes never move, and the bass swell is a
// transform of the space rather than of the field — so evaluating the lobe
// loop per march step (three times over, counting the shadow taps) was the
// single most expensive thing this scene did. One texel fetch replaces it.

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The cloud's analytic silhouette at a point in cloud space, in 0..1:
 *  a smooth union of the lobes, each stretched so its underside falls off
 *  faster than its top (cumulus sits on a flat-ish base, rather than reading
 *  as a ball), faded out into the bounding ellipsoid the shader marches. */
export function shapeAt(lobes: Lobe[], x: number, y: number, z: number): number {
  let s = 0;
  for (const l of lobes) {
    const dx = x - l.cx;
    const dz = z - l.cz;
    let dy = y - l.cy;
    if (dy < 0) dy /= 0.6;
    const r = l.r * SHAPE_REACH;
    const si = 1 - (dx * dx + dy * dy + dz * dz) / (r * r);
    // Smooth union, not a plain max: a hard max leaves each lobe reading as
    // its own ball, while the blend swells the seam between two lobes into
    // one mass the way neighbouring cumulus turrets merge.
    const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (si - s)) / SHAPE_BLEND));
    s = s + (si - s) * h + SHAPE_BLEND * h * (1 - h);
  }
  const e = Math.sqrt((x / BOUND_X) ** 2 + (y / BOUND_Y) ** 2 + (z / BOUND_Z) ** 2);
  return Math.min(1, Math.max(0, s)) * (1 - smoothstep01(0.72, 1, e));
}

/** Which two silhouettes a shape phase sits between, and how far along it is
 *  from the first to the second. The phase wraps — the variants are a loop,
 *  not a line — so the slow drift keeps morphing forever instead of parking
 *  on the last one. The two weights are (1 - f) and f, so they sum to 1 by
 *  construction. */
export function shapePhaseWeights(phase: number, variants = SHAPE_VARIANTS): { a: number; b: number; f: number } {
  const n = Math.max(1, Math.floor(variants));
  let p = Number.isFinite(phase) ? phase % n : 0;
  if (p < 0) p += n;
  const a = Math.min(n - 1, Math.floor(p));
  return { a, b: (a + 1) % n, f: p - a };
}

/** One frame of the shape morph, in variants — the phase `cloudShape` is
 *  offset by, so the cloud keeps moving with the slider parked.
 *
 *  An accumulator, deliberately: the rate is a live setting, and scaling
 *  already-elapsed time by a live value teleports the phase the moment the
 *  value changes (caustics.ts's driftPhase header explains the same trap at
 *  length). So this integrates a rate instead, and only ever moves forward —
 *  the morph is a loop through the variants, not something that can rewind
 *  under a slider drag.
 *
 *  `beatAmp` is the amplitude of a beat that rose on *this* frame and 0 on
 *  every other, so the kick lands once per beat rather than for as long as a
 *  pulse stays high. Both the kick on its own and the frame's whole step are
 *  capped, so a drop firing several strikes at once nudges the shape along
 *  instead of jumping it past a variant. */
export function advanceMorphPhase(
  prev: number,
  dtSec: number,
  morphSpeed: number,
  morphBeat: number,
  beatAmp: number,
): number {
  const from = Number.isFinite(prev) ? prev : 0;
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  const speed = Number.isFinite(morphSpeed) ? Math.min(1, Math.max(0, morphSpeed)) : 0;
  const beat = Number.isFinite(morphBeat) ? Math.min(1, Math.max(0, morphBeat)) : 0;
  const amp = Number.isFinite(beatAmp) ? Math.max(0, beatAmp) : 0;
  // The Off stop: the speed curve bottoms out at a slow crawl rather than a
  // standstill, which is right everywhere except at the slider's own zero,
  // where a speed control has to actually stop.
  const glide = MORPH_BASE_RATE * (0.2 + 2.8 * speed) * Math.min(1, speed / MORPH_OFF_KNEE);
  const kick = Math.min(MORPH_BEAT_KICK * beat * amp, MORPH_BEAT_KICK);
  return from + Math.min(MORPH_MAX_STEP, dt * glide + kick);
}

/** shapeAt sampled over the bounding box as `size`^3 texels of RGBA8,
 *  x-fastest — one silhouette per channel, in lobeSets order. Texel centres
 *  land on ((i + 0.5) / size * 2 - 1) * BOUND, which is exactly what the
 *  shader's `p / (2 * BOUND) + 0.5` lookup addresses. Every texel on a box
 *  face is outside the ellipsoid and so reads 0 in every channel, which is
 *  what makes CLAMP_TO_EDGE safe. */
export function buildShapeVolume(size: number, lobeSets: Lobe[][]): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let k = 0; k < size; k++) {
    const z = (((k + 0.5) / size) * 2 - 1) * BOUND_Z;
    for (let j = 0; j < size; j++) {
      const y = (((j + 0.5) / size) * 2 - 1) * BOUND_Y;
      for (let i = 0; i < size; i++) {
        const x = (((i + 0.5) / size) * 2 - 1) * BOUND_X;
        for (let c = 0; c < 4; c++) {
          data[o++] = Math.round(shapeAt(lobeSets[Math.min(c, lobeSets.length - 1)], x, y, z) * 255);
        }
      }
    }
  }
  return data;
}

// --- The lattice ------------------------------------------------------------
//
// Mesh mode contours the same silhouette the march draws. The field is baked
// per variant (meshDensityGrids) so a re-mesh only lerps two grids;
// buildSurfaceNet then walks the cells and emits one vertex per straddling
// cell, linked to its straddling +x/+y/+z neighbours. Written as independent
// work — no case tables and no triangles: a lattice of lines and nodes is
// what this mode wants to draw anyway.

/** The mesher's density at a point in cloud space: the analytic silhouette
 *  eroded by the same noise volume the march reads, with no flow offset (the
 *  grid is baked, so the field has to be static; the lattice's motion comes
 *  from the shape morph and MESH_VERT's churn). */
function meshDensityAt(lobes: Lobe[], noise: Uint8Array, x: number, y: number, z: number): number {
  const sh = shapeAt(lobes, x, y, z);
  if (sh <= 0.02) return 0;
  const u = x * BASE_FREQ;
  const v = y * BASE_FREQ;
  const w = z * BASE_FREQ;
  const value = noiseAt(noise, NOISE_SIZE, u, v, w, 0);
  const puff = noiseAt(noise, NOISE_SIZE, u, v, w, 1);
  return sh * (0.55 + 1.2 * (0.6 * value + 0.4 * puff - 0.5));
}

/** meshDensityAt over the bounding box: one (res+1)^3 grid of corner values
 *  per silhouette. Baked once per resolution, because the lobe loop is far
 *  too expensive to run inside a re-mesh — with these in hand a re-mesh is a
 *  lerp between two of them. */
export function meshDensityGrids(res: number, lobeSets: Lobe[][], noise: Uint8Array): Float32Array[] {
  const n = res + 1;
  return lobeSets.map((lobes) => {
    const grid = new Float32Array(n * n * n);
    let o = 0;
    for (let k = 0; k < n; k++) {
      const z = ((k / res) * 2 - 1) * BOUND_Z;
      for (let j = 0; j < n; j++) {
        const y = ((j / res) * 2 - 1) * BOUND_Y;
        for (let i = 0; i < n; i++) {
          grid[o++] = meshDensityAt(lobes, noise, ((i / res) * 2 - 1) * BOUND_X, y, z);
        }
      }
    }
    return grid;
  });
}

// The twelve edges of a cell, as pairs of corner indices. A corner index
// carries its own (dx, dy, dz) in bits 0/1/2, so an edge is any corner paired
// with the corner one bit above it — which is how this is built rather than
// written out.
const CELL_EDGES: [number, number][] = (() => {
  const edges: [number, number][] = [];
  for (let c = 0; c < 8; c++) for (const bit of [1, 2, 4]) if ((c & bit) === 0) edges.push([c, c | bit]);
  return edges;
})();

/** Contours a scalar field into a lattice. `sample(i, j, k)` reads the field
 *  at a corner of a res^3 cell lattice (0..res on each axis — the caller owns
 *  what those indices mean in space); `bounds` is the half-extent that
 *  lattice is laid over, and is what turns cell coordinates into the returned
 *  positions.
 *
 *  A cell whose eight corners straddle `iso` gets one vertex, placed at the
 *  centroid of that cell's edge crossings — so the lattice tracks the surface
 *  smoothly instead of stepping between cell centres — plus a line to each of
 *  its +x/+y/+z neighbours that also has one. A field that never crosses the
 *  iso value (all air, all gas, or empty) returns empty arrays. */
export function buildSurfaceNet(
  sample: (i: number, j: number, k: number) => number,
  iso: number,
  res: number,
  bounds: readonly [number, number, number],
): { positions: Float32Array; lines: Uint32Array } {
  if (res < 1) return { positions: new Float32Array(0), lines: new Uint32Array(0) };
  const n = res + 1;
  const vals = new Float32Array(n * n * n);
  let o = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[o++] = sample(i, j, k);

  const cellVert = new Int32Array(res * res * res).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  let verts = 0;
  for (let k = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        let below = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[(((k + ((c >> 2) & 1)) * n + (j + ((c >> 1) & 1))) * n) + (i + (c & 1))];
          corner[c] = v;
          if (v < iso) below++;
        }
        if (below === 0 || below === 8) continue;

        let lx = 0;
        let ly = 0;
        let lz = 0;
        let crossings = 0;
        for (const [c0, c1] of CELL_EDGES) {
          const v0 = corner[c0];
          const v1 = corner[c1];
          if ((v0 < iso) === (v1 < iso)) continue;
          const t = (iso - v0) / (v1 - v0);
          lx += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
          ly += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
          lz += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
          crossings++;
        }
        if (crossings === 0) continue;
        pos.push(
          (((i + lx / crossings) / res) * 2 - 1) * bounds[0],
          (((j + ly / crossings) / res) * 2 - 1) * bounds[1],
          (((k + lz / crossings) / res) * 2 - 1) * bounds[2],
        );
        cellVert[(k * res + j) * res + i] = verts++;
      }
    }
  }

  const lines: number[] = [];
  for (let k = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = cellVert[(k * res + j) * res + i];
        if (a < 0) continue;
        if (i + 1 < res) {
          const b = cellVert[(k * res + j) * res + i + 1];
          if (b >= 0) lines.push(a, b);
        }
        if (j + 1 < res) {
          const b = cellVert[(k * res + j + 1) * res + i];
          if (b >= 0) lines.push(a, b);
        }
        if (k + 1 < res) {
          const b = cellVert[((k + 1) * res + j) * res + i];
          if (b >= 0) lines.push(a, b);
        }
      }
    }
  }
  return { positions: new Float32Array(pos), lines: new Uint32Array(lines) };
}

// --- Strikes ---------------------------------------------------------------

/** A strike's line segment: A inside a lobe, B a short random distance away,
 *  both kept inside the cloud so the light source is always buried in gas.
 *  Returned as [ax, ay, az, bx, by, bz]. */
export function sampleStrikeSegment(rng: () => number, lobes: Lobe[]): [number, number, number, number, number, number] {
  const l = pickLobe(rng, lobes);
  const a = clampToEllipsoid([
    l.cx + l.r * 0.5 * gaussian(rng),
    l.cy + l.r * 0.35 * gaussian(rng),
    l.cz + l.r * 0.5 * gaussian(rng),
  ], 0.9);
  let dx = gaussian(rng);
  let dy = gaussian(rng);
  let dz = gaussian(rng);
  const n = Math.hypot(dx, dy, dz) || 1;
  dx /= n;
  dy /= n;
  dz /= n;
  const len = STRIKE_LEN_MIN + rng() * (STRIKE_LEN_MAX - STRIKE_LEN_MIN);
  let b: [number, number, number] = [a[0] + dx * len, a[1] + dy * len, a[2] + dz * len];
  // If the far end pokes out of the cloud, run the bolt the other way first;
  // only if both ways exit does it get pulled back to the surface.
  if (!insideCloud(b[0], b[1], b[2])) {
    const flipped: [number, number, number] = [a[0] - dx * len, a[1] - dy * len, a[2] - dz * len];
    b = insideCloud(flipped[0], flipped[1], flipped[2]) ? flipped : clampToEllipsoid(b);
  }
  return [a[0], a[1], a[2], b[0], b[1], b[2]];
}

/** One polyline of a bolt while the tree is being built: its vertices in
 *  cloud space, its straight-line length, the width its middle draws at as a
 *  fraction of the main channel's, and how many forks it is from that
 *  channel. */
type BoltLine = { pts: Float32Array; len: number; peak: number; level: number };

/** The kink every polyline in a bolt is drawn with: midpoint displacement —
 *  the midpoint of a span is pushed sideways off the line between its own
 *  ends, and each finer level is pushed half as far, which is what gives
 *  lightning its self-similar shape. The endpoints stay exactly on `a` and
 *  `b`, and no vertex strays further than about 2 * `jitter` of the length
 *  off the straight line.
 *
 *  Spans are split by index rather than by halving a power-of-two grid, so
 *  the segment count needn't be a power of two: each recursion sets exactly
 *  its own midpoint, and every interior vertex is some span's midpoint. */
function jagPolyline(
  rng: () => number,
  a: readonly number[],
  b: readonly number[],
  segments: number,
  jitter: number,
): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[segments * 3] = b[0];
  out[segments * 3 + 1] = b[1];
  out[segments * 3 + 2] = b[2];

  let ax = b[0] - a[0];
  let ay = b[1] - a[1];
  let az = b[2] - a[2];
  const len = Math.hypot(ax, ay, az) || 1e-6;
  ax /= len;
  ay /= len;
  az /= len;

  const displace = (lo: number, hi: number, amp: number): void => {
    const mid = (lo + hi) >> 1;
    if (mid === lo || mid === hi) return;
    const o0 = lo * 3;
    const o1 = hi * 3;
    let mx = (out[o0] + out[o1]) * 0.5;
    let my = (out[o0 + 1] + out[o1 + 1]) * 0.5;
    let mz = (out[o0 + 2] + out[o1 + 2]) * 0.5;
    // A random direction with its along-the-bolt component removed, so the
    // kink is sideways and the path never doubles back on itself.
    let dx = rng() * 2 - 1;
    let dy = rng() * 2 - 1;
    let dz = rng() * 2 - 1;
    const along = dx * ax + dy * ay + dz * az;
    dx -= along * ax;
    dy -= along * ay;
    dz -= along * az;
    const dn = Math.hypot(dx, dy, dz);
    if (dn > 1e-6) {
      const m = (amp * (rng() * 2 - 1)) / dn;
      mx += dx * m;
      my += dy * m;
      mz += dz * m;
    }
    const om = mid * 3;
    out[om] = mx;
    out[om + 1] = my;
    out[om + 2] = mz;
    displace(lo, mid, amp * 0.5);
    displace(mid, hi, amp * 0.5);
  };
  displace(0, segments, jitter * len);
  return out;
}

/** Width along a polyline at fraction `t` of its length, before the peak it
 *  is scaled by: 0 at both tips and a long plateau between them (see
 *  BOLT_TAPER_POW). Zero tips are load-bearing — they are what lets one
 *  triangle strip run through the whole tree, since the quads that join one
 *  polyline's end to the next one's start collapse to nothing. */
function boltWidthAt(t: number): number {
  // The ends are returned rather than computed: sin(pi) is a hair off zero in
  // floating point, and raising that to a fractional power lifts it back into
  // a width, which would leave the "collapsed" joins as slivers.
  if (!(t > 0) || t >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * t), BOLT_TAPER_POW);
}

/** Unit tangent at vertex `i` of a polyline — a central difference in the
 *  interior, one-sided at the ends. The vertex shader turns this into the
 *  screen-space normal it offsets the ribbon along, so it has to exist at
 *  every vertex; a polyline that doubled back on itself exactly would get the
 *  fallback, which is only ever a cosmetic wobble of one quad. */
function polylineTangent(pts: Float32Array, i: number, out: number[]): void {
  const n = pts.length / 3;
  const lo = Math.max(0, i - 1) * 3;
  const hi = Math.min(n - 1, i + 1) * 3;
  let dx = pts[hi] - pts[lo];
  let dy = pts[hi + 1] - pts[lo + 1];
  let dz = pts[hi + 2] - pts[lo + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-6) {
    dx /= d;
    dy /= d;
    dz /= d;
  } else {
    dx = 0;
    dy = 1;
    dz = 0;
  }
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
}

/** The bolt's visible geometry: a branched tree of jagged polylines packed
 *  into one strike's fixed slice of the vertex buffer, ready to draw as a
 *  single camera-facing ribbon.
 *
 *  The tree is the main channel from `a` to `b` — the pool's own segment is
 *  what lights the gas, so the drawn bolt has to run between the same two
 *  points — plus primary branches leaving interior vertices of it at an
 *  angle, plus one deeper level of forks off those while branch slots remain
 *  (BOLT_MAX_BRANCHES). Everything is deterministic in `rng`.
 *
 *  Layout: BOLT_PATH_VERTS path vertices, each written *twice* back to back
 *  — once per side of the ribbon — as BOLT_VERT_FLOATS floats: position,
 *  tangent, signed half-width and fork level. The sign of the width is which
 *  side of the ribbon the vertex is; its magnitude is how wide the channel is
 *  there, tapering to 0 at every tip. Every polyline is written end to end
 *  and the leftover slots are padded with zero-width copies of the last
 *  vertex, so one TRIANGLE_STRIP over the whole slice draws the tree and
 *  nothing else: the joins between polylines, and the padding, are quads with
 *  two zero-width corners and no area.
 *
 *  Writes into `out` at `offset` when given — the pool keeps every slot's
 *  tree in one flat array — and returns the array written. */
export function buildBoltTree(
  rng: () => number,
  a: readonly number[],
  b: readonly number[],
  out: Float32Array = new Float32Array(BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS),
  offset = 0,
): Float32Array {
  const mainLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
  const main: BoltLine = {
    pts: jagPolyline(rng, a, b, BOLT_SEGMENTS, BOLT_JITTER),
    len: mainLen,
    peak: 1,
    level: 0,
  };
  const lines: BoltLine[] = [main];

  // A fork off an interior vertex of `parent`: the parent's own direction
  // there, swung off by an angle around a random perpendicular, run out to a
  // fraction of the parent's length and pulled back inside the cloud if it
  // would leave. Starting exactly on a parent vertex is what makes the join
  // invisible — both polylines are zero-width there.
  const forkFrom = (parent: BoltLine): BoltLine => {
    const n = parent.pts.length / 3;
    const i = 1 + Math.floor(rng() * (n - 2));
    const root = [parent.pts[i * 3], parent.pts[i * 3 + 1], parent.pts[i * 3 + 2]];
    const tan: number[] = [0, 0, 0];
    polylineTangent(parent.pts, i, tan);
    // A random direction with its along-the-parent component removed — the
    // same idiom the midpoint displacement uses, for the same reason.
    let px = rng() * 2 - 1;
    let py = rng() * 2 - 1;
    let pz = rng() * 2 - 1;
    const along = px * tan[0] + py * tan[1] + pz * tan[2];
    px -= along * tan[0];
    py -= along * tan[1];
    pz -= along * tan[2];
    const pn = Math.hypot(px, py, pz);
    if (pn > 1e-6) {
      px /= pn;
      py /= pn;
      pz /= pn;
    } else {
      px = 1;
      py = 0;
      pz = 0;
    }
    const ang = BOLT_BRANCH_ANGLE_MIN + rng() * (BOLT_BRANCH_ANGLE_MAX - BOLT_BRANCH_ANGLE_MIN);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const len = parent.len * (BOLT_BRANCH_LEN_MIN + rng() * (BOLT_BRANCH_LEN_MAX - BOLT_BRANCH_LEN_MIN));
    const tip = clampToEllipsoid([
      root[0] + (tan[0] * ca + px * sa) * len,
      root[1] + (tan[1] * ca + py * sa) * len,
      root[2] + (tan[2] * ca + pz * sa) * len,
    ]);
    return {
      pts: jagPolyline(rng, root, tip, BOLT_BRANCH_SEGMENTS, BOLT_BRANCH_JITTER),
      len: Math.hypot(tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]) || 1e-6,
      peak: parent.peak * boltWidthAt(i / (n - 1)) * BOLT_BRANCH_WIDTH,
      level: parent.level + 1,
    };
  };

  const primaries: BoltLine[] = [];
  const wanted = BOLT_BRANCH_MIN + Math.floor(rng() * (BOLT_BRANCH_MAX - BOLT_BRANCH_MIN + 1));
  for (let k = 0; k < wanted && lines.length <= BOLT_MAX_BRANCHES; k++) {
    const br = forkFrom(main);
    lines.push(br);
    primaries.push(br);
  }
  for (const p of primaries) {
    if (lines.length > BOLT_MAX_BRANCHES) break;
    if (rng() >= BOLT_SUB_CHANCE) continue;
    lines.push(forkFrom(p));
  }

  let v = 0;
  const tan: number[] = [0, 0, 0];
  const put = (x: number, y: number, z: number, w: number, level: number): void => {
    for (let s = 0; s < 2; s++) {
      const o = offset + (v * 2 + s) * BOLT_VERT_FLOATS;
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = tan[0];
      out[o + 4] = tan[1];
      out[o + 5] = tan[2];
      out[o + 6] = s === 0 ? w : -w;
      out[o + 7] = level;
    }
    v++;
  };
  for (const line of lines) {
    const n = line.pts.length / 3;
    for (let i = 0; i < n && v < BOLT_PATH_VERTS; i++) {
      polylineTangent(line.pts, i, tan);
      put(line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2], boltWidthAt(i / (n - 1)) * line.peak, line.level);
    }
  }
  // Unfilled branch slots: zero-width copies of the last vertex written, so
  // the strip runs off the end of the tree without drawing anything.
  const tailX = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS];
  const tailY = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS + 1];
  const tailZ = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS + 2];
  tan[0] = 0;
  tan[1] = 1;
  tan[2] = 0;
  while (v < BOLT_PATH_VERTS) put(tailX, tailY, tailZ, 0, 0);
  return out;
}

/** Brightness of a strike `ageSec` after it fired: 1 at the instant of the
 *  strike, an exponential decay whose rate Afterglow sets, plus a train of
 *  return strokes (re-flashes ~50–90 ms apart, each weaker than the last)
 *  whose count Flicker sets. `seed` fixes where a given strike's strokes
 *  land so the pattern is stable across ticks. */
export function strikeEnvelope(ageSec: number, seed: number, afterglow: number, flicker: number): number {
  if (!(ageSec >= 0)) return 0;
  const glow = Math.min(1, Math.max(0, afterglow));
  const flick = Math.min(1, Math.max(0, flicker));
  const decay = 14 - 9 * glow; // mix(14, 5, afterglow) per second
  let v = Math.exp(-ageSec * decay);
  const strokes = Math.round(flick * 3);
  let t = 0;
  for (let k = 0; k < strokes; k++) {
    t += 0.05 + 0.04 * hash01(seed, k);
    if (ageSec >= t) v += (0.3 + 0.4 * flick) * Math.pow(0.75, k) * Math.exp(-(ageSec - t) * decay * 1.3);
  }
  return Math.min(v, 1.5);
}

/** Pool of strikes in flight. Endpoints and per-slot strength are kept in
 *  flat arrays shaped for uniform3fv/uniform1fv so render() uploads them as
 *  is, and each slot's drawn bolt path in one flat vertex array shaped for
 *  bufferSubData. Exported for tests/storm.test.ts. */
export function createStrikePool(lobes: Lobe[], rng: () => number = Math.random) {
  const age = new Float32Array(MAX_STRIKES).fill(1e6); // huge = never triggered, fully faded
  const amp = new Float32Array(MAX_STRIKES); // 0 = inactive
  const seed = new Float32Array(MAX_STRIKES);
  const posA = new Float32Array(MAX_STRIKES * 3);
  const posB = new Float32Array(MAX_STRIKES * 3);
  const strength = new Float32Array(MAX_STRIKES);
  const path = new Float32Array(MAX_STRIKES * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS);
  const pathDirty = new Uint8Array(MAX_STRIKES);
  let activeLobes = lobes;
  let sinceLast = 1e6;
  let lastSlot = -1;
  return {
    /** The slot the most recent successful trigger() fired in, or -1 before
     *  the first one — how the caller finds the segment it just made without
     *  the pool having to know what a cell is. */
    get lastSlot(): number {
      return lastSlot;
    },
    /** Segment start per slot, xyz triples in cloud space. */
    posA,
    /** Segment end per slot. */
    posB,
    /** Current light strength per slot: amplitude x strikeEnvelope(age). */
    strength,
    /** Amplitude each slot fired at, un-enveloped. 0 = never fired. */
    amp,
    /** Every slot's drawn bolt tree, back to back: slot i owns the
     *  BOLT_RIBBON_VERTS ribbon vertices starting at i * BOLT_RIBBON_VERTS.
     *  buildBoltTree's header has the per-vertex layout. */
    path,
    /** 1 where a slot's path has changed since it was last uploaded. */
    pathDirty,
    /** Which lobes new strikes are placed in. The cloud morphs, so render()
     *  points this at whichever silhouette is nearest the drawn shape and the
     *  bolts stay buried in gas that is actually there. */
    setLobes(next: Lobe[]): void {
      activeLobes = next;
    },
    /** Fires a strike in whichever slot has been fading the longest — never
     *  the youngest, so a beat can't cut off the flash the last one started.
     *  Strength is set immediately so the attack lands on this very frame,
     *  and the slot's drawn path is rebuilt and marked dirty. Returns false
     *  (and does nothing) inside the refractory window after the previous
     *  strike unless `force` — that's what folds a low onset and a broadband
     *  beat on adjacent frames into one strike. */
    trigger(amplitude = 1, force = false): boolean {
      if (!force && sinceLast < STRIKE_REFRACTORY_SEC) return false;
      sinceLast = 0;
      let slot = 0;
      for (let i = 1; i < MAX_STRIKES; i++) if (age[i] > age[slot]) slot = i;
      age[slot] = 0;
      amp[slot] = amplitude;
      seed[slot] = rng() * 1000;
      const seg = sampleStrikeSegment(rng, activeLobes);
      posA[slot * 3] = seg[0];
      posA[slot * 3 + 1] = seg[1];
      posA[slot * 3 + 2] = seg[2];
      posB[slot * 3] = seg[3];
      posB[slot * 3 + 1] = seg[4];
      posB[slot * 3 + 2] = seg[5];
      buildBoltTree(rng, seg.slice(0, 3), seg.slice(3), path, slot * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS);
      pathDirty[slot] = 1;
      strength[slot] = amplitude;
      lastSlot = slot;
      return true;
    },
    tick(dtSec: number, afterglow: number, flicker: number): void {
      sinceLast += dtSec;
      for (let i = 0; i < MAX_STRIKES; i++) {
        age[i] += dtSec;
        strength[i] = amp[i] > 0 ? amp[i] * strikeEnvelope(age[i], seed[i], afterglow, flicker) : 0;
      }
    },
  };
}

// --- Dark sections ---------------------------------------------------------
//
// The cloud is cut into cells and each cell carries its own glow envelope, so
// the mass rests mostly dark and lights up a region at a time. Two halves:
//
//  - The partition is a Voronoi diagram over CELL_SITES, read at a *warped*
//    position (cellWarp): a fixed, timeless trig displacement of cloud space,
//    so the boundary between two cells is a wavy sheet rather than the flat
//    plane a plain Voronoi bisector would draw. It exists twice — cellIndexAt
//    here and sectionGain in SECTION_GLSL — because the JS side has to know
//    which cell a strike landed in and the shader has to know which cell a
//    sample is in. The two agree everywhere except inside a boundary shell a
//    float's width thick, which is exactly where the shader's own blend makes
//    the answer not matter.
//  - The sites are laid out by Lloyd relaxation (buildCellSites) against a
//    fixed sample set drawn from the bounding ellipsoid, rather than left
//    where the rng dropped them: unrelaxed sites leave one cell holding half
//    the cloud and another holding a sliver, and a sliver never reads as a
//    section lighting up. Deterministic — same seed, same partition, every
//    mount, and the same one the JS and GLSL halves share.
//
// The envelopes are a plain Float32Array (createCellGlow), decayed with the
// scene's own measured render interval — the same dt the strike pool is aged
// by, for the same 120Hz reason (see the file header) — and uploaded whole as
// uCellGlow. What lights a cell: a beat lights SECTION_BEAT_CELLS of them at
// once, a mid/treble rise lights a single one more gently so the cloud keeps
// flickering section by section between beats, and every strike lights the
// cells along its own channel, brightest at the midpoint. The decay constant
// is slow next to strikeEnvelope's — a strike is a flash, a lit section is an
// afterglow that outlasts it by a beat or two.
const MAX_CELLS = 12;
const CELL_SEED = 7;
// Amplitude of the boundary wobble, in cloud units, against cells that come
// out roughly half a unit across: enough that a border reads as a torn edge
// rather than a cut, and short of the point where a cell's warped preimage
// tears into disconnected islands.
const CELL_WARP = 0.22;
// How wide the blend between two neighbouring cells is, in cloud units — the
// difference of the two nearest site distances, so this is roughly the real
// width of the gradient. A hard switch here reads as sliced glass.
const CELL_BLEND = 0.32;
// The relaxation: how many points the centroids are measured over and how
// many rounds of it. Both fixed, so the layout is a constant of the build.
const CELL_LLOYD_SAMPLES = 2400;
const CELL_LLOYD_ITERS = 6;
/** Time constant of a cell's glow decay, in seconds — a lit section fades
 *  over a beat or two at ordinary tempos, where strikeEnvelope's flash is
 *  gone in a fraction of one. */
export const CELL_DECAY_TAU = 1;
/** How many cells one beat lights, and how brightly a mid/treble rise lights
 *  a single one on its own. */
const SECTION_BEAT_CELLS = 2;
const SECTION_BAND_LEVEL = 0.55;
// How dark an unlit cell rests and how far past its own resting brightness a
// freshly lit one goes, both at Dark sections full — see SECTION_GLSL, which
// is where the two are actually used. The dark end is a fraction of the
// resting light rather than a subtraction from it, so a section goes dark in
// the same proportion whatever else is lighting the cloud.
const SECTION_DARK = 0.08;
const SECTION_LIT = 2;
/** Where the sections stop darkening the cloud, as a fraction of
 *  AMB_FLOOR_KNEE: below that much Ambient glow the cloud is already an
 *  ember and there is nothing left to section. */
const SECTION_EMBER = 0.6;
/** Where along a strike's segment the cells it lights are sampled, and how
 *  brightly each tap lights the cell it lands in: the midpoint's cell is
 *  fully lit, the cells the rest of the channel runs through less so. */
const SECTION_STRIKE_TAPS: readonly (readonly [number, number])[] = [
  [0.15, 0.6],
  [0.5, 1],
  [0.85, 0.6],
];

/** The fixed trig displacement the partition is read through — see the block
 *  above. Timeless and seedless on purpose: the cells have to sit still in
 *  cloud space, or a "section" would crawl across the mass instead of being a
 *  part of it. Mirrored by cellWarp() in SECTION_GLSL. */
export function cellWarp(x: number, y: number, z: number): [number, number, number] {
  return [
    x + CELL_WARP * Math.sin(y * 3.1 + 1.7) * Math.cos(z * 2.3),
    y + CELL_WARP * Math.sin(z * 2.7 + 0.6) * Math.cos(x * 3.3),
    z + CELL_WARP * Math.sin(x * 2.9 + 2.4) * Math.cos(y * 2.1),
  ];
}

/** The cells' site points, xyz triples in warped cloud space, evenly spread
 *  through the cloud by Lloyd relaxation. Deterministic for a seed. */
export function buildCellSites(count = MAX_CELLS, seed = CELL_SEED): Float32Array {
  const rng = createRng(seed);
  // Rejection-sampled inside the bounding ellipsoid, then warped: the sites
  // live in the same space cellIndexAt does its lookup in.
  const sampleInside = (): [number, number, number] => {
    for (;;) {
      const x = (rng() * 2 - 1) * CLOUD_EXTENT_X;
      const y = (rng() * 2 - 1) * CLOUD_EXTENT_Y;
      const z = (rng() * 2 - 1) * CLOUD_EXTENT_Z;
      if (insideCloud(x, y, z)) return cellWarp(x, y, z);
    }
  };
  const sites = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = sampleInside();
    sites[i * 3] = s[0];
    sites[i * 3 + 1] = s[1];
    sites[i * 3 + 2] = s[2];
  }
  const samples = new Float32Array(CELL_LLOYD_SAMPLES * 3);
  for (let i = 0; i < CELL_LLOYD_SAMPLES; i++) {
    const s = sampleInside();
    samples[i * 3] = s[0];
    samples[i * 3 + 1] = s[1];
    samples[i * 3 + 2] = s[2];
  }
  const sum = new Float64Array(count * 3);
  const hits = new Float64Array(count);
  for (let it = 0; it < CELL_LLOYD_ITERS; it++) {
    sum.fill(0);
    hits.fill(0);
    for (let i = 0; i < CELL_LLOYD_SAMPLES; i++) {
      const x = samples[i * 3];
      const y = samples[i * 3 + 1];
      const z = samples[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < count; c++) {
        const dx = x - sites[c * 3];
        const dy = y - sites[c * 3 + 1];
        const dz = z - sites[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      sum[best * 3] += x;
      sum[best * 3 + 1] += y;
      sum[best * 3 + 2] += z;
      hits[best] += 1;
    }
    // A site that won nothing keeps its place rather than collapsing to the
    // origin — with relaxed sites it never happens, but a division by zero
    // here would take every cell with it.
    for (let c = 0; c < count; c++) {
      if (hits[c] === 0) continue;
      sites[c * 3] = sum[c * 3] / hits[c];
      sites[c * 3 + 1] = sum[c * 3 + 1] / hits[c];
      sites[c * 3 + 2] = sum[c * 3 + 2] / hits[c];
    }
  }
  return sites;
}

/** The partition, in the same space the shader's own copy works in. Built
 *  once per page: it is a constant of the seed. */
export const CELL_SITES = buildCellSites();

/** Which cell a cloud-space point belongs to — the JS twin of sectionGain's
 *  nearest-site search, and what tells a strike which section it lit. */
export function cellIndexAt(x: number, y: number, z: number, sites: Float32Array = CELL_SITES): number {
  const [wx, wy, wz] = cellWarp(x, y, z);
  const n = Math.floor(sites.length / 3);
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < n; c++) {
    const dx = wx - sites[c * 3];
    const dy = wy - sites[c * 3 + 1];
    const dz = wz - sites[c * 3 + 2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** The per-cell glow envelopes, shaped for uniform1fv so render() uploads the
 *  array as is. Everything that lights a cell raises its envelope rather than
 *  adding to it, so two triggers on one beat can't pile a section past full.
 *  Exported for tests/storm.test.ts. */
export function createCellGlow(cells = MAX_CELLS, rng: () => number = Math.random) {
  const glow = new Float32Array(cells);
  const light = (cell: number, amount: number): void => {
    if (!(cell >= 0) || cell >= cells) return;
    glow[cell] = Math.min(1, Math.max(glow[cell], amount));
  };
  return {
    /** One envelope per cell, in CELL_SITES order. */
    glow,
    light,
    /** Lights the cell holding a point. */
    lightAt(x: number, y: number, z: number, amount: number): void {
      light(cellIndexAt(x, y, z), amount);
    },
    /** Lights `n` cells picked at random — what a beat does. Picks are
     *  independent, so a beat may land twice in one cell; forcing them apart
     *  made the choice read as a rota rather than as lightning. */
    lightRandom(amount: number, n = 1): void {
      for (let i = 0; i < n; i++) light(Math.min(cells - 1, Math.floor(rng() * cells)), amount);
    },
    /** Lights the cells a strike's channel runs through: full where its
     *  midpoint sits, weaker at the ends, so a bolt leaves the section it
     *  landed in glowing after its own flash has gone. Takes the pool's own
     *  endpoint arrays and a slot, which is the shape they already have. */
    lightSegment(posA: Float32Array, posB: Float32Array, slot: number): void {
      const o = slot * 3;
      for (const [t, amount] of SECTION_STRIKE_TAPS) {
        light(
          cellIndexAt(
            posA[o] + (posB[o] - posA[o]) * t,
            posA[o + 1] + (posB[o + 1] - posA[o + 1]) * t,
            posA[o + 2] + (posB[o + 2] - posA[o + 2]) * t,
          ),
          amount,
        );
      }
    },
    /** Exponential decay on the scene's own render interval. */
    tick(dtSec: number): void {
      const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
      const k = Math.exp(-dt / CELL_DECAY_TAU);
      for (let i = 0; i < cells; i++) glow[i] = glow[i] > 1e-4 ? glow[i] * k : 0;
    },
    /** Back to fully dark — init(), so a remount doesn't inherit the last
     *  mount's lit sections. */
    reset(): void {
      glow.fill(0);
    },
  };
}

// ---------------------------------------------------------------------------
// Shaders

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const STRIKE_UNIFORMS_GLSL = `
uniform vec3 uStrikeA[${MAX_STRIKES}];
uniform vec3 uStrikeB[${MAX_STRIKES}];
uniform float uStrikeStrength[${MAX_STRIKES}];
`;

// The resting light — see the "Resting light" block above. Included by every
// stage that used to carry a hard floor on its ambient term (the march and
// the lattice); the point cloud and the strands are already plain multiples
// of uAmbient, so they reach an ember, and then nothing, on their own.
const AMBIENT_LIFT_GLSL = `
#define AMB_FLOOR_REST ${AMB_FLOOR_REST.toFixed(4)}
#define AMB_FLOOR_FULL ${AMB_FLOOR_FULL.toFixed(4)}
#define AMB_FLOOR_KNEE_INV ${(1 / AMB_FLOOR_KNEE).toFixed(5)}
// 1 / AMB_FLOOR_FULL: normalizes the floor to exactly 1.0 at and above the
// knee, for the terms whose old floor was an additive constant rather than
// the low end of a mix().
#define AMB_FLOOR_NORM ${(1 / AMB_FLOOR_FULL).toFixed(5)}

// Reads uAmbient rather than taking it: the floor is how dark the cloud is
// allowed to rest, which is the setting itself — not something a caller
// working with a scaled copy of it (Filaments' underlay) should be able to
// pull further down.
float ambientFloor() {
  return mix(AMB_FLOOR_REST, AMB_FLOOR_FULL, min(1.0, max(uAmbient, 0.0) * AMB_FLOOR_KNEE_INV));
}

float ambientLift(float a) {
  return mix(ambientFloor(), 1.0, a);
}
`;

// The dark sections — the GLSL half of the partition described in the "Dark
// sections" block above, and the one place the per-cell envelopes reach the
// image. Splice it into a stage after AMBIENT_LIFT_GLSL (it reads that
// block's knee) and after the settings uniforms (it reads uSections and
// uAmbient).
//
// What it returns is a plain multiplier on a stage's *resting* light: a dark
// cell's share of the ambient/spectrum term, up through 1 and a little past
// it where a section has just been lit. Nothing on the strike side goes
// through it, for the same reason nothing on the strike side goes through
// ambientFloor: lightning lights what it reaches whatever the sections are
// doing, and the cell envelope is the glow it leaves behind rather than the
// flash itself.
//
// Two details that are load-bearing rather than decorative:
//  - The early-out at uSections ~ 0 is what makes the setting's Off stop an
//    exact identity — a frame at 0 is the frame this scene drew before the
//    setting existed, not a frame that rounds to it.
//  - The dark floor fades out where the cloud is already an ember. Ambient
//    glow near zero and Dark sections high otherwise multiply into a cloud
//    that is simply not there — a mass that has already dimmed to nothing
//    can't be sectioned. The gate is a fraction (SECTION_EMBER) of
//    ambientFloor's own knee rather than a number of its own, so it opens
//    fully well below the Ambient glow default and only bites down in the
//    ember range the sliding floor exists for.
const SECTION_GLSL = `
#define MAX_CELLS ${MAX_CELLS}
#define CELL_WARP ${CELL_WARP.toFixed(4)}
#define CELL_BLEND ${CELL_BLEND.toFixed(4)}
// How dark an unlit cell rests, and how far past 1 a freshly lit one goes,
// both at Dark sections full.
#define SECTION_DARK ${SECTION_DARK.toFixed(4)}
#define SECTION_LIT ${SECTION_LIT.toFixed(4)}
// The share of ambientFloor's knee below which the sections stop darkening
// the cloud any further — see the ember note above.
#define SECTION_EMBER ${SECTION_EMBER.toFixed(4)}

uniform vec3 uCellSite[MAX_CELLS];
uniform float uCellGlow[MAX_CELLS];

// The twin of cellWarp() in storm.ts — keep the two expressions identical.
vec3 cellWarp(vec3 p) {
  return p + CELL_WARP * vec3(
    sin(p.y * 3.1 + 1.7) * cos(p.z * 2.3),
    sin(p.z * 2.7 + 0.6) * cos(p.x * 3.3),
    sin(p.x * 2.9 + 2.4) * cos(p.y * 2.1));
}

float sectionGain(vec3 pCloud) {
  if (uSections <= 0.001) return 1.0;
  vec3 q = cellWarp(pCloud);
  // Nearest and second-nearest site, kept as squared distances through the
  // loop — the difference of the two real ones is only needed once, at the
  // blend below.
  float d1 = 1e9;
  float d2 = 1e9;
  float e1 = 0.0;
  float e2 = 0.0;
  for (int i = 0; i < MAX_CELLS; i++) {
    vec3 dv = q - uCellSite[i];
    float d = dot(dv, dv);
    if (d < d1) {
      d2 = d1; e2 = e1;
      d1 = d; e1 = uCellGlow[i];
    } else if (d < d2) {
      d2 = d; e2 = uCellGlow[i];
    }
  }
  // Half way to the neighbour's envelope at the boundary itself, and this
  // cell's own a blend-width in: a hard switch reads as sliced glass, and the
  // difference of the two distances is what makes the ramp the same width
  // wherever on the border it is crossed.
  float w = clamp((sqrt(d2) - sqrt(d1)) / CELL_BLEND, 0.0, 1.0);
  // Square root, not the envelope itself: the envelope decays exponentially,
  // and read linearly a lit section is back down among the dark ones inside
  // half its own time constant — the flash goes, and the glow it was supposed
  // to leave behind goes with it. The root holds a section visibly lit for
  // most of its decay and then drops it, which is the shape the eye reads as
  // an afterglow.
  float e = sqrt(clamp(mix(0.5 * (e1 + e2), e1, w), 0.0, 1.0));
  float amt = uSections * clamp(max(uAmbient, 0.0) * AMB_FLOOR_KNEE_INV / SECTION_EMBER, 0.0, 1.0);
  return mix(mix(1.0, SECTION_DARK, amt), 1.0 + SECTION_LIT * uSections, e);
}
`;

// The gasType recipe (GAS_RECIPES), as plain uniforms — no extra texture and
// no change to what the noise volume holds, only factors on expressions the
// march already had. Cumulus uploads identity values, so this whole block is
// arithmetic that cancels at the default.
const GAS_UNIFORMS_GLSL = `
uniform float uGasFreq;
uniform vec3 uGasStretch;
uniform float uGasErosion;
uniform float uGasWorley;
uniform float uGasExtinct;
uniform float uGasPowder;
uniform vec3 uGasTint;
`;

// The per-strike light at a point in cloud space: the broad in-scattered
// body, radius off Flash reach, that the march computes per step. Shared by
// every geometry pass — the lattice and the points — so a change to how
// lightning carries can't land in one and not the other. Needs MAX_STRIKES
// and the strike uniforms in scope.
//
// Only the body: the march pairs this with a tight emissive core because the
// gas has to draw the bolt itself, while a geometry pass has the real bolt
// drawn over it (BOLT_VERT). Adding a core here as well only blew the
// particles nearest the channel to flat white and swallowed the bolt inside
// the blob.
const STRIKE_LIGHT_GLSL = `
float distToSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

float strikeLight(vec3 p, float reachR) {
  float light = 0.0;
  for (int i = 0; i < MAX_STRIKES; i++) {
    float s = uStrikeStrength[i];
    if (s <= 0.001) continue;
    float dr = distToSegment(p, uStrikeA[i], uStrikeB[i]) / reachR;
    light += s / (1.0 + dr * dr);
  }
  return light;
}
`;

// Spectrum -> space. Which band belongs at a point, and how much brighter
// that band's level lights it: the `spectrumMap` switch picks whether the
// spectrum is laid across the screen (left = low) or across the cloud's own
// x axis. The cloud mapping reads the *pre-rotation* position, which is what
// makes it ride the swirl instead of staying pinned to the frame.
//
// The gain multiplies ambient/emissive light only — never extinction, never
// the strike light — so a quiet band leaves that part of the cloud dim
// rather than thin, and lightning stays the same size whatever is playing.
// Needs sampleBands (SAMPLE_BANDS_GLSL) and the settings uniforms in scope.
const SPECTRUM_GLSL = `
#define EXTENT_X ${CLOUD_EXTENT_X.toFixed(2)}
#define SPECTRUM_MAP_CLOUD ${SPECTRUM_MAP_CLOUD}.0

float bandAt(vec3 pCloud, vec2 ndc) {
  float x01 = uSpectrumMap >= SPECTRUM_MAP_CLOUD - 0.5
    ? clamp(pCloud.x / (2.0 * EXTENT_X) + 0.5, 0.0, 0.999)
    : ndc.x * 0.5 + 0.5;
  return sampleBands(x01);
}

float spectrumGain(vec3 pCloud, vec2 ndc) {
  float amt = uSpectrumGlow * step(0.5, uSpectrumMap);
  if (amt <= 0.001) return 1.0;
  return mix(1.0, 0.35 + 1.8 * bandAt(pCloud, ndc), amt);
}
`;

// The colour of everything electric here — bolt, in-cloud flash, lattice
// highlight: a cold white-blue pulled a little way toward the palette so the
// storm still belongs to the current vibe.
//
// flashTint is the same colour graded by how hard a point is being lit, and
// it is what every mode's strike light is tinted with, so the flash reddens
// the same way in the gas, across the lattice and over the points. A flash
// arrives white-hot at the channel, cools to the storm's blue through the
// body of the glow and goes violet out at the edge of its reach — light that
// has scattered furthest through the gas has been filtered the most, and the
// fringe is what stops a strike from reading as one flat blue blob.
const BOLT_COLOR_GLSL = `
vec3 boltColor() {
  return mix(vec3(0.72, 0.82, 1.0), palette(0.15, uPalA, uPalB, uPalC, uPalD), 0.3);
}

// Takes the body colour rather than calling boltColor() itself: the march
// evaluates this per step, and palette() inside the step loop was the single
// most expensive thing this pass added.
vec3 flashTint(vec3 body, float light) {
  vec3 fringe = mix(body, vec3(0.60, 0.38, 1.0), 0.45);
  float l = clamp(light, 0.0, 1.0);
  return mix(mix(fringe, body, smoothstep(0.0, 0.12, l)), vec3(1.0), smoothstep(0.30, 1.0, l));
}
`;

// The one camera in this scene, in both directions. Forward (cloudToView +
// viewToRoomNdc) is what projects a strike's endpoints for the background
// haze and every piece of geometry; unrotate() is its inverse, which is what
// the volume actually marches through — a ray is built in the camera's own
// space and pushed back into cloud space, so the density field, the strikes
// and the march all share the space the strike pool stores its segments in.
//
// The bass swell is a uniform scale of cloud space against a fixed camera, so
// in cloud space it only moves the ray origin: the gas, its noise detail, the
// lattice and the bolts all inflate together.
const CAMERA_GLSL = `
#define CAM_DIST ${CAM_DIST.toFixed(2)}
#define FOCAL_Y ${(1 / Math.tan((CAM_FOV_DEG * Math.PI) / 360)).toFixed(5)}
#define TILT 0.22

float swellScale() {
  return 1.0 + 0.25 * uSwell * uLow;
}

vec3 rotY(vec3 p, float ca, float sa) {
  return vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
}

vec3 rotX(vec3 p, float ct, float st) {
  return vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
}

vec3 cloudToView(vec3 p) {
  p *= swellScale();
  float a = uFlowPhase * uSwirl * 0.35;
  p = rotY(p, cos(a), sin(a));
  p = rotX(p, cos(TILT), sin(TILT));
  // Camera on +z looking at the origin.
  return vec3(p.x, p.y, max(CAM_DIST - p.z, 0.5));
}

// Undoes cloudToView's swirl and tilt. A point additionally divides by
// swellScale(); a direction doesn't need to, since it gets normalized.
vec3 unrotate(vec3 q) {
  float a = uFlowPhase * uSwirl * 0.35;
  q = rotX(q, cos(TILT), -sin(TILT));
  return rotY(q, cos(a), -sin(a));
}

float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

vec2 viewToRoomNdc(vec3 v) {
  return vec2(v.x * FOCAL_Y / roomAspect(), v.y * FOCAL_Y) / v.z;
}

// Aerial perspective for the geometry passes: how much dimmer a point is for
// sitting on the far side of the cloud. It is the only depth cue they have —
// both draw additively with no depth buffer — so the lattice and the points
// share one falloff rather than each inventing its own.
//
// The near end sits above 1.0 on purpose. Fading only downward buys the
// depth cue by dimming the whole mass, which in Mesh cost the lattice more
// brightness than the separation was worth; pivoting around the cloud's own
// centre (viewZ == CAM_DIST) spends the same contrast without darkening it.
float depthFade(float viewZ) {
  return mix(1.32, 0.52, smoothstep(CAM_DIST - 1.4, CAM_DIST + 1.4, viewZ));
}
`;

// Cloud space -> the clip position of the room-space slice this scene owns.
// Shared by every geometry pass, so the lattice, the points and the bolts
// can't disagree about where a point in the cloud lands on screen.
const PROJECT_GLSL = `
vec4 cloudToClip(vec3 p) {
  vec2 ndc = viewToRoomNdc(cloudToView(p));
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  return vec4(uv01 * 2.0 - 1.0, 0.0, 1.0);
}
`;

const VOLUME_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform highp sampler3D uNoise; // R: value fbm, G: inverted worley — tiled
uniform highp sampler3D uShape; // the baked silhouettes, one per channel
uniform vec4 uShapeMix;         // shapePhaseWeights, as a per-channel weight
${AMBIENT_LIFT_GLSL}
${SECTION_GLSL}
${GAS_UNIFORMS_GLSL}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${SAMPLE_BANDS_GLSL}
${CAMERA_GLSL}
${SPECTRUM_GLSL}
${BOLT_COLOR_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define MAX_STEPS ${MAX_STEPS}
#define MAX_OCTAVES ${NOISE_VALUE_CELLS.length}
#define BASE_FREQ ${BASE_FREQ.toFixed(4)}
#define MODE_MESH ${MODE_MESH}
#define MODE_VOXEL ${MODE_VOXEL}
#define MODE_POINTS ${MODE_POINTS}
#define MODE_FILAMENTS ${MODE_FILAMENTS}
// How many levels Voxel mode's shading is posterized into, and how big one
// voxel is at each end of Detail.
#define VOXEL_BANDS 5.0
#define VOXEL_MIN 0.07
#define VOXEL_MAX 0.18
// The scattering asymmetry (henyeyGreenstein, in Schlick's parameterisation
// — HG_K is 1.55g - 0.55g^3 for an asymmetry g of about 0.42) and how far
// the phase term is allowed to pull the strike light off isotropic. Cloud
// droplets are far more forward-scattering than this; the full lobe swings
// the halo hard enough that a bolt in front of the cloud all but
// disappears, so the term is blended in at HG_MIX rather than used raw.
#define HG_K 0.61
#define HG_MIX 0.6
// One shadow tap from the sample toward the brightest live strike, so the
// flash carves the gas instead of glowing through it: how far along it
// looks, and how hard the clump it finds occludes. Below STRIKE_SHADE_MIN
// there is too little light here for either the tap or the phase term to
// show, so neither is paid for; between there and STRIKE_SHADE_FULL both
// fade in, which is what keeps the gate from drawing a ring.
#define STRIKE_SHADOW_DIST 0.30
#define STRIKE_SHADOW_K 3.5
#define STRIKE_SHADE_MIN 0.03
#define STRIKE_SHADE_FULL 0.20
// The bolt's screen-space bloom (see background): how much tighter the inner
// lobe is than the haze around it, and how hard it draws.
#define BOLT_BLOOM_TIGHT 11.0
#define BOLT_BLOOM_GAIN 0.4

// Half-extents of the ellipsoid the march is clipped to, and where shape()
// fades out — see BOUND_X/Y/Z in storm.ts for why they differ per axis.
const vec3 BOUND = vec3(${BOUND_X.toFixed(4)}, ${BOUND_Y.toFixed(4)}, ${BOUND_Z.toFixed(4)});
// A hidden sun, above and slightly behind the viewer's right shoulder —
// written out normalized so it stays a plain constant.
const vec3 SUN_DIR = vec3(0.32148, 0.91852, 0.21106);
// The two ends of the sun ramp: direct sunlight, and the cool blue that
// stands in for the light that only reached the shadowed interior after
// bouncing around inside the cloud.
const vec3 SUN_COL = vec3(1.0, 0.95, 0.88);
const vec3 SHADE_COL = vec3(0.13, 0.18, 0.31);
// 1 / (1 - exp(-2)), so the powder term tops out at exactly 1.
#define POWDER_NORM 1.1565

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (v - lo) * (nhi - nlo) / max(hi - lo, 1e-5);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float distToSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

// Henyey-Greenstein, normalized against the isotropic phase function so it
// averages to 1 over the sphere — multiplying the in-scattered strike light
// by it moves light around rather than adding any. Water droplets scatter
// hard forward, which is why a cloud lit from behind glows and the same
// cloud lit from the front stays grey: a sample with the bolt further along
// the view ray than it is gets the bright end of this.
float henyeyGreenstein(float cosTheta) {
  // Schlick's approximation of the real thing, with HG_K standing in for the
  // asymmetry: within a couple of percent of it across the whole lobe, and
  // it costs a square where the exact form costs a sqrt of a cube — worth
  // the swap for a term the march evaluates at every lit step.
  float d = 1.0 - HG_K * cosTheta;
  return (1.0 - HG_K * HG_K) / max(d * d, 1e-4);
}

// Soft shoulder instead of a hard clip. Compressing the peak channel and
// carrying the whole colour down with it keeps a flash's blue as it
// saturates, where compressing each channel on its own slides everything hot
// to white; the small per-channel blend back in is what still lets the very
// core of a strike go white the way an overexposure does.
vec3 tonemap(vec3 c) {
  float pk = max(max(c.r, c.g), c.b);
  vec3 hue = c * ((1.0 - exp(-pk * 1.25)) / max(pk, 1e-4));
  return mix(hue, 1.0 - exp(-c * 1.25), 0.35);
}

// The analytic silhouette, read from the volume shapeAt() was baked into —
// one fetch and one dot however far the cloud has morphed, since uShapeMix
// already carries the two live channels' weights (shapePhaseWeights).
// CLAMP_TO_EDGE is safe because every texel on a box face reads 0.
float shape(vec3 p) {
  return dot(texture(uShape, p / (2.0 * BOUND) + 0.5), uShapeMix);
}

// Where the noise is read: the whole field drifts slowly downwind and churns
// against itself, so the gas rolls even with Swirl at zero. The gas type's
// frequency and per-axis stretch land on the drifted position and *before*
// the churn, so the churn keeps the same amplitude relative to the features
// it is rippling however fine they get; the drift is a cloud-space velocity
// either way, so a finer gas doesn't scud faster.
vec3 flowSpace(vec3 p) {
  vec3 q = (p + vec3(uFlowPhase * 0.06, 0.0, uFlowPhase * 0.03)) * uGasFreq * uGasStretch;
  return q + 0.08 * sin(q.zxy * 2.0 + uTime * 0.3);
}

float erosionAmount() {
  return mix(0.1, 0.7, uGrain) * uGasErosion;
}

// The fbm sum sits close to its mean by construction; stretching it around
// 0.5 is what turns a soft grey haze into separate billows.
float contrast(float v) {
  return clamp((v - 0.5) * 1.7 + 0.5, 0.0, 1.0);
}

// Schneider's perlin-worley: the inverted worley channel raises the value
// noise's floor into rounded billow cores instead of wispy filaments. How
// much of that channel is let in is the gas type's dial between the two —
// above 1 the cells fill the floor in and the mass rounds off, below it they
// cut and the billows tear back into filaments.
float puffMask(vec2 n) {
  return clamp(remap(n.r, 1.0 - n.g * uGasWorley, 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Full density: octave 0 doubles as the puff mask, so the fetch count is
// exactly the octave count (plus one more while Treble wisps are audible).
float density(vec3 p, float sh, int octaves) {
  vec3 q = flowSpace(p);
  vec2 n0 = texture(uNoise, q * BASE_FREQ).rg;
  float f = 0.5 * n0.r;
  float norm = 0.5;
  float amp = 0.25;
  float freq = BASE_FREQ * 2.7;
  for (int o = 1; o < MAX_OCTAVES; o++) {
    if (o >= octaves) break;
    f += amp * texture(uNoise, q * freq).r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.7;
  }
  f = contrast(f / norm);

  float d = clamp(remap(sh * mix(0.35, 1.0, puffMask(n0)), erosionAmount() * (1.0 - f), 1.0, 0.0, 1.0), 0.0, 1.0);

  // Treble wisps: one high-frequency octave shaved off the rim, so hats and
  // cymbals fray the cloud's edge rather than lighting it.
  float wisp = uSpark * uHigh;
  if (wisp > 0.01) {
    float w = texture(uNoise, q * (BASE_FREQ * 8.0)).g;
    d = clamp(d - wisp * 0.4 * (1.0 - w) * (1.0 - sh), 0.0, 1.0);
  }
  return d;
}

// One-fetch density, for the shadow taps toward the sun — the difference
// against density() is invisible once it has been through exp().
float densityCheap(vec3 p) {
  float sh = shape(p);
  if (sh <= 0.002) return 0.0;
  vec2 n0 = texture(uNoise, flowSpace(p) * BASE_FREQ).rg;
  return clamp(remap(sh * mix(0.35, 1.0, puffMask(n0)), erosionAmount() * (1.0 - contrast(n0.r)), 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Sky behind the volume: a near-black gradient plus a faint haze around each
// live bolt, projected through the forward camera. Deliberately weak — the
// volume itself carries most of the flash.
vec3 background(vec2 uv, float aspect, float bloom) {
  vec2 q = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);
  vec3 sky = mix(vec3(0.02, 0.02, 0.035), palette(0.55, uPalA, uPalB, uPalC, uPalD) * 0.06, 0.5);
  vec3 col = sky * (1.1 - 0.5 * uv.y);

  float sigma = mix(0.12, 0.35, uReach);
  float halo = 0.0;
  float core = 0.0;
  for (int i = 0; i < MAX_STRIKES; i++) {
    float s = uStrikeStrength[i];
    if (s <= 0.001) continue;
    vec3 va = cloudToView(uStrikeA[i]);
    vec3 vb = cloudToView(uStrikeB[i]);
    vec2 a = viewToRoomNdc(va) * vec2(aspect, 1.0);
    vec2 b = viewToRoomNdc(vb) * vec2(aspect, 1.0);
    vec2 ab = b - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(q - (a + ab * t));
    float sig = sigma * CAM_DIST / (0.5 * (va.z + vb.z));
    float x = (d * d) / (sig * sig);
    halo += s * exp(-x);
    // A second, tighter lobe hugging the channel — a lens bloom rather than
    // a cloud glow. It is what gives the bolt presence in Mesh and Points,
    // where there is no gas to carry the flash and the polyline is otherwise
    // a one-pixel scratch; the repo has no post pass, so the projection this
    // haze already does is the only place to get it from.
    core += s * exp(-x * BOLT_BLOOM_TIGHT);
  }
  return col + boltColor() * (halo * 0.12 + core * bloom) * mix(0.5, 2.0, uStrike);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = roomAspect();
  int mode = int(uMode + 0.5);
  bool geometry = mode == MODE_MESH || mode == MODE_POINTS || mode == MODE_FILAMENTS;
  bool march = !geometry;
  // The bloom is what a geometry mode has instead of gas around the channel,
  // so it draws at full strength there and at a fraction of it in the
  // marched modes, where the volume is already carrying the flash and a
  // screen-space halo on top only reads as a sprite pasted over the cloud.
  float bloom = BOLT_BLOOM_GAIN * (geometry ? 1.0 : 0.3);
  vec3 bg = background(uv, aspect, bloom);

  // The geometry modes: no march at all. The lattice, the point pass or the
  // strands draw the cloud, so all this pass owes them is something to draw
  // over — sky, the haze around each live bolt, and the drop flash. Every
  // pixel is still written (nothing else in the shared gallery context clears
  // colour).
  if (!march) {
    vec3 flat_ = bg + boltColor() * 0.1 * uDropPulse * uDropStorm;
    outColor = vec4(tonemap(flat_), 1.0);
    return;
  }

  bool voxel = mode == MODE_VOXEL;
  float voxelSize = mix(VOXEL_MIN, VOXEL_MAX, uGrain);

  // The ray, built in the camera's own space and pushed back into cloud
  // space: the exact inverse of cloudToView (see CAMERA_GLSL).
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rdCam = normalize(vec3(ndc.x * aspect / FOCAL_Y, ndc.y / FOCAL_Y, -1.0));
  vec3 ro = unrotate(vec3(0.0, 0.0, CAM_DIST)) / swellScale();
  vec3 rd = normalize(unrotate(rdCam));

  // Ray vs the bounding ellipsoid, solved in the space where it is a unit
  // sphere. Half-b form: t = (-B +/- sqrt(B*B - A*C)) / A.
  vec3 eo = ro / BOUND;
  vec3 ed = rd / BOUND;
  float A = dot(ed, ed);
  float B = dot(eo, ed);
  float C = dot(eo, eo) - 1.0;
  float disc = B * B - A * C;

  vec3 col = bg;
  float T = 1.0;
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float tNear = (-B - sq) / A;
    float tFar = (-B + sq) / A;
    if (tFar > 0.0) {
      tNear = max(tNear, 0.0);
      int steps = int(min(float(MAX_STEPS), max(8.0, uMaxSteps)));
      float stepLen = (tFar - tNear) / float(steps);
      // Jitter the first sample by a fraction of a step, or the march bands
      // the cloud into visible shells.
      float t = tNear + hash12(gl_FragCoord.xy + fract(uTime) * 137.0) * stepLen;

      int octaves = uDetail < 0.5 ? 2 : MAX_OCTAVES;
      float sigma = mix(3.0, 10.0, uDensity) * uGasExtinct;
      // The resting light: the lift the sun ramp is scaled by. The skylight
      // below takes uAmbient as a plain multiple.
      float lift = ambientLift(uAmbient);
      float reachR = mix(0.15, 0.6, uReach);
      float gain = mix(0.5, 2.0, uStrike);
      vec3 tint = boltColor();
      vec3 skyTop = mix(vec3(0.42, 0.48, 0.62), palette(0.55, uPalA, uPalB, uPalC, uPalD), 0.35);
      vec3 acc = vec3(0.0);
      // The screen mapping doesn't depend on where along the ray the sample
      // is, so it resolves once per fragment; only the cloud mapping has to
      // be evaluated per step.
      bool cloudMap = uSpectrumMap >= SPECTRUM_MAP_CLOUD - 0.5;
      float screenGain = spectrumGain(vec3(0.0), ndc);

      for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= steps) break;
        vec3 p = ro + rd * t;
        t += stepLen;

        // Voxel mode reads the field on a lattice instead of continuously:
        // this one snap of the sample position is the whole trick, and it is
        // what stacks the gas into cubes, since every sample inside a cell
        // now reads the one density.
        vec3 sp = voxel ? (floor(p / voxelSize) + 0.5) * voxelSize : p;

        // Empty space costs one fetch and then strides twice as far: most of
        // the bounding ellipsoid is air, and the density is ~0 for a while
        // either side of the shape's edge, so the coarser sampling there is
        // invisible (and the per-pixel jitter scatters what little shows).
        float sh = shape(sp);
        if (sh <= 0.002) { t += stepLen; continue; }

        // The bolt's own emission and the light it scatters into the gas.
        // Computed before the density gate below: the plasma emits whether or
        // not there is gas at this sample, so a bolt crossing a hole the
        // erosion punched still reads as a streak instead of vanishing.
        //
        // The in-scattered body is the same 1/(1+r^2) falloff every mode
        // uses. The loop also keeps the offset to the brightest contributor,
        // which is the direction the phase term and the shadow tap below both
        // work along: they are applied once, to the summed glow, rather than
        // per strike. Away from the rare frames with two strikes at once the
        // brightest one *is* the light, and a per-strike phase cost the
        // march about a fifth of its frame time for a difference that never
        // showed in a screenshot.
        float glow = 0.0;
        float core = 0.0;
        float bestG = 0.0;
        vec3 bestToL = vec3(0.0);
        for (int k = 0; k < MAX_STRIKES; k++) {
          float s = uStrikeStrength[k];
          if (s <= 0.001) continue;
          vec3 ab = uStrikeB[k] - uStrikeA[k];
          float ct = clamp(dot(p - uStrikeA[k], ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          vec3 toL = uStrikeA[k] + ab * ct - p;
          float d2 = dot(toL, toL);
          float body = s / (1.0 + d2 / (reachR * reachR));
          glow += body;
          core += s * 2.0 * exp(-d2 / 0.004);
          if (body > bestG) {
            bestG = body;
            bestToL = toL;
          }
        }

        float d = density(sp, sh, octaves);
        if (d > 0.002) {
          // The phase term, and what the flash has to burn through to get
          // here — one tap toward the strike that matters at this sample.
          // The occluder is the silhouette alone rather than the full
          // density: the erosion detail is far finer than a flash's own
          // falloff, so all it added was noise, and a shape() tap is one
          // fetch where densityCheap is two. Both are skipped where the
          // strike is too faint here for either to show, so between beats
          // the whole block costs a compare; the tap is also skipped in
          // Voxel, which has no shadowing by design.
          if (bestG > STRIKE_SHADE_MIN) {
            vec3 ld = normalize(bestToL);
            // Faded in across the gate rather than switched on at it. The
            // phase term alone swings the glow by a factor of five, so a
            // hard threshold drew a ring exactly where the shading started.
            float w = smoothstep(STRIKE_SHADE_MIN, STRIKE_SHADE_FULL, bestG);
            float lit = mix(1.0, henyeyGreenstein(dot(ld, rd)), HG_MIX);
            // The occluder is how much *denser* the silhouette gets toward
            // the channel, not how dense it is here. The strike is buried
            // inside the cloud, so an absolute tap is a near-constant
            // exp(-K) across the whole flash: it dims the strike instead of
            // shaping it, which is how this pass first lost most of a
            // bolt's reach. The difference only darkens where there is a
            // clump between this sample and the channel, and leaves the
            // light's own falloff alone.
            if (!voxel) lit *= exp(-STRIKE_SHADOW_K * max(shape(p + ld * STRIKE_SHADOW_DIST) - sh, 0.0));
            glow *= mix(1.0, lit, w);
          }
          // Out in the far tail of a flash, or between beats, there is no
          // light here to shade and this costs the plain falloff and a
          // compare.
          vec3 flash = glow > 0.0 ? flashTint(tint, glow) * glow * gain : vec3(0.0);
          float a = 1.0 - exp(-d * sigma * stepLen);
          // Voxel shading is flat by design: the sun's shadow taps would
          // soften exactly the faceting this mode exists for, and skipping
          // them makes it the cheapest of the marched modes.
          vec3 sun;
          if (voxel) {
            // Tinted toward the palette rather than the sun's own white: with
            // no shadow term the flat lighting is the mode's whole colour,
            // and plain white made the cloud read as grey card.
            sun = mix(vec3(1.0, 0.96, 0.92), palette(0.35, uPalA, uPalB, uPalC, uPalD), 0.45)
              * 0.85 * lift;
          } else {
            // Two taps toward the sun. The near one reads the eroded
            // density; the far one only has to answer "is there cloud mass
            // up there", and the silhouette answers that in one fetch where
            // densityCheap needs two — at half a unit away the erosion
            // detail is long gone through exp() anyway. That saved fetch is
            // what pays for the strike shadow tap above.
            float s1 = densityCheap(p + SUN_DIR * 0.18);
            float s2 = uDetail < 0.5 ? 0.0 : shape(p + SUN_DIR * 0.5);
            float shadow = exp(-1.9 * s1 - 1.15 * s2);
            // Powder: thin gas scatters less back toward the camera, which is
            // what keeps the wispy rim from reading as bright as the core.
            // Normalized so full density is a clean 1.0 — unnormalized it was
            // a few percent of light quietly thrown away everywhere.
            float powder = (1.0 - exp(-d * 2.0)) * POWDER_NORM;
            // Deep gas isn't black, it's blue: what light reaches it has
            // bounced its way in off the sky, so the shadowed end of the ramp
            // is a cool floor rather than nothing. That colour shift with
            // depth is most of what makes the mass read as a solid body
            // rather than a flat grey card.
            sun = mix(SHADE_COL, SUN_COL, shadow)
              * 0.9 * lift * mix(1.0, powder, 0.35 * uGasPowder);
          }
          float heightFrac = clamp((sp.y + BOUND.y) / (2.0 * BOUND.y), 0.0, 1.0);
          vec3 ambient = skyTop * mix(0.35, 1.0, heightFrac) * uAmbient * (0.5 + uEnergy);
          // The band under this sample scales what the gas is lit by, not
          // what it absorbs, and never the lightning — so a loud band reads
          // as a brighter part of the same cloud.
          float sg = cloudMap ? spectrumGain(sp, ndc) : screenGain;
          // Which section of the cloud this sample is in, and whether that
          // section is lit — on the resting light only, exactly like the
          // spectrum gain and for the same reason: the flash below is what
          // lightning does to the gas, and it reaches a dark section whole.
          float sect = sectionGain(sp);
          // The gas type's tint grades what the cloud is *lit* by and never
          // the flash, for the same reason the spectrum gain doesn't: a
          // charcoal smoke should still be lit white-hot by its own bolt.
          acc += T * a * ((sun + ambient) * uGasTint * sg * sect + flash);
          T *= 1.0 - a;
        }
        acc += T * tint * core * gain * stepLen * 4.0;
        if (T < 0.02) break;
      }
      // Posterizing is what makes Voxel read as a rendering of a cloud rather
      // than a blurry cloud: the faceted samples land on a handful of flat
      // shades instead of a continuous ramp. It bands what the volume itself
      // emitted, not the composite — banding the sky behind it drew the
      // background haze as a set of hard rings.
      if (voxel) acc = floor(acc * VOXEL_BANDS + 0.5) / VOXEL_BANDS;
      col = bg * T + acc;
    }
  }

  // Whole-frame flash on a drop, in front of the volume rather than behind it.
  col += boltColor() * 0.1 * uDropPulse * uDropStorm;

  outColor = vec4(tonemap(col), 1.0);
}
`;

// The lattice. One program for both of Mesh mode's draws — the lines, then
// the nodes — with uIsNode as the only difference between them, so a node
// glows hotter than the wires it joins.
const MESH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
out vec3 vColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform float uIsNode; // 1.0 only during the nodes (gl.POINTS) draw
${AMBIENT_LIFT_GLSL}
${SECTION_GLSL}
${PALETTE_GLSL}
${SAMPLE_BANDS_GLSL}
${CAMERA_GLSL}
${SPECTRUM_GLSL}
${PROJECT_GLSL}
${BOLT_COLOR_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define EXTENT_Y ${CLOUD_EXTENT_Y.toFixed(2)}
${STRIKE_LIGHT_GLSL}

float hash11(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

void main() {
  float seed = hash11(dot(aPos, vec3(12.9898, 78.233, 37.719)));
  // The mesh is only rebuilt when the shape moves (see the file header);
  // this churn is what keeps the lattice alive in between.
  vec3 p = aPos + 0.02 * vec3(
    sin(uTime * 0.8 + seed * 31.0),
    sin(uTime * 1.1 + seed * 17.0),
    sin(uTime * 0.6 + seed * 23.0));

  // A lighter hand than the points get: a lattice is mostly empty space, so
  // the same gain flattens the whole mass to white. Here the flash reads as a
  // gradient across the wires, with the drawn bolt the brightest thing in it.
  float light = strikeLight(p, mix(0.15, 0.6, uReach)) * mix(0.25, 0.95, uStrike);

  // Digital: a cold cyan wire pulled part-way toward the palette, skylit
  // brighter toward the top of the cloud the way the gas is.
  vec3 view = cloudToView(p);
  vec3 wire = mix(vec3(0.25, 0.85, 1.0), palette(0.45 + 0.2 * seed, uPalA, uPalB, uPalC, uPalD), 0.5);
  float height = clamp((aPos.y + EXTENT_Y) / (2.0 * EXTENT_Y), 0.0, 1.0);
  // Same spectrum mapping the gas gets, on the same term: how brightly this
  // node is lit, never how hard the flash reaches it. depthFade is the point
  // cloud's own aerial perspective, on the same numbers — without it every
  // wire in the lattice comes back at the same brightness and the whole mass
  // reads as one flat tangle instead of a body with a far side.
  // The 0.18 used to be a flat floor at every Ambient glow setting; it is
  // still exactly 0.18 at and above the slider's default and falls away to an
  // ember below it, on the same sliding floor the march's sun ramp rides
  // (normalized here because this floor was additive, not the low end of a
  // mix — see AMB_FLOOR_NORM).
  // sectionGain is on this same resting term and nothing else — the flash
  // below reaches a dark section of the lattice whole.
  float lit = (0.18 * ambientFloor() * AMB_FLOOR_NORM
      + 0.9 * uAmbient * (0.5 + uEnergy) * (0.45 + 0.55 * height))
    * depthFade(view.z) * spectrumGain(p, viewToRoomNdc(view)) * sectionGain(p);
  // Treble shimmer: scattered nodes and wires glint on high-band hits.
  float shimmer = uSpark * uHighPulse * step(0.93, hash11(seed * 7.1 + floor(uTime * 12.0)));

  vColor = (wire * lit
    + flashTint(boltColor(), light) * light
    + vec3(0.6, 0.9, 1.0) * shimmer) * mix(1.0, 2.2, uIsNode);

  gl_Position = cloudToClip(p);
  gl_PointSize = clamp(mix(1.8, 5.0, uGrain) * (uResolution.y / 1080.0) * (CAM_DIST / view.z), 1.5, 14.0);
}
`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
uniform float uIsNode;

void main() {
  // gl_PointCoord is only meaningful in the nodes draw; the lines pass takes
  // the colour flat.
  float mask = 1.0;
  if (uIsNode > 0.5) {
    float r = length(gl_PointCoord - 0.5);
    mask = smoothstep(0.5, 0.1, r);
  }
  outColor = vec4(vColor * mask, 1.0);
}
`;

// The bolt itself, as a camera-facing ribbon. Line width is stuck at 1 on
// WebGL whatever gl.lineWidth is asked for, so the channel is expanded into
// geometry instead: buildBoltTree writes every path vertex twice, and this
// stage pushes the two copies apart along the screen-space normal of the
// path's direction there. The width comes off the vertex's own attribute, so
// the ribbon tapers to nothing at every tip and the whole tree — main channel
// and branches — draws as one triangle strip (see buildBoltTree's layout).
//
// The screen normal is measured rather than derived: the path's cloud-space
// tangent is projected through the same cloudToClip every other geometry pass
// uses, one step along it, and the difference is the direction the channel
// runs in on screen. That way the swirl, the tilt and the bass swell are all
// accounted for without this stage knowing any of them exist.
const BOLT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aTan;   // unit tangent of the path at this vertex
layout(location = 2) in vec2 aShape; // x: signed half-width, y: fork level
out vec3 vGlow;
out vec3 vCore;
out float vSide;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
uniform float uBoltStrength; // this slot's strikeEnvelope value
${PALETTE_GLSL}
${CAMERA_GLSL}
${PROJECT_GLSL}
${BOLT_COLOR_GLSL}

// How far along the tangent the second projection is taken. Small enough that
// the difference is the tangent's own screen direction rather than a chord
// across the cloud, large enough not to be lost in the divide.
#define TAN_STEP 0.01
// The ribbon's half-width in pixels at each end of the Bolt setting, before
// perspective, and how far perspective is allowed to push it either way.
#define BOLT_HALF_MIN_PX ${BOLT_HALF_MIN_PX.toFixed(2)}
#define BOLT_HALF_MAX_PX ${BOLT_HALF_MAX_PX.toFixed(2)}
#define BOLT_PERSP_MIN 0.5
#define BOLT_PERSP_MAX 2.2
// Below this the ribbon is dropped to nothing instead of drawn: a quad
// narrower than a pixel rasterizes as a dotted sparkle rather than a faint
// line, which is what the far tips and the low end of the Bolt setting would
// otherwise be made of.
#define BOLT_MIN_HALF_PX 0.5
// Branches ride the Bolt setting harder than the channel does, so the slider
// reads as "how much bolt" rather than only "how bright": raised to the fork
// level, it leaves a bare channel at the low end and a full tree at the top.
#define BOLT_BRANCH_KNEE_LO 0.10
#define BOLT_BRANCH_KNEE_HI 0.75
// A branch is a dimmer channel as well as a thinner one.
#define BOLT_BRANCH_DIM 0.85

void main() {
  // The same envelope that lights the gas, so the drawn bolt flashes and
  // flickers with the light it is supposed to be casting — and rides the beat
  // on top of that, which is the connection this mode exists to make.
  float bright = uBoltStrength * uBolt * (1.0 + 0.25 * uBeatPulse);
  float branchAmt = smoothstep(BOLT_BRANCH_KNEE_LO, BOLT_BRANCH_KNEE_HI, uBolt);
  float fork = pow(max(branchAmt, 1e-4), aShape.y);
  bright *= mix(1.0, BOLT_BRANCH_DIM, min(aShape.y, 1.0));

  vec3 tint = boltColor();
  vGlow = tint * 1.1 * bright;
  vCore = mix(tint, vec3(1.0), 0.85) * 2.6 * bright;
  vSide = sign(aShape.x);

  // The slice of the shared canvas this scene owns, in pixels — clip space
  // here is normalized to that slice, not to the whole drawing buffer.
  vec2 vpPx = max(uResolution * uViewport.zw, vec2(1.0));
  vec4 clip = cloudToClip(aPos);
  vec4 ahead = cloudToClip(aPos + aTan * TAN_STEP);
  vec2 run = (ahead.xy - clip.xy) * vpPx;
  vec2 nrm = dot(run, run) > 1e-12 ? normalize(vec2(-run.y, run.x)) : vec2(1.0, 0.0);

  vec3 view = cloudToView(aPos);
  float persp = clamp(CAM_DIST / view.z, BOLT_PERSP_MIN, BOLT_PERSP_MAX);
  float halfPx = abs(aShape.x) * fork * mix(BOLT_HALF_MIN_PX, BOLT_HALF_MAX_PX, uBolt)
    * (vpPx.y / 1080.0) * persp;
  halfPx *= step(BOLT_MIN_HALF_PX, halfPx);
  gl_Position = vec4(clip.xy + nrm * sign(aShape.x) * halfPx * 2.0 / vpPx, 0.0, 1.0);
}
`;

// Across the ribbon: a white-hot core with a soft additive shoulder, so the
// channel reads as a lit filament rather than a flat band. Both terms fall to
// nothing at the edge, which is also all the antialiasing a ribbon a few
// pixels wide needs.
const BOLT_FRAG = `#version 300 es
precision highp float;
in vec3 vGlow;
in vec3 vCore;
in float vSide;
out vec4 outColor;

void main() {
  float e = clamp(1.0 - abs(vSide), 0.0, 1.0);
  float glow = e * e;
  float core = pow(e, 8.0);
  outColor = vec4(vGlow * glow + vCore * core, 1.0);
}
`;

// The point cloud: the particles *are* the gas — static lobe-sampled
// positions with a slow sinusoidal churn, an ambient skylit base colour, the
// same per-strike lighting the march does, and treble sparks.
const POINT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSeed;
out vec3 vColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform float uCountBoost;
// Included for the floor's knee alone: this pass's own resting light has
// never carried a floor (it is a plain multiple of uAmbient), but sectionGain
// measures the ember it must not darken any further against that same knee.
${AMBIENT_LIFT_GLSL}
${SECTION_GLSL}
${PALETTE_GLSL}
${SAMPLE_BANDS_GLSL}
${CAMERA_GLSL}
${SPECTRUM_GLSL}
${PROJECT_GLSL}
${BOLT_COLOR_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define EXTENT_Y ${CLOUD_EXTENT_Y.toFixed(2)}
${STRIKE_LIGHT_GLSL}

float hash11(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

void main() {
  float seed = aSeed;
  float t = uTime;

  // Slow internal churn, so the cloud never sits perfectly still.
  vec3 p = aPos + 0.05 * vec3(
    sin(t * 0.7 + seed * 31.0),
    sin(t * 0.9 + seed * 17.0),
    sin(t * 0.6 + seed * 23.0));

  // The gain is kept modest on purpose: the particles are additive with no
  // tonemap behind them, and they overlap, so a flash that looks reasonable
  // per particle piles up into a flat white blob with the drawn bolt lost
  // inside it. Below saturation the flash reads as a lit region of cloud and
  // the bolt stays the hottest thing in the frame.
  float light = strikeLight(p, mix(0.15, 0.6, uReach)) * mix(0.12, 0.45, uStrike);

  vec3 view = cloudToView(p);
  // Resting glow: brighter toward the top of the cloud, as if skylit, and
  // dimmer with distance so the far side reads as behind the near side.
  float heightShade = 0.55 + 0.45 * clamp((aPos.y + EXTENT_Y) / (2.0 * EXTENT_Y), 0.0, 1.0);
  // Same spectrum mapping the gas and the lattice get, on the same term, and
  // the same depthFade the lattice uses.
  float ambient = uAmbient * (0.5 + uEnergy) * heightShade * depthFade(view.z) * (0.7 + 0.3 * hash11(seed * 3.7))
    * spectrumGain(p, viewToRoomNdc(view)) * sectionGain(p);
  // Treble sparks: a scattered few particles glint on high-band hits.
  float spark = uSpark * uHighPulse * step(0.96, hash11(seed * 7.1 + floor(t * 10.0)));

  vec3 base = mix(vec3(0.32, 0.34, 0.5), palette(0.6 + 0.1 * seed, uPalA, uPalB, uPalC, uPalD), 0.5) * 0.4;
  vColor = base * ambient + flashTint(boltColor(), light) * light + vec3(1.0) * spark;

  gl_Position = cloudToClip(p);

  // Sized in device pixels against a 1080p reference so the cloud reads the
  // same in a gallery tile and at 4K; uCountBoost keeps sparse clouds dense.
  // The floor is where the soft disc in POINT_FRAG still covers whole
  // pixels — below it a gallery tile's sprites thin out to almost nothing.
  float px = mix(2.0, 10.0, uGrain) * (uResolution.y / 1080.0) * uCountBoost
    * (CAM_DIST / view.z) * (0.6 + 0.8 * seed);
  gl_PointSize = clamp(px, 2.5, 40.0);
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;

void main() {
  float r = length(gl_PointCoord - 0.5);
  float mask = smoothstep(0.5, 0.1, r);
  outColor = vec4(vColor * mask, 1.0);
}
`;

// The strands (Filaments mode). Each is a particle traced through the flow
// volume: the vertex buffer holds nothing but a seed point, a per-strand
// random value and a step index, and the vertex shader integrates that many
// Euler steps along the field to find where this vertex actually is. A strand
// is emitted as FIL_STEPS gl.LINES pairs, so step j appears twice (once
// ending segment j-1, once starting segment j) and both copies integrate to
// the same point — O(K^2) fetches per strand, all of it vertex-stage, which
// buys a tangle that costs nothing on the CPU and re-traces itself every
// frame as the field crawls.
//
// Why the sampler isn't called uFlow: the `flow` setting already owns that
// name (settingUniformName), and two declarations of one name is a shader
// compile error — the same trap the `grain` setting's comment describes.
const FILAMENT_VERT = `#version 300 es
precision highp float;
precision highp sampler3D;
layout(location = 0) in vec3 aPos;   // the strand's seed point, in cloud space
layout(location = 1) in float aSeed; // per-strand [0,1)
layout(location = 2) in float aStep; // how far along the strand this vertex is
out vec3 vColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${STRIKE_UNIFORMS_GLSL}
uniform float uCountBoost;
uniform highp sampler3D uFlowTex; // the curl field — buildFlowVolume
uniform highp sampler3D uShape;   // the baked silhouettes, one per channel
uniform vec4 uShapeMix;           // shapePhaseWeights, as a per-channel weight
uniform float uGasFreq;           // GAS_RECIPES.freq — see flowCoord below
// As in POINT_VERT: included for the floor knee sectionGain measures against.
${AMBIENT_LIFT_GLSL}
${SECTION_GLSL}
${PALETTE_GLSL}
${SAMPLE_BANDS_GLSL}
${CAMERA_GLSL}
${SPECTRUM_GLSL}
${PROJECT_GLSL}
${BOLT_COLOR_GLSL}

#define MAX_STRIKES ${MAX_STRIKES}
#define EXTENT_Y ${CLOUD_EXTENT_Y.toFixed(2)}
#define FIL_STEPS ${FIL_STEPS}
#define FIL_STEP_LEN ${FIL_STEP_LEN.toFixed(4)}
#define FLOW_FREQ ${FLOW_FREQ.toFixed(4)}
#define GAS_FREQ_STRANDS ${GAS_FREQ_STRANDS.toFixed(2)}
#define FIL_IMPULSE_MAX ${FIL_IMPULSE_MAX.toFixed(4)}
const vec3 BOUND = vec3(${BOUND_X.toFixed(4)}, ${BOUND_Y.toFixed(4)}, ${BOUND_Z.toFixed(4)});
${STRIKE_LIGHT_GLSL}

float hash11(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

// How fast the tangle crawls, off the Flow setting.
float flowRate() {
  return mix(0.15, 1.6, uFlow);
}

// Where the flow field is read — the same scrolling idea flowSpace() uses for
// the gas: the whole field drifts downwind and churns against itself, so the
// strands re-trace along a slowly moving field instead of hanging in place.
// The volume tiles, so this is a plain scale of the cloud-space position.
// The gas type's frequency reaches the strands too, at half strength: a
// wispier gas curls the tangle tighter, but a strand traced at the gas's
// full frequency multiplier stops reading as a hair and starts reading as a
// scribble, since FIL_STEPS is fixed and a tighter field spends them all
// inside one swirl. Identity at freq 1 whatever the mix.
vec3 flowCoord(vec3 p) {
  vec3 q = p * FLOW_FREQ * mix(1.0, uGasFreq, GAS_FREQ_STRANDS)
    + vec3(uFlowPhase * 0.05, 0.0, uFlowPhase * 0.025) * flowRate();
  return q + 0.03 * sin(q.zxy * 2.0 + uTime * 0.2 * flowRate());
}

// textureLod, not texture: a vertex shader has no derivatives to pick a level
// from, so the level is named rather than left to the implementation.
vec3 flowVec(vec3 p) {
  return textureLod(uFlowTex, flowCoord(p), 0.0).rgb * 2.0 - 1.0;
}

void main() {
  // Trace this vertex's own prefix of the strand. The bound is constant and
  // the live count comes off the attribute, per the break idiom the march
  // uses for uMaxSteps.
  vec3 p = aPos;
  for (int i = 0; i < FIL_STEPS; i++) {
    if (float(i) >= aStep) break;
    p += FIL_STEP_LEN * flowVec(p);
  }

  vec3 tangent = flowVec(p);
  float tl = length(tangent);
  vec3 dir = tl > 1e-4 ? tangent / tl : vec3(0.0, 1.0, 0.0);

  // The same per-strike falloff every geometry pass uses, at the points'
  // gain — the strands overlap as heavily as the particles do, and this pass
  // has no tonemap behind it either.
  float light = strikeLight(p, mix(0.15, 0.6, uReach)) * mix(0.12, 0.45, uStrike);
  // A strike shoves the tangle rather than only tinting it: bounded, and
  // along the strand's own flow direction, so a shoved strand still lies
  // along the field instead of being blown off it.
  p += dir * (FIL_IMPULSE_MAX * clamp(light * 3.0, 0.0, 1.0) * mix(0.35, 1.0, uFlow));

  // The silhouette the gas and the lattice draw, sampled where this vertex
  // ended up: it is what fades a strand out at the cloud's edge, and what
  // lets cloudShape/morphPhase eat the tangle into a different mass with no
  // CPU rebuild — the seed points never move, only what is lit does.
  float sh = dot(textureLod(uShape, p / (2.0 * BOUND) + 0.5, 0.0), uShapeMix);
  float mask = smoothstep(0.01, 0.20, sh);

  vec3 view = cloudToView(p);
  // The POINT_VERT terms, so every mode is lit by the same cloud: skylit
  // brighter toward the top, aerial perspective with depth, the spectrum
  // mapping on the ambient side only, and treble sparks.
  float heightShade = 0.55 + 0.45 * clamp((aPos.y + EXTENT_Y) / (2.0 * EXTENT_Y), 0.0, 1.0);
  float ambient = uAmbient * (0.5 + uEnergy) * heightShade * depthFade(view.z)
    * (0.7 + 0.3 * hash11(aSeed * 3.7)) * spectrumGain(p, viewToRoomNdc(view)) * sectionGain(p);
  float spark = uSpark * uHighPulse * step(0.96, hash11(aSeed * 7.1 + floor(uTime * 10.0)));

  // A hair is faint on its own and the tangle is bright where it bunches, so
  // the gain stays low and the overlap does the work. Detail is what a 1px
  // line has instead of a point size, and uCountBoost keeps a sparse cloud
  // (a gallery tile's) from thinning out to nothing.
  float trail = 1.0 - 0.45 * (aStep / float(FIL_STEPS));
  float gain = mix(0.35, 1.1, uGrain) * uCountBoost * mask * trail;

  vec3 strand = mix(vec3(0.25, 0.85, 1.0), palette(0.5 + 0.15 * aSeed, uPalA, uPalB, uPalC, uPalD), 0.45);
  vColor = strand * ambient * gain
    + flashTint(boltColor(), light) * light * mask * trail
    + vec3(0.6, 0.9, 1.0) * spark * mask;

  gl_Position = cloudToClip(p);
}
`;

const FILAMENT_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;

void main() {
  outColor = vec4(vColor, 1.0);
}
`;

// ---------------------------------------------------------------------------

// None of these depend on anything but the seed, and none is cheap to build
// (the noise alone is ~10^7 distance tests; the density grids run the lobe
// loop over a lattice, once per variant) — build them once per page, not once
// per mount. init() runs on every gallery<->viz swap.
let cachedNoise: Uint8Array | null = null;
let cachedShape: { lobeSets: Lobe[][]; data: Uint8Array } | null = null;
let cachedGrids: { res: number; grids: Float32Array[] } | null = null;
function noiseVolume(): Uint8Array {
  if (!cachedNoise) cachedNoise = buildNoiseVolume(NOISE_SIZE, CLOUD_SEED);
  return cachedNoise;
}
function cloudVolumes() {
  if (!cachedShape) {
    const lobeSets = buildLobeSets();
    cachedShape = { lobeSets, data: buildShapeVolume(SHAPE_SIZE, lobeSets) };
  }
  return cachedShape;
}
function densityGrids(res: number): Float32Array[] {
  if (!cachedGrids || cachedGrids.res !== res) {
    cachedGrids = { res, grids: meshDensityGrids(res, cloudVolumes().lobeSets, noiseVolume()) };
  }
  return cachedGrids.grids;
}

// The CPU-side point cloud is reused across mounts of the same count — init
// runs on every gallery<->viz transition, so sampling the whole budget each
// time would be a visible hitch.
let cachedCloud: { count: number; cloud: ReturnType<typeof buildCloud> } | null = null;
function cloudFor(n: number) {
  if (!cachedCloud || cachedCloud.count !== n) cachedCloud = { count: n, cloud: buildCloud(n) };
  return cachedCloud.cloud;
}

let cachedFlow: Uint8Array | null = null;
function flowVolume(): Uint8Array {
  if (!cachedFlow) cachedFlow = buildFlowVolume(FLOW_SIZE, CLOUD_SEED);
  return cachedFlow;
}

/** One gas type's recipe, as the plain uniforms GAS_UNIFORMS_GLSL declares.
 *  Every value is a factor on an expression the march already had, so
 *  Cumulus's all-identity entry uploads a shader that computes exactly what
 *  it computed before the setting existed. */
function uploadGasRecipe(p: GLProgram, r: GasRecipe): void {
  p.setF("uGasFreq", r.freq);
  p.setV3v("uGasStretch", r.stretch);
  p.setF("uGasErosion", r.erosion);
  p.setF("uGasWorley", r.worley);
  p.setF("uGasExtinct", r.extinction);
  p.setF("uGasPowder", r.powder);
  p.setV3v("uGasTint", r.tint);
}

export const stormScene: Scene = (() => {
  let prog: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let noiseTex: WebGLTexture | null = null;
  let shapeTex: WebGLTexture | null = null;
  let pointProg: GLProgram | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  let posBuf: WebGLBuffer | null = null;
  let seedBuf: WebGLBuffer | null = null;
  let meshProg: GLProgram | null = null;
  let meshVao: WebGLVertexArrayObject | null = null;
  let meshPosBuf: WebGLBuffer | null = null;
  let meshIdxBuf: WebGLBuffer | null = null;
  let boltProg: GLProgram | null = null;
  let boltVao: WebGLVertexArrayObject | null = null;
  let boltBuf: WebGLBuffer | null = null;
  let flowTex: WebGLTexture | null = null;
  let filProg: GLProgram | null = null;
  let filVao: WebGLVertexArrayObject | null = null;
  let filPosBuf: WebGLBuffer | null = null;
  let filSeedBuf: WebGLBuffer | null = null;
  let filStepBuf: WebGLBuffer | null = null;
  let strandCount = 0;
  let count = 0;
  let meshRes = MESH_RES_HIGH;
  let meshVertCount = 0;
  let meshIndexCount = 0;
  let meshPhase = Number.NaN; // NaN = never meshed
  let meshTimeSec = -1e6;
  let pool: ReturnType<typeof createStrikePool> | null = null;
  let cells: ReturnType<typeof createCellGlow> | null = null;
  // Last-drawn pulse levels and clock, for the rise detection and render-dt
  // measurement the file header explains.
  let prevBeatPulse = 0;
  let prevLowPulse = 0;
  let prevDropPulse = 0;
  // The band rises the sections read on top of the beat — same edge detection,
  // same reason (see the file header).
  let prevMidPulse = 0;
  let prevHighPulse = 0;
  let lastTimeSec: number | null = null;
  // The shape morph's own accumulated phase, in variants — see
  // advanceMorphPhase. Wraps through shapePhaseWeights, so it only grows.
  let morphPhase = 0;
  const bandsBuf = new Float32Array(NUM_BANDS);

  return {
    id: ID,
    name: "Storm",
    // The floor preset's raymarch budget is too thin for a volume this deep —
    // it bands into shells rather than reading as gas.
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      prog = createProgram(gl, VOLUME_FRAG);
      quadVao = createFullscreenQuad(gl);

      const { lobeSets, data: shapeData } = cloudVolumes();

      noiseTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RG8,
        NOISE_SIZE,
        NOISE_SIZE,
        NOISE_SIZE,
        0,
        gl.RG,
        gl.UNSIGNED_BYTE,
        noiseVolume(),
      );
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // REPEAT on all three axes is the whole point of building this volume
      // tileable: the texture coordinate is just a scale of the cloud-space
      // position, with no wrap handling in the shader.
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);

      shapeTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, shapeTex);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGBA8,
        SHAPE_SIZE,
        SHAPE_SIZE,
        SHAPE_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        shapeData,
      );
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

      // The flow field the strands are traced through. RGB8 is three bytes a
      // texel, so a row is only 4-byte aligned by luck — UNPACK_ALIGNMENT has
      // to come down for the upload and go back afterwards, since the pack
      // state is context-wide and the gallery shares this context.
      flowTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_3D, flowTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGB8,
        FLOW_SIZE,
        FLOW_SIZE,
        FLOW_SIZE,
        0,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        flowVolume(),
      );
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Tileable for the same reason the noise volume is: the coordinate is a
      // plain scale of the cloud-space position, with no wrap handling.
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
      gl.activeTexture(gl.TEXTURE0);

      // Sampler bindings are program state, so they only have to be set once.
      prog.use();
      gl.uniform1i(gl.getUniformLocation(prog.program, "uNoise"), 0);
      gl.uniform1i(gl.getUniformLocation(prog.program, "uShape"), 1);

      // The point cloud, sampled from the same lobes variant 0 of the shape
      // volume was baked from (buildCloud seeds buildLobes exactly as
      // buildLobeSets does), so the points sit inside the gas.
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      count = particleCountForQuality(ctx.quality.maxParticles);
      const cloud = cloudFor(count);

      pointVao = gl.createVertexArray();
      gl.bindVertexArray(pointVao);
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      seedBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
      gl.bufferData(gl.ARRAY_BUFFER, cloud.seeds, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      // The strands: static line-pair vertices over a prefix of the same
      // samples, since where a vertex lands is decided in the shader.
      filProg = createProgram(gl, FILAMENT_FRAG, FILAMENT_VERT);
      strandCount = filamentStrandCount(ctx.quality.maxParticles);
      const strands = buildFilamentVertices(cloud.positions, cloud.seeds, strandCount);
      filVao = gl.createVertexArray();
      gl.bindVertexArray(filVao);
      filPosBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, filPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, strands.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      filSeedBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, filSeedBuf);
      gl.bufferData(gl.ARRAY_BUFFER, strands.seeds, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      filStepBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, filStepBuf);
      gl.bufferData(gl.ARRAY_BUFFER, strands.steps, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      filProg.use();
      gl.uniform1i(gl.getUniformLocation(filProg.program, "uShape"), 1);
      gl.uniform1i(gl.getUniformLocation(filProg.program, "uFlowTex"), 2);

      // The lattice. Its contents change as the cloud morphs, so both buffers
      // are DYNAMIC_DRAW at a fixed capacity and a re-mesh is a bufferSubData
      // rather than a reallocation.
      meshProg = createProgram(gl, MESH_FRAG, MESH_VERT);
      meshRes = ctx.quality.detail < 0.6 ? MESH_RES_LOW : MESH_RES_HIGH;
      meshVertCount = 0;
      meshIndexCount = 0;
      meshPhase = Number.NaN;
      meshTimeSec = -1e6;
      meshVao = gl.createVertexArray();
      gl.bindVertexArray(meshVao);
      meshPosBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, MESH_MAX_VERTS * 3 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      meshIdxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MESH_MAX_INDICES * 4, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);

      // The bolts: one interleaved vertex buffer holding every slot's tree
      // back to back, so a strike only re-uploads its own slice. Which slot a
      // draw is drawing is a uniform rather than an attribute — the draw loop
      // is already per slot.
      boltProg = createProgram(gl, BOLT_FRAG, BOLT_VERT);
      boltVao = gl.createVertexArray();
      gl.bindVertexArray(boltVao);
      boltBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, boltBuf);
      gl.bufferData(gl.ARRAY_BUFFER, MAX_STRIKES * BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 3 * 4);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, BOLT_VERT_FLOATS * 4, 6 * 4);
      gl.bindVertexArray(null);

      pool = createStrikePool(lobeSets[0]);
      cells = createCellGlow();
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      prevMidPulse = 0;
      prevHighPulse = 0;
      lastTimeSec = null;
      morphPhase = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!prog || !quadVao || !pool || !cells || !noiseTex || !shapeTex || !pointProg || !pointVao) return;
      if (!meshProg || !meshVao || !boltProg || !boltVao) return;
      if (!filProg || !filVao || !flowTex) return;
      const { gl } = ctx;

      // resolveSceneSetting (not getSceneSetting) — the raw manual value
      // would silently re-stomp an auto-tuned slider back to manual every
      // frame (see autoTune.ts and the same note in meshGrid.ts).
      const afterglow = resolveSceneSetting(ID, settingFor("afterglow"));
      const flicker = resolveSceneSetting(ID, settingFor("flicker"));
      const dropStorm = resolveSceneSetting(ID, settingFor("dropStorm"));
      const density = resolveSceneSetting(ID, settingFor("density"));
      const cloudShape = resolveSceneSetting(ID, settingFor("cloudShape"));
      const morphSpeed = resolveSceneSetting(ID, settingFor("morphSpeed"));
      const morphBeat = resolveSceneSetting(ID, settingFor("morphBeat"));
      const mode = Math.round(resolveSceneSetting(ID, settingFor("mode")));
      const gas = GAS_RECIPES[
        Math.min(GAS_RECIPES.length - 1, Math.max(0, Math.round(resolveSceneSetting(ID, settingFor("gasType")))))
      ];

      // Time since this scene last drew — see the file header for why this
      // isn't anim.dtSec. Guards the first frame and any backwards jump.
      const dt = lastTimeSec === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTimeSec));
      lastTimeSec = anim.timeSec;

      // Age the pool first, then fire this frame's strikes, so a fresh strike
      // is uploaded at full strength on the very frame the beat landed.
      pool.tick(dt, afterglow, flicker);
      // The sections fade on the same measured interval the pool ages on —
      // one clock, and the one this scene actually draws at.
      cells.tick(dt);
      const beatRose = anim.beatPulse > prevBeatPulse + 1e-3 || frame.beat;
      const lowRose = anim.lowPulse > prevLowPulse + 1e-3 || anim.lowOnset;
      const dropRose = anim.dropPulse > prevDropPulse + 1e-3 || anim.dropOnset;
      // The upper bands get the same rise detection, for the sections alone:
      // they are what keeps the cloud flickering section by section between
      // beats instead of only on them.
      const bandRose = anim.midPulse > prevMidPulse + 1e-3 || anim.highPulse > prevHighPulse + 1e-3;
      prevBeatPulse = anim.beatPulse;
      prevLowPulse = anim.lowPulse;
      prevDropPulse = anim.dropPulse;
      prevMidPulse = anim.midPulse;
      prevHighPulse = anim.highPulse;

      // The shape morph rides the very rises the strikes do — the same
      // booleans, so the lurch and the lightning are the same beat rather
      // than two detections that could disagree. beatAmp is non-zero only on
      // the frame a pulse rose, which is what makes the kick a step per beat
      // instead of a shove for as long as the pulse stays up.
      const beatAmp = dropRose ? 1 : lowRose || beatRose ? Math.min(1, 0.7 + 0.5 * (lowRose ? anim.lowPulse : 0)) : 0;
      morphPhase = advanceMorphPhase(morphPhase, dt, morphSpeed, morphBeat, beatAmp);

      // Where the cloud sits between its silhouettes: the slider spans the
      // whole loop, and the morph accumulator carries it on from there.
      const phase = cloudShape * (SHAPE_VARIANTS - 1) + morphPhase;
      const w = shapePhaseWeights(phase);
      const { lobeSets } = cloudVolumes();
      // New strikes go in whichever silhouette is closest to what is drawn,
      // so a bolt stays buried in gas that is actually there.
      pool.setLobes(lobeSets[w.f < 0.5 ? w.a : w.b]);

      // Every strike lights the sections its own channel runs through, which
      // is the "lit up by lightning" half of the sections: the bolt's flash
      // is gone in a fraction of a second, the section it landed in keeps
      // glowing for a beat or two after it.
      const lightStruck = (fired: boolean): void => {
        if (fired && cells && pool && pool.lastSlot >= 0) cells.lightSegment(pool.posA, pool.posB, pool.lastSlot);
      };
      if (dropRose) {
        // A drop is a burst of ordinary-strength strikes in different lobes
        // (a cloud-wide flash), not one overdriven strike — three at full
        // amplitude already saturate most of the cloud.
        for (let i = 0; i < STRIKE_DROP_BURST; i++) lightStruck(pool.trigger(0.8 + 0.6 * dropStorm, true));
      } else if (lowRose || beatRose) {
        lightStruck(pool.trigger(0.7 + 0.5 * (lowRose ? anim.lowPulse : 0), false));
      }
      // On top of whatever the strike lit: a beat picks its own sections, so
      // the cloud answers the beat even where no bolt reached, and a mid or
      // treble rise lights a single one more gently in between.
      if (dropRose || lowRose || beatRose) cells.lightRandom(1, SECTION_BEAT_CELLS);
      else if (bandRose) cells.lightRandom(SECTION_BAND_LEVEL, 1);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      prog.use();
      uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      prog.setV3v("uStrikeA", pool.posA);
      prog.setV3v("uStrikeB", pool.posB);
      prog.setFv("uStrikeStrength", pool.strength);
      // The partition and its envelopes, for whichever stage is about to draw
      // the cloud — the sites never change, the envelopes change every frame,
      // and both are cheap enough to send unconditionally.
      const uploadCells = (p: GLProgram): void => {
        p.setV3v("uCellSite", CELL_SITES);
        p.setFv("uCellGlow", cells!.glow);
      };
      uploadCells(prog);
      // The two live silhouettes' weights, per channel of the shape volume.
      // Filaments reads the same volume from its vertex shader, so this is
      // computed once and uploaded to both programs.
      const shapeMix = [0, 1, 2, 3].map((c) => (w.a === c ? 1 - w.f : 0) + (w.b === c ? w.f : 0));
      prog.setV4("uShapeMix", shapeMix[0], shapeMix[1], shapeMix[2], shapeMix[3]);
      uploadGasRecipe(prog, gas);
      // Another scene in the shared gallery context may have bound something
      // else to these units since the last draw, so rebind all three every
      // frame.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, shapeTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_3D, flowTex);
      gl.activeTexture(gl.TEXTURE0);

      // The volume pass goes first in every mode: it paints every pixel (in
      // the geometry modes it returns the background alone), so the lattice,
      // the points and the bolts can be laid over it additively with nothing
      // to clear.
      drawFullscreenQuad(gl, quadVao);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      if (mode === MODE_MESH) {
        // Re-mesh only once the shape has actually moved, and never twice in
        // quick succession — dragging the slider would otherwise re-contour
        // the whole lattice on every frame of the drag.
        const moved = !(Math.abs(phase - meshPhase) <= MESH_PHASE_STEP); // NaN => true
        if (moved && anim.timeSec - meshTimeSec > MESH_MIN_INTERVAL) {
          const grids = densityGrids(meshRes);
          const ga = grids[w.a];
          const gb = grids[w.b];
          const f = w.f;
          const n = meshRes + 1;
          const { positions, lines } = buildSurfaceNet(
            (i, j, k) => {
              const o = (k * n + j) * n + i;
              return ga[o] + (gb[o] - ga[o]) * f;
            },
            MESH_ISO,
            meshRes,
            [BOUND_X, BOUND_Y, BOUND_Z],
          );
          const verts = positions.length / 3;
          meshVertCount = Math.min(MESH_MAX_VERTS, verts);
          // A dropped vertex would leave dangling indices behind it, so on an
          // overflow (never reached at these resolutions) the lines go too.
          meshIndexCount = meshVertCount === verts ? Math.min(MESH_MAX_INDICES, lines.length) & ~1 : 0;
          gl.bindVertexArray(meshVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, meshPosBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions.subarray(0, meshVertCount * 3));
          if (meshIndexCount > 0) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdxBuf);
            gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, lines.subarray(0, meshIndexCount));
          }
          gl.bindVertexArray(null);
          meshPhase = phase;
          meshTimeSec = anim.timeSec;
        }

        if (meshVertCount > 0) {
          meshProg.use();
          uploadCommonUniforms(meshProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
          meshProg.setV3v("uStrikeA", pool.posA);
          meshProg.setV3v("uStrikeB", pool.posB);
          meshProg.setFv("uStrikeStrength", pool.strength);
          uploadCells(meshProg);
          gl.bindVertexArray(meshVao);
          meshProg.setF("uIsNode", 0);
          if (meshIndexCount > 0) gl.drawElements(gl.LINES, meshIndexCount, gl.UNSIGNED_INT, 0);
          meshProg.setF("uIsNode", 1);
          gl.drawArrays(gl.POINTS, 0, meshVertCount);
          gl.bindVertexArray(null);
        }
      } else if (mode === MODE_POINTS) {
        pointProg.use();
        uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        pointProg.setV3v("uStrikeA", pool.posA);
        pointProg.setV3v("uStrikeB", pool.posB);
        pointProg.setFv("uStrikeStrength", pool.strength);
        uploadCells(pointProg);
        pointProg.setF("uCountBoost", Math.min(3, Math.max(1, Math.sqrt(MAX_PARTICLES / count))));
        // Any prefix of the buffer is a representative subsample, which is
        // what Cloud density thins here.
        gl.bindVertexArray(pointVao);
        gl.drawArrays(gl.POINTS, 0, Math.floor(count * Math.max(0.05, density)));
        gl.bindVertexArray(null);
      } else if (mode === MODE_FILAMENTS) {
        filProg.use();
        uploadCommonUniforms(filProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        filProg.setV3v("uStrikeA", pool.posA);
        filProg.setV3v("uStrikeB", pool.posB);
        filProg.setFv("uStrikeStrength", pool.strength);
        uploadCells(filProg);
        filProg.setV4("uShapeMix", shapeMix[0], shapeMix[1], shapeMix[2], shapeMix[3]);
        filProg.setF("uCountBoost", Math.min(3, Math.max(1, Math.sqrt(FIL_MAX_STRANDS / strandCount))));
        // The strands take the frequency alone (flowCoord); the rest of the
        // recipe reaches them through the underlay march they are drawn over.
        filProg.setF("uGasFreq", gas.freq);
        // A prefix of the strand buffer is a prefix of the point cloud, so
        // Cloud density thins the tangle here the way it thins the points.
        const strands = Math.floor(strandCount * Math.max(0.05, density));
        gl.bindVertexArray(filVao);
        gl.drawArrays(gl.LINES, 0, strands * FIL_STEPS * 2);
        gl.bindVertexArray(null);
      }

      // The bolts, over whatever the mode drew. Only a slot that fired since
      // the last frame re-uploads its tree.
      gl.bindVertexArray(boltVao);
      let anyLive = false;
      const boltFloats = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;
      for (let i = 0; i < MAX_STRIKES; i++) {
        if (pool.pathDirty[i]) {
          gl.bindBuffer(gl.ARRAY_BUFFER, boltBuf);
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            i * boltFloats * 4,
            pool.path.subarray(i * boltFloats, (i + 1) * boltFloats),
          );
          pool.pathDirty[i] = 0;
        }
        if (pool.strength[i] > 0.001) anyLive = true;
      }
      if (anyLive) {
        boltProg.use();
        uploadCommonUniforms(boltProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        // One strip per live slot: the whole tree — channel, branches and the
        // unused branch slots — is one run of vertices whose joins have no
        // area (see buildBoltTree), so a bolt is one draw however it forked.
        for (let i = 0; i < MAX_STRIKES; i++) {
          if (pool.strength[i] <= 0.001) continue;
          boltProg.setF("uBoltStrength", pool.strength[i]);
          gl.drawArrays(gl.TRIANGLE_STRIP, i * BOLT_RIBBON_VERTS, BOLT_RIBBON_VERTS);
        }
      }
      gl.bindVertexArray(null);

      // The gallery renders every scene into one shared context each tick —
      // leave the state every other scene expects to find.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      prog?.dispose();
      pointProg?.dispose();
      meshProg?.dispose();
      boltProg?.dispose();
      filProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      if (meshVao) gl.deleteVertexArray(meshVao);
      if (boltVao) gl.deleteVertexArray(boltVao);
      if (filVao) gl.deleteVertexArray(filVao);
      if (posBuf) gl.deleteBuffer(posBuf);
      if (seedBuf) gl.deleteBuffer(seedBuf);
      if (meshPosBuf) gl.deleteBuffer(meshPosBuf);
      if (meshIdxBuf) gl.deleteBuffer(meshIdxBuf);
      if (boltBuf) gl.deleteBuffer(boltBuf);
      if (filPosBuf) gl.deleteBuffer(filPosBuf);
      if (filSeedBuf) gl.deleteBuffer(filSeedBuf);
      if (filStepBuf) gl.deleteBuffer(filStepBuf);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_3D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, null);
      if (noiseTex) gl.deleteTexture(noiseTex);
      if (shapeTex) gl.deleteTexture(shapeTex);
      if (flowTex) gl.deleteTexture(flowTex);
      prog = null;
      quadVao = null;
      noiseTex = null;
      shapeTex = null;
      pointProg = null;
      pointVao = null;
      posBuf = null;
      seedBuf = null;
      meshProg = null;
      meshVao = null;
      meshPosBuf = null;
      meshIdxBuf = null;
      boltProg = null;
      boltVao = null;
      boltBuf = null;
      flowTex = null;
      filProg = null;
      filVao = null;
      filPosBuf = null;
      filSeedBuf = null;
      filStepBuf = null;
      strandCount = 0;
      count = 0;
      meshVertCount = 0;
      meshIndexCount = 0;
      meshPhase = Number.NaN;
      meshTimeSec = -1e6;
      pool = null;
      cells = null;
      prevBeatPulse = 0;
      prevLowPulse = 0;
      prevDropPulse = 0;
      prevMidPulse = 0;
      prevHighPulse = 0;
      lastTimeSec = null;
      morphPhase = 0;
    },
  };
})();
