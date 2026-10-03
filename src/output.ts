// Must stay the first import: installs the output's private localStorage
// before any store module seeds its cache (net/outputStorage.ts).
import { outputStorage } from "./net/outputStorage.ts";
import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize, watchContextLoss } from "./render/gl.ts";
import { detectQuality, parseQualityPreset, presetAllows, qualitySettings, type QualityPreset, type QualitySettings } from "./render/quality.ts";
import { getScene, FULL_VIEWPORT, type Scene, type SceneContext } from "./render/scene.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { RENDER_FPS_CAP_FLOOR, nextRenderAnchor, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createDriveEngine } from "./render/drives.ts";
import { getSilenceGate } from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import { applySensitivity } from "./audio/sensitivity.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { createBroadcastTransport } from "./net/outputBridge.ts";
import { createGlide, type Glide } from "./net/outputGlide.ts";
import { createFrameInbox, type OutputPower, type OutputState, type ToMain, type ToOutput } from "./net/outputSync.ts";
import { clampResolution, RESOLUTION_DEFAULT } from "./render/outputPower.ts";
import { applySyncedStorage } from "./net/syncedStores.ts";
import { requestWakeLock } from "./ui/wakeLock.ts";

/**
 * The pop-out output page (output.html): the main window's scene on its own
 * window, full-bleed and chrome-free, for a second screen or projector. A
 * renderer in src/tv.ts's mould — same scene, anim clock, drive engine and
 * render cap — fed by net/outputSync.ts messages from the main window
 * instead of the room socket, so it needs no server. The message layer (what
 * crosses, why tv.ts itself couldn't be reused, Cue/Go) is that file's
 * header; the output's settings never touch the real localStorage
 * (net/outputStorage.ts).
 *
 * Audio stays in the main window. With no frames for STALE_MS (main window
 * reloading, closed, or throttled) the output goes quietly black rather
 * than showing text, and picks up again by itself when frames resume.
 */

/** No frame this long -> black. Long enough to ride out a main-window hiccup. */
const STALE_MS = 5000;
/** How often the render readouts go to the main window's Output Power card. */
const STATUS_MS = 500;
/** The output announces itself this often (the main window's presence check). */
const HEARTBEAT_MS = 1000;
const CURSOR_IDLE_MS = 2000;
const HINT_MS = 6000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;

const transport = createBroadcastTransport<ToMain, ToOutput>();
const inbox = createFrameInbox();
let haveState = false;
/** Where the output parks the look it is showing across its own context-loss
 *  reload (main()'s watchContextLoss), so the main window's held program
 *  survives instead of the reloaded page being sent the editable preview. */
const RESTORE_KEY = "svl-output-restore";
let contextLost = false;
let reloading = false;

function hello(): void {
  transport.post({ t: "hello", haveState });
}

// ---- Window behaviour: fullscreen, idle cursor, hint, wake lock ----

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}
window.addEventListener("dblclick", toggleFullscreen);
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "f" || e.key === "F") toggleFullscreen();
});

let cursorTimer = 0;
function wakeCursor(): void {
  document.body.classList.remove("idle");
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => document.body.classList.add("idle"), CURSOR_IDLE_MS);
}
window.addEventListener("pointermove", wakeCursor);
wakeCursor();

const hint = document.getElementById("hint");
window.setTimeout(() => hint?.classList.add("gone"), HINT_MS);

void requestWakeLock();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void requestWakeLock();
});

window.setInterval(hello, HEARTBEAT_MS);
// Skipped when this page is reloading itself after a GPU context loss (below):
// the main window must keep seeing an output that is merely blinking, with its
// Cue/Play program intact, rather than one that was closed.
window.addEventListener("pagehide", () => {
  if (!reloading) transport.post({ t: "bye" });
});

pinEverything();

// ---- Rendering ----

let quality: QualitySettings = qualitySettings("mid");
/** What detectQuality() found on this window; used only while the output's
 *  Quality choice is Auto (or a dev pin, which stands in for it). */
let detectedPreset: QualityPreset = "mid";
/** The output's own Quality, Energy saving and Resolution (render/outputPower.ts),
 *  as the main window's Output Power card last sent them. The defaults are the
 *  stores' own, for the moment before the first `power` message arrives. */
let power: OutputPower = { quality: "high", mode: "off", resolution: RESOLUTION_DEFAULT };
/** A dev pin wins over the choice so headless `?quality=` captures stay
 *  reproducible; otherwise Auto falls back to this window's benchmark. */
