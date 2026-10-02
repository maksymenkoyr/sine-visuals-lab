import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize, watchContextLoss } from "./render/gl.ts";
import { detectQuality, presetAllows, qualitySettings, type QualitySettings } from "./render/quality.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type SceneContext, type Viewport } from "./render/scene.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { nextRenderAnchor, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createRoomCode, RendererConnection } from "./net/room.ts";
import { roomCodeFromParam } from "./net/roomCode.ts";
import { createJoinScreen } from "./ui/joinScreen.ts";
import { SOURCE_URL } from "./brand.ts";
import { BUILD_INFO, versionHint, versionLabel } from "./version.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { requestWakeLock } from "./ui/wakeLock.ts";
import { getSilenceGate } from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import { createDriveEngine } from "./render/drives.ts";

/** No new frame this long -> treat the room as if no host is present and go back to the join screen. */
const STALE_TIMEOUT_MS = 3000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const badge = document.getElementById("badge") as HTMLDivElement;

// The AGPL §13 network-source offer — see src/brand.ts. Same visual language
// as #badge (tv.html), opposite corner, dimmer: present but not competing
// with the visualization. Carries the version label too (src/version.ts) —
// this corner is the TV's only chrome, so it doubles as the version corner
// the gallery footer (src/ui/gallery.ts) shows on the phone/laptop entry.
const sourceLink = document.createElement("a");
sourceLink.textContent = `Source (AGPL-3.0) · ${versionLabel(BUILD_INFO)}`;
sourceLink.title = versionHint(BUILD_INFO).join("\n");
sourceLink.href = SOURCE_URL;
sourceLink.target = "_blank";
sourceLink.rel = "noopener";
sourceLink.style.cssText = `
  position: fixed; bottom: 16px; left: 16px; z-index: 5;
  color: #fff6; font: 600 12px/1.4 ui-monospace, monospace;
  letter-spacing: 0.05em; background: #0008; padding: 4px 10px;
  border-radius: 999px; text-decoration: none;
`;
document.body.appendChild(sourceLink);

// Fetches every pinned asset (src/pinnedAssets.ts — the same registry
// app.ts's own call warms) after load, at idle, so a TV left open across a
// deploy doesn't 404 the first time something it's already holding onto
// (the Dancers clip library, the tempo worklet, a panel font) is needed.
pinEverything();

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
let sceneCtx: SceneContext;

let conn: RendererConnection;
let live = false;
/** True from the canvas's `webglcontextlost` until the page reloads on the
 *  restore (main()'s watchContextLoss): the loop draws nothing meanwhile. */
let glLost = false;
/** The room this TV is showing, once it has one — what a context-loss reload
 *  rejoins instead of minting a new code the phone has never heard of. */
let roomCodeNow: string | null = null;
const animClock = createAnimClock();
// See renderLatch.ts / app.ts's own instance: turns anim.dtSec into wall
// time since the last *rendered* frame and keeps a one-shot edge alive
// across ticks the render cap skips.
const renderLatch = createRenderLatch();
// See src/render/drives.ts's header. No panel on the TV to change a drive
// choice, so every setting just reads its own `drive.default` from this
// device's local store — the same TV limitation as the line/beatGrid notes
// below, generalized: nothing ever writes a non-default choice here.
const driveEngine = createDriveEngine();
let lastRafMs = 0;

// Render-rate cap and its jitter-tolerant gate live in framePace.ts (shared
// with app.ts) — see that file for why the gate needs a tolerance at all.
let lastRenderMs = 0;
let governor: QualityGovernor | null = null;

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, quality.preset));
}

/** Swaps the running scene for `next`. If `next`'s init() throws (a shader
 *  this TV's GPU won't compile) the scene it replaced is brought back, rather
 *  than leaving a half-built one whose render() throws every frame. */
