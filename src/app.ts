import { DRAFT_SCENE_IDS, PAID_SCENE_IDS } from "./render/scenes/index.ts"; // also registers built-in scenes (side effect)
import { captureMic, captureDisplayAudio, listAudioInputDevices } from "./audio/capture.ts";
import {
  getInputDevicePref,
  setInputDevicePref,
  inputDeviceOptions,
  defaultInputLabel,
  resolveInputDeviceId,
  isMissingDeviceError,
  deviceLabel,
  isInputHidden,
  setInputHidden,
  previewWouldDisturb,
  inputKind,
  INPUT_KIND_TEXT,
  type InputDevicePref,
  type InputDeviceOption,
} from "./audio/inputDevice.ts";
import { inputPreviewSupported, createInputPreview, type InputPreview } from "./audio/inputPreview.ts";
import { createBandAnalyser, type BandAnalyser } from "./audio/analyser.ts";
import { createWaveformAnalyser, type WaveformAnalyser } from "./audio/waveformAnalyser.ts";
import { peak, rms } from "./audio/waveform.ts";
import { createLufsAnalyser, type LufsAnalyser } from "./audio/lufsAnalyser.ts";
import { createInputHealthTap, type InputHealthTap } from "./audio/inputHealthTap.ts";
import { createInputHealth, mainsHumHz, type InputHealthReading, type InputMeasure } from "./audio/inputHealth.ts";
import type { LufsReading } from "./audio/lufs.ts";
import { FeatureExtractor } from "./audio/features.ts";
import { createTempoSource, type TempoSource } from "./audio/tempoSource.ts";
import { NUM_BANDS, type CaptureHandle, type CaptureSourceKind, type FeatureFrame } from "./audio/types.ts";
import {
  getAudioSourceChoice as getStoredAudioSource,
  setAudioSourceChoice,
  resolveSourceState,
  displayCaptureSupported,
  watchMicPermission,
  DISPLAY_SHARE_GUIDE,
  type AudioSourceChoice,
  type MicPermission,
  type SourceState,
} from "./audio/sourcePref.ts";
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import {
  detectQuality,
  parseQualityPreset,
  qualitySettings,
  type QualityPreset,
  type QualitySettings,
} from "./render/quality.ts";
import { RENDER_FPS_CAP_FLOOR, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type Viewport } from "./render/scene.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { getPalette, PALETTES, type Palette } from "./render/palette.ts";
import {
  applySensitivity,
  getExpansion,
  getSensitivity,
  getSmoothing,
  setExpansion,
  setSensitivity,
  setSmoothing,
  smoothingRateScale,
} from "./audio/sensitivity.ts";
import { createAnimClock, type AnimFrame } from "./render/animClock.ts";
import { PHASE_BASS, type TempoHit } from "./render/beatClock.ts";
import { getBeatTrim, requestBarResync, resetBeatTrim, stepTempoMultiplier, nudgeBeatOffset } from "./render/beatTrim.ts";
import { createRenderLatch, type RenderLatch } from "./render/renderLatch.ts";
import { createDriveEngine, type DriveEngine } from "./render/drives.ts";
import {
  getDriveLine,
  getDriveLineStrength,
  getDriveSetting,
  getDriveThresholdState,
  setDriveThreshold,
  setDriveThresholdOn,
  resetDriveLine,
  resetDriveSetting,
  setDriveSetting,
  setDriveLine,
  setDriveLineBand,
  setDriveLineStrength,
  setPatchMix,
  setSourceEvery,
  setSourceGrid,
  setSourceHeight,
  setSourceMuted,
  setSourceRole,
  setSourceWeight,
  togglePatchSource,
} from "./render/driveStore.ts";
import { createSyntheticFeed, type SyntheticFeed } from "./audio/synthetic.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import {
  getSceneExpansion,
  getSceneMaster,
  getSceneSetting,
  resetSceneSettings,
  setSceneExpansion,
  setSceneMaster,
  setSceneSetting,
  settingDefault,
  type SceneSetting,
} from "./render/sceneSettings.ts";
import {
  createPictureMeter,
  createPictureAverager,
  PICTURE_GAP_RESET_MS,
  PICTURE_SAMPLE_INTERVAL_MS,
} from "./render/pictureMeter.ts";
import { createPictureReadback, type PictureReadback } from "./render/pictureReadback.ts";
import {
  applyLook,
  captureLook,
  decodeLook,
  deleteLook,
  encodeLook,
  hasUndo as hasLookUndo,
  listLooks,
  primeUndo,
  saveLook,
  saveSharedLook,
  takeUndo,
} from "./render/sceneLooks.ts";
import { getPin, setPin, clearPin } from "./tuning/pins.ts";
import { getBandSplit } from "./audio/bandSplit.ts";
import {
  getAutoGain,
  setAutoGain,
  resolveAutoGain,
  feedAutoGainMeasurement,
  isAutoGainAuto,
  setAutoGainAuto,
} from "./audio/autoGain.ts";
import {
  getSilenceGate,
  setSilenceGateClosed,
  setSilenceGateOpen,
  resolveSilenceGate,
  feedSilenceGateMeasurement,
  isSilenceGateAuto,
  setSilenceGateAuto,
  type SilenceGateReading,
} from "./audio/silenceGate.ts";
import { getHitShape, setHitShape } from "./audio/hitStrength.ts";
import { isMicAuto, setMicAuto } from "./audio/micAuto.ts";
import type { OnsetDiag } from "./audio/onsetDiag.ts";
import { getPowerMode, setPowerMode, type PowerMode } from "./render/powerMode.ts";
import { getQualityChoice, setQualityChoice, type QualityChoice } from "./render/qualityPref.ts";
import {
  getOutputPowerMode,
  getOutputQualityChoice,
  getOutputResolution,
  getPreviewQualityChoice,
  getPreviewResolution,
  getPreviewSize,
  PREVIEW_SIZE_FRACTION,
  setOutputPowerMode,
  setOutputQualityChoice,
  setOutputResolution,
  setPreviewQualityChoice,
  setPreviewResolution,
  setPreviewSize,
  type PreviewSize,
} from "./render/outputPower.ts";
import { nominalBandEdgesHz } from "./audio/bandScale.ts";
import {
  applyBandGains,
  getBandGain,
  getBandGains,
  pinnedBands,
  resetBandGains,
  setBandGain,
} from "./audio/bandGains.ts";
import {
  advanceAutoTune,
  tickAutoTune,
  resolveSceneSetting,
  resolveSensitivity,
  resolveExpansion,
  resolveSmoothing,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
  isAutoEnabled,
  setAutoEnabled,
  isSceneAuto,
  setSceneAuto,
  seedAuto,
} from "./render/autoTune.ts";
import {
  createRoomCode,
  HostConnection,
  RendererConnection,
  type VisualSample,
} from "./net/room.ts";
import { createJoinScreen } from "./ui/joinScreen.ts";
import { reportSceneRunning } from "./net/usage.ts";
import { createDeviceMenu, isTypingTarget, type AudioSource, type DeviceMenu } from "./ui/deviceMenu.ts";
import { createControlPanel } from "./ui/controlPanel.ts";
import { createGallery, type Gallery } from "./ui/gallery.ts";
import { navigate, onRouteChange, seedHistory, currentRoute, type Route } from "./router.ts";
import { createImmersiveMode, type ImmersiveMode } from "./ui/fullscreen.ts";
import { noteKeyUse } from "./ui/keyHints.ts";
import { shouldTickInBackground, startBackgroundTick } from "./net/backgroundTick.ts";
import { createBroadcastTransport, createOutputBridge, type OutputBridge } from "./net/outputBridge.ts";
import type { OutputPower, ToMain, ToOutput } from "./net/outputSync.ts";
import { createOutputControls, type OutputControls } from "./ui/outputControls.ts";
import { createPlayKey, glideMsForHold, PLAY_TAP_MAX_MS } from "./ui/outputKeys.ts";
import { BANDS_AMBER, ensureControlsStyles } from "./ui/controlsTheme.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { BUILD_INFO, versionHint, versionLabel } from "./version.ts";
import { sceneVersionHint, sceneVersionOf } from "./render/sceneVersions.ts";
import { bindHint, hideTooltip } from "./ui/tooltip.ts";

type Mode = "solo" | "host" | "renderer";
type AnyConn = HostConnection | RendererConnection;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const roomCodeEl = document.getElementById("roomCode") as HTMLDivElement;
const menuBtn = document.getElementById("menuBtn") as HTMLButtonElement;
const panelBtn = document.getElementById("panelBtn") as HTMLButtonElement;
const backBtn = document.getElementById("backBtn") as HTMLButtonElement;
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const sceneVersion = document.getElementById("sceneVersion") as HTMLSpanElement;
const outBtn = document.getElementById("outBtn") as HTMLButtonElement;
const cueBtn = document.getElementById("cueBtn") as HTMLButtonElement;
const goBtn = document.getElementById("goBtn") as HTMLButtonElement;
const outStateEl = document.getElementById("outState") as HTMLSpanElement;
const outBarEl = document.getElementById("outBar") as HTMLElement;
const audioPrompt = document.getElementById("audioPrompt") as HTMLDivElement;
const audioPromptLabel = document.getElementById("audioPromptLabel") as HTMLSpanElement;
const audioPromptMicBtn = document.getElementById("audioPromptMicBtn") as HTMLButtonElement;
const audioPromptMicLabel = document.getElementById("audioPromptMicLabel") as HTMLSpanElement;
const audioPromptDisplayBtn = document.getElementById("audioPromptDisplayBtn") as HTMLButtonElement;
const audioPromptGuide = document.getElementById("audioPromptGuide") as HTMLParagraphElement;

const PRESET_ORDER: QualityPreset[] = ["floor", "low", "mid", "high"];
/** No new frame in this long -> the host is gone even if our own socket to the relay is still open. */
const STALE_TIMEOUT_MS = 3000;
const presetAllows = (s: Scene, p: QualityPreset): boolean =>
  !s.minQuality || PRESET_ORDER.indexOf(p) >= PRESET_ORDER.indexOf(s.minQuality);

let mode: Mode = "solo";
let roomCode: string | null = null;
let hostConn: HostConnection | null = null;
let rendererConn: RendererConnection | null = null;
let rendererHasData = false;
let soloFallbackTriggered = false;

let capture: CaptureHandle | null = null;
let bandAnalyser: BandAnalyser | null = null;
/** Time-domain sibling of bandAnalyser — the waveform for the controls
 *  panel's Signal card, its Waveform row (src/ui/audioMeters.ts). Never
 *  touches FeatureExtractor or the wire frame: this is display-only data
 *  local to this device, not a render-driving signal. See
 *  waveformAnalyser.ts's header for why. */
let waveformAnalyser: WaveformAnalyser | null = null;
/** K-weighted loudness tap for the panel's Signal card, its Loudness row
 *  (src/audio/lufsAnalyser.ts) — display-only and local, like the waveform
 *  analyser above. */
let lufsAnalyser: LufsAnalyser | null = null;
/** Per-channel peaks + dropped-frame count for src/audio/inputHealth.ts —
 *  display-only and local, same lifecycle as waveformAnalyser above (built in
 *  attachCapture, disposed in onCaptureEnded). */
let inputHealthTap: InputHealthTap | null = null;
/** The one state machine instance for the whole session — see
 *  inputHealth.ts's own header for why it's a single long-lived `reset()`
 *  rather than a fresh one per capture, unlike inputHealthTap above. */
const inputHealth = createInputHealth();
/** DEV-only: a deep (32768-sample, ~682ms) sibling of waveformAnalyser, for
 *  tools/audio-latency.mjs to locate a test click's exact arrival sample —
 *  see that tool's header. waveformAnalyser's own 2048 samples (42.7ms at
 *  48kHz) are too shallow: a click near the low end of the tool's expected
 *  10-30ms result would already be uncomfortably close to scrolling out of
 *  it. Never built outside import.meta.env.DEV — see attachCapture. */
let measureAnalyser: WaveformAnalyser | null = null;
/** The AudioWorklet-hosted fixed-hop tempo tracker (src/audio/tempoSource.ts)
 *  for the live capture attached in attachCapture() — null until its async
 *  createTempoSource() resolves, and permanently null (falling back to
 *  extractor's own render-tick bpm below) on a browser/context that can't
 *  support it. Disposed and cleared in onCaptureEnded/attachCapture's own
 *  re-attach, same lifecycle as bandAnalyser above. */
let tempoSource: TempoSource | null = null;
/** Rebuilt (not just reset) on every swapAudioSource() — see that function's
 *  comment for why a fresh extractor, not a reset(), is what a source swap
 *  needs. */
let extractor = new FeatureExtractor();
/** Set on first mic/display-capture attempt; cached so re-entering a viz
 *  never re-prompts. Cleared back to null on failure, or when the capture's
 *  own track ends (onCaptureEnded), so a retry is possible. */
let audioPromise: Promise<void> | null = null;
let captureFailed = false;
/** The browser's live mic permission, kept current by boot()'s
 *  watchMicPermission() call — what autoStartSource() checks before any
 *  implicit start. */
let micPermission: MicPermission = "unknown";
/** Guards against overlapping swapAudioSource() calls — e.g. a double-click
 *  on the panel's Source chips while a share picker is already open. */
let swapPromise: Promise<void> | null = null;
/** `?audio=synthetic[&bpm=N]` — replaces the mic entirely with a
 *  deterministic feed (src/audio/synthetic.ts), so the same URL always
 *  produces the same frame at a given elapsed time. Set once in boot(); its
 *  mere presence short-circuits ensureAudio() and currentVisual() below,
 *  which is what lets tools/tune-*.mjs reproduce an exact moment on demand. */
