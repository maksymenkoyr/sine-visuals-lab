// FIRST import, before any store evaluates: on a phone opened as a room
// controller it puts the in-memory look overlay over localStorage — see the
// header of net/controllerStorageBoot.ts. A no-op for every other page.
import "./net/controllerStorageBoot.ts";
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
import { createGL, refreshCssSize, resizeCanvasToDisplaySize, watchContextLoss } from "./render/gl.ts";
import {
  detectQuality,
  parseQualityPreset,
  presetAllows,
  presetRank,
  qualitySettings,
  type QualityPreset,
  type QualitySettings,
} from "./render/quality.ts";
import { RENDER_FPS_CAP_FLOOR, nextRenderAnchor, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type Viewport } from "./render/scene.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { getPalette, paletteRampHex, PALETTES, type Palette } from "./render/palette.ts";
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
  ControllerConnection,
  createRoomCode,
  HostConnection,
  RendererConnection,
  type RosterEntry,
  type VisualSample,
} from "./net/room.ts";
import { WORKER_ORIGIN } from "./net/config.ts";
import { realStorage } from "./net/realStorage.ts";
import { captureRoomStorage, applyRoomStorage } from "./net/syncedStores.ts";
import { createLookSync, LOOK_PUBLISH_MS } from "./net/lookSync.ts";
import { planBoot } from "./net/bootPlan.ts";
import { tvRedirectTarget } from "./net/tvRedirect.ts";
import { clearSession, readSession, writeSession, type HostRoomSession } from "./net/sessions.ts";
import { planHostRoom } from "./net/hostRoom.ts";
import { postAdopt } from "./net/adopt.ts";
import { createControllerLook, type ControllerLook } from "./net/controllerLook.ts";
import { controllerBadgeText, controllerPreview } from "./net/controllerPreview.ts";
import { ROSTER_WAIT_MS, hasNewRenderer, rendererIds, waitForRoster } from "./net/screenJoin.ts";
import { newKey } from "./net/pairing.ts";
import { createJoinScreen, type AddScreenOutcome } from "./ui/joinScreen.ts";
import { reportSceneRunning } from "./net/usage.ts";
import { createDeviceMenu, isTypingTarget, type AudioSource, type DeviceMenu } from "./ui/deviceMenu.ts";
import { createControlPanel, type RoomInvite } from "./ui/controlPanel.ts";
import { createGallery, type Gallery } from "./ui/gallery.ts";
import { navigate, onRouteChange, seedHistory, currentRoute, type Route } from "./router.ts";
import { createImmersiveMode, type ImmersiveMode } from "./ui/fullscreen.ts";
import { requestWakeLock } from "./ui/wakeLock.ts";
import { noteKeyUse } from "./ui/keyHints.ts";
import { shouldTickInBackground, startBackgroundTick } from "./net/backgroundTick.ts";
import { createBroadcastTransport, createOutputBridge, type OutputBridge } from "./net/outputBridge.ts";
import { combineBridges, createRoomBridge, type RoomBridge } from "./net/roomBridge.ts";
import type { OutputPower, ToMain, ToOutput } from "./net/outputSync.ts";
import { createOutputControls, type OutputControls } from "./ui/outputControls.ts";
import { createPlayKey, glideMsForHold, PLAY_TAP_MAX_MS } from "./ui/outputKeys.ts";
import { BANDS_AMBER, ensureControlsStyles } from "./ui/controlsTheme.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { BUILD_INFO, versionHint, versionLabel } from "./version.ts";
import { sceneVersionHint, sceneVersionOf } from "./render/sceneVersions.ts";
import { bindHint, hideTooltip } from "./ui/tooltip.ts";

type Mode = "solo" | "host" | "renderer";
type AnyConn = HostConnection | RendererConnection | ControllerConnection;

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

/** No new frame in this long -> the host is gone even if our own socket to the relay is still open. */
const STALE_TIMEOUT_MS = 3000;

let mode: Mode = "solo";
let roomCode: string | null = null;
let hostConn: HostConnection | null = null;
let rendererConn: RendererConnection | null = null;
let rendererHasData = false;
let soloFallbackTriggered = false;
/** A phone that edits the room's look instead of listening (net/lookSync.ts has
 *  the protocol, boot() the pairing). It is deliberately still `mode ===
 *  "renderer"` — no capture, no Source row, usage counted as "remote" — because
 *  the many `mode !== "renderer"` checks below default to "open the mic" and a
 *  fourth mode would fall straight into them. What differs is gated on this flag
 *  alone, so a solo, host or legacy-renderer page never takes a controller
 *  branch. */
let isController = false;
let controllerConn: ControllerConnection | null = null;
/** Controller only: the look this phone reads and writes for the room, and the
 *  scene and palette ids the room holds even when this phone cannot show them
 *  (net/controllerLook.ts). Null on every other page, which is what keeps the
 *  notes in applyScene / applyPalette / enterViz inert there. */
let controllerLook: ControllerLook | null = null;
/** Controller only: the laptop has stopped sending frames (the room badge says
 *  so). Set by currentVisual() from net/controllerPreview.ts. */
let laptopWaiting = false;

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
/** Rebuilt (not just reset) on every attachCapture() — see that function's
 *  comment for why a fresh extractor, not a reset(), is what a new capture
 *  needs. The initial one only serves the ticks before any capture exists. */
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
 *  every tick (render loop, right after outputBridge.update). A phone
 *  controller is always previewing whatever it shows — the room's TV is the
 *  real picture — so for it this is just "a scene is showing". */
