import { DRAFT_SCENE_IDS } from "./render/scenes/index.ts"; // also registers built-in scenes (side effect)
import { captureMic, captureDisplayAudio } from "./audio/capture.ts";
import { createBandAnalyser, type BandAnalyser } from "./audio/analyser.ts";
import { createWaveformAnalyser, type WaveformAnalyser } from "./audio/waveformAnalyser.ts";
import { createLufsAnalyser, type LufsAnalyser } from "./audio/lufsAnalyser.ts";
import type { LufsReading } from "./audio/lufs.ts";
import { FeatureExtractor } from "./audio/features.ts";
import { NUM_BANDS, type CaptureHandle, type CaptureSourceKind, type FeatureFrame } from "./audio/types.ts";
import {
  getAudioSourceChoice as getStoredAudioSource,
  setAudioSourceChoice,
  displayCaptureSupported,
  DISPLAY_SHARE_GUIDE,
  type AudioSourceChoice,
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
import { createRenderLatch } from "./render/renderLatch.ts";
import { createSyntheticFeed, type SyntheticFeed } from "./audio/synthetic.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { getSceneSetting, resetSceneSettings, setSceneSetting } from "./render/sceneSettings.ts";
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
import { getPowerMode, setPowerMode, type PowerMode } from "./render/powerMode.ts";
import { getQualityChoice, setQualityChoice, type QualityChoice } from "./render/qualityPref.ts";
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
  getAutoStrength,
  setAutoStrength,
  seedAuto,
} from "./render/autoTune.ts";
import {
  createRoomCode,
  HostConnection,
  RendererConnection,
  type VisualSample,
} from "./net/room.ts";
import { createJoinScreen } from "./ui/joinScreen.ts";
import { createDeviceMenu, type AudioSource, type DeviceMenu } from "./ui/deviceMenu.ts";
import { createControlPanel } from "./ui/controlPanel.ts";
import { createGallery, type Gallery } from "./ui/gallery.ts";
import { navigate, onRouteChange, seedHistory, currentRoute, type Route } from "./router.ts";
import { createImmersiveMode, type ImmersiveMode } from "./ui/fullscreen.ts";

type Mode = "solo" | "host" | "renderer";
type AnyConn = HostConnection | RendererConnection;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const roomCodeEl = document.getElementById("roomCode") as HTMLDivElement;
const menuBtn = document.getElementById("menuBtn") as HTMLButtonElement;
const panelBtn = document.getElementById("panelBtn") as HTMLButtonElement;
const backBtn = document.getElementById("backBtn") as HTMLButtonElement;
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement;
const audioPrompt = document.getElementById("audioPrompt") as HTMLDivElement;
const audioPromptLabel = document.getElementById("audioPromptLabel") as HTMLSpanElement;
const audioPromptMicBtn = document.getElementById("audioPromptMicBtn") as HTMLButtonElement;
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
 *  panel's Scope card (src/ui/audioMeters.ts). Never touches FeatureExtractor
 *  or the wire frame: this is display-only data local to this device, not a
 *  render-driving signal. See waveformAnalyser.ts's header for why. */
let waveformAnalyser: WaveformAnalyser | null = null;
/** K-weighted loudness tap for the panel's Loudness card
 *  (src/audio/lufsAnalyser.ts) — display-only and local, like the waveform
 *  analyser above. */
let lufsAnalyser: LufsAnalyser | null = null;
/** Rebuilt (not just reset) on every swapAudioSource() — see that function's
 *  comment for why a fresh extractor, not a reset(), is what a source swap
 *  needs. */
let extractor = new FeatureExtractor();
/** Set on first mic/display-capture attempt; cached so re-entering a viz
 *  never re-prompts. Cleared back to null on failure, or when the capture's
 *  own track ends (onCaptureEnded), so a retry is possible. */
let audioPromise: Promise<void> | null = null;
let captureFailed = false;
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
/** The main fullscreen GL context — created once at boot and kept alive for
 *  the whole session; only which scene is mounted on it changes. */
let mainHost: SceneHost | null = null;

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
 *  (no local mic on a renderer device). Feeds the Scope card. */