let syntheticFeed: SyntheticFeed | null = null;
let syntheticStartMs = 0;

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
/** What detectQuality()'s boot benchmark actually found (or the dev
 *  `?quality=` pin) — kept separate from `quality` itself so the Power
 *  card can mark it "recommended" even while a user override
 *  (qualityChoice) is in effect. See effectivePreset() below. */
let detectedPreset: QualityPreset = "mid";
/** True once boot() found `?quality=`/`?tier=` — see the comment at that
 *  call site for why a pinned preset skips the governor entirely. Kept as
 *  module state (not a boot()-local) so applyQualityChoice can rebuild the
 *  governor consistently with what boot() did. */
let pinned = false;
let qualityChoice: QualityChoice = getQualityChoice();
/** Auto follows the boot benchmark; any other choice pins that preset
 *  instead — see src/render/qualityPref.ts. */
const effectivePreset = (): QualityPreset => (qualityChoice === "auto" ? detectedPreset : qualityChoice);
/** While a pop-out output window is open this window is only a preview
 *  (net/outputSync.ts's Cue / Go), so it renders cheaper: its own quality
 *  choice and a smaller box, both from src/render/outputPower.ts. The output's
 *  own quality and energy saving live there too and travel to it as a
 *  `power` message. */
let previewChoice: QualityChoice = getPreviewQualityChoice();
let previewSize: PreviewSize = getPreviewSize();
let previewResolution = getPreviewResolution();
let outputPower: OutputPower = {
  quality: getOutputQualityChoice(),
  mode: getOutputPowerMode(),
  resolution: getOutputResolution(),
};
/** True while an output window is open and a scene is showing: recomputed
 *  every tick (render loop, right after outputBridge.update). */
let previewActive = false;
const presetRank = (p: QualityPreset): number => PRESET_ORDER.indexOf(p);
/** The preset this window actually renders at. effectivePreset() is the
 *  DEVICE's preset and stays the one every scene-availability check uses, so
 *  the preview's lower quality never hides a scene from the gallery; this is
 *  only what the mounted scene is drawn with. While previewing, the preview
 *  choice, raised to the scene's own `minQuality` floor. A dev pin wins, so
 *  headless `?quality=` captures stay reproducible. */
function renderPreset(): QualityPreset {
  if (!previewActive || pinned) return effectivePreset();
  const wanted = previewChoice === "auto" ? detectedPreset : previewChoice;
  const floor = scene.minQuality;
  return floor && presetRank(floor) > presetRank(wanted) ? floor : wanted;
}
/** The scale this window's canvas is resized by: the quality's own, times the
 *  preview's Resolution while an output is open (render/outputPower.ts). */
function renderScale(): number {
  return quality.renderScale * (previewActive ? previewResolution : 1);
}
/** The main fullscreen GL context — created once at boot and kept alive for
 *  the whole session; only which scene is mounted on it changes. */
let mainHost: SceneHost | null = null;

/** The Master card's Picture block and tools/master-sweep.mjs share this one
 *  measurement path — see src/render/pictureMeter.ts for what each measure
 *  means and src/render/pictureReadback.ts for how the thumbnail feeding it
 *  is captured. `pictureReadback` is created lazily, on mainHost's own GL
 *  context, the first time pictureWanted() actually asks for a sample — a
 *  session that never opens the panel and isn't driving a headless sweep
 *  never allocates the blit chain. */
let pictureReadback: PictureReadback | null = null;
const pictureMeter = createPictureMeter();
const pictureAverager = createPictureAverager();
/** DEV-only override (tuning/debug.ts's `picture.force`): sample the picture
 *  even with the panel closed, for a headless sweep that never opens it. */
let pictureForced = false;
/** Last time samplePicture() kicked off a new capture — paced to
 *  PICTURE_SAMPLE_INTERVAL_MS independently of the render loop's own rate,
 *  which usually runs faster. */
let lastPictureKickMs = -Infinity;

let gallery: Gallery | null = null;
let deviceMenu: DeviceMenu | null = null;
let immersive: ImmersiveMode | null = null;
let inViz = false;
/** `?room=CODE` (no role=host) — a mic-less renderer joining someone else's
 *  room. The scene is dictated by the host, so there's nothing to browse:
 *  the gallery is never built and routing is skipped entirely. */
let bypassGallery = false;
/** This tick's feature frame, shared by the fullscreen scene render and (via
 *  gallery.liveFrame) the gallery preview tiles once real audio is running. */
let lastVis: FeatureFrame | null = null;
/** This tick's true raw mic signal, straight off the analyser — no adaptive
 *  envelope (FeatureExtractor), no sensitivity/dynamics gain. Only available
 *  in solo/host mode (a renderer device has no local mic); feeds the config
 *  panel's "Listening post" spectrum toggle so a user can see exactly what's
 *  hitting the mic, not just what the visuals do with it. Reused in place
 *  every tick, same as bandAnalyser's own internal scratch buffer. */
let lastRawBands: Float32Array | null = null;
/** This tick's waveform samples, straight off waveformAnalyser — same
 *  solo/host-only availability as lastRawBands above, for the same reason
 *  (no local mic on a renderer device). Feeds the Signal card's Waveform row. */
let lastMono: Float32Array | null = null;
/** This tick's deep waveform samples, straight off measureAnalyser — DEV
 *  only, see that variable's own comment. Same buffer identity every read;
 *  a consumer across a page.evaluate boundary must copy before it returns. */
let lastDeepMono: Float32Array | null = null;
// FeatureExtractor.fixedEnergy from this device's own extractor — the Signal
// card's history trace draws it as the "auto-gain fully off" reference. Null
// wherever no local extractor ran this frame (renderer, synthetic feed).
let lastFixedEnergy: number | null = null;
// FeatureExtractor.onsetDiag from this device's own extractor — the Hits
// card's hits history. Same solo/host-only availability as lastFixedEnergy
// above and for the same reason. Read synchronously the same tick it's set
// (deviceMenu.update() below), before the next currentVisual() call mutates
// the extractor's own diag object in place — see onsetDiag's own doc.
let lastBeatDiag: OnsetDiag | null = null;
// FeatureExtractor.fluxRatio from this device's own extractor — tuning/
// debug.ts's getInput() (tools/audio-latency.mjs's click-track latency
// measurement), a separate consumer from the Hits card's hits history
// above. Same solo/host-only availability as lastFixedEnergy and for the
// same reason.
let lastFluxRatio: number | null = null;
/** This tick's fixed-hop tempo onsets (src/audio/tempoSource.ts), solo mode
 *  only — built in currentVisual() and read by loop() when it builds
 *  animClock.advance()'s `hit` argument. undefined whenever no tempo
 *  source is live on this tick (including every host/renderer/TV tick —
 *  see beatClock.ts's own file header for why those never get this feed). */
let lastTempoHits: TempoHit[] | undefined = undefined;
// The silence gate's last reading off this device's own extractor — the
// Signal card's Gate row (audioMeters.ts). `fired` is the local extractor's
// own frame's onset (not the jitter-buffered `lastVis`), so it and
// `suppressed` always describe the same tick's decision — see the two
// currentVisual() branches below where this is set. Same solo/host-only
// availability as lastBeatDiag above and for the same reason.
let lastGate: SilenceGateReading | null = null;
/** This tick's LUFS reading off lufsAnalyser — same solo/host-only
 *  availability as lastMono, for the Signal card's Loudness row. */
let lastLufs: LufsReading | null = null;
/** This tick's src/audio/inputHealth.ts reading — same solo/host-only
 *  availability as lastGate above and for the same reason. Read by the
 *  Source row's status line (src/ui/deviceMenu.ts) via the deviceMenu deps'
 *  getInputHealth, not passed through DeviceMenu.update() — that row
 *  refreshes on its own slower timer, not every rAF tick. */
let lastInputHealth: InputHealthReading | null = null;
const rawBandsScratch = new Float32Array(NUM_BANDS);

const animClock = createAnimClock();
// Latches one-shot AnimFrame edges (onset/lowOnset/.../dropOnset) across
// ticks the render cap skips, and turns anim.dtSec into wall time since the
// last *rendered* frame rather than the last rAF tick — see renderLatch.ts.
// deviceMenu/audioMeters and advanceAutoTune below still see the raw,
// un-latched `anim` (they run every tick); only what reaches scene.render()
// goes through the latch.
const renderLatch = createRenderLatch();
// One drive engine for the whole app — its per-setting state is already
// scoped by (scene, setting) internally (settingScope(), same as every
// other store here), so it doesn't need recreating on a scene switch. See
// src/render/drives.ts's header for accumulate() vs. forScene().
const driveEngine = createDriveEngine();
/** The demo groove a scene plays behind the start prompt, so opening a scene
 *  before any source is picked shows it moving instead of a black screen —
 *  see idlePreviewActive() and renderIdlePreview(). It keeps its own anim
 *  clock, latch and drive engine rather than borrowing the ones above: the
 *  beat clock would otherwise arrive locked to this feed's tempo when the
 *  real source attaches, and the demo must not train advanceAutoTune's music
 *  profile either. Purely local — never sent to a paired TV, never counted
 *  as usage, never shown on the panel's meters. */
const idlePreview = {
  feed: createSyntheticFeed(),
  anim: createAnimClock(),
  latch: createRenderLatch(),
  drives: createDriveEngine(),
};
let lastRafMs = 0;
let hudHideTimer: number | undefined;

/** This tick's AnimFrame and an EWMA-free instantaneous render fps — both
 *  dev-only-consumed, by the tuning probe (src/tuning/probe.ts) via the
 *  getInput() closure wired in boot() below. Harmless to keep updating in a
 *  prod build (just two numbers/an object reference, no allocation beyond
 *  what animClock.advance already does), so no DEV guard needed here. */
let lastAnim: AnimFrame | null = null;

/** The pop-out output window (net/outputBridge.ts), created at boot. The two
 *  numbers are this window's last resolved Sensitivity/Expansion, which the
 *  bridge streams along with each frame (net/outputSync.ts's `p`). */
let outputBridge: OutputBridge | null = null;
let outputControls: OutputControls | null = null;
let outputSens = 1;
let outputExp = 1;
let lastRenderFpsMs = 0;
let lastFps = 0;

// Render-rate cap and its jitter-tolerant gate live in framePace.ts (shared
// with tv.ts) — see that file for why the gate needs a tolerance at all.
let lastRenderMs = 0;

/** Closed-loop counterpart to detectQuality()'s one-shot boot benchmark —
 *  steps the shared `quality` object's numeric knobs down under sustained
 *  load (thermal throttling) and back up once comfortable. Created once
 *  quality is known, in boot(), and rebuilt by applyQualityChoice()
 *  whenever the user changes which preset it steps from. */
let governor: QualityGovernor | null = null;

/** Energy saving mode (src/render/powerMode.ts) — Auto leaves the governor
 *  above in charge, On/Off take it out of the loop. Read once at module
 *  init (device-wide, persisted), then only ever changed through
 *  applyPowerMode below so the governor and the render-rate cap stay in
 *  sync with it. */
let powerMode: PowerMode = getPowerMode();

/** The render-rate cap actually in force this frame. Forced Energy saving
 *  On halves it to RENDER_FPS_CAP_FLOOR regardless of preset — a deliberate
 *  saver — everything else uses the preset's own cap. The governor's own
 *  internal budget (its targetFrameMs, fixed at construction) is left at
 *  the preset's normal interval always: it only ever steps while enabled,
 *  which On/Off take away, so the two can't disagree in the one mode
 *  (Auto) where the governor is actually watching. */
function renderIntervalMs(): number {
  return powerMode === "on" ? 1000 / RENDER_FPS_CAP_FLOOR : targetFrameIntervalMs(quality.preset);
}

/** Applies a mode change to the live governor: Auto hands it back control
 *  (from a clean measurement — see QualityGovernor.setEnabled), On/Off pin
 *  quality to the preset baseline and stop it stepping. Also the boot-time
 *  entry point, so a persisted On/Off from a previous session takes effect
 *  before the first frame renders. */
function applyPowerMode(mode: PowerMode): void {
  powerMode = mode;
  governor?.setEnabled(mode === "auto");
}

/** Applies a change of what this window renders at (src/render/qualityPref.ts,
 *  or the preview's own while an output is open — see renderPreset()) to the
 *  live session: mutates the shared `quality` object in place — rather than
 *  reassigning it — so mainHost's SceneContext, the gallery, and the
 *  governor's own closure (which snapshots it as `baseline` at construction)
 *  all pick it up without a remount. The governor itself is rebuilt rather
 *  than re-baselined: its targetFrameMs also depends on the preset (the
 *  floor preset caps at RENDER_FPS_CAP_FLOOR), and a rebuild resets its
 *  measurement state for free — the same clean-slate rule setEnabled(true)
 *  already follows. Does nothing when the resolved preset is the one already
 *  in force, so the governor's measurement is left alone. No-op on the
 *  numeric knobs while pinned (a dev `?quality=`/`?tier=` override): see
 *  boot()'s comment on `pinned`.
 *
 *  `remount` re-inits the mounted scene (geometry is sized at init), for the
 *  preview starting or stopping under a scene that is already showing. */
function applyRenderQuality(remount = false): void {
  const preset = renderPreset();
  if (preset === quality.preset) return;
  Object.assign(quality, qualitySettings(preset));
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);
  if (remount && inViz && mainHost) {
    mainHost.unmountAll();
    mainHost.mount(scene);
  }
}

/** The preview's box (index.html's `body.output-preview #gl`): on while an
 *  output is open and the size isn't Full. */
function applyPreviewBox(): void {
  document.body.classList.toggle("output-preview", previewActive && previewSize !== "full");
  document.body.style.setProperty("--preview-frac", String(PREVIEW_SIZE_FRACTION[previewSize]));
}

function activeConn(): AnyConn | null {
  return hostConn ?? rendererConn;
}

