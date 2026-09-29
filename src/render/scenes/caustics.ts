import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, NOISE_PERIOD, wrapFlow } from "../noiseHash.ts";
import {
  advanceEmission,
  advanceRingRate,
  autoNarrowWidthW,
  createRingRateState,
  buildProfile,
  createRippleEmissionState,
  createRippleEmitter,
  PROFILE_MAX_RADIUS,
  PROFILE_SAMPLES,
  rippleDecayFor,
  ringStyleFor,
  rippleSpeedFor,
  rippleWidthFor,
  salienceMarks,
  RING_THRESHOLD_DEFAULT,
  type RippleProfileParams,
} from "./rippleEmitter.ts";
import { publishSettingMarks } from "../settingMarks.ts";

// The bright wandering filaments you see on the floor of a sunlit pool.
// Domain-warped value noise, sharpened into thin ridges. Motion comes from
// renderer-side clocks instead of raw audio: the beat edges arrive as the
// latched one-shots on AnimFrame (renderLatch.ts) — the old
// FeatureFrame.onsetPhase restarted on every hat/fill, which is what made
// the old bar-locked breathe and Beat ripple stutter — and this scene's own
// drift accumulator below, kept separate from the shared uFlowPhase so its
// speed is user-dialable without reintroducing the teleport bug
// flowClock.ts exists to prevent (scaling an *already accumulated* phase is
// safe; scaling elapsed time by a live value is not).
// Settings map audio onto light and motion rather than position snapping:
// uFog sets the resting look (how thin/bright the ridges sit between beats,
// and how much of the dim wash the dark-water floor cut clips away), uFocus
// is purely how much *harder* a beat sharpens the ridges above that resting
// state — 0 means no snap at all, and the resting look itself never moves
// with uFocus (see focusSharp below; this split replaced an earlier design
// where one slider tried to own both and could only ever get one of "peak
// reachable at any setting", "resting look stays put", "doesn't collapse to
// fog between beats" right at a time — see this file's git history),
// Caustic density scales the noise field's spatial frequency (more/fewer,
// finer/fatter filaments; 0.5 is exactly the old fixed frequency) — wirable
// (its source lifts the slider toward a finer mesh, Section by default), and
// eased in by advanceDensityFlow rather than applied on the frame it changes,
// uBreathe is the depth of a zoom its own source moves — Bar wave by
// default, once per bar (breatheDrive in FRAG) — uRipple drives a continuous ring emitter (rippleEmitter.ts) seated
// at the center of the frame: rather than launching a whole ring on every
// yes/no beat (this scene's very first design) or carrying the raw driver
// through a stepped wave-equation height field (a brief detour — see
// docs/scenes/caustics.md's 2026-09-26/2026-09-27 entries for why each was
// replaced), the driver's own *rise* each frame becomes a thin ring's worth
// of height, launched from the center and left to travel outward and fade on
// its own. A clean, isolated hit still reads as exactly one full old-style
// ring; a busy driver naturally ducks itself — it can't rise as far between
// hits that arrive faster than it can fall back — so it reads as lighter,
// denser rings rather than a stack of identical ones. Wave speed/Wave fade/
// Ring width (waveSpeed/waveFade/ringWidth) tune the emitted rings
// themselves — how fast they travel, how fast they fade, how wide each one
// is; Ring style (ringStyle) instead picks what a ring *is* — Bump's own
// gaussian crest, Wave's crest-plus-trailing-trough (net zero height, so a
// dense train stays visible as alternating rings instead of piling into a
// flat plateau), or Merge (folds emissions that land close together into
// one stronger ring instead of changing the shape at all) — see
// rippleEmitter.ts's own `RingStyle` section; the emission and profile-building logic live in the `extraUniforms`
// closure below. uFlash is a brightness punch,
// uDrift is the base wander speed (its own JS-side accumulator — driven by
// driftRatePerSec below, not a shader uniform driving the rate directly).
// driftLevel adds to that rate directly, right now: the louder the music is
// playing at this instant, the faster the pool wanders, and it drops
// straight back down the moment the music quietens, with no envelope of its
// own beyond that instantaneous reading (LEVEL_GAIN * driftLevel *
// levelValue in driftRatePerSec below). It's driven by loudSwell — a value
// advanceLoudSwell derives from FeatureFrame.level, calibrated in-scene
// against its own slow-contracting extremes — not frame.energy: energy is
// AGC-normalized per band, and that AGC "re-adapts in ~1.25s and erases
// quiet-vs-loud by design" (see FeatureFrame.energy's own doc comment in
// audio/types.ts), which is exactly the dynamic range this dial exists to
// show. level survives that AGC (audio/types.ts and autoTune.ts both call it
// "the one field that survives it"), but its resting point is
// playback/mic-gain dependent, which is what advanceLoudSwell's own
// calibration is for — see that function's comment for why this isn't
// sectionIntensity.ts's job (different input, and a deliberately faster
// calibration timescale). driftPump answers the other half of what was
// asked for it: "energy would pump up drift speed but it would slowly be
// going back to the one set by drift... like push acceleration in a car" —
// so unlike driftLevel it doesn't track its input directly. Each push
// (advancePump below) accelerates a velocity that then coasts back down
// over PUMP_RELEASE_SEC, the way a car keeps rolling faster for a while
// after you lift off the gas. Both driftLevel and driftPump are additive on
// top of the Drift-speed base rather than multipliers on it (see
// driftRatePerSec below) — a multiplier on a base of zero can only ever stay
// zero, so additive is what lets either one still move the pool with Drift
// speed parked at 0. driftLevel also drives uLoudSwell (loudSwellDrive
// below), an ungated visual swell — a loud passage widens the pool's
// aperture and lifts the dark-water floor into a glow; a quiet one tightens
// and deepens it. This is a look rather than motion along the phase, so —
// not gated behind Drift speed or Speed pump — it must still land for anyone
// who wants a still, breathing pool. uBass/uTurbulence/
// uSparkle give the low/mid/high bands each a distinct visual (swell / churn
// / crest glints).
//
// Precision, or why nothing the shader hashes ever grows with session
// length: the drift phase only ever accumulates (advanceDensityFlow's
// scaledPhase — never reset, so the field never jumps), and for a long time
// it was uploaded raw and added to every noise coordinate in FRAG. A
// value-noise hash built on fract() of a large product loses its low bits
// as that offset climbs, and on mobile GPU compilers the shared corner
// hash between two neighbouring cells stopped agreeing well before the
// desktop degradation was visible — the pattern broke along cell
// boundaries: straight screen-aligned seams for the first, unwarped
// octave, curved ones for the warped octaves, and fwidth() in the ridge
// anti-aliasing then lit each seam up as a dashed line. The fix is in two
// halves that only work together: every offset FRAG adds to a noise
// coordinate is reduced modulo NOISE_PERIOD on the JS side, in float64
// (driftFlows below — one entry per distinct offset the shader used to
// derive from the raw phase, since they carry different multipliers and can't
// share one wrap), and hashCell in FRAG is an integer hash over the cell
// lattice masked to that same period, so the field is exactly periodic and
// a wrap is invisible by construction. The phase itself still never wraps;
// only what reaches the GPU does. The hash, the period and wrapFlow now live
// in noiseHash.ts (its header is the standing explanation) so other drifting
// scenes share them.
// The master treble-sparkle knob. Defined outside SETTINGS so the sub-params
// further down (density, brightness ceiling, grain, warp, spread, sustain —
// all `advanced`, in the Look group) can name it directly as their `macro`
// driver: a spec reference costs nothing extra to resolve and can't drift
// out of sync with a key string. See their own leading comment further down
// for what each sub-param actually does; this one just carries the auto
// weights and stays the everyday slider.
const SPARKLE: SceneSetting = {
  key: "sparkle",
  label: "Treble sparkle",
  description: "Hats and cymbals glint on the ridge crests",
  group: "Look",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.41,
  // Directly the hats/cymbals dial.
  auto: { brightness: 0.45, attack: 0.15 },
  // Two signals across two layers (a treble hit, or — with Sparkle sustain
  // dialed up — the sustained treble level too), not one, so the default
  // is Scene — see sparkleGlintDrive in FRAG. Used to have its own
  // continuous "Sparkle from line" dial blending toward the sensitivity
  // line; that's now Frequencies, a discrete alternative source on this
  // same picker.
  drive: { default: "scene", sceneLabel: "Scene: treble hits + sustain wash", sceneSources: ["anim.highOnset", "anim.high"] },
};

