import type { SceneSetting } from "../../render/sceneSettings.ts";
import { BELL_REACH, bellBrightness, bellRingOutScale, sparkleShapeFor } from "../../render/scenes/causticsBell.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { FONT_MONO } from "../controlsTheme.ts";
import { setHintText } from "../hintSwatches.ts";
import { watchSize } from "../onScreen.ts";

/**
 * Caustics' "Sparkle shape" section (`Scene.panel` widget "sparkleShape"): a
 * small window that replays one glint of the chosen shape, with a graph of
 * its life beside it, and the shape pick and Bell ring-out rows under both
 * (mounted through `ctx.appendRow`, so they are the ordinary rows).
 *
 * The window draws causticsBell.ts's `bellBrightness` for a single bell, the
 * same maths the shader runs, so the shape you see is the shape the pool
 * plays. It replays every REPLAY_SEC and, while music plays, restarts on each
 * real hit the scene reports (its probe's `sparkleHit` count). Glint has no
 * ring and no age of its own in the shader (it follows the treble pulse's
 * decay), so its window shows a stand-in flash with a typical fade.
 *
 * The graph plots the bell's centre (solid) and its brightest ring (dashed)
 * against time on one fixed scale (graphs never rescale): the horizontal axis
 * is GRAPH_SEC, the vertical axis 0..GRAPH_TOP.
 */

const PREVIEW_PX = 96;
const GRAPH_H = 64;
const REPLAY_SEC = 2.6;
const GRAPH_SEC = 3;
const GRAPH_TOP = 1.2;
const VIEW_CELLS = BELL_REACH * 1.25; // the window's half-width, in bell cells
const GLINT_FADE_SEC = 0.14; // the stand-in flash's fade
const GLINT_R = 0.1; // the stand-in flash's radius, cells

const FLASH_RGB: readonly [number, number, number] = [214, 251, 255];
const RING_RGB: readonly [number, number, number] = [255, 190, 120];

function rowSpec(part: string, label: string): SceneSetting {
  return { key: `caustics:sparkleShape:${part}`, label, min: 0, max: 1, step: 1, default: 0 };
}

/** The window's and graph's brightness for `shape` at `ageSec`, `dist` cells out. */
function brightness(shapeIndex: number, ageSec: number, dist: number, scale: number): number {
  const shape = sparkleShapeFor(shapeIndex);
  if (shape === "glint") return ageSec <= 0 ? 0 : Math.exp(-ageSec / GLINT_FADE_SEC) * Math.exp((-2.2 * dist * dist) / (GLINT_R * GLINT_R));
  return bellBrightness(shape, ageSec, dist, scale);
}