function showHud(text: string, persist = false): void {
  hud.textContent = text;
  hud.style.opacity = "1";
  window.clearTimeout(hudHideTimer);
  if (!persist) {
    hudHideTimer = window.setTimeout(() => {
      hud.style.opacity = "0";
    }, 3000);
  }
}

/** Space = Cue (held), Option = Play (tap sends at once, hold glides) — the why, and
 *  what a glide touches, is src/ui/outputKeys.ts's header. Capture phase, so a
 *  focused button or checkbox never also sees the Space; both are inert unless
 *  an output window is open, leaving Space to the page as before. */
function wireOutputKeys(controls: OutputControls): void {
  const playKey = createPlayKey();
  let chargeRaf = 0;
  let spaceHeld = false;

  function chargeTick(): void {
    const ms = playKey.holdMs(performance.now());
    if (ms === null) {
      chargeRaf = 0;
      controls.charge(null);
      return;
    }
    // Inside the tap window nothing shows yet: a tap must not flicker a charge.
    controls.charge(ms >= PLAY_TAP_MAX_MS ? ms : null);
    chargeRaf = requestAnimationFrame(chargeTick);
  }

  window.addEventListener(
    "keydown",
    (e) => {
      // Option is allowed here: Play is pressed while Cue is held, and Space's
      // auto-repeat then carries altKey — it must stay a Cue, not cancel the Play.
      if (
        e.code === "Space" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        inViz &&
        !isTypingTarget(e.target) &&
        controls.active()
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        spaceHeld = true;
        if (e.repeat) return;
        noteKeyUse("cue");
        controls.holdCue(true);
        return;
      }
      if (e.key === "Alt") {
        if (e.repeat || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!inViz || isTypingTarget(e.target) || !controls.active()) return;
        playKey.down(performance.now());
        if (!chargeRaf) chargeRaf = requestAnimationFrame(chargeTick);
        return;
      }
      playKey.cancel(); // any other key while Option is down: a chord, not a Play
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (e.code === "Space" && spaceHeld) {
        spaceHeld = false;
        controls.holdCue(false);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.code === "KeyK") controls.holdCue(false);
      if (e.key !== "Alt") return;
      const hold = playKey.up(performance.now());
      if (hold === null || !controls.active()) return;
      const glideMs = glideMsForHold(hold);
      const result = controls.go(glideMs ?? undefined);
      noteKeyUse("go");
      if (result === "glide" && glideMs !== null) showHud(`Play: gliding over ${(glideMs / 1000).toFixed(1)} s`);
      else if (glideMs !== null) showHud("Play: sent at once — a glide only runs within one scene");
      else showHud("Play: sent to output");
    },
    true,
  );

  window.addEventListener("pointerdown", () => playKey.cancel(), true);
  const drop = (): void => {
    playKey.reset();
    spaceHeld = false;
    controls.holdCue(false); // the key-up will never arrive: the master goes back
  };
  window.addEventListener("blur", drop);
  document.addEventListener("visibilitychange", drop);
}

async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — some browsers/contexts deny it; screen may just dim.
  }
}

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, effectivePreset()));
}

/** Fills and re-binds the scene view's own version corner (`#sceneVersion` in
 *  index.html) for `next` — called from applyScene() and enterViz() below so
 *  it stays current across a scene switch, not just once at boot. Shows
 *  "<Scene name> <its version>" in brighter white (a `+dev` suffix in amber),
 *  a dim middle dot, then the build's own label (src/version.ts) in its
 *  usual place and colour — or, when the scene has no version of its own
 *  (unregistered/private, or a build vite-scene-versions-plugin.ts never ran
 *  for — src/render/sceneVersions.ts's header), just the build's own label,
 *  same as before per-scene versions existed. The hint is the scene's own
 *  lines (sceneVersionHint()) ahead of the build's (versionHint()).
 *  bindHint() itself is safe to call again on the same element — it updates
 *  the bound hint text rather than stacking a second set of listeners
 *  (src/ui/tooltip.ts). */
function updateSceneVersionLabel(next: Scene): void {
  const appLabel = versionLabel(BUILD_INFO);
  const offStable = BUILD_INFO.channel !== "stable";
  const hintColor = offStable ? BANDS_AMBER : "rgba(255,255,255,.4)";
  const sceneVer = sceneVersionOf(next.id);

  sceneVersion.style.removeProperty("color"); // clear a previous scene-less fallback's inline colour
  sceneVersion.replaceChildren();
  if (!sceneVer) {
    sceneVersion.textContent = appLabel;
    if (offStable) sceneVersion.style.color = BANDS_AMBER;
    bindHint(sceneVersion, hintColor, versionHint(BUILD_INFO));
    return;
  }

  const isDev = sceneVer.endsWith("+dev");
  const base = isDev ? sceneVer.slice(0, -"+dev".length) : sceneVer;
  const nameEl = document.createElement("span");
  nameEl.className = "svScene";
  nameEl.textContent = `${next.name} ${base}`;
  if (isDev) {
    const dev = document.createElement("span");
    dev.className = "svDev";
    dev.textContent = "+dev";
    nameEl.appendChild(dev);
  }
  const sep = document.createElement("span");
  sep.textContent = " · ";
  const appEl = document.createElement("span");
  appEl.textContent = appLabel;
  if (offStable) appEl.style.color = BANDS_AMBER;
  sceneVersion.append(nameEl, sep, appEl);
  bindHint(sceneVersion, hintColor, [...sceneVersionHint(next.name, sceneVer), ...versionHint(BUILD_INFO)]);
}

/** Routes both local picks (device menu) and remote commands (control panel on
 *  another device) through the same path, so the roster always reflects reality. */
function applyScene(next: Scene): void {
  if (!mainHost) return;
  scene = next;
  // Before the mount, which sizes geometry from `quality`: the new scene's
  // minQuality may differ from the last one's while previewing.
  if (previewActive) applyRenderQuality();
  mainHost.unmountAll();
  mainHost.mount(next);
  updateSceneVersionLabel(next);
  showHud(`scene: ${scene.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
  if (inViz) navigate({ kind: "viz", sceneId: scene.id }, "replace");
}

function applyPalette(next: Palette): void {
  palette = next;
  showHud(`palette: ${palette.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
}

/** Panorama slice assignment, driven by the room panel — not offered in the on-device menu. */
function applyViewport(next: Viewport): void {
  viewport = next;
  activeConn()?.sendHello(scene.id, palette.id, viewport);
}

function fatalError(message: string): void {
  showHud(message, true);
}

/** `?source=display`, only where display capture is actually supported — same
 *  guard resolveInitialSource applies to a stored "display" pref, so the two
 *  can't disagree about what counts as a real pin. Never stripped from the
 *  URL (unlike `?look=`), so it stays authoritative for the whole session. */
function urlPinnedSource(): AudioSourceChoice | null {
  const params = new URLSearchParams(location.search);
  return params.get("source") === "display" && displayCaptureSupported() ? "display" : null;
}

/** `?source=display` pins the initial offered/remembered choice the way
 *  `?quality=` pins a preset — mainly for dev/tooling use without touching
 *  localStorage. Otherwise defers to the persisted choice
 *  (src/audio/sourcePref.ts), falling back to mic wherever display capture
 *  isn't supported at all. Pinning "display" here does NOT by itself start a
 *  capture — see autoStartSource() below for why. */
function resolveInitialSource(): AudioSourceChoice {
  const pinned = urlPinnedSource();
  if (pinned) return pinned;
  const stored = getStoredAudioSource();
  return stored === "display" && !displayCaptureSupported() ? "mic" : stored;
}

/** The one truth every source picker (the gallery masthead, the Input card's
 *  Source row) renders — see SourceState's doc comment in sourcePref.ts for
 *  why a picker only ever highlights `live`, never a stored preference. A
 *  capture actually running wins outright (derived from `capture.kind`, never
 *  the stored pref — swapAudioSource attaches the new capture before
 *  persisting it, so reading the pref here would flash the old choice for one
 *  tick); otherwise it's just the remembered/pinned preference, not live. */
function currentSourceState(): SourceState {
  const liveChoice: AudioSourceChoice | null =
    bandAnalyser && capture ? (capture.kind === "display" ? "display" : "mic") : null;
  return resolveSourceState({ liveChoice, preferredChoice: resolveInitialSource() });
}

/** The source an IMPLICIT start — opening a scene, tapping a tile, anything
 *  no Mic/Screen tap asked for — is allowed to use: only one whose permission
 *  is still active, so the start is silent and never pops a browser prompt
 *  the user didn't just ask for. Otherwise nothing starts, and
 *  updateMicPrompt() puts the start prompt up so the user picks first.
 *
 *  In practice that's the mic with its permission still granted — whatever
 *  the stored preference says, since a remembered "display" pick can never
 *  qualify: getDisplayMedia's permission is never remembered and it reopens
 *  the share picker on every call. A reset or never-granted mic ("prompt"),
 *  a denied one, or a browser that can't report it ("unknown", e.g. Safari)
 *  all wait for a tap. Same principle onCaptureEnded states for its own
 *  refusal to fall back to another source. */
function autoStartSource(): AudioSourceChoice | null {
  return micPermission === "granted" ? "mic" : null;
}

function startCapture(choice: AudioSourceChoice): Promise<CaptureHandle> {
  return choice === "display" ? captureDisplayAudio() : startMic();
}

/** The Mic source: the input chosen in the Input card's Source row
 *  (src/audio/inputDevice.ts), or the system default when none is. A chosen
 *  device that isn't plugged in never leaves the scene deaf — it falls back
 *  to the default input and says so on the HUD; the devicechange listener
 *  (onInputDevicesChanged) moves back once the device shows up. */
async function startMic(): Promise<CaptureHandle> {
  const pref = getInputDevicePref();
  if (!pref) return captureMic();
  const before = await listDevicesQuietly();
  const chosen = await openChosenInput(pref, before);
  if (chosen) return chosen;
  const fallback = await captureMic();
  // No labels before the first grant (inputDeviceOptions' doc), so a device
  // whose id has since rotated (inputDevice.ts's header) can only be found
  // by its label now that the fallback's own grant made labels readable.
  if (inputDeviceOptions(before).length === 0) {
    const late = await openChosenInput(pref, await listDevicesQuietly()).catch(() => null);
    if (late) {
      fallback.stop();
      return late;
    }
  }
  showHud(`${pref.label || "The chosen input"} isn't connected — listening to the default input`);
  return fallback;
}

/** Opens the chosen input as it resolves against `devices` — null when it's
 *  missing, so startMic can fall back. Re-stores the id when the device was
 *  found by its label under a new one. */
async function openChosenInput(pref: InputDevicePref, devices: MediaDeviceInfo[]): Promise<CaptureHandle | null> {
  const resolved = resolveInputDeviceId(pref, devices);
  if (resolved === "missing" || resolved.deviceId === null) return null;
  try {
    const handle = await captureMic(resolved.deviceId);
    if (resolved.deviceId !== pref.deviceId) setInputDevicePref({ deviceId: resolved.deviceId, label: pref.label });
    return handle;
  } catch (err) {
    if (isMissingDeviceError(err)) return null;
    throw err;
  }
}

function listDevicesQuietly(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([]);
  return listAudioInputDevices().catch(() => []);
}

/** The pickable inputs and the OS default's name, cached for the Source
 *  row's dropdown (its refresh runs on a timer and reads synchronously).
 *  Refreshed at boot, on every devicechange, and after each capture attaches
 *  — the first mic grant is what makes labels readable at all. */
let inputDevices: InputDeviceOption[] = [];
let defaultInputName: string | null = null;

async function refreshInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await listDevicesQuietly();
  inputDevices = inputDeviceOptions(devices);
  defaultInputName = defaultInputLabel(devices);
  syncInputPreview();
  return devices;
}

/** The Source row's idle signal-preview meters (src/audio/inputPreview.ts) —
 *  owned here, one instance for the session. `inputPreviewActive` is the
 *  panel's own on/off (deviceMenu.ts's open()/close(), via
 *  DeviceMenuDeps.setInputPreviewActive); on top of that this only ever runs
 *  where inputPreviewSupported() and there's at least one pickable option to
 *  preview (mic permission granted) — otherwise it's stopped outright rather
 *  than left open with nothing to show. Re-synced here on every call site
 *  that can change what it should be previewing: refreshInputDevices()
 *  itself (a new/removed device), and attachCapture/onCaptureEnded (which
 *  input is LIVE, and so excluded from the preview, changes independently of
 *  the device list). Hidden inputs and ones a preview would disturb
 *  (Bluetooth headsets, an iPhone's mic — previewWouldDisturb in
 *  src/audio/inputDevice.ts) are never opened either. */
let inputPreview: InputPreview | null = null;
let inputPreviewActive = false;

function syncInputPreview(): void {
  if (!inputPreviewActive || !inputPreviewSupported() || inputDevices.length === 0) {
    inputPreview?.stop();
    inputPreview = null;
    return;
  }
  if (!inputPreview) inputPreview = createInputPreview();
  const live = liveInputLabel();
  inputPreview.sync(
    inputDevices
      .filter((o) => o.label !== live && !isInputHidden(o.label) && !previewWouldDisturb(o.label))
      .map((o) => o.deviceId),
  );
}

/** An input was plugged in or pulled. Besides refreshing the dropdown: if the
 *  chosen input just (re)appeared while the mic is listening to something
 *  else — the default it fell back to, because the interface went in after
 *  the scene started or its cable was pulled mid-set — move over to it now,
 *  instead of making someone find the dropdown again. */
async function onInputDevicesChanged(): Promise<void> {
  const devices = await refreshInputDevices();
  const pref = getInputDevicePref();
  if (!pref || capture?.kind !== "mic" || !bandAnalyser || swapPromise) return;
  const resolved = resolveInputDeviceId(pref, devices);
  if (resolved === "missing" || resolved.deviceId === null) return;
  const liveId = capture.stream.getAudioTracks()[0]?.getSettings().deviceId;
  if (resolved.deviceId !== liveId) void swapAudioSource("mic", true);
}

/** The device the live mic is actually hearing, by name — the Source row's
 *  status line. Null for a screen share (no device to name) or no capture. */
function liveInputLabel(): string | null {
  if (capture?.kind !== "mic") return null;
  return deviceLabel(capture.stream.getAudioTracks()[0]?.label ?? "") || null;
}

/** The Source row picked an input ("" = the system default). Picking one is
 *  asking to hear it, so this also switches to it — from the default mic, or
 *  from a screen share — rather than only remembering it for next time. */
function chooseInputDevice(deviceId: string): void {
  const current = getInputDevicePref();
  const option = inputDevices.find((o) => o.deviceId === deviceId);
  // The dropdown's own "not connected" entry for the stored choice isn't in
  // inputDevices — re-picking it keeps that choice, it doesn't clear it.
  const next = option ? { deviceId, label: option.label } : current?.deviceId === deviceId ? current : null;
  setInputDevicePref(next);
  // The chosen input's kind (src/audio/inputDevice.ts's inputKind) names the
  // start prompt's Mic button and the gallery masthead's picker — both need
  // a fresh label the moment the choice changes, not just on their own
  // unrelated refresh triggers.
  refreshAudioPromptButtons();
  gallery?.syncSource();
  if (mode === "renderer" || syntheticFeed) return;
  if (!bandAnalyser) {
    setAudioSourceChoice("mic");
    void ensureAudio("mic");
  } else void swapAudioSource("mic", true);
}

/** Maps a capture's kind to the panel's AudioSource vocabulary. A chosen
 *  input device (a mixer's USB interface) is still the "mic" source — only
 *  which device it opens differs. */
function captureAudioSource(kind: CaptureSourceKind): AudioSource {
  return kind;
}

/** Builds bandAnalyser/waveformAnalyser/lufsAnalyser/inputHealthTap off a
 *  freshly started capture, and hangs a listener off its audio track so an
 *  externally-ended share (Chrome's "Stop sharing" bar, a revoked mic
 *  permission) is noticed instead of silently freezing the visuals at zero —
 *  see onCaptureEnded. Also the one place a capture swap (swapAudioSource)
 *  re-attaches, so it disposes the previous inputHealthTap and resets the
 *  state machine itself — inputHealth.ts's reading must never carry over
 *  from one input to the next. */
function attachCapture(handle: CaptureHandle): void {
  capture = handle;
  bandAnalyser = createBandAnalyser(handle.context, handle.sourceNode);
  waveformAnalyser = createWaveformAnalyser(handle.context, handle.sourceNode);
  lufsAnalyser = createLufsAnalyser(handle.context, handle.sourceNode);
  inputHealthTap?.dispose();
  inputHealthTap = createInputHealthTap(handle.context, handle.sourceNode, handle.stream);
  inputHealth.reset();
  // measureAnalyser's own header explains why this is DEV-only and deep
  // (32768 samples) rather than reusing waveformAnalyser.
  if (import.meta.env.DEV) measureAnalyser = createWaveformAnalyser(handle.context, handle.sourceNode, 32768);
  // The previous capture's own tempoSource (if any) belonged to its own
  // AudioContext — stop() (this function's caller, or onCaptureEnded/
  // swapAudioSource's `previous?.stop()`) closes that context, which tears
  // the old worklet node down on its own; clearing the reference here is
  // enough, no explicit dispose() needed for it. createTempoSource() is
  // async — until it resolves, and on a browser that can't support it
  // (resolves null), currentVisual() below keeps reading `extractor`'s own
  // render-tick bpm, exactly as before this existed.
  tempoSource = null;
  void createTempoSource(handle.context, handle.sourceNode).then((source) => {
    // This capture may already have been superseded (a source swap, or the
    // track ending) by the time the async load resolves — only adopt the
    // result if `handle` is still the live capture, otherwise dispose the
    // now-orphaned source instead of leaking its node/sink.
    if (capture !== handle) {
      source?.dispose();
      return;
    }
    tempoSource = source;
  });
  // stop() (used when swapAudioSource retires this handle) does not fire
  // "ended" per spec — only an external stop does — so this listener and a
  // deliberate swap never race each other.
  const track = handle.stream.getAudioTracks()[0];
  track?.addEventListener("ended", () => onCaptureEnded(handle), { once: true });
  // The one place every attach path (ensureAudio, swapAudioSource,
  // fallBackToSolo) funnels through, so it's also the one place that needs to
  // repaint the source pickers and the stop button — see updateMicPrompt and
  // gallery.syncSource's own doc comments for what each covers.
  updateMicPrompt();
  gallery?.syncSource();
  reportUsage();
  // A first mic grant is what makes input labels readable (see
  // refreshInputDevices) — the Source row's device list fills in from here.
  // refreshInputDevices() re-syncs the preview off the freshly-read device
  // list on its own; this capture becoming live also changes which device
  // the preview should exclude, so it needs its own re-sync too.
  void refreshInputDevices();
  syncInputPreview();
}

/** Counts a scene actually running on live audio (src/net/usage.ts) — called
 *  from both ends because either can come last: entering a scene with audio
 *  already live, or audio arriving for the scene already on screen. The
 *  synthetic feed is automation, so it never counts. */
function reportUsage(): void {
  if (!inViz) return;
  if (mode === "renderer") reportSceneRunning(scene.id, "remote");
  else if (capture) reportSceneRunning(scene.id, captureAudioSource(capture.kind) === "display" ? "display" : "mic");
}

/** The live capture's track ended on its own — the user hit Chrome's "Stop
 *  sharing" bar, the OS revoked a mic permission mid-session, or the input
 *  device itself went away (a USB interface unplugged). Tears down and
 *  re-shows the start prompt rather than leaving the visuals frozen at zero.
 *  Deliberately doesn't fall back to another source — that would fire a
 *  permission prompt the user didn't ask for. The one exception is the mic
 *  itself while its permission still stands: reopening it prompts nobody, and
 *  it's what keeps a set going when a cable is pulled — startMic lands on
 *  whatever input is left, and onInputDevicesChanged moves back once the
 *  chosen one returns. */
function onCaptureEnded(handle: CaptureHandle): void {
  if (capture !== handle) return; // already superseded by a swap
  handle.stop();
  capture = null;
  bandAnalyser = null;
  waveformAnalyser = null;
  measureAnalyser = null;
  lufsAnalyser = null;
  inputHealthTap?.dispose();
  inputHealthTap = null;
  inputHealth.reset();
  tempoSource?.dispose();
  tempoSource = null;
  audioPromise = null;
  captureFailed = false;
  updateMicPrompt();
  gallery?.syncSource();
  syncInputPreview(); // nothing live now, so the preview can cover every device again
  if (handle.kind === "mic" && micPermission === "granted") void ensureAudio("mic");
}

/** Turns a capture failure into copy the user can act on. A mic denial points
 *  at a Mic button (the gallery picker's or the start prompt's — a tile tap
 *  won't retry it, see autoStartSource); a cancelled share picker points at
 *  the Screen button the same way
 *  (both raise the same DOMException, hence branching on `choice` too);
 *  anything else — e.g. captureDisplayAudio's own no-audio-track message —
 *  surfaces verbatim with a neutral retry hint instead of being swallowed. */
function captureErrorMessage(choice: AudioSourceChoice, err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return choice === "display"
      ? "Screen share cancelled — tap Screen to try again."
      : "Microphone permission denied — tap Mic to try again.";
  }
  const message = err instanceof Error ? err.message : String(err);
  return `${message} — tap to try again.`;
}