const resolvePreset = (): QualityPreset => (pinned || power.quality === "auto" ? detectedPreset : power.quality);
/** The dev `?quality=` pin the main window passes along (net/outputBridge.ts's
 *  open()): like app.ts, a pinned preset means no governor. */
let pinned = false;
let host: SceneHost;
let sceneCtx: SceneContext;
let scene: Scene | null = null;
let palette: Palette = getPalette("neon");
const animClock = createAnimClock();
const renderLatch = createRenderLatch();
const driveEngine = createDriveEngine();
let governor: QualityGovernor | null = null;
let lastRafMs = 0;
let lastRenderMs = 0;
let lastRenderFpsMs = 0;
let lastFps = 0;
let blank = false;
/** The look the output is showing right now (a glide's half-way step
 *  included) — what the next glide starts from. */
let current: OutputState | null = null;
/** A smooth arrival in progress (net/outputGlide.ts). Any state message
 *  without `glideMs` ends it by jumping straight to that look. */
let glide: Glide | null = null;

/** One step of a glide: stores and params only — scene, palette and quality
 *  are exactly as they were until the glide lands through applyState(). */
function stepGlide(nowMs: number): void {
  if (!glide) return;
  const { state, done } = glide.lookAt(nowMs);
  if (done) {
    glide = null;
    applyState(state);
    return;
  }
  // `current` follows the half-way look too, so a second Play pressed
  // mid-glide starts from where the picture is, not from where it left.
  current = state;
  applySyncedStorage(state.storage, outputStorage);
  inbox.setParams(state.params);
}

/** Brings `quality` and the governor in line with the output's own choice.
 *  `quality` is mutated in place — the host's context and the governor hold
 *  it. Returns whether the preset changed, which the caller answers by
 *  remounting the scene (geometry is sized at init). */
function syncQuality(): boolean {
  const preset = resolvePreset();
  const changed = preset !== quality.preset;
  if (changed) {
    Object.assign(quality, qualitySettings(preset));
    governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  }
  governor?.setEnabled(power.mode === "auto");
  return changed;
}

/** A `power` message: re-resolve, and re-init the current scene if the preset moved. */
function applyQuality(): void {
  if (syncQuality() && scene && presetAllows(scene, quality.preset)) mountScene(scene);
}

/** Puts `next` on the host. If its init() throws (a shader this GPU won't
 *  compile, a missing float target) the output carries on with the scene it
 *  had, or goes black when there is none or it is `next` itself being
 *  re-initialised: never a half-built scene whose render() throws every frame. */
function mountScene(next: Scene): void {
  const prev = scene;
  host.unmountAll();
  try {
    host.mount(next);
    scene = next;
    return;
  } catch (err) {
    console.error(`Output: "${next.name}" failed to start:`, err);
  }
  scene = null;
  if (!prev || prev === next) return;
  try {
    host.mount(prev);
    scene = prev;
  } catch (err) {
    console.error(`Output: "${prev.name}" failed to restart:`, err);
  }
}

function applyState(state: OutputState): void {
  current = state;
  // Stores first, so a scene's init() and first render already see the
  // settings that go with it.
  applySyncedStorage(state.storage, outputStorage);
  inbox.setParams(state.params);
  palette = getPalette(state.palette);

  const qualityChanged = syncQuality();

  const next = getScene(state.scene);
  if (next && presetAllows(next, quality.preset) && (next !== scene || qualityChanged)) {
    // A quality change re-inits the scene too: geometry is sized at init.
    mountScene(next);
  }
  haveState = true;
}

transport.onMessage((m) => {
  if (m.t === "state") {
    // Frames and states can arrive before the GL context is up (detectQuality
    // runs first); the main window re-sends on the next heartbeat.
    if (host) {
      const started =
        m.glideMs && current && scene ? createGlide(current, m.state, scene.settings ?? [], performance.now(), m.glideMs) : null;
      if (started) glide = started;
      else {
        glide = null;
        applyState(m.state);
      }
    }
  } else if (m.t === "frame") {
    // While a glide runs it owns Sensitivity/Expansion/Smoothing: the
    // frame's own copy (only sent while following) must not yank them.
    if (glide && m.f.p) {
      const { p: _held, ...rest } = m.f;
      inbox.push(rest, performance.now());
    } else inbox.push(m.f, performance.now());
  } else if (m.t === "power") {
    power = m.power;
    if (host) applyQuality();
  }
});

