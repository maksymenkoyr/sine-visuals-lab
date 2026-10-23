/**
 * The device load chip in the top-left bar (index.html's #loadChip, in
 * #sceneNav): the page's frame rate and a three-step load colour, read from
 * the same PowerStatus the Power card shows (powerCard.ts). A click opens
 * Power in the panel's Setup view (deviceMenu.ts's openPower).
 *
 * GPU time is often missing: app.ts only runs the GPU timer while the panel
 * is open (resourceMeter.beginGpu), so the GPU step of the colour and the
 * tooltip's GPU part drop out with the panel shut. The chip does no work
 * while its element is hidden (the gallery), and reads at the Power card's
 * rate rather than per frame.
 */
import type { PowerStatus } from "./powerCard.ts";

export type LoadLevel = "ok" | "busy" | "over";

/** First guess. Frame rate as a share of the cap in force, so Energy saving's lower cap isn't read as load. */
export const BUSY_FPS_FRACTION = 0.9;
/** First guess, as BUSY_FPS_FRACTION. */
export const OVER_FPS_FRACTION = 0.6;
/** First guess. Main-thread share of one core. */
export const BUSY_CPU = 0.6;
/** First guess, as BUSY_CPU. */
export const OVER_CPU = 0.9;
/** First guess. GPU time as a share of the frame interval. */
export const BUSY_GPU_FRACTION = 0.6;
/** First guess, as BUSY_GPU_FRACTION. */
export const OVER_GPU_FRACTION = 0.9;
/** Matches deviceMenu.ts's AUTO_UI_REFRESH_MS, the Power card's refresh rate. */
const REFRESH_MS = 100;

/** Null while nothing has been measured yet (fps 0). Unknown CPU or GPU readings count as no load. */
export function loadLevel(s: Pick<PowerStatus, "fps" | "cpuLoad" | "gpuMs">, intervalMs: number): LoadLevel | null {
  if (s.fps <= 0) return null;
  const capFps = 1000 / intervalMs;
  const cpuOver = s.cpuLoad !== null && s.cpuLoad > OVER_CPU;
  const gpuOver = s.gpuMs !== null && s.gpuMs > intervalMs * OVER_GPU_FRACTION;
  if (s.fps < capFps * OVER_FPS_FRACTION || cpuOver || gpuOver) return "over";
  const cpuBusy = s.cpuLoad !== null && s.cpuLoad > BUSY_CPU;
  const gpuBusy = s.gpuMs !== null && s.gpuMs > intervalMs * BUSY_GPU_FRACTION;
  if (s.fps < capFps * BUSY_FPS_FRACTION || cpuBusy || gpuBusy) return "busy";
  return "ok";
}

/** The hover text: whichever readings are known (-1 is unknown), then where a click goes. */
function loadTitle(fps: number, cpu: number, gpu: number): string {
  const parts: string[] = [];
  if (fps >= 0) parts.push(`${fps} FPS`);
  if (cpu >= 0) parts.push(`main thread ${cpu}%`);
  if (gpu >= 0) parts.push(`GPU ${(gpu / 10).toFixed(1)} ms`);
  return `Device load${parts.length ? `: ${parts.join(", ")}` : ""} — open Power`;
}

export function createLoadChip(
  el: HTMLButtonElement,
  deps: { getPowerStatus: () => PowerStatus; intervalMs: () => number; onOpen: () => void },
): { update(nowMs: number): void } {
  const dot = document.createElement("span");
  dot.className = "lcDot";
  const label = document.createTextNode("-- FPS");
  el.append(dot, label);
  el.addEventListener("click", () => deps.onOpen());

  let lastMs = -Infinity;
  // What the chip last showed, rounded the way it is written, so an unchanged
  // reading writes nothing. -1 stands for unknown.
  let shownFps = -1;
  let shownCpu = -1;
  let shownGpu = -1;
  let shownLevel = "";

  return {
    update(nowMs: number): void {
      if (el.style.display === "none") return;
      if (nowMs - lastMs < REFRESH_MS) return;
      lastMs = nowMs;
      const s = deps.getPowerStatus();
      const level = loadLevel(s, deps.intervalMs()) ?? "";
      const fps = s.fps > 0 ? Math.round(s.fps) : -1;
      const cpu = s.cpuLoad === null ? -1 : Math.round(s.cpuLoad * 100);
      const gpu = s.gpuMs === null ? -1 : Math.round(s.gpuMs * 10);
      if (fps === shownFps && cpu === shownCpu && gpu === shownGpu && level === shownLevel) return;
      shownFps = fps;
      shownCpu = cpu;
      shownGpu = gpu;
      shownLevel = level;
      label.data = fps < 0 ? "-- FPS" : `${fps} FPS`;
      el.dataset.load = level;
      el.title = loadTitle(fps, cpu, gpu);
    },
  };
}