/** Starts capture on first call — from `explicit` when a tap named a source
 *  (the start prompt's buttons, the panel's Source chips), otherwise from
 *  autoStartSource(), which refuses to open the display picker unbidden (see
 *  its doc comment). While one is already running or has already succeeded,
 *  later calls just return that same promise. Capture survives trips back to
 *  the gallery — that's what lets the room code and any TV pairing keep
 *  working while browsing — and is torn down only by an explicit
 *  swapAudioSource() or the capture's own track ending (onCaptureEnded above). */
function ensureAudio(explicit?: AudioSourceChoice): Promise<void> {
  if (syntheticFeed) return Promise.resolve();
  if (audioPromise) return audioPromise;
  const choice = explicit ?? autoStartSource();
  if (choice === null) {
    updateMicPrompt(); // nothing started — the prompt is the way in
    return Promise.resolve();
  }
  const attempt = (async () => {
    attachCapture(await startCapture(choice));
    captureFailed = false;
  })();
  audioPromise = attempt.catch((err) => {
    console.error(err);
    captureFailed = true;
    audioPromise = null;
    gallery?.setError(captureErrorMessage(choice, err));
  });
  audioPromise.then(updateMicPrompt);
  return audioPromise;
}

/** Hot-swaps the live capture to a different source — the panel's Source
 *  row. Starts the new capture BEFORE touching the old one: if the user
 *  cancels the share picker, this rejects, and the old capture must still be
 *  the one running — starting-then-swapping guarantees that; tearing the old
 *  one down first would not. The room connection is untouched either way:
 *  hostConn is independent of capture, so a paired TV keeps rendering.
 *  `restart` reopens even the source already live — the mic moving to a
 *  different input device (chooseInputDevice, onInputDevicesChanged). */
function swapAudioSource(next: AudioSourceChoice, restart = false): Promise<void> {
  if (!bandAnalyser || syntheticFeed || mode === "renderer") return Promise.resolve();
  if (capture?.kind === next && !restart) return Promise.resolve();
  // A restart queues behind a swap in flight rather than dropping: a second
  // device picked mid-swap is the one that has to end up live.
  if (swapPromise) return restart ? swapPromise.then(() => swapAudioSource(next, true)) : swapPromise;
  const previous = capture;
  const attempt = (async () => {
    const handle = await startCapture(next);
    previous?.stop();
    attachCapture(handle); // also repaints the stop button, so its label names the new source
    // A fresh extractor, not a reset(): FeatureExtractor has none, and
    // letting its adaptive AGC's envelope carry over would blow the visuals
    // out for its ~1.25s re-adaptation window on the big level jump a
    // mic-to-screen swap usually is (a room mic is far quieter than captured
    // system audio).
    extractor = new FeatureExtractor();
    setAudioSourceChoice(next);
    captureFailed = false;
  })();
  swapPromise = attempt
    .catch((err) => {
      console.error(err);
      gallery?.setError(captureErrorMessage(next, err));
    })
    .finally(() => {
      swapPromise = null;
    });
  return swapPromise;
}

/** "Mic"/"Line in"/"Loopback" for the CHOSEN input (getInputDevicePref) —
 *  named after what it is rather than the generic "Mic", the same words the
 *  Source row's own kind tag uses (src/audio/inputDevice.ts's
 *  INPUT_KIND_TEXT). No stored choice (the system default) reads as "Mic": a
 *  laptop's own default input almost always is one. */
function inputChoiceLabel(): string {
  const pref = getInputDevicePref();
  if (!pref) return "Mic";
  const kind = inputKind(pref.label);
  return kind === "mic" ? "Mic" : kind === "line" ? "Line in" : "Loopback";
}

/** Shows/hides the start prompt and — since display capture's availability
 *  never changes mid-session — decides once whether it offers a Mic/Screen
 *  choice or just Mic, matching the original single-button prompt exactly
 *  where Screen isn't offered at all. Also fills in the share-audio guide
 *  (DISPLAY_SHARE_GUIDE, src/audio/sourcePref.ts): its visibility is the same
 *  static "is Screen offered" condition as the Screen button, so it belongs
 *  here rather than in updateMicPrompt's per-change logic below. */
function refreshAudioPromptButtons(): void {
  const canDisplay = displayCaptureSupported();
  audioPromptLabel.hidden = !canDisplay;
  audioPromptDisplayBtn.hidden = !canDisplay;
  // Set on the label span, not the button itself — the button also holds
  // .apDot, and overwriting textContent on the button would wipe it out.
  audioPromptMicLabel.textContent = canDisplay ? inputChoiceLabel() : "Tap to enable mic";
  audioPromptGuide.textContent = DISPLAY_SHARE_GUIDE;
  audioPromptGuide.hidden = !canDisplay;
}

/** The scene's stop button exists only while there is something to stop: a
 *  live capture of this device's own, inside a viz. Called from
 *  updateMicPrompt, which already runs on every transition that matters here
 *  (capture attached, ended, failed; viz entered). */
function updateStopBtn(): void {
  stopBtn.style.display = inViz && capture && bandAnalyser ? "block" : "none";
  // Names the thing it stops, so the label is never a guess. The LIVE
  // device's own label (liveInputLabel), not the stored choice — a fallback
  // to the default while the chosen interface is unplugged should read as
  // stopping whatever's actually listening, not the absent one. No label at
  // all (the moment right before a track's label settles) reads as "MIC",
  // the same neutral default inputKind's own "mic" case already is.
  const label = liveInputLabel();
  const kind = label ? inputKind(label) : "mic";
  stopBtn.textContent = capture?.kind === "display" ? "STOP SHARE" : `STOP ${INPUT_KIND_TEXT[kind].tag}`;
}

function updateMicPrompt(): void {
  updateStopBtn();
  // Hidden while a fresh attempt is in flight (audioPromise set but not yet
  // settled) so we don't double-prompt; shown before any attempt or after
  // one has failed.
  const needsAudio = inViz && mode !== "renderer" && !syntheticFeed && !bandAnalyser && (captureFailed || !audioPromise);
  audioPrompt.style.display = needsAudio ? "flex" : "none";
  // Nothing is ever live while this prompt is showing (needsAudio above
  // requires !bandAnalyser), so neither button gets emphasis here — both are
  // a plain, equal choice.
}

