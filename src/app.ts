// FIRST import, before any store evaluates: on a phone opened as a room
// controller it puts the in-memory look overlay over localStorage — see the
// header of net/controllerStorageBoot.ts. A no-op for every other page.
import "./net/controllerStorageBoot.ts";
import { PAID_SCENE_IDS, preloadScenes, sceneStage } from "./render/scenes/index.ts"; // also registers built-in scenes (side effect)
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
import { createStemSplitter, type StemRanges } from "./audio/stemSplit.ts";
import { createStemGate, wiresReadStems, type StemGate } from "./render/stemReaders.ts";
import { createWaveformAnalyser, type WaveformAnalyser } from "./audio/waveformAnalyser.ts";
import { minMax, rms } from "./audio/waveform.ts";
import { createInputHealthTap, type InputHealthTap } from "./audio/inputHealthTap.ts";
import { createInputHealth, mainsHumHz, type InputHealthReading, type InputMeasure } from "./audio/inputHealth.ts";
import { FeatureExtractor } from "./audio/features.ts";
import { createEngineSource, type EngineSource } from "./audio/engineSource.ts";
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
import { RENDER_FPS_CAP, RENDER_FPS_CAP_FLOOR, createRenderGate, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createFpsMeter } from "./render/fpsMeter.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type Viewport } from "./render/scene.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { sceneReady } from "./render/lazyScene.ts";
import { getPalette, paletteRampHex, PALETTES, type Palette } from "./render/palette.ts";
import { applySensitivity, smoothingRateScale } from "./audio/sensitivity.ts";
import { createAnimClock, type AnimFrame } from "./render/animClock.ts";
import { lockMeaningFromQuery } from "./render/lockMeaning.ts";
import { getBeatTrim, requestBarResync, resetBeatTrim, stepTempoMultiplier, nudgeBeatOffset } from "./render/beatTrim.ts";
import { releaseTapTempo, tapTempoAt } from "./render/tapTempo.ts";
import { createRenderLatch, type RenderLatch } from "./render/renderLatch.ts";
import { createDriveEngine, type DriveEngine } from "./render/drives.ts";
import {
  getDriveLine,
  getDriveLineStrength,
  getDriveSetting,
  getDriveSmoothness,
  getDriveSmoothnessOn,
  getDriveThresholdState,
  getDriveWindowMax,
  getDriveReadout,
  setDriveReadout,
  setDriveSmoothness,
  setDriveSmoothnessOn,
  setDriveThreshold,
  setDriveThresholdOn,
  setDriveWindowMax,
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
  setSourceMod,
  setSourceMuted,
  setSourceRole,
  setSourceWeight,
  togglePatchSource,
} from "./render/driveStore.ts";
import { createSyntheticFeed, type SyntheticFeed } from "./audio/synthetic.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { createCompositor, type Compositor, type RenderOutcome } from "./render/compositor.ts";
import { createSceneGuard } from "./render/sceneGuard.ts";
import { crossfadeOptions, getSceneTransition } from "./render/sceneTransition.ts";
import { createResourceMeter, type ResourceMeter } from "./render/resourceMeter.ts";
import { createFrameMisses } from "./render/frameMisses.ts";
import { createOverlayLayer, type OverlayLayer } from "./render/overlayLayer.ts";
import {
  clearOverlayLogo,
  getOverlay,
  getOverlayLogoScope,
  setOverlayLogo,
  setOverlayOpacity,
  setOverlayPosition,
  setOverlaySize,
  setOverlayText,
} from "./render/overlayStore.ts";
import { encodeLogoFile } from "./render/overlayLogoFile.ts";
import {
  getSceneExpansion,
  getSceneExpansionShape,
  EXPANSION_SHAPES,
  EXPANSION_SHAPE_DEFAULT,
  setSceneExpansionShape,
  getSceneMaster,
  getSceneSetting,
  resetSceneSettings,
  SCENE_EXPANSION_DEFAULT,
  SCENE_EXPANSION_KEY,
  SCENE_EXPANSION_MAX,
  SCENE_EXPANSION_MIN,
  SCENE_MASTER_DEFAULT,
  SCENE_MASTER_KEY,
  SCENE_MASTER_MAX,
  SCENE_MASTER_MIN,
  SCENE_SETTINGS_KEY,
  setSceneExpansion,
  setSceneMaster,
  setSceneSetting,
  settingDefault,
  settingScope,
  type SceneSetting,
} from "./render/sceneSettings.ts";
import {
  createPictureMeter,
  createPictureAverager,
  displayLevel,
  PICTURE_GAP_RESET_MS,
  PICTURE_MEASURES,
  PICTURE_SAMPLE_INTERVAL_MS,
} from "./render/pictureMeter.ts";
import { createPictureReadback, type PictureReadback } from "./render/pictureReadback.ts";
import { createGlassBackdrop, type GlassBackdrop, type GlassPane } from "./render/glassBackdrop.ts";
import { readGlassPanes } from "./ui/glassPanes.ts";
import { GLASS_LOOK, getGlassMode, setGlassDrawn } from "./ui/glassPref.ts";
import { getDeskOn, setDeskOn } from "./ui/deskPref.ts";
import {
  applyLook,
  captureLook,
  decodeLook,
  deleteLook,
  encodeLook,
  hasUndo as hasLookUndo,
  listLooks,
  primeUndo,
  renameLook,
  saveLook,
  saveSharedLook,
  takeUndo,
  type SceneLook,
} from "./render/sceneLooks.ts";
import {
  AUTOPILOT_EVERY_BARS,
  SET_MAX_PADS,
  addCapturedPad,
  getAutopilot,
  listPads,
  removeStoredPad,
  renameStoredPad,
  setAutopilot,
  type AutopilotConfig,
} from "./render/sceneSet.ts";
import {
  AUTOPILOT_FALLBACK_SEC_PER_BAR,
  AUTOPILOT_MIN_PADS,
  createAutopilot,
  peekAutopilot,
  restartAutopilot,
  skipAutopilotPick,
  stepAutopilot,
} from "./render/setAutopilot.ts";
import { cancelLaunch, getLaunchOn, launchBeat, queueLaunch, takeDue, type QueuedLaunch } from "./render/launchQueue.ts";
import { NO_EFFECTS } from "./render/heldEffects.ts";
import { blendValues } from "./render/lookMap.ts";
import { METRONOME_BEATS_PER_BAR } from "./render/metronome.ts";
import { funnyLookName } from "./render/lookNames.ts";
import {
  clearCustomValue,
  getCustomValue,
  getSliderStretch,
  resetCustomValue,
  setCustomValue,
  stretchSlider,
} from "./render/customValues.ts";
import { BAND_SPLIT } from "./audio/bandSplit.ts";
import { resolveAutoGain, feedAutoGainMeasurement } from "./audio/autoGain.ts";
import {
  resolveSilenceGate,
  feedSilenceGateMeasurement,
  silenceGateDimmer,
  musicHoldsGate,
  hitPasses,
  SILENCE_GATE_OFF,
  type SilenceGateMarks,
  type SilenceGateReading,
} from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import type { OnsetDiag } from "./audio/onsetDiag.ts";
import { getPowerMode, setPowerMode, type PowerMode } from "./render/powerMode.ts";
import { getQualityChoice, setQualityChoice, type QualityChoice } from "./render/qualityPref.ts";
import {
  getOutputCastMode,
  getOutputPowerMode,
  getOutputQualityChoice,
  getOutputResolution,
  getPreviewQualityChoice,
  getPreviewResolution,
  getPreviewSize,
  PREVIEW_SIZE_FRACTION,
  setOutputCastMode,
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
  advanceAutoTune,
  tickAutoTune,
  resolveSceneSetting,
  resolveSensitivity,
  resolveExpansion,
  resolveSmoothing,
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
import { earsChange, listensOwn } from "./net/ears.ts";
import { recordsFromRoster } from "./net/roomMessages.ts";
import { applyDeviceSet, followersOf, ownerId, type Ears } from "../server/roomDevices.ts";
import { realStorage } from "./net/realStorage.ts";
import { captureRoomStorage, applyRoomStorage, applySyncedStorage, reloadSyncedStores } from "./net/syncedStores.ts";
import { isLookKey, takeRow, type LookRow } from "./net/lookDiff.ts";
import { describeRow, type RowNames } from "./ui/desk/rowWords.ts";
import { driveSourceColor, driveSourceLabel } from "./ui/driveSources.ts";
import { createMainPlay, type MainPlay } from "./net/mainPlay.ts";
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
import { browserMidiEnv, createMidiController } from "./ui/midiInput.ts";
import { createRoomView, rejectText, type RoomInvite, type RoomView } from "./ui/roomView.ts";
import { createGallery, type Gallery, type GallerySceneEntry } from "./ui/gallery.ts";
import { navigate, onRouteChange, seedHistory, currentRoute, type Route } from "./router.ts";
import { createImmersiveMode, type ImmersiveMode } from "./ui/fullscreen.ts";
import { createScenePicker, type ScenePickEntry, type ScenePicker } from "./ui/scenePicker.ts";
import { requestWakeLock } from "./ui/wakeLock.ts";
import { noteKeyUse } from "./ui/keyHints.ts";
import { shouldTickInBackground, startBackgroundTick } from "./net/backgroundTick.ts";
import { createBroadcastTransport, createOutputBridge, type OutputBridge } from "./net/outputBridge.ts";
import { combineBridges, createRoomBridge, type RoomBridge } from "./net/roomBridge.ts";
import { thisDevice } from "./net/deviceKind.ts";
import type { OutputPower, ToMain, ToOutput } from "./net/outputSync.ts";
import { createOutputControls, labelPlayKey, type OutputControls } from "./ui/outputControls.ts";
import { createEffectControls, effectShortcutId, type EffectControls } from "./ui/effectControls.ts";
import { createClipRecorder, type ClipRecorder } from "./ui/clipRecorder.ts";
import { createRecordControls, type RecordControls } from "./ui/recordControls.ts";
import {
  createPlayKey,
  glideMsForHold,
  isMacAgent,
  isPlayKey,
  PLAY_TAP_MAX_MS,
  RIGHT_CMD,
  spaceIsCue,
} from "./ui/outputKeys.ts";
import { BANDS_AMBER, ensureControlsStyles } from "./ui/controlsTheme.ts";
import { pinEverything, pinSceneMedia } from "./pinnedAssets.ts";
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
const sceneTag = document.getElementById("sceneTag") as HTMLDivElement;
const sceneBtn = document.getElementById("sceneBtn") as HTMLButtonElement;
const outBtn = document.getElementById("outBtn") as HTMLButtonElement;
const recBtn = document.getElementById("recBtn") as HTMLButtonElement;
const recAspectBtn = document.getElementById("recAspectBtn") as HTMLButtonElement;
const cueBtn = document.getElementById("cueBtn") as HTMLButtonElement;
const goBtn = document.getElementById("goBtn") as HTMLButtonElement;
const outStateEl = document.getElementById("outState") as HTMLSpanElement;
const takeBtn = document.getElementById("takeBtn") as HTMLButtonElement;
const deskBtn = document.getElementById("deskBtn") as HTMLButtonElement;
deskBtn.addEventListener("click", () => setDeskShown(true));
const outBarEl = document.getElementById("outBar") as HTMLElement;
const fxBarEl = document.getElementById("fxBar") as HTMLElement;
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
/** A page that joined a room by its QR (phone or iPad; net/lookSync.ts). Still
 *  `mode === "renderer"`, so a fourth mode doesn't fall into checks written for
 *  three. Says how the page joined, not whether it listens: that is
 *  `ownInput()`. Gate controller-only behavior on this flag alone. */
let isController = false;
/** A controller on a phone or tablet that is one more screen of the room, not a
 *  remote: full quality, controls hidden until a tap (ui/fullscreen.ts
 *  `enterHidden`). The Room view's screen `off` makes it a remote
 *  (`fillsScreen`). */
let handheldScreen = false;
let controllerConn: ControllerConnection | null = null;
/** The scene and palette ids this device holds for its room's look, even when it
 *  can't show them (net/controllerLook.ts). null in a solo or legacy room, which
 *  keeps the notes in applyScene / applyPalette / enterViz inert there. */
let controllerLook: ControllerLook | null = null;
/** This device's side of the room's Main (net/mainPlay.ts); null outside a keyed room. */
let mainPlay: MainPlay | null = null;
/** Controller only: the laptop has stopped sending frames. Set by currentVisual(). */
let laptopWaiting = false;

let capture: CaptureHandle | null = null;
/** Whether `capture` is a mic, the one source with a room's hiss for the
 *  silence gate to hold back (src/audio/silenceGate.ts). Read once at attach:
 *  a track's label never changes, and this runs every tick. */
let captureIsMic = true;
let bandAnalyser: BandAnalyser | null = null;
/** Hats and Lead off the full FFT bins, computed only on ticks where stemsRead() says something reads them. */
let stemGate: StemGate | null = null;
/** Mic samples for the input-health tap and the wire frame's wave tail; never feeds FeatureExtractor
 *  (see waveformAnalyser.ts header). */
let waveformAnalyser: WaveformAnalyser | null = null;
let inputHealthTap: InputHealthTap | null = null;
/** One long-lived instance with `reset()`, not one per capture (see inputHealth.ts header). */
const inputHealth = createInputHealth();
/** DEV-only deep (32768-sample) analyser for tools/audio-latency.mjs:
 *  waveformAnalyser's 2048 samples are too shallow to find a test click. */
let measureAnalyser: WaveformAnalyser | null = null;
/** The audio engine's feed (src/audio/engineSource.ts); null until it resolves,
 *  and where neither of its taps can be built. Its reading rides every local
 *  frame (FeatureFrame.engine). */
let engineSource: EngineSource | null = null;
let extractor = new FeatureExtractor();
/** Cached so re-entering a viz never re-prompts; cleared on failure or when the capture's track ends. */
let audioPromise: Promise<void> | null = null;
let captureFailed = false;
/** Kept current by watchMicPermission(); autoStartSource() checks it before any implicit start. */
let micPermission: MicPermission = "unknown";
let swapPromise: Promise<void> | null = null;
/** `?audio=synthetic[&bpm=N]`: a deterministic feed replacing the mic, so
 *  tools/tune-*.mjs reproduce an exact moment. Its presence short-circuits
 *  ensureAudio() and currentVisual(). */
let syntheticFeed: SyntheticFeed | null = null;
let syntheticStartMs = 0;

/** An ears choice not yet echoed by the room; decides `ownInput()` meanwhile.
 *  Cleared by the roster that carries it, a refusal, or PENDING_EARS_MS. */
let pendingEars: Ears | null = null;
let pendingEarsTimer = 0;
const PENDING_EARS_MS = 5000;
let ownWas = true;

/** Whether this page analyses its own input or draws another device's frames (rule in src/net/ears.ts). */
function ownInput(): boolean {
  return listensOwn(mode, activeConn()?.self ?? null, pendingEars);
}

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
/** What the boot benchmark (or dev `?quality=`) found, kept apart from `quality`
 *  so the Power card can mark it "recommended" under a user override. */
let detectedPreset: QualityPreset = "mid";
/** True when boot() found `?quality=`/`?tier=`: a pinned preset skips the
 *  governor. Module state so applyQualityChoice rebuilds it consistently. */
let pinned = false;
let qualityChoice: QualityChoice = getQualityChoice();
const effectivePreset = (): QualityPreset => (qualityChoice === "auto" ? detectedPreset : qualityChoice);
/** While a pop-out output is open this window is only a preview, so it renders
 *  cheaper (render/outputPower.ts); the output's own quality and energy saving
 *  travel to it as a `power` message. */
let previewChoice: QualityChoice = getPreviewQualityChoice();
let previewSize: PreviewSize = getPreviewSize();
let previewResolution = getPreviewResolution();
let outputPower: OutputPower = {
  quality: getOutputQualityChoice(),
  mode: getOutputPowerMode(),
  resolution: getOutputResolution(),
  cast: getOutputCastMode(),
};
/** An output window is open and a scene is showing; recomputed every tick. A
 *  remote controller previews whatever it shows; a screen (`fillsScreen`) never
 *  does. */
let previewActive = false;
/** previewActive while a clip records. The output renders in a separate process
 *  out of the recorder's reach, so for the take this window draws what the
 *  output would (quality, energy saving, buffer size). */
let recordAsOutput = false;
/** The control desk (ui/desk/desk.ts) while an output is open; loaded on first use. */
let desk: import("./ui/desk/desk.ts").Desk | null = null;
let deskLoading = false;
/** How many digit keys the desk's pads row answers to (desk.ts PADS_ROW_MAX); set when the desk loads. */
let deskPadsRowMax = 0;
/** A phone/iPad controller is a screen of the room unless the Room view turned
 *  it off; before the roster lists it, it counts as a screen. */
function fillsScreen(): boolean {
  return handheldScreen && controllerConn?.self?.screen !== "off";
}
/** A screen with hidden controls (index.html's `chrome-idle`) shows the picture
 *  alone: no HUD line for the scene it opens on or a followed Main. */
function quietScreen(): boolean {
  return handheldScreen && document.body.classList.contains("chrome-idle");
}
/** effectivePreset() stays the DEVICE's preset for scene availability, so the
 *  preview's lower quality never hides a scene from the gallery. A dev pin wins,
 *  so headless `?quality=` captures stay reproducible. */
function renderPreset(): QualityPreset {
  if (!previewActive || pinned) return effectivePreset();
  const choice = recordAsOutput ? outputPower.quality : previewChoice;
  const wanted = choice === "auto" ? detectedPreset : choice;
  const floor = scene.minQuality;
  return floor && presetRank(floor) > presetRank(wanted) ? floor : wanted;
}
function renderScale(): number {
  return quality.renderScale * (previewActive ? previewResolution : 1);
}
let mainHost: SceneHost | null = null;
let overlayLayer: OverlayLayer | null = null;
/** From `webglcontextlost` until the page reloads on restore (boot()): drawScene()
 *  draws nothing, and the picture readback isn't rebuilt on a dead context. */
let glLost = false;

/** Shared with tools/master-sweep.mjs. Created lazily at the first
 *  pictureWanted() sample, so a session that never opens the panel never
 *  allocates the blit chain. */
let pictureReadback: PictureReadback | null = null;
const pictureMeter = createPictureMeter();
const pictureAverager = createPictureAverager();
/** DEV-only (tuning/debug.ts's `picture.force`): sample with the panel closed, for headless sweeps. */
let pictureForced = false;
let lastPictureKickMs = -Infinity;

/** Panel blur's Fast look (ui/glassPref.ts): the renderer's copy of the panel's
 *  glass, created lazily on mainHost's GL context; `glassPanes` holds where it
 *  goes, read by syncGlass(). */
let glassBackdrop: GlassBackdrop | null = null;
/** This GPU could not build the passes: the browser's blur takes over for good. */
let glassBroken = false;
const glassPanes: GlassPane[] = [];
let glassPaneCount = 0;
const glassCanvasBox = { w: 0, h: 0 };

let gallery: Gallery | null = null;
let deviceMenu: DeviceMenu | null = null;
let immersive: ImmersiveMode | null = null;
let scenePicker: ScenePicker | null = null;
let inViz = false;
/** `?room=CODE` (no role): a mic-less renderer whose scene the host dictates, so
 *  the gallery is never built and routing is skipped. A phone controller browses,
 *  so never sets this. */
let bypassGallery = false;
let lastVis: FeatureFrame | null = null;
/** This tick's raw analyser bands, before the adaptive envelope and
 *  sensitivity/dynamics gain, for the "Listening post" toggle. Solo/host only (a
 *  renderer has no local mic). Reused in place every tick. */
let lastRawBands: Float32Array | null = null;
let lastMono: Float32Array | null = null;
/** DEV only, off measureAnalyser. Same buffer every read: copy before crossing a page.evaluate boundary. */
let lastDeepMono: Float32Array | null = null;
// The Any hit's diag off this device's own engine reading, for the Sound
// card's Hits drum roll. Read the same tick it's set (deviceMenu.update()), before the
// next currentVisual() mutates it in place.
let lastBeatDiag: OnsetDiag | null = null;
const beatDiag: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };
/** The capture clock's time of the last engine hit that passed the gate. */
let lastEngineOnsetAt = -Infinity;
// The engine reading's surge, for tuning/debug.ts getInput() (tools/audio-latency.mjs).
let lastFluxRatio: number | null = null;
// The silence gate's last reading off the local extractor, for the Gate row.
// `fired` is the local frame's onset (not the jitter-buffered `lastVis`), so it
// and `suppressed` describe the same tick's decision.
let lastGate: SilenceGateReading | null = null;
/** musicHoldsGate()'s last answer for the local capture (src/audio/silenceGate.ts). */
let gateMusicHeld = false;
/** Read by the Source row via the deviceMenu deps' getInputHealth, not
 *  DeviceMenu.update(): that row refreshes on its own slower timer. */
