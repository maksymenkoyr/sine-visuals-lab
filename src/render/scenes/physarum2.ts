import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { Scene, SceneContext, PanelSection, Viewport } from "../scene.ts";
import { FULL_VIEWPORT } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import { grainTextureSide } from "./chladni.ts";
import { FLOAT_HASH_GLSL } from "../noiseHash.ts";
import { PASSTHROUGH_DRIVES } from "../drives.ts";
import { composeSettings, defineItemPairs, defineItems } from "../sceneItems.ts";
import { packUnit, SEED_RISE_REFRACTORY_SEC } from "./physarum.ts";
import {
  createStandoutTrigger,
  STANDOUT_THRESHOLD_DEFAULT,
  standoutLine,
  standoutThreshold,
  stepStandoutTrigger,
  type StandoutTrigger,
} from "../standout.ts";
import { publishSettingMarks } from "../settingMarks.ts";
import { AFFINITY_PRESETS, ATTRACT_ROWS, PAIR_WORDS, packTouch, smellWeight } from "./physarum2Affinity.ts";
import { createSynergyTracker, wrapTurn } from "./physarum2Synergy.ts";
export { ATTRACT_ROWS };

// Physarum 2: a second slime-mould scene, after Michael Fogleman's
// fogleman/physarum (Go, MIT — https://github.com/fogleman/physarum), studied
// for its multi-species idea (also described at https://sagejenson.com/physarum)
// and written independently rather than ported from his Go — CLAUDE.md's
// standing rule, the same one physarum.ts's own header cites for Mesh Grid.
// Where physarum.ts grows one shared trail split by band group, this scene
// runs SPECIES_COUNT independent strains (STRAINS), each with its own motion
// (sensor angle/distance, turn angle, step length) and its own trail
// channel. Every strain senses *every* strain's trail at once, through a
// weighted sum (the `att<i><j>` settings, defaulting to ATTRACT_ROWS):
// strongly its own trail (the diagonal), weakly or negatively everyone
// else's (the off-diagonal, scaled live by the Cross-smell setting). A strain
// pulled away from every other strain's ink carves out its own territory
// instead of merging into one shared network — that's the entire visual
// difference from physarum.ts, and the one idea taken from Fogleman's model
// rather than any of his code. Strains can also change each other's trails
// directly, independent of sensing: the `touch<i><j>` settings (2026-09-27,
// "Touch" below) let a strain feed or eat another's ink as it steps.
//
// Packing follows physarum.ts's playbook — RGBA8 ping-pong, no
// EXT_color_buffer_float dependency, gl_VertexID point deposits, a
// REPEAT/LINEAR torus trail — see that file's header for the shared
// reasoning (8-bit evaporation precision, frame.time vs anim.dtSec, why
// LINEAR+REPEAT on the trail). While Touch is eating, a second RGBA8 render
// target (the "footprint") counts each strain's landings per texel so next
// step's diffuse can charge the right decay — see "Touch" below. Two things
// are genuinely different here:
//
// - The trail is one RGBA8 texture with one live channel per strain, not
//   physarum.ts's three band-group channels: a deposit's ONE,ONE blend adds
//   into every channel, including alpha, which here is a strain's own ink —
//   never real transparency.
// - The model is defined per *simulation step*, not per second: Fogleman's
//   rule turns an agent by a fixed angle each iteration and diffuses/decays
//   the trail by a fixed amount each iteration, so this scene runs a
//   fixed-rate stepper (crawlStepRate: STEP_RATE_MIN/MAX across the Crawl
//   speed setting plus Speed boost and Speed pump on top,
//   stepAccumulator's carry-over) in render(), rather than scaling every
//   rate by frame.time's dt the way physarum.ts's continuous model does. Each
//   step is diffuse -> sense/turn/move -> deposit, in that order, for the
//   same reason physarum.ts keeps that order (a deposit is never blurred in
//   the step it lands — see that file's header) — just repeated up to
//   MAX_STEPS_PER_FRAME times when a slow frame owes the sim more than one
//   step, and skipped (composite-only) on a frame that owes none. A frame
//   that owes far more steps than the cap drops the backlog rather than ever
//   catching up in one burst (stepAccumulator's own comment).
//
// Turning: an agent samples its own weighted sum straight ahead and to each
// side, at its own STRAINS entry's fixed sensor angle and its own live
// Sensor range. Centre strongest holds course; centre weakest (both sides
// beat it) turns its own live Turn angle in a random direction; anything
// else turns toward whichever side read stronger. Reseeding on a beat reads
// the driver the way Caustics' Beat ripple does (standout.ts's
// StandoutTrigger: a climb that stands out from the everyday ones, with
// Dose's own "Dose threshold" jack and graph line) behind physarum.ts's own
// reseed refractory, but doesn't scatter the chosen agents across the whole field
// the way physarum.ts's reseed does: they drop into a small disc (the
// "Spread" setting's radius) around one hash-chosen point per epoch, so a
// beat reads as a new colony visibly sprouting from a point rather than a
// field-wide reseed. A reseeded agent's strain never changes — only where
// it is and which way it's facing resets ("Auto-inject from" can still
// restrict which strain gets picked in the first place).
//
// Per-strain settings and the Strains panel (2026-09-27): every strain got
// its own Nutrient/Sensor range/Turn angle/Speed/Excitability/Stain controls
// (src/render/sceneItems.ts's `defineItems`, family "strain") plus a full
// Affinity matrix (`defineItemPairs`, `att<i><j>`, defaulting to
// ATTRACT_ROWS) instead of the old fixed SPECIES/ATTRACT_ROWS/PALETTE
// constants and one shared "Band feed"/"Surge" pair. `panel` below (a
// `PanelSection` naming the `itemBoxes` widget) renders them as specimen
// boxes + the selected strain's rows + the Affinity block, inside the
// device menu's Scene card — see src/ui/widgets/itemBoxes.ts. STRAINS is now
// the one source of truth for a strain's *identity* (code, base colour, the
// fixed sensor-layout angle); its *motion and reactivity* are the generated
// settings, resolved live in JS each frame (see "Uniform budget" below) —
// LEGACY_MOTION exists only to derive the sensor/turn/stride sliders'
// defaults so the shipped look is unchanged (tests/physarum2.test.ts checks
// the round trip). Touch (`defineItemPairs`, `touch<i><j>`, `diagonal:
// false` — a strain doesn't touch its own trail through this control,
// unlike Affinity's diagonal "own trail" pair) sits alongside Affinity: both
// are exempt from the device-wide scene master (`masterScale: false` — see
// sceneSettings.ts/autoTune.ts) since a signed relation value's meaning is
// its exact position. Touch has no panel UI of its own yet — see "Touch"
// below for what it does on the GPU.
//
// Uniform budget: a setting tagged `item` (sceneItems.ts) has no GLSL
// uniform of its own — SETTINGS_UNIFORMS_GLSL/DRIVE_GLSL below are built
// from NON_ITEM_SETTINGS only. Every per-strain effective value is instead
// resolved in JS each frame render() by `resolveStrainEffective` (below) —
// the one function that turns a strain's stored setting values plus its live
// drive readings into motion (sensor distance, turn angle, step length,
// already surge-multiplied), a deposit multiplier and a stain-shifted colour,
// all in the same reference-texel units SIM_FRAG works in. `resolveStrains`
// calls it once per strain per frame for the GPU packing below; the specimen
// boxes' live pure-culture previews (`physarum2Preview.ts`,
// `src/ui/widgets/previews.ts`) call the exact same function from the device
// menu's own live setting/drive reads, so a box can never show a strain
// behaving differently than the strain actually does in the main dish. Packed
// into plain vec4/vec3 uniform arrays every program already declared:
// `uSpecies[4]` (sensor angle, sensor distance, rotation, step — the step
// already includes Excitability's beat-surge multiplier, so SIM_FRAG never
// needs a separate per-strain surge uniform), `uAttractRow[4]` (arrives
// already Cross-smell-scaled — `smellWeight` in physarum2Affinity.ts folds
// Cross-smell in once per strain in `resolveStrains`, so SIM_FRAG just reads
// the row straight; `uRivalry` itself stays declared, a plain non-item
// setting still uploaded generically, but SIM_FRAG no longer reads it),
// `uStrainFeed` (deposit multiplier per strain) and `uStrainColor[4]` (the
// composite's per-strain colour, after any Stain hue shift). Touch adds two
// more, both built by `packTouch` (physarum2Affinity.ts) from that frame's
// `touch<i><j>` values: `uTouchFeedRow[4]` (the deposit vertex shader — what
// a strain's own deposit adds to every strain's trail) and `uEatCol[4]` plus
// `uEatOn` (DIFFUSE_FRAG — the diffuse's per-channel decay against last
// step's footprint). Item settings still have no uniforms of their own.
//
// Touch (2026-09-27): `touch<i><j>` lets a strain feed or eat another
// strain's trail as it steps, independent of Affinity's sensing. Feeding
// needs no new pass: it's folded straight into the deposit's colour, as an
// extra row (`uTouchFeedRow`) added to the plain onehot the deposit already
// wrote — at touch = 0 the row IS onehot, so the deposit is bit-identical to
// the no-Touch scene. Eating needs one more render target, the "footprint"
// (a second RGBA8 attachment on the deposit draw, counting each strain's
// landings per texel — see the file header above and the DIFFUSE_FRAG
// eating block), consumed by the *next* step's diffuse pass. This (MRT on
// the existing deposit draw) was chosen over a second, separate multiply
// draw over the agents because the deposit's cost is almost entirely the
// per-point vertex/raster work on hundreds of thousands of randomly ordered
// agents (docs/scenes/physarum2.md, Measurements) — repeating that work for
// a second draw would cost nearly as much as the whole deposit again, where
// MRT shares it and only adds a second blended write per fragment. The
// footprint texture and both `depositFbo`s are built lazily
// (`ensureFootprintTargets`), only the first time `packTouch` reports
// something actually eats (`eatOn`) — so the default scene, and any
// feed-only table (a "Gardens"-style preset), never allocates the second
// attachment or touches the extra code path at all. `TOUCH_FEED_GAIN`/
// `TOUCH_EAT_GAIN`/`TOUCH_MAX_BITE` (physarum2Affinity.ts) are the only
// tuning constants, shared with the Affinity pads' own CPU preview cultures
// once those exist, so a pad's preview and the main dish read the same
// gains. The deposit draw itself runs one of two programs built from the
// same template (`depositVertSrc`/`depositFragSrc`, keyed by `mrt`):
// `depositProgMrt` (the footprint varying/output above) only while `eatOn`,
// and `depositProg` — the plain single-output shader, identical otherwise —
// every other step. A 2026-09-27 perf follow-up found the footprint
// varying/output alone cost the common (no-Touch) path ~5-10% of a step's
// time across 800k points even at touch = 0, hence the split.
//
// Render: black background; each channel's trail goes through a fixed
// exposure and a 1/2.2 gamma before being weighted by its strain's own
// colour (uStrainColor) and summed — Fogleman's own render step (see the
// links above), reproduced with our own colours and exposure curve rather
// than his. The final clamp is a hard min(), not physarum.ts's softer
// Reinhard roll-off — that's what keeps the strains reading as discrete,
// saturated territories instead of bleeding toward white where they overlap.
//
// Fogleman's extras (2026-10-02) — more ideas from studying his repo, each
// written independently and each its own control (the scene record's
// Decisions entry has why):
//
// - **Auto level** (`level`): his renderer scales each species' grid to its
//   own brightness range before colouring. Here LEVEL_FRAG max-pools the
//   trail into LEVEL_SIDE² blocks, read back as one part of the same census
//   as Territory (createPixelReadback, kickCensus) — but on every device while `level` is
//   above 0, since it changes the picture. levelPeaks/levelGainsFull turn
//   that into one gain per strain that evens their brightest roads out
//   around the geometric mean (so Exposure still owns the overall
//   brightness), glided over LEVEL_TAU and blended in by the setting
//   (`uLevelGain`, exactly 1 at 0).
// - **Wander** (`wander`): his alternative, unused turn rule picks among the
//   directions at random, weighted by how much stronger each reads. A
//   `uWander` share of agent-steps take SIM_FRAG's weightedTurn instead of
//   the strongest-wins rule; at 0 the old rule runs exactly.
// - **Start ink** (`startInk`) and **Fresh dish** (command("fresh")): his
//   grids start as random noise, not black. ensureTrailTargets fills a new
//   trail with fillStartInk's uniform roll; Fresh dish reseeds every agent
//   (seedAgents) and refills the trail on the next render(), phone-local
//   like Rebalance.
// - Random Smell/Touch and random motion/colour live in the panel rather
//   than here: physarum2Affinity.ts's `randomSmell`/`randomTouch` (the Pairs
//   card's half of the Strains card's one Random), and the Strain Console's
//   mix row (MOTION_PRESETS below, its Random) and colour row
//   (physarum2Synergy.ts's Shuffle/New palette, which only write the stains).
//
// Phase 3 (2026-09-27): probe()/command() (scene.ts) — phone-local, cheap,
// never reaching the TV — give the device menu's Strains widget three more
// things without a second settings system:
//
// - **Territory** per strain: SIM_FRAG's trail, box-downsampled by
//   TERRITORY_FRAG into a 16x16 RGBA8 target, read back through a
//   PIXEL_PACK_BUFFER + fenceSync (never a synchronous readPixels — see
//   createPixelReadback) at most every TERRITORY_INTERVAL_MS, and only
//   while probe() has actually been called within PROBE_IDLE_MS (a closed
//   panel or the TV never triggers a single readback). `classifyTerritory`
//   (pure, tested) turns the 256 texels into a share per strain — the cells
//   where that strain's channel reads largest, above TERRITORY_THRESHOLD.
// - **Population** per strain (the Headcount): *measured* — POP_FRAG counts
//   the agents' strain channel into a POP_SIDE-square target of block fractions, read
//   back in the same census as Territory (`createPixelReadback`)
//   every POP_INTERVAL_MS while the panel is open *or* Switching is on
//   (recruiting reads the shares every step), and `populationFromBlocks`
//   (pure, tested) turns the blocks into shares. Since agents can change
//   strain on their own (Switching, below) it can no longer be tracked
//   analytically; `equalPopulation`/`applyInjection` still give the instant,
//   expected value right after a Rebalance or a pipette tap, until the next
//   readback lands.
// - **Switching** (Headcount): SIM_FRAG lets an agent join the strain whose
//   ink *per agent* under it outweighs its own — see SWITCH_MAX's comment
//   for the rule and why it is per agent. The split between strains is a
//   result of the other settings (Nutrient, Trail life, Sensor range, …),
//   not a setting; `switching` only says how readily agents move, 0 keeping
//   every agent in its strain.
// - **command("inject", {x,y,strain})**: x,y are 0..1 in the *screen* space
//   of this device's own viewport (the same space SIM_FRAG's fragment
//   coordinates start from before roomUv/coverUv) — `screenToFieldUv` (a pure
//   JS twin of PHYSARUM2_GLSL's roomAspect()/coverUv(), with `uncoverUv` as
//   its exact inverse) maps that tap through the last viewport/resolution
//   this scene actually rendered at into field space, queuing a one-shot the
//   next render() applies on its first SIM step: agents chosen by the
//   existing per-agent hash, with probability the "seed" (Dose) setting's
//   *stored* amount (no drive — the drive only decides the automatic
//   trigger, see GLOBAL_SETTINGS below), move into a disc of radius
//   "seedSpread" around the point and are converted to `strain`. The
//   automatic beat-triggered reseed shares the same disc-placement code but
//   never converts species (`seedFrom` restricts which strain it may move
//   agents *from*, matching the "Physarum Lab" prototype's own rule that
//   auto-injection keeps strains).
// - **command("rebalance")**: a one-shot SIM pass setting every agent's
//   species back to its texel index mod SPECIES_COUNT — the exact
//   distribution seedAgents() starts from.
// - **command("fresh")**: Fresh dish — see "Fogleman's extras" above.
// - **command("spotlight", {a,b})**: while an Affinity pad is touched, the
//   pairs widget (pairPads.ts) sends its two strains here every tick and the
//   composite dims the other strains' trails to SPOT_DIM (eased over
//   SPOT_EASE_MS by `easeSpot`), so the person sees what that pair is doing.
//   `a < 0` clears. The spotlight only lasts SPOT_HOLD_MS past the last
//   message, so a closed panel or a lost pointer can never leave the dish
//   dimmed. Phone-local like every command: the pop-out output and a TV never
//   get it (src/net/outputSync.ts carries settings and stores, not commands).
const ID = "physarum2";

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

/** A strain's fixed identity — code, base render colour, and the sensor
 *  *layout* angle (how far apart its left/right sensors sit) it was hand-
 *  picked with. Everything about a strain's *motion* (sensor range, turn
 *  angle, speed) and *reactivity* (nutrient, excitability, stain) is a
 *  generated per-strain setting instead — see the file header. */
interface StrainConfig {
  readonly code: string;
  readonly color: readonly [number, number, number];
  readonly sensorAngleRad: number;
}

/** Codes are lab-isolate style, not nicknames — every strain is labelled
 *  this way everywhere (boxes, Affinity rows, the web, resets). Colours are
 *  additive-on-black and spread across hue so overlapping strains stay
 *  visually distinct rather than averaging toward white — our own choice,
 *  not Fogleman's palette. */
