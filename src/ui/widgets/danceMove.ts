import { BANDS_AMBER, FONT_MONO, INPUT_GREEN, withAlpha } from "../controlsTheme.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import type { PanelSection } from "../../render/scene.ts";

/**
 * The Dance card (Toon Rave, src/render/scenes/toonrave/dance.ts): the Dance row,
 * the move Dance learned from its signal, then the Energy rows and a Speed line.
 * The rows are the device menu's own (`ctx.mountRows`: port, wire panel, slider,
 * reset); this file only adds two read-outs, both drawn from the scene's probe()
 * every tick:
 *   - the move: one bar of the learned loop (probe's m0..m<bins-1>), the bar's four
 *     beats marked, a dot where the cast is in it, the found BPM and its state;
 *   - Speed: energy against its floor, the on-beat speed steps marked, and the
 *     step energy is in now (stop, ¼×, ½×, 1×, 2×), all from probe's stepAt<i> and
 *     stepMultiple<i> (dance.ts's SPEED_STEPS).
 * The section's `settings` name the rows, in order: the first is the Dance row,
 * the rest go under the move.
 */

const STATUS = ["no beat", "finding", "locked", "holding"];
/** A speed step's name from its multiple of the beat. */
const stepName = (m: number): string =>
  m === 0 ? "stop" : m === 0.25 ? "¼×" : m === 0.5 ? "½×" : m === 1 ? "1×" : `${m}×`;