let previewActive = false;
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
/** True from the main canvas's `webglcontextlost` until the page reloads on
 *  the restore (see boot()): drawScene() draws nothing, and the picture
 *  readback isn't rebuilt against a dead context. */
let glLost = false;

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
/** Last time capturePicture() kicked off a new capture — paced to
 *  PICTURE_SAMPLE_INTERVAL_MS independently of the render loop's own rate,
 *  which usually runs faster. */
let lastPictureKickMs = -Infinity;

let gallery: Gallery | null = null;
let deviceMenu: DeviceMenu | null = null;
let immersive: ImmersiveMode | null = null;
let inViz = false;
/** `?room=CODE` (no role) — a mic-less renderer joining someone else's
 *  room. The scene is dictated by the host, so there's nothing to browse:
 *  the gallery is never built and routing is skipped entirely. A phone
 *  controller is the opposite: it browses and picks, so it never sets this. */
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
/** The laptop's keyed room as a second output (net/roomBridge.ts): a TV in it
 *  is cued and played like the pop-out. Null for everything but a keyed host. */
let roomBridge: RoomBridge | null = null;
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
 *  preview starting or stopping under a scene that is already showing, and for
 *  an explicit Quality choice (the scene's buffers follow quality.maxParticles). */
function applyRenderQuality(remount = false): void {
  const preset = renderPreset();
  if (preset === quality.preset) return;
  Object.assign(quality, qualitySettings(preset));
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);
  if (remount && inViz && mainHost) mountOrBail(scene, scene);
}

/** The preview's box (index.html's `body.output-preview #gl`): on while an
 *  output is open and the size isn't Full. A phone controller previews cheaply
 *  (renderPreset) but keeps the whole screen: a half-size picture on a phone
 *  is no preview at all. */
function applyPreviewBox(): void {
  document.body.classList.toggle("output-preview", previewActive && previewSize !== "full" && !isController);
  document.body.style.setProperty("--preview-frac", String(PREVIEW_SIZE_FRACTION[previewSize]));
}