let lastInputHealth: InputHealthReading | null = null;
const rawBandsScratch = new Float32Array(NUM_BANDS);

// `?lock=` picks Lock's meaning in dev only (lockMeaning.ts); every other
// clock keeps the default.
const animClock = createAnimClock({ lockMeaning: import.meta.env.DEV ? lockMeaningFromQuery(location.search) : "stability" });
// Latches one-shot AnimFrame edges across ticks the render cap skips, and makes
// anim.dtSec wall time since the last *rendered* frame (renderLatch.ts). Only
// what reaches scene.render() goes through it; deviceMenu/audioMeters and
// advanceAutoTune see the raw `anim`.
const renderLatch = createRenderLatch();
// Per-setting state is already scoped by (scene, setting), so no recreating on a
// scene switch (drives.ts header: accumulate() vs. forScene()).
const driveEngine = createDriveEngine();
/** The demo groove behind the start prompt (idlePreviewActive(),
 *  renderIdlePreview()). Own clock, latch and drive engine: sharing them would
 *  lock the beat clock to this feed's tempo when the real source attaches and
 *  train advanceAutoTune's music profile. Local only: never sent to a TV,
 *  counted as usage or shown on meters. */
const idlePreview = {
  feed: createSyntheticFeed(),
  anim: createAnimClock(),
  latch: createRenderLatch(),
  drives: createDriveEngine(),
};
let lastRafMs = 0;
let hudHideTimer: number | undefined;

/** This tick's AnimFrame, read by the tuning probe (src/tuning/probe.ts) via boot()'s getInput(). */
let lastAnim: AnimFrame | null = null;

let outputBridge: OutputBridge | null = null;
let roomBridge: RoomBridge | null = null;
let outputControls: OutputControls | null = null;
/** The Set card's two markers: the pad loaded in this preview and the pad Play
 *  last sent. Ids, not indices, so adding or deleting a pad can't move them. Read
 *  via currentPadId() / `padMarkers`. */
let setPreviewPadId: string | null = null;
let setLivePadId: string | null = null;
let setPopOutWasOpen = false;
const setAutopilotState = createAutopilot();
/** Pad launches the desk has queued for a launch line (launchQueue.ts), run by the tick. */
let launchQueue: QueuedLaunch[] = [];
let launchQueueTempo = false;
/** How often each pad's measured picture is eased in, and how far one reading moves the stored value. */
const PAD_READING_MS = 500;
const PAD_READING_EASE = 0.3;
/** A Map blend is a short glide: short enough to follow a drag, long enough not to step. */
const MAP_GLIDE_MS = 200;
/** The pads' measured pictures (orchestrate.ts's Map), kept while a pad is on NEXT. */
const padReadings = new Map<string, { busy: number; bright: number }>();
let padReadingsAtMs = -Infinity;
let mapFollow = false;
let mapSceneChangedAtMs = -Infinity;
let effectControls: EffectControls | null = null;
let compositor: Compositor | null = null;
let clipRecorder: ClipRecorder | null = null;
let recordControls: RecordControls | null = null;
let outputSens = 1;
let outputExp = 1;
const fpsMeter = createFpsMeter();
const frameMisses = createFrameMisses();
// A hidden tab draws nothing or draws unseen on the background clock: the gap
// across it says nothing about late frames.
document.addEventListener("visibilitychange", () => frameMisses.restart());
let resourceMeter: ResourceMeter | null = null;

// Render-rate cap and its jitter-tolerant gate: framePace.ts (shared with tv.ts).
const renderGate = createRenderGate();
let lastPanelDrawMs = 0;

/** Closed-loop counterpart to detectQuality(): steps `quality`'s numeric knobs
 *  down under sustained load and back up. Rebuilt by applyQualityChoice() when
 *  the preset changes. */
let governor: QualityGovernor | null = null;

/** Energy saving mode (render/powerMode.ts): Auto leaves the governor in charge,
 *  On/Off take it out. Change only through applyPowerMode so governor and render
 *  cap stay in sync. */
let powerMode: PowerMode = getPowerMode();

/** Forced Energy saving On halves the cap to RENDER_FPS_CAP_FLOOR whatever the
 *  preset. The governor's own budget stays at the preset's interval: it only
 *  steps in Auto, so the two can't disagree. */
function renderIntervalMs(): number {
  return activePowerMode() === "on" ? 1000 / RENDER_FPS_CAP_FLOOR : targetFrameIntervalMs(quality.preset);
}

function activePowerMode(): PowerMode {
  return recordAsOutput ? outputPower.mode : powerMode;
}

function applyPowerMode(mode: PowerMode): void {
  powerMode = mode;
  governor?.setEnabled(activePowerMode() === "auto");
}

/** Mutates `quality` in place so mainHost's SceneContext, the gallery and the
 *  governor's `baseline` closure see it without a remount; the governor is
 *  rebuilt because its frame budget depends on the preset. No-op when the preset
 *  is unchanged, and on the numeric knobs while `pinned`. `remount` re-inits the
 *  mounted scene (geometry is sized at init). */
function applyRenderQuality(remount = false): void {
  const preset = renderPreset();
  if (preset === quality.preset) return;
  Object.assign(quality, qualitySettings(preset));
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);
  if (remount && inViz && mainHost) mountOrBail(scene, scene);
}

/** On while an output is open and the size isn't Full. A phone controller keeps
 *  the whole screen: a half-size picture on a phone is no preview. The desk
 *  (applyDesk) lays the canvas out itself, so this stays off under it. */
function applyPreviewBox(): void {
  document.body.classList.toggle("output-preview", previewActive && previewSize !== "full" && !isController && !(desk?.active() ?? false));
  document.body.style.setProperty("--preview-frac", String(PREVIEW_SIZE_FRACTION[previewSize]));
}

/** Names the desk's Play list rows use (ui/desk/rowWords.ts). */
const deskRowNames: RowNames = {
  scene: (id) => getScene(id)?.name ?? id,
  palette: (id) => getPalette(id).name,
  setting: (scope, key) => getScene(scope.split("@")[0])?.settings?.find((s) => s.key === key)?.label ?? null,
};

/** How long a sent change takes to land on the output: the PLAY LANDS bars at the current tempo, 0 for Cut. */
function deskLandMs(): number {
  const t = getSceneTransition();
  if (t.style === "cut") return 0;
  const bpm = lastAnim?.metronomeOn ? lastAnim.metronomeBpm : 120;
  return t.bars * 4 * (60000 / bpm);
}

/** LIVE's storage for the desk's strips, which read it every frame; re-read at most this often. Null while no output is open. */
const DESK_LIVE_READ_MS = 200;
let deskLiveRead: { at: number; storage: Record<string, string> | null } = { at: -Infinity, storage: null };
function deskLiveStorage(): Record<string, string> | null {
  const now = performance.now();
  if (now - deskLiveRead.at >= DESK_LIVE_READ_MS) deskLiveRead = { at: now, storage: outputBridge?.looks?.().live?.storage ?? null };
  return deskLiveRead.storage;
}

/** What LIVE holds for a dial (`storageKey` alone) or a setting (`scope` and `sub` into a two-level store): LIVE's stored number, else `fallback`. Null while no output is open. */
function deskLiveValue(storageKey: string, fallback: number, scope?: string, sub?: string): number | null {
  const storage = deskLiveStorage();
  if (!storage) return null;
  const text = storage[storageKey];
  let v: unknown;
  try {
    if (text === undefined) v = undefined;
    else if (scope === undefined) v = text === "" ? undefined : Number(text);
    else v = (JSON.parse(text) as Record<string, Record<string, unknown> | undefined>)[scope]?.[sub ?? ""];
  } catch {
    v = undefined;
  }
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The input a setting is wired to, as its strip names it: its first source that is on, and how many more. */
function deskInput(sceneId: string, spec: SceneSetting): { name: string; color: string } {
  const setting = getDriveSetting(sceneId, spec);
  if (setting === "scene") return { name: spec.drive?.sceneLabel ?? "Scene mix", color: "#8a92a3" };
  const on = setting.sources.filter((src) => !src.off);
  const first = on[0];
  if (!first) return { name: "Nothing", color: "#8a92a3" };
  const name = driveSourceLabel(first.choice);
  return { name: on.length > 1 ? `${name} +${on.length - 1}` : name, color: driveSourceColor(first.choice) };
}

/** The control desk while a pop-out output is open (ui/desk/desk.ts), loaded on first use so it costs the first paint nothing. Never on a phone controller; off while deskPref.ts says the classic layout. */
function applyDesk(): void {
  const canDesk = previewActive && !isController && !!outputBridge?.status().open;
  const want = canDesk && getDeskOn();
  deskBtn.style.display = canDesk && !want ? "block" : "none";
  if (want && !desk && !deskLoading) {
    deskLoading = true;
    void import("./ui/desk/desk.ts").then(({ createDesk, DESK_STRIPS_MAX, PADS_ROW_MAX }) => {
      deskPadsRowMax = PADS_ROW_MAX;
      const deskBpmText = (): string => (lastAnim?.metronomeOn ? `${Math.round(lastAnim.metronomeBpm)} BPM` : "-- BPM");
      const deskExpansion = {
        get: getSceneExpansion,
        set: setSceneExpansion,
        live: () => deskLiveValue(SCENE_EXPANSION_KEY, SCENE_EXPANSION_DEFAULT),
        min: SCENE_EXPANSION_MIN,
        max: SCENE_EXPANSION_MAX,
      };
      desk = createDesk({
        openPanel: () => {
          if (deviceMenu && !deviceMenu.isOpen()) deviceMenu.toggle();
        },
        panelOpen: () => deviceMenu?.isOpen() ?? false,
        closePanel: () => {
          if (deviceMenu?.isOpen()) deviceMenu.close();
        },
        leave: () => setDeskShown(false),
        bpmText: deskBpmText,
        playList: {
          looks: () => outputBridge?.looks?.() ?? { next: null, live: null },
          send: (state, glideMs) => {
            outputBridge?.sendState?.(state, glideMs);
          },
          landMs: deskLandMs,
          describe: (row) => describeRow(row, deskRowNames),
          dropStorage: (key, text) => {
            try {
              if (text === null) localStorage.removeItem(key);
              else localStorage.setItem(key, text);
            } catch {
              // Storage blocked or full: NEXT keeps its value.
            }
            reloadSyncedStores();
            deviceMenu?.sceneChanged();
          },
          dropPalette: (id) => applyCarriedPalette(id),
          dropScene: (live) => {
            // Only the look's own keys: the shelves (saved Looks, the Set) are
            // this window's and LIVE holds an older copy of them.
            applySyncedStorage(live.storage, localStorage, isLookKey);
            applyCarriedPalette(live.palette);
            const next = getScene(live.scene);
            if (next && next.id !== scene.id) {
              if (presetAllows(next, effectivePreset())) applyScene(next);
              else showHud("scene unavailable on this device", true);
            }
            deviceMenu?.sceneChanged();
          },
        },
        live: {
          source: canvas,
          following: () => {
            const s = outputBridge?.status();
            return !s?.open || s.cue || !s.differs;
          },
          setThumbs: (on) => outputBridge?.setThumbs?.(on),
          onThumb: (cb) => outputBridge?.onThumb?.(cb),
        },
        strips: {
          sceneId: () => scene.id,
          settings: () => (scene.settings ?? []).filter((s) => s.drive && !s.advanced).slice(0, DESK_STRIPS_MAX),
          value: (spec) => getSceneSetting(scene.id, spec),
          setValue: (spec, v) => setSceneSetting(scene.id, spec, v),
          liveValue: (spec) => deskLiveValue(SCENE_SETTINGS_KEY, settingDefault(scene.id, spec), settingScope(scene.id, spec.key), spec.key),
          reading: (spec) => (lastAnim ? driveEngine.forScene(scene.id, scene.settings ?? [], lastAnim).valueOf(spec.key) : null),
          inputName: (spec) => deskInput(scene.id, spec).name,
          inputColor: (spec) => deskInput(scene.id, spec).color,
          sendOne: (spec, glideMs) => {
            const l = outputBridge?.looks?.();
            if (!l?.next || !l.live) return;
            const scope = settingScope(scene.id, spec.key);
            const row: LookRow = { id: `e:${SCENE_SETTINGS_KEY}|${scope}|${spec.key}`, kind: "entry", storageKey: SCENE_SETTINGS_KEY, scope, key: spec.key, from: undefined, to: undefined };
            outputBridge?.sendState?.(takeRow(l.live, l.next, row), glideMs);
          },
          landMs: deskLandMs,
          master: {
            get: getSceneMaster,
            set: setSceneMaster,
            live: () => deskLiveValue(SCENE_MASTER_KEY, SCENE_MASTER_DEFAULT),
            min: SCENE_MASTER_MIN,
            max: SCENE_MASTER_MAX,
          },
          expansion: deskExpansion,
          committed: () => deviceMenu?.sceneChanged(),
        },
        pads: {
          list: listPads,
          sceneName: (sceneId) => getScene(sceneId)?.name ?? sceneId,
          livePadId: () => setLivePadId,
          nextPadId: currentPadId,
          queue: () => launchQueue,
          nowBeats: deskBeats,
          pick: () => {
            if (!inViz || !setAutopilotRuns()) return null;
            return peekAutopilot(
              setAutopilotState,
              { timeSec: performance.now() / 1000, beats: lastAnim?.metronomeBeats ?? 0, tempo: lastAnim?.metronomeOn ?? false },
              getAutopilot(),
              listPads().map((p) => p.id),
            );
          },
          tap: deskTapPad,
          addPad: addPadFromScreen,
          autopilot: getAutopilot,
          setAutopilot: setDeskAutopilot,
          skipPick: () => skipAutopilotPick(setAutopilotState, getAutopilot(), listPads().map((p) => p.id)),
          load: (id) => firePad(id),
        },
        orchestrate: {
          energy: () => lastAnim?.sectionIntensity ?? 0,
          effects: () => effectControls?.engaged() ?? NO_EFFECTS,
          queueAt: (id, at) => {
            launchQueue = queueLaunch(launchQueue, id, at);
          },
          cancelAt: (at) => {
            launchQueue = cancelLaunch(launchQueue, at);
          },
          reading: (id) => padReadings.get(id) ?? null,
          blend: mapBlend,
          launchNow: (id) => {
            firePad(id);
            outputControls?.go();
          },
          follow: () => mapFollow,
          setFollow: (on) => {
            mapFollow = on;
          },
        },
        sidecar: {
          liveName: () => listPads().find((p) => p.id === setLivePadId)?.name ?? scene.name,
          prev: () => stepDeskPad(-1),
          next: () => stepDeskPad(1),
          holdEffect: (id, on) => effectControls?.hold(id, on),
          effectsOn: () => effectControls?.engaged() ?? NO_EFFECTS,
          autopilot: getAutopilot,
          setAutopilot: setDeskAutopilot,
          expansion: deskExpansion,
          health: () => {
            const status = outputBridge?.outputStatus();
            return { inputOk: lastVis !== null, bpm: deskBpmText(), fps: status ? `${Math.round(status.fps)}` : "--" };
          },
        },
      });
      desk.setActive(previewActive && !isController && !!outputBridge?.status().open && getDeskOn());
      applyPreviewBox();
    });
  }
  desk?.setActive(want);
  // The desk changes whether the preview box applies, so refresh its class here.
  applyPreviewBox();
}

function setDeskShown(on: boolean): void {
  setDeskOn(on);
  applyDesk();
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

/** `timeStamp` is on performance.now()'s clock. In a room the picture is drawn a
 *  delay late, so the tap shifts to land on the beat shown. `hud`: key taps
 *  answer only from a run's second tap, so a stray Ctrl chord shows nothing. */
function tapTempo(timeStamp: number, hud: boolean): void {
  const conn = mode === "solo" ? null : activeConn();
  const res = tapTempoAt(timeStamp + (conn ? conn.pictureDelayMs() : 0));
  if (!hud) return;
  if (res.bpm > 0) showHud(`Tap tempo: ${Math.round(res.bpm)} BPM`);
  else if (res.taps > 1) showHud(`Tap tempo: ${res.more} more ${res.more === 1 ? "tap" : "taps"}`);
}

/** Space = Cue (held); Enter, Option and on a Mac right Command = Play (tap sends
 *  at once, hold glides): why, and what a glide touches, is in
 *  src/ui/outputKeys.ts's header. Capture phase, so a focused button or checkbox
 *  never also sees Space or Enter. Play works whenever the bar is up; Space is
 *  claimed only while a pop-out can cue. */
function wireOutputKeys(controls: OutputControls): void {
  const playKey = createPlayKey();
  const mac = isMacAgent(navigator.userAgent);
  let chargeRaf = 0;
  let spaceHeld = false;
  /** The `code` of the key holding a Play down (spaceIsCue reads it), or null. */
  let playHeldBy: string | null = null;

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
      // A held Play key is allowed: Play is pressed while Cue is held, and Space's
      // auto-repeat carries its modifier; it must stay a Cue.
      if (spaceIsCue(e, playHeldBy) && inViz && !isTypingTarget(e.target) && controls.cueActive()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        spaceHeld = true;
        if (e.repeat) return;
        noteKeyUse("cue");
        controls.holdCue(true);
        return;
      }
      if (isPlayKey(e, mac)) {
        if (!inViz || isTypingTarget(e.target) || !controls.playActive()) return;
        // Enter would also press the focused button on every auto-repeat.
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        if (e.repeat) return;
        playKey.down(performance.now());
        playHeldBy ??= e.code;
        if (!chargeRaf) chargeRaf = requestAnimationFrame(chargeTick);
        return;
      }
      // Any other key while a Play key is down is a chord, not a Play; a held
      // key's auto-repeat is no new press.
      if (!e.repeat) playKey.cancel();
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
      const rightCmd = mac && e.code === RIGHT_CMD;
      if (e.key !== "Enter" && e.key !== "Alt" && !rightCmd) return;
      const hold = playKey.up(performance.now());
      playHeldBy = null;
      if (hold !== null && controls.playActive()) {
        const glideMs = glideMsForHold(hold);
        const result = controls.go(glideMs ?? undefined);
        noteKeyUse("go");
        if (result === "glide" && glideMs !== null) showHud(`Play: gliding over ${(glideMs / 1000).toFixed(1)} s`);
        else if (glideMs !== null) showHud("Play: sent at once");
        else showHud("Play: sent to output");
      }
      // macOS sent no key-up for a Space or K let go while Command was down, so
      // the Cue goes now (outputKeys.ts's header).
      if (rightCmd) {
        spaceHeld = false;
        controls.holdCue(false);
      }
    },
    true,
  );

  window.addEventListener("pointerdown", () => playKey.cancel(), true);
  const drop = (): void => {
    playKey.reset();
    playHeldBy = null;
    spaceHeld = false;
    controls.holdCue(false); // the key-up will never arrive: the master goes back
  };
  window.addEventListener("blur", drop);
  document.addEventListener("visibilitychange", drop);
}

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, effectivePreset()));
}