const SETTINGS: SceneSetting[] = [
  {
    key: "causticDensity",
    label: "Caustic density",
    description:
      "How many filaments the pattern resolves into — fewer, fatter cells at low values, a finer mesh at high. Its source pushes it finer (a chorus, by default); a change — from the slider or the source — eases in rather than snapping.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35, // 0.5 on this dial was the scene's old fixed noise-sampling frequency
    // Pure framing geometry the user tunes to taste, same reasoning as
    // sparkleGrain's weight: 0 — not something the music profile should
    // silently redecide underneath a chosen look (no `auto` table).
    // Wirable, on Section by default: the pool resolves into a finer mesh as
    // the song builds, lifted on top of the slider (densityTargetFor), so an
    // unplugged jack leaves exactly the slider's own density. The result is
    // only a target — advanceDensityFlow glides the drawn density toward it,
    // so neither a drag nor a source can snap the field.
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How far the pool zooms in and out with its source — once a bar by default",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.11,
    // The depth a wired signal swings the zoom through, not a signal of its
    // own — pure taste, so no auto table (same reasoning as causticDensity
    // above): what it reacts to is the patch bay's choice. Bar wave is the
    // default rather than a Scene composite that reacts to nothing: it's
    // what the once-per-bar zoom rode before #147 removed Breathe's own
    // direct beatClock read, brought back here through the drive system.
    // Identity at drive 0 either way (breatheDrive(0.0) in FRAG), so an
    // unplugged jack still leaves the pool exactly where its slider sits.
    drive: { default: "anim.barWave" },
  },
  {
    key: "ripple",
    label: "Beat ripple",
    description: "Each hit sends a ring out from the center like a drop on water — a busy driver can't rise as far between hits, so it makes lighter, denser rings instead of stacking full ones",
    group: "Motion",
    // One colour for this row and the four ring controls under it, so the
    // ripple's own set reads apart from Breathe above and Drift below.
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.21,
    // Waves read best against punchy, uncluttered material.
    auto: { attack: 0.35, pulse: 0.25, density: -0.2 },
    // A bass onset OR a broadband beat, unconditionally — no single
    // catalogue source reproduces that union, so the default is Scene (see
    // the `extraUniforms` closure below, and drives.ts's header for why a
    // Scene default is still bit-identical to today). Fed to
    // rippleEmitter.ts's advanceEmission as a continuous envelope rather
    // than read as a one-shot trigger — see that file's header for why: a
    // busy driver naturally ducks itself there (each rise only launches a
    // ring for however far the envelope climbed since it last fell back),
    // where a yes/no trigger stacked a full ring on every tick regardless.
    // This slider scales the *display* — crest brightening and slope-based
    // refraction, in FRAG — not a launched ring's own amplitude (see
    // RIPPLE_REFRACT/RIPPLE_CEIL_KNEE's own comment there): the emitter
    // always launches a full-strength ring for a full hit no matter this
    // dial's value, the same split the scene's very first ring pool used. A
    // drop still emits its own stronger ring on top, independent of this
    // choice.
    // `threshold` is the adaptive "reach to ring" line's margin over its
    // noise-floor estimate (rippleEmitter.ts's ringThresholdBar), adjusted by
    // the On/Off toggle + slider under this setting's graph in the panel —
    // Off (advanceEmission's `threshold: null`) makes every climb ring,
    // sized only by how far it climbed.
    drive: {
      default: "scene",
      sceneLabel: "Scene: bass or beat hit",
      sceneSources: ["anim.lowOnset", "feature.onset"],
      threshold: {
        default: RING_THRESHOLD_DEFAULT,
        label: "Ring threshold",
        hint: "Moves the dotted line: how far a sound has to stand out from the everyday ones to send a ring. Left: more rings, even from quiet sounds. Right: only clear standouts.",
      },
    },
  },
  {
    key: "ringWidth",
    label: "Ring width",
    description: "How wide each ring is — wider rings bend the light more softly",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Response-shape, not an amount — same bucket as Wave speed/Wave fade
    // below (drives.ts's header lists this kind of setting among what's
    // deliberately not a drive). Read only in rippleEmitter.ts's
    // rippleWidthFor, never uploaded to FRAG directly — only through the
    // crest/slope profile it shapes.
  },
  {
    key: "ringStyle",
    label: "Ring style",
    description:
      "Bump: soft rings. Wave: each ring has a crest and a trough, like real ripples — stays visible when rings come fast. Merge: rings that come close together join into one stronger ring.",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 2,
    step: 1,
    default: 0,
    type: "enum",
    options: ["Bump", "Wave", "Merge"],
    // A shape/combining-rule pick, not an amount or a reactive coupling —
    // same bucket as Ring width/Wave speed/Wave fade around it (no `auto`,
    // no `drive`); ringStyleFor (rippleEmitter.ts) maps this setting's own
    // 0/1/2 to the RingStyle emit()/buildProfile actually take.
  },
  {
    key: "waveSpeed",
    label: "Wave speed",
    description: "How fast a ring travels outward from the center",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Response-shape, not an amount — same bucket as Wave fade/Ring width
    // above (drives.ts's header lists this kind of setting among what's
    // deliberately not a drive). Read only in rippleEmitter.ts's
    // rippleSpeedFor, never uploaded to FRAG.
  },
  {
    key: "waveFade",
    label: "Wave fade",
    description: "How fast a ring loses energy as it travels — low keeps it visible all the way to the far edge, high dies out quickly",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Read only in rippleEmitter.ts's rippleDecayFor.
  },
  {
    key: "drift",
    label: "Drift speed",
    description: "How fast the filaments wander, independent of the beat. 0.5 = the scene's original speed, 1 = double that.",
    group: "Motion",
    family: "Drift speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.44,
    // Wander speed tracks the music's own tempo. Deliberately no `pulse`
    // weight: driftPump already tracks punchiness (pulse: 0.35 below), and
    // weighting both the same way would let Auto walk them up together on
    // the same music, compounding the "these read as the same knob" problem
    // a shared weight always risks between two motion dials.
    auto: { tempo: 0.4 },
  },
  {
    key: "driftLevel",
    label: "Speed boost",
    description: "Drift runs faster the louder the music is right now, and drops straight back to Drift speed when it quietens; the pool's aperture and floor glow swell with it too",
    group: "Motion",
    family: "Drift speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Swells with volume read best on tracks with real quiet->loud range;
    // an already-dense mix doesn't need more.
    auto: { dynamics: 0.3, density: -0.15 },
    // Driven by this scene's own calibrated loudSwell (advanceLoudSwell,
    // below) — a bespoke per-scene calibration of FeatureFrame.level, not a
    // catalogue signal (see that function's own comment for why it isn't
    // just frame.energy/anim.sectionIntensity: quiet stays quiet over the
    // tens of seconds AGC'd energy takes to re-adapt), so the default is
    // Scene. A non-default pick instead reads that source's 0..1 value
    // directly as levelValue in driftRatePerSec below. extraUniforms reads
    // this one patch twice with different rests (LOUD_NEUTRAL's own doc):
    // the rate (driftRatePerSec) at rest 0, its own neutral (an unplugged
    // jack adds no extra speed); the aperture/floor swell (loudSwellDrive)
    // at rest LOUD_NEUTRAL, since loudSwellDrive's neutral is 0.5, not 0 —
    // an unplugged jack reading 0 there swelled as permanent "quiet"
    // tightening that grew with this very slider.
    drive: { default: "scene", sceneLabel: "Scene: this track's own calibrated loudness" },
  },
  {
    key: "driftPump",
    label: "Speed pump",
    description: "Each push accelerates the drift like a gas pedal; the extra speed then coasts back down to Drift speed",
    group: "Motion",
    family: "Drift speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Speed pump only reads as a pump on music with real hits to push against.
    auto: { pulse: 0.35, attack: 0.2 },
    // Driven continuously by anim.lowPulse today — a plain Bass hit default
    // (drives.ts's decaying-envelope reading of it, same field): a kick is
    // the natural pedal to push against; rewire it to energy or anything
    // else in the picker.
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "bass",
    label: "Bass swell",
    description: "Low end bulges and warms the center",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    // A dark mix wants the low-end swell emphasized; a bright one doesn't need it.
    auto: { brightness: -0.4 },
    // uLowPulse directly — a plain Bass hit default.
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "turbulence",
    label: "Mid turbulence",
    description: "Vocals and synths churn the filaments",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    // Busy mids churn the filaments; a bright mix reads as more mid-heavy too.
    auto: { density: 0.35, brightness: 0.1 },
    // uMid directly (the slewed level, not a hit pulse) — a plain Mid level default.
    drive: { default: "anim.mid" },
  },
  {
    key: "fog",
    label: "Fog",
    description: "How hazy and soft the ridges sit at rest, between beats",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.57, // sat near the old fixed resting sharpness/floor-cut this dial replaced
    // A busy mix wants the filaments legible (less fog); a dark mix reads as
    // moodier with more haze around them.
    auto: { density: -0.3, brightness: -0.2 },
  },
  {
    key: "focus",
    label: "Focus snap",
    description: "How much harder a beat sharpens the ridges above their resting state; 0 = no snap at all",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.86,
    // Beat-snap only reads as a snap on music with actual beats to snap to.
    // The auto *weights* are kept low (not the ~0.9 that `pulse` alone would
    // floor near on almost any locked-tempo track — 60% tempoLock saturates
    // for basically all steady music) so Auto can't walk the resolved value
    // the rest of the way to sitting near 1 all track, where the beat snap
    // would saturate against FOCUS_SHARP_MAX on nearly every hit rather than
    // responding to a specific one — the resting look itself no longer
    // moves with this slider (see the Fog setting above and focusSharp
    // below), so the old worry about pinning the *floor* up doesn't apply
    // any more, but a saturated snap is just as flat a result. The default
    // itself is a baked look (Option+D), not a weight choice.
    auto: { pulse: 0.2, attack: 0.15 },
    // uBeatPulse directly — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Overall brightness punch on each beat — pick All level instead of Beat for a long loud stretch to stay lit rather than flashing once",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.75,
    // Same reasoning as ripple, for brightness punch instead of ring shape.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly — a plain Beat default. Used to be a continuous
    // blend toward uEnergy via a separate "Flash from level" dial; that's
    // now a discrete alternative source (All level) on this same picker
    // instead of a second setting.
    drive: { default: "feature.onset" },
  },
  {
    key: "centroidHue",
    label: "Spectral hue",
    description: "Palette drifts one way when the mix is brighter than usual for this track, the other way when it's darker",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.68,
    // Already music-driven by construction (it reads the live centroid
    // directly, see FRAG's huePhase) — no auto table needed on top of that.
    reads: ["anim.centroid"],
  },
  SPARKLE,
  // The constants that used to be hardcoded on the sparkle line in FRAG —
  // how bright, how many, how fine, how far the glints spread, and whether
  // they persist through a sustained wash instead of only flashing on a hit.
  // Each tracks SPARKLE as a macro: dragging the master knob moves them all
  // together, and each snaps to manual (stops following) the moment it's
  // touched directly, same as any auto-capable setting. Kept `advanced` —
  // real, but not worth doubling the Look group's row count for settings
  // most people will only ever move via the master.
  {
    key: "sparkleBright",
    label: "Sparkle brightness",
    description: "How bright each glint gets at its peak",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1, // 0.5 on this dial was the old fixed 1.5x gain (see the *3.0 in FRAG)
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.5 },
  },
  {
    key: "sparkleDensity",
    label: "Sparkle density",
    description: "How many glints appear at once",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.52, // 0.5 on this dial was the old fixed pow() exponent of 8.0
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.35 },
  },
  {
    key: "sparkleGrain",
    label: "Sparkle grain",
    description: "How coarse each glint is",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.11, // 0.5 on this dial was the old fixed noise scale of 38.0
    advanced: true,
    // Left off the master: glint size reads as a taste choice, not an
    // intensity one, and tying it to SPARKLE would make "stronger" also
    // silently resize every glint.
    macro: { driver: SPARKLE, weight: 0 },
  },
  {
    key: "sparkleWarp",
    label: "Sparkle distortion",
    description: "How curved and warped the glint pattern reads, independent of the ridges' own warp",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0, // -> no extra warp: bit-for-bit the old glint sampling until touched
    advanced: true,
    // Same reasoning as sparkleGrain: a shape choice, not an intensity one.
    macro: { driver: SPARKLE, weight: 0 },
  },
  {
    key: "sparkleSpread",
    label: "Sparkle spread",
    description: "How far into dim water glints can reach",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.73, // 0.4 on this dial was the old fixed crest-gate smoothstep(0.15, 0.6, acc)
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.2 },
  },
  {
    key: "sparkleSustain",
    label: "Sparkle sustain",
    description: "Cymbal wash glints continuously, not just on hits",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.03, // 0 on this dial is glints following only the onset pulse — the behavior before this dial existed
    advanced: true,
    macro: { driver: SPARKLE, weight: 0.3 },
  },
  // Spray injection rides on the glints rather than replacing them: every
  // cell of the glint field is its own tiny nozzle, so sprays appear in as
  // many places as glints do, share their coordinate (grain, drift, Sparkle
  // distortion), their crest gate and their treble drive — and add nothing
  // at 0, so the sparkle term above stays bit-for-bit what it was.
  // Look, not Motion — droplets do fly outward, but the dial adds bright
  // specks to the already-existing glint field rather than moving the field
  // itself, same family call as Sparkle spread above.
  {
    key: "injection",
    label: "Spray injection",
    description:
      "Glints also spray fine droplets outward, like fuel atomizing through a nozzle — rides Sparkle's own glints, and a treble hit throws extra spray on top; unplugged it sprays exactly what the slider says",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.67,
    // Same reasoning as sparkleGrain: a shape/taste choice, not an
    // intensity one, so the master knob leaves it alone.
    macro: { driver: SPARKLE, weight: 0 },
    // Droplets already ride Sparkle's own hits+line composite (the shared
    // crest gate and treble drive every glint uses) — this jack is a second,
    // independent gate on top of that, a treble hit throwing a little extra
    // spray by default (INJECTION_DRIVE_LIFT below is a lift, identity at
    // drive 0, so an unplugged jack still sprays exactly what the slider
    // says rather than the old bare-1.0 "scene" reading, which an Unplug
    // silently zeroed).
    drive: { default: "anim.highOnset" },
  },
  {
    key: "injectionReverse",
    label: "Reverse injection",
    description: "Droplets get sucked back into their nozzle and vanish there, instead of spraying out and fading away",
    group: "Look",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
];