function activeConn(): AnyConn | null {
  return hostConn ?? controllerConn ?? rendererConn;
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

/** Puts `next` on the main host (clearing whatever was mounted first), or, if
 *  its init() throws (a shader this GPU won't compile, a float target it
 *  lacks), says so and leaves it: back to the gallery, or to `prev` when there
 *  is no gallery (a `?room=` renderer). Returns whether `next` is running.
 *  Callers keep `scene` pointing at `next` until this answers, and must stop
 *  when it returns false: `scene` has been put back and the HUD explains. */
function mountOrBail(next: Scene, prev: Scene): boolean {
  const host = mainHost!;
  host.unmountAll();
  try {
    host.mount(next);
    return true;
  } catch (err) {
    console.error(`"${next.name}" failed to start:`, err);
  }
  showHud(`${next.name} can't run on this device`, true);
  scene = prev;
  if (!bypassGallery) {
    navigate({ kind: "gallery" }, "replace");
  } else if (prev !== next) {
    try {
      host.mount(prev);
    } catch (err) {
      console.error(`"${prev.name}" failed to restart:`, err);
    }
  }
  return false;
}

/** Routes both local picks (device menu) and remote commands (control panel on
 *  another device) through the same path, so the roster always reflects reality. */
function applyScene(next: Scene): void {
  if (!mainHost) return;
  const prev = scene;
  scene = next;
  controllerLook?.noteScene(next.id);
  // Before the mount, which sizes geometry from `quality`: the new scene's
  // minQuality may differ from the last one's while previewing.
  if (previewActive) applyRenderQuality();
  if (!mountOrBail(next, prev)) return;
  updateSceneVersionLabel(next);
  showHud(`scene: ${scene.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
  if (inViz) navigate({ kind: "viz", sceneId: scene.id }, "replace");
}

function applyPalette(next: Palette): void {
  palette = next;
  controllerLook?.notePalette(next.id);
  showHud(`palette: ${palette.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
}

/** Panorama slice assignment, from a `setDevice` command (roomMessages.ts) — no screen of this app sends one any more. */
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
  // A phone controller listens to nothing — opening the panel must not light
  // its mic indicator by previewing the inputs it once had permission for.
  if (isController || !inputPreviewActive || !inputPreviewSupported() || inputDevices.length === 0) {
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
  // A fresh extractor, not a reset(): FeatureExtractor has none, and two
  // things must not carry over from the previous capture. Its clocks
  // (lastPulseTime, lastOnsetTime, peakHoldUntil, ...) are absolute
  // AudioContext.currentTime values, and a new context restarts near 0 — the
  // old extractor would sit "in the future" and fire no onset, pulse or band
  // decay until the new clock caught up (a mic reopened after a pulled cable
  // mid-set; a share started after the last one ended). And its adaptive
  // AGC's envelope would blow the visuals out for its ~1.25s re-adaptation
  // window on the big level jump a mic-to-screen swap usually is (a room mic
  // is far quieter than captured system audio).
  extractor = new FeatureExtractor();
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
 *  chosen one returns. The Stop button is the deliberate form of this and
 *  passes `reopen = false`: it must release the mic, not reopen it. */
function onCaptureEnded(handle: CaptureHandle, reopen = true): void {
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
  if (reopen && handle.kind === "mic" && micPermission === "granted") void ensureAudio("mic");
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
  // A phone controller hears the room through the host's frames; the gallery's
  // tile taps and source picker reach here too, and must not open its mic.
  if (syntheticFeed || isController) return Promise.resolve();
  if (audioPromise) return audioPromise;
  const choice = explicit ?? autoStartSource();
  if (choice === null) {
    updateMicPrompt(); // nothing started — the prompt is the way in
    return Promise.resolve();
  }
  stoppedByUser = false;
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

/** True from the Stop button until something starts listening again, so a
 *  screen joining (`feedScreens`) never reopens a mic that was just closed. */
let stoppedByUser = false;
/** Boot has read the mic permission and routed the page (`feedScreens`). */
let screensReady = false;

/** The host's roster changed. A screen in the room shows only what this
 *  laptop hears, so with a screen there and nothing listening, start the
 *  source that needs no prompt (the mic, already allowed: autoStartSource),
 *  on the gallery too: a laptop that reloaded there would otherwise leave its
 *  TV waiting until somebody opened a scene. Any other source needs a tap,
 *  which the gallery's source picker and a scene's start prompt already ask
 *  for (and the TV says so too, net/tvPhase.ts `waitingLine`). */
function feedScreens(roster: RosterEntry[]): void {
  if (!screensReady || mode !== "host" || capture || audioPromise || captureFailed || stoppedByUser || syntheticFeed) return;
  if (roster.some((d) => d.role === "renderer") && autoStartSource() !== null) void ensureAudio();
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
  // A controller never becomes a solo mic: it reconnects, or is told to re-pair.
  if (soloFallbackTriggered || isController) return;
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
    getPalettes: () => PALETTES.map((p) => ({ id: p.id, name: p.name, group: p.group, swatch: paletteRampHex(p, 6) })),
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
      // Remount: a scene sizes its particle/agent buffers at init() from
      // quality.maxParticles, and the governor never moves that count, so
      // without it a Low pick keeps the High preset's agent count until the
      // next scene switch.
      applyRenderQuality(true);
    },
    isPreview: () => previewActive,
    // applyPreviewBox() leaves a phone controller's preview full page.
    canResizePreview: () => !isController,
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
function wireRoomControls(conn: AnyConn, invite: () => RoomInvite | null): void {
  const panel = createControlPanel({
    getRoster: () => conn.currentRoster,
    onRosterChange: (cb) => conn.onRosterChange(cb),
    adoptTv: ownRoomKey ? adoptTvByCode : undefined,
    invite,
    hasCuePlay: !isController,
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

/** A full-screen, plain-words stop for a page that cannot go on: a phone that
 *  has to scan again, or whose room has gone. Not showHud — that is small,
 *  dim and fades, and there is nothing behind this worth looking at. */
function showPairingNotice(title: string, body: string): void {
  const root = document.createElement("div");
  root.style.cssText = `
    position: fixed; inset: 0; z-index: 30;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; background: #000; color: #fff;
    font-family: system-ui, sans-serif; text-align: center; padding: 24px;
  `;
  const heading = document.createElement("div");
  heading.style.cssText = "font-weight: 600; font-size: 22px;";
  heading.textContent = title;
  const text = document.createElement("div");
  text.style.cssText = "opacity: 0.7; font-size: 16px; max-width: 28em;";
  text.textContent = body;
  root.append(heading, text);
  document.body.appendChild(root);
}

/** Two tabs on one laptop share one localStorage, so without this a second tab
 *  would resume the first one's room and fight it for the host seat. The first
 *  tab to ask keeps the lock for as long as it lives (the grant ends when the
 *  promise the callback returns settles, and that one never does). False where
 *  Web Locks are missing or another tab holds it; src/net/hostRoom.ts then
 *  starts a new room. */
function takeHostRoomLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    try {
      void navigator.locks
        .request("svl-host-room", { ifAvailable: true }, (lock) => {
          resolve(lock !== null);
          return lock ? new Promise<void>(() => {}) : undefined;
        })
        .catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/** The laptop's own keyed room: the one this tab had before if it may resume it
 *  (hostRoom.ts has the rule), else a fresh code with fresh keys. Only the tab
 *  holding the lock saves a new room, so a second tab can't take the first
 *  one's reload away from it. */
async function openHostRoom(): Promise<HostRoomSession> {
  const lockHeld = await takeHostRoomLock();
  const plan = planHostRoom(readSession("host", realStorage), Date.now(), lockHeld);
  if (plan.kind === "resume") return plan.session;
  const session: HostRoomSession = { room: await createRoomCode(), hostKey: newKey(), roomKey: newKey(), ts: Date.now() };
  if (lockHeld) writeSession("host", session, realStorage);
  return session;
}

/** The controller's side of the look protocol (net/lookSync.ts): what the
 *  phone's panel changes goes out through tick(), and what the room says
 *  comes back through the connection's look messages. What the phone reads and
 *  writes is net/controllerLook.ts, which remembers the room's scene and palette
 *  even when this phone can't show them. */
function startControllerLook(conn: ControllerConnection): void {
  const look = createControllerLook({
    paletteId: () => palette.id,
    canShowPalette: (id) => PALETTES.some((p) => p.id === id),
    showPalette: (id) => applyPalette(getPalette(id)),
    showScene(id) {
      const next = getScene(id);
      if (next && next.id !== scene.id && presetAllows(next, effectivePreset())) {
        if (inViz) applyScene(next);
        else scene = next;
      }
    },
    captureStorage: () => captureRoomStorage(localStorage),
    applyStorage: (storage) => applyRoomStorage(storage, localStorage),
  });
  controllerLook = look;
  const sync = createLookSync({
    read: look.io.read,
    write: look.io.write,
    send: (msg) => conn.sendLook(msg),
    onReject: (reason) =>
      showHud(reason === "size" ? "Settings too large to sync" : "Not allowed to change this room", true),
  });
  conn.onLook((m) => {
    if (m.type === "look") sync.onSnapshot(m.rev, m.doc);
    else if (m.type === "lookPatch") sync.onPatch(m.rev, m);
    else if (m.type === "lookAck") sync.onAck(m.n, m.rev);
    else sync.onReject(m.n, m.reason);
  });
  conn.onState((s) => {
    if (s !== "open") sync.onDisconnect();
  });
  window.setInterval(() => sync.tick(), LOOK_PUBLISH_MS);
}

/** How long the phone waits for a TV it has just handed to the room to show up
 *  in the roster before saying it didn't. */
const SCREEN_JOIN_WAIT_MS = 10_000;

/** The stop for a phone that has met a TV before the laptop. */
function showScanLaptopNotice(): void {
  showPairingNotice(
    "Now scan the QR on the laptop",
    "The screen is waiting. On the laptop, click the room code at the top right to show the QR.",
  );
}

/** The key of the room this device hosts or controls, for handing a screen to
 *  it by a typed code (`adoptTvByCode`). Null where the device has no keyed room. */
let ownRoomKey: string | null = null;

/** A code typed into a Room field, tried as a waiting TV's: the same adopt a
 *  phone sends after scanning, minus the nonce a typed code can't carry. This
 *  room's own code (what a TV already in it shows in its corner) never is. */
function adoptTvByCode(slot: string): Promise<AddScreenOutcome> {
  if (!roomCode || !ownRoomKey) return Promise.resolve("no-screen");
  if (slot === roomCode) return Promise.resolve("own-room");
  return postAdopt(WORKER_ORIGIN, slot, { room: roomCode, k: ownRoomKey });
}

/** Set while the laptop's Reset is ending its room, so the room's denial of
 *  this socket (the end of every room) isn't reported as a refusal. */
let resettingRoom = false;

/** The room view's Reset room: ends this laptop's room for everyone and starts
 *  a new one. The room closes every socket as denied (server/roomCore.ts
 *  `end`), so a paired TV goes back to its pairing QR, ready for this laptop
 *  to type its code, and a phone says the room is closed. The page reloads
 *  into the new room (the saved one is forgotten first, so hostRoom.ts
 *  creates); the route stays, so a scene that was showing comes back. */
function resetRoom(): void {
  if (resettingRoom) return;
  resettingRoom = true;
  clearSession("host", realStorage);
  const reload = (): void => location.reload();
  const conn = hostConn;
  if (!conn || !conn.endRoom()) {
    reload();
    return;
  }
  showHud("Resetting the room…");
  conn.onState((s) => {
    if (s === "denied" || s === "closed") reload();
  });
  // The room's close normally lands at once; a lost one must not strand the page.
  window.setTimeout(reload, 2000);
}

/** Hands the TV waiting in `slot` to this phone's room (net/adopt.ts), then
 *  reports in plain words: the room's roster is what proves the TV arrived.
 *  The request goes out only once the room has delivered its first roster
 *  (net/screenJoin.ts has why): the renderers in it were there before, so only
 *  a screen that appears after it is the new one. `needHost` is for a TV
 *  scanned before the laptop, which uses the room of a saved session, and that
 *  room may be one the laptop has left: the request then also waits for the
 *  laptop to be in the roster, and without it keeps the TV for the laptop's QR
 *  (the `pending` session) instead of sending it into a dead room. */
async function adoptScreen(
  conn: ControllerConnection,
  room: string,
  key: string,
  slot: string,
  nonce: string,
  needHost: boolean,
): Promise<void> {
  const wait = await waitForRoster(conn, { needHost, timeoutMs: ROSTER_WAIT_MS });
  if (wait.kind !== "ready") {
    writeSession("pending", { slot, nonce, ts: Date.now() }, realStorage);
    // A refused join has already stopped the page with its own notice (startController).
    if (wait.kind === "no-host") showScanLaptopNotice();
    return;
  }
  const known = rendererIds(wait.roster);
  let arrived = false;
  let onArrive: (() => void) | null = null;
  const stopWatching = conn.onRosterChange((roster) => {
    if (arrived || !hasNewRenderer(roster, known)) return;
    arrived = true;
    stopWatching();
    if (onArrive) onArrive();
  });

  const outcome = await postAdopt(WORKER_ORIGIN, slot, { room, k: key, n: nonce });
  if (outcome !== "ok") {
    stopWatching();
    showHud(
      outcome === "no-screen"
        ? "That screen isn't waiting.\nCheck it still shows the code,\nthen scan it again."
        : outcome === "throttled"
          ? "Too many tries.\nWait a minute, then scan the screen again."
          : "Couldn't reach the room.\nScan the screen again.",
      true,
    );
    return;
  }
  if (arrived) {
    showHud("Screen joined");
    return;
  }
  onArrive = () => showHud("Screen joined");
  window.setTimeout(() => {
    if (arrived) return;
    stopWatching();
    showHud("The screen didn't answer.\nScan its code again.", true);
  }, SCREEN_JOIN_WAIT_MS);
}

/** Boots this page as a room's phone controller; the rest of boot() is the same
 *  as for any device. Connects with the room key, remembers it for reloads,
 *  takes the secrets out of the address bar, starts the look protocol and, when
 *  a TV's QR is in play (this page's own link, or one scanned earlier and
 *  saved), hands that TV to the room. */
function startController(
  target: { room: string; key: string; keyFromUrl: boolean },
  adopt: { slot: string; nonce: string } | null,
  /** The link carried a TV QR that didn't parse: the query still gets this
   *  controller's room and role, as for any other TV link, so a reload resumes. */
  tvLinkWasBad = false,
): void {
  mode = "renderer";
  isController = true;
  roomCode = target.room;
  ownRoomKey = target.key;
  document.body.classList.add("controller"); // index.html: no sound-source picker on the gallery
  const conn = new ControllerConnection(target.room, { auth: { roomKey: target.key }, reconnect: true });
  controllerConn = conn;

  if (target.keyFromUrl) {
    writeSession("controller", { room: target.room, key: target.key, ts: Date.now() }, realStorage);
  }
  if (target.keyFromUrl || adopt || tvLinkWasBad) {
    // The room and role stay (a reload resumes from the saved session, and
    // the query must come before the hash); the key and a TV link's nonce
    // don't stay in the address bar, the history or a screenshot of either.
    const kept = new URLSearchParams(location.search);
    kept.delete("k");
    kept.delete("adopt");
    kept.delete("n");
    kept.set("room", target.room);
    kept.set("role", "controller");
    history.replaceState(null, "", `${location.pathname}?${kept.toString()}${location.hash}`);
  }

  paintControllerBadge();
  roomCodeEl.style.display = "block";
  conn.onState((s) => {
    paintControllerBadge();
    if (s === "denied") {
      clearSession("controller", realStorage);
      showPairingNotice("This room is closed", "Scan the QR on the laptop again to reconnect.");
    }
  });
  startControllerLook(conn);

  // A TV scanned before the laptop is waiting in storage; this page's own link,
  // if it has one, is the newer of the two. A link that carries a TV's QR is
  // the one case where the room is a saved session's rather than the laptop's
  // own QR, so only that one has to check the laptop is still in it.
  const pending = readSession("pending", realStorage);
  if (pending) clearSession("pending", realStorage);
  const request = adopt ?? (pending ? { slot: pending.slot, nonce: pending.nonce } : null);
  if (request) void adoptScreen(conn, target.room, target.key, request.slot, request.nonce, adopt !== null);
}

/** The phone controller's room badge: the room, plus whether the connection is
 *  down or the laptop has stopped sending (net/controllerPreview.ts has the words). */
function paintControllerBadge(): void {
  if (!controllerConn || !roomCode) return;
  roomCodeEl.textContent = controllerBadgeText(roomCode, controllerConn.state, laptopWaiting);
}

function setLaptopWaiting(waiting: boolean): void {
  if (waiting === laptopWaiting) return;
  laptopWaiting = waiting;
  paintControllerBadge();
}

async function enterViz(next: Scene): Promise<void> {
  gallery?.hide();
  document.body.classList.remove("in-gallery");
  inViz = true;
  canvas.style.display = "block";
  // The resize observer's cache still says 0x0 from while the canvas was
  // hidden; without this the first frame would be a 1x1 buffer (gl.ts).
  refreshCssSize(canvas);

  const prev = scene;
  scene = next;
  controllerLook?.noteScene(next.id);
  // Before the mount (see applyScene); previewActive is still false on a
  // fresh entry and turns on at the next tick, which remounts if needed.
  if (previewActive) applyRenderQuality();
  if (!mountOrBail(next, prev)) return;
  updateSceneVersionLabel(next);

  showHud(`${isController ? "remote" : mode}${roomCode ? ` (${roomCode})` : ""}  quality: ${quality.preset}  scene: ${scene.name}  palette: ${palette.name}`);
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
    document.body.classList.add("in-gallery"); // index.html: the room badge moves out of the gallery's header
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
  // A TV opening the plain site belongs on the paired display page; leave
  // before anything starts (net/tvRedirect.ts).
  const tvTarget = tvRedirectTarget(location.search, navigator.userAgent);
  if (tvTarget !== null) {
    location.replace(tvTarget);
    return;
  }
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
  // A GPU reset or a backgrounded phone can take the context away. gl.ts's
  // watchContextLoss() is what lets the browser give it back; every scene's
  // programs and buffers died with it, so the restore reloads the page (the
  // route is in the hash, and a granted mic restarts on its own).
  watchContextLoss(
    canvas,
    () => {
      glLost = true;
      showHud("graphics reset — reloading", true);
    },
    () => location.reload(),
  );

  const params = new URLSearchParams(location.search);
  // What this page load means (net/bootPlan.ts decides from the query alone;
  // the saved controller session stands in for a key the address bar no
  // longer carries after a reload).
  const controllerSession = readSession("controller", realStorage);
  const planned = planBoot(location.search, controllerSession);
  // A TV link that doesn't parse says so and boots as the link reads without
  // it (net/bootPlan.ts has what that is); it never makes this phone a host.
  const badAdoptLink = planned.kind === "bad-adopt-link";
  const plan = planned.kind === "bad-adopt-link" ? planned.then : planned;
  if (badAdoptLink) {
    // Out of the address bar before anything reads it again, so a reload does
    // not repeat the message; a controller resume rewrites the whole query
    // itself (startController).
    const kept = new URLSearchParams(location.search);
    kept.delete("adopt");
    kept.delete("n");
    const query = kept.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  if (plan.kind === "need-pairing") {
    // Never quietly become a second host and ask for the mic.
    showPairingNotice("Scan the QR on the laptop again", "On the laptop, click the room code at the top right to show it.");
    return;
  }
  let controllerTarget: { room: string; key: string; keyFromUrl: boolean } | null = null;
  let adoptRequest: { slot: string; nonce: string } | null = null;
  if (plan.kind === "controller") {
    controllerTarget = plan;
  } else if (plan.kind === "adopt") {
    if (!controllerSession) {
      // Scanned the TV before the laptop: keep the TV's slot and nonce just
      // long enough for the laptop's QR to finish the pairing.
      writeSession("pending", { slot: plan.slot, nonce: plan.nonce, ts: Date.now() }, realStorage);
      showScanLaptopNotice();
      return;
    }
    controllerTarget = { room: controllerSession.room, key: controllerSession.key, keyFromUrl: false };
    adoptRequest = { slot: plan.slot, nonce: plan.nonce };
  }
  bypassGallery = plan.kind === "renderer";
  // A ?room= that isn't a code the Worker could have issued (a stray '#' or
  // other odd character, say) is ignored and the page loads normally rather
  // than aborting boot; say so for whoever is looking at the console.
  if (plan.kind !== "adopt" && params.get("room") && !("room" in plan)) {
    console.warn("Ignoring a malformed ?room= code:", params.get("room"));
  }
  // The new room's request goes out now so its round trip overlaps
  // detectQuality()'s benchmark below instead of following it; it's awaited
  // (with the solo fallback) where the room is wired. The catch here only
  // silences the unhandled-rejection warning while nothing awaits it yet.
  const hostRoomPromise = plan.kind === "host-new" ? openHostRoom() : null;
  hostRoomPromise?.catch(() => {});

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

  // The laptop's room key, when it hosts a keyed room: what its QR carries.
  let hostRoomKey: string | null = null;
  if (controllerTarget) {
    // The laptop's QR (or a TV's, with a controller session already saved) —
    // a phone that edits the room's look and previews it from the host's frames.
    startController(controllerTarget, adoptRequest, badAdoptLink);
  } else if (plan.kind === "renderer") {
    // Plain ?room=CODE — join as a mic-less renderer (e.g. a second laptop just watching).
    // With the room's key (the laptop's watch-only link) the room is claimed, so it
    // is kept alive across drops; a keyless one stays the old one-shot socket.
    mode = "renderer";
    roomCode = plan.room;
    rendererConn = new RendererConnection(
      roomCode,
      plan.key ? { auth: { roomKey: plan.key }, reconnect: true } : undefined,
    );
    startRendererDisconnectWatch();
  } else if (plan.kind === "solo") {
    // A TV link that didn't parse, on a phone with no controller session:
    // the page on its own, not a new room.
    mode = "solo";
    roomCode = null;
  } else {
    // No code -> create a fresh room and host it (the classic "open the site" flow).
    // ?room=CODE&role=host -> become host of a code someone else (a TV) already created.
    try {
      if (plan.kind === "host-join") {
        roomCode = plan.room;
        hostConn = new HostConnection(roomCode);
        // A code alone opens only an old unclaimed room; a laptop's is keyed.
        hostConn.onState((s) => {
          if (s === "denied") showHud(`Room ${plan.room} needs its QR, a code alone can't join it.\nClick the room code to leave it.`, true);
        });
      } else {
        // The classic flow's room is claimed by this laptop and keyed (openHostRoom).
        const hostRoom = await hostRoomPromise!;
        roomCode = hostRoom.room;
        hostRoomKey = hostRoom.roomKey;
        ownRoomKey = hostRoom.roomKey;
        hostConn = new HostConnection(roomCode, {
          auth: { hostKey: hostRoom.hostKey, roomKey: hostRoom.roomKey },
          reconnect: true,
        });
        hostConn.onState((s) => {
          if (s !== "denied" || resettingRoom) return;
          clearSession("host", realStorage);
          showHud("The room refused this laptop — reload to start a new one", true);
        });
      }
      mode = "host";
      hostConn.onRosterChange(feedScreens);
    } catch (err) {
      console.warn("Room server unreachable, running solo:", err);
      mode = "solo";
      roomCode = null;
    }
  }

  if (badAdoptLink) showHud("That screen link isn't valid.\nScan the QR on the TV again.", true);

  // A phone controller paints its own badge (paintControllerBadge: connection
  // state, no click); every other room member gets the room view below.
  if ((mode === "host" || mode === "renderer") && roomCode && !isController) {
    roomCodeEl.textContent = `room: ${roomCode}`;
    roomCodeEl.style.display = "block";
    // The room view: this room's QR + code, and the field to type a code —
    // a waiting TV's, on a keyed host (joinScreen.ts `createRoomCodeEntry`),
    // else another room's. Stays open until dismissed — it holds a text field.
    // A keyed host's overlay carries the controller link (and a watch-only
    // toggle); a keyed spectator can pass on the key it was invited with; the
    // old room a phone hosts for a TV has no key to put in a link. Its last
    // button starts over: a keyed host ends its room for everyone and opens a
    // new one (`resetRoom`); anyone else just leaves for a room of their own.
    const roomKey = hostRoomKey ?? (plan.kind === "renderer" ? plan.key : undefined);
    const invite = createJoinScreen(hostRoomKey ? "controller" : "renderer", document.body, {
      dismissible: true,
      adoptTv: ownRoomKey ? adoptTvByCode : undefined,
      reset: hostRoomKey
        ? { label: "Reset room", confirm: "Click again: every phone and TV pairs again", run: resetRoom }
        : { label: "Leave this room", run: () => location.assign("/") },
    });
    invite.setCode(roomCode, roomKey ? { key: roomKey } : undefined);
    roomCodeEl.addEventListener("click", () => invite.show());
  }

  wireDeviceMenu();
  const conn = activeConn();
  // Same link as the room-code badge's overlay: the controller link for the
  // laptop's keyed room, the plain/watch link for any other room member.
  if (conn) {
    const inviteKey = hostRoomKey ?? (plan.kind === "renderer" ? plan.key : undefined);
    wireRoomControls(conn, () =>
      isController || !roomCode
        ? null
        : { kind: hostRoomKey ? "controller" : "renderer", code: roomCode, info: inviteKey ? { key: inviteKey } : undefined },
    );
  }

  immersive = createImmersiveMode({
    button: fsBtn,
    isMenuOpen: () => deviceMenu?.isOpen() ?? false,
  });
  fsBtn.addEventListener("click", () => immersive!.toggle());

  // A phone controller has no pop-out: no bridge, no Cue/Play buttons or keys
  // (every other use of these two is null-safe, and #outBtn/#cueBtn/#goBtn
  // stay hidden as index.html ships them).
  if (!isController) {
    outputBridge = createOutputBridge({
      transport: createBroadcastTransport<ToOutput, ToMain>(),
      look: () => ({ scene: scene.id, palette: palette.id }),
      power: () => outputPower,
    });
    let controlsBridge: OutputBridge = outputBridge;
    // A keyed laptop's screens take Cue and Play too; a legacy room has no
    // look to publish. The bar drives both outputs, the pop-out and the room.
    const host = hostConn;
    if (host && hostRoomKey) {
      roomBridge = createRoomBridge({
        send: (m) => host.sendLook(m),
        screens: () => host.currentRoster.filter((d) => d.role === "renderer").length,
        look: () => ({ scene: scene.id, palette: palette.id }),
        capture: () => captureRoomStorage(localStorage),
        showRoom: () => roomCodeEl.click(),
      });
      host.onLook((m) => {
        if (m.type === "lookReject") roomBridge?.refused();
      });
      host.onState((s) => {
        if (s === "open") roomBridge?.reconnected();
      });
      controlsBridge = combineBridges([outputBridge, roomBridge]);
    }
    outputControls = createOutputControls(controlsBridge, { popBtn: outBtn, cueBtn, goBtn, stateEl: outStateEl, barEl: outBarEl });
    outputControls.setVisible(inViz);
    wireOutputKeys(outputControls);
  }

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  window.addEventListener("keydown", (e) => {
    // Modifier guard so ⌘/Ctrl+F (browser find) and ⌘/Ctrl+S (save page)
    // pass through untouched instead of driving these — mirrors the guard
    // deviceMenu.ts's own document-level handler already uses.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // F and S are letters, so they must not fire while one is being typed —
    // a look named "Fast", or a pasted share code, in the Looks card's inputs
    // (a range slider keeping focus still counts as not typing).
    const typing = isTypingTarget(e.target);
    if ((e.key === "f" || e.key === "F") && !typing) {
      noteKeyUse("fullscreen");
      immersive?.toggle();
    }
    // Only live in a viz — the exact condition that shows menuBtn itself
    // (enterViz/exitToGallery below), so the key and the gear it mirrors
    // appear and disappear together. Reuses the same toggle() the gear's
    // click handler calls, rather than reimplementing open/close here.
    if ((e.key === "s" || e.key === "S") && inViz && !typing) {
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
    if (inViz && !typing) {
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
    if (!capture) return;
    stoppedByUser = true;
    onCaptureEnded(capture, false);
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
  // The mic permission is known and the page routed: a screen already in the
  // room (a laptop that reloaded with its TV paired) can be fed now.
  screensReady = true;
  if (hostConn) feedScreens(hostConn.currentRoster);

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

/** Nothing local to read this tick (synthetic feed, no capture yet, or a
 *  renderer with no mic): every reading the meters take from this device's own
 *  extractor and analysers goes back to null, so a card never keeps showing a
 *  stale value from the previous mode. One place, so a new reading is added
 *  here once rather than at each of currentVisual()'s early-out sites. */
function clearLocalReadings(): void {
  lastRawBands = null;
  lastMono = null;
  lastDeepMono = null;
  lastLufs = null;
  lastFixedEnergy = null;
  lastBeatDiag = null;
  lastFluxRatio = null;
  lastGate = null;
  lastInputHealth = null;
}

/** One tick's read of this device's own live capture — the bands, scope,
 *  input health and LUFS readings, the extractor's frame, and the meters'
 *  diagnostics off it — shared by currentVisual()'s solo and host branches,
 *  which differ only in what they do with the tempo source and the frame
 *  afterwards. `now` is the capture's own AudioContext clock. */
function readLocalCapture(
  bandAnalyser: BandAnalyser,
  capture: CaptureHandle,
  rateScale: number,
): { f: FeatureFrame; now: number } {
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
  return { f, now };
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
    // Synthetic frames are generated directly, not sampled from a real
    // signal — there's nothing for the scope to trace, so its card
    // correctly stays hidden here (see audioMeters.ts).
    clearLocalReadings();
    return syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000);
  }

  if (mode === "solo") {
    if (!bandAnalyser || !capture) {
      clearLocalReadings();
      return null;
    }
    const { f, now } = readLocalCapture(bandAnalyser, capture, rateScale);
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
    return f;
  }

  if (mode === "host") {
    if (!bandAnalyser || !capture || !hostConn) {
      clearLocalReadings();
      return null;
    }
    const { f } = readLocalCapture(bandAnalyser, capture, rateScale);
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
    hostConn.sendFrame(f);
    return sampleToVisual(hostConn.sample());
  }

  // renderer — no local mic, so no raw signal to show.
  clearLocalReadings();
  // A phone controller previews the host's frames and has nothing to fall back
  // to: no solo mic, and its own socket reconnects (net/room.ts). A laptop that
  // stops sending is a different matter, since the socket stays open; the
  // preview goes silent and the badge says it is waiting (net/controllerPreview.ts),
  // never fallBackToSolo as the legacy renderer below does.
  if (controllerConn) {
    const preview = controllerPreview(
      controllerConn.sample(),
      controllerConn.msSinceLastFrame,
      controllerConn.state,
      STALE_TIMEOUT_MS,
    );
    setLaptopWaiting(preview.waiting);
    return sampleToVisual(preview.sample);
  }
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
  outputBridge?.update(nowRafMs);
  roomBridge?.update(nowRafMs);
  // The preview transition sits outside the bridge check because a phone
  // controller has no bridge yet still previews, whenever a scene is showing.
  const nextActive = isController ? inViz : inViz && !!outputBridge && outputBridge.status().open;
  if (nextActive !== previewActive) {
    previewActive = nextActive;
    applyRenderQuality(true);
    applyPreviewBox();
  }
  if (outputBridge && gained) outputBridge.pushFrame(gained, { beatRatio: lastFluxRatio, wavePeak: lastMono ? peak(lastMono) : null, gate: resolveSilenceGate() }, { sens: outputSens, exp: outputExp, smoothing });

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
  if (glLost) return;
  const intervalMs = renderIntervalMs();
  if (!shouldRenderFrame(nowRafMs, lastRenderMs, intervalMs)) return;
  if (lastRenderFpsMs > 0) {
    const renderDtMs = nowRafMs - lastRenderFpsMs;
    if (renderDtMs > 0) lastFps = 1000 / renderDtMs;
  }
  lastRenderFpsMs = nowRafMs;
  lastRenderMs = nextRenderAnchor(nowRafMs, lastRenderMs, intervalMs);

  const resized = resizeCanvasToDisplaySize(canvas, renderScale());
  if (resized) mainHost!.ctx.gl.viewport(0, 0, canvas.width, canvas.height);

  const displayFrame = applySensitivity(gained, sensitivity, expansion);
  const latchedAnim = latch.consume(anim, nowRafMs);
  const drives = engine.forScene(scene.id, scene.settings ?? [], latchedAnim);
  // Drain the previous capture *before* this frame's draws are queued: the
  // readback is a synchronous round trip in Chrome, so asking for it after
  // scene.render would make the main thread wait for the whole frame's GPU
  // work (a 12-16 ms stall per call with the panel open). Its fence has had
  // a full frame to signal by now.
  const picturePolled = pictureWanted();
  if (picturePolled) pollPicture();
  scene.render(mainHost!.ctx, displayFrame, viewport, palette, latchedAnim, drives);
  // Right after the scene has drawn — and nowhere else — because the
  // default framebuffer (preserveDrawingBuffer is false, gl.ts) only holds
  // this frame until the browser composites it; pictureReadback.ts's own
  // header says why this has to run in the same task as the render. Gated
  // behind pictureWanted() since it costs a few blits and a tiny readback,
  // worth paying only while the Master card's Picture block is actually
  // visible or a headless sweep asked for it (pictureForced).
  if (picturePolled) capturePicture(nowRafMs);
  governor?.recordFrame(nowRafMs);
}

/** Whether anything currently wants a live picture reading — the Master
 *  card's Picture block while it's open, or a headless driver that forced it
 *  on (tuning/debug.ts's `picture.force`, tools/master-sweep.mjs's own
 *  `__viz.pictureForce(true)`). */
function pictureWanted(): boolean {
  return pictureForced || (deviceMenu?.isOpen() ?? false);
}

/** The readback is created lazily, on mainHost's own GL context, the first
 *  tick a sample is actually asked for. */
function ensurePictureReadback(): PictureReadback {
  if (!pictureReadback) pictureReadback = createPictureReadback(mainHost!.ctx.gl);
  return pictureReadback;
}

/** Drains whatever thumbnail finished since the last tick into the meter/
 *  averager. Runs before the scene draws (see drawScene); the readback's
 *  result buffer is reused, so the push happens immediately. */
function pollPicture(): void {
  const t = ensurePictureReadback().poll();
  if (t) {
    const r = pictureMeter.push(t.px, t.w, t.h, t.atMs);
    pictureAverager.add(r);
  }
}

/** Kicks off the next thumbnail, no more than PICTURE_SAMPLE_INTERVAL_MS
 *  apart. Runs right after the scene draws, in the same task. */
function capturePicture(nowRafMs: number): void {
  // Half a 60 fps frame of slack: rAF timestamps jitter, and without it a
  // 60 fps render lands just short of the interval on its fourth frame and
  // samples every fifth instead (12 Hz, not 15).
  if (nowRafMs - lastPictureKickMs >= PICTURE_SAMPLE_INTERVAL_MS - 8) {
    ensurePictureReadback().capture(canvas.width, canvas.height, nowRafMs);
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
  outputBridge?.pushFrame(gained, { beatRatio: null, wavePeak: null, gate: resolveSilenceGate() }, { sens: outputSens, exp: outputExp, smoothing });
  const anim = idlePreview.anim.advance(dtSec, gained, smoothing, resolveSilenceGate(), { shape: getHitShape(), beatRatio: null });
  idlePreview.latch.accumulate(anim);
  const sensitivity = resolveSensitivity(scene.id);
  const expansion = resolveExpansion(scene.id);
  const driveEnergy = applySensitivity(gained, sensitivity, expansion).energy;
  idlePreview.drives.accumulate(dtSec, gained, driveEnergy, anim, scene.id, scene.settings ?? []);
  drawScene(nowRafMs, gained, sensitivity, expansion, anim, idlePreview.latch, idlePreview.drives);
}

void boot();