function buildDanceMove(container: HTMLElement, section: PanelSection, ctx: WidgetCtx): void {
  const keys = section.settings ?? [];
  const spec = (k: string) => ctx.specs.find((s) => s.key === k);
  const danceSpec = keys.length ? spec(keys[0]) : undefined;
  if (danceSpec) ctx.mountRows(container, [{ spec: danceSpec }]);

  const moveBox = document.createElement("div");
  moveBox.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:2px 0 8px;";
  const moveHead = document.createElement("div");
  moveHead.style.cssText = `display:flex;justify-content:space-between;font:400 11px/1.2 ${FONT_MONO};color:rgba(255,255,255,0.62);`;
  const moveLabel = document.createElement("span");
  moveLabel.textContent = "The move (one bar)";
  const beatOut = document.createElement("span");
  moveHead.append(moveLabel, beatOut);
  const moveCanvas = document.createElement("canvas");
  moveCanvas.style.cssText = "width:100%;height:52px;display:block;border-radius:2px;background:rgba(255,255,255,0.03);";
  moveCanvas.title = "The move Dance learned from its signal: one bar of it, the four beats marked. The dot is where the cast is in it.";
  moveBox.append(moveHead, moveCanvas);
  container.appendChild(moveBox);

  const restSpecs = keys.slice(1).map(spec).filter((s): s is NonNullable<typeof s> => !!s);
  if (restSpecs.length) ctx.mountRows(container, restSpecs.map((s) => ({ spec: s })));

  const speedBox = document.createElement("div");
  speedBox.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 0 4px;";
  const speedHead = document.createElement("div");
  speedHead.style.cssText = `display:flex;justify-content:space-between;font:400 11px/1.2 ${FONT_MONO};color:rgba(255,255,255,0.62);`;
  const speedLabel = document.createElement("span");
  speedLabel.textContent = "Speed through the move";
  const speedOut = document.createElement("span");
  speedOut.style.color = BANDS_AMBER;
  speedHead.append(speedLabel, speedOut);
  const speedCanvas = document.createElement("canvas");
  speedCanvas.style.cssText = "width:100%;height:24px;display:block;";
  speedCanvas.title = "Energy now (the bar) and its floor (the white tick). Speed snaps to the marked steps so the move stays on the beat.";
  speedBox.append(speedHead, speedCanvas);
  container.appendChild(speedBox);

  const fit = (cv: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return cv.getContext("2d");
  };

  ctx.onTick(() => {
    const p = ctx.probe();
    if (!p) return;
    const bins = Math.max(1, Math.round(p.bins ?? 0));
    beatOut.textContent = p.bpm > 0 ? `${p.bpm.toFixed(1)} BPM · ${STATUS[p.status] ?? ""}` : "no beat yet";
    const nSteps = Math.round(p.speedSteps ?? 0);
    const stepAt = Array.from({ length: nSteps }, (_, i) => p["stepAt" + i] ?? 0);
    const stepNames = Array.from({ length: nSteps }, (_, i) => stepName(p["stepMultiple" + i] ?? 0));
    speedOut.textContent = stepNames[p.speedStep] ?? "";

    const g = fit(moveCanvas);
    if (g) {
      const w = moveCanvas.width;
      const h = moveCanvas.height;
      const pad = 4 * (w / Math.max(1, moveCanvas.clientWidth));
      const y = (v: number) => h - pad - v * (h - 2 * pad);
      g.clearRect(0, 0, w, h);
      g.fillStyle = "rgba(242,139,208,0.35)";
      for (let b = 0; b < 4; b++) g.fillRect((b / 4) * w, 0, b ? 1 : 2, h);
      let flat = true;
      for (let i = 0; i < bins; i++) if ((p["m" + i] ?? 0) > 0) flat = false;
      if (flat) {
        g.fillStyle = "rgba(255,255,255,0.4)";
        g.font = `${Math.round(h * 0.24)}px ${FONT_MONO}`;
        g.fillText(p.bpm > 0 ? "learning the move…" : "waiting for the signal's beat", w * 0.03, h * 0.58);
      } else {
        g.beginPath();
        for (let i = 0; i <= bins; i++) {
          const px = (i / bins) * w;
          const py = y(p["m" + (i % bins)] ?? 0);
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.lineTo(w, h);
        g.lineTo(0, h);
        g.closePath();
        g.fillStyle = withAlpha(INPUT_GREEN, 0.14);
        g.fill();
        g.beginPath();
        for (let i = 0; i <= bins; i++) {
          const px = (i / bins) * w;
          const py = y(p["m" + (i % bins)] ?? 0);
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.strokeStyle = INPUT_GREEN;
        g.lineWidth = Math.max(1.5, h / 26);
        g.stroke();
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc((p.position ?? 0) * w, y(p.move ?? 0), Math.max(3, h / 12), 0, Math.PI * 2);
        g.fill();
      }
    }

    const s = fit(speedCanvas);
    if (s) {
      const w = speedCanvas.width;
      const h = speedCanvas.height;
      const max = p.maxEnergy > 0 ? p.maxEnergy : 1.5;
      const barH = h * 0.45;
      s.clearRect(0, 0, w, h);
      s.fillStyle = "rgba(255,255,255,0.08)";
      s.fillRect(0, 0, w, barH);
      s.fillStyle = BANDS_AMBER;
      s.fillRect(0, 0, (Math.min(max, p.energy ?? 0) / max) * w, barH);
      s.fillStyle = "rgba(255,255,255,0.75)";
      s.fillRect((Math.min(max, p.floor ?? 0) / max) * w - 1, 0, 2, barH);
      s.font = `${Math.round(h * 0.4)}px ${FONT_MONO}`;
      s.textBaseline = "bottom";
      stepAt.forEach((at, i) => {
        const x0 = (at / max) * w;
        const x1 = ((stepAt[i + 1] ?? max) / max) * w;
        if (i) {
          s.fillStyle = "rgba(0,0,0,0.55)";
          s.fillRect(x0, 0, 1, barH);
        }
        s.fillStyle = i === p.speedStep ? BANDS_AMBER : "rgba(255,255,255,0.36)";
        const label = stepNames[i];
        const tw = s.measureText(label).width;
        s.fillText(label, Math.max(0, Math.min(w - tw, (x0 + x1) / 2 - tw / 2)), h);
      });
    }
  });
}

registerWidget("danceMove", buildDanceMove);
