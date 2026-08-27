import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import { detectTier, tierSettings, type Tier, type TierSettings } from "./render/tier.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type SceneContext, type Viewport } from "./render/scene.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { advanceAutoTune } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { createRoomCode, RendererConnection } from "./net/room.ts";
import { createJoinScreen } from "./ui/joinScreen.ts";

/** No new frame this long -> treat the room as if no host is present and go back to the join screen. */
const STALE_TIMEOUT_MS = 3000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const badge = document.getElementById("badge") as HTMLDivElement;

const TIER_ORDER: Tier[] = ["floor", "low", "mid", "high"];
const tierAllows = (s: Scene, t: Tier): boolean =>
  !s.minTier || TIER_ORDER.indexOf(t) >= TIER_ORDER.indexOf(s.minTier);

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let tier: TierSettings = tierSettings("mid");
let sceneCtx: SceneContext;

let conn: RendererConnection;
let live = false;
const animClock = createAnimClock();
let lastRafMs = 0;

/** See app.ts's identical comment — caps scene.render()'s rate independently
 *  of rAF; a TV panel gets no benefit from raymarching faster than it can
 *  actually update. */
const RENDER_FPS_CAP = 60;
const RENDER_FPS_CAP_FLOOR = 30;
let lastRenderMs = 0;
let governor: QualityGovernor | null = null;

function targetFrameIntervalMs(): number {
  return 1000 / (tier.tier === "floor" ? RENDER_FPS_CAP_FLOOR : RENDER_FPS_CAP);
}

function availableScenes(): Scene[] {
  return listScenes().filter((s) => tierAllows(s, tier.tier));
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

  tier = tierSettings(await detectTier());
  sceneCtx = { gl, tier };
  if (!tierAllows(scene, tier.tier)) scene = availableScenes()[0] ?? scene;
  governor = createQualityGovernor(tier, targetFrameIntervalMs());
  scene.init(sceneCtx);

  const code = await createRoomCode();
  conn = new RendererConnection(code);
  conn.onCommand((cmd) => {
    if (cmd.scene) {
      const s = getScene(cmd.scene);
      if (s && tierAllows(s, tier.tier)) switchScene(s);
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
      beat: s.beatFired,
      bpm: s.bpm,
      beatPhase: s.beatPhase,
      level: s.level,
    };

    // Only the GPU draw is rate-capped — sampling and the anim clock's
    // decay above stay on every rAF tick.
    const anim = animClock.advance(dtSec, frame);
    advanceAutoTune(dtSec, anim.profile);

    if (nowRafMs - lastRenderMs < targetFrameIntervalMs()) return;
    lastRenderMs = nowRafMs;

    const resized = resizeCanvasToDisplaySize(canvas, tier.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    scene.render(sceneCtx, frame, viewport, palette, anim);
    governor?.recordFrame(nowRafMs);
  }

  requestAnimationFrame(loop);
}

void main();