// Beat ripple's display-side read of the continuous emitter (rippleEmitter.ts
// owns emission and profile-building; see that file's header). uRipple (the
// "ripple" setting) scales crest brightening and slope-based refraction here,
// at display time — not a launched ring's own amplitude, which is always a
// full-strength ring for a full hit regardless of this dial (see the
// "ripple" setting's own comment) — the same split the scene's very first
// ring pool used, restored here after the wave tank's detour scaled the
// *source* instead (see docs/scenes/caustics.md's 2026-09-27 entries).
const RIPPLE_REFRACT = 0.3; // peak p-space displacement at uRipple=1 for one full-strength ring — the old pool's own RIPPLE_REFRACT
// A soft knee, not a hard clamp, on the crest/slope a pixel reads: unchanged
// up to RIPPLE_CEIL_KNEE — exactly where a single full-strength ring's own
// peak sits, by construction (buildProfile normalizes to that) — so one ring
// looks bit-for-bit like the old pool's; only several overlapping rings
// pushing past that peak get gently pulled toward RIPPLE_CEIL_MAX instead of
// tearing the pattern. Applied to crest and to |slope| alike (see softCeil in
// FRAG) since both are normalized to the same single-ring peak of 1.
const RIPPLE_CEIL_KNEE = 1.0;
const RIPPLE_CEIL_MAX = 1.5;
// A drop moment emits one ring this strong in addition to whatever an
// ordinary beat is already emitting this tick (see the `extraUniforms`
// closure below) — carried over from the old ring pool's RIPPLE_DROP_AMP,
// same reasoning: a drop should read as a bigger strike than a plain beat.
const RIPPLE_DROP_AMP = 1.8;

// Hard ceiling on sharp regardless of uFog/uFocus. Was 26 in a brief period
// where every focus setting shared this same ceiling as its *peak* — lowered
// then because that shared ceiling got reached far more often (any focus
// setting, given a strong enough beat, not just uFocus=1), and 26 pushes
// pow(ridge, sharp) close enough to a step function that the underlying
// value-noise contour lines read as a banded "pixel ladder" rather than a
// smooth thin ridge, especially where the domain warp bunches several
// octaves' contours together near the vortex point. Kept at 18 — still the
// same visual line-width danger zone.
const FOCUS_SHARP_MAX = 18;

// uFog's two endpoints (see focusSharp below). CRISP is deliberately *below*
// today's old fixed floor of 4 (uFocus's floor used to bottom out there) —
// Fog is the setting that now owns "how thin/bright the resting look gets",
// so it needs its own reach past what Focus alone ever offered. HAZY drops
// the floor cut to 0 too: nothing is clipped away, so the dim wash between
// filaments glows instead of reading as flat black water.
const FOG_SHARP_CRISP = 14.0;
const FOG_SHARP_HAZY = 2.0;
const FOG_FLOOR_CRISP = 0.13; // uFog = 0 -> today's old fixed dark-water cut (0.08) is inside this range
const FOG_FLOOR_HAZY = 0.0;

// uBreathe's zoom depth per full-strength cable — the same 0.10 swing the
// old bar-locked cosine had at its peak (uBreathe 1, tempoLock 1). The
// cable supplies the waveform, not this constant; see breatheDrive(0.0) in
// FRAG for why a stale-"scene" fallback (never reached at Breathe's own
// default, Bar wave) still swings zero.
const BREATHE_ZOOM = 0.10;

// uLoudSwell's (loudSwellDrive above) two visual channels, both small at the
// Speed boost default (0.4) — see that constant's own comment — and both
// on ground nothing else modulates at runtime: SWELL_ZOOM rides the same `p
// *=` aperture line as BREATHE_ZOOM above, but the swell is the scene's own
// aperiodic, sustained signal while uBreathe swings once per bar by default
// (or whatever a re-patched cable carries), and SWELL_FLOOR_LIFT rides the
// same dark-water floor cut uFog
// sets at rest, so a loud passage glows into that dim wash and a quiet one
// deepens it, distinct from uFlash/uEnergy, which brighten the ridge
// *crests* instead.
const SWELL_ZOOM = 0.25;
const SWELL_FLOOR_LIFT = 0.8;

// uFocus=1 on a full beat (uBeatPulse=1) multiplies the resting sharpness by
// (1 + FOCUS_SNAP_RATIO) — see focusSharp below. Chosen so the defaults (fog
// 0.4, focus 0.7) land close to the swing this scene's very first version
// had before any of its later focus-formula rewrites (rest ~9.4, peak ~19.4,
// ~2.07x — see this file's git history and tests/caustics.test.ts's
// "stays filamentary" case): every rewrite since has either scaled the rest
// and peak together (the slider read as "merely thinner lines", not more
// snap) or pinned the peak to the same value at every setting (the slider
// stopped moving the actual snap, only the quiet resting state) — see the
// long history of this exact tradeoff across 5fe4b3c, db884a0, b44000d, and
// 9b52b66. Decoupling "resting state" (uFog, above) from "how much a beat
// pushes above it" (uFocus, here) is what makes both failure modes
// impossible at once: uFocus=0 always means literally no snap (sharp never
// moves off whatever uFog set), and the resting state never moves with
// uFocus no matter how the slider is dragged.
const FOCUS_SNAP_RATIO = 1.3;

// Caustic density's reach (causticDensityScale below): 0.5 is exactly today's old fixed
// noise-sampling frequency (densScale = 1); the endpoints are ±1.2 octaves
// off that, mild enough that both ends still read as this scene's own
// pool-caustics look rather than a different pattern entirely.
const DENSITY_SPAN_OCTAVES = 2.4;
// How far Caustic density's own source lifts the slider toward the finest
// mesh at a full reading. A lift, identity at drive 0 (drives.ts's header's
// "Nothing plugged in" paragraph), so an unplugged jack leaves the slider's
// own density; kept well under a full push because the field spans
// DENSITY_SPAN_OCTAVES and a chorus shouldn't re-scale the whole pool.
const DENSITY_DRIVE_LIFT = 0.15;

/** Caustic density's target (advanceDensityFlow glides toward it): the
 *  slider lifted toward 1 by its drive's reading — the slider exactly at
 *  drive 0, never outside 0..1 (a patched source's weight can exceed 1). */
export function densityTargetFor(slider: number, drive: number): number {
  const s = Math.min(1, Math.max(0, slider));
  const d = Number.isFinite(drive) ? drive : 0;
  return Math.min(1, Math.max(0, s + (1 - s) * DENSITY_DRIVE_LIFT * d));
}

/** uFog (0..1) -> the sharpness the ridges sit at with no beat driving them.
 *  Default 0.4 reproduces today's old fixed floor (4) closely. */
export function fogRestingSharp(fog: number): number {
  return FOG_SHARP_CRISP + (FOG_SHARP_HAZY - FOG_SHARP_CRISP) * fog;
}

/** uFog (0..1) -> the dark-water floor cut applied to `acc` before tonemap.
 *  Default 0.4 reproduces today's old fixed cut (0.08) almost exactly. */
export function fogFloorCut(fog: number): number {
  return FOG_FLOOR_CRISP + (FOG_FLOOR_HAZY - FOG_FLOOR_CRISP) * fog;
}

/** The ridge sharpness FRAG actually renders with: uFog sets the resting
 *  value, uFocus scales how much *harder* a full beat pushes above it — a
 *  pure multiplier on the resting value, never a replacement for it, so
 *  uFocus=0 holds sharp exactly at rest (no snap) and the resting value
 *  itself never depends on uFocus at any beatPulse. Clamped to
 *  FOCUS_SHARP_MAX, the same anti-ladder ceiling every past version of this
 *  formula has respected. Exported so tests/caustics.test.ts can pin the
 *  monotonicity and rest-independence invariants this file's history keeps
 *  breaking one at a time. */
export function focusSharp(fog: number, focus: number, beatPulse: number): number {
  const rest = fogRestingSharp(fog);
  return Math.min(rest * (1 + focus * beatPulse * FOCUS_SNAP_RATIO), FOCUS_SHARP_MAX);
}

/** Caustic density (0..1) -> the noise-sampling frequency multiplier. 0.5 ->
 *  1.0, the old fixed frequency exactly. FRAG computes the same curve from
 *  uDensityLive. */
export function causticDensityScale(density: number): number {
  return Math.pow(2, (density - 0.5) * DENSITY_SPAN_OCTAVES);
}

// How hard the palette's cosine modulation damps where hue phase is
// changing faster than a pixel can resolve smoothly (see the hueDamp
// comment in FRAG). Computed on the palette's actual per-channel cosine
// argument now, not a scalar proxy, so this one constant applies correctly
// across every palette rather than implicitly assuming uPalC == 1 (true
// only for "neon" — see src/render/palette.ts's presets).
const HUE_DAMP_K = 1.2;

// How far uCentroid's swing around its own 0.5 midpoint (see
// spectralCentroid.ts) can push huePhase at uCentroidHue = 1 — modest
// against the acc*0.3 ridge term and uTime*0.02 drift already driving
// huePhase, so it reads as a tint that leans with the mix's own brightness
// rather than a competing color cycle.
const CENTROID_HUE_GAIN = 0.5;