registerWidget("sparkleShape", (container, section, ctx: WidgetCtx) => {
  const shapeSpec = ctx.specs.find((s) => s.key === "sparkleShape");
  const ringSpec = ctx.specs.find((s) => s.key === "sparkleRing");
  if (!shapeSpec || !ringSpec) return;

  const row = document.createElement("div");
  row.className = "vc-row";
  const stage = document.createElement("div");
  stage.style.cssText = "display: flex; gap: 10px; align-items: stretch;";

  const preview = document.createElement("canvas");
  preview.width = PREVIEW_PX;
  preview.height = PREVIEW_PX;
  preview.setAttribute("aria-hidden", "true");
  preview.style.cssText = `flex: none; display: block; width: ${PREVIEW_PX}px; height: ${PREVIEW_PX}px; border-radius: 4px; background: #031419;`;

  const graph = document.createElement("canvas");
  graph.setAttribute("aria-hidden", "true");
  graph.style.cssText = `flex: 1; min-width: 0; display: block; width: 100%; height: ${GRAPH_H}px; align-self: flex-end;`;

  stage.append(preview, graph);
  const hintEl = document.createElement("div");
  hintEl.className = "vc-hint";
  setHintText(hintEl, section.hint ?? "");
  row.append(stage, hintEl);
  container.appendChild(row);
  ctx.registerCard(row, rowSpec("row", section.title));

  const rows = document.createElement("div");
  container.appendChild(rows);
  ctx.appendRow(rows, shapeSpec);
  ctx.appendRow(rows, ringSpec);

  const pctx = preview.getContext("2d");
  const image = pctx ? pctx.createImageData(PREVIEW_PX, PREVIEW_PX) : null;
  const size = watchSize(graph);

  let age = 0;
  let lastHit: number | null = null;
  let last = performance.now();

  function frameTick(): void {
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    age += dt;
    const hit = ctx.probe()?.sparkleHit;
    if (typeof hit === "number") {
      if (lastHit !== null && hit !== lastHit) age = 0;
      lastHit = hit;
    }
    if (age >= REPLAY_SEC) age = 0;

    const shapeIndex = ctx.get(shapeSpec!);
    const scale = bellRingOutScale(ctx.get(ringSpec!));
    drawPreview(shapeIndex, scale);
    drawGraph(shapeIndex, scale);
  }

  function drawPreview(shapeIndex: number, scale: number): void {
    if (!pctx || !image) return;
    const d = image.data;
    const half = PREVIEW_PX / 2;
    for (let y = 0; y < PREVIEW_PX; y++) {
      for (let x = 0; x < PREVIEW_PX; x++) {
        const dx = ((x + 0.5 - half) / half) * VIEW_CELLS;
        const dy = ((y + 0.5 - half) / half) * VIEW_CELLS;
        const v = Math.min(1, brightness(shapeIndex, age, Math.hypot(dx, dy), scale));
        const o = (y * PREVIEW_PX + x) * 4;
        d[o] = 3 + v * (FLASH_RGB[0] - 3);
        d[o + 1] = 20 + v * (FLASH_RGB[1] - 20);
        d[o + 2] = 25 + v * (FLASH_RGB[2] - 25);
        d[o + 3] = 255;
      }
    }
    pctx.putImageData(image, 0, 0);
  }

  function drawGraph(shapeIndex: number, scale: number): void {
    const w = size.w;
    if (w < 8) return;
    if (graph.width !== w) graph.width = w;
    if (graph.height !== GRAPH_H) graph.height = GRAPH_H;
    const g = graph.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, GRAPH_H);
    const padB = 12;
    const plotH = GRAPH_H - padB - 2;
    const yOf = (v: number) => 2 + plotH * (1 - Math.min(v, GRAPH_TOP) / GRAPH_TOP);
    const xOf = (t: number) => (t / GRAPH_SEC) * (w - 1);
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, yOf(0) + 0.5);
    g.lineTo(w, yOf(0) + 0.5);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.font = `10px ${FONT_MONO}`;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillText("hit", 0, GRAPH_H - 1);
    g.textAlign = "right";
    g.fillText(`${GRAPH_SEC} s`, w, GRAPH_H - 1);

    const curve = (rgb: readonly [number, number, number], dash: number[], at: (t: number) => number): void => {
      g.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      g.lineWidth = 1.6;
      g.setLineDash(dash);
      g.beginPath();
      for (let i = 0; i <= 90; i++) {
        const t = (i / 90) * GRAPH_SEC;
        const x = xOf(t);
        const y = yOf(at(t));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    };
    const centre = (t: number) => brightness(shapeIndex, t, 0, scale);
    const ring = (t: number) => {
      let m = 0;
      for (let k = 0; k <= 12; k++) m = Math.max(m, brightness(shapeIndex, t, 0.12 + (k / 12) * (BELL_REACH - 0.06), scale));
      return m;
    };
    curve(FLASH_RGB, [], centre);
    if (sparkleShapeFor(shapeIndex) !== "glint") curve(RING_RGB, [4, 3], ring);

    // Playhead: where the window's replay is now.
    const px = xOf(Math.min(age, GRAPH_SEC));
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + 0.5, 1);
    g.lineTo(px + 0.5, yOf(0));
    g.stroke();
  }

  ctx.onTick(frameTick);
  ctx.onDispose(() => size.disconnect());
  requestAnimationFrame(frameTick);
});