/** Renderer lost (or never reached) its room — fall back to this device's own mic, per the plan's Solo model. */
async function fallBackToSolo(reason: string): Promise<void> {
  if (soloFallbackTriggered) return;
  soloFallbackTriggered = true;
  showHud(`room ${reason} — switching to solo mic`);

  rendererConn?.close();
  rendererConn = null;
  panelBtn.style.display = "none"; // no room left to command

  try {
    // Gesture-less by construction (fires from a timer / a lost socket), so it
    // can only start the source that needs no gesture — see autoStartSource.
    // Matches this function's own "switching to solo mic" HUD line above.
    attachCapture(await startCapture("mic"));
    mode = "solo";
    roomCodeEl.style.display = "none";
  } catch (err) {
    console.error(err);
    showHud("room lost and no mic available", true);
  }
}

function startRendererDisconnectWatch(): void {
  setTimeout(() => {
    // Covers both an unreachable worker and a valid-but-empty room (no
    // host ever broadcast into it) — either way, no data ever arrived.
    if (mode === "renderer" && !rendererHasData) void fallBackToSolo("has no active host");
  }, 5000);
}

function menuItems(items: { id: string; name: string }[]) {
  return items.map((i) => ({ id: i.id, name: i.name }));
}

// A named top-level function (rather than inline in the DeviceMenuDeps
// object literal below) so micAuto.ts's setMicAuto can reuse this exact
// seed-then-flip path for the Sensitivity/Expansion/Smoothing pseudo-params
// instead of re-deriving it — see micAutoMembers below and micAuto.ts's
// header for why that reuse matters.
function onSettingAutoToggle(sceneId: string, spec: SceneSetting, on: boolean): void {
  if (on) {
    // Pseudo-params (Sensitivity/Expansion/Smoothing) live in their own
    // store rather than sceneSettings.ts — this map picks the right
    // manual-value getter by key, falling back to a real scene setting.
    const pseudoGetters: Record<string, (sceneId: string) => number> = {
      [getSensitivitySpec().key]: getSensitivity,
      [getExpansionSpec().key]: getExpansion,
      [getSmoothingSpec().key]: getSmoothing,
    };
    const current = (pseudoGetters[spec.key] ?? ((id: string) => getSceneSetting(id, spec)))(sceneId);
    seedAuto(sceneId, spec.key, current);
  }
  setAutoEnabled(sceneId, spec.key, on);
}

// The whole-mic membership itself lives in micAuto.ts (see its header) —
// this is only the wiring from that module's injected getters/setters to
// this app's own store functions, reused by both DeviceMenuDeps.isMicAuto
// and .onMicAutoToggle below.
const micAutoMembers = {
  isAutoGainAuto,
  setAutoGainAuto,
  isSilenceGateAuto,
  setSilenceGateAuto,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
  isSettingAutoEnabled: isAutoEnabled,
  onSettingAutoToggle,
};

function wireDeviceMenu(): void {
  deviceMenu = createDeviceMenu({
    getPalettes: () => menuItems(PALETTES),
    currentSceneId: () => scene.id,
    currentPaletteId: () => palette.id,
    // What the column head's status line (above the Bands card) reports as
    // the audio source. A
    // renderer has no local analyser — its bands arrive over the room.
    getAudioStatus: () => ({
      source: syntheticFeed ? "synthetic" : mode === "renderer" ? "remote" : capture ? captureAudioSource(capture.kind) : "none",
      sampleRate: capture?.context.sampleRate ?? null,
    }),
    // The Input card's Source row. Null (row hidden) on a renderer or the
    // synthetic feed — see DeviceMenuDeps.getSourceState's doc comment.
    getSourceState: () => (mode === "renderer" || syntheticFeed ? null : currentSourceState()),
    // No capture yet (e.g. the start prompt is up because autoStartSource()
    // refused to auto-open a display picker) — the chip tap itself IS the
    // explicit gesture, so start fresh rather than hot-swap: swapAudioSource
    // deliberately bails with no live capture to swap out of. Stays
    // synchronous up to ensureAudio so a display choice keeps the tap's
    // transient activation.
    onAudioSourceChange: (choice) => {
      if (!bandAnalyser && mode !== "renderer" && !syntheticFeed) {
        setAudioSourceChoice(choice);
        void ensureAudio(choice);
      } else void swapAudioSource(choice);
    },
    // The Source row's device list (src/audio/inputDevice.ts).
    getInputDevices: () => {
      const pref = getInputDevicePref();
      const resolved = resolveInputDeviceId(pref, inputDevices.map((o) => ({ kind: "audioinput" as const, ...o })));
      return {
        options: inputDevices,
        defaultLabel: defaultInputName,
        missing: pref && resolved === "missing" ? pref : null,
        liveLabel: liveInputLabel(),
      };
    },
    onInputDeviceChange: (deviceId) => chooseInputDevice(deviceId),
    canCaptureDisplay: () => displayCaptureSupported(),
    // The Source row's status line — src/audio/inputHealth.ts. Read on the
    // row's own refresh timer, same as getSourceState/getInputDevices above,
    // not on every rAF tick (see lastInputHealth's own doc comment).
    getInputHealth: () => lastInputHealth,
    getInputLevel: (deviceId) => inputPreview?.level(deviceId) ?? null,
    setInputPreviewActive: (active) => {
      inputPreviewActive = active;
      syncInputPreview();
    },
    onInputHiddenChange: (label, hide) => {
      setInputHidden(label, hide);
      syncInputPreview(); // a hidden input's idle preview closes, a shown one opens
    },
    onPickPalette: (id) => applyPalette(getPalette(id)),
    getSensitivity: (sceneId) => getSensitivity(sceneId),
    onSensitivityChange: (sceneId, value) => {
      setAutoEnabled(sceneId, getSensitivitySpec().key, false);
      setSensitivity(sceneId, value);
    },
    getExpansion: (sceneId) => getExpansion(sceneId),
    onExpansionChange: (sceneId, value) => {
      setAutoEnabled(sceneId, getExpansionSpec().key, false);
      setExpansion(sceneId, value);
    },
    getSmoothing: (sceneId) => getSmoothing(sceneId),
    onSmoothingChange: (sceneId, value) => {
      setAutoEnabled(sceneId, getSmoothingSpec().key, false);
      setSmoothing(sceneId, value);
    },
    getSceneSettings: (sceneId) => getScene(sceneId)?.settings ?? [],
    getScene: (sceneId) => getScene(sceneId),
    getSceneSettingValue: (sceneId, spec) => getSceneSetting(sceneId, spec),
    getSceneSettingDefault: (sceneId, spec) => settingDefault(sceneId, spec),
    onSceneSettingChange: (sceneId, spec, value) => {
      setAutoEnabled(sceneId, spec.key, false);
      setSceneSetting(sceneId, spec, value);
    },
    onSceneSettingsReset: (sceneId) => resetSceneSettings(sceneId, getScene(sceneId)?.settings ?? []),
    listLooks,
    onSaveLook: (sceneId, name) => saveLook(captureLook(name, sceneId, getScene(sceneId)?.settings ?? [])),
    onApplyLook: (look) => {
      const specs = getScene(look.sceneId)?.settings ?? [];
      primeUndo(look.sceneId, specs);
      applyLook(look, specs);
    },
    onDeleteLook: deleteLook,
    decodeLook,
    buildShareLink: (look) =>
      `${location.origin}${location.pathname}?look=${encodeLook(look)}#/v/${encodeURIComponent(look.sceneId)}`,
    hasLookUndo,
    onUndoLook: (sceneId) => {
      const look = takeUndo(sceneId);
      if (look) applyLook(look, getScene(sceneId)?.settings ?? []);
    },
    getBandSplit: () => getBandSplit(),
    getBandEdgesHz: () => bandAnalyser?.bandEdgesHz ?? nominalBandEdgesHz(),
    getBandGain: (sceneId, fader) => getBandGain(sceneId, fader),
    onBandGainChange: (sceneId, fader, value) => setBandGain(sceneId, fader, value),
    onBandGainsReset: (sceneId) => resetBandGains(sceneId),
    getDriveSetting: (sceneId, spec) => getDriveSetting(sceneId, spec),
    onSetDriveSetting: (sceneId, spec, setting) => setDriveSetting(sceneId, spec, setting),
    onResetDriveSetting: (sceneId, spec) => resetDriveSetting(sceneId, spec),
    onUnplugAll: (sceneId, spec) => setDriveSetting(sceneId, spec, { mix: "add", sources: [] }),
    onTogglePatchSource: (sceneId, spec, choice) => togglePatchSource(sceneId, spec, choice),
    onSetSourceWeight: (sceneId, spec, choice, weight) => setSourceWeight(sceneId, spec, choice, weight),
    onSetSourceHeight: (sceneId, spec, choice, height) => setSourceHeight(sceneId, spec, choice, height),
    onSetSourceEvery: (sceneId, spec, choice, every) => setSourceEvery(sceneId, spec, choice, every),
    onSetSourceGrid: (sceneId, spec, grid) => setSourceGrid(sceneId, spec, grid),
    onSetPatchMix: (sceneId, spec, mix) => setPatchMix(sceneId, spec, mix),
    onSetSourceRole: (sceneId, spec, index, role) => setSourceRole(sceneId, spec, index, role),
    onSetSourceMuted: (sceneId, spec, index, muted) => setSourceMuted(sceneId, spec, index, muted),
    getDriveLine: (sceneId, spec) => getDriveLine(sceneId, spec),
    setDriveLineBand: (sceneId, spec, band, height) => setDriveLineBand(sceneId, spec, band, height),
    setDriveLine: (sceneId, spec, heights) => setDriveLine(sceneId, spec, heights),
    resetDriveLine: (sceneId, spec) => resetDriveLine(sceneId, spec),
    getDriveLineStrength: (sceneId, spec) => getDriveLineStrength(sceneId, spec),
    getDriveThresholdState: (sceneId, spec) => getDriveThresholdState(sceneId, spec),
    onSetDriveThreshold: (sceneId, spec, value) => setDriveThreshold(sceneId, spec, value),
    onSetDriveThresholdOn: (sceneId, spec, on) => setDriveThresholdOn(sceneId, spec, on),
    setDriveLineStrength: (sceneId, spec, value) => setDriveLineStrength(sceneId, spec, value),
    onLufsReset: () => lufsAnalyser?.reset(),
    resolveSceneSettingValue: (sceneId, spec) => resolveSceneSetting(sceneId, spec),
    resolveSensitivityValue: (sceneId) => resolveSensitivity(sceneId),
    resolveExpansionValue: (sceneId) => resolveExpansion(sceneId),
    resolveSmoothingValue: (sceneId) => resolveSmoothing(sceneId),
    getSensitivitySpec: () => getSensitivitySpec(),
    getExpansionSpec: () => getExpansionSpec(),
    getSmoothingSpec: () => getSmoothingSpec(),
    isSettingAutoEnabled: (sceneId, key) => isAutoEnabled(sceneId, key),
    onSettingAutoToggle,
    isSceneAuto: (sceneId) =>
      isSceneAuto(sceneId, [
        ...(getScene(sceneId)?.settings ?? []),
        getSensitivitySpec(),
        getExpansionSpec(),
        getSmoothingSpec(),
      ]),
    onSceneAutoToggle: (sceneId, on) =>
      setSceneAuto(
        sceneId,
        [...(getScene(sceneId)?.settings ?? []), getSensitivitySpec(), getExpansionSpec(), getSmoothingSpec()],
        on,
      ),
    getSceneMaster: () => getSceneMaster(),
    onSceneMasterChange: (value) => setSceneMaster(value),
    getSceneExpansion: () => getSceneExpansion(),
    onSceneExpansionChange: (value) => setSceneExpansion(value),
    // The Master card's Picture block — null whenever the meter's gone stale
    // (the panel was just opened, so nothing has pushed a reading into it
    // yet, or the sampling loop is gapped for longer than a full reset — see
    // PICTURE_GAP_RESET_MS) rather than showing a frozen last reading.
    getPictureReading: () => (performance.now() - pictureMeter.lastAtMs < PICTURE_GAP_RESET_MS ? pictureMeter.latest() : null),
    getAutoGain: () => getAutoGain(),
    onAutoGainChange: (value) => {
      setAutoGainAuto(false);
      setAutoGain(value);
    },
    isAutoGainAuto: () => isAutoGainAuto(),
    onAutoGainAutoToggle: (on) => setAutoGainAuto(on),
    resolveAutoGain: () => resolveAutoGain(),
    getSilenceGate: () => getSilenceGate(),
    // A drag hands the gate back to manual first, same as onAutoGainChange
    // above — otherwise resolveSilenceGate() would keep serving the auto
    // marks and the drag would do nothing.
    onSilenceGateClosedChange: (value) => {
      setSilenceGateAuto(false);
      setSilenceGateClosed(value);
    },
    onSilenceGateOpenChange: (value) => {
      setSilenceGateAuto(false);
      setSilenceGateOpen(value);
    },
    isSilenceGateAuto: () => isSilenceGateAuto(),
    onSilenceGateAutoToggle: (on) => setSilenceGateAuto(on),
    resolveSilenceGate: () => resolveSilenceGate(),
    getHitShape: () => getHitShape(),
    setHitShape: (partial) => setHitShape(partial),
    isMicAuto: (sceneId) => isMicAuto(sceneId, micAutoMembers),
    onMicAutoToggle: (sceneId, on) => setMicAuto(sceneId, on, micAutoMembers),
    getPowerMode: () => powerMode,
    onPowerModeChange: (mode) => {
      setPowerMode(mode);
      applyPowerMode(mode);
    },
    // While an output is open the card is the preview's: its Quality chips
    // bind to the preview's own choice, not the device's.
    getQualityChoice: () => (previewActive ? previewChoice : qualityChoice),
    onQualityChoiceChange: (choice) => {
      if (previewActive) {
        setPreviewQualityChoice(choice);
        previewChoice = choice;
      } else {
        setQualityChoice(choice);
        qualityChoice = choice;
      }
      applyRenderQuality();
    },
    isPreview: () => previewActive,
    getPreviewSize: () => previewSize,
    onPreviewSizeChange: (size) => {
      setPreviewSize(size);
      previewSize = size;
      applyPreviewBox();
    },
    getPreviewResolution: () => previewResolution,
    onPreviewResolutionChange: (value) => {
      setPreviewResolution(value);
      previewResolution = getPreviewResolution();
    },
    getOutputPowerStatus: () => outputBridge?.outputStatus() ?? null,
    getOutputQualityChoice: () => outputPower.quality,
    onOutputQualityChoiceChange: (choice) => {
      setOutputQualityChoice(choice);
      outputPower = { ...outputPower, quality: choice };
      outputBridge?.sendPower();
    },
    getOutputResolution: () => outputPower.resolution,
    onOutputResolutionChange: (value) => {
      setOutputResolution(value);
      outputPower = { ...outputPower, resolution: getOutputResolution() };
      outputBridge?.sendPower();
    },
    getOutputPowerMode: () => outputPower.mode,
    onOutputPowerModeChange: (mode) => {
      setOutputPowerMode(mode);
      outputPower = { ...outputPower, mode };
      outputBridge?.sendPower();
    },
    getPowerStatus: () => ({
      mode: powerMode,
      choice: previewActive ? previewChoice : qualityChoice,
      recommended: detectedPreset,
      fps: lastFps,
      level: governor?.level ?? null,
      maxLevel: governor?.maxLevel ?? 0,
      fraction: governor?.fraction ?? 1,
      standingDown: governor?.standingDown ?? false,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
    }),
    // Rollup replaces import.meta.env.DEV with a literal `false` in a
    // production build, folding this to `undefined` and — since pins.ts
    // carries no module-scope side effect (see its header) — letting the
    // whole module tree-shake out, the same way autoTune.ts's own DEV-gated
    // import of tuning/overrides.ts already does.
    devPin: import.meta.env.DEV ? { get: getPin, set: setPin, clear: clearPin } : undefined,
    toggleButton: menuBtn,
  });
  menuBtn.addEventListener("click", () => deviceMenu!.toggle());
}