// The treble-sparkle sub-params (see the sparkleBright..sparkleSustain
// entries in SETTINGS above) each interpolate between two endpoints of what
// used to be one hardcoded shader constant. Named here — spliced into FRAG
// below via template interpolation, exactly like FOCUS_SHARP_MAX/HUE_DAMP_K
// above — so the numbers exist in one place and the pure functions beneath
// them can pin each sub-param's default to the old constant it replaces in
// tests/caustics.test.ts, the same role driftRatePerSec's export plays for
// the drift sliders.
const SPARKLE_DENSITY_EXP_LO = 13.0; // uSparkleDensity = 0 -> sparsest glints
const SPARKLE_DENSITY_EXP_HI = 3.0; // uSparkleDensity = 1 -> densest glints
// Raised from the original 60.0 so the finest end of the Sparkle grain dial
// (uSparkleGrain = 0) can go smaller still — 60 was already this scene's
// entire old fixed constant, never a deliberately chosen floor.
const SPARKLE_GRAIN_FREQ_LO = 90.0; // uSparkleGrain = 0 -> finest glints
const SPARKLE_GRAIN_FREQ_HI = 16.0; // uSparkleGrain = 1 -> coarsest glints
const SPARKLE_SPREAD_LO_AT_0 = 0.35;
const SPARKLE_SPREAD_LO_AT_1 = -0.05;
const SPARKLE_SPREAD_HI_AT_0 = 0.8;
const SPARKLE_SPREAD_HI_AT_1 = 0.4;
const SPARKLE_BRIGHT_GAIN = 3.0; // uSparkleBright is a 0..1 fraction of this ceiling
// uSparkleWarp's reach, in the same q-space units sparkleNoise samples in.
// About half of the ridge loop's own accumulated warp (warpAmt up to ~0.45
// per octave over 6 octaves) — enough to visibly bend the glint field's
// shape without dissolving it into incoherent noise at 1.
const SPARKLE_WARP_GAIN = 1.4;

/** uSparkleDensity (0..1) -> the pow() exponent gating how many noise peaks
 *  survive as glints. Default 0.5 -> 8.0, today's old hardcoded exponent. */
export function sparkleDensityExponent(sparkleDensity: number): number {
  return SPARKLE_DENSITY_EXP_LO + (SPARKLE_DENSITY_EXP_HI - SPARKLE_DENSITY_EXP_LO) * sparkleDensity;
}

/** uSparkleGrain (0..1) -> the noise field's spatial frequency. Default 0.5
 *  -> 53.0 (widened from the old fixed 38.0 so the finest end of the dial
 *  can go smaller — see SPARKLE_GRAIN_FREQ_LO's own comment). */
export function sparkleGrainFreq(sparkleGrain: number): number {
  return SPARKLE_GRAIN_FREQ_LO + (SPARKLE_GRAIN_FREQ_HI - SPARKLE_GRAIN_FREQ_LO) * sparkleGrain;
}

/** uSparkleSpread (0..1) -> the crest-gate smoothstep's [lo, hi] edges.
 *  Default 0.5 -> [0.15, 0.6], today's old hardcoded gate. */
export function sparkleSpreadRange(sparkleSpread: number): { lo: number; hi: number } {
  return {
    lo: SPARKLE_SPREAD_LO_AT_0 + (SPARKLE_SPREAD_LO_AT_1 - SPARKLE_SPREAD_LO_AT_0) * sparkleSpread,
    hi: SPARKLE_SPREAD_HI_AT_0 + (SPARKLE_SPREAD_HI_AT_1 - SPARKLE_SPREAD_HI_AT_0) * sparkleSpread,
  };
}

/** uSparkleBright (0..1) -> the linear gain on the whole sparkle term.
 *  Default 0.5 -> 1.5, today's old hardcoded gain. */
export function sparkleBrightGain(sparkleBright: number): number {
  return sparkleBright * SPARKLE_BRIGHT_GAIN;
}

// Spray injection (see the "injection" entry in SETTINGS above and the FRAG
// block below). The droplet field is laid out in the glint noise's
// own coordinate — sparkleQ * sparkleFreq — at INJECTION_CELLS_PER_GRAIN
// cells per noise unit, so one nozzle cell spans a few glint wavelengths and
// Sparkle grain resizes the droplets right along with the glints. Everything
// below is in those cell units. Rate and reach are fixed rather than
// dialable: uInjection is meant to be "how much spray", not a second set of
// Drift/Beat-style controls duplicating the ridge system.
const INJECTION_CELLS_PER_GRAIN = 0.25; // nozzle cells per glint-noise unit
const INJECTION_DROPS = 4; // droplets in flight per nozzle at any moment (a GLSL loop bound — int)
const INJECTION_RATE = 0.9; // cycles/sec each droplet completes
const INJECTION_REACH = 0.55; // how far from its nozzle a droplet is fully atomized by
const INJECTION_NOZZLE_JITTER = 0.5; // nozzle offset from its cell center, so nozzles don't sit on a grid
const INJECTION_NEAR_R = 0.14; // droplet radius right at the nozzle, before atomizing
const INJECTION_FAR_R = 0.05; // droplet radius once fully atomized
const INJECTION_GAIN = 1.3; // brightness of the summed field relative to a glint's own peak
// Spray injection's own jack (a treble hit, by default): a lift on top of
// the field's own brightness — `1.0 + INJECTION_DRIVE_LIFT * injectionDrive(uHighPulse)`,
// identity at drive 0 — rather than the old bare `injectionDrive(1.0)`
// multiplier, which read as exactly 0 (not 1) the instant the jack was
// unplugged (drives.ts's header's "Nothing plugged in" paragraph).
const INJECTION_DRIVE_LIFT = 1.0;

// How far from its own nozzle any droplet can light a pixel — the spray
// loop is the scene's single most expensive block (measured 2026-09-28:
// ~60% of a Retina frame's GPU time when every pixel ran INJECTION_DROPS
// droplets for each of the 3x3 cells around it), so FRAG uses this twice to
// skip work that can't show. A droplet's glow is exp(-2.2 (d/r)^2), counted
// out to INJECTION_GLOW_REACH_R of its own radius (beyond it the glow is
// under 1e-6), and its radius shrinks linearly from NEAR_R to FAR_R over its
// travel, so the farthest any droplet lights is the larger of the two travel
// endpoints. FRAG skips a nozzle farther than this from the pixel outright,
// and only visits the 2x2 nozzle cells whose centers straddle the pixel —
// exact as long as a nozzle (within JITTER/2 of its cell center) plus this
// reach stays inside one cell of that center, checked below, since retuning
// reach, jitter or droplet size past it would silently clip droplets at the
// cell seams.
const INJECTION_GLOW_REACH_R = 2.5;
const INJECTION_LIT_RADIUS = Math.max(
  INJECTION_GLOW_REACH_R * INJECTION_NEAR_R,
  INJECTION_REACH + INJECTION_GLOW_REACH_R * INJECTION_FAR_R,
);
if (INJECTION_NOZZLE_JITTER / 2 + INJECTION_LIT_RADIUS > 1) {
  throw new Error("caustics: spray droplets reach past the 2x2 nozzle cells FRAG visits — widen the search or shrink reach/jitter/radius");
}

// Every hashed field in FRAG is periodic in NOISE_PERIOD cells (the shared
// lattice hash in noiseHash.ts — see the file header's precision paragraph
// and that file's for how the period was sized). The finest consumer is the
// spray field: it lives at INJECTION_CELLS_PER_GRAIN cells per glint-noise
// unit and so wraps at NOISE_PERIOD * INJECTION_CELLS_PER_GRAIN
// (INJECTION_MASK below), which is why that constant has to be a power-of-
// two fraction and the period can't drop below its reciprocal.
const INJECTION_MASK = NOISE_PERIOD * INJECTION_CELLS_PER_GRAIN - 1;
if (!Number.isInteger(Math.log2(INJECTION_MASK + 1))) {
  throw new Error("caustics: NOISE_PERIOD * INJECTION_CELLS_PER_GRAIN must be a power of two");
}

// The ridge loop's octave count, and the flow multipliers FRAG applies per
// use of the drift phase — named here because driftFlows has to reproduce
// exactly the offsets the shader adds, one wrapped entry each. FLOW_X/FLOW_Y
// are the base flow direction (the x/y scale of the old
// per-phase-unit flow the shader used to compute itself), and FLOW_OCTAVE_STEP the
// per-octave speed-up on the ridge sample (the old `flow * (1.0 + fi * 0.2)`).
// SPARKLE_FLOW is the glint field's own, faster scroll, shared with the
// spray field laid out on top of it.
const RIDGE_OCTAVES = 6;
const FLOW_X = 0.15;
const FLOW_Y = -0.09;
const FLOW_OCTAVE_STEP = 0.2;
const SPARKLE_FLOW = 2.0;
// Layout of the uDriftFlow uniform array driftFlows fills: [x, y] pairs for
// the forward warp sample and the backward one, then one pair per ridge
// octave, then the scalar glint/spray scroll.
const FLOW_FWD = 0;
const FLOW_BACK = 2;
const FLOW_RIDGE = 4;
const FLOW_SPARKLE = FLOW_RIDGE + 2 * RIDGE_OCTAVES;
const DRIFT_FLOW_LEN = FLOW_SPARKLE + 1;

/** Fills `out` with every drift offset FRAG adds to a noise coordinate, each
 *  already wrapped by wrapFlow: the field is periodic in NOISE_PERIOD
 *  (hashCell in FRAG), so each entry is equivalent to its unwrapped value
 *  and the GPU never sees the raw, ever-growing phase. `phase` is
 *  advanceDensityFlow's `scaledPhase`, which already carries the density
 *  factor the shader applies to q (see that function for why it's folded
 *  in per tick rather than here). */
export function driftFlows(phase: number, out: Float32Array = new Float32Array(DRIFT_FLOW_LEN)): Float32Array {
  const fx = phase * FLOW_X;
  const fy = phase * FLOW_Y;
  out[FLOW_FWD] = wrapFlow(fx);
  out[FLOW_FWD + 1] = wrapFlow(fy);
  out[FLOW_BACK] = wrapFlow(-fx);
  out[FLOW_BACK + 1] = wrapFlow(-fy);
  for (let i = 0; i < RIDGE_OCTAVES; i++) {
    const k = 1 + i * FLOW_OCTAVE_STEP;
    out[FLOW_RIDGE + 2 * i] = wrapFlow(fx * k);
    out[FLOW_RIDGE + 2 * i + 1] = wrapFlow(fy * k);
  }
  out[FLOW_SPARKLE] = wrapFlow(phase * SPARKLE_FLOW);
  return out;
}