function galleryEntries(): GallerySceneEntry[] {
  return listScenes().map((s) => {
    const enabled = presetAllows(s, effectivePreset());
    return {
      scene: s,
      enabled,
      stage: sceneStage(s.id),
      reason: enabled ? undefined : "Needs a faster device",
    };
  });
}

function scenePickEntries(): ScenePickEntry[] {
  return galleryEntries().map((e) => ({ id: e.scene.id, name: e.scene.name, stage: e.stage, enabled: e.enabled, reason: e.reason }));
}

function pickSceneFromList(id: string): void {
  const next = getScene(id);
  if (!inViz || !next || next.id === scene.id) return;
  if (!presetAllows(next, effectivePreset())) {
    showHud("scene unavailable on this device", true);
    return;
  }
  applyScene(next);
  deviceMenu?.sceneChanged();
}

/** Fills the scene view's version corner (`#sceneVersion`): "<Scene name>
 *  <version>" (`+dev` in amber), a dot, then the build label (src/version.ts).
 *  The name is omitted where the scene list's button already says it (all but a
 *  `?room=` renderer); with no version of its own (see sceneVersions.ts header)
 *  just the build label. */
function updateSceneVersionLabel(next: Scene): void {
  const appLabel = versionLabel(BUILD_INFO);
  const offStable = BUILD_INFO.channel !== "stable";
  const hintColor = offStable ? BANDS_AMBER : "rgba(255,255,255,.4)";
  const sceneVer = sceneVersionOf(next.id);
  scenePicker?.setScene(next.name);
  sceneTag.textContent = next.name;

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
  nameEl.textContent = bypassGallery ? `${next.name} ${base}` : base;
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

/** Mounts `next`; if its init() throws (a shader this GPU won't compile, a
 *  missing float target), says so and goes back to the gallery, or to `prev`
 *  when there is none. Returns whether `next` runs; on false `scene` has been
 *  restored, so callers must stop. `crossfade` blends from `prev`, which then
 *  stays mounted. */
function mountOrBail(next: Scene, prev: Scene, crossfade = false): boolean {
  const host = mainHost!;
  const codeArrived = sceneReady(next);
  // Mounting compiles shaders: the gap across it is not frames coming late.
  frameMisses.restart();
  compositor?.cancel();
  // The old scene stays mounted under the new one until the blend is done
  // (render/crossfade.ts, sceneTransition.ts). The floor preset always cuts: two
  // scenes at once are too much for it.
  const fade = crossfade && prev !== next && host.isMounted(prev);
  if (!fade) host.unmountAll();
  try {
    host.mount(next);
    if (!codeArrived) sceneBeforePending.set(next, prev);
    if (fade) compositor?.begin(prev, crossfadeOptions(getSceneTransition(), quality.preset === "floor"));
    return true;
  } catch (err) {
    console.error(`"${next.name}" failed to start:`, err);
  }
  bailFromScene(next, prev);
  return false;
}

/** What `scene` was when a mount went ahead before its code arrived, for the
 *  fallback if that mount fails later (the host's onLateMountError). */
const sceneBeforePending = new Map<Scene, Scene>();

/** `next` can't run: says so, and goes back to the gallery, or to `prev` when
 *  there is none. */
function bailFromScene(next: Scene, prev: Scene): void {
  showHud(`${next.name} can't run on this device`, true);
  scene = prev;
  if (!bypassGallery) {
    navigate({ kind: "gallery" }, "replace");
  } else if (prev !== next) {
    try {
      mainHost!.mount(prev);
    } catch (err) {
      console.error(`"${prev.name}" failed to restart:`, err);
    }
  }
}

function onLateSceneMountError(failed: Scene, err: unknown): void {
  console.error(`"${failed.name}" failed to start:`, err);
  const prev = sceneBeforePending.get(failed);
  sceneBeforePending.delete(failed);
  if (failed !== scene || !prev) return;
  // A crossfade toward the failed scene would otherwise end by unmounting `prev`.
  compositor?.cancel();
  bailFromScene(failed, prev);
}

/** Local picks and remote commands take this one path, so the roster reflects reality. */
function applyScene(next: Scene, cut = false): void {
  sceneGuard.forgive(next.id);
  if (!mainHost) return;
  const prev = scene;
  scene = next;
  controllerLook?.noteScene(next.id);
  // Before the mount, which sizes geometry from `quality`: the new scene's
  // minQuality may differ while previewing.
  if (previewActive) applyRenderQuality();
  if (!mountOrBail(next, prev, inViz && !cut)) return;
  updateSceneVersionLabel(next);
  if (!quietScreen()) showHud(`scene: ${scene.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
  if (inViz) navigate({ kind: "viz", sceneId: scene.id }, "replace");
}

/** A scene that throws while drawing is cut to the one before it (or Spectrum)
 *  here, through the normal scene change, so a room's TVs follow it. */
const sceneGuard = createSceneGuard({
  switchTo: (next) => {
    applyScene(next, true);
    return scene === next;
  },
  dropOutgoing: () => compositor?.cancel(),
  builtIn: () => getScene("spectrum"),
  canRun: (s) => presetAllows(s, effectivePreset()),
  notice: (failed, next, wasShown) =>
    showHud(
      wasShown
        ? `${failed.name} stopped on this computer, so ${next.name} is back.`
        : `${failed.name} stopped on this computer, so ${next.name} is showing instead.`,
      true,
    ),
});

function applyPalette(next: Palette): void {
  palette = next;
  controllerLook?.notePalette(next.id);
  showHud(`palette: ${palette.name}`);
  activeConn()?.sendHello(scene.id, palette.id);
}

function applyCarriedPalette(id: string | undefined): void {
  if (id && id !== palette.id && PALETTES.some((p) => p.id === id)) applyPalette(getPalette(id));
}

function applyLookAndPalette(look: SceneLook): void {
  const specs = getScene(look.sceneId)?.settings ?? [];
  applyLook(look, specs);
  applyCarriedPalette(look.paletteId);
}

// ---- The Set: pads of looks, keys 1-9, Autopilot ----
// Model: render/sceneSet.ts; card: ui/setCard.ts; timing: render/setAutopilot.ts.

function currentPadId(): string | null {
  const pad = listPads().find((p) => p.id === setPreviewPadId);
  return pad && pad.look.sceneId === scene.id ? pad.id : null;
}

function setAutopilotRuns(): boolean {
  return !isController && ownInput();
}

/** Loads a pad's clip: look, palette, then scene (the order startMainPlay uses,
 *  so the scene mounts already tuned). With an output open this is the preview
 *  and Play sends it; Autopilot plays it itself. A manual press restarts
 *  Autopilot's bar count; its own change keeps the count it just re-anchored. */
function firePad(id: string, byAutopilot = false): void {
  const pads = listPads();
  const at = pads.findIndex((p) => p.id === id);
  if (at < 0 || !inViz) return;
  const pad = pads[at]!;
  const next = getScene(pad.look.sceneId);
  if (!next || !presetAllows(next, effectivePreset())) {
    showHud(next ? "scene unavailable on this device" : "that pad's scene is gone", true);
    return;
  }
  applyLook(pad.look, next.settings ?? []);
  applyCarriedPalette(pad.paletteId);
  if (next.id !== scene.id) applyScene(next);
  setPreviewPadId = pad.id;
  if (!byAutopilot) restartAutopilot(setAutopilotState, pad.id);
  showHud(`pad ${at + 1}: ${scene.name}`);
  if (byAutopilot) outputControls?.go();
  deviceMenu?.sceneChanged();
}

function addPadFromScreen(): string | null {
  const result = addCapturedPad(scene.id, scene.settings ?? [], palette.id);
  if (result.ok) {
    setPreviewPadId = result.pad.id;
    return null;
  }
  return result.reason === "full"
    ? `The Set is full (${SET_MAX_PADS} pads). Delete one to add another.`
    : "This look is too big to keep in the Set.";
}

const NO_PADS: readonly string[] = [];

function stepSetAutopilot(anim: AnimFrame, nowMs: number): void {
  if (!inViz || !setAutopilotRuns()) {
    setAutopilotState.counting = null; // counts only while it can fire
    return;
  }
  const config = getAutopilot();
  const id = stepAutopilot(
    setAutopilotState,
    { timeSec: nowMs / 1000, beats: anim.metronomeBeats, tempo: anim.metronomeOn },
    config,
    config.on ? listPads().map((p) => p.id) : NO_PADS,
  );
  if (id) firePad(id, true);
}

/** The latest picture reading, or null once sampling has gapped past
 *  PICTURE_GAP_RESET_MS plus however long the readback holds thumbnails back
 *  to batch reads: never a frozen last value. */
function freshPictureReading(): ReturnType<typeof pictureMeter.latest> {
  return performance.now() - pictureMeter.lastAtMs < PICTURE_GAP_RESET_MS + (pictureReadback?.holdMs() ?? 0) ? pictureMeter.latest() : null;
}

/** Eases the picture of the pad on NEXT into its stored reading. Only the Map reads these; they stay null until the pad has been on NEXT with a reading. */
function updatePadReadings(): void {
  const id = currentPadId();
  const r = freshPictureReading();
  if (id === null || !r) return;
  const level = (key: "brightness" | "motion" | "detail"): number | null => {
    const m = PICTURE_MEASURES.find((x) => x.key === key);
    return m ? displayLevel(m, r[key]) : null;
  };
  const bright = level("brightness");
  const parts = [level("motion"), level("detail")].filter((v): v is number => v !== null);
  if (bright === null || parts.length === 0) return;
  const busy = parts.reduce((sum, v) => sum + v, 0) / parts.length;
  const prev = padReadings.get(id);
  padReadings.set(
    id,
    prev
      ? { busy: prev.busy + (busy - prev.busy) * PAD_READING_EASE, bright: prev.bright + (bright - prev.bright) * PAD_READING_EASE }
      : { busy, bright },
  );
}

/** The Map's blend: two looks of one scene at `share`. NEXT takes it (the pad a is loaded first if it is another scene's) and plays to LIVE with a short glide. */
function mapBlend(aId: string, bId: string, share: number): void {
  const pads = listPads();
  const a = pads.find((p) => p.id === aId);
  const b = pads.find((p) => p.id === bId);
  if (!a || !b || a.look.sceneId !== b.look.sceneId) return;
  if (a.look.sceneId !== scene.id) firePad(a.id);
  const specs = scene.settings ?? [];
  for (const [key, value] of Object.entries(blendValues(a.look.manual, b.look.manual, share))) {
    const spec = specs.find((s) => s.key === key);
    if (!spec || spec.type !== undefined) continue;
    setSceneSetting(scene.id, spec, value);
  }
  outputControls?.go(MAP_GLIDE_MS);
  const now = performance.now();
  if (now - mapSceneChangedAtMs >= PAD_READING_MS) {
    mapSceneChangedAtMs = now;
    deviceMenu?.sceneChanged();
  }
}

/** The beat count pad launches wait on: the metronome's, or seconds at Autopilot's fallback bar length with no tempo. */
function deskBeats(): number {
  return lastAnim?.metronomeOn ? lastAnim.metronomeBeats : (performance.now() / 1000) * (METRONOME_BEATS_PER_BAR / AUTOPILOT_FALLBACK_SEC_PER_BAR);
}

/** Autopilot's setting from the desk (the pads and the Sidecar): a change restarts its bar count on the pad that is on NEXT. */
function setDeskAutopilot(change: Partial<AutopilotConfig>): void {
  setAutopilot(change);
  restartAutopilot(setAutopilotState, currentPadId() ?? setAutopilotState.cursor);
}

/** The Sidecar's PREV (-1) and NEXT (1): the pad before or after LIVE's in the Set, wrapping, or the pad on NEXT when none is live. It lands on the next beat. */
function stepDeskPad(dir: 1 | -1): void {
  const pads = listPads();
  if (pads.length === 0) return;
  const liveAt = pads.findIndex((p) => p.id === setLivePadId);
  const base = liveAt >= 0 ? liveAt : pads.findIndex((p) => p.id === currentPadId());
  const at = base < 0 ? (dir > 0 ? 0 : pads.length - 1) : (base + dir + pads.length) % pads.length;
  launchQueue = queueLaunch(launchQueue, pads[at]!.id, launchBeat(deskBeats(), "beat"));
}

/** A pad pressed on the desk: Shift loads NEXT only; otherwise it lands on the next launch line, on NEXT and LIVE together. */
function deskTapPad(id: string, shift: boolean): void {
  if (shift) {
    firePad(id);
    return;
  }
  const on = getLaunchOn();
  if (on === "now") {
    firePad(id);
    outputControls?.go();
    return;
  }
  launchQueue = queueLaunch(launchQueue, id, launchBeat(deskBeats(), on));
}

function fatalError(message: string): void {
  showHud(message, true);
}

/** `?source=display` where supported. Never stripped from the URL (unlike
 *  `?look=`), so it stays authoritative for the session. */
function urlPinnedSource(): AudioSourceChoice | null {
  const params = new URLSearchParams(location.search);
  return params.get("source") === "display" && displayCaptureSupported() ? "display" : null;
}

/** `?source=display` pins the initial choice like `?quality=` pins a preset
 *  (dev/tooling, no localStorage). Pinning "display" does NOT start a capture;
 *  see autoStartSource(). */
function resolveInitialSource(): AudioSourceChoice {
  const pinned = urlPinnedSource();
  if (pinned) return pinned;
  const stored = getStoredAudioSource();
  return stored === "display" && !displayCaptureSupported() ? "mic" : stored;
}

/** The one truth every source picker renders (see SourceState in sourcePref.ts).
 *  A running capture wins, derived from `capture.kind` and not the stored pref:
 *  swapAudioSource attaches before persisting, so the pref would flash the old
 *  choice for a tick. */
function currentSourceState(): SourceState {
  const liveChoice: AudioSourceChoice | null =
    bandAnalyser && capture ? (capture.kind === "display" ? "display" : "mic") : null;
  return resolveSourceState({ liveChoice, preferredChoice: resolveInitialSource() });
}

/** The source an IMPLICIT start (opening a scene, tapping a tile) may use: only
 *  one whose permission is still active, so it never pops an unrequested browser
 *  prompt. Otherwise updateMicPrompt() puts the start prompt up. That means the
 *  mic with permission granted; a remembered "display" pick never qualifies
 *  (getDisplayMedia's permission isn't remembered and it reopens the picker on
 *  every call). "prompt", denied and "unknown" (Safari) wait for a tap. */
function autoStartSource(): AudioSourceChoice | null {
  return micPermission === "granted" ? "mic" : null;
}

function startCapture(choice: AudioSourceChoice): Promise<CaptureHandle> {
  return choice === "display" ? captureDisplayAudio() : startMic();
}

/** The chosen input (src/audio/inputDevice.ts) or the system default. A chosen
 *  device that isn't plugged in falls back to the default with a HUD note rather
 *  than leaving the scene deaf; onInputDevicesChanged moves back when it
 *  returns. */
async function startMic(): Promise<CaptureHandle> {
  const pref = getInputDevicePref();
  if (!pref) return captureMic();
  const before = await listDevicesQuietly();
  const chosen = await openChosenInput(pref, before);
  if (chosen) return chosen;
  const fallback = await captureMic();
  // No labels before the first grant, so a device whose id has rotated
  // (inputDevice.ts header) can only be found by label once the fallback's grant
  // made labels readable.
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

/** Cached: the Source row's timer-driven refresh reads synchronously. */
let inputDevices: InputDeviceOption[] = [];
let defaultInputName: string | null = null;

async function refreshInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await listDevicesQuietly();
  inputDevices = inputDeviceOptions(devices);
  defaultInputName = defaultInputLabel(devices);
  syncInputPreview();
  return devices;
}

/** The Source row's idle signal-preview meters (audio/inputPreview.ts). Runs only
 *  where inputPreviewSupported() and a pickable option exists, and is re-synced
 *  wherever what it previews can change. Hidden inputs and ones a preview would
 *  disturb (Bluetooth headsets, an iPhone's mic; previewWouldDisturb) are never
 *  opened. */
let inputPreview: InputPreview | null = null;
let inputPreviewActive = false;

function syncInputPreview(): void {
  // A page that follows another device listens to nothing: previewing must not
  // light its mic indicator.
  if (!ownInput() || !inputPreviewActive || !inputPreviewSupported() || inputDevices.length === 0) {
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

/** An input was plugged in or pulled. If the chosen input just (re)appeared while
 *  the mic listens to something else (the fallback default, after a pulled
 *  cable), move over to it now. */
async function onInputDevicesChanged(): Promise<void> {
  const devices = await refreshInputDevices();
  const pref = getInputDevicePref();
  if (!pref || capture?.kind !== "mic" || !bandAnalyser || swapPromise) return;
  const resolved = resolveInputDeviceId(pref, devices);
  if (resolved === "missing" || resolved.deviceId === null) return;
  const liveId = capture.stream.getAudioTracks()[0]?.getSettings().deviceId;
  if (resolved.deviceId !== liveId) void swapAudioSource("mic", true);
}

function liveInputLabel(): string | null {
  if (capture?.kind !== "mic") return null;
  return deviceLabel(capture.stream.getAudioTracks()[0]?.label ?? "") || null;
}

function chooseInputDevice(deviceId: string): void {
  const current = getInputDevicePref();
  const option = inputDevices.find((o) => o.deviceId === deviceId);
  // The dropdown's "not connected" entry for the stored choice isn't in
  // inputDevices: re-picking it keeps the choice.
  const next = option ? { deviceId, label: option.label } : current?.deviceId === deviceId ? current : null;
  setInputDevicePref(next);
  refreshAudioPromptButtons();
  gallery?.syncSource();
  if (!ownInput() || syntheticFeed) return;
  if (!bandAnalyser) {
    setAudioSourceChoice("mic");
    void ensureAudio("mic");
  } else void swapAudioSource("mic", true);
}

/** The Stop button, and a tap on the already-live source in either picker:
 *  releases the capture and leaves it released (stoppedByUser keeps implicit
 *  starts from reopening it until a tap). The room connection is untouched. */
function stopOwnCapture(): void {
  if (!capture) return;
  stoppedByUser = true;
  onCaptureEnded(capture, false);
}

function captureAudioSource(kind: CaptureSourceKind): AudioSource {
  return kind;
}

/** Builds the analysers off a fresh capture and listens for its track ending
 *  externally (Chrome's "Stop sharing", a revoked permission) instead of freezing
 *  at zero. Also where a swap re-attaches, so it resets inputHealth: readings must
 *  not carry between inputs. */
function attachCapture(handle: CaptureHandle): void {
  capture = handle;
  // Same test as the stop button's kind tag, so what it calls a mic is gated.
  const label = liveInputLabel();
  captureIsMic = handle.kind === "mic" && (!label || inputKind(label) === "mic");
  // A fresh extractor, not a reset() (it has none): its clocks (lastPulseTime,
  // lastOnsetTime, peakHoldUntil, ...) are absolute AudioContext.currentTime
  // values and a new context restarts near 0, so the old one would sit "in the
  // future" and fire no onset, pulse or band decay; and its AGC envelope would
  // blow the visuals out for its ~1.25s re-adaptation on the big level jump of a
  // mic-to-screen swap.
  extractor = new FeatureExtractor();
  bandAnalyser = createBandAnalyser(handle.context, handle.sourceNode);
  stemGate = createStemGate(createStemSplitter(bandAnalyser.binsDb.length, bandAnalyser.binHz));
  waveformAnalyser = createWaveformAnalyser(handle.context, handle.sourceNode);
  inputHealthTap?.dispose();
  inputHealthTap = createInputHealthTap(handle.context, handle.sourceNode, handle.stream);
  inputHealth.reset();
  if (import.meta.env.DEV) measureAnalyser = createWaveformAnalyser(handle.context, handle.sourceNode, 32768);
  engineSource = null;
  void createEngineSource(handle.context, handle.sourceNode).then((source) => {
    if (capture !== handle) {
      source?.dispose();
      return;
    }
    engineSource = source;
  });
  // stop() (a swap retiring this handle) fires no "ended" per spec, only an
  // external stop does, so this and a deliberate swap never race.
  const track = handle.stream.getAudioTracks()[0];
  track?.addEventListener("ended", () => onCaptureEnded(handle), { once: true });
  // Every attach path (ensureAudio, swapAudioSource, fallBackToSolo) funnels
  // here, so repaint the source pickers and stop button here.
  updateMicPrompt();
  gallery?.syncSource();
  reportUsage();
  // The first mic grant makes labels readable; the live input also changes which
  // device the preview excludes.
  void refreshInputDevices();
  syncInputPreview();
}

/** Called from both ends because either can come last; the synthetic feed never counts. */
function reportUsage(): void {
  if (!inViz) return;
  if (!ownInput()) reportSceneRunning(scene.id, "remote");
  else if (capture) reportSceneRunning(scene.id, captureAudioSource(capture.kind) === "display" ? "display" : "mic");
}

/** The live capture's track ended on its own (Chrome's "Stop sharing", a revoked
 *  mic permission, an unplugged interface). Tears down and re-shows the start
 *  prompt instead of freezing at zero. It doesn't fall back to another source:
 *  that would fire an unrequested permission prompt. The exception is the mic
 *  while its permission stands (reopening prompts nobody, and keeps a set going
 *  when a cable is pulled). The Stop button passes `reopen = false`. */
function onCaptureEnded(handle: CaptureHandle, reopen = true): void {
  if (capture !== handle) return; // already superseded by a swap
  handle.stop();
  capture = null;
  bandAnalyser = null;
  stemGate = null;
  waveformAnalyser = null;
  measureAnalyser = null;
  inputHealthTap?.dispose();
  inputHealthTap = null;
  inputHealth.reset();
  engineSource?.dispose();
  engineSource = null;
  audioPromise = null;
  captureFailed = false;
  updateMicPrompt();
  gallery?.syncSource();
  syncInputPreview(); // nothing live now, so the preview can cover every device again
  if (reopen && handle.kind === "mic" && micPermission === "granted") void ensureAudio("mic");
}

/** Copy the user can act on. A mic denial and a cancelled share picker raise the
 *  same DOMException, hence branching on `choice`; other errors surface verbatim
 *  with a retry hint. */
function captureErrorMessage(choice: AudioSourceChoice, err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return choice === "display"
      ? "Screen share cancelled — tap Screen to try again."
      : "Microphone permission denied — tap Mic to try again.";
  }
  const message = err instanceof Error ? err.message : String(err);
  return `${message} — tap to try again.`;
}

/** Starts capture on first call, from `explicit` when a tap named a source, else
 *  autoStartSource() (never the display picker unbidden). Later calls return the
 *  same promise. Capture survives trips to the gallery so the room code and TV
 *  pairing keep working. */
function ensureAudio(explicit?: AudioSourceChoice): Promise<void> {
  // A page following another device hears through its frames; gallery tile taps
  // and the source picker reach here and must not open its mic.
  if (syntheticFeed || !ownInput()) return Promise.resolve();
  if (audioPromise) return audioPromise;
  const choice = explicit ?? autoStartSource();
  if (choice === null) {
    updateMicPrompt(); // nothing started — the prompt is the way in
    return Promise.resolve();
  }
  stoppedByUser = false;
  const attempt = (async () => {
    const handle = await startCapture(choice);
    // The page switched to a feed's frames while the prompt or picker was open:
    // let this input go.
    if (!ownInput()) {
      handle.stop();
      audioPromise = null;
      return;
    }
    attachCapture(handle);
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
 *  screen joining (`feedFollowers`) never reopens a mic that was just closed. */
let stoppedByUser = false;
let screensReady = false;

/** The roster changed. A device following this one shows only what this page
 *  hears, so with a follower and nothing listening, start the prompt-free source
 *  (the allowed mic), even on the gallery: a reloaded laptop would otherwise
 *  leave its TV waiting until a scene opens. Other sources need a tap (the TV
 *  says so, net/tvPhase.ts `waitingLine`). In a claimed room a follower is
 *  whoever the records say draws from this device and is online; a legacy room
 *  has no records, so any screen counts. */
function feedFollowers(roster: RosterEntry[]): void {
  if (!screensReady || !ownInput() || capture || audioPromise || captureFailed || stoppedByUser || syntheticFeed) return;
  const conn = activeConn();
  if (!conn) return;
  const { records, online } = recordsFromRoster(roster);
  const followed =
    conn.keyed && records.has(conn.deviceId)
      ? followersOf(records, conn.deviceId).some((id) => online.has(id))
      : roster.some((d) => d.role === "renderer" && d.online);
  if (followed && autoStartSource() !== null) void ensureAudio();
}

function setPendingEars(ears: Ears | null): void {
  window.clearTimeout(pendingEarsTimer);
  pendingEars = ears;
  if (ears !== null) {
    pendingEarsTimer = window.setTimeout(() => {
      pendingEars = null;
      syncEars();
    }, PENDING_EARS_MS);
  }
}

function feedNameFor(conn: AnyConn): string {
  const roster = conn.currentRoster;
  const id = conn.self?.follow ?? ownerId(recordsFromRoster(roster).records);
  return roster.find((d) => d.deviceId === id)?.name ?? "the room";
}

/** Acts when `ownInput()` changed since last looked: releases or opens the mic,
 *  restarts the connection's frames so a feed's and its own never mix in one
 *  buffer, and repaints. Does nothing when the answer is the same. */
function syncEars(): void {
  const now = ownInput();
  // Frames from a feed are dropped while this page is its own feed (net/room.ts).
  activeConn()?.setAcceptFrames(!now);
  if (now && controllerConn) setLaptopWaiting(false);
  document.body.classList.toggle("follows-room", !now);
  const change = earsChange(ownWas, now);
  ownWas = now;
  if (change === "none") return;
  const conn = activeConn();
  conn?.resetFrames();
  if (change === "stop-own") {
    // The Stop button's teardown, but not the user's own Stop: a later switch
    // back may start the source by itself. A capture still opening lets itself go
    // when it lands (ensureAudio).
    if (capture) onCaptureEnded(capture, false);
    updateMicPrompt();
    gallery?.syncSource();
    syncInputPreview();
    showHud(`Listening through ${conn ? feedNameFor(conn) : "the room"}`);
  } else {
    // Silent when the mic is already allowed; otherwise the start prompt asks (an
    // iPad needs the tap).
    if (inViz) void ensureAudio();
    updateMicPrompt();
    gallery?.syncSource();
    syncInputPreview();
    if (conn) feedFollowers(conn.currentRoster);
    showHud("Listening to this device");
  }
}

/** Another device online in the room means a show: pin every scene's media so a
 *  venue's wifi dropping mid-set can't cost a scene its media
 *  (src/pinnedAssets.ts header, "Scene media"). pinSceneMedia() acts once. */
function pinMediaOncePaired(conn: AnyConn): void {
  const check = (roster: RosterEntry[]): void => {
    if (roster.some((d) => d.online && d.deviceId !== conn.deviceId)) pinSceneMedia();
  };
  conn.onRosterChange(check);
  check(conn.currentRoster);
}

function wireEars(conn: AnyConn): void {
  conn.onRosterChange((roster) => {
    if (pendingEars !== null && conn.self?.ears === pendingEars) setPendingEars(null);
    syncEars();
    feedFollowers(roster);
  });
  conn.onDeviceReject((m) => {
    if (pendingEars === null) return;
    if (m.targetId !== null && m.targetId !== conn.deviceId) return;
    setPendingEars(null);
    showHud(rejectText(m.reason));
    syncEars();
  });
  // A removed device or a closed room ends this page's own capture: nothing is
  // left to feed, and the browser's mic indicator must go out.
  conn.onState((s) => {
    if (s === "denied" && capture) {
      stoppedByUser = true;
      onCaptureEnded(capture, false);
    }
  });
  ownWas = ownInput();
  conn.setAcceptFrames(!ownWas);
  document.body.classList.toggle("follows-room", !ownWas);
}

/** Starts the new capture BEFORE touching the old one: if the user cancels the
 *  share picker, the old one must still be running. `restart` reopens even the
 *  live source (the mic moving to another device). */
function swapAudioSource(next: AudioSourceChoice, restart = false): Promise<void> {
  if (!bandAnalyser || syntheticFeed || !ownInput()) return Promise.resolve();
  if (capture?.kind === next && !restart) return Promise.resolve();
  // A restart queues behind a swap in flight rather than dropping: a second
  // device picked mid-swap is the one that has to end up live.
  if (swapPromise) return restart ? swapPromise.then(() => swapAudioSource(next, true)) : swapPromise;
  const previous = capture;
  const attempt = (async () => {
    const handle = await startCapture(next);
    if (!ownInput()) {
      handle.stop(); // switched to a feed's frames while the picker was open
      return;
    }
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

/** Same words as the Source row's kind tag (INPUT_KIND_TEXT). No stored choice
 *  reads as "Mic": a laptop's default input almost always is one. */
function inputChoiceLabel(): string {
  const pref = getInputDevicePref();
  if (!pref) return "Mic";
  const kind = inputKind(pref.label);
  return kind === "mic" ? "Mic" : kind === "line" ? "Line in" : "Loopback";
}

/** Display capture availability never changes mid-session; the share-audio guide
 *  follows the same condition, so it is set here, not in updateMicPrompt. */
function refreshAudioPromptButtons(): void {
  const canDisplay = displayCaptureSupported();
  audioPromptLabel.hidden = !canDisplay;
  audioPromptDisplayBtn.hidden = !canDisplay;
  // On the label span: the button also holds .apDot, which setting its
  // textContent would wipe.
  audioPromptMicLabel.textContent = canDisplay ? inputChoiceLabel() : "Tap to enable mic";
  audioPromptGuide.textContent = DISPLAY_SHARE_GUIDE;
  audioPromptGuide.hidden = !canDisplay;
}

function updateStopBtn(): void {
  stopBtn.style.display = inViz && capture && bandAnalyser ? "block" : "none";
  // Names what it stops. Uses the LIVE device's label, not the stored choice: a
  // fallback to the default while the chosen interface is unplugged should name
  // what's listening. No label yet (before a track's label settles) reads as "MIC".
  const label = liveInputLabel();
  const kind = label ? inputKind(label) : "mic";
  stopBtn.textContent = capture?.kind === "display" ? "STOP SHARE" : `STOP ${INPUT_KIND_TEXT[kind].tag}`;
}

function updateMicPrompt(): void {
  updateStopBtn();
  // Hidden while an attempt is in flight, so we don't double-prompt.
  const needsAudio = inViz && ownInput() && !syntheticFeed && !bandAnalyser && (captureFailed || !audioPromise);
  audioPrompt.style.display = needsAudio ? "flex" : "none";
}

/** Renderer lost (or never reached) its room: fall back to this device's own mic. */
async function fallBackToSolo(reason: string): Promise<void> {
  // A controller never becomes a solo mic: it reconnects, or is told to re-pair.
  if (soloFallbackTriggered || isController) return;
  soloFallbackTriggered = true;
  showHud(`room ${reason} — switching to solo mic`);

  rendererConn?.close();
  rendererConn = null;
  panelBtn.style.display = "none"; // no room left to command

  try {
    // Gesture-less (fires from a timer / lost socket), so it can only start the
    // source that needs no gesture (autoStartSource).
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
    // Covers an unreachable worker and a valid-but-empty room (no host ever broadcast).
    if (mode === "renderer" && !rendererHasData) void fallBackToSolo("has no active host");
  }, 5000);
}

function onSettingAutoToggle(sceneId: string, spec: SceneSetting, on: boolean): void {
  if (on) seedAuto(sceneId, spec.key, getSceneSetting(sceneId, spec));
  setAutoEnabled(sceneId, spec.key, on);
}


function wireDeviceMenu(): void {
  // Made before any key handler registered later in boot: learning takes keyboard
  // presses in the capture phase and must come first (ui/midiInput.ts). Asks for
  // nothing until the MIDI card's button, unless MIDI was already granted.
  const midi = createMidiController(
    browserMidiEnv({
      currentSceneId: () => scene.id,
      applyCc: (target, cc) => deviceMenu?.applyMidiCc(target, cc),
    }),
  );
  void midi.autoConnect();
  deviceMenu = createDeviceMenu({
    midi,
    getPalettes: () => PALETTES.map((p) => ({ id: p.id, name: p.name, group: p.group, swatch: paletteRampHex(p, 6) })),
    currentSceneId: () => scene.id,
    currentPaletteId: () => palette.id,
    // A page that follows a feed reads the sender's levels: measured.
    stemsMeasured: () => stemGate?.measured() ?? true,
    // The column head's audio-source status. A page that follows another device
    // has no local analyser.
    getAudioStatus: () => ({
      source: !ownInput() ? "remote" : syntheticFeed ? "synthetic" : capture ? captureAudioSource(capture.kind) : "none",
      sampleRate: capture?.context.sampleRate ?? null,
    }),
    // The Input card's Source row; null (row hidden) when following or on the
    // synthetic feed (see DeviceMenuDeps.getSourceState).
    getSourceState: () => (!ownInput() || syntheticFeed ? null : currentSourceState()),
    onStopAudio: () => stopOwnCapture(),
    // With no capture yet the chip tap IS the explicit gesture: start fresh,
    // since swapAudioSource bails with nothing to swap out of. Stay synchronous
    // up to ensureAudio so a display choice keeps the tap's transient activation.
    onAudioSourceChange: (choice) => {
      if (!bandAnalyser && ownInput() && !syntheticFeed) {
        setAudioSourceChoice(choice);
        void ensureAudio(choice);
      } else void swapAudioSource(choice);
    },
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
    // Read on the row's own refresh timer, not every rAF tick (see lastInputHealth).
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
    getSceneSettings: (sceneId) => getScene(sceneId)?.settings ?? [],
    getScene: (sceneId) => getScene(sceneId),
    getSceneSettingValue: (sceneId, spec) => getSceneSetting(sceneId, spec),
    getSceneSettingDefault: (sceneId, spec) => settingDefault(sceneId, spec),
    onSceneSettingChange: (sceneId, spec, value) => {
      setAutoEnabled(sceneId, spec.key, false);
      setSceneSetting(sceneId, spec, value);
    },
    onSceneSettingsReset: (sceneId) => {
      const specs = getScene(sceneId)?.settings ?? [];
      resetSceneSettings(sceneId, specs);
    },
    listLooks,
    onSaveLook: (sceneId) => {
      const name = funnyLookName(listLooks(sceneId).map((l) => l.name));
      saveLook({ ...captureLook(name, sceneId, getScene(sceneId)?.settings ?? []), paletteId: palette.id });
      return name;
    },
    onRenameLook: renameLook,
    onApplyLook: (look) => {
      primeUndo(look.sceneId, getScene(look.sceneId)?.settings ?? [], palette.id);
      applyLookAndPalette(look);
    },
    onDeleteLook: deleteLook,
    decodeLook,
    buildShareLink: (look) =>
      `${location.origin}${location.pathname}?look=${encodeLook(look)}#/v/${encodeURIComponent(look.sceneId)}`,
    buildShareCode: encodeLook,
    hasLookUndo,
    onUndoLook: (sceneId) => {
      const look = takeUndo(sceneId);
      if (look) applyLookAndPalette(look);
    },
    set: {
      pads: () => listPads(),
      onAddPad: addPadFromScreen,
      onFirePad: (id) => firePad(id),
      onRenamePad: renameStoredPad,
      onDeletePad: removeStoredPad,
      previewPadId: currentPadId,
      livePadId: () => (listPads().some((p) => p.id === setLivePadId) ? setLivePadId : null),
      outputOpen: () => outputControls?.active() ?? false,
      autopilot: getAutopilot,
      onAutopilotChange: (change) => {
        setAutopilot(change);
        restartAutopilot(setAutopilotState, currentPadId() ?? setAutopilotState.cursor);
      },
      autopilotRuns: setAutopilotRuns,
      everyChoices: AUTOPILOT_EVERY_BARS,
      minPads: AUTOPILOT_MIN_PADS,
      maxPads: SET_MAX_PADS,
    },
    overlay: {
      getState: () => ({ ...getOverlay(), logoScope: getOverlayLogoScope() }),
      onText: setOverlayText,
      onPosition: setOverlayPosition,
      onSize: setOverlaySize,
      onOpacity: setOverlayOpacity,
      onLogoFile: async (file) => {
        const logo = await encodeLogoFile(file);
        return logo && setOverlayLogo(logo.dataUrl, logo.scope) ? logo.scope : "failed";
      },
      onRemoveLogo: clearOverlayLogo,
    },
    getBandEdgesHz: () => bandAnalyser?.bandEdgesHz ?? nominalBandEdgesHz(),
    getDriveSetting: (sceneId, spec) => getDriveSetting(sceneId, spec),
    getWireReading: (sceneId, key, choice) => driveEngine.wire(sceneId, key, choice),
    onSetDriveSetting: (sceneId, spec, setting) => setDriveSetting(sceneId, spec, setting),
    onResetDriveSetting: (sceneId, spec) => resetDriveSetting(sceneId, spec),
    onUnplugAll: (sceneId, spec) => setDriveSetting(sceneId, spec, { mix: "add", sources: [] }),
    onTogglePatchSource: (sceneId, spec, choice) => togglePatchSource(sceneId, spec, choice),
    onSetSourceWeight: (sceneId, spec, choice, weight) => setSourceWeight(sceneId, spec, choice, weight),
    onSetSourceHeight: (sceneId, spec, choice, height) => setSourceHeight(sceneId, spec, choice, height),
    onSetSourceMod: (sceneId, spec, choice, mod) => setSourceMod(sceneId, spec, choice, mod),
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
    getDriveWindowMax: (sceneId, spec) => getDriveWindowMax(sceneId, spec),
    onSetDriveWindowMax: (sceneId, spec, value) => setDriveWindowMax(sceneId, spec, value),
    getDriveSmoothness: (sceneId, spec) => getDriveSmoothness(sceneId, spec),
    onSetDriveSmoothness: (sceneId, spec, value) => setDriveSmoothness(sceneId, spec, value),
    getDriveSmoothnessOn: (sceneId, spec) => getDriveSmoothnessOn(sceneId, spec),
    onSetDriveSmoothnessOn: (sceneId, spec, on) => setDriveSmoothnessOn(sceneId, spec, on),
    getDriveReadout: (sceneId, spec) => getDriveReadout(sceneId, spec),
    onSetDriveReadout: (sceneId, spec, readout) => setDriveReadout(sceneId, spec, readout),
    setDriveLineStrength: (sceneId, spec, value) => setDriveLineStrength(sceneId, spec, value),
    onTap: (timeStamp) => tapTempo(timeStamp, false),
    resolveSceneSettingValue: (sceneId, spec) => resolveSceneSetting(sceneId, spec),
    resolveSensitivityValue: (sceneId) => resolveSensitivity(sceneId),
    resolveExpansionValue: (sceneId) => resolveExpansion(sceneId),
    isSettingAutoEnabled: (sceneId, key) => isAutoEnabled(sceneId, key),
    onSettingAutoToggle,
    isSceneAuto: (sceneId) => isSceneAuto(sceneId, getScene(sceneId)?.settings ?? []),
    onSceneAutoToggle: (sceneId, on) => setSceneAuto(sceneId, getScene(sceneId)?.settings ?? [], on),
    getSceneMaster: () => getSceneMaster(),
    onSceneMasterChange: (value) => setSceneMaster(value),
    getSceneExpansion: () => getSceneExpansion(),
    onSceneExpansionChange: (value) => setSceneExpansion(value),
    getSceneExpansionShape: () => EXPANSION_SHAPES.indexOf(getSceneExpansionShape()),
    onSceneExpansionShapeChange: (index) => setSceneExpansionShape(EXPANSION_SHAPES[index] ?? EXPANSION_SHAPE_DEFAULT),
    resolveSilenceGate: () => gateFor(lastVis),
    getPowerMode: () => powerMode,
    onPowerModeChange: (mode) => {
      setPowerMode(mode);
      applyPowerMode(mode);
    },
    // While an output is open the card is the preview's: its Quality chips bind
    // to the preview's choice.
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
      // quality.maxParticles, which the governor never moves, so a Low pick would
      // keep the High count until the next scene switch.
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
    getOutputCastMode: () => outputPower.cast,
    onOutputCastModeChange: (cast) => {
      setOutputCastMode(cast);
      outputPower = { ...outputPower, cast };
      outputBridge?.sendPower();
    },
    getPowerStatus: () => ({
      mode: powerMode,
      choice: previewActive ? previewChoice : qualityChoice,
      recommended: detectedPreset,
      fps: fpsMeter.read(),
      level: governor?.level ?? null,
      maxLevel: governor?.maxLevel ?? 0,
      fraction: governor?.fraction ?? 1,
      standingDown: governor?.standingDown ?? false,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      ...(resourceMeter?.snapshot(performance.now()) ?? { cpuLoad: null, gpuMs: null, heapMb: null }),
      ...frameMisses.read(performance.now()),
    }),
    customValues: {
      get: getCustomValue,
      set: setCustomValue,
      clear: clearCustomValue,
      stretch: getSliderStretch,
      stretchTo: stretchSlider,
      reset: resetCustomValue,
    },
    toggleButton: menuBtn,
  });
  menuBtn.addEventListener("click", () => deviceMenu!.toggle());
}

