// Caustics' card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../standout.ts";
import { EFFECT_GRAIN, MODE_BASIC, SHAPE_PLUCK, SPARKLE_EFFECTS, SPARKLE_MODES, SPARKLE_SHAPES } from "./causticsSparkle.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "released", added: "2026-08-27" } as const;

// The master sparkle knob. Defined outside SETTINGS so the sub-params
// further down (the dev-only fine constants at the end of the Look group,
// and Grain size) can name it directly as their `macro` driver: a spec
// reference costs nothing extra to resolve and can't drift out of sync with
// a key string. See their own leading comment further down for what each
// sub-param actually does; this one just carries the auto weights and stays
// the everyday slider.
const SPARKLE: SceneSetting = {
  key: "sparkle",
  label: "Sparkle",
  description: "How strongly hats and cymbals act on the pool, through the sparkle effect picked below",
  group: "Look",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.41,
  // Directly the hats/cymbals dial.
  auto: { brightness: 0.45, attack: 0.15 },
  // Two signals across two layers (a hat hit, or — with Sparkle sustain
  // dialed up — the sustained treble level too), not one, so the default
  // is Scene — see the sparkle block in extraUniforms. Used to have its own
  // continuous "Sparkle from line" dial blending toward the sensitivity
  // line; that's now Frequencies, a discrete alternative source on this
  // same picker. Each edge starts a hit, Basic or Adaptive (causticsSparkle.ts).
  // Not a hit driver: no standout detector, so its graph has no reach line,
  // reaction dots or Reaction row. Under Adaptive the built-in hat hit is
  // sized by its stand-out, so a soft hat sparkles less than a hard one.
  drive: {
    default: "scene",
    sceneLabel: "Scene: hat hits + sustain wash",
    sceneSources: ["anim.hats", "anim.high"],
    noStandout: "The user wanted no reaction dots or standout Threshold on sparkle (2026-10-15)",
  },
};