/** Any device can drive the room, not just the host — this wires the panel,
 *  incoming remote commands, and the roster announcement for whichever
 *  connection (host or renderer) is currently active. Works from the
 *  gallery too: room control is a room capability, not a viz capability. */
function wireRoomControls(conn: AnyConn): void {
  const panel = createControlPanel({
    getRoster: () => conn.currentRoster,
    onRosterChange: (cb) => conn.onRosterChange(cb),
    setDevice: (targetId, cmd) => conn.sendSetDevice(targetId, cmd),
    scenes: menuItems(availableScenes()),
    palettes: menuItems(PALETTES),
    selfDeviceId: conn.deviceId,
  });
  panelBtn.style.display = "block";
  panelBtn.addEventListener("click", () => panel.toggle());

  conn.onCommand((cmd) => {
    if (cmd.scene) {
      const s = getScene(cmd.scene);
      if (s && presetAllows(s, effectivePreset())) {
        if (inViz) applyScene(s);
        else {
          // Commanded while idle on the gallery (e.g. a mosaic/panorama
          // layout assigned from another device's room panel) — this
          // device's job is to actually render its slice, so jump in.
          void enterViz(s);
          navigate({ kind: "viz", sceneId: s.id }, "push");
        }
      }
    }
    if (cmd.palette) applyPalette(getPalette(cmd.palette));
    if (cmd.viewport) applyViewport(cmd.viewport);
  });

  conn.sendHello(scene.id, palette.id, viewport);
}

async function enterViz(next: Scene): Promise<void> {
  gallery?.hide();
  inViz = true;
  canvas.style.display = "block";

  scene = next;
  // Before the mount (see applyScene); previewActive is still false on a
  // fresh entry and turns on at the next tick, which remounts if needed.
  if (previewActive) applyRenderQuality();
  mainHost!.unmountAll();
  mainHost!.mount(next);
  updateSceneVersionLabel(next);

  showHud(`${mode}${roomCode ? ` (${roomCode})` : ""}  quality: ${quality.preset}  scene: ${scene.name}  palette: ${palette.name}`);
  activeConn()?.sendHello(scene.id, palette.id, viewport);

  menuBtn.style.display = "block";
  fsBtn.style.display = "block";
  if (!bypassGallery) backBtn.style.display = "block";
  sceneVersion.style.display = "inline";
  outputControls?.setVisible(true);

  if (mode !== "renderer") void ensureAudio();
  updateMicPrompt();
  reportUsage();
  void requestWakeLock();
  immersive?.resume();
}

function exitToGallery(): void {
  inViz = false;
  // The panel belongs to the viz — its gear hides just below, so leaving it
  // open would strand it over the gallery with no way to close it. Every
  // exit (Escape, the back button, browser Back) funnels through here.
  deviceMenu?.close();
  menuBtn.style.display = "none";
  fsBtn.style.display = "none";
  backBtn.style.display = "none";
  stopBtn.style.display = "none";
  sceneVersion.style.display = "none";
  outputControls?.setVisible(false);
  hideTooltip(); // a version hint left open by a tap mustn't follow us out
  audioPrompt.style.display = "none";
  mainHost?.unmountAll();
  canvas.style.display = "none";
  immersive?.pause();
  gallery?.show();
}

function applyRoute(route: Route): void {
  if (route.kind === "gallery") {
    // Covers both the initial boot landing (inViz starts false) and a
    // return trip from a viz — exitToGallery() calls gallery.show() itself.
    if (inViz) exitToGallery();
    else gallery?.show();
    return;
  }
  if (inViz && route.sceneId === scene.id) return; // our own applyScene() echo
  const s = getScene(route.sceneId);
  if (!s || !presetAllows(s, effectivePreset())) {
    showHud(s ? "scene unavailable on this device" : "unknown scene", true);
    navigate({ kind: "gallery" }, "replace");
    return;
  }
  void enterViz(s);
}

async function boot(): Promise<void> {
  // Injects the panel's stylesheet before anything else so its DSEG7
  // @font-face rule (controlsTheme.ts) is already in document.fonts by the
  // time pinEverything()'s sweep runs below — otherwise the font would only
  // enter document.fonts whenever the settings panel first opens
  // (deviceMenu.ts's own ensureControlsStyles() call), which can be well
  // after a deploy has moved on. Idempotent and scoped to panel classes, so
  // calling it this early changes nothing the gallery itself shows.
  ensureControlsStyles();
  // Starts the after-load, at-idle sweep that fetches every pinAsset() (the
  // tempo worklet, the Dancers clip library) and loads every registered font
  // — see src/pinnedAssets.ts's header for why a page must never need its
  // own origin's files again after this point.
  pinEverything();

  // The scene's own version corner (#sceneVersion in index.html) is filled
  // by updateSceneVersionLabel() from enterViz()/applyScene() below, for
  // whichever scene is actually shown — nothing to do here before one of
  // those runs (the element starts `display: none` in index.html).

  // Started first so it resolves alongside detectQuality()'s await below;
  // awaited before routing, since a deep-linked scene's enterViz() makes the
  // first autoStartSource() call.
  const micPermissionReady = watchMicPermission((p) => {
    micPermission = p;
  });
  // The Source row's input dropdown — see refreshInputDevices and
  // onInputDevicesChanged. Labels are already readable here whenever the
  // mic's permission was granted on an earlier visit.
  void refreshInputDevices();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => void onInputDevicesChanged());

  if (!document.createElement("canvas").getContext) {
    fatalError("Canvas unsupported");
    return;
  }

  let gl: WebGL2RenderingContext;
  try {
    // preserveDrawingBuffer only in dev: without it, WebGL clears the buffer
    // on composite, so tuning/capture.ts's async drawImage(canvas, ...) reads
    // back solid black — it always runs at least one task after the frame
    // that drew it. A prod build never sets this (import.meta.env.DEV is a
    // literal false there), so the normal cost of preserveDrawingBuffer
    // (no implicit-clear optimization) never ships.
    gl = createGL(canvas, { preserveDrawingBuffer: import.meta.env.DEV });
  } catch (err) {
    console.error(err);
    fatalError("WebGL2 unsupported on this device");
    return;
  }

  const params = new URLSearchParams(location.search);
  const joinCode = params.get("room");
  const wantsHostRole = params.get("role") === "host";
  bypassGallery = !!joinCode && !wantsHostRole;

  if (params.get("audio") === "synthetic") {
    const bpm = Number(params.get("bpm"));
    syntheticFeed = createSyntheticFeed({ bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined });
    syntheticStartMs = performance.now();
  }

  // `?quality=` (dev-only, `?tier=` accepted as an alias) lets a headless
  // capture tool force a specific preset instead of running
  // detectQuality()'s benchmark — SwiftShader (what tools/tune-sheet.mjs
  // runs on) is genuinely slow, so an unpinned capture self-detects
  // "low"/"floor" and renders at a fraction of the resolution and octave
  // count real hardware gets, making any contact sheet measure the wrong
  // thing. Pinning also skips the governor entirely: a fixed preset is for
  // reproducible capture, not for exercising the closed-loop stepper
  // (that's what the unpinned path and tests/governor.test.ts are for). A
  // pin still reads as `detectedPreset` (see effectivePreset() above), so
  // the Power card's "recommended" marker tracks it too.
  const devPin = import.meta.env.DEV ? parseQualityPreset(params) : null;
  pinned = devPin !== null;
  detectedPreset = devPin ?? (await detectQuality());
  quality = qualitySettings(renderPreset());
  mainHost = createSceneHost(gl, quality);
  if (!presetAllows(scene, effectivePreset())) scene = availableScenes()[0] ?? scene;
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);

  if (bypassGallery) {
    // Plain ?room=CODE — join as a mic-less renderer (e.g. a second laptop just watching).
    mode = "renderer";
    roomCode = joinCode!.toUpperCase();
    rendererConn = new RendererConnection(roomCode);
    startRendererDisconnectWatch();
  } else {
    // No code -> create a fresh room and host it (the classic "open the site" flow).
    // ?room=CODE&role=host -> become host of a code someone else (a TV) already created.
    try {
      roomCode = joinCode ? joinCode.toUpperCase() : await createRoomCode();
      hostConn = new HostConnection(roomCode);
      mode = "host";
    } catch (err) {
      console.warn("Room server unreachable, running solo:", err);
      mode = "solo";
      roomCode = null;
    }
  }

  if ((mode === "host" || mode === "renderer") && roomCode) {
    roomCodeEl.textContent = `room: ${roomCode}`;
    roomCodeEl.style.display = "block";
    // The room view: this room's QR + code, and the field to type another
    // room's code. Stays open until dismissed — it holds a text field now.
    const invite = createJoinScreen("renderer", document.body, { dismissible: true });
    invite.setCode(roomCode);
    roomCodeEl.addEventListener("click", () => invite.show());
  }

  wireDeviceMenu();
  const conn = activeConn();
  if (conn) wireRoomControls(conn);

  immersive = createImmersiveMode({
    button: fsBtn,
    isMenuOpen: () => deviceMenu?.isOpen() ?? false,
  });
  fsBtn.addEventListener("click", () => immersive!.toggle());

  outputBridge = createOutputBridge({
    transport: createBroadcastTransport<ToOutput, ToMain>(),
    look: () => ({ scene: scene.id, palette: palette.id }),
    power: () => outputPower,
  });
  outputControls = createOutputControls(outputBridge, { popBtn: outBtn, cueBtn, goBtn, stateEl: outStateEl, barEl: outBarEl });
  outputControls.setVisible(inViz);
  wireOutputKeys(outputControls);

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  window.addEventListener("keydown", (e) => {
    // Modifier guard so ⌘/Ctrl+F (browser find) and ⌘/Ctrl+S (save page)
    // pass through untouched instead of driving these — mirrors the guard
    // deviceMenu.ts's own document-level handler already uses.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "f" || e.key === "F") {
      noteKeyUse("fullscreen");
      immersive?.toggle();
    }
    // Only live in a viz — the exact condition that shows menuBtn itself
    // (enterViz/exitToGallery below), so the key and the gear it mirrors
    // appear and disappear together. Reuses the same toggle() the gear's
    // click handler calls, rather than reimplementing open/close here.
    if ((e.key === "s" || e.key === "S") && inViz) {
      noteKeyUse("panel");
      deviceMenu?.toggle();
    }
    if (e.key === "Escape") {
      // The panel's own document-level handler runs first and claims Escape
      // to unpin a pinned card (preventDefault) — that press shouldn't also
      // throw the viewer out of the scene.
      if (e.defaultPrevented) return;
      if (immersive?.active()) {
        immersive.exit();
        return;
      }
      if (inViz && !bypassGallery) navigate({ kind: "gallery" }, "push");
    }
    // Beat trim: bar resync, ×2/÷2 and a small earlier/later nudge — see
    // src/render/beatTrim.ts for the why and the math. e.code (physical
    // key), not e.key like f/s above, so a Cyrillic or German layout still
    // reaches these; only live in a viz, like S, and skipped while typing
    // somewhere, the same guard deviceMenu.ts's own hotkeys already use.
    if (inViz && !isTypingTarget(e.target)) {
      // Output window: K is Cue (hold it), G plays (an instant send) — plain-
      // letter twins of Space and Option, which wireOutputKeys below owns.
      // No-ops unless an output window is open.
      if (e.code === "KeyG" && outputControls?.go()) {
        e.preventDefault();
        noteKeyUse("go");
        showHud("Play: sent to output");
      } else if (e.code === "KeyK") {
        // Held like Space: wireOutputKeys's keyup lets go.
        if (outputControls?.holdCue(true)) {
          e.preventDefault();
          if (!e.repeat) noteKeyUse("cue");
        }
      } else if (e.code === "KeyB") {
        e.preventDefault();
        noteKeyUse("beat-one");
        if (e.shiftKey) {
          resetBeatTrim();
          showHud("Tempo ×1, beat timing reset");
        } else {
          requestBarResync();
          showHud("This beat is the 1");
        }
      } else if (e.code === "BracketRight" || e.code === "BracketLeft") {
        e.preventDefault();
        noteKeyUse("tempo-x");
        // lastAnim is one render tick stale (this handler runs synchronously
        // on keydown, before the next animClock.advance() picks up the new
        // multiplier) — so its own metronomeBpm still carries the *old*
        // multiplier. Divide that back out to the un-multiplied tempo, then
        // apply the new multiplier, rather than showing a beat behind.
        const before = getBeatTrim();
        const baseBpm = lastAnim?.metronomeOn && before.multiplier > 0 ? lastAnim.metronomeBpm / before.multiplier : 0;
        const m = stepTempoMultiplier(e.code === "BracketRight" ? 1 : -1);
        const label = m === 2 ? "×2" : m === 0.5 ? "÷2" : "×1";
        showHud(`Tempo ${label}${baseBpm > 0 ? ` — ${Math.round(baseBpm * m)} BPM` : ""}`);
      } else if (e.code === "Comma" || e.code === "Period") {
        e.preventDefault();
        noteKeyUse("beat-nudge");
        const off = nudgeBeatOffset(e.code === "Comma" ? 10 : -10);
        showHud(off === 0 ? "Beats on time" : off > 0 ? `Beats ${off} ms earlier` : `Beats ${-off} ms later`);
      }
    }
  });
  backBtn.addEventListener("click", () => navigate({ kind: "gallery" }, "push"));
  // Stop is the deliberate form of what onCaptureEnded handles when the
  // browser ends a capture on its own: release the mic/share, and put the
  // start prompt back so listening resumes only on a tap. The room
  // connection is untouched, same as there.
  stopBtn.addEventListener("click", () => {
    if (capture) onCaptureEnded(capture);
  });
  refreshAudioPromptButtons(); // support never changes mid-session, so this runs once
  audioPromptMicBtn.addEventListener("click", () => void ensureAudio("mic"));
  audioPromptDisplayBtn.addEventListener("click", () => void ensureAudio("display"));

  micPermission = await micPermissionReady;
  if (bypassGallery) {
    void enterViz(scene);
  } else {
    gallery = createGallery({
      scenes: () =>
        listScenes().map((s) => {
          const enabled = presetAllows(s, effectivePreset());
          return {
            scene: s,
            enabled,
            draft: DRAFT_SCENE_IDS.has(s.id),
            reason: enabled ? undefined : "Needs a faster device",
          };
        }),
      quality: () => quality,
      liveFrame: () => lastVis,
      onPick: (id) => {
        // A tile tap picks a scene, not a source — so it's an implicit start
        // like any other: silent if the mic's permission is still active,
        // otherwise nothing, and the scene's start prompt asks (see
        // autoStartSource). Already-live capture just carries on.
        void ensureAudio();
        navigate({ kind: "viz", sceneId: id }, "push");
      },
      onDisabledPick: (id, reason) => showHud(`${id}: ${reason}`, true),
      canCaptureDisplay: () => displayCaptureSupported(),
      sourceState: () => currentSourceState(),
      micLabel: () => inputChoiceLabel(),
      onSourceChoice: (next) => {
        if (bandAnalyser) return swapAudioSource(next); // persists the pref itself, once the swap lands
        // Nothing live yet: remember the choice AND start it, inside this same
        // click — a picker that only stored a pref read as buttons that do
        // nothing. The click is a real gesture, so "display" may open the
        // share picker here.
        setAudioSourceChoice(next);
        return ensureAudio(next);
      },
    });

    // A shared look link (?look=<code>#/v/<id>, see looksCard.ts's
    // buildShareLink) — applied once here, before routing, so enterViz below
    // mounts the scene with the look's tuning already in place. The param is
    // stripped either way so a reload can't re-apply it over edits made
    // since, or repeat a broken link on every refresh.
    const lookCode = params.get("look");
    if (lookCode) {
      const look = decodeLook(lookCode);
      const targetScene = look ? getScene(look.sceneId) : undefined;
      if (!look) {
        // Deferred: the hash below (e.g. #/v/mesh, still present even when
        // the ?look= code itself is corrupt) routes normally either way, and
        // applyRoute -> enterViz below writes its own HUD line synchronously
        // — a same-tick showHud here would be overwritten before anyone
        // reads it.
        setTimeout(() => showHud("that look link didn't parse", true), 0);
      } else if (!targetScene) {
        setTimeout(() => showHud("that look is for an unknown scene", true), 0);
      } else {
        saveSharedLook(look);
        const specs = targetScene.settings ?? [];
        primeUndo(look.sceneId, specs);
        applyLook(look, specs);
        navigate({ kind: "viz", sceneId: look.sceneId }, "replace");
      }
      history.replaceState(null, "", location.pathname + location.hash);
    }

    seedHistory();
    onRouteChange(applyRoute);
    applyRoute(currentRoute());
  }

  // Dynamic import behind a literal DEV check: Vite replaces
  // import.meta.env.DEV with `false` in a production build, so this branch
  // (and the tuning module graph it pulls in) is dead code Rollup strips
  // rather than something that ships and merely goes unused. See the plan's
  // prod-safety verification step.
  if (import.meta.env.DEV) {
    const { initTuning } = await import("./tuning/debug.ts");
    initTuning({
      getInput: () => ({
        sceneId: scene.id,
        settings: scene.settings ?? [],
        quality: quality.preset,
        fps: lastFps,
        vis: lastVis,
        anim: lastAnim,
        renderScale: renderScale(),
        govLevel: governor?.level ?? 0,
        deepMono: lastDeepMono,
        sampleRate: capture?.context.sampleRate ?? null,
        fluxRatio: lastFluxRatio,
      }),
      // The Master card's Picture block, driven headlessly — tools/master-
      // sweep.mjs's __viz.pictureForce/picture/pictureReset, and __viz.
      // setMaster/scenes for its per-(scene, master value) sweep.
      picture: {
        force: (on: boolean) => {
          pictureForced = on;
        },
        read: () => ({ latest: pictureMeter.latest(), mean: pictureAverager.mean(), samples: pictureAverager.count }),
        reset: () => pictureAverager.reset(),
      },
      setMaster: (v: number) => setSceneMaster(v),
      scenes: () =>
        listScenes().map((s) => ({ id: s.id, name: s.name, draft: DRAFT_SCENE_IDS.has(s.id), paid: PAID_SCENE_IDS.has(s.id) })),
    });
  }

  lastRafMs = performance.now();
  requestAnimationFrame(loop);
  // A hidden tab gets no animation frames, which would starve the pop-out
  // output (and a paired TV) of the frames this loop sends — see
  // net/backgroundTick.ts.
  startBackgroundTick(() => {
    if (shouldTickInBackground(document.hidden, (outputBridge?.status().open ?? false) || hostConn !== null)) tick();
  });
}

