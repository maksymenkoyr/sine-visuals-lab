import { DRAFT_SCENE_IDS } from "./render/scenes/index.ts"; // also registers built-in scenes (side effect)
import { captureMic, captureDisplayAudio } from "./audio/capture.ts";
import { createBandAnalyser, type BandAnalyser } from "./audio/analyser.ts";
import { createWaveformAnalyser, type WaveformAnalyser } from "./audio/waveformAnalyser.ts";
import { FeatureExtractor } from "./audio/features.ts";
import { NUM_BANDS, type CaptureHandle, type FeatureFrame } from "./audio/types.ts";
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import { detectTier, parseTier, tierSettings, type Tier, type TierSettings } from "./render/tier.ts";
import { shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type Viewport } from "./render/scene.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { getPalette, PALETTES, type Palette } from "./render/palette.ts";
import {
  applySensitivity,
  getAcceleration,
  getSensitivity,
  getSmoothing,
  setAcceleration,
  setSensitivity,
  setSmoothing,
} from "./audio/sensitivity.ts";
import { createAnimClock, type AnimFrame } from "./render/animClock.ts";
import { createSyntheticFeed, type SyntheticFeed } from "./audio/synthetic.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { getSceneSetting, resetSceneSettings, setSceneSetting } from "./render/sceneSettings.ts";
import { getBandSplit } from "./audio/bandSplit.ts";
import { isAutoGainEnabled, setAutoGainEnabled } from "./audio/autoGain.ts";
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
  resolveAcceleration,
  resolveSmoothing,
  getSensitivitySpec,
  getAccelerationSpec,
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
import { createDeviceMenu, type DeviceMenu } from "./ui/deviceMenu.ts";
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
const micPrompt = document.getElementById("micPrompt") as HTMLButtonElement;

const TIER_ORDER: Tier[] = ["floor", "low", "mid", "high"];
/** No new frame in this long -> the host is gone even if our own socket to the relay is still open. */
const STALE_TIMEOUT_MS = 3000;
const tierAllows = (s: Scene, t: Tier): boolean =>
  !s.minTier || TIER_ORDER.indexOf(t) >= TIER_ORDER.indexOf(s.minTier);

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
const extractor = new FeatureExtractor();
/** Set on first mic/display-capture attempt; cached so re-entering a viz
 *  never re-prompts. Cleared back to null on failure so a retry is possible. */
let audioPromise: Promise<void> | null = null;
let micDenied = false;
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
let tier: TierSettings = tierSettings("mid");
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
const rawBandsScratch = new Float32Array(NUM_BANDS);

const animClock = createAnimClock();
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

/** Closed-loop counterpart to detectTier()'s one-shot boot benchmark — steps
 *  the shared `tier` object's numeric knobs down under sustained load
 *  (thermal throttling) and back up once comfortable. Created once tier is
 *  known, in boot(). */
let governor: QualityGovernor | null = null;

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
  return listScenes().filter((s) => tierAllows(s, tier.tier));
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

async function chooseCapture(): Promise<CaptureHandle> {
  const params = new URLSearchParams(location.search);
  if (params.get("source") === "display") return captureDisplayAudio();
  return captureMic();
}

/** Idempotent and never torn down: capture/bandAnalyser are created once, on
 *  first viz entry, and kept alive across trips back to the gallery — that's
 *  what lets the room code and any TV pairing survive browsing the gallery. */
function ensureAudio(): Promise<void> {
  if (syntheticFeed) return Promise.resolve();
  if (audioPromise) return audioPromise;
  const attempt = (async () => {
    capture = await chooseCapture();
    bandAnalyser = createBandAnalyser(capture.context, capture.sourceNode);
    waveformAnalyser = createWaveformAnalyser(capture.context, capture.sourceNode);
    micDenied = false;
  })();
  audioPromise = attempt.catch((err) => {
    console.error(err);
    micDenied = true;
    audioPromise = null;
    gallery?.setError("Microphone permission denied — tap a tile to retry.");
  });
  audioPromise.then(updateMicPrompt);
  return audioPromise;
}