const SETTINGS: SceneSetting[] = [
  {
    key: "zoom",
    label: "Zoom",
    description: "How close the view sits to the pool — left shows more of it, right magnifies the filaments",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
    // Form, not Camera, so it can head the card: SETTING_GROUPS renders
    // Camera after Look. Framing, not an amount, so Master Scale stays off.
    masterScale: false,
  },
  {
    key: "causticDensity",
    label: "Caustic density",
    description:
      "How many filaments the pattern resolves into with nothing pushing it — fewer at low values, more at high, each keeping its width. A change eases in rather than snapping.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Pure framing geometry the user tunes to taste, same reasoning as
    // sparkleGrain's weight: 0 — not something the music profile should
    // silently redecide underneath a chosen look (no `auto` table).
    // Not wirable: the music's share is densityReach below, so this holds
    // still at any reach of 0 (#453).
  },
  {
    key: "densityReach",
    label: "Density reach",
    description:
      "How far whatever is wired in pushes the pattern finer than Caustic density (a chorus, by default). At 0 the density holds still.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    // The share of the remaining way to the finest mesh a full reading
    // covers (densityTargetFor); the default is the fixed lift this scene
    // had before the split, so existing looks are unchanged.
    default: 0.15,
    // Taste, so no auto table (same reasoning as causticDensity).
    // Section by default: the pool resolves into a finer mesh as the song
    // builds. The result is only a target — advanceDensityFlow glides the
    // drawn density toward it, so a source can't snap the field either.
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How far the pool zooms in and out with whatever is wired in — once a bar by default",
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
    description: "Each hit sends a ring out like a drop on water, from the center or a random spot (Rings start) — a busy driver can't rise as far between hits, so it makes lighter, denser rings instead of stacking full ones",
    group: "Motion",
    // One colour for this row and the ring controls under it, so the
    // ripple's own set reads apart from Breathe above and Drift below.
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.21,
    // Waves read best against punchy, uncluttered material.
    auto: { attack: 0.35, pulse: 0.25, density: -0.2 },
    // A kick onset OR a broadband beat, unconditionally — no single
    // catalogue source reproduces that union, so the default is Scene (see
    // the `extraUniforms` closure below, and drives.ts's header for why a
    // Scene default is still bit-identical to today). Fed to
    // standout.ts's advanceStandoutAmount as a continuous envelope rather
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
    // No `drive.threshold`: the Threshold row under this graph is the same
    // engine gate every other drive setting has (drives.ts's header's
    // threshold paragraph), applied to the signal before the emitter sees
    // it. What decides whether a climb that got through sends a ring is
    // Ring threshold, the next setting. The Reaction row (`hit`) starts on
    // Sized, the amount above; Flat launches one full ring per climb that
    // earns half a standout instead.
    drive: {
      default: "scene",
      sceneLabel: "Scene: kick or beat hit",
      sceneSources: ["anim.kickOnset", "feature.onset"],
      hit: { ownDetector: true, readout: "sized" },
    },
  },
  {
    key: "ringThreshold",
    label: "Ring threshold",
    description:
      "How far a hit has to stand out from the everyday sounds to send a ring — the \"reach to ring\" line on Beat ripple's graph. Left: more rings, even from quiet sounds. Right: only clear standouts.",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 0.05,
    default: STANDOUT_THRESHOLD_DEFAULT,
    // The adaptive line's margin over its learned noise floor
    // (standout.ts's standoutBar), read only by advanceStandoutAmount —
    // a response-shape, so no `auto` and no `drive`, like Ring width below.
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
    key: "ringOrigin",
    label: "Rings start",
    description:
      "Center: every ring starts in the middle. Random spot: each hit starts its ring somewhere new on the water, the way Physarum 2's Dose drops each colony in a new place.",
    group: "Motion",
    family: "Beat ripple",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "enum",
    options: ["Center", "Random spot"],
    // A placement pick, like Ring style above — no `auto`, no `drive`;
    // ringOriginFor (causticsRippleSpots.ts) maps this setting's 0/1 to the
    // RingOrigin extraUniforms reads.
  },
  {
    key: "waveSpeed",
    label: "Wave speed",
    description: "How fast a ring travels outward from where it starts",
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
    description: "Drift runs faster the louder the music is right now, and drops straight back to Drift speed when it quietens",
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
    // directly as levelValue in driftRatePerSec below. Rate-only: one jack
    // read, rest 0 (an unplugged jack adds no extra speed).
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
    // Driven continuously by anim.song.kickPulse today — a plain Kick default
    // (drives.ts's decaying-envelope reading of it, same field): a kick is
    // the natural pedal to push against; rewire it to energy or anything
    // else in the picker.
    drive: { default: "anim.kickOnset" },
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
    // uKickPulse directly — a plain Kick default.
    drive: { default: "anim.kickOnset" },
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
    // Fog, Fog pulse and Tighten all set the ridges' sharpness: how hazy
    // they sit at rest, how much haze a beat adds on top, and how thin a hat
    // snaps them — so they render in one shared colour family (see
    // sceneSettings.ts's `family`).
    family: "Fog",
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
    label: "Fog pulse",
    description: "How much a beat hazes the ridges softer than their resting state; 0 = no pulse at all",
    group: "Look",
    family: "Fog",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.86,
    // Beat-haze only reads as a pulse on music with actual beats to pulse
    // to. The auto *weights* are kept low (not the ~0.9 that `pulse` alone
    // would floor near on almost any locked-tempo track — 60% tempoLock
    // saturates for basically all steady music) so Auto can't walk the
    // resolved value the rest of the way to sitting near 1 all track, where
    // every hit would pull the same near-max haze rather than responding to
    // a specific one — the resting look itself never moves with this slider
    // (see the Fog setting above and focusSharp below), so the old worry
    // about pinning the *floor* doesn't apply any more, but a saturated
    // pulse is just as flat a result. The default itself is a baked look
    // (Option+D), not a weight choice.
    auto: { pulse: 0.2, attack: 0.15 },
    // uBeatPulse directly — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "tighten",
    label: "Tighten",
    description: "How sharp and thin the filaments snap on each hat or cymbal hit, then relax",
    group: "Look",
    // The ridge sharpness Fog and Fog pulse set (FRAG's `sharp`), pushed the
    // other way: a beat hazes it softer, a hat snaps it thinner.
    family: "Fog",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0, // keeps the default look
    // Taste, so no auto table (same reasoning as causticDensity).
    drive: { default: "anim.hats" },
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Overall brightness punch on each beat — pick Level instead of Any hit for a long loud stretch to stay lit rather than flashing once",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.75,
    // Same reasoning as ripple, for brightness punch instead of ring shape.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly — a plain Beat default. Used to be a continuous
    // blend toward uEnergy via a separate "Flash from level" dial; that's
    // now a discrete alternative source (Level) on this same picker
    // instead of a second setting.
    drive: { default: "feature.onset" },
  },
  {
    key: "flare",
    label: "Flare",
    description: "How hard the brightest crests burn white on each hat or cymbal hit; dim water stays dim",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0, // keeps the default look
    // Taste, so no auto table (same reasoning as causticDensity).
    drive: { default: "anim.hats" },
  },
  {
    key: "contour",
    label: "Contour",
    description: "On each snare or clap the light snaps into flat steps with a bright line along each edge, like a contour map, then melts back",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    // Taste, so no auto table (same reasoning as causticDensity).
    drive: { default: "anim.chordOnset" },
  },
  {
    key: "levelGlow",
    label: "Level glow",
    description: "The whole pool brightens with whatever is wired in, Level by default; 0 = loudness no longer brightens it",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5, // 0.5 on this dial was the scene's old fixed level brightening (LEVEL_GLOW_GAIN)
    // The brightness that used to ride uEnergy with no setting at all (#449).
    // A plain Level default reads exactly what uEnergy did (signals.ts
    // header), so existing looks are unchanged. A multiply, not a lift: this
    // brightening exists only with music, so an unplugged jack reads 0 and
    // the glow goes, like Beat flash. No auto table, because this is taste.
    drive: { default: "anim.energy" },
  },
  {
    key: "centroidHue",
    label: "Spectral hue",
    description: "Colours lean one way when the mix is brighter than usual for this track, the other way when it's darker",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.68,
    // Already music-driven by construction (it reads the live centroid
    // directly, see FRAG's huePhase) — no auto table needed on top of that.
    reads: ["anim.centroid"],
  },
  {
    key: "colourStyle",
    label: "Colour",
    description:
      "Shades: the palette from its darkest colour in the dim water to its brightest on the crests. Shades + accent: the same, with the palette's accent on loud crests. Rainbow: every colour of the palette cycling along the ridges.",
    group: "Look",
    min: 0,
    max: 2,
    step: 1,
    default: 1,
    type: "enum",
    // Indexes match COLOUR_SHADES / COLOUR_RAINBOW, which FRAG branches on.
    // A taste pick, so no auto table and no drive.
    options: ["Shades", "Shades + accent", "Rainbow"],
  },
  SPARKLE,
  {
    key: "sparkleFx",
    label: "Sparkle effect",
    description: "What a hat hit does to the pool: Grain glints on the crests, Prism splits the filaments into colour, Run sends light along them",
    group: "Look",
    min: 0,
    max: SPARKLE_EFFECTS.length - 1,
    step: 1,
    default: EFFECT_GRAIN, // the glints this scene always had
    type: "enum",
    // A new key, not "sparkleEffect": that one's saved indexes pointed into
    // a longer list, and an old Prism would land on another effect.
    options: SPARKLE_EFFECTS,
  },
  {
    key: "sparkleGrain",
    label: "Grain size",
    description: "How coarse each Grain glint is; Prism and Run don't use it",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.11, // 0.5 on this dial was the old fixed noise scale of 38.0
    // Left off the master: glint size reads as a taste choice, not an
    // intensity one, and tying it to SPARKLE would make "stronger" also
    // silently resize every glint.
    macro: { driver: SPARKLE, weight: 0 },
  },
  {
    key: "sparkleAdapt",
    label: "Sparkle shape",
    description:
      "Basic: every hit flashes and fades the same way. Adaptive: the music shapes each hit — busy hats strobe, sparse ones glow on, accents flare and ghost notes fade, and treble that holds on (a cymbal wash, a held synth) trembles",
    group: "Look",
    min: 0,
    max: SPARKLE_MODES.length - 1,
    step: 1,
    default: MODE_BASIC,
    type: "enum",
    options: SPARKLE_MODES,
  },
  // Dev-only from here (SceneSetting.dev): the Basic shape's pick and dials,
  // then the fine constants under the Sparkle knob. Time and count dials opt
  // out of the Master card's Scale: it would stretch a hit's length or
  // change how fast a Bell trembles, not how much sparkle there is.
  {
    key: "sparkleShape",
    label: "Basic shape",
    description: "The curve every hit plays while Sparkle shape is Basic",
    group: "Look",
    min: 0,
    max: SPARKLE_SHAPES.length - 1,
    step: 1,
    default: SHAPE_PLUCK,
    type: "enum",
    options: SPARKLE_SHAPES,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleLength",
    label: "Length",
    description: "How long each Basic hit lasts, in seconds",
    group: "Look",
    min: 0.15,
    max: 2.5,
    step: 0.01,
    // With Pluck, a fade as fast as the treble pulse the glints used to
    // ride (PLUCK_TAU's comment), so the default look stays as it was.
    default: 0.6,
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleVibration",
    label: "Vibration",
    description: "How strongly a Bell hit, or an Adaptive ringing hit, trembles",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleSpeed",
    label: "Speed",
    description: "How many times a second a Bell or Adaptive tremble shakes. A 60 Hz screen shows at most 30; faster reads as a strobe",
    group: "Look",
    min: 12,
    max: 60,
    step: 1,
    default: 39,
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleVibDecay",
    label: "Vibration decay",
    description: "How long a Bell hit's trembling rings on: left dies fast, right rings through the whole length",
    group: "Look",
    min: 0.05,
    max: 1,
    step: 0.01,
    default: 0.5,
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleBounces",
    label: "Bounces",
    description: "How many times a Bounce hit lands",
    group: "Look",
    min: 1,
    max: 8,
    step: 1,
    default: 4,
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleAttack",
    label: "Attack",
    description: "How a Pluck, Bell or Bounce hit lands: left at once, right swelling up first, then playing out from its peak",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0, // at once, as the shapes were first built
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleDecay",
    label: "Hit decay",
    description: "How long the hit itself takes to fade in Pluck, Bell and Bounce: left fast, right slow",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5, // each shape's own fade (causticsSparkle.ts's SparkleShapeParams.decay)
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleRise",
    label: "Rise",
    description: "How much of the length a Swell hit spends growing before it lets go",
    group: "Look",
    min: 0.1,
    max: 0.95,
    step: 0.01,
    default: 0.75,
    masterScale: false,
    advanced: true,
    dev: true,
  },
  {
    key: "sparkleRelease",
    label: "Release",
    description: "How a Swell hit lets go at its peak: left a hard cut, right a soft fade",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5, // the cut Swell was first built with
    masterScale: false,
    advanced: true,
    dev: true,
  },
  // The constants that used to be hardcoded on the sparkle line in FRAG —
  // how bright, how many, how far the glints spread, how warped, and whether
  // they persist through a sustained wash instead of only flashing on a hit.
  // Each tracks SPARKLE as a macro: dragging the master knob moves them all
  // together, and each snaps to manual (stops following) the moment it's
  // touched directly, same as any auto-capable setting.
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
    dev: true,
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
    dev: true,
    macro: { driver: SPARKLE, weight: 0.35 },
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
    dev: true,
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
    dev: true,
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
    dev: true,
    macro: { driver: SPARKLE, weight: 0.3 },
  },
];

export const card: SceneCard = {
  id: "caustics",
  name: "Caustics",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./caustics.ts").then((m) => m.causticsScene);