/** Any device can open the room's view, not just the host (changing who may Play
 *  is the owner's alone). Wires #panelBtn and announces this device's scene to
 *  the room. Only a keyed connection gets the button: an unclaimed room has no
 *  records to edit. Works from the gallery too. Returns the view so the keyed
 *  host's room badge can open it. */
function wireRoomControls(conn: AnyConn, invite: () => RoomInvite | null, owner: boolean): RoomView {
  const view = createRoomView({
    selfId: conn.deviceId,
    isOwner: owner,
    roomCode: () => roomCode,
    getRoster: () => conn.currentRoster,
    onRosterChange: (cb) => conn.onRosterChange(cb),
    onDeviceReject: (cb) => conn.onDeviceReject(cb),
    setDevice: (targetId, patch) => {
      conn.sendDeviceSet(targetId, patch);
    },
    // This device's own ears act inside the tap, before the room echoes them:
    // iPad Safari opens the microphone only inside a gesture.
    onSelfEars: (patch) => {
      // A choice the room will refuse (a feed can't follow itself) changes
      // nothing here: acting early would drop the capture and the refusal
      // wouldn't bring it back. The Room view sends Follow with a feed it can
      // name (roomView.ts followPatch); a bare `follow` means following.
      const { records } = recordsFromRoster(conn.currentRoster);
      if (!applyDeviceSet(records, conn.deviceId, patch).ok) return;
      const ears: Ears = patch.ears ?? "follow";
      setPendingEars(ears);
      syncEars();
      if (ears === "own") void ensureAudio("mic");
    },
    forgetDevice: owner
      ? (targetId) => {
          conn.forgetDevice(targetId);
        }
      : undefined,
    invite,
    adoptTv: ownRoomKey ? adoptTvByCode : undefined,
    finish: owner
      ? { label: "Reset room", confirm: "Click again: every device pairs again", run: resetRoom }
      : isController
        ? {
            label: "Leave room",
            run: () => {
              clearSession("controller", realStorage);
              location.assign("/");
            },
          }
        : { label: "Leave room", run: () => location.assign("/") },
  });
  // Only a keyed room has records to change: an unclaimed (legacy) room
  // ignores `deviceSet` without a reply, so its controls would do nothing.
  if (conn.keyed) {
    panelBtn.style.display = "block";
    panelBtn.addEventListener("click", () => view.toggle());
  }

  conn.sendHello(scene.id, palette.id, viewport);
  return view;
}