/** Maps this tick's raw dB bands straight to [0,1] via the analyser's fixed
 *  floor/ceiling — no adaptive envelope, no gain. Writes into the shared
 *  scratch buffer and returns it; callers needing to hold onto the values
 *  across a tick must copy (see spectrumStrip.ts, which does). */
function captureRawBands(dbBands: Float32Array, range: { min: number; max: number }): Float32Array {
  const span = range.max - range.min;
  for (let i = 0; i < dbBands.length; i++) {
    rawBandsScratch[i] = Math.min(1, Math.max(0, (dbBands[i] - range.min) / span));
  }
  return rawBandsScratch;
}

/** This tick's InputMeasure for src/audio/inputHealth.ts: peakL/peakR/
 *  glitchFrames off the tap's own read(), rmsDb/humHz off `mono` — the same
 *  buffer lastMono was just set to (see currentVisual()'s solo/host
 *  branches, the only callers). Takes `mono` as an argument rather than
 *  reading lastMono itself so this stays a plain function of its inputs. */
function buildInputMeasure(tap: InputHealthTap, mono: Float32Array, sampleRate: number): InputMeasure {
  const read = tap.read();
  const monoRms = rms(mono);
  return {
    peakL: read.peakL,
    peakR: read.peakR,
    rmsDb: monoRms > 0 ? 20 * Math.log10(monoRms) : -Infinity,
    humHz: mainsHumHz(mono, sampleRate),
    glitchFrames: read.glitchFrames,
  };
}

/** @param rateScale sensitivity.ts's smoothingRateScale(resolveSmoothing(scene.id)),
 *  computed once per tick by loop() and reused for animClock.advance() below
 *  — resolveSmoothing() slews its auto value, so calling it a second time
 *  per tick would double that slew. Forwarded into extractor.update() so a
 *  local capture's own envelope (features.ts) honors the same Smoothing
 *  the render path and the anim clock do, including its Off stop. */