export const STRAINS: readonly StrainConfig[] = [
  { code: "PP-A1", color: [1.0, 0.3, 0.28], sensorAngleRad: 22 * DEG }, // long flowing highways
  { code: "PP-B2", color: [1.0, 0.72, 0.1], sensorAngleRad: 60 * DEG }, // reticulated mesh
  { code: "PP-C3", color: [0.05, 0.78, 0.7], sensorAngleRad: 95 * DEG }, // coarse cells / spots
  { code: "PP-D4", color: [0.5, 0.36, 1.0], sensorAngleRad: 35 * DEG }, // fine fuzz / labyrinth
];

/** How many independent strains/trail channels this scene runs — see the
 *  file header. Everything else here (packing, uniform array sizes, the
 *  attraction table's shape) is keyed to this rather than a repeated
 *  literal. */
export const SPECIES_COUNT = STRAINS.length;

/** Cap on the square trail map's side, and the floor physarum2TrailSide
 *  clamps to for a degenerate agent count. */
export const TRAIL_SIDE_CAP = 1024;
export const TRAIL_SIDE_MIN = 32;

/** Agents per trail texel the map is sized to hold — see physarum.ts's own
 *  AGENTS_PER_TEXEL for why density, not screen size, decides this. */
export const AGENTS_PER_TEXEL = 1.0;

/** Agents are cheap relative to the trail map, and Fogleman's own renders
 *  run far more of them than pixels on screen — so this scene seeds more
 *  agents than quality.maxParticles alone would give a particle scene. */
export const AGENT_MULTIPLIER = 4;

/** Side of the square trail map for `agentCount` agents, clamped to
 *  [TRAIL_SIDE_MIN, maxSide]. Pure and tested so the sizing holds at every
 *  quality preset without a GL context — physarum.ts's own trailSide, sized
 *  for this scene's own AGENTS_PER_TEXEL. */
export function physarum2TrailSide(agentCount: number, maxSide: number): number {
  const count = Number.isFinite(agentCount) && agentCount > 0 ? agentCount : 0;
  const cap = Number.isFinite(maxSide) && maxSide > 0 ? Math.floor(maxSide) : TRAIL_SIDE_MIN;
  const raw = Math.round(Math.sqrt(count / AGENTS_PER_TEXEL));
  return Math.max(1, Math.min(cap, Math.max(TRAIL_SIDE_MIN, raw)));
}

/** Steps per second the fixed-rate stepper runs at across the Crawl speed
 *  setting — see the file header for why this scene steps at a fixed rate
 *  rather than scaling every rate by dt. */
const STEP_RATE_MIN = 30;
const STEP_RATE_MAX = 120;

/** Ceiling on how many simulation steps one rendered frame can run —
 *  stepAccumulator's own comment covers why a frame owing more than this
 *  drops the backlog instead of ever catching up in one burst. */
export const MAX_STEPS_PER_FRAME = 3;

/** Fixed-rate step accumulator: given the elapsed dt and the Crawl-speed-
 *  mapped step rate, returns how many simulation steps render() should run
 *  this frame (capped at MAX_STEPS_PER_FRAME) and the accumulator's next
 *  value. Backlog past the cap is dropped rather than carried forward — a
 *  backgrounded tab that resumes after minutes away would otherwise try to
 *  run thousands of steps in its first frame back. Pure and tested. */
export function stepAccumulator(prevAcc: number, dt: number, stepRate: number): { steps: number; acc: number } {
  const acc0 = Number.isFinite(prevAcc) ? prevAcc : 0;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const rate = Number.isFinite(stepRate) && stepRate > 0 ? stepRate : 0;
  let acc = acc0 + d * rate;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc));
  acc -= steps;
  if (acc > 1) acc = 0;
  return { steps, acc };
}

// --- Crawl speed, Speed boost and Speed pump: the same three-part pace as
// caustics.ts's Drift speed / Speed boost / Speed pump (see its header for the
// user's own "push acceleration in a car" brief), in steps/s instead of phase
// rate. Crawl speed is the base (STEP_RATE_MIN..STEP_RATE_MAX); the other two
// add straight on top of it, so each still moves the sim with the base parked
// at its slowest. Speed boost follows the music's level right now and drops
// back the moment it quietens; Speed pump has its own accumulating velocity
// (advanceCrawlPump) that each hit pushes up and that then coasts back down
// to the base. ---
/** Steps/s Speed boost adds at its full slider with its driver at 1. */
const CRAWL_LEVEL_GAIN = 60;
/** Speed pump's own accumulator: one hit's decaying envelope adds up to about
 *  CRAWL_PUMP_ACCEL * amount * (the envelope's area) steps/s, which then
 *  coasts back with time constant CRAWL_PUMP_RELEASE_SEC; CRAWL_PUMP_VEL_CAP
 *  keeps a dense run of hits from accumulating without bound. */
const CRAWL_PUMP_ACCEL = 220;
const CRAWL_PUMP_RELEASE_SEC = 1.5;
const CRAWL_PUMP_VEL_CAP = 60;
/** Hard ceiling on the summed rate. Past this the stepper only drops backlog
 *  (MAX_STEPS_PER_FRAME at 60 fps is 180 steps/s) and costs GPU for nothing. */
const STEP_RATE_CAP = 150;

export interface CrawlPumpState {
  vel: number;
}

export function createCrawlPumpState(): CrawlPumpState {
  return { vel: 0 };
}

/** Advances Speed pump's velocity in place: `input` (0..1, whatever the
 *  "speedPump" driver is wired to — a bass hit's decaying envelope by default)
 *  accelerates `vel` by `CRAWL_PUMP_ACCEL * amount * input * dtSec`, then `vel`
 *  decays exponentially toward 0 with time constant CRAWL_PUMP_RELEASE_SEC and
 *  is capped at CRAWL_PUMP_VEL_CAP. `amount` is the Speed pump slider (0..1);
 *  a maxed amount with no input still decays to 0 rather than holding a floor.
 *  Pure aside from `st`, exported so tests pin the accelerate/release shape. */
export function advanceCrawlPump(st: CrawlPumpState, dtSec: number, input: number, amount: number): void {
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  const x = Number.isFinite(input) ? Math.max(0, input) : 0;
  const a = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  st.vel += CRAWL_PUMP_ACCEL * a * x * dt;
  st.vel *= Math.exp(-dt / CRAWL_PUMP_RELEASE_SEC);
  if (st.vel > CRAWL_PUMP_VEL_CAP) st.vel = CRAWL_PUMP_VEL_CAP;
}

export interface CrawlRateInputs {
  /** The Crawl speed slider, 0..1. */
  speed: number;
  /** The Speed boost slider, 0..1. */
  boost: number;
  /** What Speed boost's driver reads right now, 0..1 (0 when unplugged). */
  level: number;
  /** advanceCrawlPump's `vel`, already scaled by the Speed pump slider. */
  pumpVel: number;
}

/** Steps per second: the Crawl speed base plus Speed boost's level term plus
 *  Speed pump's velocity, capped at STEP_RATE_CAP. Additive, like caustics.ts's
 *  driftRatePerSec, so boost and pump still move the sim with the base at its
 *  slowest. Pure and tested. */
export function crawlStepRate(s: CrawlRateInputs): number {
  const base = STEP_RATE_MIN + (STEP_RATE_MAX - STEP_RATE_MIN) * clamp01(s.speed);
  const level = CRAWL_LEVEL_GAIN * clamp01(s.boost) * clamp01(s.level);
  return Math.min(base + level + Math.max(0, s.pumpVel), STEP_RATE_CAP);
}

// --- command("spotlight") — see the file header. ---

/** How long a spotlight outlives the last `command("spotlight")` message. The
 *  pairs widget re-sends every tick while a pad is active, so this only ever
 *  matters when messages stop (panel closed, pointer lost). */
export const SPOT_HOLD_MS = 300;
/** What a strain outside the spotlit pair is multiplied by in the composite. */
export const SPOT_DIM = 0.15;
/** Time constant of the dim/undim glide (exponential). */
export const SPOT_EASE_MS = 120;

/** One frame of the spotlight glide: `cur` moves toward `target` by the
 *  exponential share of `dtMs` over `SPOT_EASE_MS` — frame-rate independent,
 *  never overshooting, unchanged for dt 0. Pure and tested. */
export function easeSpot(cur: number, target: number, dtMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / SPOT_EASE_MS);
  return cur + (target - cur) * k;
}

// --- "Spread"'s linear map onto the reseed/inject disc's radius (unit-
// square units) — see the file header for why this scene clusters a reseed
// instead of scattering it field-wide like physarum.ts's own beat seeding.
// Replaces the old fixed SEED_CLUSTER_RADIUS so the pipette (Phase 3) and
// the automatic beat reseed can share one live control. ---
const SEED_SPREAD_MIN = 0.02;
const SEED_SPREAD_MAX = 0.3;
/** The old fixed disc radius, before "seedSpread" existed — kept only to
 *  derive that setting's default (radiusToSeedSpreadSlider), so the shipped
 *  radius is unchanged. */
const LEGACY_SEED_CLUSTER_RADIUS = 0.12;
export function seedSpreadSliderToRadius(v: number): number {
  return lerp(SEED_SPREAD_MIN, SEED_SPREAD_MAX, v);
}
export function radiusToSeedSpreadSlider(r: number): number {
  return (r - SEED_SPREAD_MIN) / (SEED_SPREAD_MAX - SEED_SPREAD_MIN);
}

// --- Sensor/step geometry across the Network scale slider — multiplies
// every strain's own live Sensor range/Speed (below), never its fixed
// sensorAngleRad. ---
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.8;

// --- Sensor range/Turn angle/Speed sliders' linear maps, in the same
// reference-texel/degree units SIM_FRAG already worked in — see the file
// header's "Uniform budget" note. ---
const SENSOR_DIST_MIN = 2;
const SENSOR_DIST_MAX = 64;
const TURN_DEG_MAX = 120; // min is 0
const STRIDE_MIN = 0.2;
const STRIDE_MAX = 2;

// Sensor angle is a plain slider in degrees (right = a wider fan of sensors);
// its default per strain is that strain's own STRAINS.sensorAngleRad, so the
// shipped look is unchanged.
export const ANGLE_MIN_DEG = 5;
export const ANGLE_MAX_DEG = 120;
// Trail life: slider 0..1, right = the trail lasts longer. It scales the
// global Trail decay for this strain's channel by 2^(±LIFE_OCTAVES) across the
// slider, exactly 1 at the middle (LIFE_DEFAULT) so the default reproduces the
// shared decay.
const LIFE_OCTAVES = 1.5;
export const LIFE_DEFAULT = 0.5;
/** The multiplier on a strain's evaporation rate for a Trail life slider
 *  value — 1 at LIFE_DEFAULT, below 1 (slower evaporation) to the right. */
export function lifeToDecayMul(life: number): number {
  return Math.pow(2, (LIFE_DEFAULT - clamp01(life)) * 2 * LIFE_OCTAVES);
}

// Headcount: the split of agents between strains is a result, not a setting.
// Each step an agent, with probability SWITCH_MAX * Switching, compares the
// ink under it *per agent* (a strain's trail there divided by its share of the
// headcount, so a big strain has to earn its size); if another strain's beats
// its own by SWITCH_MARGIN it joins that strain, provided that ink is at least
// SWITCH_MIN_INK (trail units). No strain is left below SWITCH_FLOOR of the
// agents: nobody leaves one at the floor, and a strain's share is never
// divided by less than it. Comparing raw ink instead snowballed one strain to
// 88% (docs/scenes/physarum2/scripts/recruit.mjs is the headless check of this
// rule). The shares come from a GPU count (POP_FRAG, read back a few times a
// second) — not tracked in JS, since a strain can now change under any agent.
export const SWITCHING_DEFAULT = 0.4;
const SWITCH_MAX = 0.05;
const SWITCH_MARGIN = 1.5;
export const SWITCH_FLOOR = 0.04;
const SWITCH_MIN_INK = 0.03;
// How hard a strain's size counts against its ink: ink is divided by
// (share * strains)^SWITCH_PRESSURE. At 1 (the prototype's plain "ink per
// agent") a strain that lays a dense trail on this GPU dish (Turn/Sensor range
// packed tight) still ended near 50% and another sat on the floor; 2 makes the
// split settle on roughly the square root of each strain's ink density instead.
const SWITCH_PRESSURE = 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function sensorSliderToDist(v: number): number {
  return lerp(SENSOR_DIST_MIN, SENSOR_DIST_MAX, v);
}
export function distToSensorSlider(d: number): number {
  return (d - SENSOR_DIST_MIN) / (SENSOR_DIST_MAX - SENSOR_DIST_MIN);
}
export function turnSliderToDeg(v: number): number {
  return v * TURN_DEG_MAX;
}
export function degToTurnSlider(deg: number): number {
  return deg / TURN_DEG_MAX;
}
export function strideSliderToDist(v: number): number {
  return lerp(STRIDE_MIN, STRIDE_MAX, v);
}
export function distToStrideSlider(d: number): number {
  return (d - STRIDE_MIN) / (STRIDE_MAX - STRIDE_MIN);
}

/** This scene's motion before per-strain sliders existed — kept only to
 *  derive the Sensor range/Turn angle/Speed settings' defaults below (via
 *  distToSensorSlider/degToTurnSlider/distToStrideSlider), so the shipped
 *  default motion is the same as it always was
 *  (tests/physarum2.test.ts's own round-trip check). Not itself a source of
 *  truth for anything at render time. */
const LEGACY_MOTION: readonly { sensorDist: number; turnDeg: number; strideDist: number }[] = [
  { sensorDist: 30, turnDeg: 40, strideDist: 1.4 },
  { sensorDist: 12, turnDeg: 35, strideDist: 0.9 },
  { sensorDist: 45, turnDeg: 100, strideDist: 1.8 },
  { sensorDist: 5, turnDeg: 20, strideDist: 0.45 },
];

// --- How much harder a beat lengthens each strain's step — Excitability's
// own gain, same magnitude the old shared "Surge" setting used (the scene
// record has that history). ---
const SURGE_GAIN = 6.0;

// --- The Sensor range/Turn angle/Speed/Stain drive formula (see the file
// header): each strain's own band (STRAIN_BAND_SIGNALS below, same as its
// own Nutrient) nudges it toward 1 by default now, rather than sitting
// inert until patched — caustics.ts's own `breathe` pattern, read in JS
// instead of GLSL. Identity at drive 0 either way (eff === v), so an
// unplugged jack (or a muted source) still leaves a strain's own look
// exactly where its slider puts it. ---
const PUSH_GAIN = 0.7;
// Per-item gain (SceneSetting.drive.gain) for the Sensor range/Turn
// angle/Speed and Stain jacks' own per-strain band default: tames a
// sustained band level (anim.low/mid/high/energy can sit near 1 through a
// whole loud passage) before it reaches pushToward1/the stain shift below,
// so the default reads as a nudge rather than pinning every strain toward 1
// (or rotating a strain off its own identity colour) for as long as the
// band stays loud. Tuned from side-by-side frames against the pre-jack look —
// the scene's record has the rejected values and what they did.
const MOTION_JACK_GAIN = 0.15; // Sensor range/Turn angle/Speed
const STAIN_JACK_GAIN = 0.2; // Stain
/** Stain's own drive gain — a patched source shifts hue by up to this many
 *  turns on top of the stored shift. */
const STAIN_DRIVE_GAIN = 0.18;

function pushToward1(v: number, drive: number): number {
  return v + (1 - v) * PUSH_GAIN * drive;
}

// --- Trail decay, per *step* (see the file header) — the Trail decay
// setting's range, and the small per-step floor that keeps 8-bit evaporation
// monotone (physarum.ts's file header covers why a bare multiply stalls). ---
const DECAY_MIN = 0.04;
const DECAY_MAX = 0.25;
const EVAP_FLOOR = 0.6 / 255;
/** Dither amplitude on the trail write, in quantisation steps. */
const EVAP_DITHER = 1.0;

// --- Deposit, per step (not per second — see the file header): a fixed
// amount every agent lays down, times how much its own strain's Nutrient
// setting scales it. Sized so a texel a trail keeps reinforcing settles well
// below saturation before the exposure curve below, the same budget
// reasoning as physarum.ts's DEPOSIT_FLOOR_RATE/DEPOSIT_GAIN_RATE. ---
/** Exported for physarum2Preview.ts's callers: a preview computes its own
 *  absolute per-step deposit as `DEPOSIT * StrainEffective.feed`, the same
 *  product DEPOSIT_FRAG bakes in as a GLSL constant times `strainFeedFor(k)`. */
export const DEPOSIT = 0.03;
const FEED_BASE = 0.35;
const FEED_GAIN = 1.65;
/** Nutrient's own rest — passed as `drives.value`/`ctx.driveValue`'s third
 *  argument everywhere Nutrient's drive is read (resolveStrains below,
 *  src/ui/widgets/previews.ts's own Strains preview), so an unplugged jack
 *  (or every source muted) reads as exactly this instead of drives.ts's
 *  plain rest of 0: `feed = lerp(1, FEED_BASE + FEED_GAIN * NUTRIENT_REST,
 *  raw.nutrient) === 1` for every raw.nutrient (solving FEED_BASE +
 *  FEED_GAIN * x = 1 for x). Rest 0 made `feed` run backwards — a raised
 *  slider laid down LESS trail (feed sliding toward FEED_BASE, not staying
 *  at 1) the moment its jack was unplugged. */
export const NUTRIENT_REST = (1 - FEED_BASE) / FEED_GAIN;

// --- Composite exposure and gamma — Fogleman's own render step (file
// header), our own numbers. ---
const GLOW_MIN = 0.45;
const GLOW_MAX = 2.2;
const FLASH_GAIN = 1.2;
const GAMMA_INV = 1 / 2.2;