/** Full-screen stop for a page that can't go on (a phone that must scan again, a
 *  gone room). Not showHud: that is small, dim and fades. */
function showPairingNotice(title: string, body: string): void {
  const root = document.createElement("div");
  root.style.cssText = `
    position: fixed; inset: 0; z-index: 40; /* above the Room view (33): a removed phone may have it open */
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

/** Two tabs on one laptop share localStorage, so without this a second tab would
 *  resume the first's room and fight it for the host seat. The first tab keeps
 *  the lock for its life (the grant ends when the callback's promise settles,
 *  and it never does). False where Web Locks are missing or another tab holds
 *  it; hostRoom.ts then starts a new room. */
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

/** This tab's previous keyed room if it may resume it (hostRoom.ts has the
 *  rule), else a fresh one. Only the lock holder saves a new room, so a second
 *  tab can't take the first's reload away. */
async function openHostRoom(): Promise<HostRoomSession> {
  const lockHeld = await takeHostRoomLock();
  const plan = planHostRoom(readSession("host", realStorage), Date.now(), lockHeld);
  if (plan.kind === "resume") return plan.session;
  const session: HostRoomSession = { room: await createRoomCode(), hostKey: newKey(), roomKey: newKey(), ts: Date.now() };
  if (lockHeld) writeSession("host", session, realStorage);
  return session;
}

/** This device's side of the room's Main (net/mainPlay.ts), for every member of a
 *  keyed room. What this device's panel changes is its preview and goes nowhere
 *  until the bar's Play sends it. Reads and writes go through
 *  net/controllerLook.ts, which remembers the room's scene and palette ids even
 *  when this device can't show them (a phone), so Play never sends a fallback
 *  over the room's choice. `apply` is what following Main means here: room-scope
 *  storage first (on the laptop the real localStorage), then palette, then scene,
 *  as the TV's `applyDoc` does; the laptop then hands the result to its pop-out.
 *  The window switches at once even when Main was played with a hold: only a TV
 *  and the pop-out walk a glide (net/outputGlide.ts). */
function startMainPlay(conn: AnyConn, isOwner: boolean): MainPlay {
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
  const play = createMainPlay({
    send: (msg) => conn.sendLook(msg),
    capture: look.io.read,
    apply(doc, glideMs) {
      look.io.write(doc);
      markMainShown();
      // The pop-out is one more Main screen of the laptop: it follows too and
      // walks the glide this window can't.
      if (outputBridge?.status().open) outputBridge.go(glideMs);
    },
    // Null until the roster has this device: the room sends the snapshot first.
    screen: () => conn.self?.screen ?? null,
    isOwner,
    nameOf: (id) => conn.currentRoster.find((d) => d.deviceId === id)?.name ?? null,
  });
  play.onNeedSnapshot(() => conn.requestLook());
  conn.onLook((m) => {
    if (m.type === "look") play.onSnapshot(m.rev, m.doc);
    else if (m.type === "lookPatch") play.onPatch(m.rev, m);
    else if (m.type === "lookAck") play.onAck(m.n, m.rev);
    else {
      play.onReject(m.n, m.reason);
      showHud(m.reason === "size" ? "Settings too large to send to Main" : "This device can't play to Main", true);
    }
  });
  conn.onState((s) => {
    if (s !== "open") play.onDisconnect();
  });
  conn.onRosterChange(() => play.onScreenKnown());
  mainPlay = play;
  return play;
}

/** This laptop claimed its keyed room and the roster has listed it (net/roomBridge.ts `liveWhenAlone`). */
function ownsRoom(): boolean {
  return !!hostConn && hostConn === activeConn() && hostConn.keyed && hostConn.self !== null;
}

/** While the laptop is alone in its room the bar's Play doesn't reach Main, so
 *  the pop-out's picture goes to Main too: the first phone or iPad to join opens
 *  on the projector's picture. */
function playMainWhileAlone(): void {
  if (ownsRoom() && roomBridge && !roomBridge.status().open) mainPlay?.play();
}

/** Settles when this device first shows the room's Main (startMainPlay's
 *  `apply`), possibly before boot() waits for it. */
let markMainShown: () => void = () => {};
const mainShown = new Promise<void>((resolve) => {
  markMainShown = resolve;
});

/** Longest a phone or iPad screen waits for the room's Main before opening on its
 *  own scene (slow networks, or a room with no Main yet). */
const MAIN_WAIT_MS = 5000;

/** A phone or iPad opened on the laptop's QR (no scene in the link) goes to the
 *  room's scene once it shows Main, or after MAIN_WAIT_MS; the page stays blank
 *  until then. Pushed over the gallery's entry so Back finds the gallery. */
async function openOnMain(): Promise<void> {
  await Promise.race([mainShown, new Promise<void>((resolve) => window.setTimeout(resolve, MAIN_WAIT_MS))]);
  if (inViz || currentRoute().kind !== "gallery") return;
  navigate({ kind: "viz", sceneId: scene.id }, "push");
}

/** How long the phone waits for a just-adopted TV to show in the roster. */
const SCREEN_JOIN_WAIT_MS = 10_000;

function showScanLaptopNotice(): void {
  showPairingNotice(
    "Now scan the QR on the laptop",
    "The screen is waiting. On the laptop, click the room code at the top right to show the QR.",
  );
}

/** For handing a screen to the room by a typed code (`adoptTvByCode`). Null without a keyed room. */
let ownRoomKey: string | null = null;

/** A code typed into a Room field, tried as a waiting TV's: the adopt a phone
 *  sends after scanning, minus the nonce a typed code can't carry. This room's own
 *  code (what a TV already in it shows) never is. */
function adoptTvByCode(slot: string): Promise<AddScreenOutcome> {
  if (!roomCode || !ownRoomKey) return Promise.resolve("no-screen");
  if (slot === roomCode) return Promise.resolve("own-room");
  return postAdopt(WORKER_ORIGIN, slot, { room: roomCode, k: ownRoomKey });
}

/** Set while the laptop's Reset is ending its room, so the room's denial of
 *  this socket (the end of every room) isn't reported as a refusal. */
let resettingRoom = false;

/** Ends this laptop's room for everyone and starts a new one. The room closes
 *  every socket as denied (server/roomCore.ts `end`), so a TV returns to its
 *  pairing QR and a phone says the room is closed. The saved session is forgotten
 *  first so hostRoom.ts creates; the route stays, so a showing scene comes back. */
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
 *  reports in plain words: the roster proves the TV arrived. The request waits
 *  for the room's first roster (net/screenJoin.ts has why): renderers already in
 *  it were there before. `needHost` is for a TV scanned before the laptop, using
 *  a saved session's room that the laptop may have left: the request then also
 *  waits for the laptop, and without it keeps the TV for the laptop's QR (the
 *  `pending` session) instead of sending it into a dead room. */
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

/** Boots this page as a room's phone controller: connects with the room key,
 *  remembers it for reloads, takes the secrets out of the address bar, starts the
 *  look protocol, and hands a TV in play (this link's, or one scanned earlier) to
 *  the room. */
function startController(
  target: { room: string; key: string; keyFromUrl: boolean },
  adopt: { slot: string; nonce: string } | null,
  /** The link carried a TV QR that didn't parse: the query still gets this
   *  controller's room and role, so a reload resumes. */
  tvLinkWasBad = false,
): void {
  mode = "renderer";
  isController = true;
  roomCode = target.room;
  ownRoomKey = target.key;
  document.body.classList.add("controller"); // index.html: the badge's place and cursor
  const device = thisDevice();
  handheldScreen = device.kind === "phone" || device.kind === "tablet";
  const conn = new ControllerConnection(target.room, { auth: { roomKey: target.key }, reconnect: true, device });
  controllerConn = conn;

  if (target.keyFromUrl) {
    writeSession("controller", { room: target.room, key: target.key, ts: Date.now() }, realStorage);
  }
  if (target.keyFromUrl || adopt || tvLinkWasBad) {
    // Room and role stay (a reload resumes from the saved session; query before
    // hash); the key and a TV link's nonce must not stay in the address bar,
    // history or screenshots.
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
      if (conn.endedReason === "removed") {
        showPairingNotice("Removed from the room", "Scan the QR on the laptop again to rejoin.");
      } else {
        showPairingNotice("This room is closed", "Scan the QR on the laptop again to reconnect.");
      }
    }
  });
  startMainPlay(conn, false);

  // A TV scanned before the laptop waits in storage; this page's own link is the
  // newer. Only a link carrying a TV's QR needs to check the laptop is still in
  // the room (a saved session's).
  const pending = readSession("pending", realStorage);
  if (pending) clearSession("pending", realStorage);
  const request = adopt ?? (pending ? { slot: pending.slot, nonce: pending.nonce } : null);
  if (request) void adoptScreen(conn, target.room, target.key, request.slot, request.nonce, adopt !== null);
}

/** The phone controller's room badge (net/controllerPreview.ts has the words). */
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
  // A route to a stopped scene is a pick: it retries (render/sceneGuard.ts).
  sceneGuard.forgive(next.id);
  gallery?.hide();
  document.body.classList.remove("in-gallery");
  // Already in a scene (a link or back/forward changed the route): crossfade in;
  // from the gallery it just appears.
  const fromScene = inViz;
  inViz = true;
  canvas.style.display = "block";
  // The resize observer's cache still says 0x0 from while the canvas was hidden;
  // without this the first frame is a 1x1 buffer (gl.ts).
  refreshCssSize(canvas);

  const prev = scene;
  scene = next;
  controllerLook?.noteScene(next.id);
  // Before the mount (see applyScene); previewActive turns on at the next tick,
  // which remounts if needed.
  if (previewActive) applyRenderQuality();
  if (!mountOrBail(next, prev, fromScene)) return;
  updateSceneVersionLabel(next);

  if (!quietScreen()) {
    showHud(`${isController ? "remote" : mode}${roomCode ? ` (${roomCode})` : ""}  quality: ${quality.preset}  scene: ${scene.name}  palette: ${palette.name}`);
  }
  activeConn()?.sendHello(scene.id, palette.id, viewport);

  menuBtn.style.display = "block";
  fsBtn.style.display = "block";
  if (!bypassGallery) {
    backBtn.style.display = "block";
    sceneBtn.style.display = "block";
  }
  sceneVersion.style.display = "inline";
  sceneTag.style.display = "block";
  outputControls?.setVisible(true);
  effectControls?.setVisible(true);
  recordControls?.setVisible(true);

  if (ownInput()) void ensureAudio();
  updateMicPrompt();
  reportUsage();
  void requestWakeLock();
  immersive?.resume();
}

function exitToGallery(): void {
  inViz = false;
  // The panel belongs to the viz: leaving it open would strand it over the
  // gallery. Every exit (Escape, back button, browser Back) funnels through here.
  deviceMenu?.close();
  menuBtn.style.display = "none";
  fsBtn.style.display = "none";
  backBtn.style.display = "none";
  stopBtn.style.display = "none";
  sceneBtn.style.display = "none";
  scenePicker?.close();
  sceneVersion.style.display = "none";
  sceneTag.style.display = "none";
  outputControls?.setVisible(false);
  effectControls?.setVisible(false);
  recordControls?.setVisible(false); // ends a take, saving it
  hideTooltip(); // a version hint left open by a tap mustn't follow us out
  audioPrompt.style.display = "none";
  compositor?.cancel();
  mainHost?.unmountAll();
  canvas.style.display = "none";
  immersive?.pause();
  gallery?.show();
}

function applyRoute(route: Route): void {
  if (route.kind === "gallery") {
    // Covers the initial boot landing and a return trip (exitToGallery() calls
    // gallery.show() itself).
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
  // A TV opening the plain site belongs on the paired display page (net/tvRedirect.ts).
  const tvTarget = tvRedirectTarget(location.search, navigator.userAgent);
  if (tvTarget !== null) {
    location.replace(tvTarget);
    return;
  }
  // First, so the DSEG7 @font-face (controlsTheme.ts) is in document.fonts before
  // pinEverything()'s sweep; otherwise it would enter only when the panel first
  // opens, possibly after a deploy has moved on. Idempotent.
  ensureControlsStyles();
  // Starts the at-idle sweep of every pinAsset() file and registered font
  // (pinnedAssets.ts header). Scene media waits for its scene or a show
  // (pinMediaOncePaired, the pop-out's onStatus). The sweep waits for the
  // scene bodies, which get the bandwidth first.
  void preloadScenes().then(pinEverything);

  // Started first so it resolves alongside detectQuality()'s await; awaited
  // before routing, since a deep-linked scene's enterViz() makes the first
  // autoStartSource() call.
  const micPermissionReady = watchMicPermission((p) => {
    micPermission = p;
  });
  // Labels are already readable here if mic permission was granted on an earlier visit.
  void refreshInputDevices();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => void onInputDevicesChanged());

  if (!document.createElement("canvas").getContext) {
    fatalError("Canvas unsupported");
    return;
  }

  let gl: WebGL2RenderingContext;
  try {
    // preserveDrawingBuffer only in dev: without it WebGL clears the buffer on
    // composite, so tuning/capture.ts's async drawImage(canvas) reads solid black.
    // A prod build never sets it (import.meta.env.DEV is a literal false), so its
    // cost never ships.
    gl = createGL(canvas, { preserveDrawingBuffer: import.meta.env.DEV });
  } catch (err) {
    console.error(err);
    fatalError("WebGL2 unsupported on this device");
    return;
  }
  // A GPU reset or backgrounded phone can take the context; every scene's
  // programs and buffers died with it, so the restore reloads the page (the route
  // is in the hash, a granted mic restarts itself).
  watchContextLoss(
    canvas,
    () => {
      glLost = true;
      showHud("graphics reset — reloading", true);
    },
    () => location.reload(),
  );

  const params = new URLSearchParams(location.search);
  // net/bootPlan.ts decides from the query alone; the saved controller session
  // stands in for a key the address bar no longer carries after a reload.
  const controllerSession = readSession("controller", realStorage);
  const planned = planBoot(location.search, controllerSession);
  // A TV link that doesn't parse says so and boots as the link reads without it
  // (bootPlan.ts); it never makes this phone a host.
  const badAdoptLink = planned.kind === "bad-adopt-link";
  const plan = planned.kind === "bad-adopt-link" ? planned.then : planned;
  if (badAdoptLink) {
    // Out of the address bar so a reload doesn't repeat the message; a controller
    // resume rewrites the query itself (startController).
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
  // A ?room= the Worker couldn't have issued (stray '#' etc.) is ignored and the
  // page loads normally; say so in the console.
  if (plan.kind !== "adopt" && params.get("room") && !("room" in plan)) {
    console.warn("Ignoring a malformed ?room= code:", params.get("room"));
  }
  // Sent now so its round trip overlaps detectQuality()'s benchmark; awaited (with
  // the solo fallback) where the room is wired. The catch only silences the
  // unhandled-rejection warning meanwhile.
  const hostRoomPromise = plan.kind === "host-new" ? openHostRoom() : null;
  hostRoomPromise?.catch(() => {});

  if (params.get("audio") === "synthetic") {
    const bpm = Number(params.get("bpm"));
    syntheticFeed = createSyntheticFeed({ bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined });
    syntheticStartMs = performance.now();
  }

  // `?quality=` (dev-only, `?tier=` alias) forces a preset for headless capture:
  // SwiftShader (tools/tune-sheet.mjs) is slow, so an unpinned capture
  // self-detects "low"/"floor" and renders at a fraction of real hardware's
  // resolution. Pinning also skips the governor: a fixed preset is for
  // reproducible capture. It still reads as `detectedPreset`, so the Power card's
  // "recommended" marker tracks it.
  const devPin = import.meta.env.DEV ? parseQualityPreset(params) : null;
  pinned = devPin !== null;
  detectedPreset = devPin ?? (await detectQuality());
  quality = qualitySettings(renderPreset());
  mainHost = createSceneHost(gl, quality, { onLateMountError: onLateSceneMountError });
  const host = mainHost;
  compositor = createCompositor(gl, { onOutgoingDone: (outgoing) => host.unmount(outgoing) });
  resourceMeter = createResourceMeter(gl);
  overlayLayer = createOverlayLayer(gl);
  if (!presetAllows(scene, effectivePreset())) scene = availableScenes()[0] ?? scene;
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);

  // The laptop's room key, when it hosts a keyed room: what its QR carries.
  let hostRoomKey: string | null = null;
  if (controllerTarget) {
    // The laptop's QR (or a TV's with a controller session saved): a phone or iPad
    // showing the room's look from the host's frames (a screen first, see
    // `handheldScreen`).
    startController(controllerTarget, adoptRequest, badAdoptLink);
  } else if (plan.kind === "renderer") {
    // Plain ?room=CODE: a mic-less renderer. With the room's key (the watch-only
    // link) the room is claimed and kept alive across drops; a keyless one stays
    // the old one-shot socket.
    mode = "renderer";
    roomCode = plan.room;
    rendererConn = new RendererConnection(
      roomCode,
      plan.key ? { auth: { roomKey: plan.key }, reconnect: true, device: thisDevice() } : { device: thisDevice() },
    );
    // Only the old keyless join falls back to a mic of its own; a keyed
    // member stays in the room and may be set to its own input there.
    if (!plan.key) startRendererDisconnectWatch();
  } else if (plan.kind === "solo") {
    // A TV link that didn't parse, on a phone with no controller session: the page
    // on its own.
    mode = "solo";
    roomCode = null;
  } else {
    // No code -> create a fresh room and host it (the classic "open the site" flow).
    // ?room=CODE&role=host -> become host of a code someone else (a TV) already created.
    try {
      if (plan.kind === "host-join") {
        roomCode = plan.room;
        hostConn = new HostConnection(roomCode, { device: thisDevice() });
        // A code alone opens only an old unclaimed room; a laptop's is keyed.
        hostConn.onState((s) => {
          if (s === "denied") showHud(`Room ${plan.room} needs its QR, a code alone can't join it.\nClick the room code to leave it.`, true);
        });
      } else {
        const hostRoom = await hostRoomPromise!;
        roomCode = hostRoom.room;
        hostRoomKey = hostRoom.roomKey;
        ownRoomKey = hostRoom.roomKey;
        hostConn = new HostConnection(roomCode, {
          auth: { hostKey: hostRoom.hostKey, roomKey: hostRoom.roomKey },
          reconnect: true,
          device: thisDevice(),
        });
        hostConn.onState((s) => {
          if (s !== "denied" || resettingRoom) return;
          clearSession("host", realStorage);
          showHud("The room refused this laptop — reload to start a new one", true);
        });
      }
      mode = "host";
    } catch (err) {
      console.warn("Room server unreachable, running solo:", err);
      mode = "solo";
      roomCode = null;
    }
  }

  if (badAdoptLink) showHud("That screen link isn't valid.\nScan the QR on the TV again.", true);

  // A phone controller paints its own badge; every other member gets the room view.
  if ((mode === "host" || mode === "renderer") && roomCode && !isController) {
    roomCodeEl.textContent = `room: ${roomCode}`;
    roomCodeEl.style.display = "block";
    // A keyed host's badge opens the Room view (wired below). Every other member
    // keeps the pairing overlay: this room's QR + code and a field for another
    // room's code (joinScreen.ts `createRoomCodeEntry`), open until dismissed
    // since it holds a text field. A keyed spectator can pass on its invite key;
    // the old room a phone hosts for a TV has no key to put in a link.
    if (!hostRoomKey) {
      const roomKey = plan.kind === "renderer" ? plan.key : undefined;
      const invite = createJoinScreen("renderer", document.body, {
        dismissible: true,
        adoptTv: ownRoomKey ? adoptTvByCode : undefined,
        reset: { label: "Leave this room", run: () => location.assign("/") },
      });
      invite.setCode(roomCode, roomKey ? { key: roomKey } : undefined);
      roomCodeEl.addEventListener("click", () => invite.show());
    }
  }

  // Every member of a keyed room follows its Main and has a Play to it, honoured
  // only from the owner or a device the owner allowed (a controller starts its own
  // in startController). The laptop that claimed the room owns it; a keyed
  // spectator joined someone else's.
  const joined = activeConn();
  if (joined && joined.keyed && !isController) startMainPlay(joined, joined === hostConn);

  wireDeviceMenu();
  const conn = activeConn();
  if (conn) wireEars(conn);
  if (conn) pinMediaOncePaired(conn);
  // Same link as the badge overlay: controller link for the laptop's keyed room,
  // plain/watch link for other members.
  if (conn) {
    const inviteKey = hostRoomKey ?? (plan.kind === "renderer" ? plan.key : undefined);
    const roomView = wireRoomControls(
      conn,
      () => {
        if (!roomCode) return null;
        // A controller page invites more devices with its own room key (a
        // second phone or iPad joins from it); it has no key in a legacy room.
        if (isController) return ownRoomKey ? { kind: "controller", code: roomCode, info: { key: ownRoomKey } } : null;
        return { kind: hostRoomKey ? "controller" : "renderer", code: roomCode, info: inviteKey ? { key: inviteKey } : undefined };
      },
      hostRoomKey !== null,
    );
    // The badge is the way into the Room view from the gallery too (#panelBtn
    // lives in the scene row, under it).
    if (hostRoomKey || isController) roomCodeEl.addEventListener("click", () => roomView.toggle());
  }

  immersive = createImmersiveMode({
    button: fsBtn,
    isMenuOpen: () => (deviceMenu?.isOpen() ?? false) || (scenePicker?.isOpen() ?? false),
  });
  fsBtn.addEventListener("click", () => immersive!.toggle());
  // A phone or iPad screen shows nothing but the picture until it is tapped.
  if (handheldScreen) immersive.enterHidden();

  // The bar (CUE / PLAY / state line). A laptop has the pop-out window with its
  // own Cue and Play; a keyed room's Main is one more output (net/roomBridge.ts);
  // a controller has only that one (POP OUT stays hidden, index.html). Everything
  // touching these is null-safe.
  const play = mainPlay;
  const joinedConn = activeConn();
  if (!isController) {
    outputBridge = createOutputBridge({
      transport: createBroadcastTransport<ToOutput, ToMain>(),
      look: () => ({ scene: scene.id, palette: palette.id }),
      power: () => outputPower,
    });
    // A pop-out means a show: pin every scene's media for this window's preview
    // too (pinnedAssets.ts header, "Scene media").
    outputBridge.onStatus((s) => {
      if (s.open) pinSceneMedia();
    });
  }
  if (play && joinedConn) {
    roomBridge = createRoomBridge({
      play,
      present: () => joinedConn.currentRoster.some((d) => d.online && d.deviceId !== joinedConn.deviceId),
      mayPlay: () => joinedConn === hostConn || (joinedConn.self?.canPlay ?? false),
      showRoom: () => roomCodeEl.click(),
      // Alone in its room the laptop's program is Main without a Play: this
      // window, or the pop-out while open (its Play and opening reach Main through
      // playMainWhileAlone).
      liveWhenAlone: () => ownsRoom() && !(outputBridge?.status().open ?? false),
    });
  }
  // Record sits beside POP OUT; a controller has no canvas of its own to record.
  if (!isController) {
    clipRecorder = createClipRecorder({
      mainCanvas: canvas,
      audioStream: () => capture?.stream ?? null,
      sceneId: () => scene.id,
      aspect: () => recordControls?.aspect() ?? "screen",
      onChange: () => recordControls?.refresh(),
      onMessage: (text) => showHud(text),
    });
    recordControls = createRecordControls(() => clipRecorder!, { recBtn, aspectBtn: recAspectBtn });
    recordControls.setVisible(inViz);
  }
  const controlsBridge = outputBridge && roomBridge ? combineBridges([outputBridge, roomBridge]) : (outputBridge ?? roomBridge);
  if (controlsBridge) {
    outputControls = createOutputControls(controlsBridge, {
      popBtn: outBtn,
      cueBtn,
      goBtn,
      takeBtn,
      stateEl: outStateEl,
      barEl: outBarEl,
    });
    labelPlayKey(goBtn, isMacAgent(navigator.userAgent));
    outputControls.setVisible(inViz);
    wireOutputKeys(outputControls);
    // The Set card's live marker: whatever pad was loaded when Play sent it.
    outputControls.onPlay(() => {
      setLivePadId = currentPadId();
      playMainWhileAlone();
    });
  }
  // Held effects: on this window through the compositor, on the pop-out as their
  // own message. Not part of the look, so Cue never holds them.
  effectControls = createEffectControls({
    bar: fxBarEl,
    enabled: () => inViz,
    isTyping: isTypingTarget,
    onChange: (effects) => {
      compositor?.setEffects(effects);
      outputBridge?.sendEffects(effects);
    },
    onKeyUse: (id) => noteKeyUse(effectShortcutId(id)),
  });
  effectControls.setVisible(inViz);

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  window.addEventListener("keydown", (e) => {
    // Tap tempo: a bare Ctrl press. Ahead of the modifier guard, since Ctrl's own
    // keydown carries ctrlKey. Counted at keydown because the press is the beat;
    // a Ctrl+<key> chord is one stray tap, which the estimate leaves out. Never
    // preventDefault, so every Ctrl shortcut still works.
    if (e.key === "Control") {
      if (!e.repeat && !e.shiftKey && !e.altKey && !e.metaKey && inViz && !isTypingTarget(e.target)) {
        noteKeyUse("tap");
        tapTempo(e.timeStamp, true);
      }
      return;
    }
    // Modifier guard so ⌘/Ctrl+F (find) and ⌘/Ctrl+S (save) pass through untouched.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // F and S are letters: they must not fire while one is typed (a look named
    // "Fast", a pasted share code). A range slider keeping focus still counts as
    // not typing.
    const typing = isTypingTarget(e.target);
    if ((e.key === "f" || e.key === "F") && !typing) {
      noteKeyUse("fullscreen");
      immersive?.toggle();
    }
    // Live only in a viz, the condition that shows menuBtn, so the key and the
    // gear appear together.
    if ((e.key === "s" || e.key === "S") && inViz && !typing) {
      noteKeyUse("panel");
      deviceMenu?.toggle();
    }
    if (e.key === "Escape") {
      // The panel's document-level handler runs first and claims Escape to unpin
      // a card (preventDefault); that press shouldn't also leave the scene.
      if (e.defaultPrevented) return;
      if (immersive?.active()) {
        immersive.exit();
        return;
      }
      if (inViz && !bypassGallery) navigate({ kind: "gallery" }, "push");
    }
    // The Set: 1-9 fire pads 1-9, panel open or closed (Shift+digit is the
    // panel's block jump, deviceMenu.ts). With the desk up, the first row's keys
    // tap the desk's pads instead (Shift loads NEXT only). Not on auto-repeat: a
    // held key would reload the same pad.
    if (inViz && !typing && !e.repeat && /^Digit[1-9]$/.test(e.code)) {
      const index = Number(e.code.slice(5)) - 1;
      const pad = listPads()[index];
      if (pad && desk?.active() && index < deskPadsRowMax) {
        e.preventDefault();
        noteKeyUse("pad");
        deskTapPad(pad.id, e.shiftKey);
      } else if (pad && !e.shiftKey) {
        e.preventDefault();
        noteKeyUse("pad");
        firePad(pad.id);
      }
    }
    // Beat-trim keys (src/render/beatTrim.ts) use e.code (physical key), not
    // e.key, so a Cyrillic or German layout still reaches them.
    if (inViz && !typing) {
      // Output window: K is Cue (hold), G plays (instant send): plain-letter twins
      // of Space and the Play keys (wireOutputKeys). No-ops unless an output
      // window is open.
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
          // Also hands a tapped tempo back to the tracker (tapTempo.ts).
          const wasTapped = !!lastAnim?.tapGuided;
          resetBeatTrim();
          releaseTapTempo();
          showHud(wasTapped ? "Tapped tempo released, tempo ×1, beat timing reset" : "Tempo ×1, beat timing reset");
        } else {
          requestBarResync();
          showHud("This beat is the 1");
        }
      } else if (e.code === "BracketRight" || e.code === "BracketLeft") {
        e.preventDefault();
        noteKeyUse("tempo-x");
        // lastAnim is one render tick stale (this runs on keydown, before the next
        // animClock.advance() picks up the new multiplier), so its metronomeBpm
        // still carries the *old* multiplier: divide it out, then apply the new one.
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
  // Stop is the deliberate form of onCaptureEnded: release the mic/share and put
  // the start prompt back so listening resumes only on a tap. The room connection
  // is untouched.
  stopBtn.addEventListener("click", stopOwnCapture);
  refreshAudioPromptButtons(); // support never changes mid-session, so this runs once
  audioPromptMicBtn.addEventListener("click", () => void ensureAudio("mic"));
  audioPromptDisplayBtn.addEventListener("click", () => void ensureAudio("display"));

  micPermission = await micPermissionReady;
  scenePicker = createScenePicker({
    button: sceneBtn,
    scenes: scenePickEntries,
    currentId: () => scene.id,
    onPick: pickSceneFromList,
  });
  if (bypassGallery) {
    void enterViz(scene);
  } else {
    gallery = createGallery({
      scenes: galleryEntries,
      quality: () => quality,
      liveFrame: () => lastVis,
      onPick: (id) => {
        // A tile tap picks a scene, not a source: an implicit start like any other
        // (silent if mic permission is active, else the scene's start prompt asks;
        // see autoStartSource).
        void ensureAudio();
        navigate({ kind: "viz", sceneId: id }, "push");
      },
      onDisabledPick: (id, reason) => showHud(`${id}: ${reason}`, true),
      canCaptureDisplay: () => displayCaptureSupported(),
      sourceState: () => currentSourceState(),
      micLabel: () => inputChoiceLabel(),
      onSourceChoice: (next) => {
        // The live source tapped again disconnects it (stopOwnCapture).
        const state = currentSourceState();
        if (state.live && state.choice === next) {
          stopOwnCapture();
          return Promise.resolve();
        }
        if (bandAnalyser) return swapAudioSource(next); // persists the pref itself, once the swap lands
        // Nothing live yet: remember the choice AND start it inside this click (a
        // picker that only stored a pref read as buttons that do nothing). The
        // click is a real gesture, so "display" may open the share picker.
        setAudioSourceChoice(next);
        return ensureAudio(next);
      },
    });

    // A shared look link (?look=<code>#/v/<id>, see looksCard.ts buildShareLink),
    // applied once before routing so enterViz mounts the scene with the look's
    // tuning in place. The param is stripped either way so a reload can't
    // re-apply it over later edits or repeat a broken link.
    const lookCode = params.get("look");
    if (lookCode) {
      const look = decodeLook(lookCode);
      const targetScene = look ? getScene(look.sceneId) : undefined;
      if (!look) {
        // Deferred: the hash (still present even when the ?look= code is corrupt)
        // routes normally and applyRoute -> enterViz writes its own HUD line
        // synchronously, which would overwrite a same-tick showHud.
        setTimeout(() => showHud("that look link didn't parse", true), 0);
      } else if (!targetScene) {
        setTimeout(() => showHud("that look is for an unknown scene", true), 0);
      } else {
        saveSharedLook(look);
        primeUndo(look.sceneId, targetScene.settings ?? [], palette.id);
        applyLookAndPalette(look);
        navigate({ kind: "viz", sceneId: look.sceneId }, "replace");
      }
      history.replaceState(null, "", location.pathname + location.hash);
    }

    seedHistory();
    onRouteChange(applyRoute);
    if (handheldScreen && currentRoute().kind === "gallery") void openOnMain();
    else applyRoute(currentRoute());
  }
  // The mic permission is known and the page routed: a screen already in the
  // room (a laptop that reloaded with its TV paired) can be fed now.
  screensReady = true;
  const feedConn = activeConn();
  if (feedConn) feedFollowers(feedConn.currentRoster);

  // Dynamic import behind a literal DEV check: Vite replaces import.meta.env.DEV
  // with `false` in a production build, so Rollup strips this and the tuning
  // module graph.
  if (import.meta.env.DEV) {
    const { initTuning } = await import("./tuning/debug.ts");
    initTuning({
      getInput: () => ({
        sceneId: scene.id,
        settings: scene.settings ?? [],
        quality: quality.preset,
        fps: fpsMeter.read(),
        vis: lastVis,
        anim: lastAnim,
        renderScale: renderScale(),
        govLevel: governor?.level ?? 0,
        deepMono: lastDeepMono,
        sampleRate: capture?.context.sampleRate ?? null,
        fluxRatio: lastFluxRatio,
      }),
      // The picture meter, driven headlessly (tools/master-sweep.mjs).
      picture: {
        force: (on: boolean) => {
          pictureForced = on;
        },
        read: () => ({ latest: pictureMeter.latest(), mean: pictureAverager.mean(), samples: pictureAverager.count }),
        reset: () => pictureAverager.reset(),
      },
      setMaster: (v: number) => setSceneMaster(v),
      scenes: () =>
        listScenes().map((s) => ({
          id: s.id,
          name: s.name,
          // master-sweep's "featured" means Released only, so a scene in
          // development counts as a draft here.
          draft: sceneStage(s.id) !== "released",
          paid: PAID_SCENE_IDS.has(s.id),
        })),
    });
    // For headless room tests: what this page is doing about its ears, read live
    // off the connection. Dev builds only (added to the object initTuning published).
    const viz = (window as unknown as { __viz?: Record<string, unknown> }).__viz;
    if (viz) {
      viz.setPalette = (id: string) => applyPalette(getPalette(id));
      viz.room = () => {
        const c = activeConn();
        return {
          ownInput: ownInput(),
          delayMs: c ? c.pictureDelayMs() : 0,
          msSinceLastFrame: c ? c.msSinceLastFrame : Infinity,
          hasCapture: capture !== null,
          selfEars: c?.self?.ears ?? null,
          deviceId: c ? c.deviceId : null,
        };
      };
    }
  }

  lastRafMs = performance.now();
  requestAnimationFrame(loop);
  // A hidden tab gets no animation frames, which would starve the pop-out and a
  // paired TV of frames (net/backgroundTick.ts).
  startBackgroundTick(() => {
    if (shouldTickInBackground(document.hidden, (outputBridge?.status().open ?? false) || hostConn !== null || (activeConn() !== null && ownInput()))) tick();
  });
}

/** Raw dB bands to [0,1] via the analyser's fixed floor/ceiling: no envelope, no
 *  gain. Returns the shared scratch buffer; copy to hold across a tick
 *  (spectrumStrip.ts does). */
function captureRawBands(dbBands: Float32Array, range: { min: number; max: number }): Float32Array {
  const span = range.max - range.min;
  for (let i = 0; i < dbBands.length; i++) {
    rawBandsScratch[i] = Math.min(1, Math.max(0, (dbBands[i] - range.min) / span));
  }
  return rawBandsScratch;
}

/** peakL/peakR/glitchFrames off the tap's read(), rmsDb/humHz off `mono` (the
 *  buffer lastMono was just set to). Takes `mono` as an argument so it stays a
 *  plain function of its inputs. */
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

/** Nothing local to read this tick (synthetic feed, no capture, or a renderer):
 *  resets every reading from this device's own extractor and analysers so a card
 *  never shows a stale value from the previous mode. Add new readings here, not
 *  at each early-out in currentVisual(). */
function clearLocalReadings(): void {
  lastRawBands = null;
  lastMono = null;
  lastDeepMono = null;
  lastBeatDiag = null;
  lastFluxRatio = null;
  lastGate = null;
  lastInputHealth = null;
}

const stemRangesScratch: StemRanges = { lead: { lo: 0, hi: 0 } };

/** Lead covers the band split's Mid range, matching the row beside it. */
function stemRanges(edgesHz: Float32Array): StemRanges {
  const { lowMid, midHigh } = BAND_SPLIT;
  stemRangesScratch.lead.lo = edgesHz[lowMid];
  stemRangesScratch.lead.hi = edgesHz[midHigh];
  return stemRangesScratch;
}

/** Whether anything reads Hats or Lead this tick, so the stem split must run
 *  (who reads them: src/render/stemReaders.ts header). */
function stemsRead(): boolean {
  if (import.meta.env.DEV) return true;
  if (wiresReadStems(scene.id, scene.settings ?? [])) return true;
  if (compositor?.transitioning()) return true;
  if (deviceMenu?.isStemsRowOnScreen()) return true;
  if (outputBridge?.status().differs) return true;
  const conn = activeConn();
  return !!conn && conn.currentRoster.some((d) => d.online && d.deviceId !== conn.deviceId);
}

/** One tick's read of this device's own live capture, shared by currentVisual()'s
 *  solo and host branches. `now` is the capture's AudioContext clock. */
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
  const gate = captureIsMic ? resolveSilenceGate() : SILENCE_GATE_OFF;
  const f = extractor.update(dbBands, now, resolveAutoGain(), rateScale);
  const engine = engineSource ? engineSource.read(now) : null;
  f.engine = engine;
  f.gateOff = !captureIsMic;
  f.bpm = engineSource ? engineSource.bpm : 0;
  gateMusicHeld = musicHoldsGate(engine, gateMusicHeld);
  // Followers that predate the reading still react to these two flags.
  const dimmer = silenceGateDimmer(f.level, gate, gateMusicHeld);
  const strongest = engine ? Math.max(engine.kick, engine.snare, engine.hat) : 0;
  f.onset = hitPasses(strongest, dimmer);
  f.pulseOnset = strongest > 0;
  const suppressed = !f.onset && hitPasses(strongest, 1);
  if (stemGate) {
    // readBandsDb() above just refilled binsDb. A skipped tick keeps the
    // frame's zeros.
    const stems = stemGate.update(stemsRead(), bandAnalyser.binsDb, now, stemRanges(bandAnalyser.bandEdgesHz));
    if (stems) {
      f.hats = stems.hats;
      f.lead = stems.lead;
    }
  }
  beatDiag.ratio = engine ? engine.surge : 0;
  beatDiag.gated = suppressed;
  beatDiag.blocked = engine ? engine.blocked : false;
  beatDiag.sinceOnsetSec = now - lastEngineOnsetAt;
  if (f.onset) lastEngineOnsetAt = now;
  lastBeatDiag = beatDiag;
  lastFluxRatio = engine ? engine.surge : null;
  // `fired` is this capture's onset, not the jitter-buffered frame
  // currentVisual() returns in host mode, so fired and suppressed describe the
  // same tick's decision.
  lastGate = { dimmer, fired: f.onset, suppressed };
  // Feeds next tick's resolveAutoGain(); the one-tick lag is fine (see feedAutoGainMeasurement).
  feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
  // Same one-tick lag (see feedSilenceGateMeasurement).
  if (captureIsMic) feedSilenceGateMeasurement(f.level, extractor.dtSec);
  return { f, now };
}