function currentVisual(rateScale: number): FeatureFrame | null {
  // Reset every tick; only solo mode's own branch below (with a live
  // tempoSource) sets this back — see its own doc comment on the module
  // state above for why host/renderer/TV never do.
  lastTempoHits = undefined;
  if (syntheticFeed) {
    lastRawBands = null;
    // Synthetic frames are generated directly, not sampled from a real
    // signal — there's nothing for the scope to trace, so its card
    // correctly stays hidden here (see audioMeters.ts).
    lastMono = null;
    lastDeepMono = null;
    lastLufs = null;
    lastFixedEnergy = null;
    lastBeatDiag = null;
    lastFluxRatio = null;
    lastGate = null;
    lastInputHealth = null;
    return syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000);
  }

  if (mode === "solo") {
    if (!bandAnalyser || !capture) {
      lastRawBands = null;
      lastMono = null;
      lastDeepMono = null;
      lastLufs = null;
      lastFixedEnergy = null;
      lastBeatDiag = null;
      lastFluxRatio = null;
      lastGate = null;
      lastInputHealth = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    lastInputHealth =
      inputHealthTap && lastMono
        ? inputHealth.advance(extractor.dtSec, buildInputMeasure(inputHealthTap, lastMono, capture.context.sampleRate))
        : null;
    lastDeepMono = measureAnalyser ? measureAnalyser.read() : null;
    lastLufs = lufsAnalyser ? lufsAnalyser.read() : null;
    const f = extractor.update(dbBands, now, resolveAutoGain(), rateScale, resolveSilenceGate());
    // The fixed-hop tempo source, when live, overrides the render-tick
    // tracker's own bpm — see tempoAnalyzer.ts's header for why its numbers
    // are better — and its drained onsets become this tick's tempoHits for
    // animClock.advance() (loop() reads lastTempoHits when it builds that
    // call's `hit` argument). `onset.time` is this same capture's own
    // AudioContext clock (tempoSource.ts's own doc), so `now` (read above)
    // converts it to agoSec directly. Weight mirrors animClock.ts's own
    // hitWeight formula (strength graded by PHASE_BASS-weighted bass) so a
    // kick counts for as much here as a render-tick hit would.
    if (tempoSource) {
      f.bpm = tempoSource.bpm;
      lastTempoHits = tempoSource.drainOnsets().map((o) => ({
        agoSec: now - o.time,
        weight: o.strength * (1 + PHASE_BASS * o.bass),
      }));
    }
    lastFixedEnergy = extractor.fixedEnergy;
    lastBeatDiag = extractor.onsetDiag;
    lastFluxRatio = extractor.fluxRatio;
    // `fired` is this local extractor's own frame's onset, not the
    // jitter-buffered visual frame currentVisual() returns for host mode
    // (sampleToVisual(hostConn.sample())) — so fired and suppressed always
    // describe the same tick's decision.
    lastGate = { dimmer: extractor.gateDimmer, fired: f.onset, suppressed: extractor.suppressed };
    // Feeds next tick's resolveAutoGain(), not this one's — see
    // feedAutoGainMeasurement's doc comment on why that one-tick lag is fine.
    feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
    // Same one-tick lag, same reason — see feedSilenceGateMeasurement's own
    // doc comment.
    feedSilenceGateMeasurement(f.level, extractor.dtSec);
    return f;
  }

  if (mode === "host") {
    if (!bandAnalyser || !capture || !hostConn) {
      lastRawBands = null;
      lastMono = null;
      lastDeepMono = null;
      lastLufs = null;
      lastFixedEnergy = null;
      lastBeatDiag = null;
      lastFluxRatio = null;
      lastGate = null;
      lastInputHealth = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    lastInputHealth =
      inputHealthTap && lastMono
        ? inputHealth.advance(extractor.dtSec, buildInputMeasure(inputHealthTap, lastMono, capture.context.sampleRate))
        : null;
    lastDeepMono = measureAnalyser ? measureAnalyser.read() : null;
    lastLufs = lufsAnalyser ? lufsAnalyser.read() : null;
    const f = extractor.update(dbBands, now, resolveAutoGain(), rateScale, resolveSilenceGate());
    // Overwritten before hostConn.sendFrame() below, same as solo mode
    // above, so the TV and any renderer get the fixed-hop tempo over the
    // unchanged wire — see currentVisual()'s solo branch for the full
    // comment. No tempoHits here: this device's own visual timeline (what
    // sampleToVisual(hostConn.sample()) returns below) is the jitter
    // buffer's room time, which this capture's local AudioContext onset
    // times wouldn't line up with — see beatClock.ts's file header.
    if (tempoSource) {
      f.bpm = tempoSource.bpm;
      tempoSource.drainOnsets(); // unused here (see above); drained so they don't queue
    }
    lastFixedEnergy = extractor.fixedEnergy;
    lastBeatDiag = extractor.onsetDiag;
    lastFluxRatio = extractor.fluxRatio;
    lastGate = { dimmer: extractor.gateDimmer, fired: f.onset, suppressed: extractor.suppressed };
    // Feeds next tick's resolveAutoGain(), not this one's — see
    // feedAutoGainMeasurement's doc comment on why that one-tick lag is fine.
    feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
    // Same one-tick lag, same reason — see feedSilenceGateMeasurement's own
    // doc comment.
    feedSilenceGateMeasurement(f.level, extractor.dtSec);
    hostConn.sendFrame(f);
    return sampleToVisual(hostConn.sample());
  }

  // renderer — no local mic, so no raw signal to show.
  lastRawBands = null;
  lastMono = null;
  lastDeepMono = null;
  lastLufs = null;
  lastFixedEnergy = null;
  lastBeatDiag = null;
  lastFluxRatio = null;
  lastGate = null;
  lastInputHealth = null;
  if (rendererConn) {
    const s = rendererConn.sample();
    if (s) rendererHasData = true;
    if (rendererHasData && rendererConn.msSinceLastFrame > STALE_TIMEOUT_MS) {
      void fallBackToSolo(rendererConn.connected ? "went quiet" : "disconnected");
    }
    return sampleToVisual(s);
  }
  return null;
}

function sampleToVisual(s: VisualSample | null): FeatureFrame | null {
  if (!s) return null;
  return {
    time: s.timeSec,
    bands: s.bands,
    energy: s.energy,
    onset: s.onsetFired,
    pulseOnset: s.pulseFired,
    bpm: s.bpm,
    onsetPhase: s.beatPhase,
    level: s.level,
  };
}

function loop(): void {
  requestAnimationFrame(loop);
  tick();
}

/** One pass of the loop: sample the audio, advance the clocks and drives, feed
 *  the pop-out output and any paired TV, then draw. Run by `loop` on every
 *  animation frame, and — while this tab is hidden and has no frames of its
 *  own — by net/backgroundTick.ts's worker clock, with the DOM and GL work
 *  skipped (`document.hidden` below), so the output keeps getting frames. */
function tick(): void {
  const nowRafMs = performance.now();
  const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
  lastRafMs = nowRafMs;

  // Resolved once per tick and reused everywhere below (extractor, anim
  // clock, the meters) — a second call would be harmless (autoTune.ts steps
  // each auto value once per tick, on its own clock), just wasted work.
  const smoothing = resolveSmoothing(scene.id);
  const rateScale = smoothingRateScale(smoothing);

  // Always sampled — in host mode this is also what feeds hostConn.sendFrame,
  // so a paired TV/renderer keeps getting frames even while this device is
  // just sitting on the gallery with nothing on screen.
  lastVis = currentVisual(rateScale);

  // The pop-out output (net/outputBridge.ts) keeps streaming even while this
  // window sits on the gallery, so a stray Esc never blanks the projector —
  // which is why the band-gained frame is built before the inViz return.
  const gained = lastVis ? applyBandGains(lastVis, getBandGains(scene.id)) : null;
  if (outputBridge) {
    outputBridge.update(nowRafMs);
    const nextActive = inViz && outputBridge.status().open;
    if (nextActive !== previewActive) {
      previewActive = nextActive;
      applyRenderQuality(true);
      applyPreviewBox();
    }
    if (gained) outputBridge.pushFrame(gained, { beatRatio: lastFluxRatio, wavePeak: lastMono ? peak(lastMono) : null }, { sens: outputSens, exp: outputExp, smoothing });
  }

  if (!inViz) {
    if (!document.hidden) gallery?.tick(nowRafMs);
    return;
  }

  // Applied once, upstream of every consumer below — deviceMenu's spectrum
  // strip included — so the Bands card's faders show up everywhere
  // consistently: the "processed" feed the strip draws is built from this
  // same frame (see deviceMenu.ts's update()), so a band cut to Off reads as
  // Off there too, not just in the render path. lastVis itself stays
  // ungained — it still feeds hostConn.sendFrame, which shouldn't hear a
  // purely local gain tweak — and is also what the strip draws as the ghost
  // behind a faded bar.
  // Anim clock now advances here, ahead of deviceMenu.update() below — the
  // listening post's transport/bands/section/dial meters (audioMeters.ts)
  // read this tick's AnimFrame, not just the raw FeatureFrame. Only advances
  // when there's a frame to feed it (gained non-null); when it's null (mic
  // still pending) anim stays null too, the same outcome as before this
  // moved (the loop used to return, further down, before ever reaching
  // animClock.advance in that case). Feature extraction and the anim clock
  // itself (beat/flow/band-pulse/section-intensity decay) still run on every
  // rAF tick regardless of the render-rate cap below — only the GPU draw is
  // rate-capped. `lastFluxRatio` is this same tick's local extractor reading
  // (null on host/renderer paths with no local extractor — see its own doc
  // comment below) — passed as the graded broadband pulse's own ratio so it
  // doesn't have to fall back to a band's own ratio on a device that has a
  // real broadband reading to give it. `lastTempoHits` is solo-mode-only
  // (undefined every host/renderer/TV tick — see its own doc comment on the
  // module state above) and switches beatClock.ts's phase comb onto the
  // fixed-hop feed for this tick when a tempo source is live. `lastMono`'s
  // own peak feeds AnimFrame.wavePeak (the Signal card's Waveform readout and
  // its drive jack); null on any device with no local mic.
  const anim = gained
    ? animClock.advance(dtSec, gained, smoothing, resolveSilenceGate(), {
        shape: getHitShape(),
        beatRatio: lastFluxRatio,
        tempoHits: lastTempoHits,
        wavePeak: lastMono ? peak(lastMono) : null,
      })
    : null;

  // Reused for displayFrame at render time below instead of re-resolving —
  // see the comment on `smoothing` above.
  let sensitivity = 1;
  let expansion = 1;

  if (anim) {
    lastAnim = anim;
    advanceAutoTune(dtSec, anim.profile);
    // Every tick, whether or not it renders — see renderLatch.ts. A tick
    // that turns out not to render still needs its edges remembered.
    renderLatch.accumulate(anim);

    sensitivity = resolveSensitivity(scene.id);
    expansion = resolveExpansion(scene.id);
    outputSens = sensitivity;
    outputExp = expansion;
    // The drive engine's own per-tick advance (src/render/drives.ts's
    // header) — grid pulses and a setting's own drawn-line peak-hold need
    // every rAF tick, not just a render tick, same reasoning as
    // renderLatch.accumulate above. `driveEnergy` is the sensitivity-applied
    // energy a scene's own uEnergy sees at render — computed here, every
    // tick, so the "All level" catalogue source never lags a render by more
    // than this same tick's own gap.
    const driveEnergy = applySensitivity(gained!, sensitivity, expansion).energy;
    driveEngine.accumulate(dtSec, gained!, driveEnergy, anim, scene.id, scene.settings ?? []);
  }

  // Fed even when null (mic permission still pending) so the spectrum strip
  // can render its "waiting for audio" idle state instead of going dead.
  // `rateScale` lets the meters panel (audioMeters.ts) bypass its own BPM
  // settle and waveform peak-hold at Smoothing's Off stop, same as above.
  // `liveDrives`, off this tick's own (un-latched) AnimFrame, is purely for
  // a drive row's live pill/overlay — it only ever reads uniformPair()/
  // excess(), never fired(), so it can't steal a grid setting's pending edge
  // out from under the scene that's about to render it (see drives.ts).
  // Nobody is looking at this tab, so it has no meters or picture to update
  // (the only way here without an animation frame is the background clock).
  // The idle demo still runs, since it is what the output shows with no input.
  if (document.hidden) {
    if ((!lastVis || !anim) && idlePreviewActive()) renderIdlePreview(nowRafMs, dtSec, smoothing);
    return;
  }

  // Only built while the panel is open: update() returns before it touches
  // `drives` when closed, and forScene() allocates a Map and a dozen closures.
  const liveDrives = anim && deviceMenu?.isOpen() ? driveEngine.forScene(scene.id, scene.settings ?? [], anim) : null;
  deviceMenu?.update(gained, lastRawBands, lastVis, pinnedBands(), anim, lastMono, rateScale, lastFixedEnergy, lastLufs, lastBeatDiag, lastGate, liveDrives);

  if (!lastVis || !anim) {
    if (idlePreviewActive()) renderIdlePreview(nowRafMs, dtSec, smoothing);
    return;
  }

  drawScene(nowRafMs, gained!, sensitivity, expansion, anim, renderLatch, driveEngine);
}

/** The scene's render tail, shared by live audio and the idle preview — each
 *  passes its own latch and drive engine (see idlePreview's doc comment). */
function drawScene(
  nowRafMs: number,
  gained: FeatureFrame,
  sensitivity: number,
  expansion: number,
  anim: AnimFrame,
  latch: RenderLatch,
  engine: DriveEngine,
): void {
  if (!shouldRenderFrame(nowRafMs, lastRenderMs, renderIntervalMs())) return;
  if (lastRenderFpsMs > 0) {
    const renderDtMs = nowRafMs - lastRenderFpsMs;
    if (renderDtMs > 0) lastFps = 1000 / renderDtMs;
  }
  lastRenderFpsMs = nowRafMs;
  lastRenderMs = nowRafMs;

  const resized = resizeCanvasToDisplaySize(canvas, renderScale());
  if (resized) mainHost!.ctx.gl.viewport(0, 0, canvas.width, canvas.height);

  const displayFrame = applySensitivity(gained, sensitivity, expansion);
  const latchedAnim = latch.consume(anim, nowRafMs);
  const drives = engine.forScene(scene.id, scene.settings ?? [], latchedAnim);
  scene.render(mainHost!.ctx, displayFrame, viewport, palette, latchedAnim, drives);
  // Right after the scene has drawn — and nowhere else — because the
  // default framebuffer (preserveDrawingBuffer is false, gl.ts) only holds
  // this frame until the browser composites it; pictureReadback.ts's own
  // header says why this has to run in the same task as the render. Gated
  // behind pictureWanted() since it costs a few blits and a tiny readback,
  // worth paying only while the Master card's Picture block is actually
  // visible or a headless sweep asked for it (pictureForced).
  if (pictureWanted()) samplePicture(nowRafMs);
  governor?.recordFrame(nowRafMs);
}

/** Whether anything currently wants a live picture reading — the Master
 *  card's Picture block while it's open, or a headless driver that forced it
 *  on (tuning/debug.ts's `picture.force`, tools/master-sweep.mjs's own
 *  `__viz.pictureForce(true)`). */
function pictureWanted(): boolean {
  return pictureForced || (deviceMenu?.isOpen() ?? false);
}

/** Drains whatever thumbnail finished since the last tick into the meter/
 *  averager, then — no more than PICTURE_SAMPLE_INTERVAL_MS apart — kicks off
 *  the next one. The readback itself is created lazily, on mainHost's own GL
 *  context, the first tick this is actually called. */
function samplePicture(nowRafMs: number): void {
  if (!pictureReadback) pictureReadback = createPictureReadback(mainHost!.ctx.gl);
  const t = pictureReadback.poll();
  if (t) {
    const r = pictureMeter.push(t.px, t.w, t.h, t.atMs);
    pictureAverager.add(r);
  }
  // Half a 60 fps frame of slack: rAF timestamps jitter, and without it a
  // 60 fps render lands just short of the interval on its fourth frame and
  // samples every fifth instead (12 Hz, not 15).
  if (nowRafMs - lastPictureKickMs >= PICTURE_SAMPLE_INTERVAL_MS - 8) {
    pictureReadback.capture(canvas.width, canvas.height, nowRafMs);
    lastPictureKickMs = nowRafMs;
  }
}

/** True exactly while the start prompt could be up: in a scene, on this
 *  device's own audio path, with nothing listening yet. Deliberately wider
 *  than updateMicPrompt's needsAudio — it stays true while a permission or
 *  share picker is open, so the demo keeps playing until real audio takes
 *  over rather than blinking to black in between. */
function idlePreviewActive(): boolean {
  return inViz && mode !== "renderer" && !syntheticFeed && !bandAnalyser;
}

/** One tick of the demo groove behind the start prompt — the same pipeline
 *  loop() runs for live audio (band gains, anim clock, drives, sensitivity),
 *  on idlePreview's own state and minus everything live-only: no auto-tune
 *  training, no meters, no host send. The scene's own settings and the
 *  Input card still apply, so tweaking a look before picking a source shows
 *  the result. */
function renderIdlePreview(nowRafMs: number, dtSec: number, smoothing: number): void {
  // Clock only — no profile, so the demo still can't train it, but the auto
  // Sensitivity/Expansion below keep gliding instead of freezing at one step.
  tickAutoTune(dtSec);
  const frame = idlePreview.feed.frame(nowRafMs / 1000);
  const gained = applyBandGains(frame, getBandGains(scene.id));
  outputBridge?.pushFrame(gained, { beatRatio: null, wavePeak: null }, { sens: outputSens, exp: outputExp, smoothing });
  const anim = idlePreview.anim.advance(dtSec, gained, smoothing, resolveSilenceGate(), { shape: getHitShape(), beatRatio: null });
  idlePreview.latch.accumulate(anim);
  const sensitivity = resolveSensitivity(scene.id);
  const expansion = resolveExpansion(scene.id);
  const driveEnergy = applySensitivity(gained, sensitivity, expansion).energy;
  idlePreview.drives.accumulate(dtSec, gained, driveEnergy, anim, scene.id, scene.settings ?? []);
  drawScene(nowRafMs, gained, sensitivity, expansion, anim, idlePreview.latch, idlePreview.drives);
}

void boot();