let lastMono: Float32Array | null = null;
// FeatureExtractor.fixedEnergy from this device's own extractor — the Signal
// card's history trace draws it as the "auto-gain fully off" reference. Null
// wherever no local extractor ran this frame (renderer, synthetic feed).
let lastFixedEnergy: number | null = null;
// FeatureExtractor.fluxRatio from this device's own extractor — the Rhythm
// card's Onset row. Same solo/host-only availability as lastFixedEnergy
// above and for the same reason.
let lastFluxRatio: number | null = null;
/** This tick's LUFS reading off lufsAnalyser — same solo/host-only
 *  availability as lastMono, for the Loudness card. */
let lastLufs: LufsReading | null = null;
const rawBandsScratch = new Float32Array(NUM_BANDS);

const animClock = createAnimClock();
// Latches one-shot AnimFrame edges (onset/lowOnset/.../dropOnset) across
// ticks the render cap skips, and turns anim.dtSec into wall time since the
// last *rendered* frame rather than the last rAF tick — see renderLatch.ts.
// deviceMenu/audioMeters and advanceAutoTune below still see the raw,
// un-latched `anim` (they run every tick); only what reaches scene.render()
// goes through the latch.
const renderLatch = createRenderLatch();
let lastRafMs = 0;
let hudHideTimer: number | undefined;

/** This tick's AnimFrame and an EWMA-free instantaneous render fps — both
 *  dev-only-consumed, by the tuning probe (src/tuning/probe.ts) via the
 *  getInput() closure wired in boot() below. Harmless to keep updating in a
 *  prod build (just two numbers/an object reference, no allocation beyond
 *  what animClock.advance already does), so no DEV guard needed here. */
let lastAnim: AnimFrame | null = null;
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

/** Applies a quality-choice change (src/render/qualityPref.ts) to the live
 *  session: mutates the shared `quality` object in place — rather than
 *  reassigning it — so mainHost's SceneContext, the gallery, and the
 *  governor's own closure (which snapshots it as `baseline` at construction)
 *  all pick it up without a remount. The governor itself is rebuilt rather
 *  than re-baselined: its targetFrameMs also depends on the preset (the
 *  floor preset caps at RENDER_FPS_CAP_FLOOR), and a rebuild resets its
 *  measurement state for free — the same clean-slate rule setEnabled(true)
 *  already follows. No-op on the numeric knobs while pinned (a dev
 *  `?quality=`/`?tier=` override): see boot()'s comment on `pinned`. */
function applyQualityChoice(choice: QualityChoice): void {
  qualityChoice = choice;
  Object.assign(quality, qualitySettings(effectivePreset()));
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  applyPowerMode(powerMode);
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

async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — some browsers/contexts deny it; screen may just dim.
  }
}

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, quality.preset));
}

/** Routes both local picks (device menu) and remote commands (control panel on
 *  another device) through the same path, so the roster always reflects reality. */