/** @param rateScale smoothingRateScale(resolveSmoothing(scene.id)), computed once
 *  per tick by loop(): resolveSmoothing() slews its auto value, so a second call
 *  would double the slew. Forwarded to extractor.update() so a local capture's
 *  envelope honors the same Smoothing, including 0. */
function currentVisual(rateScale: number): FeatureFrame | null {
  // Reset every tick: only sampleToVisual, on a page following a feed, sets it.
  const conn = activeConn();

  if (mode === "solo" || !conn) {
    // Solo. (A room mode with no connection is mid-fallback from a lost room, and
    // has nothing yet.)
    if (syntheticFeed && mode === "solo") {
      // Generated directly, not sampled from a signal: nothing for the scope to
      // trace, so its card stays hidden (audioMeters.ts).
      clearLocalReadings();
      return syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000);
    }
    if (mode !== "solo" || !bandAnalyser || !capture) {
      clearLocalReadings();
      return null;
    }
    const { f } = readLocalCapture(bandAnalyser, capture, rateScale);
    return f;
  }

  // In a room and listening to this device's own input (laptop, or an iPad/phone
  // set to its own input): the frame goes through the connection (onto the wire
  // when someone follows) and what is drawn is the connection's delayed sample, so
  // this page and its followers show the same instant.
  if (ownInput()) {
    if (syntheticFeed) {
      // Stands in for the mic, so a room test can have a laptop or iPad feed
      // followers without audio hardware.
      clearLocalReadings();
      conn.sendFrame(syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000));
      return sampleToVisual(conn.sample());
    }
    if (!bandAnalyser || !capture) {
      clearLocalReadings();
      return null;
    }
    const { f } = readLocalCapture(bandAnalyser, capture, rateScale);
    conn.sendFrame(f, lastMono ? minMax(lastMono) : null);
    return sampleToVisual(conn.sample());
  }

  // Following another device — no local input, so no raw signal to show.
  clearLocalReadings();
  // A page that joined by the QR keeps its preview path: nothing to fall back to
  // (no solo mic) and its socket reconnects (net/room.ts). A feed that stops
  // sending is different, since the socket stays open: the preview goes silent and
  // the badge says it is waiting (net/controllerPreview.ts), never fallBackToSolo.
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
  // The old keyless spectator: no records, so no feed to switch to — when the
  // host goes quiet it takes a mic of its own.
  if (rendererConn && !rendererConn.keyed) {
    const s = rendererConn.sample();
    if (s) rendererHasData = true;
    if (rendererHasData && rendererConn.msSinceLastFrame > STALE_TIMEOUT_MS) {
      void fallBackToSolo(rendererConn.connected ? "went quiet" : "disconnected");
    }
    return sampleToVisual(s);
  }
  // A laptop or a keyed spectator set to follow another device.
  return sampleToVisual(conn.sample());
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
    hats: s.hats,
    lead: s.lead,
    engine: s.engine,
    gateOff: s.gateOff,
  };
}

