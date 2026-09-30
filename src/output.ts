// Must stay the first import: installs the output's private localStorage
// before any store module seeds its cache (net/outputStorage.ts).
import { outputStorage } from "./net/outputStorage.ts";
import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import { detectQuality, parseQualityPreset, qualitySettings, type QualityPreset, type QualitySettings } from "./render/quality.ts";
import { getScene, FULL_VIEWPORT, type Scene, type SceneContext } from "./render/scene.ts";
import { getQualityChoice } from "./render/qualityPref.ts";
import { createSceneHost, type SceneHost } from "./render/sceneHost.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createDriveEngine } from "./render/drives.ts";
import { getSilenceGate } from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import { applySensitivity } from "./audio/sensitivity.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { createBroadcastTransport } from "./net/outputBridge.ts";
import { createGlide, type Glide } from "./net/outputGlide.ts";
import { createFrameInbox, type OutputState, type ToMain, type ToOutput } from "./net/outputSync.ts";
import { applySyncedStorage } from "./net/syncedStores.ts";

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
/** The output announces itself this often (the main window's presence check). */
const HEARTBEAT_MS = 1000;
const CURSOR_IDLE_MS = 2000;
const HINT_MS = 6000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;

const PRESET_ORDER: QualityPreset[] = ["floor", "low", "mid", "high"];
const presetAllows = (s: Scene, p: QualityPreset): boolean =>
  !s.minQuality || PRESET_ORDER.indexOf(p) >= PRESET_ORDER.indexOf(s.minQuality);

const transport = createBroadcastTransport<ToMain, ToOutput>();
const inbox = createFrameInbox();
let haveState = false;

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

async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — the screen may just dim.
  }
}
void requestWakeLock();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void requestWakeLock();
});

window.setInterval(hello, HEARTBEAT_MS);
window.addEventListener("pagehide", () => transport.post({ t: "bye" }));

pinEverything();

// ---- Rendering ----

let quality: QualitySettings = qualitySettings("mid");
/** What detectQuality() found on this window; used only while the main
 *  window's Quality choice (render/qualityPref.ts, mirrored in) is Auto. */
let detectedPreset: QualityPreset = "mid";
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
  const { state, done } = glide.at(nowMs);
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

function applyState(state: OutputState): void {
  current = state;
  // Stores first, so a scene's init() and first render already see the
  // settings that go with it.
  applySyncedStorage(state.storage, outputStorage);
  inbox.setParams(state.params);
  palette = getPalette(state.palette);

  // Same rule as app.ts's effectivePreset(): the main window's Quality
  // choice wins, Auto falls back to this window's own benchmark. `quality`
  // is mutated in place — the host's context and the governor hold it.
  const choice = getQualityChoice();
  const preset = choice === "auto" ? detectedPreset : choice;
  const qualityChanged = preset !== quality.preset;
  if (qualityChanged) {
    Object.assign(quality, qualitySettings(preset));
    governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  }

  const next = getScene(state.scene);
  if (next && presetAllows(next, quality.preset) && (next !== scene || qualityChanged)) {
    // A quality change re-inits the scene too: geometry is sized at init.
    host.unmountAll();
    host.mount(next);
    scene = next;
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
  const devPin = import.meta.env.DEV ? parseQualityPreset(new URLSearchParams(location.search)) : null;
  pinned = devPin !== null;
  detectedPreset = devPin ?? (await detectQuality());
  quality = qualitySettings(detectedPreset);
  governor = pinned ? null : createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  host = createSceneHost(gl, quality);
  sceneCtx = host.ctx;
  hello();

  lastRafMs = performance.now();

  function loop(): void {
    requestAnimationFrame(loop);

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
    const anim = animClock.advance(dtSec, frame, p.smoothing, getSilenceGate(), {
      shape: getHitShape(),
      beatRatio: frame.beatRatio,
      wavePeak: frame.wavePeak,
    });
    advanceAutoTune(dtSec, anim.profile);
    renderLatch.accumulate(anim);
    const displayFrame = applySensitivity(frame, p.sens, p.exp);
    driveEngine.accumulate(dtSec, frame, displayFrame.energy, anim, scene.id, scene.settings ?? []);

    if (!shouldRenderFrame(nowMs, lastRenderMs, targetFrameIntervalMs(quality.preset))) return;
    lastRenderMs = nowMs;

    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    const latchedAnim = renderLatch.consume(anim, nowMs);
    const drives = driveEngine.forScene(scene.id, scene.settings ?? [], latchedAnim);
    scene.render(sceneCtx, displayFrame, FULL_VIEWPORT, palette, latchedAnim, drives);
    governor?.recordFrame(nowMs);
  }

  requestAnimationFrame(loop);
}

void main();