function applyScene(next: Scene): void {
  if (!mainHost) return;
  mainHost.unmountAll();
  mainHost.mount(next);
  scene = next;
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

/** `?source=display` pins the initial offered/remembered choice the way
 *  `?quality=` pins a preset — mainly for dev/tooling use without touching
 *  localStorage. Otherwise defers to the persisted choice
 *  (src/audio/sourcePref.ts), falling back to mic wherever display capture
 *  isn't supported at all. Pinning "display" here does NOT by itself start a
 *  capture — see autoStartSource() below for why. */
function resolveInitialSource(): AudioSourceChoice {
  const params = new URLSearchParams(location.search);
  if (params.get("source") === "display" && displayCaptureSupported()) return "display";
  const stored = getStoredAudioSource();
  return stored === "display" && !displayCaptureSupported() ? "mic" : stored;
}

/** The source an IMPLICIT start — one no tap asked for — is allowed to use.
 *  getUserMedia and getDisplayMedia are not symmetric: getUserMedia has no
 *  transient-activation requirement and its grant is remembered per origin,
 *  so auto-starting the mic just re-uses consent already given. getDisplayMedia
 *  is the opposite — it needs a live user gesture and reopens Chrome's share
 *  picker on every single call, with nothing ever remembered. So a persisted
 *  "display" pref is a statement of intent, not standing consent to pop that
 *  picker: an implicit path starts nothing and lets updateMicPrompt() put the
 *  start prompt up, whose Screen button reaches getDisplayMedia inside a real
 *  tap. Same principle onCaptureEnded already states for its own refusal to
 *  fall back to another source. */
function autoStartSource(): AudioSourceChoice | null {
  return resolveInitialSource() === "display" ? null : "mic";
}

function startCapture(choice: AudioSourceChoice): Promise<CaptureHandle> {
  return choice === "display" ? captureDisplayAudio() : captureMic();
}

/** Maps a capture's kind to the panel's AudioSource vocabulary. "device" (a
 *  specific input device, e.g. a loopback driver) has no capture.ts caller
 *  yet and so no distinct AudioSource of its own — treat it as "mic" for
 *  status purposes until it does. */
function captureAudioSource(kind: CaptureSourceKind): AudioSource {
  switch (kind) {
    case "display":
      return "display";
    case "mic":
    case "device":
      return "mic";
  }
}

/** Builds bandAnalyser/waveformAnalyser/lufsAnalyser off a freshly started
 *  capture, and hangs a listener off its audio track so an externally-ended
 *  share (Chrome's "Stop sharing" bar, a revoked mic permission) is noticed
 *  instead of silently freezing the visuals at zero — see onCaptureEnded. */
function attachCapture(handle: CaptureHandle): void {
  capture = handle;
  bandAnalyser = createBandAnalyser(handle.context, handle.sourceNode);
  waveformAnalyser = createWaveformAnalyser(handle.context, handle.sourceNode);
  lufsAnalyser = createLufsAnalyser(handle.context, handle.sourceNode);
  // stop() (used when swapAudioSource retires this handle) does not fire
  // "ended" per spec — only an external stop does — so this listener and a
  // deliberate swap never race each other.
  const track = handle.stream.getAudioTracks()[0];
  track?.addEventListener("ended", () => onCaptureEnded(handle), { once: true });
}

/** The live capture's track ended on its own — the user hit Chrome's "Stop
 *  sharing" bar, or the OS revoked a mic permission mid-session. Tears down
 *  and re-shows the start prompt rather than leaving the visuals frozen at
 *  zero. Deliberately doesn't fall back to another source — that would fire
 *  a permission prompt the user didn't ask for. */
function onCaptureEnded(handle: CaptureHandle): void {
  if (capture !== handle) return; // already superseded by a swap
  handle.stop();
  capture = null;
  bandAnalyser = null;
  waveformAnalyser = null;
  lufsAnalyser = null;
  audioPromise = null;
  captureFailed = false;
  updateMicPrompt();
}

/** Turns a capture failure into copy the user can act on. A mic denial keeps
 *  today's wording — a tile tap does retry the mic; a cancelled share picker
 *  points at the Screen button instead, since a tile tap no longer starts one
 *  (both raise the same DOMException, hence branching on `choice` too);
 *  anything else — e.g. captureDisplayAudio's own no-audio-track message —
 *  surfaces verbatim with a neutral retry hint instead of being swallowed. */
function captureErrorMessage(choice: AudioSourceChoice, err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return choice === "display"
      ? "Screen share cancelled — tap Screen to try again."
      : "Microphone permission denied — tap a tile to retry.";
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
 *  hostConn is independent of capture, so a paired TV keeps rendering. */
function swapAudioSource(next: AudioSourceChoice): Promise<void> {
  if (!bandAnalyser || syntheticFeed || mode === "renderer") return Promise.resolve();
  if (capture?.kind === next) return Promise.resolve();
  if (swapPromise) return swapPromise;
  const previous = capture;
  const attempt = (async () => {
    const handle = await startCapture(next);
    previous?.stop();
    attachCapture(handle);
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
  audioPromptMicBtn.textContent = canDisplay ? "Mic" : "Tap to enable mic";
  audioPromptGuide.textContent = DISPLAY_SHARE_GUIDE;
  audioPromptGuide.hidden = !canDisplay;
}

function updateMicPrompt(): void {
  // Hidden while a fresh attempt is in flight (audioPromise set but not yet
  // settled) so we don't double-prompt; shown before any attempt or after
  // one has failed.
  const needsAudio = inViz && mode !== "renderer" && !syntheticFeed && !bandAnalyser && (captureFailed || !audioPromise);
  audioPrompt.style.display = needsAudio ? "flex" : "none";
  // Which source is remembered can change mid-session (a Source-row swap
  // persists a new pref), unlike display support above — hence here and not
  // in refreshAudioPromptButtons. Emphasis only, never an auto-fire: see
  // autoStartSource for why the picker still waits for a tap.
  const remembered = resolveInitialSource();
  audioPromptMicBtn.toggleAttribute("data-remembered", !audioPromptDisplayBtn.hidden && remembered === "mic");
  audioPromptDisplayBtn.toggleAttribute("data-remembered", remembered === "display");
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

function wireDeviceMenu(): void {
  deviceMenu = createDeviceMenu({
    getPalettes: () => menuItems(PALETTES),
    currentSceneId: () => scene.id,
    currentSceneName: () => scene.name,
    currentPaletteId: () => palette.id,
    // What the Bands card's status line reports as the audio source. A
    // renderer has no local analyser — its bands arrive over the room.
    getAudioStatus: () => ({
      source: syntheticFeed ? "synthetic" : mode === "renderer" ? "remote" : capture ? captureAudioSource(capture.kind) : "none",
      sampleRate: capture?.context.sampleRate ?? null,
    }),
    // The Input card's Source row. Null (row hidden) on a renderer or the
    // synthetic feed — see DeviceMenuDeps.getAudioSourceChoice's doc comment.
    getAudioSourceChoice: () => (mode === "renderer" || syntheticFeed ? null : getStoredAudioSource()),
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
    canCaptureDisplay: () => displayCaptureSupported(),
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
    getSceneSettingValue: (sceneId, spec) => getSceneSetting(sceneId, spec),
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
    onLufsReset: () => lufsAnalyser?.reset(),
    resolveSceneSettingValue: (sceneId, spec) => resolveSceneSetting(sceneId, spec),
    resolveSensitivityValue: (sceneId) => resolveSensitivity(sceneId),
    resolveExpansionValue: (sceneId) => resolveExpansion(sceneId),
    resolveSmoothingValue: (sceneId) => resolveSmoothing(sceneId),
    getSensitivitySpec: () => getSensitivitySpec(),
    getExpansionSpec: () => getExpansionSpec(),
    getSmoothingSpec: () => getSmoothingSpec(),
    isSettingAutoEnabled: (sceneId, key) => isAutoEnabled(sceneId, key),
    onSettingAutoToggle: (sceneId, spec, on) => {
      if (on) {
        // Pseudo-params (Sensitivity/Expansion/Smoothing) live in their
        // own store rather than sceneSettings.ts — this map picks the right
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
    },
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
    getAutoStrength: () => getAutoStrength(),
    onAutoStrengthChange: (value) => setAutoStrength(value),
    getAutoGain: () => getAutoGain(),
    onAutoGainChange: (value) => {
      setAutoGainAuto(false);
      setAutoGain(value);
    },
    isAutoGainAuto: () => isAutoGainAuto(),
    onAutoGainAutoToggle: (on) => setAutoGainAuto(on),
    resolveAutoGain: () => resolveAutoGain(),
    getPowerMode: () => powerMode,
    onPowerModeChange: (mode) => {
      setPowerMode(mode);
      applyPowerMode(mode);
    },
    getQualityChoice: () => qualityChoice,
    onQualityChoiceChange: (choice) => {
      setQualityChoice(choice);
      applyQualityChoice(choice);
    },
    getPowerStatus: () => ({
      mode: powerMode,
      choice: qualityChoice,
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
      if (s && presetAllows(s, quality.preset)) {
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

  mainHost!.unmountAll();
  mainHost!.mount(next);
  scene = next;

  showHud(`${mode}${roomCode ? ` (${roomCode})` : ""}  quality: ${quality.preset}  scene: ${scene.name}  palette: ${palette.name}`);
  activeConn()?.sendHello(scene.id, palette.id, viewport);

  menuBtn.style.display = "block";
  fsBtn.style.display = "block";
  if (!bypassGallery) backBtn.style.display = "block";

  if (mode !== "renderer") void ensureAudio();
  updateMicPrompt();
  void requestWakeLock();
  immersive?.resume();
}

function exitToGallery(): void {
  inViz = false;
  menuBtn.style.display = "none";
  fsBtn.style.display = "none";
  backBtn.style.display = "none";
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
  if (!s || !presetAllows(s, quality.preset)) {
    showHud(s ? "scene unavailable on this device" : "unknown scene", true);
    navigate({ kind: "gallery" }, "replace");
    return;
  }
  void enterViz(s);
}

async function boot(): Promise<void> {
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
  quality = qualitySettings(effectivePreset());
  mainHost = createSceneHost(gl, quality);
  if (!presetAllows(scene, quality.preset)) scene = availableScenes()[0] ?? scene;
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

  if (mode === "host" && roomCode) {
    roomCodeEl.textContent = `room: ${roomCode}`;
    roomCodeEl.style.display = "block";
    const invite = createJoinScreen("renderer");
    invite.setCode(roomCode);
    roomCodeEl.addEventListener("click", () => {
      invite.show();
      window.setTimeout(() => invite.hide(), 8000);
    });
  }

  wireDeviceMenu();
  const conn = activeConn();
  if (conn) wireRoomControls(conn);

  immersive = createImmersiveMode({
    button: fsBtn,
    isMenuOpen: () => deviceMenu?.isOpen() ?? false,
  });
  fsBtn.addEventListener("click", () => immersive!.toggle());

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  window.addEventListener("keydown", (e) => {
    // Modifier guard so ⌘/Ctrl+F (browser find) and ⌘/Ctrl+S (save page)
    // pass through untouched instead of driving these — mirrors the guard
    // deviceMenu.ts's own document-level handler already uses.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "f" || e.key === "F") immersive?.toggle();
    // Only live in a viz — the exact condition that shows menuBtn itself
    // (enterViz/exitToGallery below), so the key and the gear it mirrors
    // appear and disappear together. Reuses the same toggle() the gear's
    // click handler calls, rather than reimplementing open/close here.
    if ((e.key === "s" || e.key === "S") && inViz) deviceMenu?.toggle();
    if (e.key === "Escape") {
      if (immersive?.active()) {
        immersive.exit();
        return;
      }
      if (inViz && !bypassGallery) navigate({ kind: "gallery" }, "push");
    }
  });
  backBtn.addEventListener("click", () => navigate({ kind: "gallery" }, "push"));
  refreshAudioPromptButtons(); // support never changes mid-session, so this runs once
  audioPromptMicBtn.addEventListener("click", () => void ensureAudio("mic"));
  audioPromptDisplayBtn.addEventListener("click", () => void ensureAudio("display"));

  if (bypassGallery) {
    void enterViz(scene);
  } else {
    gallery = createGallery({
      scenes: () =>
        listScenes().map((s) => {
          const enabled = presetAllows(s, quality.preset);
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
        void ensureAudio(); // fires inside the click, before any await, so the gesture survives
        navigate({ kind: "viz", sceneId: id }, "push");
      },
      onDisabledPick: (id, reason) => showHud(`${id}: ${reason}`, true),
      canCaptureDisplay: () => displayCaptureSupported(),
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
        saveLook(look);
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
        renderScale: quality.renderScale,
        govLevel: governor?.level ?? 0,
      }),
    });
  }

  lastRafMs = performance.now();
  requestAnimationFrame(loop);
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

/** @param rateScale sensitivity.ts's smoothingRateScale(resolveSmoothing(scene.id)),
 *  computed once per tick by loop() and reused for animClock.advance() below
 *  — resolveSmoothing() slews its auto value, so calling it a second time
 *  per tick would double that slew. Forwarded into extractor.update() so a
 *  local capture's own envelope (features.ts) honors the same Smoothing
 *  the render path and the anim clock do, including its Off stop. */
function currentVisual(rateScale: number): FeatureFrame | null {
  if (syntheticFeed) {
    lastRawBands = null;
    // Synthetic frames are generated directly, not sampled from a real
    // signal — there's nothing for the scope to trace, so its card
    // correctly stays hidden here (see audioMeters.ts).
    lastMono = null;
    lastLufs = null;
    lastFixedEnergy = null;
    lastFluxRatio = null;
    return syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000);
  }

  if (mode === "solo") {
    if (!bandAnalyser || !capture) {
      lastRawBands = null;
      lastMono = null;
      lastLufs = null;
      lastFixedEnergy = null;
      lastFluxRatio = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    lastLufs = lufsAnalyser ? lufsAnalyser.read() : null;
    const f = extractor.update(dbBands, now, resolveAutoGain(), rateScale);
    lastFixedEnergy = extractor.fixedEnergy;
    lastFluxRatio = extractor.fluxRatio;
    // Feeds next tick's resolveAutoGain(), not this one's — see
    // feedAutoGainMeasurement's doc comment on why that one-tick lag is fine.
    feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
    return f;
  }

  if (mode === "host") {
    if (!bandAnalyser || !capture || !hostConn) {
      lastRawBands = null;
      lastMono = null;
      lastLufs = null;
      lastFixedEnergy = null;
      lastFluxRatio = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    lastLufs = lufsAnalyser ? lufsAnalyser.read() : null;
    const f = extractor.update(dbBands, now, resolveAutoGain(), rateScale);
    lastFixedEnergy = extractor.fixedEnergy;
    lastFluxRatio = extractor.fluxRatio;
    // Feeds next tick's resolveAutoGain(), not this one's — see
    // feedAutoGainMeasurement's doc comment on why that one-tick lag is fine.
    feedAutoGainMeasurement(extractor.bandSpanDb, extractor.dtSec);
    hostConn.sendFrame(f);
    return sampleToVisual(hostConn.sample());
  }

  // renderer — no local mic, so no raw signal to show.
  lastRawBands = null;
  lastMono = null;
  lastLufs = null;
  lastFixedEnergy = null;
  lastFluxRatio = null;
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
    bpm: s.bpm,
    onsetPhase: s.beatPhase,
    level: s.level,
  };
}

function loop(): void {
  requestAnimationFrame(loop);

  const nowRafMs = performance.now();
  const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
  lastRafMs = nowRafMs;

  // Resolved exactly once per tick and reused everywhere below (extractor,
  // anim clock, the meters) — resolveSmoothing() slews its own auto value
  // via a mutated module-level map (autoTune.ts's `slewed`), so calling it
  // a second time this tick would double-apply that slew.
  const smoothing = resolveSmoothing(scene.id);
  const rateScale = smoothingRateScale(smoothing);

  // Always sampled — in host mode this is also what feeds hostConn.sendFrame,
  // so a paired TV/renderer keeps getting frames even while this device is
  // just sitting on the gallery with nothing on screen.
  lastVis = currentVisual(rateScale);

  if (!inViz) {
    gallery?.tick(nowRafMs);
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
  const gained = lastVis ? applyBandGains(lastVis, getBandGains(scene.id)) : null;

  // Anim clock now advances here, ahead of deviceMenu.update() below — the
  // listening post's transport/bands/section/dial meters (audioMeters.ts)
  // read this tick's AnimFrame, not just the raw FeatureFrame. Only advances
  // when there's a frame to feed it (gained non-null); when it's null (mic
  // still pending) anim stays null too, the same outcome as before this
  // moved (the loop used to return, further down, before ever reaching
  // animClock.advance in that case). Feature extraction and the anim clock
  // itself (beat/flow/band-pulse/section-intensity decay) still run on every
  // rAF tick regardless of the render-rate cap below — only the GPU draw is
  // rate-capped.
  const anim = gained ? animClock.advance(dtSec, gained, smoothing) : null;
  if (anim) {
    lastAnim = anim;
    advanceAutoTune(dtSec, anim.profile);
    // Every tick, whether or not it renders — see renderLatch.ts. A tick
    // that turns out not to render still needs its edges remembered.
    renderLatch.accumulate(anim);
  }

  // Fed even when null (mic permission still pending) so the spectrum strip
  // can render its "waiting for audio" idle state instead of going dead.
  // `rateScale` lets the meters panel (audioMeters.ts) bypass its own BPM
  // settle and waveform peak-hold at Smoothing's Off stop, same as above.
  deviceMenu?.update(gained, lastRawBands, lastVis, pinnedBands(), anim, lastMono, rateScale, lastFixedEnergy, lastLufs, lastFluxRatio);

  if (!lastVis || !anim) return;

  if (!shouldRenderFrame(nowRafMs, lastRenderMs, renderIntervalMs())) return;
  if (lastRenderFpsMs > 0) {
    const renderDtMs = nowRafMs - lastRenderFpsMs;
    if (renderDtMs > 0) lastFps = 1000 / renderDtMs;
  }
  lastRenderFpsMs = nowRafMs;
  lastRenderMs = nowRafMs;

  const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
  if (resized) mainHost!.ctx.gl.viewport(0, 0, canvas.width, canvas.height);

  const displayFrame = applySensitivity(gained!, resolveSensitivity(scene.id), resolveExpansion(scene.id));
  scene.render(mainHost!.ctx, displayFrame, viewport, palette, renderLatch.consume(anim, nowRafMs));
  governor?.recordFrame(nowRafMs);
}

void boot();