/** The marks a drawn frame's hits are gated with (src/audio/silenceGate.ts). */
function gateFor(frame: FeatureFrame | null): SilenceGateMarks {
  return frame?.gateOff ? SILENCE_GATE_OFF : resolveSilenceGate();
}

function loop(): void {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  tick();
  // Only here, not in the hidden-tab background clock (which also calls tick): the
  // meter reads busy time against rAF wall time.
  const t1 = performance.now();
  resourceMeter?.recordTick(t1 - t0, t1);
}

/** One pass of the loop: sample audio, advance clocks and drives, feed the
 *  pop-out and any paired TV, then draw. Also run by net/backgroundTick.ts's
 *  worker clock while the tab is hidden, with DOM and GL work skipped
 *  (`document.hidden`), so the output keeps getting frames. */
function tick(): void {
  const nowRafMs = performance.now();
  const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
  lastRafMs = nowRafMs;

  // Autopilot off last tick's clock, before this tick's frame: a pad it fires
  // switches scene here, so nothing below is computed for the scene it just left.
  if (lastAnim) stepSetAutopilot(lastAnim, nowRafMs);
  // A launch is a beat count on one clock; the metronome starting or stopping
  // switches clocks, and a count from the other one would land at random.
  const launchClockTempo = lastAnim?.metronomeOn ?? false;
  if (launchClockTempo !== launchQueueTempo) launchQueue = [];
  launchQueueTempo = launchClockTempo;
  if (!inViz) launchQueue = [];
  else if (launchQueue.length > 0) {
    const { due, rest } = takeDue(launchQueue, deskBeats());
    launchQueue = rest;
    if (due) {
      firePad(due.padId);
      outputControls?.go();
    }
  }
  if (nowRafMs - padReadingsAtMs >= PAD_READING_MS) {
    padReadingsAtMs = nowRafMs;
    updatePadReadings();
  }

  // Resolved once per tick and reused below (extractor, anim clock, meters).
  const smoothing = resolveSmoothing(scene.id);
  const rateScale = smoothingRateScale(smoothing);

  // Always sampled: in host mode this feeds hostConn.sendFrame, so a paired TV
  // keeps getting frames while this device sits on the gallery.
  lastVis = currentVisual(rateScale);

  // The pop-out keeps streaming even while this window sits on the gallery (a
  // stray Esc must never blank the projector), hence the frame is
  // built before the inViz return.
  outputBridge?.update(nowRafMs);
  roomBridge?.update(nowRafMs);
  desk?.tick(nowRafMs);
  // Outside the bridge check: a controller has no pop-out yet still previews
  // whenever a scene is showing, unless it is a phone that is a screen of the room.
  const nextActive = isController ? inViz && !fillsScreen() : inViz && !!outputBridge && outputBridge.status().open;
  // A pop-out that just opened starts on this window's preview (outputSync.ts
  // outputOpened), so the pad loaded here is live on it.
  const popOutOpen = outputBridge?.status().open ?? false;
  if (popOutOpen && !setPopOutWasOpen) {
    setLivePadId = currentPadId();
    playMainWhileAlone();
  }
  setPopOutWasOpen = popOutOpen;
  if (nextActive !== previewActive) {
    previewActive = nextActive;
    applyRenderQuality(true);
    applyPreviewBox();
    applyDesk();
  }
  // Before this tick draws, so a take's first frame has the output's size. While
  // a take holds, the two calls also follow an Output Quality or Energy saving
  // change made mid-take; both do nothing when nothing changed.
  const nextRecordAsOutput = previewActive && (clipRecorder?.recording() ?? false);
  const recordFlipped = nextRecordAsOutput !== recordAsOutput;
  if (recordFlipped) {
    recordAsOutput = nextRecordAsOutput;
    // The buffer takes the output's shape; the box keeps the window's.
    canvas.style.objectFit = recordAsOutput ? "contain" : "";
  }
  if (recordFlipped || recordAsOutput) {
    applyRenderQuality(true);
    applyPowerMode(powerMode);
  }
  if (outputBridge && lastVis) outputBridge.pushFrame(lastVis, { gate: gateFor(lastVis) }, { sens: outputSens, exp: outputExp, smoothing });

  if (!inViz) {
    if (!document.hidden) gallery?.tick(nowRafMs);
    return;
  }

  // The anim clock advances here, ahead of deviceMenu.update(): the listening
  // post's meters (audioMeters.ts) read this tick's AnimFrame. Feature extraction
  // and the anim clock run on every rAF tick regardless of the render-rate cap;
  // only the GPU draw and panel drawing are capped (panelDraws).
  // `nowRafMs` makes this the one clock that follows a tap
  // tempo (tapTempo.ts); like the beat keys, a tap only reaches this window's clock.
  const anim = lastVis
    ? animClock.advance(
        dtSec,
        lastVis,
        smoothing,
        gateFor(lastVis),
        { shape: getHitShape() },
        nowRafMs,
      )
    : null;

  // Reused for displayFrame at render time instead of re-resolving.
  let sensitivity = 1;
  let expansion = 1;

  if (anim) {
    lastAnim = anim;
    advanceAutoTune(dtSec, anim.profile);
    // Every tick, rendered or not: a tick that doesn't render still needs its
    // edges remembered (renderLatch.ts).
    renderLatch.accumulate(anim);

    sensitivity = resolveSensitivity(scene.id);
    expansion = resolveExpansion(scene.id);
    outputSens = sensitivity;
    outputExp = expansion;
    // Per-tick advance (drives.ts header): grid pulses and a setting's drawn-line
    // peak-hold need every rAF tick, not just render ticks. `driveEnergy` is the
    // sensitivity-applied energy a scene's uEnergy sees at render, so the "All
    // level" catalogue source never lags.
    const driveEnergy = applySensitivity(lastVis!, sensitivity, expansion).energy;
    driveEngine.accumulate(dtSec, lastVis!, driveEnergy, anim, scene.id, scene.settings ?? []);
  }

  // Nobody is looking at this tab, so no meters or picture to update (the only
  // way here without an animation frame is the background clock). The idle demo
  // still runs: it is what the output shows with no input.
  if (document.hidden) {
    if ((!lastVis || !anim) && idlePreviewActive()) renderIdlePreview(nowRafMs, dtSec, smoothing);
    return;
  }

  // Only built while the panel is open: update() returns before touching `drives`
  // when closed, and forScene() allocates. Off the un-latched AnimFrame and for a
  // drive row's live pill/overlay only: it reads uniformPair()/excess(), never
  // fired(), so it can't steal a grid setting's pending edge (drives.ts).
  const liveDrives = anim && deviceMenu?.isOpen() ? driveEngine.forScene(scene.id, scene.settings ?? [], anim) : null;
  // The panel draws on a tick the scene renders (framePace.ts's gate, asked before
  // drawScene() moves it) or once a full RENDER_FPS_CAP interval after
  // its last draw: a display faster than the cap redraws it once per scene frame,
  // and a lowered cap (Energy saving, the pop-out's preview) doesn't slow its meters.
  const sceneDraws = renderGate.due(nowRafMs, renderIntervalMs());
  const panelDraws = sceneDraws || shouldRenderFrame(nowRafMs, lastPanelDrawMs, 1000 / RENDER_FPS_CAP);
  if (panelDraws) lastPanelDrawMs = nowRafMs;
  syncGlass(sceneDraws, (!!lastVis && !!anim) || idlePreviewActive());
  // Fed even when null (mic pending) so the strip shows its "waiting for audio" idle state.
  deviceMenu?.update(lastVis, lastRawBands, anim, rateScale, lastBeatDiag, lastGate, liveDrives, panelDraws);

  if (!lastVis || !anim) {
    if (idlePreviewActive()) renderIdlePreview(nowRafMs, dtSec, smoothing);
    // Nothing to draw this tick (no feed yet, or it went quiet): the gap to the
    // next drawn frame is not frames coming late.
    else frameMisses.restart();
    return;
  }

  drawScene(nowRafMs, lastVis!, sensitivity, expansion, anim, renderLatch, driveEngine);
}