// Caustic density's glide: the exponential time constant the live density
// eases toward its target with (~95% of a slider move lands within 3τ).
// Slow enough that a drag reads as the pool easing to a finer/coarser mesh
// rather than snapping; fast enough that a patched level source still
// visibly follows the music instead of averaging every swing away.
export const DENSITY_GLIDE_SEC = 0.6;

/** advanceDensityFlow's state: `live` is the glided density (null until the
 *  first tick), `scaledPhase` the density-scaled drift phase driftFlows
 *  reads. */
export interface DensityFlowState {
  live: number | null;
  scaledPhase: number;
}

export function createDensityFlowState(): DensityFlowState {
  return { live: null, scaledPhase: 0 };
}

/** One tick: `live` glides toward `targetDensity` over DENSITY_GLIDE_SEC
 *  (the first tick snaps, so the scene doesn't ease in on load), then
 *  `scaledPhase` gains this tick's `phaseStep` scaled by the live density.
 *
 *  Scaling each tick's step, never the running total, is the point. The
 *  drift offsets used to be the whole accumulated phase times whatever
 *  density was live that frame, so any density change rescaled all the
 *  distance the field had ever travelled and teleported it — worse the
 *  longer the scene had run. Now a change only bends the drift rate from
 *  here on. At a constant density the sum is exactly the old product, so
 *  screen-space drift speed is still independent of density (rate ×
 *  densScale in noise space, sampled at densScale × the frequency). */
export function advanceDensityFlow(state: DensityFlowState, dtSec: number, targetDensity: number, phaseStep: number): void {
  state.live = state.live === null ? targetDensity : state.live + (targetDensity - state.live) * (1 - Math.exp(-dtSec / DENSITY_GLIDE_SEC));
  state.scaledPhase += phaseStep * causticDensityScale(state.live);
}

// Own accumulator for the domain-warp drift: never reset, only advanced, so
// dragging the Drift slider mid-run changes the *rate* going forward and
// never jumps the field (see the file header and flowClock.ts).
//
// DRIFT_BASE_RATE used to be 0.15 — chosen to "match the original fixed
// speed" — but the flow term (driftFlows above) already multiplies the
// phase by FLOW_X. That halved the intended attenuation twice over, so
// drift=1 (the old default) ran ~6.7x slower than the scene's original
// wander and even the old max (2) was ~3.3x slower. 2.0 here is what
// actually cancels out to flowClock.ts's own base rate of 1.0/sec at the
// slider's new midpoint — see driftRatePerSec below.
const DRIFT_BASE_RATE = 2.0;
// Gain Speed boost applies at its own max against a fully loud passage
// (levelValue 1): LEVEL_GAIN/DRIFT_BASE_RATE = 1.5, so Speed boost at 1 adds
// up to 1.5x the mid Drift speed on top of the base — additive, not a
// multiplier on it (see driftRatePerSec below), which is what lets it still
// move the pool with Drift speed parked at 0.
const LEVEL_GAIN = 3.0;

// Speed pump's own accumulator (advancePump, below). One hit's whole decaying
// pulse (drives.ts's continuous reading of a catalogue hit, which decays at
// BEAT_PULSE_DECAY_PER_SEC, animClock.ts) has an area of about
// 1/BEAT_PULSE_DECAY_PER_SEC seconds, so PUMP_ACCEL=6.0 is sized so one
// full-height hit at amount 1 adds about 1.0 phase/s to vel — doubling the
// mid Drift speed for a moment, the same magnitude a single strike ought to
// read as. PUMP_RELEASE_SEC is "slowly going back" from the user's own
// description: at a steady 120bpm (2 hits/sec) that same ~1.0/s per hit
// settles near 1.0 * 2 * PUMP_RELEASE_SEC = 3/s once the push and the decay
// balance. PUMP_VEL_CAP keeps a fast, dense passage (a drum roll, hits with
// little refractory gap between them) from accumulating without bound.
const PUMP_ACCEL = 6.0;
const PUMP_RELEASE_SEC = 1.5;
const PUMP_VEL_CAP = 8;

// Absolute ceiling on the rate driftRatePerSec returns. The additive model
// below can't reach this on its own even with every term maxed at once —
// base = DRIFT_BASE_RATE(2) * drift(1) = 2, level = LEVEL_GAIN(3), pump
// capped at PUMP_VEL_CAP(8), summing to 13 — so this is now a generous backstop
// rather than a value any combination of settings is meant to reach, unlike
// the older multiplicative surge design this rate replaced (see this file's
// git history), which could actually walk right up to it.
const DRIFT_RATE_MAX = 20;

// Speed boost's driver: FeatureFrame.level, fast-tracked and calibrated
// against its own leaky floor/ceiling. This is the deliberate inverse of
// sectionIntensity.ts, which contracts its own floor/ceiling on a
// phrase-length timescale (~3.3s/~12s) so a long quiet passage climbs back
// toward mid — correct for "which section of the song is this", exactly
// wrong for "quiet should stay quiet". Contracting an order of magnitude
// slower (~30s) is what makes this gain-independent instead: it settles
// into the room/playback's own observed range and stays there, rather than
// re-normalizing away the very quiet-vs-loud contrast it exists to show. It
// also reads a different signal (`level`, not `energy`), so this isn't a
// duplicate of that module — it's a different job on a different input.
const LOUD_FAST_RATE_PER_SEC = 5; // ~0.2s: a loud bar registers at once, without chasing individual transients
const LOUD_ENV_EXPAND_RATE_PER_SEC = 1 / 0.3; // ~0.3s: a new extreme is grabbed almost immediately
const LOUD_ENV_CONTRACT_RATE_PER_SEC = 1 / 30; // ~30s: an old extreme is forgotten slowly — see above
const LOUD_MIN_RANGE = 0.15; // below this observed range, confidence blends the output toward neutral instead of amplifying noise
// advanceLoudSwell's own seed/no-signal value (0.5 = neither expand nor
// contract the pool) — also what extraUniforms passes as drives.value()'s
// `rest` for the "driftLevel" jack when it feeds loudSwellDrive, so an
// unplugged jack reads as this same neutral there instead of drives.ts's
// plain rest of 0 (loudSwellDrive's own doc comment below).
const LOUD_NEUTRAL = 0.5;

export interface LoudSwellState {
  fast: number;
  floor: number;
  ceil: number;
  init: boolean;
}