// --- Auto level (the `level` setting, 2026-10-02): each strain's brightness
// scaled to its own range before the colours are summed, after the
// per-channel auto-levelling in Fogleman's renderer (file header, "Auto
// level"). LEVEL_FRAG max-pools the trail into LEVEL_SIDE² blocks; levelPeaks
// takes, per strain, the block peak that LEVEL_TOP_SHARE of blocks reach; and
// levelGainsFull evens those peaks out around their geometric mean, so the
// strains match each other while Exposure keeps setting how bright the dish
// is overall. The setting blends from 1 (off) to that gain in log space. ---
export const LEVEL_SIDE = 64;
/** Share of blocks whose peak sets a strain's level — its brightest roads,
 *  not one hot texel (a reseed burst, a crossing). */
export const LEVEL_TOP_SHARE = 0.05;
/** A strain with almost no trail (extinct, or just reseeded) reads its peak
 *  as at least this, so its gain can't blow the dither floor up into grain. */
export const LEVEL_PEAK_FLOOR = 0.08;
export const LEVEL_GAIN_MIN = 0.35;
export const LEVEL_GAIN_MAX = 3;
/** Time constant, seconds, of the glide toward a new level — a readback
 *  lands every LEVEL_INTERVAL_MS, and the picture shouldn't step with it. */
const LEVEL_TAU = 0.8;
const LEVEL_INTERVAL_MS = 250;
/** The `level` setting's default. */
export const LEVEL_DEFAULT = 0.5;

/** Per strain, the block peak (0..1) that `topShare` of LEVEL_FRAG's blocks
 *  reach or exceed — a histogram walk over the RGBA8 buffer, no sort. Pure
 *  and tested on a synthetic buffer. */
export function levelPeaks(buf: ArrayLike<number>, cellCount: number, count: number, topShare = LEVEL_TOP_SHARE): number[] {
  const need = Math.max(1, Math.ceil(cellCount * topShare));
  const peaks: number[] = [];
  const hist = new Uint32Array(256);
  for (let k = 0; k < count; k++) {
    hist.fill(0);
    for (let i = 0; i < cellCount; i++) hist[buf[i * 4 + k] ?? 0]!++;
    let seen = 0;
    let v = 255;
    for (; v > 0; v--) {
      seen += hist[v]!;
      if (seen >= need) break;
    }
    peaks.push(v / 255);
  }
  return peaks;
}

/** Per strain, the gain that brings its level peak to the peaks' geometric
 *  mean — every strain's brightest roads equally bright, the dish as a whole
 *  no brighter or darker — clamped to [LEVEL_GAIN_MIN, LEVEL_GAIN_MAX]. What
 *  Auto level 1 applies; the setting blends from 1 toward it (`levelGain`). */
export function levelGainsFull(peaks: readonly number[]): number[] {
  const p = peaks.map((v) => Math.max(LEVEL_PEAK_FLOOR, Number.isFinite(v) ? v : 0));
  const mean = Math.exp(p.reduce((a, v) => a + Math.log(v), 0) / Math.max(1, p.length));
  return p.map((v) => Math.max(LEVEL_GAIN_MIN, Math.min(LEVEL_GAIN_MAX, mean / v)));
}

/** A strain's composite gain at Auto level `level`: exactly 1 at 0 (the
 *  shared Exposure alone), `full` at 1, a log-space blend between. */
export function levelGain(full: number, level: number): number {
  const l = clamp01(level);
  return l === 0 ? 1 : Math.pow(full, l);
}

// --- Start ink (the `startInk` setting, 2026-10-02): a fresh dish's trail
// starts as random ink rather than black, as Fogleman's grids do, so a
// network condenses out of it within the first steps instead of growing
// from nothing. START_INK_MAX is the top of one channel's uniform roll at
// startInk 1, in trail units (the record's Measurements has where a busy
// road's level peak sits). ---
const START_INK_MAX = 0.25;
/** The `startInk` setting's default. */
export const START_INK_DEFAULT = 0.15;

/** Fills an RGBA8 trail buffer with a fresh dish's ink: each live channel an
 *  independent uniform roll over [0, startInk * START_INK_MAX). All zero at
 *  startInk 0 — the old black start, exactly. `rnd` is injected so tests can
 *  seed it. */
export function fillStartInk(out: Uint8Array, count: number, startInk: number, rnd: () => number): void {
  out.fill(0);
  const top = clamp01(startInk) * START_INK_MAX * 255;
  if (top <= 0) return;
  for (let i = 0; i < out.length; i += 4) {
    for (let k = 0; k < count; k++) out[i + k] = Math.floor(rnd() * top);
  }
}

/** A fast seeded generator for the start-ink fill — a full-size dish needs
 *  millions of rolls, too many for Math.random at scene open. */