function switchScene(next: Scene): void {
  const prev = scene;
  prev.dispose(sceneCtx);
  try {
    next.init(sceneCtx);
    scene = next;
  } catch (err) {
    console.error(`TV: "${next.name}" failed to start:`, err);
    try {
      next.dispose(sceneCtx);
    } catch {
      // Whatever init() half-built; the original error is the one to report.
    }
    try {
      prev.init(sceneCtx);
    } catch (err2) {
      console.error(`TV: "${prev.name}" failed to restart:`, err2);
    }
  }
  conn.sendHello(scene.id, palette.id, viewport);
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

  // See gl.ts's watchContextLoss(): a restored context means every scene's GL
  // objects are dead, so the page reloads, rejoining this TV's own room (the
  // `?room=` path below) so the paired phone stays connected.
  watchContextLoss(
    canvas,
    () => {
      glLost = true;
    },
    () => {
      if (roomCodeNow) {
        const url = new URL(location.href);
        url.searchParams.set("room", roomCodeNow);
        history.replaceState(null, "", url.toString());
      }
      location.reload();
    },
  );

  quality = qualitySettings(await detectQuality());
  sceneCtx = { gl, quality };
  if (!presetAllows(scene, quality.preset)) scene = availableScenes()[0] ?? scene;
  governor = createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  scene.init(sceneCtx);

  // `?room=CODE` is the join screen's typed-code field: render in that room instead of minting a new one.
  // A failed mint (offline, the per-IP throttle, the worker down) retries with
  // a growing wait and says so on the badge, instead of leaving a blank screen.
  let code = roomCodeFromParam(new URLSearchParams(location.search).get("room"));
  for (let waitMs = 2000; !code; waitMs = Math.min(waitMs * 2, 30_000)) {
    try {
      code = await createRoomCode();
    } catch (err) {
      console.warn("TV: couldn't create a room, retrying:", err);
      badge.textContent = "Can't reach the server, retrying…";
      badge.style.display = "block";
      await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    }
  }
  roomCodeNow = code;
  conn = new RendererConnection(code);
  conn.onCommand((cmd) => {
    if (cmd.scene) {
      const s = getScene(cmd.scene);
      if (s && presetAllows(s, quality.preset)) switchScene(s);
    }
    if (cmd.palette) palette = getPalette(cmd.palette);
    if (cmd.viewport) viewport = cmd.viewport;
  });

  const join = createJoinScreen("host", document.body, { tv: true });
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
    if (glLost) return;

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
      pulseOnset: s.pulseFired,
      bpm: s.bpm,
      onsetPhase: s.beatPhase,
      level: s.level,
    };

    // Only the GPU draw is rate-capped — sampling and the anim clock's
    // decay above stay on every rAF tick. smoothing left at its default (the
    // TV has no per-scene Smoothing control of its own); `frame.onset`
    // itself already arrived pre-gated from the phone (see silenceGate.ts's
    // TV-limitation note), but bandEnergy's own low/mid/high detectors run
    // locally here too, off this device's own stored marks — hence passing
    // the gate through. Same TV limitation for `hit`
    // (src/audio/hitStrength.ts's own header): no `beatRatio` — a paired TV
    // never runs a local broadband FeatureExtractor of its own — so a
    // graded broadband beatPulse falls back to the loudest of this device's
    // own band ratios, same as any device with no local extractor. Beat
    // grid and a setting's own drawn line are drive choices now
    // (src/render/drives.ts) rather than animClock.advance() params — see
    // driveEngine's own declaration above for the same TV limitation
    // restated for those.
    const anim = animClock.advance(dtSec, frame, undefined, getSilenceGate(), { shape: getHitShape() });
    advanceAutoTune(dtSec, anim.profile);
    renderLatch.accumulate(anim);
    // No Sensitivity/Expansion on the TV — it renders the wire frame as-is
    // (see the `frame` passed to scene.render() below), so `uEnergy` there
    // is just frame.energy, unshaped; the drive engine's own energy source
    // matches that directly, same reasoning as app.ts's driveEnergy but
    // without a shaping step to redo.
    driveEngine.accumulate(dtSec, frame, frame.energy, anim, scene.id, scene.settings ?? []);

    const intervalMs = targetFrameIntervalMs(quality.preset);
    if (!shouldRenderFrame(nowRafMs, lastRenderMs, intervalMs)) return;
    lastRenderMs = nextRenderAnchor(nowRafMs, lastRenderMs, intervalMs);

    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    const latchedAnim = renderLatch.consume(anim, nowRafMs);
    const drives = driveEngine.forScene(scene.id, scene.settings ?? [], latchedAnim);
    scene.render(sceneCtx, frame, viewport, palette, latchedAnim, drives);
    governor?.recordFrame(nowRafMs);
  }

  requestAnimationFrame(loop);
}

void main();