function updateMicPrompt(): void {
  // Hidden while a fresh attempt is in flight (audioPromise set but not yet
  // settled) so we don't double-prompt; shown before any attempt or after
  // one has failed.
  const needsMic = inViz && mode !== "renderer" && !syntheticFeed && !bandAnalyser && (micDenied || !audioPromise);
  micPrompt.style.display = needsMic ? "block" : "none";
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
    capture = await chooseCapture();
    bandAnalyser = createBandAnalyser(capture.context, capture.sourceNode);
    waveformAnalyser = createWaveformAnalyser(capture.context, capture.sourceNode);
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
      source: syntheticFeed ? "synthetic" : mode === "renderer" ? "remote" : bandAnalyser ? "mic" : "none",
      sampleRate: capture?.context.sampleRate ?? null,
    }),
    onPickPalette: (id) => applyPalette(getPalette(id)),
    getSensitivity: (sceneId) => getSensitivity(sceneId),
    onSensitivityChange: (sceneId, value) => {
      setAutoEnabled(sceneId, getSensitivitySpec().key, false);
      setSensitivity(sceneId, value);
    },
    getAcceleration: (sceneId) => getAcceleration(sceneId),
    onAccelerationChange: (sceneId, value) => {
      setAutoEnabled(sceneId, getAccelerationSpec().key, false);
      setAcceleration(sceneId, value);
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
    getBandSplit: () => getBandSplit(),
    getBandEdgesHz: () => bandAnalyser?.bandEdgesHz ?? nominalBandEdgesHz(),
    getBandGain: (sceneId, fader) => getBandGain(sceneId, fader),
    onBandGainChange: (sceneId, fader, value) => setBandGain(sceneId, fader, value),
    onBandGainsReset: (sceneId) => resetBandGains(sceneId),
    resolveSceneSettingValue: (sceneId, spec) => resolveSceneSetting(sceneId, spec),
    resolveSensitivityValue: (sceneId) => resolveSensitivity(sceneId),
    resolveAccelerationValue: (sceneId) => resolveAcceleration(sceneId),
    resolveSmoothingValue: (sceneId) => resolveSmoothing(sceneId),
    getSensitivitySpec: () => getSensitivitySpec(),
    getAccelerationSpec: () => getAccelerationSpec(),
    getSmoothingSpec: () => getSmoothingSpec(),
    isSettingAutoEnabled: (sceneId, key) => isAutoEnabled(sceneId, key),
    onSettingAutoToggle: (sceneId, spec, on) => {
      if (on) {
        // Pseudo-params (Sensitivity/Acceleration/Smoothing) live in their
        // own store rather than sceneSettings.ts — this map picks the right
        // manual-value getter by key, falling back to a real scene setting.
        const pseudoGetters: Record<string, (sceneId: string) => number> = {
          [getSensitivitySpec().key]: getSensitivity,
          [getAccelerationSpec().key]: getAcceleration,
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
        getAccelerationSpec(),
        getSmoothingSpec(),
      ]),
    onSceneAutoToggle: (sceneId, on) =>
      setSceneAuto(
        sceneId,
        [...(getScene(sceneId)?.settings ?? []), getSensitivitySpec(), getAccelerationSpec(), getSmoothingSpec()],
        on,
      ),
    getAutoStrength: () => getAutoStrength(),
    onAutoStrengthChange: (value) => setAutoStrength(value),
    getAutoGainEnabled: () => isAutoGainEnabled(),
    onAutoGainChange: (value) => setAutoGainEnabled(value),
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
      if (s && tierAllows(s, tier.tier)) {
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

  showHud(`${mode}${roomCode ? ` (${roomCode})` : ""}  tier: ${tier.tier}  scene: ${scene.name}  palette: ${palette.name}`);
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
  micPrompt.style.display = "none";
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
  if (!s || !tierAllows(s, tier.tier)) {
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

  // `?tier=` (dev-only) lets a headless capture tool force a specific tier
  // instead of running detectTier()'s benchmark — SwiftShader (what
  // tools/tune-sheet.mjs runs on) is genuinely slow, so an unpinned capture
  // self-detects "low"/"floor" and renders at a fraction of the resolution
  // and octave count real hardware gets, making any contact sheet measure
  // the wrong thing. Pinning also skips the governor entirely: a fixed
  // tier is for reproducible capture, not for exercising the closed-loop
  // stepper (that's what the unpinned path and tests/governor.test.ts are for).
  const pinnedTier = import.meta.env.DEV ? parseTier(params.get("tier")) : null;
  tier = tierSettings(pinnedTier ?? (await detectTier()));
  mainHost = createSceneHost(gl, tier);
  if (!tierAllows(scene, tier.tier)) scene = availableScenes()[0] ?? scene;
  governor = pinnedTier ? null : createQualityGovernor(tier, targetFrameIntervalMs(tier.tier));

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
    if (e.key === "f" || e.key === "F") immersive?.toggle();
    if (e.key === "Escape") {
      if (immersive?.active()) {
        immersive.exit();
        return;
      }
      if (inViz && !bypassGallery) navigate({ kind: "gallery" }, "push");
    }
  });
  backBtn.addEventListener("click", () => navigate({ kind: "gallery" }, "push"));
  micPrompt.addEventListener("click", () => void ensureAudio());

  if (bypassGallery) {
    void enterViz(scene);
  } else {
    gallery = createGallery({
      scenes: () =>
        listScenes().map((s) => {
          const enabled = tierAllows(s, tier.tier);
          return {
            scene: s,
            enabled,
            draft: DRAFT_SCENE_IDS.has(s.id),
            reason: enabled ? undefined : "Needs a faster device",
          };
        }),
      tier: () => tier,
      liveFrame: () => lastVis,
      onPick: (id) => {
        void ensureAudio(); // fires inside the click, before any await, so the gesture survives
        navigate({ kind: "viz", sceneId: id }, "push");
      },
      onDisabledPick: (id, reason) => showHud(`${id}: ${reason}`, true),
    });
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
        tier: tier.tier,
        fps: lastFps,
        vis: lastVis,
        anim: lastAnim,
        renderScale: tier.renderScale,
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

function currentVisual(): FeatureFrame | null {
  if (syntheticFeed) {
    lastRawBands = null;
    // Synthetic frames are generated directly, not sampled from a real
    // signal — there's nothing for the scope to trace, so its card
    // correctly stays hidden here (see audioMeters.ts).
    lastMono = null;
    return syntheticFeed.frame((performance.now() - syntheticStartMs) / 1000);
  }

  if (mode === "solo") {
    if (!bandAnalyser || !capture) {
      lastRawBands = null;
      lastMono = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    return extractor.update(dbBands, now, isAutoGainEnabled());
  }

  if (mode === "host") {
    if (!bandAnalyser || !capture || !hostConn) {
      lastRawBands = null;
      lastMono = null;
      return null;
    }
    const now = capture.context.currentTime;
    const dbBands = bandAnalyser.readBandsDb();
    lastRawBands = captureRawBands(dbBands, bandAnalyser.dbRange);
    lastMono = waveformAnalyser ? waveformAnalyser.read() : null;
    const f = extractor.update(dbBands, now, isAutoGainEnabled());
    hostConn.sendFrame(f);
    return sampleToVisual(hostConn.sample());
  }

  // renderer — no local mic, so no raw signal to show.
  lastRawBands = null;
  lastMono = null;
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
    beat: s.beatFired,
    bpm: s.bpm,
    beatPhase: s.beatPhase,
    level: s.level,
  };
}

function loop(): void {
  requestAnimationFrame(loop);

  const nowRafMs = performance.now();
  const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
  lastRafMs = nowRafMs;

  // Always sampled — in host mode this is also what feeds hostConn.sendFrame,
  // so a paired TV/renderer keeps getting frames even while this device is
  // just sitting on the gallery with nothing on screen.
  lastVis = currentVisual();

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
  const anim = gained ? animClock.advance(dtSec, gained, resolveSmoothing(scene.id)) : null;
  if (anim) {
    lastAnim = anim;
    advanceAutoTune(dtSec, anim.profile);
  }

  // Fed even when null (mic permission still pending) so the spectrum strip
  // can render its "waiting for audio" idle state instead of going dead.
  deviceMenu?.update(gained, lastRawBands, lastVis, pinnedBands(), anim, lastMono);

  if (!lastVis || !anim) return;

  if (!shouldRenderFrame(nowRafMs, lastRenderMs, targetFrameIntervalMs(tier.tier))) return;
  if (lastRenderFpsMs > 0) {
    const renderDtMs = nowRafMs - lastRenderFpsMs;
    if (renderDtMs > 0) lastFps = 1000 / renderDtMs;
  }
  lastRenderFpsMs = nowRafMs;
  lastRenderMs = nowRafMs;

  const resized = resizeCanvasToDisplaySize(canvas, tier.renderScale);
  if (resized) mainHost!.ctx.gl.viewport(0, 0, canvas.width, canvas.height);

  const displayFrame = applySensitivity(gained!, resolveSensitivity(scene.id), resolveAcceleration(scene.id));
  scene.render(mainHost!.ctx, displayFrame, viewport, palette, anim);
  governor?.recordFrame(nowRafMs);
}

void boot();
