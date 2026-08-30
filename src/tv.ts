import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import { detectQuality, qualitySettings, type QualityPreset, type QualitySettings } from "./render/quality.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type SceneContext, type Viewport } from "./render/scene.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createRoomCode, RendererConnection } from "./net/room.ts";
import { createJoinScreen } from "./ui/joinScreen.ts";

/** No new frame this long -> treat the room as if no host is present and go back to the join screen. */
const STALE_TIMEOUT_MS = 3000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const badge = document.getElementById("badge") as HTMLDivElement;

const PRESET_ORDER: QualityPreset[] = ["floor", "low", "mid", "high"];
const presetAllows = (s: Scene, p: QualityPreset): boolean =>
  !s.minQuality || PRESET_ORDER.indexOf(p) >= PRESET_ORDER.indexOf(s.minQuality);

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
let sceneCtx: SceneContext;

let conn: RendererConnection;
let live = false;
const animClock = createAnimClock();
// See renderLatch.ts / app.ts's own instance: turns anim.dtSec into wall
// time since the last *rendered* frame and keeps a one-shot edge alive
// across ticks the render cap skips.
const renderLatch = createRenderLatch();
let lastRafMs = 0;

// Render-rate cap and its jitter-tolerant gate live in framePace.ts (shared
// with app.ts) — see that file for why the gate needs a tolerance at all.
let lastRenderMs = 0;
let governor: QualityGovernor | null = null;

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, quality.preset));
}

function switchScene(next: Scene): void {
  scene.dispose(sceneCtx);
  scene = next;
  scene.init(sceneCtx);
  conn.sendHello(scene.id, palette.id, viewport);
}

async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — some browsers/contexts deny it; screen may just dim.
  }
}

async function main(): Promise<void> {
  let gl: WebGL2RenderingContext;
  try {
    gl = createGL(canvas);
  } catch (err) {
    console.error(err);
    badge.textContent = "WebGL2 unsupported on this TV";
    badge.style.display = "block";
    return;
  }

  quality = qualitySettings(await detectQuality());
  sceneCtx = { gl, quality };
  if (!presetAllows(scene, quality.preset)) scene = availableScenes()[0] ?? scene;
  governor = createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  scene.init(sceneCtx);

  const code = await createRoomCode();
  conn = new RendererConnection(code);
  conn.onCommand((cmd) => {
    if (cmd.scene) {
      const s = getScene(cmd.scene);
      if (s && presetAllows(s, quality.preset)) switchScene(s);
    }
    if (cmd.palette) palette = getPalette(cmd.palette);
    if (cmd.viewport) viewport = cmd.viewport;
  });

  const join = createJoinScreen("host");
  join.setCode(code);
  join.show();

  badge.textContent = code;
  badge.style.display = "block";

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  lastRafMs = performance.now();

  function loop(): void {
    requestAnimationFrame(loop);

    const nowRafMs = performance.now();
    const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
    lastRafMs = nowRafMs;

    const s = conn.sample();
    const hasFreshData = s !== null && conn.msSinceLastFrame < STALE_TIMEOUT_MS;

    if (hasFreshData && !live) {
      live = true;
      join.hide();
      conn.sendHello(scene.id, palette.id, viewport);
    } else if (!hasFreshData && live) {
      live = false;
      join.show();
    }

    if (!live || !s) return;

    const frame = {
      time: s.timeSec,
      bands: s.bands,
      energy: s.energy,
      onset: s.onsetFired,
      bpm: s.bpm,
      onsetPhase: s.beatPhase,
      level: s.level,
    };

    // Only the GPU draw is rate-capped — sampling and the anim clock's
    // decay above stay on every rAF tick.
    const anim = animClock.advance(dtSec, frame);
    advanceAutoTune(dtSec, anim.profile);
    renderLatch.accumulate(anim);

    if (!shouldRenderFrame(nowRafMs, lastRenderMs, targetFrameIntervalMs(quality.preset))) return;
    lastRenderMs = nowRafMs;

    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    scene.render(sceneCtx, frame, viewport, palette, renderLatch.consume(anim, nowRafMs));
    governor?.recordFrame(nowRafMs);
  }

  requestAnimationFrame(loop);
}

void main();