export function createLoudSwellState(): LoudSwellState {
  return { fast: LOUD_NEUTRAL, floor: LOUD_NEUTRAL, ceil: LOUD_NEUTRAL, init: false };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Advances the loudness calibration in place and returns loudSwell (0..1,
 *  0.5 = neutral): `level`'s position within its own recently observed
 *  range. The first call seeds floor/ceil/fast from that sample (so startup
 *  acquires rather than reporting a false full range) and returns neutral.
 *  Pure aside from `st`, and exported so tests/caustics.test.ts can pin the
 *  gain-invariance (any constant input settles at neutral), extremes-tracking
 *  and slow-forgetting properties directly. */
export function advanceLoudSwell(st: LoudSwellState, dtSec: number, level: number): number {
  const lvl = clamp01(level);
  if (!st.init) {
    st.fast = lvl;
    st.floor = lvl;
    st.ceil = lvl;
    st.init = true;
    return LOUD_NEUTRAL;
  }

  st.fast += (lvl - st.fast) * Math.min(1, LOUD_FAST_RATE_PER_SEC * dtSec);

  const expand = Math.min(1, LOUD_ENV_EXPAND_RATE_PER_SEC * dtSec);
  const contract = Math.min(1, LOUD_ENV_CONTRACT_RATE_PER_SEC * dtSec);
  st.floor += (st.fast - st.floor) * (st.fast < st.floor ? expand : contract);
  st.ceil += (st.fast - st.ceil) * (st.fast > st.ceil ? expand : contract);

  const range = st.ceil - st.floor;
  const raw = range > 1e-4 ? clamp01((st.fast - st.floor) / range) : LOUD_NEUTRAL;
  const confidence = clamp01(range / LOUD_MIN_RANGE);
  return LOUD_NEUTRAL + confidence * (raw - LOUD_NEUTRAL);
}

// loudSwellDrive is uLoudSwell's JS-side source: driftLevel^2 weights how
// far loudSwell (0..1, LOUD_NEUTRAL = neutral) can push it — squared so the
// swing opens up mostly in the slider's top half rather than growing
// linearly — left linear and signed ([-1, 1], 0 at neutral) rather than
// exponentiated, since FRAG uses it as a direct multiplier on aperture/floor
// terms rather than a rate ratio. See the file header's driftLevel
// paragraph for what it drives. Its neutral isn't 0 — loudSwellDrive(d, 0)
// is a permanent -d² "quiet" tightening — so an unplugged "driftLevel" jack
// (drives.ts's header's "Nothing plugged in" paragraph) has to read
// LOUD_NEUTRAL here, not the engine's plain rest of 0 (extraUniforms below).
export function loudSwellDrive(driftLevel: number, loudSwell: number): number {
  return driftLevel * driftLevel * (2 * loudSwell - 1);
}

export interface PumpState {
  vel: number;
}

export function createPumpState(): PumpState {
  return { vel: 0 };
}

/** Advances Speed pump's own accumulating velocity in place: `input` (0..1 —
 *  whatever the "driftPump" drive picker is wired to, a hit's decaying
 *  envelope by default) accelerates `vel` by
 *  `PUMP_ACCEL * amount * input * dtSec`, then `vel` decays exponentially
 *  toward 0 with time constant PUMP_RELEASE_SEC — "each push accelerates
 *  drift speed, then it slowly goes back to the one set by drift", the
 *  user's own gas-pedal description. `amount` is the driftPump slider
 *  (0..1); the resulting `vel` is what driftRatePerSec below adds straight
 *  onto the rate, so a maxed amount with no input still decays to 0 rather
 *  than holding a floor. Capped at PUMP_VEL_CAP so a dense run of pushes
 *  can't accumulate without bound. Pure aside from `st`, and exported so
 *  tests/caustics.test.ts can pin the accelerate/release shape directly. */
export function advancePump(st: PumpState, dtSec: number, input: number, amount: number): void {
  st.vel += PUMP_ACCEL * amount * input * dtSec;
  st.vel *= Math.exp(-dtSec / PUMP_RELEASE_SEC);
  if (st.vel > PUMP_VEL_CAP) st.vel = PUMP_VEL_CAP;
}

export interface DriftInputs {
  /** The Drift speed slider, 0..1 (0.5 = original scene speed, 1 = 2x). */
  drift: number;
  /** Speed boost slider, 0..1 — see LEVEL_GAIN above. */
  driftLevel: number;
  /** loudSwell by default (0..1, 0.5 = neutral) — advanceLoudSwell's
   *  calibrated loudness — or whatever source the "driftLevel" picker is
   *  wired to instead: drives.value("driftLevel", loudSwellCalibrated) in
   *  extraUniforms below. */
  levelValue: number;
  /** Speed pump's own accumulating velocity (advancePump's `vel`), already scaled
   *  by the driftPump slider and its input, and added straight onto the
   *  rate — see PUMP_ACCEL/PUMP_RELEASE_SEC above. */
  pumpVel: number;
}

/** Pure phase-rate math for the drift accumulator, split out from
 *  extraUniforms so it's directly testable (see tests/caustics.test.ts) —
 *  this is the function that would have caught the 2x-attenuation bug.
 *  Additive rather than multiplicative: driftLevel and pumpVel both add
 *  straight onto the Drift-speed base instead of scaling it, which is what
 *  lets either one still move the pool while Drift speed itself sits at 0 —
 *  a multiplier on a base of zero can only ever stay zero. */
export function driftRatePerSec(s: DriftInputs): number {
  const base = DRIFT_BASE_RATE * s.drift;
  const level = LEVEL_GAIN * s.driftLevel * s.levelValue;
  return Math.min(base + level + s.pumpVel, DRIFT_RATE_MAX);
}

const FRAG = `
// The integer lattice hash (hashCell / hash2Cell) — see the file header's
// precision paragraph and noiseHash.ts for why nothing here uses fract() of
// a large product.
${NOISE_HASH_GLSL}
#define TWO_PI 6.28318530718

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hashCell(i, ${NOISE_MASK}, 0u);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * 3.0;

  // Breathe: the pool zooms on whatever source is patched onto the breathe
  // setting, at BREATHE_ZOOM depth scaled by uBreathe — Bar wave by default,
  // the once-per-bar swing the old bar-locked cosine this line replaced used
  // to get straight off the beat clock. The literal 0.0 argument here is
  // only ever read for a stale-"scene" fallback (Custom=0, unreachable at
  // Breathe's own default) or no drive engine at all (PASSTHROUGH_DRIVES) —
  // bit-for-bit no zoom in either of those cases, not "the scene's own
  // contribution" (there's a real one now: Bar wave).
  p *= 1.0 + ${BREATHE_ZOOM.toFixed(2)} * uBreathe * breatheDrive(0.0);
  // Loudness swell's aperture: a loud passage opens the pool wider, a quiet
  // one tightens it — the scene's own sustained signal, where the breath
  // above only moves when a cable carries it. See SWELL_ZOOM's own comment
  // for why this line, not a new one.
  p *= 1.0 - ${SWELL_ZOOM.toFixed(2)} * uLoudSwell;

  // Bass swell: a sustained radial bulge near center, strongest right on a
  // low-band onset and fading outward — distinct from the beat ripple, which
  // is a one-shot ring rather than a standing bulge.
  float pLen0 = length(p);
  vec2 dir0 = pLen0 > 1e-4 ? p / pLen0 : vec2(1.0, 0.0);
  float bassBulge = uBass * bassDrive(uLowPulse);
  // Faded to zero at the origin: dir0 flips sign across the center, so a
  // displacement that's still nonzero there tears the field at a single
  // point — every filament near the middle gets dragged into a pinch.
  p += dir0 * bassBulge * 0.22 * exp(-pLen0 * 0.8) * smoothstep(0.0, 0.4, pLen0);

  // uDensityLive scales the noise field's own sampling frequency — more,
  // finer filaments at higher values. It's the glided, drive-scaled density
  // advanceDensityFlow keeps (the raw uCausticDensity setting uniform isn't
  // read, so a change eases in instead of landing in one frame). Applied
  // once, here, to q's starting point; every later use of q inherits it
  // because q is built by accumulating onto that scaled start (see q's
  // definition below), not by re-scaling p at each octave separately. The
  // drift offsets in uDriftFlow carry the same factor, folded in per tick
  // JS-side (advanceDensityFlow), so a finer/coarser pattern doesn't also
  // drift visibly faster/slower on screen — screen-space drift speed is
  // flowRate / (samplingFreq), and densScale cancels between the two.
  float densScale = pow(2.0, (uDensityLive - 0.5) * ${DENSITY_SPAN_OCTAVES.toFixed(2)});

  // This scene's own drift (uDriftFlow, uploaded by extraUniforms below)
  // replaces the shared uFlowPhase so drift speed is dialable. It arrives
  // as one already-wrapped offset per use (see driftFlows and the file
  // header's precision paragraph) rather than as a raw phase to multiply
  // here — the multiply is exactly what used to push the hash past fp32.
  vec2 flowFwd = vec2(uDriftFlow[${FLOW_FWD}], uDriftFlow[${FLOW_FWD + 1}]);
  vec2 flowBack = vec2(uDriftFlow[${FLOW_BACK}], uDriftFlow[${FLOW_BACK + 1}]);
  vec2 sparkleFlow = vec2(uDriftFlow[${FLOW_SPARKLE}]);

  // Beat ripple: rippleEmitter.ts's continuous ring emitter, built on the
  // CPU each frame into a 1D radial crest/slope profile (uRippleCrest/
  // uRippleSlope — see that file's buildProfile) and sampled here at this
  // pixel's own radius via rippleSampleCrest/rippleSampleSlope (declared in
  // extraUniformDecls below), in place of the old pool's own per-slot loop
  // over ring uniforms — see rippleEmitter.ts's header for why this shape
  // replaced both the pool and, briefly, a real 2D wave simulation. The
  // pattern is refracted by the ring's *slope*, not its height — the same
  // reasoning the old pool used: a slope pushes the pattern outward on the
  // rising side of a ring and draws it back on the falling side, reading as
  // a wave sweeping through the filaments, where a height-based push would
  // instead drag everything near a crest toward one lump.
  float pLen = length(p);
  vec2 radialDir = pLen > 1e-4 ? p / pLen : vec2(1.0, 0.0);
  float ringCrestRaw = rippleSampleCrest(pLen);
  float ringSlopeRaw = rippleSampleSlope(pLen);
  // A soft knee, not a hard clamp: unchanged up to RIPPLE_CEIL_KNEE, exactly
  // where a single full-strength ring's own peak sits by construction (see
  // RIPPLE_CEIL_KNEE's own comment) — so one ring looks bit-for-bit like the
  // old pool's; only several overlapping rings pushing past that peak get
  // gently pulled toward RIPPLE_CEIL_MAX instead of tearing the pattern.
  float ringCrest = softCeil(ringCrestRaw, ${RIPPLE_CEIL_KNEE.toFixed(2)}, ${RIPPLE_CEIL_MAX.toFixed(2)});
  float ringSlope = softCeil(ringSlopeRaw, ${RIPPLE_CEIL_KNEE.toFixed(2)}, ${RIPPLE_CEIL_MAX.toFixed(2)});
  // max(., 0.0): Bump/Merge's crest never goes negative (a bare sum of two
  // positive gaussians), so this is a no-op for them; Wave's own crest can
  // (its trough dips below the resting level), and a trough shouldn't darken
  // the picture below its own resting look — only a crest brightens it. The
  // refraction term below reads ringSlope directly, signed, unaffected.
  float ring = uRipple * max(ringCrest, 0.0);
  // Scaled by densScale here, once — every later octave builds on q by
  // accumulating onto it (see the loop below), so the whole pattern inherits
  // the frequency change from this one multiply rather than re-scaling p at
  // each octave separately.
  vec2 q = (p + radialDir * uRipple * ringSlope * ${RIPPLE_REFRACT.toFixed(3)}) * densScale;

  int iterations = int(mix(3.0, 6.0, uDetail));
  float acc = 0.0;
  float amp = 1.0;
  // uFog sets the resting sharpness (sharpRest); uFocus is a pure multiplier
  // on top of it, driven by uBeatPulse, so uFocus=0 always holds sharp
  // exactly at sharpRest (no snap, at any beatPulse) and sharpRest itself
  // never moves with uFocus (see focusSharp's own doc comment above, and
  // this file's git history for the two different ways earlier versions of
  // this line each conflated the two: scaling floor and peak together, or
  // pinning the peak identical at every focus setting).
  float sharpRest = mix(${FOG_SHARP_CRISP.toFixed(1)}, ${FOG_SHARP_HAZY.toFixed(1)}, uFog);
  float sharp = min(sharpRest * (1.0 + uFocus * focusDrive(uBeatPulse) * ${FOCUS_SNAP_RATIO.toFixed(2)}), ${FOCUS_SHARP_MAX}.0)
    * (1.0 - bassBulge * 0.25);
  float ridgeGain = sqrt(sharp / 4.0); // a thinner ridge is proportionally brightened, so Focus snaps intensity too, not just width
  // Warp compresses screen space into q-space, and near its own fold points
  // that compression runs unbounded — arbitrarily fine screen-space detail,
  // no antialiasing trick fixes that after the fact. Ordinarily this stays
  // hidden: the six octaves' ridge contours pass through those fold points
  // at very different widths and never gang up. A focus snap breaks that —
  // every octave goes thin at once, so right where warp already folds
  // several of their contours close together, they all render as hard
  // near-coincident lines simultaneously, reading as a dense "pixel ladder"
  // fan. An earlier attempt eased warpAmt down in sync with focusDrive to
  // loosen that fold right when sharpness would otherwise expose it hardest
  // — removed at the time (see this file's git history) because it moved
  // ridge *positions* on every beat as a side effect of an anti-aliasing fix
  // that didn't demonstrably work, i.e. unwanted motion for no proven
  // benefit. uTurbulence below already owns this same warpAmt channel and is
  // drive-wirable (see the "turbulence" SceneSetting's own drive) — pick Any
  // hit there instead of reaching for a second, dedicated beat-reshape
  // control (a "Beat churn" setting used to duplicate exactly this channel
  // with its own decaying pulse; removed for that reason — see this file's
  // git history). aaSharp below still bounds the pixel-ladder artifact
  // independent of warpAmt; a maxed Mid turbulence against a maxed Focus
  // snap is the case to eyeball for it.
  float warpAmt = 0.45 * (1.0 + uTurbulence * turbulenceDrive(uMid) * 1.2);
  for (int i = 0; i < ${RIDGE_OCTAVES}; i++) {
    if (i >= iterations) break;
    float band = sampleBands(float(i) / ${RIDGE_OCTAVES}.0);
    float fi = float(i);
    q += vec2(
      noise(q * 1.7 + flowFwd + fi),
      noise(q * 1.7 + flowBack + fi * 1.3)
    ) * warpAmt;
    vec2 ridgeFlow = vec2(uDriftFlow[${FLOW_RIDGE} + 2 * i], uDriftFlow[${FLOW_RIDGE + 1} + 2 * i]);
    float v = noise(q * 2.3 + ridgeFlow);
    float ridge = 1.0 - abs(v * 2.0 - 1.0);
    // Anti-alias the ridge against its own screen-space footprint. pow()
    // has no concept of pixel size, so whenever the true line width (which
    // shrinks as sharp climbs) drops below what a pixel's worth of noise
    // change (fwidth(v)) can resolve, the rasterizer can only stair-step
    // between "in" and "out" — the "pixel ladder" artifact, worst right
    // when uFocus slams sharp up fast on a beat. Capping the exponent used
    // here (never the uniform "sharp" itself, so ridgeGain's brightness
    // still tracks the real, unclamped snap) keeps the rendered line at
    // least ~1px wide regardless of how fast sharp moves.
    float aaSharp = min(sharp, 0.3 / max(fwidth(v), 1e-4));
    acc += amp * (0.5 + band * 0.8) * pow(ridge, aaSharp) * ridgeGain;
    amp *= 0.6;
  }

  // Treble sparkle: fine glints gated to where the pattern is already bright
  // (ridge crests), driven by a high-band onset pulse — or, once
  // uSparkleSustain is dialed up, kept alive through a sustained wash too.
  // uSparkleBright/Density/Grain/Spread/Sustain used to be fixed constants
  // here (1.5, 8.0, 38.0, smoothstep(0.15, 0.6, ...), pulse-only); each
  // defaults to reproduce its old constant exactly (see the
  // sparkleBright..sparkleSustain entries in SETTINGS above) and is a macro
  // of uSparkle, so the master knob still moves all of them together.
  // Picking a source other than Sparkle's own Scene default (sparkleDrive()
  // below, generated by DRIVE_GLSL from the "sparkle" setting's own drive —
  // sceneCommon.ts) replaces this whole composite, including Frequencies:
  // the sensitivity line drawn for this setting in place of the treble hit
  // detector entirely (used to be a continuous "Sparkle from line" dial
  // blending toward it; now a discrete alternative pick).
  float sparkleLo = mix(${SPARKLE_SPREAD_LO_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_LO_AT_1.toFixed(2)}, uSparkleSpread);
  float sparkleHi = mix(${SPARKLE_SPREAD_HI_AT_0.toFixed(2)}, ${SPARKLE_SPREAD_HI_AT_1.toFixed(2)}, uSparkleSpread);
  float crestGate = smoothstep(sparkleLo, sparkleHi, acc);
  // uHigh is the slewed continuous high-band level (vs. uHighPulse's
  // decaying onset spike) — max() rather than a blend so sustain=0 leaves
  // the pulse-only drive bit-for-bit untouched.
  float sparkleGlintDrive = sparkleDrive(max(uHighPulse, uSparkleSustain * uHigh));
  // uSparkleWarp bends the coordinate glints are sampled at with its own
  // small warp pass — independent of the ridge loop's warpAmt above, so
  // dragging it changes only the glints' own curvature, never the ridges'.
  // Zero at default: sparkleQ is q verbatim until this is touched.
  vec2 sparkleQ = q;
  if (uSparkleWarp > 0.0) {
    vec2 sparkleWarpOffset = vec2(
      noise(q * 0.8 + flowFwd + 11.0),
      noise(q * 0.8 + flowBack + 23.0)
    ) - 0.5;
    sparkleQ += sparkleWarpOffset * uSparkleWarp * ${SPARKLE_WARP_GAIN.toFixed(2)};
  }
  float sparkleFreq = mix(${SPARKLE_GRAIN_FREQ_LO.toFixed(1)}, ${SPARKLE_GRAIN_FREQ_HI.toFixed(1)}, uSparkleGrain);
  float sparkleNoise = noise(sparkleQ * sparkleFreq + sparkleFlow);
  float sparkleExp = mix(${SPARKLE_DENSITY_EXP_LO.toFixed(1)}, ${SPARKLE_DENSITY_EXP_HI.toFixed(1)}, uSparkleDensity);
  float sparkleGain = uSparkleBright * ${SPARKLE_BRIGHT_GAIN.toFixed(1)};
  acc += uSparkle * sparkleGlintDrive * crestGate * pow(sparkleNoise, sparkleExp) * sparkleGain;

  // Spray injection, added on top of the glints rather than in place of
  // them. The glint field is tiled into nozzle cells — in sparkleQ *
  // sparkleFreq, the exact coordinate the glints sample, drifting with the
  // same wrapped drift offset (sparkleFlow) — and each cell holds one nozzle spraying
  // INJECTION_DROPS droplets outward on hashed directions and phases, so
  // sprays appear everywhere glints can and never fire in lockstep. The
  // motion runs on uTime (its own continuous clock, not gated to
  // anim.onset), but the brightness is gated exactly like a glint —
  // uSparkle * sparkleGlintDrive * crestGate * sparkleGain — so spray shows
  // up where and when the hats sparkle, and adds nothing until uInjection is
  // raised. injectionDrive() (generated by DRIVE_GLSL from the "injection"
  // setting's own drive) is a second, independent gate on top of that — a
  // treble hit throws a little extra spray by default (see that setting's
  // own comment in SETTINGS), applied as a lift
  // (1.0 + INJECTION_DRIVE_LIFT * injectionDrive(uHighPulse)) rather than a
  // bare multiplier, so an unplugged jack sprays exactly what uInjection
  // already says instead of nothing at all. Droplet
  // radius shrinks with actual distance from its nozzle
  // (INJECTION_REACH), not with time, so it reads as a stream atomizing
  // into mist regardless of travel direction; the ease-out on dist makes
  // droplets leave fast and slow as they atomize (and, reversed, gather
  // speed as they're pulled in). Reverse Injection isn't the same path
  // played backwards in time — it changes *what* fades: normally a droplet
  // stays fully opaque leaving the nozzle and only dissipateFade lets it
  // fade out once fully atomized at the far end; reversed, dissipateFade is
  // dropped entirely, so the droplet stays opaque all the way back and only
  // nearNozzleFade — which depends purely on distance, not on time or
  // direction — pulls it to zero exactly as it arrives, reading as suction
  // rather than fading mist.
  //
  // The loop only runs where its result can show: sprayGain is every factor
  // the field gets multiplied by, so a pixel below the crest gate (dark
  // water), a frame with no treble drive, or Spray at 0 skips it outright.
  // It visits the 2x2 nozzle cells whose centers straddle ip, not the 3x3
  // around ip's own cell, and skips any nozzle farther than
  // INJECTION_LIT_RADIUS — see that constant for why neither drops a
  // droplet that could light this pixel.
  float sprayGain = uSparkle * sparkleGlintDrive * crestGate * sparkleGain * uInjection * (1.0 + ${INJECTION_DRIVE_LIFT.toFixed(1)} * injectionDrive(uHighPulse)) * ${INJECTION_GAIN.toFixed(2)};
  float injectionField = 0.0;
  if (sprayGain > 0.0) {
    vec2 ip = (sparkleQ * sparkleFreq + sparkleFlow) * ${INJECTION_CELLS_PER_GRAIN.toFixed(2)};
    vec2 nearCell = floor(ip - 0.5);
    for (int gx = 0; gx <= 1; gx++) {
      for (int gy = 0; gy <= 1; gy++) {
        vec2 cellId = nearCell + vec2(float(gx), float(gy));
        // Its own lattice period (INJECTION_MASK) — this field wraps at
        // NOISE_PERIOD * INJECTION_CELLS_PER_GRAIN cells, see INJECTION_MASK's comment.
        vec2 nozzle = cellId + 0.5 + (hash2Cell(cellId, ${INJECTION_MASK}, 1u) - 0.5) * ${INJECTION_NOZZLE_JITTER.toFixed(2)};
        vec2 toNozzle = ip - nozzle;
        if (dot(toNozzle, toNozzle) > ${(INJECTION_LIT_RADIUS * INJECTION_LIT_RADIUS).toFixed(4)}) continue;
        for (int k = 0; k < ${INJECTION_DROPS}; k++) {
          vec2 rnd = hash2Cell(cellId, ${INJECTION_MASK}, 2u + uint(k));
          float cyclePos = fract(uTime * ${INJECTION_RATE.toFixed(2)} + rnd.x);
          float travel = uInjectionReverse > 0.5 ? 1.0 - cyclePos : cyclePos;
          float ang = rnd.y * TWO_PI;
          float dist = (1.0 - (1.0 - travel) * (1.0 - travel)) * ${INJECTION_REACH.toFixed(2)};
          vec2 dropIp = nozzle + vec2(cos(ang), sin(ang)) * dist;
          float d = length(ip - dropIp);
          float dropR = mix(${INJECTION_NEAR_R.toFixed(2)}, ${INJECTION_FAR_R.toFixed(2)}, dist / ${INJECTION_REACH.toFixed(2)});
          float glow = exp(-d * d / (dropR * dropR) * 2.2);
          float spawnFade = smoothstep(0.0, 0.06, cyclePos);
          float nearNozzleFade = smoothstep(0.0, 0.12 * ${INJECTION_REACH.toFixed(2)}, dist);
          float dissipateFade = uInjectionReverse > 0.5 ? 1.0 : smoothstep(1.0, 0.75, cyclePos);
          injectionField += glow * spawnFade * nearNozzleFade * dissipateFade;
        }
      }
    }
  }
  acc += sprayGain * injectionField;

  // Soft center bloom on a bass hit, on top of the geometric bulge above.
  acc += bassBulge * exp(-pLen0 * 1.5) * 0.6;

  acc *= 0.35 + pow(uEnergy, 1.5) * 0.7 + uFlash * flashDrive(uBeatPulse) * 1.5 + ring * 0.8;
  // Dark-water floor: uFog=0 clips almost exactly today's old fixed cut
  // (0.08), so filaments read as bright threads on black water; uFog=1 clips
  // nothing at all, so the dim wash the haze sits in actually glows instead.
  // Loudness swell's floor lift: a loud passage glows the dim wash between
  // filaments instead of clipping it away; a quiet one deepens the cut
  // toward flat black water. See SWELL_FLOOR_LIFT's own comment.
  acc = max(0.0, acc - mix(${FOG_FLOOR_CRISP.toFixed(2)}, ${FOG_FLOOR_HAZY.toFixed(2)}, uFog)
    * max(0.0, 1.0 - ${SWELL_FLOOR_LIFT.toFixed(2)} * uLoudSwell));
  // Hue phase rides brightness (a ridge crest tints differently than the
  // dim water around it) through a cosine, which wraps through its full
  // hue cycle for roughly a unit change of phase. Raw acc can swing several
  // units within a couple of pixels right at a sharp ridge edge — most of
  // all exactly on a beat, when ridgeGain is also elevated — and cycling
  // through hues that fast across so few pixels is what actually read as a
  // rainbow "pixel ladder" tracing every ridge (not luminance banding —
  // lowering sharp's own ceiling barely touched it, which is what ruled
  // luminance out). Clamping huePhase's own range would have killed the
  // fringing too, but it also flattened the deliberate hue spread between
  // dim water and bright crests everywhere, not just at the hard edges.
  // Instead, damp the palette's cosine *modulation* — never its average
  // color — by how fast huePhase is moving per pixel (fwidth): a slowly
  // drifting phase (ridge interiors, open water) keeps its full designed
  // color swing, while a phase that's trying to wrap within a pixel or two
  // fades toward the average color instead of aliasing through the wrap.
  //
  // The damp is measured on the palette's actual per-channel cosine
  // argument (hueArg = 2π(uPalC·huePhase + uPalD)), not on huePhase alone —
  // uPalC varies per channel and per palette ("neon" is [1,1,1], but "acid"
  // is [1.2, 0.9, 0.6] and "fire" is [1.0, 0.7, 0.4]), so a palette's
  // fastest channel wraps sooner than a shared scalar constant can account
  // for. fwidth/exp are componentwise on vec3 in GLSL ES 3.00, so each
  // channel damps on its own actual wrap rate.
  float huePhase = acc * 0.3 + uTime * 0.02 - bassBulge * 0.15
    + (uCentroid - 0.5) * uCentroidHue * ${CENTROID_HUE_GAIN.toFixed(2)};
  vec3 hueArg = 6.28318 * (uPalC * huePhase + uPalD);
  vec3 hueDamp = exp(-${HUE_DAMP_K.toFixed(2)} * fwidth(hueArg) * fwidth(hueArg));
  vec3 col = (uPalA + uPalB * cos(hueArg) * hueDamp) * acc;
  col = col / (1.0 + col); // tonemap — the shader had no ceiling before, so bright hits clipped flat

  outColor = vec4(col, 1.0);
}
`;

export const causticsScene = createFullscreenScene(
  "caustics",
  "Caustics",
  FRAG,
  (() => {
    const densityFlow = createDensityFlowState();
    const pump = createPumpState();
    const loudSwellState = createLoudSwellState();
    const flowBuf = new Float32Array(DRIFT_FLOW_LEN);

    // Beat ripple's own emitter state: `emission` conditions the driver
    // signal into a launched amount each frame (advanceEmission), `emitter`
    // holds every ring still in flight, and `crestBuf`/`slopeBuf` are the
    // persistent arrays buildProfile fills and extraUniforms uploads — see
    // rippleEmitter.ts's header for how the three fit together.
    const emission = createRippleEmissionState();
    const ringRate = createRingRateState();
    const emitter = createRippleEmitter();
    const crestBuf = new Float32Array(PROFILE_SAMPLES);
    const slopeBuf = new Float32Array(PROFILE_SAMPLES);
    let prevDropOnset = false;

    return {
      settings: SETTINGS,
      extraUniformDecls: `
uniform float uDriftFlow[${DRIFT_FLOW_LEN}];
// The glided, drive-scaled Caustic density (advanceDensityFlow) — see
// densScale in FRAG.
uniform float uDensityLive;
uniform float uLoudSwell;
uniform float uRippleCrest[${PROFILE_SAMPLES}];
uniform float uRippleSlope[${PROFILE_SAMPLES}];
// Linear interpolation into a profile array built by rippleEmitter.ts's
// buildProfile — see FRAG's own comment above the Beat ripple block for how
// these two feed the display.
float rippleSampleCrest(float r) {
  float t = clamp(r / ${PROFILE_MAX_RADIUS.toFixed(2)}, 0.0, 1.0) * ${(PROFILE_SAMPLES - 1).toFixed(1)};
  int i0 = int(t);
  int i1 = min(i0 + 1, ${PROFILE_SAMPLES - 1});
  return mix(uRippleCrest[i0], uRippleCrest[i1], fract(t));
}
float rippleSampleSlope(float r) {
  float t = clamp(r / ${PROFILE_MAX_RADIUS.toFixed(2)}, 0.0, 1.0) * ${(PROFILE_SAMPLES - 1).toFixed(1)};
  int i0 = int(t);
  int i1 = min(i0 + 1, ${PROFILE_SAMPLES - 1});
  return mix(uRippleSlope[i0], uRippleSlope[i1], fract(t));
}
// A soft knee, not a hard clamp — see RIPPLE_CEIL_KNEE/RIPPLE_CEIL_MAX's own
// comment in caustics.ts. Signed, so a slope's own push/pull direction
// survives the ceiling.
float softCeil(float x, float knee, float ceil) {
  float m = abs(x);
  float c = m <= knee ? m : knee + (ceil - knee) * tanh((m - knee) / (ceil - knee));
  return sign(x) * c;
}`,

      extraUniforms: (frame, anim, getSetting, drives) => {
        const driftLevel = getSetting("driftLevel");
        // Kept up to date every tick regardless of driftLevel's own drive
        // choice — see the "driftLevel" SceneSetting's own comment — and
        // drives.value()'s sceneDefault, so at that setting's Scene default
        // (today's behavior) levelValue/swellValue are exactly this
        // calibrated reading.
        const loudSwellCalibrated = advanceLoudSwell(loudSwellState, anim.dtSec, frame.level);
        // Two reads of the same patch, different rests for an unplugged jack
        // (drives.ts's header's "Nothing plugged in" paragraph): the rate
        // below only ever adds on top of Drift speed's own base, so nothing
        // plugged in should add nothing — rest 0, its own neutral. The swell
        // read passes LOUD_NEUTRAL instead — loudSwellDrive's own neutral
        // isn't 0 (see that function's own doc comment).
        const levelValue = drives.value("driftLevel", loudSwellCalibrated);
        const swellValue = drives.value("driftLevel", loudSwellCalibrated, LOUD_NEUTRAL);
        // Speed pump's own accelerate-then-release velocity, advanced before the
        // rate below reads pump.vel, so this tick's push already counts.
        // Bass hit's own decaying envelope at driftPump's Beat-hit default —
        // see the "driftPump" SceneSetting's own comment.
        advancePump(pump, anim.dtSec, drives.value("driftPump", anim.lowPulse), getSetting("driftPump"));
        const phaseStep = anim.dtSec * driftRatePerSec({
          drift: getSetting("drift"),
          driftLevel,
          levelValue,
          pumpVel: pump.vel,
        });
        // Caustic density: the slider lifted toward a finer mesh by its own
        // source (densityTargetFor — the slider exactly when nothing is
        // plugged in). advanceDensityFlow glides toward it and folds the live
        // value into the drift phase. The sceneDefault is the reading the
        // default (Section) equals, for a stale stored "scene".
        const densityTarget = densityTargetFor(getSetting("causticDensity"), drives.value("causticDensity", anim.sectionIntensity));
        advanceDensityFlow(densityFlow, anim.dtSec, densityTarget, phaseStep);

        // Beat ripple: age every ring already in flight first, so a ring
        // emitted below starts this frame at age 0 instead of ageing before
        // its own first sample (see rippleEmitter.ts's tick's own doc
        // comment). Wave speed/Wave fade/Ring width are resolved into one
        // params object shared by tick and buildProfile below.
        const rippleParams: RippleProfileParams = {
          decayPerSec: rippleDecayFor(getSetting("waveFade")),
          speedUnitsPerSec: rippleSpeedFor(getSetting("waveSpeed")),
          widthGaussianW: rippleWidthFor(getSetting("ringWidth")),
        };
        const ringStyle = ringStyleFor(getSetting("ringStyle"));
        emitter.tick(anim.dtSec, rippleParams);

        // The Scene default this setting's drive picker reproduces — "bass
        // or beat hit" — read here as the two decaying pulses' max, a
        // continuous envelope rather than a one-shot edge (see the "ripple"
        // setting's own comment and advanceEmission's own doc comment for
        // why a continuous rise-based read is what makes a busy driver duck
        // itself instead of stacking full rings).
        const sceneDefaultSignal = Math.max(anim.lowPulse, anim.beatPulse);
        const rawSignal = drives.value("ripple", sceneDefaultSignal);
        // drives.threshold() is null while Ring threshold's own Off switch is
        // pressed (drives.ts's header's threshold paragraph) — passed through
        // as-is, since that's exactly what advanceEmission's own `threshold`
        // param wants for "every climb rings, sized by its own climb".
        // undefined only means there's no engine at all (PASSTHROUGH_DRIVES).
        const rippleThreshold = drives.threshold("ripple");
        const emitted = advanceEmission(emission, anim.dtSec, rawSignal, rippleThreshold === undefined ? RING_THRESHOLD_DEFAULT : rippleThreshold);
        emitter.emit(emitted, ringStyle);
        // The panel draws these on Beat ripple's own "What it receives"
        // graph (settingMarks.ts): the level a bump has to reach to send a
        // ring, and each ring actually sent. Only the one line — a second
        // "full ring" line made the graph harder to read, and a ring's dot
        // already shows how strong it was. No lines at all while Ring
        // threshold is off (salienceMarks returns null) — the ring itself
        // still shows as a reaction.
        const marks = salienceMarks(emission);
        publishSettingMarks("caustics", "ripple", marks ? [{ value: marks.ringsAbove, label: "reach to ring" }] : [], emitted);

        // A drop is rarer and bigger than an ordinary beat — a stronger ring
        // emitted in addition to whatever the continuous driver above just
        // emitted, independent of the "ripple" setting's own drive choice.
        // Edge-triggered locally since anim.dropOnset is already a one-shot
        // pulse, but the guard keeps this robust if that ever changes.
        const drop = anim.dropOnset && !prevDropOnset;
        prevDropOnset = anim.dropOnset;
        if (drop) emitter.emit(RIPPLE_DROP_AMP, ringStyle);

        // Rings that come close together are drawn narrower so they stay
        // separate instead of summing to a flat plateau (rippleEmitter.ts's
        // Auto-narrowing comment). Merge already spaces its rings out by
        // combining close ones, so it keeps the plain Ring width.
        advanceRingRate(ringRate, anim.dtSec, emitted);
        const profileParams: RippleProfileParams =
          ringStyle === "merge"
            ? rippleParams
            : { ...rippleParams, widthGaussianW: autoNarrowWidthW(rippleParams.widthGaussianW, rippleParams.speedUnitsPerSec, ringRate) };
        buildProfile(emitter, profileParams, crestBuf, slopeBuf, ringStyle);

        return {
          uDriftFlow: driftFlows(densityFlow.scaledPhase, flowBuf),
          uDensityLive: densityFlow.live ?? densityTarget,
          uLoudSwell: loudSwellDrive(driftLevel, swellValue),
          uRippleCrest: crestBuf,
          uRippleSlope: slopeBuf,
        };
      },
    };
  })(),
);