function xorshift32(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** Composite smoothing kernel: how much of a channel's read comes from the
 *  centre texel versus each of its four neighbours — physarum.ts's own
 *  SMOOTH_CENTER/SMOOTH_SIDE, for the same reason (a fresh deposit is still
 *  a sharp single texel when this reads it). Sums to one. */
const SMOOTH_CENTER = 0.44;
const SMOOTH_SIDE = 0.14;

// ---------------------------------------------------------------------
// Colour: an HSL hue rotation over a strain's fixed base colour, for the
// Stain setting. See hueRotateRGB's own doc comment for why shift===0 is a
// hard identity rather than a round trip through HSL.
// ---------------------------------------------------------------------

function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** Rotates `rgb`'s hue by `shift` (turns, wrapping) — the Stain setting's
 *  live colour shift over a strain's base colour. `shift === 0` returns
 *  `rgb` completely unchanged, without any HSL round trip — the identity an
 *  unplugged or silent Stain (raw 0, drive 0) still needs to hold exactly,
 *  rather than whatever precision an RGB->HSL->RGB conversion happens to
 *  leave (tests/physarum2.test.ts checks this identity). */
export function hueRotateRGB(rgb: readonly [number, number, number], shift: number): [number, number, number] {
  if (shift === 0) return [rgb[0], rgb[1], rgb[2]];
  const [h, s, l] = rgbToHsl(rgb);
  const hh = (((h + shift) % 1) + 1) % 1;
  return hslToRgb(hh, s, l);
}

function cssColor([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ---------------------------------------------------------------------
// The one strain-motion mapping — see the file header's "Uniform budget".
// Called by resolveStrains (this file's GPU packing) and by the specimen
// boxes' live pure-culture previews (src/ui/widgets/previews.ts), so a box
// can never show a strain behaving differently than it does in the main
// dish. Every distance here is in reference-texel units — the same
// resolution-independent space SIM_FRAG's uSpecies/uStrainFeed already work
// in (a caller converts to its own field's cell size with one documented
// constant — physarum2Preview.ts's REF_TEXELS_PER_PREVIEW_CELL). Doesn't
// touch the Network scale setting (a global multiplier only the GPU shader
// applies) or the attraction table (a pure culture has no rival trail to
// sense).
// ---------------------------------------------------------------------

/** A strain's stored setting amounts for one frame — resolveSceneSetting's
 *  reading, before any drive is applied. */
export interface StrainRawValues {
  nutrient: number;
  excite: number;
  sensor: number;
  turn: number;
  stride: number;
  stain: number;
  /** Sensor angle in degrees. */
  angle: number;
  /** Trail life slider, 0..1. */
  life: number;
}

/** A strain's live drive reading for each of the same controls — the GPU
 *  path reads `drives.value(key, sceneDefault, rest?)` (a per-strain band
 *  for every control but Excitability — STRAIN_BAND_SIGNALS —
 *  `anim.beatPulse` for Excitability; Nutrient alone passes NUTRIENT_REST as
 *  its own `rest`, since an unplugged jack there must read as exactly 1, not
 *  0 — see that constant's own doc); the preview reads
 *  `WidgetCtx.driveValue(spec, rest?)` the same way — see
 *  src/ui/widgets/registry.ts's header. */
export interface StrainDriveValues {
  nutrient: number;
  excite: number;
  sensor: number;
  turn: number;
  stride: number;
  stain: number;
  angle: number;
  life: number;
}

export interface StrainEffective {
  /** Radians — SIM_FRAG's `cfg.x`. */
  sensorAngleRad: number;
  /** Multiplier on the global Trail decay for this strain's channel —
   *  DIFFUSE_FRAG's `uLifeMul`. */
  decayMul: number;
  /** The Stain shift in turns (stored value plus drive), before Synergy —
   *  `color` below is the base colour rotated by exactly this. */
  stainShift: number;
  /** Reference-texel units — SIM_FRAG's `cfg.y`. */
  sensorDist: number;
  rotationRad: number;
  /** Reference-texel units per step, Excitability's surge multiplier already
   *  applied — SIM_FRAG's `cfg.w`. */
  stepDist: number;
  /** Deposit multiplier — SIM_FRAG's `strainFeedFor(k)`; a caller multiplies
   *  by DEPOSIT itself for an absolute per-step amount (the preview does; the
   *  GPU deposit shader bakes DEPOSIT in as a GLSL constant instead). */
  feed: number;
  /** Stain-shifted colour over STRAINS[k]'s own base colour. */
  color: readonly [number, number, number];
}

export function resolveStrainEffective(k: number, raw: StrainRawValues, drive: StrainDriveValues): StrainEffective {
  const strain = STRAINS[k]!;
  const feed = lerp(1, FEED_BASE + FEED_GAIN * drive.nutrient, raw.nutrient);
  const surge = 1 + raw.excite * drive.excite * SURGE_GAIN;
  const sensorEff = clamp01(pushToward1(raw.sensor, drive.sensor));
  const sensorDist = sensorSliderToDist(sensorEff);
  const turnEff = clamp01(pushToward1(raw.turn, drive.turn));
  const rotationRad = turnSliderToDeg(turnEff) * DEG;
  const strideEff = clamp01(pushToward1(raw.stride, drive.stride));
  const stepDist = strideSliderToDist(strideEff) * surge;
  const stainShift = raw.stain + drive.stain * STAIN_DRIVE_GAIN;
  const color = hueRotateRGB(strain.color, stainShift);
  // Sensor angle is in degrees: pushed toward the widest angle the same way
  // the 0..1 controls are pushed toward 1, so drive 0 is the slider exactly.
  const angleSet = Math.max(ANGLE_MIN_DEG, Math.min(ANGLE_MAX_DEG, raw.angle));
  const angleUnit = pushToward1((angleSet - ANGLE_MIN_DEG) / (ANGLE_MAX_DEG - ANGLE_MIN_DEG), drive.angle);
  const sensorAngleRad = (ANGLE_MIN_DEG + clamp01(angleUnit) * (ANGLE_MAX_DEG - ANGLE_MIN_DEG)) * DEG;
  const decayMul = lifeToDecayMul(clamp01(pushToward1(clamp01(raw.life), drive.life)));
  return { sensorAngleRad, decayMul, stainShift, sensorDist, rotationRad, stepDist, feed, color };
}

// ---------------------------------------------------------------------
// Population bookkeeping (Phase 3): tracked analytically in JS, no GPU
// readback — see the file header. Pure and tested (tests/physarum2.test.ts).
// ---------------------------------------------------------------------

export function equalPopulation(count: number): number[] {
  return new Array(count).fill(1 / count);
}

/** The measured headcount: POP_FRAG writes, per block of agent texels, the
 *  fraction of that block in each strain (RGBA8, channel k = strain k);
 *  averaging every block and normalising gives each strain's share of all
 *  agents. Falls back to an equal split for an empty/all-zero buffer. Pure and
 *  tested on a synthetic buffer. */
export function populationFromBlocks(buf: ArrayLike<number>, cellCount: number, count: number): number[] {
  const sums = new Array<number>(count).fill(0);
  for (let i = 0; i < cellCount; i++) for (let k = 0; k < count; k++) sums[k]! += (buf[i * 4 + k] ?? 0) / 255;
  const total = sums.reduce((a, b) => a + b, 0);
  return total > 0 ? sums.map((v) => v / total) : equalPopulation(count);
}

/** `pop_k <- pop_k*(1-d) + (k===strain ? d : 0)` — matches, in expectation,
 *  what SIM_FRAG's inject pass actually does: a uniform-random `d` share of
 *  ALL agents (regardless of their current species) is moved into `strain`,
 *  so every strain (including `strain` itself) keeps `(1-d)` of its own
 *  share and `strain` alone gains the `d` that left everyone. `dose` is
 *  clamped to [0,1] and treated as 0 if non-finite, so a stale/garbage
 *  reading never pushes a population share out of [0,1]. */
export function applyInjection(pop: readonly number[], strain: number, dose: number): number[] {
  const d = Number.isFinite(dose) ? Math.max(0, Math.min(1, dose)) : 0;
  return pop.map((p, k) => p * (1 - d) + (k === strain ? d : 0));
}

// ---------------------------------------------------------------------
// Territory classification (Phase 3): pure over a downsampled RGBA8 buffer
// — see the file header for the GPU-side downsample/readback this feeds.
// ---------------------------------------------------------------------

/** Below this (out of 255) a cell counts as background for every strain —
 *  small enough that a lightly-used route still classifies, large enough to
 *  exclude the evaporation dither floor's own noise (EVAP_DITHER/EVAP_FLOOR
 *  above) once averaged over a downsample block. */
export const TERRITORY_THRESHOLD = 6;

/** `territory_k` = share of `buf`'s cells (RGBA8, `cellCount` texels, `count`
 *  live channels) where channel k reads largest, strictly above
 *  TERRITORY_THRESHOLD — cells with no channel above threshold count toward
 *  nobody, so shares needn't sum to 1. Pure and tested on a synthetic buffer,
 *  no GL context needed. */
export function classifyTerritory(buf: ArrayLike<number>, cellCount: number, count: number): number[] {
  const counts = new Array(count).fill(0);
  for (let i = 0; i < cellCount; i++) {
    let bestK = -1;
    let bestV = TERRITORY_THRESHOLD;
    for (let k = 0; k < count; k++) {
      const v = buf[i * 4 + k] ?? 0;
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    if (bestK >= 0) counts[bestK]++;
  }
  return counts.map((c) => c / cellCount);
}

// ---------------------------------------------------------------------
// Screen -> field mapping (Phase 3's pipette): a pure JS twin of
// PHYSARUM2_GLSL's roomAspect()/coverUv() below, plus coverUv's exact
// mathematical inverse (uncoverUv) — see the file header's command("inject")
// paragraph. `viewport` matches Scene.render()'s own Viewport (scene.ts):
// vec4(x,y,w,h) in the GLSL comes out the same order here.
// ---------------------------------------------------------------------

export function roomAspectJs(resW: number, resH: number, viewport: Viewport): number {
  return (resW * viewport.h) / Math.max(resH * viewport.w, 1e-4);
}

export function roomUvJs(uv: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
  return { x: viewport.x + uv.x * viewport.w, y: viewport.y + uv.y * viewport.h };
}

export function coverUvJs(ruv: { x: number; y: number }, aspect: number): { x: number; y: number } {
  const s = Math.max(aspect, 1);
  const rectW = aspect;
  const rectH = 1;
  return { x: (ruv.x * rectW + (s - rectW) * 0.5) / s, y: (ruv.y * rectH + (s - rectH) * 0.5) / s };
}

/** coverUvJs's exact inverse: field-space uv back to room-space uv. Only
 *  used by tests/physarum2.test.ts's round-trip check — command("inject")
 *  only ever needs the forward direction. */
export function uncoverUvJs(fuv: { x: number; y: number }, aspect: number): { x: number; y: number } {
  const s = Math.max(aspect, 1);
  const rectW = aspect;
  const rectH = 1;
  return { x: (fuv.x * s - (s - rectW) * 0.5) / rectW, y: (fuv.y * s - (s - rectH) * 0.5) / rectH };
}

/** Screen-space uv (0..1 across this device's own viewport, matching
 *  SIM_FRAG's vUv) all the way to field-space uv — roomUvJs then coverUvJs,
 *  the exact chain the composite's own fragment shader runs to know which
 *  field texel a screen pixel shows. */
export function screenToFieldUv(uv: { x: number; y: number }, viewport: Viewport, resW: number, resH: number): { x: number; y: number } {
  return coverUvJs(roomUvJs(uv, viewport), roomAspectJs(resW, resH, viewport));
}

// ---------------------------------------------------------------------
// Settings: per-strain items (sceneItems.ts) + the remaining global rows.
// ---------------------------------------------------------------------

const BAND_LABELS = ["low", "mid", "high", "overall"] as const;
/** Each strain's own band, in strain order — reused for the Sensor
 *  range/Turn angle/Speed/Stain jacks' own default below (a strain's own
 *  band drives its own motion the same as it already drives its own
 *  Nutrient) and for Nutrient's own `sceneSources` (its Scene composite is
 *  honestly this same per-strain band). */
export const STRAIN_BAND_SIGNALS = ["anim.low", "anim.mid", "anim.high", "anim.energy"] as const;

const nutrientSettings = defineItems("strain", SPECIES_COUNT, {
  key: "nutrient",
  label: "Nutrient",
  description: "How much trail this strain lays down",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.6, // the old shared "Band feed" default
  drive: {
    default: "scene",
    sceneLabel: (k) => `Scene: ${BAND_LABELS[k]} level`,
    sceneSources: (k) => [STRAIN_BAND_SIGNALS[k]!],
  },
});

const exciteSettings = defineItems("strain", SPECIES_COUNT, {
  key: "excite",
  label: "Excitability",
  description: "How hard a hit lengthens this strain's step, throwing new branches",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.1, // the old shared "Surge" default
  // uBeatPulse directly, same as the old shared Surge setting — a plain
  // Beat default, but each strain's own patch can pick any source.
  drive: { default: "feature.onset" },
});

const sensorSettings = defineItems("strain", SPECIES_COUNT, {
  key: "sensor",
  label: "Sensor range",
  description: "How far ahead this strain smells — longer range grows bigger, smoother networks",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToSensorSlider(LEGACY_MOTION[k]!.sensorDist),
  // This strain's own band by default (STRAIN_BAND_SIGNALS, same signal as
  // its own Nutrient) — a loud band nudges the range out a little further;
  // pushToward1 is identity at drive 0, so an unplugged jack (or every
  // source muted) leaves the slider's own range exactly where it sits.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

const turnSettings = defineItems("strain", SPECIES_COUNT, {
  key: "turn",
  label: "Turn angle",
  description: "How sharply this strain turns toward a scent",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => degToTurnSlider(LEGACY_MOTION[k]!.turnDeg),
  // This strain's own band by default — a loud band nudges the turn a
  // little sharper; identity at drive 0, same reasoning as Sensor range.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

const strideSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stride",
  label: "Speed",
  description: "How far this strain moves each step, on top of the global Crawl speed",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToStrideSlider(LEGACY_MOTION[k]!.strideDist),
  // This strain's own band by default — a loud band nudges the speed a
  // little further; identity at drive 0, same reasoning as Sensor range.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

const stainSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stain",
  label: "Stain",
  description: "Colour shift over this strain's own base colour",
  group: "Form",
  min: -0.5,
  max: 0.5,
  step: 0.01,
  default: 0,
  // This strain's own band by default — a loud band shifts the hue a little
  // further. The additive `drive.stain*STAIN_DRIVE_GAIN` term
  // (resolveStrainEffective) is already 0 at drive 0, so an unplugged jack
  // leaves the slider's own shift alone.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: STAIN_JACK_GAIN },
});

// Sensor angle and Trail life got their jacks on 2026-10-04 (every lane in
// the Strain settings card has a port): this strain's own band by default,
// like Sensor range — a loud band widens the angle and lengthens the trail a
// little; identity at drive 0, same reasoning as Sensor range.
const angleSettings = defineItems("strain", SPECIES_COUNT, {
  key: "angle",
  label: "Sensor angle",
  description: "How wide apart this strain's left and right sensors look, in degrees — with Turn angle it decides the pattern it grows",
  group: "Form",
  min: ANGLE_MIN_DEG,
  max: ANGLE_MAX_DEG,
  step: 1,
  default: (k) => Math.round(STRAINS[k]!.sensorAngleRad / DEG),
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

const lifeSettings = defineItems("strain", SPECIES_COUNT, {
  key: "life",
  label: "Trail life",
  description: "How long this strain's trail lasts before it evaporates — more keeps its roads longer",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: LIFE_DEFAULT, // the shared Trail decay, unchanged
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

const attSettings = defineItemPairs("strain", SPECIES_COUNT, {
  key: "att",
  label: (i, j) => (i === j ? `${STRAINS[i]!.code} → own trail` : `${STRAINS[i]!.code} → ${STRAINS[j]!.code}`),
  description: "How strongly this strain is drawn to, or repelled by, each trail",
  group: "Form",
  min: -1.5,
  max: 1.5,
  step: 0.05,
  default: ATTRACT_ROWS,
  masterScale: false,
});

function attSpecAt(i: number, j: number): SceneSetting {
  return attSettings[i * SPECIES_COUNT + j]!;
}

// Off-diagonal only (diagonal: false) — a strain doesn't feed or eat its own
// trail through Touch, so `touchii` would otherwise sit as a permanently
// dead key in Looks, resets and share codes. See physarum2Affinity.ts's
// header and file header's "Touch" paragraph for what this feeds into.
const touchSettings = defineItemPairs("strain", SPECIES_COUNT, {
  key: "touch",
  label: (i, j) => `${STRAINS[i]!.code} touch ${STRAINS[j]!.code}`,
  description: "What this strain's steps do to that strain's trail — right feeds it, left eats it",
  group: "Form",
  min: -1.5,
  max: 1.5,
  step: 0.05,
  default: 0,
  diagonal: false,
  masterScale: false,
});

// Unlike attSpecAt, this can't be a flat `i*n+j` index — defineItemPairs
// skips the diagonal, so the list is 12 long, not 16, and the gaps aren't
// evenly spaced. Built once from each spec's own item tag instead.
const touchSpecGrid: (SceneSetting | undefined)[] = new Array(SPECIES_COUNT * SPECIES_COUNT).fill(undefined);
for (const spec of touchSettings) {
  touchSpecGrid[spec.item!.index * SPECIES_COUNT + spec.item!.other!] = spec;
}
function touchSpecAt(i: number, j: number): SceneSetting | undefined {
  return touchSpecGrid[i * SPECIES_COUNT + j];
}

const STRAIN_ITEM_SETTINGS: readonly SceneSetting[] = [
  ...nutrientSettings,
  ...exciteSettings,
  ...sensorSettings,
  ...turnSettings,
  ...strideSettings,
  ...stainSettings,
  ...angleSettings,
  ...lifeSettings,
  ...attSettings,
  ...touchSettings,
];

const GLOBAL_SETTINGS: SceneSetting[] = [
  // --- Form ---
  {
    key: "scale",
    label: "Network scale",
    description: "Sensor distance and step length together — how coarse or fine every strain's network grows",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy mix reads better on a finer network — physarum.ts's own scale.
    auto: { density: -0.25 },
  },
  {
    key: "decay",
    label: "Trail decay",
    description: "How fast an unused route evaporates for every strain at once",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { density: 0.2, tempo: 0.15 },
  },
  {
    key: "rivalry",
    label: "Cross-smell",
    description: "How strongly each strain reacts to the others' trails, whichever way its Smell pads point — 0 ignores them, 1 doubles them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.15 },
  },
  {
    key: "wander",
    label: "Wander",
    description:
      "How often an agent picks its turn by chance — weighted toward whichever way smells stronger — instead of always taking the strongest; more grows looser, softer networks",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    // 0 is the old rule exactly: SIM_FRAG's weighted branch is never taken.
    default: 0,
  },
  {
    key: "startInk",
    label: "Start ink",
    description:
      "How much random ink a fresh dish starts with, so the networks condense out of it at once instead of growing from black — used when the scene opens and on Fresh dish",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: START_INK_DEFAULT,
  },
  // --- Motion ---
  {
    key: "speed",
    label: "Crawl speed",
    description: "The base pace: how many simulation steps run per second before Speed boost and Speed pump add to it",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "speedBoost",
    label: "Speed boost",
    description: "The sim runs faster the louder the music is right now, and drops straight back to Crawl speed when it quietens",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.3, density: -0.15 },
    // Loudness by default; an unplugged jack adds nothing (rest 0), since
    // this only ever adds on top of Crawl speed.
    drive: { default: "anim.energy" },
  },
  {
    key: "speedPump",
    label: "Speed pump",
    description: "Each push accelerates the crawl like a gas pedal; the extra speed then coasts back down to Crawl speed",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Only reads as a pump on music with real hits to push against.
    auto: { pulse: 0.35, attack: 0.2 },
    // A kick is the natural pedal to push against; rewire it in the picker.
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "seed",
    label: "Dose",
    description: "Share of agents relocated into a fresh cluster — by a beat, or by the pipette in the Strains panel above",
    group: "Motion",
    // A finer step than this scene's usual 0.05: the reseed disc's area is
    // only a few percent of the trail map ("Spread", below), so this setting
    // is far more sensitive per unit than physarum.ts's own field-wide seed.
    step: 0.01,
    min: 0,
    max: 1,
    // Reseeded agents concentrate into one small disc rather than scattering
    // field-wide the way physarum.ts's own reseed does, so a much smaller
    // share already reads as a strong burst — this default is deliberately
    // far below physarum.ts's own 0.3 (measured against screenshots: 0.15
    // packed the disc dense enough to saturate solid white, and 0.03 in a
    // radius-0.06 disc still read as a white blob).
    default: 0.01,
    auto: { attack: 0.25, dynamics: 0.15 },
    // The trigger is a *climb* in the decaying beat pulse that stands out from
    // the everyday ones (standout.ts's StandoutTrigger, the same filter
    // Caustics' Beat ripple uses), so a busy passage reseeds only on its
    // clear hits instead of on every tick. Scene-handled threshold: the scene
    // owns the idea (drive.threshold, read back with drives.threshold), so the
    // engine's own generic gate stays out of it. command("inject") (the
    // pipette, Phase 3) reads this setting's plain stored amount too, with no
    // drive involved — the drive only ever gates the *automatic* trigger,
    // never the pipette's own one-shot command. See the file header.
    drive: {
      default: "scene",
      sceneLabel: "Scene: a beat hit that stands out",
      sceneSources: ["feature.onset"],
      threshold: {
        default: STANDOUT_THRESHOLD_DEFAULT,
        label: "Dose threshold",
        hint: "Moves the dotted line: how far a sound has to stand out from the everyday ones to start a new colony. Left: more colonies, even from quiet sounds. Right: only clear standouts.",
      },
    },
  },
  {
    key: "switching",
    label: "Switching",
    description:
      "How readily an agent joins the strain whose ink outweighs its own where it stands, so the headcount follows the settings — 0 keeps every agent in its strain",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: SWITCHING_DEFAULT,
  },
  {
    key: "seedSpread",
    label: "Spread",
    description: "Radius of the disc a beat's reseed, or the pipette's injection, lands agents in",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.02,
    // Reproduces the scene's old fixed disc radius (LEGACY_SEED_CLUSTER_RADIUS)
    // so the shipped look is unchanged.
    default: radiusToSeedSpreadSlider(LEGACY_SEED_CLUSTER_RADIUS),
  },
  {
    key: "seedFrom",
    label: "Auto-inject from",
    description: "Which strains the automatic beat trigger may move agents from — it never converts species (only the pipette does)",
    group: "Motion",
    type: "enum",
    options: ["All strains", ...STRAINS.map((s) => s.code)],
    min: 0,
    max: SPECIES_COUNT,
    step: 1,
    default: 0,
  },
  // --- Look ---
  {
    key: "glow",
    label: "Exposure",
    description: "Brightness of the four networks before the gamma curve",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.2 },
  },
  {
    key: "level",
    label: "Auto level",
    description:
      "Brings every strain's brightest roads to the same brightness, so a sparse or short-lived strain isn't drowned out by a dense one — 0 lights them all by Exposure alone",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: LEVEL_DEFAULT,
  },
  {
    key: "synergy",
    label: "Synergy",
    description:
      "Pulls the four stains toward the nearest colour harmony — 0 shows them as set, 1 snaps them onto it (the stains you set are kept)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps each strain's own colour; 1 recolours all of them with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
  // --- Post ---
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly (COMPOSITE_FRAG) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
];

const SETTINGS: SceneSetting[] = composeSettings(STRAIN_ITEM_SETTINGS, GLOBAL_SETTINGS);

/** Every non-`item` setting — the only ones with a GLSL uniform of their
 *  own (see the file header's "Uniform budget"). */
const NON_ITEM_SETTINGS = SETTINGS.filter((s) => !s.item);

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`physarum2: unknown setting ${key}`);
  return s;
}

// ---------------------------------------------------------------------
// Motion presets (2026-10-02): the Strain Console's preset pills — each sets
// every strain's MOTION_PARAMS at once, like a saved species config in
// Fogleman's viewer. Our own sets, picked from a headless random search over
// these same sliders (the scene record's Decisions entry); "Lab" is the
// shipped default motion.
// ---------------------------------------------------------------------

/** The per-strain params a motion preset (and the console's Random) sets. */
export const MOTION_PARAMS = ["sensor", "angle", "turn", "stride"] as const;

export interface MotionPreset {
  name: string;
  hint: string;
  /** Slider values, one per strain, for each of MOTION_PARAMS. */
  values: Readonly<Record<(typeof MOTION_PARAMS)[number], readonly number[]>>;
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    name: "Lab",
    hint: "The shipped motion: highways, a mesh, coarse cells and a fine fuzz.",
    values: {
      sensor: LEGACY_MOTION.map((m) => distToSensorSlider(m.sensorDist)),
      angle: STRAINS.map((s) => Math.round(s.sensorAngleRad / DEG)),
      turn: LEGACY_MOTION.map((m) => degToTurnSlider(m.turnDeg)),
      stride: LEGACY_MOTION.map((m) => distToStrideSlider(m.strideDist)),
    },
  },
  {
    name: "Cells",
    hint: "Round cells, each walled in by another strain's thin roads.",
    values: {
      sensor: [0.8, 0.16, 0.98, 0.38],
      angle: [17, 62, 84, 61],
      turn: [0.56, 0.4, 0.3, 0.94],
      stride: [0.12, 0.94, 0.22, 0.46],
    },
  },
  {
    name: "Coral",
    hint: "One strain grows thick branching worms through a dense ground.",
    values: {
      sensor: [0.38, 0.96, 0.52, 0.28],
      angle: [98, 15, 95, 107],
      turn: [0.56, 0.12, 0.68, 0.1],
      stride: [0.92, 0.64, 0.1, 0.04],
    },
  },
  {
    name: "Weave",
    hint: "Fine crossing fibres over soft pools of colour.",
    values: {
      sensor: [0.44, 0.18, 0.66, 0.44],
      angle: [17, 11, 64, 114],
      turn: [0.5, 0.06, 0.3, 0.6],
      stride: [0.92, 0.32, 1, 0.38],
    },
  },
  {
    name: "Islands",
    hint: "Big blotchy islands with a lacy sea between.",
    values: {
      sensor: [0.7, 0.72, 0.54, 0.84],
      angle: [79, 6, 82, 35],
      turn: [0.22, 0.9, 0.26, 0.02],
      stride: [0.06, 0.48, 0.68, 0.2],
    },
  },
  {
    name: "Grains",
    hint: "Short scattered grains, like seeds, on a soft ground.",
    values: {
      sensor: [0.02, 0.68, 0.46, 0.2],
      angle: [19, 30, 85, 119],
      turn: [0.02, 0.2, 0.28, 0.56],
      stride: [0.22, 0.62, 0.26, 0.72],
    },
  },
];

// ---------------------------------------------------------------------
// The panel: one Strains group (specimen boxes + the selected strain's
// rows + the Pairs pads) — see src/ui/widgets/itemBoxes.ts and, for the
// pads themselves, src/ui/widgets/pairPads.ts. `options` is typed `unknown`
// by PanelSection (scene.ts) precisely so this file, under src/render/,
// never has to import anything under src/ui/ — see sceneItems.ts's header
// for why that boundary matters. The Pairs block's words (`PAIR_WORDS`) and
// presets (`AFFINITY_PRESETS`, which replaces this scene's old, Smell-only
// `EXPERIMENT_PRESETS`) live in physarum2Affinity.ts instead of here, next
// to the pure pad logic that reads them.
// ---------------------------------------------------------------------

const PANEL: readonly PanelSection[] = [
  {
    widget: "itemBoxes",
    title: "Strains",
    items: "strain",
    // Switching and Synergy are drawn by the widget itself (under the
    // headcount bar and under the Strain Console's stains), so the Scene
    // card's flat list leaves them out.
    settings: ["switching", "synergy"],
    options: {
      labels: STRAINS.map((s) => s.code),
      colours: STRAINS.map((s) => cssColor(s.color)),
      headcountSetting: "switching",
      // The Strain Console card: every per-strain setting for all the strains
      // at once, a row of lanes each, with Stain Synergy under them — see
      // src/ui/widgets/strainConsole.ts. The order is the row order.
      console: {
        title: "Strain settings",
        params: ["nutrient", "excite", "sensor", "angle", "turn", "stride", "life", "stain"],
        formats: { angle: "degrees", stain: "turns" },
        // A Stain is a hue shift over the strain's own base colour, so each
        // lane's rail and the Synergy wheel need the base hue (turns).
        hue: { param: "stain", baseHues: STRAINS.map((s) => rgbToHsl(s.color)[0]) },
        synergy: { key: "synergy" },
        // Random rolls MOTION_PARAMS over their whole ranges, and
        // the pills are MOTION_PRESETS; Shuffle/New palette rewrite the
        // stains (strainConsole.ts's header).
        mix: { random: MOTION_PARAMS, presets: MOTION_PRESETS },
        colourActions: true,
      },
      // Phase 3's live pure-culture preview — src/ui/widgets/previews.ts's
      // registry id. itemBoxes.ts falls back to the old empty placeholder
      // swatch when a widget's options carry no preview id at all, so this
      // doesn't disturb any other itemBoxes-based scene.
      preview: "physarum2",
      relations: {
        title: "Affinity",
        tables: { smell: "att", touch: "touch" },
        shortLabels: STRAINS.map((s) => s.code.replace(/^PP-/, "")),
        words: PAIR_WORDS,
        presets: AFFINITY_PRESETS,
      },
    },
  },
];

const SETTINGS_UNIFORMS_GLSL = NON_ITEM_SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
const DRIVE_UNIFORMS_GLSL = DRIVE_GLSL(NON_ITEM_SETTINGS);

// Shared by every pass so the packing, the hashes, the strain decode and
// the room mapping can't drift apart between them.
const PHYSARUM2_GLSL = `
const int SPECIES_COUNT = ${SPECIES_COUNT};
const float TWO_PI = ${TWO_PI.toFixed(6)};
const float REF_FIELD = 1024.0;

// --- 16-bit fixed point over [0, range) — see physarum.ts's file header for
// why position and heading share this one-sided packing (packUnit, the JS
// side of this exact round trip, is imported from there). ---
vec2 packUnitR(float v, float range) {
  float u = floor(clamp(v / range, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}
float unpackUnitR(vec2 c, float range) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0 * range;
}

// --- hashes: the shared lattice-corner hash family (see noiseHash.ts). ---
${FLOAT_HASH_GLSL}

// Strain index k (0..SPECIES_COUNT-1) is packed into the direction
// texture's B channel as k/(SPECIES_COUNT-1) — see the file header.
int decodeSpecies(float b) {
  return int(floor(b * ${(SPECIES_COUNT - 1).toFixed(1)} + 0.5));
}

vec4 onehot4(int k) {
  if (k == 0) return vec4(1.0, 0.0, 0.0, 0.0);
  if (k == 1) return vec4(0.0, 1.0, 0.0, 0.0);
  if (k == 2) return vec4(0.0, 0.0, 1.0, 0.0);
  return vec4(0.0, 0.0, 0.0, 1.0);
}

ivec2 wrapTexel(ivec2 t, int side) {
  return ivec2(mod(vec2(t), vec2(float(side))));
}

// Aspect of the whole room-space canvas — physarum.ts's/powder.ts's
// roomAspect(), reused so a Panorama pairing keeps every device sampling the
// same field.
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}

// Cover-fit of the square trail field across a roomAspect()-shaped room —
// see physarum.ts's file header for why the crop is free on a torus.
vec2 coverUv(vec2 ruv) {
  float aspect = roomAspect();
  float s = max(aspect, 1.0);
  vec2 rectSize = vec2(aspect, 1.0);
  return (ruv * rectSize + (vec2(s) - rectSize) * 0.5) / s;
}
`;

const DIFFUSE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uTrailIn;
uniform float uTrailSide;
uniform float uNoiseSeed;
// Touch's eating (file header, "Touch" paragraph) — uFootprint holds last
// step's per-strain landing counts (exact integers, packed /255 into
// RGBA8); uEatOn is 0 whenever nothing eats (packTouch's return), so the
// footprint sampler is never even read on the scene's default table.
// uEatCol[j] packs L_ij (physarum2Affinity.ts's packTouch) across i in its
// four components, one array entry per *victim* channel j.
uniform sampler2D uFootprint;
uniform float uEatOn;
// Per-strain Trail life: each channel's evaporation is the shared Trail decay
// times this strain's own multiplier (lifeToDecayMul) — 1 at the default.
uniform vec4 uLifeMul;
uniform vec4 uEatCol[${SPECIES_COUNT}];
${PHYSARUM2_GLSL}

const float DECAY_MIN = ${DECAY_MIN.toFixed(4)};
const float DECAY_MAX = ${DECAY_MAX.toFixed(4)};
const float EVAP_FLOOR = ${EVAP_FLOOR.toFixed(6)};
const float EVAP_DITHER = ${EVAP_DITHER.toFixed(4)};

float blurWeight(int d) {
  if (d == -2 || d == 2) return 1.0 / 9.0;
  if (d == -1 || d == 1) return 2.0 / 9.0;
  return 3.0 / 9.0;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int side = int(uTrailSide);

  // One pass of the separable 5-tap [1,2,3,2,1]/9 kernel in x and y — the
  // fixed-rate equivalent of two radius-1 box blurs per step (see the file
  // header on why every rate here is per *step*, not per second), all four
  // strains' channels at once.
  vec4 sum = vec4(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    float wy = blurWeight(dy);
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 nt = wrapTexel(texel + ivec2(dx, dy), side);
      sum += texelFetch(uTrailIn, nt, 0) * (blurWeight(dx) * wy);
    }
  }

  // Evaporate: multiply, then subtract a floor — physarum.ts's file header
  // covers why a bare multiply stalls in 8-bit.
  vec4 decay = clamp(vec4(mix(DECAY_MIN, DECAY_MAX, uDecay)) * uLifeMul, 0.0, 0.95);
  vec4 trail = max(vec4(0.0), sum * (vec4(1.0) - decay) - EVAP_FLOOR);

  // Touch's eating — see the file header's Touch paragraph: n_i strain-i
  // landings here last step (exact integers in RGBA8); channel j keeps
  // exp(-Σ n_i·L_ij) = Π (1-bite_ij)^n_i.
  if (uEatOn > 0.5) {
    vec4 n = floor(texelFetch(uFootprint, texel, 0) * 255.0 + 0.5);
    trail *= exp(-vec4(dot(n, uEatCol[0]), dot(n, uEatCol[1]), dot(n, uEatCol[2]), dot(n, uEatCol[3])));
  }

  // Dither the write by up to half a quantisation step — same reasoning as
  // physarum.ts's own EVAP_DITHER.
  vec2 fuv = (vec2(texel) + 0.5) / uTrailSide;
  float dither = (hash21(fuv * uTrailSide + uNoiseSeed) - 0.5) * EVAP_DITHER / 255.0;
  outColor = max(vec4(0.0), trail + vec4(dither));
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outDir;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform sampler2D uTrail;
uniform float uSeedEpoch;
uniform float uSeedFresh;
uniform float uNoiseSeed;
uniform float uAgentSide;
uniform vec4 uSpecies[${SPECIES_COUNT}];
uniform vec4 uAttractRow[${SPECIES_COUNT}];
// Phase 3's pipette/Rebalance one-shots (scene.ts's command()) — see the file
// header's command("inject")/command("rebalance") paragraphs. uInjectX/Y are
// field-space uv, already mapped from the tap's screen coordinate on the CPU
// side (screenToFieldUv) so this shader never needs room/viewport uniforms of
// its own for it.
uniform float uInjectFresh;
uniform float uInjectX;
uniform float uInjectY;
uniform float uInjectStrain;
uniform float uRebalanceFresh;
// Headcount (see SWITCH_MAX's comment): each strain's current share of all
// agents, from the last POP_FRAG readback. uSwitching (the setting) is the
// only thing that turns recruiting on.
uniform vec4 uPop;
${PHYSARUM2_GLSL}

const float SWITCH_MAX = ${SWITCH_MAX.toFixed(4)};
const float SWITCH_MARGIN = ${SWITCH_MARGIN.toFixed(4)};
const float SWITCH_FLOOR = ${SWITCH_FLOOR.toFixed(4)};
const float SWITCH_MIN_INK = ${SWITCH_MIN_INK.toFixed(4)};
const float SWITCH_PRESSURE = ${SWITCH_PRESSURE.toFixed(4)};
const float SCALE_MIN = ${SCALE_MIN.toFixed(4)};
const float SCALE_MAX = ${SCALE_MAX.toFixed(4)};
const float SEED_SPREAD_MIN = ${SEED_SPREAD_MIN.toFixed(4)};
const float SEED_SPREAD_MAX = ${SEED_SPREAD_MAX.toFixed(4)};

vec4 speciesConfig(int k) {
  if (k == 0) return uSpecies[0];
  if (k == 1) return uSpecies[1];
  if (k == 2) return uSpecies[2];
  return uSpecies[3];
}

vec4 attractRowFor(int k) {
  if (k == 0) return uAttractRow[0];
  if (k == 1) return uAttractRow[1];
  if (k == 2) return uAttractRow[2];
  return uAttractRow[3];
}

// Wander's turn (file header, "Wander"): rank the three readings, then take
// the strongest direction or the middle one — the middle with a chance that
// grows as its reading nears the strongest's, measured against how far both
// sit above the weakest. A flat reading (all three equal) holds course rather
// than favouring a side. -1 is left, 0 straight on, +1 right; u is uniform
// [0, 1).
float weightedTurn(float c, float l, float r, float u) {
  vec2 lo = vec2(c, 0.0);
  vec2 mid = vec2(l, -1.0);
  vec2 hi = vec2(r, 1.0);
  vec2 t;
  if (lo.x > mid.x) { t = lo; lo = mid; mid = t; }
  if (lo.x > hi.x) { t = lo; lo = hi; hi = t; }
  if (mid.x > hi.x) { t = mid; mid = hi; hi = t; }
  float below = mid.x - lo.x;
  float above = hi.x - mid.x;
  if (below + above <= 1e-6) return 0.0;
  return u * (below + above) < below ? mid.y : hi.y;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  float heading = unpackUnitR(cd.rg, TWO_PI);
  int k = decodeSpecies(cd.b);

  // Rebalance (Phase 3): a one-shot, full-field pass — every agent, not a
  // hash-selected share — back to the same texel-index-mod-SPECIES_COUNT
  // assignment seedAgents() starts from. Applied before this step's sensing
  // so a rebalanced agent turns using ITS NEW strain's own motion this frame,
  // same as physarum.ts's own convention for a strain that just changed.
  if (uRebalanceFresh > 0.5) {
    int side = int(uAgentSide);
    int idx = texel.y * side + texel.x;
    k = idx - (idx / SPECIES_COUNT) * SPECIES_COUNT;
  }

  // Headcount: an agent may join the strain whose ink per agent, where it
  // stands, beats its own — see SWITCH_MAX's comment in physarum2.ts. Applied
  // before sensing, so a recruited agent turns with its NEW strain's motion,
  // like a rebalanced one. Skipped entirely at Switching 0, and on the frame a
  // Rebalance sets every agent's strain by hand.
  if (uSwitching > 0.0 && uRebalanceFresh < 0.5) {
    vec2 rseed = vec2(texel) * 0.173 + uNoiseSeed * 1.7 + 3.1;
    if (hash21(rseed) < SWITCH_MAX * uSwitching && dot(uPop, onehot4(k)) > SWITCH_FLOOR) {
      vec4 per = texture(uTrail, pos) / pow(max(uPop, vec4(SWITCH_FLOOR)) * float(SPECIES_COUNT), vec4(SWITCH_PRESSURE));
      float own = dot(per, onehot4(k));
      float bestV = own * SWITCH_MARGIN;
      int best = k;
      for (int j = 0; j < SPECIES_COUNT; j++) {
        if (j != k && per[j] > bestV) {
          bestV = per[j];
          best = j;
        }
      }
      if (best != k && bestV > SWITCH_MIN_INK) k = best;
    }
  }

  vec4 cfg = speciesConfig(k);
  float scale = mix(SCALE_MIN, SCALE_MAX, uScale);
  float sensorAngle = cfg.x;
  float sensorDist = cfg.y / REF_FIELD * scale;
  float rotationAngle = cfg.z;

  vec2 dirC = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading - sensorAngle), sin(heading - sensorAngle));
  vec2 dirR = vec2(cos(heading + sensorAngle), sin(heading + sensorAngle));

  // Own channel strongly, everyone else's weakly or negatively — Cross-smell
  // is already folded into uAttractRow on the CPU side (smellWeight, in
  // physarum2Affinity.ts, applied once per strain in resolveStrains), so the
  // diagonal (follow-self) never weakens as strains are pushed further
  // apart. uRivalry itself stays declared (it's a plain non-item setting,
  // still uploaded generically by uploadCommonUniforms) but is no longer
  // read here.
  vec4 w = attractRowFor(k);

  float sC = dot(texture(uTrail, fract(pos + dirC * sensorDist)), w);
  float sL = dot(texture(uTrail, fract(pos + dirL * sensorDist)), w);
  float sR = dot(texture(uTrail, fract(pos + dirR * sensorDist)), w);

  vec2 seed = vec2(texel) * 0.173 + uNoiseSeed;

  // Centre strongest: hold. Both sides beat the centre: turn at random.
  // Otherwise: turn toward whichever side read stronger. Each strain turns
  // by its own live Turn angle — the whole point of that setting. Wander
  // swaps that rule for weightedTurn's chance pick on a uWander share of
  // agent-steps; at 0 the branch is never taken.
  if (uWander > 0.0 && hash21(seed + 21.3) < uWander) {
    heading += weightedTurn(sC, sL, sR, hash21(seed + 8.41)) * rotationAngle;
  } else if (sC >= sL && sC >= sR) {
    // hold
  } else if (sL > sC && sR > sC) {
    heading += (hash21(seed + 5.17) < 0.5 ? -1.0 : 1.0) * rotationAngle;
  } else if (sL > sR) {
    heading -= rotationAngle;
  } else {
    heading += rotationAngle;
  }
  heading = mod(mod(heading, TWO_PI) + TWO_PI, TWO_PI);

  // cfg.w already carries Excitability's beat-surge multiplier — see the
  // file header's "Uniform budget" (resolveStrainEffective folds it in on
  // the CPU side, so this shader needs no separate per-strain surge uniform).
  float moveStep = cfg.w / REF_FIELD * scale;
  pos = fract(pos + vec2(cos(heading), sin(heading)) * moveStep);

  float seedRadius = mix(SEED_SPREAD_MIN, SEED_SPREAD_MAX, uSeedSpread);

  // Seed on the beat: only on the exact tick uSeedFresh says the epoch
  // stepped (physarum.ts's file header covers why), and only for the
  // frame's first sim step — the caller only ever passes uSeedFresh=1 once
  // per firing. Reseeded agents cluster around one hash-chosen point per
  // epoch instead of scattering field-wide, so a beat reads as a colony
  // sprouting from a point — see the file header. Strain is untouched
  // ("Auto-inject from" only restricts which strain may be picked, unlike
  // the pipette's own inject block below, which always converts).
  if (uSeedFresh > 0.5) {
    float draw = hash21(seed + uSeedEpoch * 7.919 + 11.3);
    bool fromOk = uSeedFrom < 0.5 || k == int(uSeedFrom + 0.5) - 1;
    if (draw < uSeed && fromOk) {
      vec2 center = hash22(vec2(uSeedEpoch * 12.9898, uSeedEpoch * 78.233) + 17.0);
      vec2 seed2 = seed + uNoiseSeed * 3.13 + 91.7;
      float r = seedRadius * sqrt(hash21(seed2 + 3.7));
      float theta = hash21(seed2 + 9.1) * TWO_PI;
      pos = fract(center + vec2(cos(theta), sin(theta)) * r);
      heading = hash21(seed2 + 4.71) * TWO_PI;
    }
  }

  // Pipette inject (Phase 3, command("inject")): the same disc-placement
  // math as the beat reseed above, centred on the tapped point instead of a
  // beat-hash centre, and — unlike the beat reseed — it DOES convert the
  // chosen agents' species to uInjectStrain. A distinct hash offset from the
  // beat-reseed block above keeps the two draws independent so an inject
  // landing on the same frame as a beat reseed doesn't correlate which
  // agents each one picks.
  if (uInjectFresh > 0.5) {
    float draw = hash21(seed + 233.71);
    if (draw < uSeed) {
      vec2 seed2 = seed + uNoiseSeed * 4.13 + 151.3;
      float r = seedRadius * sqrt(hash21(seed2 + 3.7));
      float theta = hash21(seed2 + 9.1) * TWO_PI;
      pos = fract(vec2(uInjectX, uInjectY) + vec2(cos(theta), sin(theta)) * r);
      heading = hash21(seed2 + 4.71) * TWO_PI;
      k = int(uInjectStrain + 0.5);
    }
  }

  outPos = vec4(packUnitR(pos.x, 1.0), packUnitR(pos.y, 1.0));
  outDir = vec4(packUnitR(heading, TWO_PI), float(k) / float(SPECIES_COUNT - 1), cd.a);
}
`;

// The deposit vertex/fragment sources are built from one template, keyed by
// `mrt`, rather than kept as two hand-copied pairs — see the "Touch" file
// header paragraph and depositVertSrc/depositFragSrc's own comments for why
// two full programs exist instead of one that always carries the footprint.
function depositVertSrc(mrt: boolean): string {
  return `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform float uAgentSide;
uniform vec4 uStrainFeed;
// Touch's feeding (file header, "Touch" paragraph): row k = onehot(k) +
// TOUCH_FEED_GAIN·max(0, touch[k][j]) for j≠k (physarum2Affinity.ts's
// packTouch) — at touch = 0 this is exactly onehot, so the deposit is
// bit-identical to the no-Touch scene.
uniform vec4 uTouchFeedRow[${SPECIES_COUNT}];
${PHYSARUM2_GLSL}
out vec4 vDepositColor;
${
  mrt
    ? `// The footprint — this landing's strain as a one-hot /255 unit — only
// exists on this MRT variant, run only while eatOn (render()'s program
// pick); flat means no interpolation, matching the one-texel point this
// shader draws.
flat out vec4 vFootprint;`
    : ""
}

const float DEPOSIT = ${DEPOSIT.toFixed(4)};
${mrt ? "const float FOOT_UNIT = 1.0 / 255.0;" : ""}

// A strain's own deposit multiplier — computed in JS each frame from its
// Nutrient setting and drive (see the file header's "Uniform budget").
float strainFeedFor(int k) {
  if (k == 0) return uStrainFeed.x;
  if (k == 1) return uStrainFeed.y;
  if (k == 2) return uStrainFeed.z;
  return uStrainFeed.w;
}

vec4 touchFeedRowFor(int k) {
  if (k == 0) return uTouchFeedRow[0];
  if (k == 1) return uTouchFeedRow[1];
  if (k == 2) return uTouchFeedRow[2];
  return uTouchFeedRow[3];
}

// No vertex attributes at all — every agent is addressed by gl_VertexID into
// the position/direction textures (physarum.ts's/chladni's/powder's trick),
// so this draws from an empty VAO.
void main() {
  int side = int(uAgentSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  int k = decodeSpecies(cd.b);
  vDepositColor = touchFeedRowFor(k) * (DEPOSIT * strainFeedFor(k));
  ${mrt ? "vFootprint = onehot4(k) * FOOT_UNIT;" : ""}
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  // The only point size WebGL guarantees, and the mechanic itself: a
  // one-texel deposit.
  gl_PointSize = 1.0;
}
`;
}

function depositFragSrc(mrt: boolean): string {
  return `#version 300 es
precision highp float;
in vec4 vDepositColor;
${
  mrt
    ? `flat in vec4 vFootprint;
// This MRT variant only ever runs while eatOn (render()'s depositProg vs
// depositProgMrt pick) — see the file header's "Touch" paragraph.
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFootprint;`
    : `// The plain, single-output variant: every step that isn't eating runs
// this one, so the common (no-Touch) path never carries the footprint
// varying or a second blended write — see the file header's "Touch"
// paragraph and the Phase 1 perf follow-up in docs/scenes/physarum2.md
// (Measurements): with 800k points, the unused varying/output cost this
// path ~5-10% of a step even at touch = 0.
out vec4 outColor;`
}
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}

void main() {
  outColor = vDepositColor;
  ${mrt ? "outFootprint = vFootprint;" : ""}
}
`;
}

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uTrail;
uniform float uTrailTexel;
uniform vec3 uStrainColor[${SPECIES_COUNT}];
// Auto level's per-strain gain (levelGain) — exactly 1 per channel at level 0.
uniform vec4 uLevelGain;
// Per-strain spotlight visibility (1 = normal, SPOT_DIM = dimmed) — see
// command("spotlight") in the file header.
uniform vec4 uStrainVis;
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${PHYSARUM2_GLSL}

const float GLOW_MIN = ${GLOW_MIN.toFixed(4)};
const float GLOW_MAX = ${GLOW_MAX.toFixed(4)};
const float FLASH_GAIN = ${FLASH_GAIN.toFixed(4)};
const float GAMMA_INV = ${GAMMA_INV.toFixed(6)};
const float SMOOTH_CENTER = ${SMOOTH_CENTER.toFixed(4)};
const float SMOOTH_SIDE = ${SMOOTH_SIDE.toFixed(4)};

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 fuv = fract(coverUv(ruv));

  // Five taps — the freshest deposit is still a sharp single texel when this
  // reads it (physarum.ts's file header covers why) — averaged before the
  // exposure/gamma curve below.
  vec2 texel = vec2(uTrailTexel);
  vec4 tC = texture(uTrail, fuv);
  vec4 tL = texture(uTrail, fract(fuv - vec2(texel.x, 0.0)));
  vec4 tR = texture(uTrail, fract(fuv + vec2(texel.x, 0.0)));
  vec4 tD = texture(uTrail, fract(fuv - vec2(0.0, texel.y)));
  vec4 tU = texture(uTrail, fract(fuv + vec2(0.0, texel.y)));
  vec4 trail = tC * SMOOTH_CENTER + (tL + tR + tD + tU) * SMOOTH_SIDE;

  float exposure = mix(GLOW_MIN, GLOW_MAX, uGlow) * (1.0 + uFlash * flashDrive(uBeatPulse) * FLASH_GAIN);
  vec4 t = pow(clamp(trail * exposure * uLevelGain, 0.0, 1.0), vec4(GAMMA_INV));

  vec3 col0 = mix(uStrainColor[0], palette(0.1, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col1 = mix(uStrainColor[1], palette(0.35, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col2 = mix(uStrainColor[2], palette(0.6, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col3 = mix(uStrainColor[3], palette(0.85, uPalA, uPalB, uPalC, uPalD), uPaletteMix);

  // Fogleman's own render step (see the file header): gamma each channel,
  // weight by its strain's colour, sum, then a hard clamp rather than
  // physarum.ts's softer Reinhard roll-off — the clamp is what keeps
  // overlapping territories reading as discrete colours instead of bleeding
  // toward white.
  // uStrainVis scales only each strain's own contribution (t is read nowhere
  // else), so a dimmed strain dims and nothing else shifts.
  t *= uStrainVis;
  vec3 col = t.r * col0 + t.g * col1 + t.b * col2 + t.a * col3;
  outColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

/** Territory (Phase 3): a plain box downsample of the live trail into a
 *  TERRITORY_SIDE x TERRITORY_SIDE target, read back async (see the file
 *  header's Territory paragraph and createPhysarum2Scene's kickCensus).
 *  No COMMON_UNIFORMS_GLSL/settings/drive splice — this pass is a standalone
 *  utility over the trail texture, not part of the scene's own uniform
 *  budget. A dynamic GLSL ES 3.00 loop is fine: at most 16x16 fragments, run
 *  at most twice a second. */
const TERRITORY_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uTrail;
uniform float uTrailSide;
uniform float uBlock;

void main() {
  ivec2 outTexel = ivec2(gl_FragCoord.xy);
  int block = int(uBlock + 0.5);
  int side = int(uTrailSide);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < block; j++) {
    for (int i = 0; i < block; i++) {
      ivec2 t = ivec2(outTexel.x * block + i, outTexel.y * block + j);
      t = ivec2(mod(vec2(t), vec2(float(side))));
      sum += texelFetch(uTrail, t, 0);
    }
  }
  outColor = sum / float(block * block);
}
`;

/** Auto level: each output texel is the per-channel *peak* over one block of
 *  trail texels (a max-pool, where TERRITORY_FRAG averages), read back in
 *  the same census — levelPeaks reads the strains' levels off it. The
 *  block wraps on the torus, so a side that isn't a multiple of LEVEL_SIDE
 *  just counts a few texels twice, which a max doesn't mind. */
const LEVEL_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uTrail;
uniform float uTrailSide;
uniform float uBlock;

void main() {
  ivec2 outTexel = ivec2(gl_FragCoord.xy);
  int block = int(uBlock + 0.5);
  int side = int(uTrailSide);
  vec4 peak = vec4(0.0);
  for (int j = 0; j < block; j++) {
    for (int i = 0; i < block; i++) {
      ivec2 t = ivec2(mod(vec2(outTexel * block + ivec2(i, j)), vec2(float(side))));
      peak = max(peak, texelFetch(uTrail, t, 0));
    }
  }
  outColor = peak;
}
`;

// Headcount count: each fragment covers one block of agent texels and writes
// the fraction of them in each strain (channel k = strain k); populationFromBlocks
// averages the blocks. A block's fraction is quantised to 1/255, which the
// average over every block washes out.
const POP_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uAgentDir;
uniform float uAgentSide;
uniform float uBlock;

void main() {
  ivec2 outTexel = ivec2(gl_FragCoord.xy);
  int block = int(uBlock + 0.5);
  int side = int(uAgentSide + 0.5);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < block; j++) {
    for (int i = 0; i < block; i++) {
      ivec2 t = outTexel * block + ivec2(i, j);
      if (t.x >= side || t.y >= side) continue;
      int k = int(floor(texelFetch(uAgentDir, t, 0).b * ${(SPECIES_COUNT - 1).toFixed(1)} + 0.5));
      sum[k] += 1.0;
    }
  }
  outColor = sum / float(block * block);
}
`;

interface AgentSeed {
  pos: Uint8Array;
  dir: Uint8Array;
}

function writeUnit(out: Uint8Array, off: number, v: number, range: number): void {
  const [hi, lo] = packUnit(v, range);
  out[off] = hi;
  out[off + 1] = lo;
}

/** Seeds every texel of a `side x side` agent texture pair: random position
 *  and heading, strain round-robin over SPECIES_COUNT so every strain
 *  starts with an equal share of agents. */
function seedAgents(side: number): AgentSeed {
  const n = side * side;
  const pos = new Uint8Array(n * 4);
  const dir = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    writeUnit(pos, i * 4, Math.random(), 1);
    writeUnit(pos, i * 4 + 2, Math.random(), 1);
    writeUnit(dir, i * 4, Math.random() * TWO_PI, TWO_PI);
    const k = i % SPECIES_COUNT;
    dir[i * 4 + 2] = Math.round((k / (SPECIES_COUNT - 1)) * 255);
    dir[i * 4 + 3] = 0; // unused
  }
  return { pos, dir };
}

/** Small render targets read back together without ever stalling the CPU on
 *  a synchronous readPixels: each part is drawn into its own target, its
 *  `readPixels` goes to its own offset in ONE PIXEL_PACK_BUFFER (returns
 *  immediately), and one `fenceSync` covers them all; the bytes are only
 *  drained once the fence says the GPU is done. That drain is still a
 *  getBufferSubData, which in Chrome is a synchronous round trip queued
 *  behind everything the GPU process has not got through yet — this scene's
 *  sim steps, the Panel blur's re-filtering of the canvas — so the parts
 *  share one fence and one drain instead of each paying that wait
 *  (Territory, Headcount and Auto level each owned one until 2026-10-04: up
 *  to ten waits a second with the panel open), and render() drains it
 *  before queuing the frame's steps rather than after. Built lazily on the
 *  first `begin`, so a session that never needs it never allocates it. */
interface PixelReadback {
  /** A readback is in flight. */
  readonly busy: boolean;
  /** The moment a readback lands (once): each part's pixels, or null for a
   *  part it didn't include. Null while nothing has landed. */
  poll(gl: WebGL2RenderingContext): readonly (Uint8Array | null)[] | null;
  /** Runs each non-null `draws[i]` into part i's target and starts one
   *  readback of all of them. */
  begin(gl: WebGL2RenderingContext, draws: readonly ((() => void) | null)[]): void;
  dispose(gl: WebGL2RenderingContext): void;
}

function createPixelReadback(sides: readonly number[]): PixelReadback {
  const tex: (WebGLTexture | null)[] = sides.map(() => null);
  const fbo: (WebGLFramebuffer | null)[] = sides.map(() => null);
  let pbo: WebGLBuffer | null = null;
  let sync: WebGLSync | null = null;
  const offsets: number[] = [];
  let bytes = 0;
  for (const side of sides) {
    offsets.push(bytes);
    bytes += side * side * 4;
  }
  const out = new Uint8Array(bytes);
  const views = sides.map((side, i) => out.subarray(offsets[i]!, offsets[i]! + side * side * 4));
  const included = sides.map(() => false);
  const landed: (Uint8Array | null)[] = sides.map(() => null);
  function ensure(gl: WebGL2RenderingContext): void {
    if (pbo) return;
    sides.forEach((side, i) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      tex[i] = t;
      fbo[i] = f;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }
  return {
    get busy() {
      return sync !== null;
    },
    poll(gl) {
      if (!sync) return null;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteSync(sync);
        sync = null;
        for (let i = 0; i < sides.length; i++) landed[i] = included[i] ? views[i]! : null;
        return landed;
      }
      if (status === gl.WAIT_FAILED) {
        gl.deleteSync(sync);
        sync = null;
      }
      return null;
    },
    begin(gl, draws) {
      ensure(gl);
      sides.forEach((side, i) => {
        const draw = draws[i];
        included[i] = !!draw;
        if (!draw) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]!);
        gl.viewport(0, 0, side, side);
        draw();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, offsets[i]!);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      });
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    dispose(gl) {
      if (sync) gl.deleteSync(sync);
      for (let i = 0; i < sides.length; i++) {
        if (fbo[i]) gl.deleteFramebuffer(fbo[i]!);
        if (tex[i]) gl.deleteTexture(tex[i]!);
        fbo[i] = null;
        tex[i] = null;
      }
      if (pbo) gl.deleteBuffer(pbo);
      sync = null;
      pbo = null;
    },
  };
}

function createPhysarum2Scene(): Scene {
  let diffuseProg: GLProgram | null = null;
  let simProg: GLProgram | null = null;
  // Two deposit programs, built from the same template (depositVertSrc/
  // depositFragSrc) — depositProg is the plain single-output shader run
  // whenever nothing eats; depositProgMrt adds the footprint varying/output,
  // run only while eatOn (see the file header's "Touch" paragraph and the
  // Phase 1 perf follow-up in docs/scenes/physarum2.md).
  let depositProg: GLProgram | null = null;
  let depositProgMrt: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let depositVao: WebGLVertexArrayObject | null = null;

  const agentPosTex: (WebGLTexture | null)[] = [null, null];
  const agentDirTex: (WebGLTexture | null)[] = [null, null];
  const agentFbo: (WebGLFramebuffer | null)[] = [null, null];
  const trailTex: (WebGLTexture | null)[] = [null, null];
  const trailFbo: (WebGLFramebuffer | null)[] = [null, null];
  // Touch's eating footprint (file header, "Touch" paragraph) — built lazily,
  // the first time packTouch's eatOn goes true, and freed whenever the trail
  // targets are (they reference the same trailTex attachments). depositFbo[i]
  // = trailTex[i] + footprintTex, a second framebuffer alongside trailFbo[i]
  // rather than a third attachment on it, so the no-Touch deposit path never
  // even binds an MRT framebuffer.
  let footprintTex: WebGLTexture | null = null;
  const depositFbo: (WebGLFramebuffer | null)[] = [null, null];
  // Whether the footprint texture actually holds last step's landings —
  // false right after ensureFootprintTargets first builds it (nothing has
  // landed yet) and whenever a step ran on the plain (non-MRT) trailFbo
  // path, so the diffuse pass's eat term never reads stale or garbage data.
  let footprintFresh = false;
  const FOOT_CLEAR = new Float32Array(4);

  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let agentRead = 0;
  let trailReadIdx = 0;
  let agentSide = 1;
  let agentCount = 0;
  let trailSideCur = 0;
  let lastFrameTime: number | null = null;
  // The automatic reseed's trigger: a standout, at most once per
  // physarum.ts's refractory.
  let seedTrigger: StandoutTrigger | null = null;
  // How many times a reseed has actually fired; rotates the reseed
  // cluster's centre, same convention as physarum.ts's own seedEpoch.
  let seedEpoch = 0;
  let stepAcc = 0;
  const crawlPump = createCrawlPumpState();
  const bandsBuf = new Float32Array(NUM_BANDS);

  // Per-strain scratch, resolved fresh every render() call — see the file
  // header's "Uniform budget". Allocated once and reused so a busy render
  // loop never allocates.
  const strainSensorAngle = new Float32Array(SPECIES_COUNT);
  const strainStainDrive = new Float32Array(SPECIES_COUNT);
  const strainSensorDist = new Float32Array(SPECIES_COUNT);
  const strainRotationRad = new Float32Array(SPECIES_COUNT);
  const strainStepDist = new Float32Array(SPECIES_COUNT);
  const strainFeed = new Float32Array(SPECIES_COUNT);
  const strainColor = new Float32Array(SPECIES_COUNT * 3);
  const attRow = new Float32Array(SPECIES_COUNT * SPECIES_COUNT);
  // Touch scratch — see the file header's "Touch" paragraph and
  // physarum2Affinity.ts's packTouch. touchVal is row-major, diagonal always
  // 0 (Touch has no own-strain meaning); touchFeedRows/eatCols are the
  // packed vec4-per-strain arrays the deposit/diffuse programs consume.
  // eatOn gates the whole footprint/MRT path — false (the default scene,
  // and any feed-only table) means it never runs.
  const touchVal = new Float32Array(SPECIES_COUNT * SPECIES_COUNT);
  const touchFeedRows = new Float32Array(16);
  const eatCols = new Float32Array(16);
  let eatOn = false;

  // Phase 3 scene-internal state — see the file header's own paragraph.
  // `population` is the only one with visible bookkeeping (equalPopulation/
  // applyInjection, pure and tested); the rest is GPU orchestration state
  // that never leaves this closure.
  let population: number[] = equalPopulation(SPECIES_COUNT);
  const vigour = new Float32Array(SPECIES_COUNT);
  // Every strain's drive readings as resolveStrains last applied them, Scene
  // defaults included (a band on Nutrient, the beat pulse on Excitability),
  // for probe() — so the panel's live previews move with the music the way
  // the dish does, rather than reading 0 until a source is patched in.
  const liveDrive: StrainDriveValues[] = Array.from({ length: SPECIES_COUNT }, () => ({
    nutrient: 0,
    excite: 0,
    sensor: 0,
    turn: 0,
    stride: 0,
    stain: 0,
    angle: 0,
    life: 0,
  }));
  let lastViewport: Viewport = FULL_VIEWPORT;
  let lastResW = 1;
  let lastResH = 1;
  let pendingInject: { fieldX: number; fieldY: number; strain: number } | null = null;
  let pendingRebalance = false;
  // command("spotlight"): the pair being touched (-1 = none), when the
  // message expires, and each strain's eased visibility the composite reads.
  let spotA = -1;
  let spotB = -1;
  let spotUntilMs = 0;
  const spotVis = new Float32Array(SPECIES_COUNT).fill(1);
  // The beat reseed's one-shot, held the same way (see the `steps > 0` block
  // in render()): drives.fired() consumes its trigger on read, so a frame that
  // owes zero sim steps must not be the one that swallows it.
  let pendingSeed = false;
  // Territory: a 16x16 downsample of the trail, read back (the census below)
  // at most every TERRITORY_INTERVAL_MS, and only while probe() has been
  // called within the last PROBE_IDLE_MS.
  let territory: number[] = equalPopulation(SPECIES_COUNT);
  let territoryProg: GLProgram | null = null;
  const TERRITORY_SIDE = 16;
  let lastProbeMs = -Infinity;
  let lastTerritoryKickMs = -Infinity;
  const TERRITORY_INTERVAL_MS = 500;
  const PROBE_IDLE_MS = 2000;
  // Headcount: the measured share of agents per strain — POP_FRAG's block
  // fractions, read back every POP_INTERVAL_MS while the panel is open or
  // Switching is on (recruiting needs the shares even with the panel closed).
  let popProg: GLProgram | null = null;
  // Wide on purpose: each output texel serially sums one block of agent
  // texels, so a coarse target leaves the GPU nearly idle behind a few long
  // loops (a multi-ms spike per run). A fine one spreads the same fetches over
  // many fragments; the shares are the same, since populationFromBlocks
  // normalises by the total and texels past the agent grid write 0.
  const POP_SIDE = 128;
  let lastPopKickMs = -Infinity;
  // Bumped by every command() that sets `population` outright (pipette tap,
  // Rebalance); a readback remembers the value it was kicked under, and one
  // kicked before the command is stale — it would overwrite the instant,
  // expected shares with the pre-command agents.
  let popGen = 0;
  let popKickGen = 0;
  const POP_INTERVAL_MS = 250;
  // Auto level (file header): LEVEL_FRAG's block peaks, read back every
  // LEVEL_INTERVAL_MS while the `level` setting is above 0 (on every device —
  // it changes the picture, unlike Territory). levelLog holds each strain's
  // full-level gain as shown (log, gliding toward levelTargetLog at
  // LEVEL_TAU); the setting's blend is applied at upload (levelGain).
  let levelProg: GLProgram | null = null;
  let lastLevelKickMs = -Infinity;
  // The census: Territory, Headcount and Auto level read back as the parts
  // of ONE createPixelReadback, so they share one fence and one drain (its
  // own doc comment says why that matters). A kick takes every part that is
  // due, plus any part past CENSUS_JOIN of its own interval, so parts on the
  // same cadence stay in one readback instead of drifting into two.
  const CENSUS_TERRITORY = 0;
  const CENSUS_POP = 1;
  const CENSUS_LEVEL = 2;
  const census = createPixelReadback([TERRITORY_SIDE, POP_SIDE, LEVEL_SIDE]);
  const CENSUS_JOIN = 0.5;
  const levelLog = new Float32Array(SPECIES_COUNT);
  const levelTargetLog = new Float32Array(SPECIES_COUNT);
  const levelNow = new Float32Array(SPECIES_COUNT).fill(1);
  // Fresh dish (command("fresh")): new agents and a new start-ink trail on
  // the next render().
  let pendingFresh = false;
  // Stain Synergy — remembers which stain was set last (see physarum2Synergy.ts).
  const synergyTracker = createSynergyTracker(STRAINS.map((s) => rgbToHsl(s.color)[0]));
  const strainLifeMul = new Float32Array(SPECIES_COUNT);
  const rawStain = new Array<number>(SPECIES_COUNT).fill(0);
  // The stains as shown (Synergy applied, drive excluded), for probe() — what
  // the Strain Console grabs when a dragged stain starts from what's on screen.
  const shownStain = new Float32Array(SPECIES_COUNT);
  let harmonyIdx = 0;

  function samplerLoc(
    gl: WebGL2RenderingContext,
    prog: GLProgram,
    key: string,
    name: string,
  ): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeAgentTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** LINEAR — the composite and the sensors both tap between texels — and
   *  REPEAT, because the field is a torus (see physarum.ts's file header). */
  function makeTrailTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  /** Frees the footprint texture and both depositFbo MRT framebuffers —
   *  called whenever the trail textures they're attached to are about to be
   *  freed/resized, and from dispose(). Safe to call when nothing was ever
   *  built (every field is already null). */
  function freeFootprintTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (depositFbo[i]) gl.deleteFramebuffer(depositFbo[i]);
      depositFbo[i] = null;
    }
    if (footprintTex) gl.deleteTexture(footprintTex);
    footprintTex = null;
    footprintFresh = false;
  }

  function freeTrailTargets(gl: WebGL2RenderingContext): void {
    freeFootprintTargets(gl); // depositFbo's attachments reference trailTex
    for (let i = 0; i < 2; i++) {
      if (trailFbo[i]) gl.deleteFramebuffer(trailFbo[i]);
      if (trailTex[i]) gl.deleteTexture(trailTex[i]);
      trailFbo[i] = null;
      trailTex[i] = null;
    }
  }

  /** Lazily builds the footprint texture and the two depositFbo MRT
   *  framebuffers (trailTex[i] + footprintTex) the first time Touch's
   *  eating actually needs them (render() calls this only while packTouch
   *  said `eatOn`) — see the file header's "Touch" paragraph. A no-op once
   *  built; freeFootprintTargets/freeTrailTargets are what force a rebuild
   *  (a trail resize invalidates the attachment). */
  function ensureFootprintTargets(gl: WebGL2RenderingContext): void {
    if (footprintTex && depositFbo[0] && depositFbo[1]) return;
    footprintTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, footprintTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, trailSideCur, trailSideCur, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    for (let i = 0; i < 2; i++) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trailTex[i], 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, footprintTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`physarum2: deposit MRT framebuffer incomplete (0x${status.toString(16)})`);
      }
      depositFbo[i] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** A fresh dish's trail — Start ink's random fill (fillStartInk) at the
   *  setting's current value. */
  function startInkData(side: number): Uint8Array {
    const buf = new Uint8Array(side * side * 4);
    fillStartInk(buf, SPECIES_COUNT, resolveSceneSetting(ID, settingFor("startInk")), xorshift32((Math.random() * 4294967296) >>> 0));
    return buf;
  }

  /** Fresh dish: every agent reseeded exactly as init() seeds them (equal
   *  shares, random place and heading) and the trail refilled with Start ink,
   *  written over the textures the next step reads. */
  function freshDish(gl: WebGL2RenderingContext): void {
    const seed = seedAgents(agentSide);
    gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentRead]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, agentSide, agentSide, gl.RGBA, gl.UNSIGNED_BYTE, seed.pos);
    gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, agentSide, agentSide, gl.RGBA, gl.UNSIGNED_BYTE, seed.dir);
    gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, trailSideCur, trailSideCur, gl.RGBA, gl.UNSIGNED_BYTE, startInkData(trailSideCur));
    gl.bindTexture(gl.TEXTURE_2D, null);
    footprintFresh = false;
  }

  /** Rebuilds the trail map, and refills it with Start ink, only when its
   *  size actually changes — physarum.ts's own ensureTrailTargets. */
  function ensureTrailTargets(gl: WebGL2RenderingContext): void {
    const maxSide = Math.min(TRAIL_SIDE_CAP, Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight));
    const side = physarum2TrailSide(agentCount, maxSide);
    if (side === trailSideCur && trailFbo[0] && trailFbo[1]) return;
    freeTrailTargets(gl);
    trailSideCur = side;
    const ink = startInkData(side);
    for (let i = 0; i < 2; i++) {
      trailTex[i] = makeTrailTexture(gl, side, ink);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trailTex[i], 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`physarum2: trail framebuffer incomplete (0x${status.toString(16)})`);
      }
      trailFbo[i] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    trailReadIdx = 0;
  }

  /** Hands a landed census to its readers: Territory's shares, the
   *  Headcount (unless a command set `population` outright after that
   *  readback was kicked — see popGen) and Auto level's target gains. Called
   *  at the top of render(), before the frame's sim steps are queued: the
   *  drain is a synchronous round trip that waits for whatever the GPU
   *  process has queued ahead of it (createPixelReadback). */
  function drainCensus(gl: WebGL2RenderingContext): void {
    const done = census.poll(gl);
    if (!done) return;
    const terr = done[CENSUS_TERRITORY];
    if (terr) territory = classifyTerritory(terr, TERRITORY_SIDE * TERRITORY_SIDE, SPECIES_COUNT);
    const pop = done[CENSUS_POP];
    if (pop) {
      if (popKickGen === popGen) population = populationFromBlocks(pop, POP_SIDE * POP_SIDE, SPECIES_COUNT);
      // A stale result is dropped; let the next kick take a fresh read.
      else lastPopKickMs = -Infinity;
    }
    const lvl = done[CENSUS_LEVEL];
    if (lvl) {
      const gains = levelGainsFull(levelPeaks(lvl, LEVEL_SIDE * LEVEL_SIDE, SPECIES_COUNT));
      for (let k = 0; k < SPECIES_COUNT; k++) levelTargetLog[k] = Math.log(gains[k]!);
    }
  }

  /** Kicks off the next census, once nothing is in flight and any part is
   *  due, using the freshest trail and agents this frame produced:
   *  - Territory every TERRITORY_INTERVAL_MS, only while probe() has been
   *    called within PROBE_IDLE_MS (the panel is showing it);
   *  - Headcount every POP_INTERVAL_MS while the panel is open (probe()) or
   *    Switching is on — recruiting reads the shares every step, panel or
   *    not — but never while a command's one-shot hasn't reached the agents
   *    yet (a zero-step frame: reading now would measure the pre-command
   *    population);
   *  - Auto level every LEVEL_INTERVAL_MS while `level` is above 0, on every
   *    device, since it changes the picture.
   *  A part that isn't due yet still joins once past CENSUS_JOIN of its own
   *  interval (see the census's comment). */
  function kickCensus(gl: WebGL2RenderingContext, nowMs: number, recruiting: boolean, level: number): void {
    if (census.busy || !quadVao) return;
    const probed = nowMs - lastProbeMs <= PROBE_IDLE_MS;
    const terrOk = probed && !!territoryProg && trailSideCur > 0;
    const popOk = (recruiting || probed) && !pendingInject && !pendingRebalance && !!popProg;
    const levelOk = level > 0 && !!levelProg && trailSideCur > 0;
    const terrAge = (nowMs - lastTerritoryKickMs) / TERRITORY_INTERVAL_MS;
    const popAge = (nowMs - lastPopKickMs) / POP_INTERVAL_MS;
    const levelAge = (nowMs - lastLevelKickMs) / LEVEL_INTERVAL_MS;
    const due = (terrOk && terrAge >= 1) || (popOk && popAge >= 1) || (levelOk && levelAge >= 1);
    if (!due) return;
    const quad = quadVao;
    let drawTerritory: (() => void) | null = null;
    let drawPop: (() => void) | null = null;
    let drawLevel: (() => void) | null = null;
    if (terrOk && terrAge >= CENSUS_JOIN) {
      lastTerritoryKickMs = nowMs;
      const prog = territoryProg!;
      const block = Math.max(1, Math.floor(trailSideCur / TERRITORY_SIDE));
      drawTerritory = () => {
        prog.use();
        prog.setF("uTrailSide", trailSideCur);
        prog.setF("uBlock", block);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
        gl.uniform1i(samplerLoc(gl, prog, "terr.uTrail", "uTrail"), 0);
        drawFullscreenQuad(gl, quad);
      };
    }
    if (popOk && popAge >= CENSUS_JOIN) {
      lastPopKickMs = nowMs;
      popKickGen = popGen;
      const prog = popProg!;
      const block = Math.max(1, Math.ceil(agentSide / POP_SIDE));
      drawPop = () => {
        prog.use();
        prog.setF("uAgentSide", agentSide);
        prog.setF("uBlock", block);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
        gl.uniform1i(samplerLoc(gl, prog, "pop.uAgentDir", "uAgentDir"), 0);
        drawFullscreenQuad(gl, quad);
      };
    }
    if (levelOk && levelAge >= CENSUS_JOIN) {
      lastLevelKickMs = nowMs;
      const prog = levelProg!;
      const block = Math.max(1, Math.ceil(trailSideCur / LEVEL_SIDE));
      drawLevel = () => {
        prog.use();
        prog.setF("uTrailSide", trailSideCur);
        prog.setF("uBlock", block);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
        gl.uniform1i(samplerLoc(gl, prog, "level.uTrail", "uTrail"), 0);
        drawFullscreenQuad(gl, quad);
      };
    }
    census.begin(gl, [drawTerritory, drawPop, drawLevel]);
  }

  /** Auto level's glide: eases each strain's shown gain toward the target
   *  the last census set. levelNow is what the composite uploads — exactly 1
   *  per strain at level 0. */
  function glideLevel(dt: number, level: number): void {
    const a = 1 - Math.exp(-dt / LEVEL_TAU);
    for (let k = 0; k < SPECIES_COUNT; k++) {
      levelLog[k] = levelLog[k]! + (levelTargetLog[k]! - levelLog[k]!) * a;
      levelNow[k] = levelGain(Math.exp(levelLog[k]!), level);
    }
  }

  /** Resolves every per-strain setting for this frame into the scratch
   *  arrays above — see the file header's "Uniform budget". Pure JS: reads
   *  `resolveSceneSetting` (so a dev pin/override still applies even though
   *  these bypass uploadCommonUniforms) and `drives.value(key, sceneDefault,
   *  rest?)` (the JS twin of the generated `<key>Drive(sceneDefault)` GLSL
   *  helper — see drives.ts's header), one strain at a time. */
  function resolveStrains(dt: number, frame: { energy: number }, anim: { low: number; mid: number; high: number; beatPulse: number }, drives: Parameters<Scene["render"]>[5]): void {
    const d = drives ?? PASSTHROUGH_DRIVES;
    const rivalry = resolveSceneSetting(ID, settingFor("rivalry"));
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const bandDefault = k === 0 ? anim.low : k === 1 ? anim.mid : k === 2 ? anim.high : frame.energy;
      const raw: StrainRawValues = {
        nutrient: resolveSceneSetting(ID, nutrientSettings[k]!),
        excite: resolveSceneSetting(ID, exciteSettings[k]!),
        sensor: resolveSceneSetting(ID, sensorSettings[k]!),
        turn: resolveSceneSetting(ID, turnSettings[k]!),
        stride: resolveSceneSetting(ID, strideSettings[k]!),
        stain: resolveSceneSetting(ID, stainSettings[k]!),
        angle: resolveSceneSetting(ID, angleSettings[k]!),
        life: resolveSceneSetting(ID, lifeSettings[k]!),
      };
      rawStain[k] = raw.stain;
      // Each sceneDefault is the reading that control's own default equals —
      // the strain's band, times the jack's own gain — so a stale stored
      // "scene" preference, or PASSTHROUGH_DRIVES (no engine at all), behaves
      // exactly like the default. Nutrient alone passes a rest of its own
      // (NUTRIENT_REST's doc); every other coupling here is identity at 0.
      const motionDefault = bandDefault * MOTION_JACK_GAIN;
      const drive: StrainDriveValues = {
        nutrient: d.value(nutrientSettings[k]!.key, bandDefault, NUTRIENT_REST),
        excite: d.value(exciteSettings[k]!.key, anim.beatPulse),
        sensor: d.value(sensorSettings[k]!.key, motionDefault),
        turn: d.value(turnSettings[k]!.key, motionDefault),
        stride: d.value(strideSettings[k]!.key, motionDefault),
        stain: d.value(stainSettings[k]!.key, bandDefault * STAIN_JACK_GAIN),
        angle: d.value(angleSettings[k]!.key, motionDefault),
        life: d.value(lifeSettings[k]!.key, motionDefault),
      };
      // What probe() reports as the strain's vigour: the signal actually
      // feeding its Nutrient this frame, scene default included (the
      // widget's own drive reading is 0 until a source is patched in).
      vigour[k] = drive.nutrient;
      liveDrive[k] = drive;
      const eff = resolveStrainEffective(k, raw, drive);
      strainSensorAngle[k] = eff.sensorAngleRad;
      strainLifeMul[k] = eff.decayMul;
      strainSensorDist[k] = eff.sensorDist;
      strainRotationRad[k] = eff.rotationRad;
      strainStepDist[k] = eff.stepDist;
      strainFeed[k] = eff.feed;
      strainStainDrive[k] = eff.stainShift - raw.stain;

      for (let j = 0; j < SPECIES_COUNT; j++) {
        attRow[k * SPECIES_COUNT + j] = smellWeight(resolveSceneSetting(ID, attSpecAt(k, j)), k, j, rivalry);
        touchVal[k * SPECIES_COUNT + j] = k === j ? 0 : resolveSceneSetting(ID, touchSpecAt(k, j)!);
      }
    }
    // Stain Synergy: the stored stains pulled toward the nearest harmony. At
    // Synergy 0 the shift comes back exactly as stored, so the colour below is
    // bit-identical to `eff.color`. The drive's own (band-driven) term rides on
    // top of the pulled stain, as it always rode on the stored one.
    const synergy = resolveSceneSetting(ID, settingFor("synergy"));
    const pulled = synergyTracker.update(rawStain, synergy, dt);
    harmonyIdx = pulled.harmony;
    for (let k = 0; k < SPECIES_COUNT; k++) {
      shownStain[k] = pulled.shift[k]!;
      const color = hueRotateRGB(STRAINS[k]!.color, pulled.shift[k]! + strainStainDrive[k]!);
      strainColor[k * 3] = color[0];
      strainColor[k * 3 + 1] = color[1];
      strainColor[k * 3 + 2] = color[2];
    }
    eatOn = packTouch(touchVal, SPECIES_COUNT, touchFeedRows, eatCols);
  }

  return {
    id: ID,
    name: "Physarum 2",
    settings: SETTINGS,
    panel: PANEL,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg = createProgram(gl, DIFFUSE_FRAG);
      simProg = createProgram(gl, SIM_FRAG);
      depositProg = createProgram(gl, depositFragSrc(false), depositVertSrc(false));
      depositProgMrt = createProgram(gl, depositFragSrc(true), depositVertSrc(true));
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      territoryProg = createProgram(gl, TERRITORY_FRAG);
      popProg = createProgram(gl, POP_FRAG);
      levelProg = createProgram(gl, LEVEL_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      // No vertex attributes at all — every agent is addressed by
      // gl_VertexID — so this draws from an empty VAO rather than the
      // quad's 3-vertex buffer.
      depositVao = gl.createVertexArray();

      agentCount = Math.max(1, Math.floor(ctx.quality.maxParticles * AGENT_MULTIPLIER));
      agentSide = grainTextureSide(agentCount);
      const seed = seedAgents(agentSide);
      for (let i = 0; i < 2; i++) {
        agentPosTex[i] = makeAgentTexture(gl, agentSide, seed.pos);
        agentDirTex[i] = makeAgentTexture(gl, agentSide, seed.dir);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, agentPosTex[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, agentDirTex[i], 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`physarum2: agent framebuffer incomplete (0x${status.toString(16)})`);
        }
        agentFbo[i] = f;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      trailSideCur = 0;
      ensureTrailTargets(gl);

      agentRead = 0;
      lastFrameTime = null;
      seedTrigger = createStandoutTrigger(SEED_RISE_REFRACTORY_SEC);
      seedEpoch = 0;
      stepAcc = 0;
      crawlPump.vel = 0;

      // Phase 3 state — see the file header. The territory and headcount
      // readback targets (createPixelReadback) are created lazily the first
      // time one is actually kicked off; dispose() frees them, so a fresh
      // init() never needs to free a previous run's own.
      population = equalPopulation(SPECIES_COUNT);
      territory = new Array(SPECIES_COUNT).fill(0);
      pendingInject = null;
      pendingRebalance = false;
      pendingSeed = false;
      popGen = 0;
      popKickGen = 0;
      lastProbeMs = -Infinity;
      lastTerritoryKickMs = -Infinity;
      lastPopKickMs = -Infinity;
      lastLevelKickMs = -Infinity;
      levelLog.fill(0);
      levelTargetLog.fill(0);
      levelNow.fill(1);
      pendingFresh = false;
      lastViewport = FULL_VIEWPORT;
      lastResW = gl.drawingBufferWidth || 1;
      lastResH = gl.drawingBufferHeight || 1;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!diffuseProg || !simProg || !depositProg || !depositProgMrt || !compositeProg) return;
      if (!quadVao || !depositVao || !seedTrigger) return;
      const { gl } = ctx;
      ensureTrailTargets(gl);
      if (pendingFresh) {
        pendingFresh = false;
        freshDish(gl);
      }
      // Before any of this frame's steps are queued — see drainCensus.
      drainCensus(gl);

      // Cached for command("inject") (screenToFieldUv), which can be called
      // between render()s from a UI click, well outside this function's own
      // scope — see the file header's command("inject") paragraph.
      lastViewport = viewport;
      lastResW = gl.drawingBufferWidth;
      lastResH = gl.drawingBufferHeight;

      // See physarum.ts's file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // The trigger steps every frame so its learned floor/peak keep running
      // whatever drive Dose is patched to; drives.value() is the beat pulse
      // by default, or the patched source's envelope (a hit, a grid tick, a
      // level, a drawn line). seedEpoch rotates the reseed cluster's centre,
      // so every fire lands somewhere new.
      const seedFresh = stepStandoutTrigger(seedTrigger, dt, drives.value("seed", anim.beatPulse), standoutThreshold(drives, "seed"));
      // The panel draws the line a climb has to reach, and a dot for each
      // colony started (settingMarks.ts); no line while the threshold is off.
      publishSettingMarks(
        ID,
        "seed",
        { lines: standoutLine(seedTrigger.detector, "reach to start a colony"), reactionLabel: "colony started" },
        seedFresh ? 1 : 0,
      );
      if (seedFresh) {
        seedEpoch++;
        pendingSeed = true;
      }

      resolveStrains(dt, frame, anim, drives);
      // Lazily build the footprint/MRT targets the first time Touch's
      // eating actually needs them — see the file header's "Touch"
      // paragraph and ensureFootprintTargets's own doc comment.
      if (eatOn) ensureFootprintTargets(gl);
      // Stable for this whole frame's step loop: eatOn only changes on the
      // next resolveStrains() call, and footprintTex is never freed mid-loop
      // (only on a trail resize or dispose) — so the deposit program and
      // its target framebuffer are picked once here, not per step.
      const mrt = eatOn && footprintTex !== null;
      const depositActive = mrt ? depositProgMrt : depositProg;

      // Crawl speed (base) + Speed boost (level, rest 0 unplugged) + Speed
      // pump (its own accelerate-then-coast velocity, advanced first so this
      // frame's push already counts) — see crawlStepRate. Read in JS: the
      // stepper is fixed-rate, not a GLSL uniform.
      const d = drives ?? PASSTHROUGH_DRIVES;
      const pumpSpec = settingFor("speedPump");
      advanceCrawlPump(crawlPump, dt, d.value(pumpSpec.key, anim.lowPulse), resolveSceneSetting(ID, pumpSpec));
      const boostSpec = settingFor("speedBoost");
      const stepRate = crawlStepRate({
        speed: resolveSceneSetting(ID, settingFor("speed")),
        boost: resolveSceneSetting(ID, boostSpec),
        level: d.value(boostSpec.key, frame.energy),
        pumpVel: crawlPump.vel,
      });
      const { steps, acc } = stepAccumulator(stepAcc, dt, stepRate);
      stepAcc = acc;

      gl.disable(gl.BLEND);

      // Every uniform below is identical across every step this frame runs
      // — nothing here is scaled by dt (see the file header) — so each
      // program's settings/frame/anim upload and sampler-unit bindings
      // happen once, outside the step loop; only uNoiseSeed/uSeedFresh vary
      // per step, set fresh inside it.
      diffuseProg.use();
      uploadCommonUniforms(diffuseProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      diffuseProg.setF("uTrailSide", trailSideCur);
      diffuseProg.setV4v("uEatCol", eatCols);
      diffuseProg.setV4("uLifeMul", strainLifeMul[0]!, strainLifeMul[1]!, strainLifeMul[2]!, strainLifeMul[3]!);
      gl.uniform1i(samplerLoc(gl, diffuseProg, "diff.uTrailIn", "uTrailIn"), 0);
      gl.uniform1i(samplerLoc(gl, diffuseProg, "diff.uFootprint", "uFootprint"), 1);

      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      simProg.setF("uSeedEpoch", seedEpoch);
      for (let k = 0; k < SPECIES_COUNT; k++) {
        simProg.setV4(`uSpecies[${k}]`, strainSensorAngle[k]!, strainSensorDist[k]!, strainRotationRad[k]!, strainStepDist[k]!);
        simProg.setV4(
          `uAttractRow[${k}]`,
          attRow[k * SPECIES_COUNT]!,
          attRow[k * SPECIES_COUNT + 1]!,
          attRow[k * SPECIES_COUNT + 2]!,
          attRow[k * SPECIES_COUNT + 3]!,
        );
      }
      simProg.setF("uAgentSide", agentSide);
      simProg.setV4("uPop", population[0]!, population[1]!, population[2]!, population[3]!);
      // Phase 3's one-shots (constant across every step this frame runs;
      // only uInjectFresh/uRebalanceFresh below vary, gated to the frame's
      // first step) — see the file header's command() paragraphs.
      simProg.setF("uInjectX", pendingInject ? pendingInject.fieldX : 0);
      simProg.setF("uInjectY", pendingInject ? pendingInject.fieldY : 0);
      simProg.setF("uInjectStrain", pendingInject ? pendingInject.strain : 0);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentPos", "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentDir", "uAgentDir"), 1);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uTrail", "uTrail"), 2);

      depositActive.use();
      uploadCommonUniforms(depositActive, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      depositActive.setF("uAgentSide", agentSide);
      depositActive.setV4("uStrainFeed", strainFeed[0]!, strainFeed[1]!, strainFeed[2]!, strainFeed[3]!);
      depositActive.setV4v("uTouchFeedRow", touchFeedRows);
      // Keyed by which program is active (not a shared "dep." prefix): the
      // two deposit programs are distinct WebGLProgram objects, and a
      // uniform location cached from one is not valid on the other.
      const depKeyPrefix = mrt ? "depMrt." : "dep.";
      gl.uniform1i(samplerLoc(gl, depositActive, `${depKeyPrefix}uAgentPos`, "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, depositActive, `${depKeyPrefix}uAgentDir`, "uAgentDir"), 1);

      for (let step = 0; step < steps; step++) {
        const trailWrite = 1 - trailReadIdx;
        const agentWrite = 1 - agentRead;

        // 1. Diffuse/decay: trailRead -> trailWrite.
        gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[trailWrite]);
        gl.viewport(0, 0, trailSideCur, trailSideCur);
        diffuseProg.use();
        diffuseProg.setF("uNoiseSeed", Math.random() * 100);
        diffuseProg.setF("uEatOn", footprintFresh ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
        // Placeholder bind when there's nothing fresh to eat against — keeps
        // a valid texture on the sampler (avoids a "no texture bound"
        // warning) without ever reading stale data, since uEatOn gates the
        // GLSL read. trailTex[read] is never the framebuffer this pass
        // writes to. The sim pass right below rebinds unit 1 to agentDir, so
        // the footprint is never left bound during the MRT deposit.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, footprintFresh ? footprintTex : trailTex[trailReadIdx]);
        drawFullscreenQuad(gl, quadVao);

        // 2. Sim: agentRead -> agentWrite, sensing the trail diffuse just
        //    wrote.
        gl.bindFramebuffer(gl.FRAMEBUFFER, agentFbo[agentWrite]);
        gl.viewport(0, 0, agentSide, agentSide);
        simProg.use();
        simProg.setF("uSeedFresh", step === 0 && pendingSeed ? 1 : 0);
        simProg.setF("uInjectFresh", step === 0 && pendingInject ? 1 : 0);
        simProg.setF("uRebalanceFresh", step === 0 && pendingRebalance ? 1 : 0);
        simProg.setF("uNoiseSeed", Math.random() * 100);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentRead]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailWrite]);
        drawFullscreenQuad(gl, quadVao);

        // 3. Deposit: additive points from the agent state sim just wrote,
        //    into the same trail write target diffuse just produced — never
        //    blurred in the step it's laid (see the file header). While
        //    Touch is eating, this also writes the footprint MRT attachment
        //    (depositFbo instead of trailFbo) so next step's diffuse can
        //    read this step's landing counts.
        gl.bindFramebuffer(gl.FRAMEBUFFER, mrt ? depositFbo[trailWrite] : trailFbo[trailWrite]);
        gl.viewport(0, 0, trailSideCur, trailSideCur);
        if (mrt) gl.clearBufferfv(gl.COLOR, 1, FOOT_CLEAR); // the footprint only; the trail (buffer 0) is untouched
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        depositActive.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentWrite]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentWrite]);
        gl.bindVertexArray(depositVao);
        gl.drawArrays(gl.POINTS, 0, agentCount);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
        footprintFresh = mrt;

        agentRead = agentWrite;
        trailReadIdx = trailWrite;
      }

      // A one-shot (pipette dose, Rebalance, beat reseed) only actually
      // reaches the GPU on the frame's first SIM step (above) — if this frame
      // owed zero steps (sim paused, or Crawl speed very low), keep it pending
      // rather than dropping it silently; it fires on the first frame that
      // actually runs a step.
      if (steps > 0) {
        pendingInject = null;
        pendingRebalance = false;
        pendingSeed = false;
      }

      // The census (Territory, Headcount, Auto level): maybe kick off the
      // next one from the freshest trail this frame produced — see
      // kickCensus. Never affects the uniforms/bindings the composite pass
      // below sets up itself.
      const nowMs = performance.now();
      const level = resolveSceneSetting(ID, settingFor("level"));
      kickCensus(gl, nowMs, resolveSceneSetting(ID, settingFor("switching")) > 0, level);
      glideLevel(dt, level);

      // 4. Composite to the default framebuffer — always, even when this
      //    frame owed zero steps (the picture just doesn't advance).
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      compositeProg.setF("uTrailTexel", 1 / trailSideCur);
      compositeProg.setV4("uLevelGain", levelNow[0]!, levelNow[1]!, levelNow[2]!, levelNow[3]!);
      // Spotlight: ease each strain toward dim or full by the real frame dt,
      // then hand the composite the four visibilities.
      const spotLive = spotA >= 0 && nowMs < spotUntilMs;
      for (let k = 0; k < SPECIES_COUNT; k++) {
        const target = spotLive && k !== spotA && k !== spotB ? SPOT_DIM : 1;
        spotVis[k] = easeSpot(spotVis[k]!, target, dt * 1000);
      }
      compositeProg.setV4("uStrainVis", spotVis[0]!, spotVis[1]!, spotVis[2]!, spotVis[3]!);
      for (let k = 0; k < SPECIES_COUNT; k++) {
        compositeProg.setV3v(`uStrainColor[${k}]`, strainColor.subarray(k * 3, k * 3 + 3));
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uTrail", "uTrail"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 5. The gallery renders every scene into one shared context each
      //    tick — must not leak blend state or a bound texture onto the
      //    next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    // Phase 3 — phone-local only, never called for the TV (see scene.ts's
    // own doc comment on probe/command). Both are cheap: probe() just reads
    // already-resolved JS state, and command() only ever queues a flag for
    // render()'s next call to pick up.
    probe(): Record<string, number> | null {
      lastProbeMs = performance.now();
      const out: Record<string, number> = {};
      for (let k = 0; k < SPECIES_COUNT; k++) {
        out[`pop${k}`] = population[k]!;
        out[`terr${k}`] = territory[k]!;
        out[`vig${k}`] = vigour[k]!;
        out[`level${k}`] = levelNow[k]!;
        const dr = liveDrive[k]!;
        for (const p of Object.keys(dr) as (keyof StrainDriveValues)[]) out[`drive_${p}${k}`] = dr[p];
      }
      // The automatic beat reseed, for the Affinity pads' own cultures to
      // mirror (pairPads.ts): the counter steps once per reseed, with the
      // share moved (Dose) and the disc radius (Spread, field-unit) that
      // reseed used, both as resolved (Auto included), not as stored.
      // Synergy: each stain as shown (the set shift pulled toward the
      // harmony, in turns, wrapped to the Stain slider's -0.5..0.5) and which
      // harmony (an index into physarum2Synergy.ts's HARMONIES) — the Strain
      // Console starts a dragged stain from what is on screen.
      for (let k = 0; k < SPECIES_COUNT; k++) out[`shownStain${k}`] = wrapTurn(shownStain[k]!);
      out.harmony = harmonyIdx;
      out.seedEpoch = seedEpoch;
      out.seedDose = resolveSceneSetting(ID, settingFor("seed"));
      out.seedRadius = seedSpreadSliderToRadius(resolveSceneSetting(ID, settingFor("seedSpread")));
      return out;
    },

    command(name: string, args: Record<string, number>): void {
      if (name === "inject") {
        const strain = Math.max(0, Math.min(SPECIES_COUNT - 1, Math.round(args.strain ?? 0)));
        const x = clamp01(args.x ?? 0.5);
        const y = clamp01(args.y ?? 0.5);
        const field = screenToFieldUv({ x, y }, lastViewport, lastResW, lastResH);
        pendingInject = { fieldX: field.x, fieldY: field.y, strain };
        // The dose is this setting's plain stored amount — no drive; see the
        // file header and the "seed" setting's own comment above.
        const dose = resolveSceneSetting(ID, settingFor("seed"));
        population = applyInjection(population, strain, dose);
        popGen++;
      } else if (name === "rebalance") {
        pendingRebalance = true;
        population = equalPopulation(SPECIES_COUNT);
        popGen++;
      } else if (name === "fresh") {
        // A fresh dish replaces the agents outright, so any queued one-shot
        // aimed at the old ones is moot.
        pendingFresh = true;
        pendingInject = null;
        pendingRebalance = false;
        population = equalPopulation(SPECIES_COUNT);
        popGen++;
      } else if (name === "spotlight") {
        const a = Math.round(args.a ?? -1);
        if (a < 0) {
          spotA = -1;
          spotB = -1;
          spotUntilMs = 0;
        } else {
          spotA = Math.min(SPECIES_COUNT - 1, a);
          spotB = Math.max(-1, Math.min(SPECIES_COUNT - 1, Math.round(args.b ?? -1)));
          spotUntilMs = performance.now() + SPOT_HOLD_MS;
        }
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg?.dispose();
      simProg?.dispose();
      depositProg?.dispose();
      depositProgMrt?.dispose();
      compositeProg?.dispose();
      territoryProg?.dispose();
      popProg?.dispose();
      levelProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (depositVao) gl.deleteVertexArray(depositVao);
      for (let i = 0; i < 2; i++) {
        if (agentFbo[i]) gl.deleteFramebuffer(agentFbo[i]);
        if (agentPosTex[i]) gl.deleteTexture(agentPosTex[i]);
        if (agentDirTex[i]) gl.deleteTexture(agentDirTex[i]);
        agentFbo[i] = null;
        agentPosTex[i] = null;
        agentDirTex[i] = null;
      }
      freeTrailTargets(gl);
      census.dispose(gl);
      samplerLocs.clear();
      diffuseProg = null;
      simProg = null;
      depositProg = null;
      depositProgMrt = null;
      compositeProg = null;
      territoryProg = null;
      popProg = null;
      levelProg = null;
      quadVao = null;
      depositVao = null;
      lastFrameTime = null;
      seedTrigger = null;
      seedEpoch = 0;
      stepAcc = 0;
      crawlPump.vel = 0;
      trailSideCur = 0;
      pendingInject = null;
      pendingRebalance = false;
      pendingSeed = false;
      spotA = -1;
      spotB = -1;
      spotUntilMs = 0;
      spotVis.fill(1);
      popGen = 0;
      popKickGen = 0;
      pendingFresh = false;
    },
  };
}

export const physarum2Scene = createPhysarum2Scene();