/** The scene's render tail, shared by live audio and the idle preview (each passes its own latch and drive engine). */
function drawScene(
  nowRafMs: number,
  frame: FeatureFrame,
  sensitivity: number,
  expansion: number,
  anim: AnimFrame,
  latch: RenderLatch,
  engine: DriveEngine,
): void {
  if (glLost) return;
  const intervalMs = renderIntervalMs();
  if (!renderGate.pass(nowRafMs, intervalMs)) return;
  fpsMeter.frame(nowRafMs);

  const resized = sizeCanvas();
  if (resized) mainHost!.ctx.gl.viewport(0, 0, canvas.width, canvas.height);

  const displayFrame = applySensitivity(frame, sensitivity, expansion);
  const latchedAnim = latch.consume(anim, nowRafMs);
  const drives = engine.forScene(scene.id, scene.settings ?? [], latchedAnim);
  // Drain the previous capture *before* this frame's draws are queued: the
  // readback is a synchronous round trip in Chrome, so asking after scene.render
  // would wait on the whole frame's GPU work (a 12-16 ms stall per call with the
  // panel open). Its fence has had a frame to signal.
  const picturePolled = pictureWanted();
  if (picturePolled) pollPicture();
  // The timer query only runs while the panel is open to show it.
  resourceMeter?.beginGpu(deviceMenu?.isOpen() ?? false);
  let outcome: RenderOutcome | undefined;
  try {
    outcome = sceneGuard.draw(scene, () =>
      compositor!.render({
        ctx: mainHost!.ctx,
        scene,
        frame: displayFrame,
        viewport,
        palette,
        anim: latchedAnim,
        drives,
        drivesFor: (s) => engine.forScene(s.id, s.settings ?? [], latchedAnim),
        nowMs: nowRafMs,
      }),
    );
  } finally {
    resourceMeter?.endGpu();
  }
  // A scene that threw drew nothing this frame; the guard has already cut the screen.
  if (!outcome) {
    frameMisses.restart();
    return;
  }
  const governable = outcome.governable;
  // Right after the scene has drawn, and nowhere else: the default framebuffer
  // (preserveDrawingBuffer false, gl.ts) only holds this frame until the browser
  // composites it; pictureReadback.ts's header says why this must run in the same
  // task. Gated behind pictureWanted(): the readback blocks the main thread.
  if (picturePolled) capturePicture(nowRafMs);
  // After the picture capture, so the reading measures the scene alone.
  // Drawn after the compositor so the overlay sits over crossfade and held
  // effects, staying visible over Freeze and Blackout.
  overlayLayer?.draw();
  // The desk's LIVE monitor copies #gl here, while the frame is still in the
  // drawing buffer (liveMonitor.ts).
  desk?.afterDraw(nowRafMs);
  // Last: the browser's blur sees the overlay too, and nothing after this
  // reads the frame.
  if (glassPaneCount > 0) drawGlass();
  // A frame with two scenes (a crossfade) or none (Freeze) says nothing about
  // what one scene costs, so the governor does not see it.
  if (governable) governor?.recordFrame(nowRafMs);
  frameMisses.frame(nowRafMs, intervalMs, document.hidden);
}

/** Panel blur's Fast look: whether the renderer draws the glass this tick
 *  (glassPref.ts's setGlassDrawn) and, when the scene draws, where
 *  (glassPanes.ts). Runs before the panel writes its styles, so the layout it
 *  reads is what the browser already has. Off (the browser's blur takes over)
 *  while the panel is closed, while a clip records the canvas (the take would
 *  carry the glass), and while nothing draws the scene (the last frame stays up
 *  and its glass wouldn't follow the panel). */
function syncGlass(sceneDraws: boolean, scenePlays: boolean): void {
  const drawn =
    getGlassMode() === "fast" &&
    !glassBroken &&
    !glLost &&
    scenePlays &&
    (deviceMenu?.isOpen() ?? false) &&
    !(clipRecorder?.recording() ?? false);
  setGlassDrawn(drawn && !(desk?.active() ?? false));
  glassPaneCount = drawn && sceneDraws ? readGlassPanes(canvas, glassPanes, glassCanvasBox) : 0;
}

function drawGlass(): void {
  if (!glassBackdrop) glassBackdrop = createGlassBackdrop(mainHost!.ctx.gl);
  const { w, h } = glassCanvasBox;
  if (!glassBackdrop.draw(glassPanes, glassPaneCount, w, h, GLASS_LOOK)) glassBroken = true;
}

/** Sizes the drawing buffer and says whether it changed: to the CSS box, or while
 *  recordAsOutput to the output's last reported buffer, so a take has the
 *  output's pixel size. */
function sizeCanvas(): boolean {
  const out = recordAsOutput ? outputBridge?.outputStatus() : null;
  if (!out || !(out.bufferWidth > 0) || !(out.bufferHeight > 0)) return resizeCanvasToDisplaySize(canvas, renderScale());
  const w = Math.round(out.bufferWidth);
  const h = Math.round(out.bufferHeight);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

/** Whether anything wants a live picture reading: the desk's Map, or a
 *  headless driver forcing it (picture.force). Each sample ends in a GPU
 *  readback that blocks the main thread (pictureReadback.ts's header). */
function pictureWanted(): boolean {
  return pictureForced || deskWantsPadReading();
}

/** The desk's Map places a pad by its picture: sample while the pad on NEXT has
 *  none yet, and only then, since every sample is a GPU readback. */
function deskWantsPadReading(): boolean {
  if (!(desk?.active() ?? false)) return false;
  const id = currentPadId();
  return id !== null && !padReadings.has(id);
}

function ensurePictureReadback(): PictureReadback {
  if (!pictureReadback) pictureReadback = createPictureReadback(mainHost!.ctx.gl, PICTURE_SAMPLE_INTERVAL_MS);
  return pictureReadback;
}

/** Drains finished thumbnails into the meter/averager, oldest first, before the
 *  scene draws (see drawScene). The readback's result buffer is reused, so push
 *  immediately. */
function pollPicture(): void {
  for (const t of ensurePictureReadback().poll()) {
    const r = pictureMeter.push(t.px, t.w, t.h, t.atMs);
    pictureAverager.add(r);
  }
}

/** Kicks off the next thumbnail, at most every PICTURE_SAMPLE_INTERVAL_MS, right after the scene draws in the same task. */
function capturePicture(nowRafMs: number): void {
  // Half a 60 fps frame of slack: rAF timestamps jitter, and without it a 60 fps
  // render lands just short of the interval on its fourth frame and samples every
  // fifth (12 Hz, not 15).
  if (nowRafMs - lastPictureKickMs >= PICTURE_SAMPLE_INTERVAL_MS - 8) {
    ensurePictureReadback().capture(canvas.width, canvas.height, nowRafMs);
    lastPictureKickMs = nowRafMs;
  }
}

/** Wider than updateMicPrompt's needsAudio: stays true while a permission or
 *  share picker is open, so the demo keeps playing until real audio takes over
 *  instead of blinking to black. */
function idlePreviewActive(): boolean {
  return inViz && ownInput() && !syntheticFeed && !bandAnalyser;
}

/** One tick of the demo groove behind the start prompt: loop()'s pipeline on
 *  idlePreview's own state minus everything live-only (no auto-tune training,
 *  meters or host send). The scene's settings, Sensitivity and Expansion still apply, so
 *  tweaking a look before picking a source shows the result. */
function renderIdlePreview(nowRafMs: number, dtSec: number, smoothing: number): void {
  // Clock only, no profile: the demo can't train it, but the auto
  // Sensitivity/Expansion keep gliding instead of freezing.
  tickAutoTune(dtSec);
  const frame = idlePreview.feed.frame(nowRafMs / 1000);
  outputBridge?.pushFrame(frame, { gate: resolveSilenceGate() }, { sens: outputSens, exp: outputExp, smoothing });
  const anim = idlePreview.anim.advance(dtSec, frame, smoothing, resolveSilenceGate(), { shape: getHitShape() });
  idlePreview.latch.accumulate(anim);
  const sensitivity = resolveSensitivity(scene.id);
  const expansion = resolveExpansion(scene.id);
  const driveEnergy = applySensitivity(frame, sensitivity, expansion).energy;
  idlePreview.drives.accumulate(dtSec, frame, driveEnergy, anim, scene.id, scene.settings ?? []);
  drawScene(nowRafMs, frame, sensitivity, expansion, anim, idlePreview.latch, idlePreview.drives);
}

void boot();