async function main(): Promise<void> {
  let gl: WebGL2RenderingContext;
  try {
    gl = createGL(canvas);
  } catch (err) {
    console.error(err);
    return;
  }
  // See gl.ts's watchContextLoss(): the loop idles while the context is gone,
  // and on restore the page reloads, with the current look parked for itself.
  watchContextLoss(
    canvas,
    () => {
      contextLost = true;
    },
    () => {
      try {
        if (current) sessionStorage.setItem(RESTORE_KEY, JSON.stringify(current));
      } catch {
        // Storage blocked: the main window re-sends its preview instead.
      }
      reloading = true;
      location.reload();
    },
  );
  const devPin = import.meta.env.DEV ? parseQualityPreset(new URLSearchParams(location.search)) : null;
  pinned = devPin !== null;
  detectedPreset = devPin ?? (await detectQuality());
  quality = qualitySettings(resolvePreset());
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  governor?.setEnabled(power.mode === "auto");
  host = createSceneHost(gl, quality);
  sceneCtx = host.ctx;
  // Back from a context-loss reload: take the parked look first, so the very
  // first hello says haveState and the main window keeps its program.
  try {
    const raw = sessionStorage.getItem(RESTORE_KEY);
    sessionStorage.removeItem(RESTORE_KEY);
    const parked = raw ? (JSON.parse(raw) as Partial<OutputState>) : null;
    if (parked && typeof parked.scene === "string" && typeof parked.palette === "string" && parked.storage && parked.params) {
      applyState(parked as OutputState);
    }
  } catch (err) {
    console.error("Output: couldn't restore the look after a graphics reset:", err);
  }
  hello();
  window.setInterval(() => {
    transport.post({
      t: "status",
      s: {
        preset: quality.preset,
        recommended: detectedPreset,
        fps: lastFps,
        level: governor?.level ?? null,
        maxLevel: governor?.maxLevel ?? 0,
        fraction: governor?.fraction ?? 1,
        standingDown: governor?.standingDown ?? false,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      },
    });
  }, STATUS_MS);

  lastRafMs = performance.now();

  function loop(): void {
    requestAnimationFrame(loop);
    if (contextLost) return;

    const nowMs = performance.now();
    const dtSec = Math.max(1e-4, (nowMs - lastRafMs) / 1000);
    lastRafMs = nowMs;

    stepGlide(nowMs);
    const frame = inbox.take();
    if (!scene || !haveState || !frame || inbox.ageMs(nowMs) > STALE_MS) {
      if (!blank && sceneCtx) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        blank = true;
      }
      return;
    }
    blank = false;

    const p = inbox.params();
    // The controller's resolved marks (its Auto room-floor tracker moves them,
    // and nothing in this window feeds that tracker); this window's own stored
    // marks only stand in for a controller that doesn't send any.
    const anim = animClock.advance(dtSec, frame, p.smoothing, frame.gate ?? getSilenceGate(), {
      shape: getHitShape(),
      beatRatio: frame.beatRatio,
      wavePeak: frame.wavePeak,
    });
    advanceAutoTune(dtSec, anim.profile);
    renderLatch.accumulate(anim);
    const displayFrame = applySensitivity(frame, p.sens, p.exp);
    driveEngine.accumulate(dtSec, frame, displayFrame.energy, anim, scene.id, scene.settings ?? []);

    const interval = power.mode === "on" ? 1000 / RENDER_FPS_CAP_FLOOR : targetFrameIntervalMs(quality.preset);
    if (!shouldRenderFrame(nowMs, lastRenderMs, interval)) return;
    if (lastRenderFpsMs > 0 && nowMs > lastRenderFpsMs) lastFps = 1000 / (nowMs - lastRenderFpsMs);
    lastRenderFpsMs = nowMs;
    lastRenderMs = nextRenderAnchor(nowMs, lastRenderMs, interval);

    // Resolution multiplies the quality's scale (governor steps included), so
    // it takes effect on this very resize — no remount, unlike a Quality change.
    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale * clampResolution(power.resolution));
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    const latchedAnim = renderLatch.consume(anim, nowMs);
    const drives = driveEngine.forScene(scene.id, scene.settings ?? [], latchedAnim);
    scene.render(sceneCtx, displayFrame, FULL_VIEWPORT, palette, latchedAnim, drives);
    governor?.recordFrame(nowMs);
  }

  requestAnimationFrame(loop);
}

void main();
