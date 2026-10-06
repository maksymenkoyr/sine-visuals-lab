import type { SceneSetting } from "../../render/sceneSettings.ts";
import {
  clampZoneEdges,
  grainBounce,
  zoneDrive,
  HOP_RATE,
  LIFT_THRESHOLD,
  PULL_BIAS,
  ZONE_AXIS_MAX,
  ZONE_MIN_GAP,
} from "../../render/scenes/chladniSand.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { FONT_MONO, INPUT_GREEN, SCENE_VIOLET, withAlpha } from "../controlsTheme.ts";
import { setHintText } from "../hintSwatches.ts";
import { setLiveText } from "../liveText.ts";
import { watchSize } from "../onScreen.ts";

/**
 * Chladni's Sand zones gauge (`Scene.panel` widget "sandZones"): the plate's
 * drive along one fixed square-root axis, 0..ZONE_AXIS_MAX (so the freeze
 * band near 0 gets room to read and drag), split into the three ways
 * the sand answers it — freezes, drifts, snaps (chladniSand.ts's header). The
 * two edges between them are the scene's Freeze edge and Snap edge settings,
 * dragged as handles on the gauge (or moved with the arrow keys once
 * focused; double-click puts one back to its default).
 *
 * Above the axis, a strip of grains: each grain sits at one drive along the
 * axis and is stepped every tick by the plate's own rule (the lift knee, hop
 * and pull from chladniSand.ts, through zoneDrive with the current edges)
 * across one nodal cell, its line along the middle. Every SCATTER_SEC the
 * strip scatters, the way a new figure scatters the plate, so moving an edge
 * shows at once what that drive does: grains left of the freeze edge stay
 * scattered, those in the drift band wander in over seconds, those right of
 * the snap edge are on the line within a beat or two.
 *
 * Below it, the needle: the plate's drive right now (before the zones —
 * chladni.ts's probe()), with a short fading trail, and a line of text naming
 * what the sand is doing. The axis never rescales (graphs keep one scale);
 * a drive past its end pins the needle there.
 */

const STRIP_PX = 64;
const AXIS_PX = 22;
const HEIGHT_PX = STRIP_PX + AXIS_PX;
const SIDE_PAD_PX = 8;
const GRAINS = 240;
const SCATTER_SEC = 4;
// The strip shows one nodal cell, antinode (top) to antinode (bottom) across
// its line; a plate cell at a typical mode order is about 1/CELL_SCALE of
// the strip's own [-1, 1], so the rule's plate-unit moves are scaled up by it.
const CELL_SCALE = 6;
// SIM_FRAG's STEP_CELL_FRACTION, in strip units (a cell spans 2).
const STEP_CAP = 0.5;
const TRAIL_LEN = 36;
const AXIS_TICKS = [0, 0.5, 1, 2, ZONE_AXIS_MAX];
const HANDLE_HIT_PX = 14;

const FREEZE_COLOUR = "#9aa9c2";
const ZONES = [
  { word: "freezes", colour: FREEZE_COLOUR },
  { word: "drifts", colour: SCENE_VIOLET },
  { word: "snaps", colour: INPUT_GREEN },
] as const;

function rowSpec(part: string, label: string): SceneSetting {
  return { key: `chladni:sandZones:${part}`, label, min: 0, max: 1, step: 1, default: 0 };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

registerWidget("sandZones", (container, section, ctx: WidgetCtx) => {
  const freezeSpec = ctx.specs.find((s) => s.key === "freezeEdge");
  const snapSpec = ctx.specs.find((s) => s.key === "snapEdge");
  if (!freezeSpec || !snapSpec) return;

  const row = document.createElement("div");
  row.className = "vc-row";
  row.style.setProperty("--vc-accent", SCENE_VIOLET);
  const stage = document.createElement("div");
  stage.style.cssText = `position: relative; height: ${HEIGHT_PX}px; touch-action: none;`;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: 100%; height: ${HEIGHT_PX}px; border-radius: 4px; background: rgba(0,0,0,0.35);`;
  canvas.setAttribute("aria-hidden", "true");
  stage.appendChild(canvas);
  const status = document.createElement("div");
  status.style.cssText = `font: 11px/1.4 ${FONT_MONO}; margin-top: 5px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums;`;
  const hintEl = document.createElement("div");
  hintEl.className = "vc-hint";
  setHintText(hintEl, section.hint ?? "");
  row.append(stage, status, hintEl);
  container.appendChild(row);
  ctx.registerCard(row, rowSpec("row", section.title));

  // ---- edges -------------------------------------------------------------
  const edge = { freeze: ctx.get(freezeSpec), snap: ctx.get(snapSpec) };
  let active: "freeze" | "snap" | null = null; // being dragged
  let hover: "freeze" | "snap" | null = null;

  // Observed, not read: tick() and draw() run every frame (onScreen.ts).
  const canvasSize = watchSize(canvas);
  const width = () => canvasSize.w;
  const span = () => Math.max(1, width() - 2 * SIDE_PAD_PX);
  const xOf = (d: number) => SIDE_PAD_PX + Math.sqrt(Math.max(0, Math.min(d, ZONE_AXIS_MAX)) / ZONE_AXIS_MAX) * span();
  const dOf = (x: number) => ZONE_AXIS_MAX * Math.max(0, Math.min(1, (x - SIDE_PAD_PX) / span())) ** 2;

  function setEdge(which: "freeze" | "snap", value: number): void {
    const spec = which === "freeze" ? freezeSpec! : snapSpec!;
    let v = Math.round(value / spec.step) * spec.step;
    v = Math.max(spec.min, Math.min(spec.max, v));
    // Edges never cross: each stops ZONE_MIN_GAP short of the other.
    if (which === "freeze") v = Math.min(v, edge.snap - ZONE_MIN_GAP);
    else v = Math.max(v, edge.freeze + ZONE_MIN_GAP);
    v = Number(v.toFixed(2));
    if (v === edge[which]) return;
    edge[which] = v;
    ctx.set(spec, v);
    syncHandles();
  }

  // Each edge's handle is a real focusable slider over the canvas, so the
  // keyboard and screen readers get the edges too.
  function makeHandle(which: "freeze" | "snap", spec: SceneSetting): HTMLElement {
    const h = document.createElement("div");
    h.tabIndex = 0;
    h.setAttribute("role", "slider");
    h.setAttribute("aria-label", spec.label);
    h.setAttribute("aria-valuemin", String(spec.min));
    h.setAttribute("aria-valuemax", String(spec.max));
    h.title = `${spec.label}: ${spec.description ?? ""}. Drag, or arrow keys; double-click resets.`;
    h.style.cssText = `position: absolute; top: 0; height: ${HEIGHT_PX}px; width: ${HANDLE_HIT_PX}px; margin-left: -${HANDLE_HIT_PX / 2}px; cursor: ew-resize; outline: none; border-radius: 3px;`;
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = which;
      h.setPointerCapture(e.pointerId);
      h.focus({ preventScroll: true });
    });
    h.addEventListener("pointermove", (e) => {
      if (active !== which) return;
      setEdge(which, dOf(e.clientX - canvas.getBoundingClientRect().left));
    });
    const end = () => {
      if (active === which) active = null;
    };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    h.addEventListener("pointerenter", () => (hover = which));
    h.addEventListener("pointerleave", () => hover === which && (hover = null));
    h.addEventListener("dblclick", () => setEdge(which, spec.default));
    h.addEventListener("keydown", (e) => {
      const step = spec.step * (e.shiftKey ? 4 : 1);
      const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
      if (!d) return;
      e.preventDefault();
      setEdge(which, edge[which] + d);
    });
    h.addEventListener("focus", () => (hover = which));
    h.addEventListener("blur", () => hover === which && (hover = null));
    stage.appendChild(h);
    return h;
  }
  const handles = { freeze: makeHandle("freeze", freezeSpec), snap: makeHandle("snap", snapSpec) };
  function syncHandles(): void {
    for (const which of ["freeze", "snap"] as const) {
      handles[which].style.left = `${xOf(edge[which])}px`;
      handles[which].setAttribute("aria-valuenow", edge[which].toFixed(2));
      handles[which].setAttribute("aria-valuetext", `${edge[which].toFixed(2)} plate drive`);
    }
  }

  // A press on the gauge itself grabs whichever edge is nearer and drags it.
  canvas.addEventListener("pointerdown", (e) => {
    const d = dOf(e.clientX - canvas.getBoundingClientRect().left);
    const which = Math.abs(d - edge.freeze) <= Math.abs(d - edge.snap) ? "freeze" : "snap";
    active = which;
    canvas.setPointerCapture(e.pointerId);
    setEdge(which, d);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (active) setEdge(active, dOf(e.clientX - canvas.getBoundingClientRect().left));
  });
  const release = () => (active = null);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // ---- grains ------------------------------------------------------------
  const gx = new Float32Array(GRAINS);
  const gy = new Float32Array(GRAINS);
  const ghop = new Float32Array(GRAINS);
  // Evenly spread along the drawn axis, so drive-wise they crowd toward 0.
  for (let i = 0; i < GRAINS; i++) gx[i] = ZONE_AXIS_MAX * ((i + Math.random()) / GRAINS) ** 2;
  const scatter = () => {
    for (let i = 0; i < GRAINS; i++) gy[i] = Math.random() * 2 - 1;
  };
  scatter();
  let sinceScatter = 0;

  // One tick of SIM_FRAG's rule for a grain at drive d, across a strip cell
  // whose field is sin(pi y / 2): the line at y = 0, antinodes at the edges.
  function stepGrain(i: number, dt: number): void {
    const y = gy[i]!;
    const f = Math.sin((Math.PI * y) / 2);
    const accel = Math.abs(f) * 0.5 * zoneDrive(gx[i]!, edge.freeze, edge.snap);
    const bounce = grainBounce(accel, LIFT_THRESHOLD);
    const step = (HOP_RATE * bounce * Math.sqrt(dt * 60)) / 60 * CELL_SCALE;
    const hop = (Math.random() - 0.5) * 2 * step;
    const bias = PULL_BIAS * smoothstep(0, 3 * LIFT_THRESHOLD, accel);
    const pull = Math.min(STEP_CAP, HOP_RATE * bounce * bias * dt * CELL_SCALE);
    let ny = y + hop - Math.sign(y) * Math.min(pull, Math.abs(y));
    if (ny > 1) ny = 2 - ny;
    else if (ny < -1) ny = -2 - ny;
    gy[i] = ny;
    ghop[i] = hop;
  }

  // ---- needle ------------------------------------------------------------
  const trail: number[] = [];
  let last = performance.now();

  function zoneOf(d: number): 0 | 1 | 2 {
    const { freeze, snap } = clampZoneEdges(edge.freeze, edge.snap);
    return d < freeze ? 0 : d < snap ? 1 : 2;
  }

  function draw(drive: number | null): void {
    const w = width();
    if (w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(HEIGHT_PX * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, HEIGHT_PX);

    const x0 = xOf(0), xF = xOf(edge.freeze), xS = xOf(edge.snap), x1 = xOf(ZONE_AXIS_MAX);
    const bounds = [x0, xF, xS, x1];
    const now = drive === null ? -1 : zoneOf(drive);
    g.font = `10px ${FONT_MONO}`;
    g.textBaseline = "top";
    for (let z = 0; z < 3; z++) {
      const a = bounds[z]!, b = bounds[z + 1]!;
      g.fillStyle = withAlpha(ZONES[z].colour, now === z ? 0.2 : 0.09);
      g.fillRect(a, 0, b - a, STRIP_PX);
      if (b - a > 34) {
        g.fillStyle = withAlpha(ZONES[z].colour, now === z ? 0.95 : 0.6);
        g.textAlign = "left";
        g.fillText(ZONES[z].word, a + 4, 3);
      }
    }
    // The nodal line the grains settle on.
    const mid = STRIP_PX / 2;
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();
    g.setLineDash([]);

    const yPx = (y: number) => mid + y * (STRIP_PX / 2 - 5);
    g.lineWidth = 1;
    for (let i = 0; i < GRAINS; i++) {
      const px = xOf(gx[i]!), py = yPx(gy[i]!);
      const hopPx = ghop[i]! * (STRIP_PX / 2 - 5) * 3;
      if (Math.abs(hopPx) > 0.6) {
        g.strokeStyle = "rgba(255,230,240,0.35)";
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px, py - hopPx);
        g.stroke();
      }
      g.fillStyle = "#f6e7ee";
      g.fillRect(px - 1, py - 1, 2, 2);
    }

    // Edges: a line through the strip and a grip on the axis.
    for (const which of ["freeze", "snap"] as const) {
      const x = which === "freeze" ? xF : xS;
      const lit = active === which || hover === which;
      const col = which === "freeze" ? SCENE_VIOLET : INPUT_GREEN;
      g.strokeStyle = withAlpha(col, lit ? 0.95 : 0.55);
      g.lineWidth = lit ? 2 : 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, STRIP_PX + 6);
      g.stroke();
      g.fillStyle = withAlpha(col, lit ? 1 : 0.8);
      g.fillRect(x - 4, STRIP_PX + 2, 8, 10);
      if (lit) {
        const label = `${which === "freeze" ? "freeze" : "snap"} ${edge[which].toFixed(2)}`;
        g.font = `10px ${FONT_MONO}`;
        const tw = g.measureText(label).width;
        const lx = Math.max(2, Math.min(w - tw - 6, x - tw / 2 - 2));
        g.fillStyle = "rgba(0,0,0,0.75)";
        g.fillRect(lx, 14, tw + 4, 13);
        g.fillStyle = "#fff";
        g.textAlign = "left";
        g.fillText(label, lx + 2, 16);
      }
    }
    g.lineWidth = 1;

    // Axis: the drive scale, its ticks every 1.
    const ay = STRIP_PX + 7;
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.beginPath();
    g.moveTo(x0, ay);
    g.lineTo(x1, ay);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.textBaseline = "alphabetic";
    for (const t of AXIS_TICKS) {
      const x = xOf(t);
      g.fillRect(x - 0.5, ay - 2, 1, 4);
      g.textAlign = t === 0 ? "left" : t === ZONE_AXIS_MAX ? "right" : "center";
      g.fillText(String(t), x, HEIGHT_PX - 2);
    }

    // Needle: where the plate's drive is now, with its trail.
    for (let k = 0; k < trail.length; k++) {
      const a = (k + 1) / trail.length;
      g.fillStyle = `rgba(255,255,255,${0.35 * a * a})`;
      g.fillRect(xOf(trail[k]!) - 1, ay - 4, 2, 8);
    }
    if (drive !== null) {
      const x = xOf(drive);
      g.fillStyle = "#fff";
      g.beginPath();
      g.moveTo(x, ay - 1);
      g.lineTo(x - 4, ay - 8);
      g.lineTo(x + 4, ay - 8);
      g.closePath();
      g.fill();
      if (drive > ZONE_AXIS_MAX) {
        g.textAlign = "right";
        g.fillText("▸", x1, ay - 9);
      }
    }
  }

  let laidOutWidth = 0;
  function tick(): void {
    if (width() !== laidOutWidth) {
      laidOutWidth = width();
      syncHandles();
    }
    const t = performance.now();
    const dt = Math.max(0.001, Math.min(0.05, (t - last) / 1000));
    last = t;
    // Follow an edge changed elsewhere (a Look, the room, a reset).
    if (active === null) {
      const f = ctx.get(freezeSpec!), s = ctx.get(snapSpec!);
      if (f !== edge.freeze || s !== edge.snap) {
        edge.freeze = f;
        edge.snap = s;
        syncHandles();
      }
    }
    sinceScatter += dt;
    if (sinceScatter >= SCATTER_SEC) {
      sinceScatter = 0;
      scatter();
    }
    for (let i = 0; i < GRAINS; i++) stepGrain(i, dt);

    const probe = ctx.probe();
    const drive = probe && Number.isFinite(probe.drive) ? Math.max(0, probe.drive!) : null;
    if (drive !== null) {
      trail.push(drive);
      if (trail.length > TRAIL_LEN) trail.shift();
    }
    draw(drive);
    if (drive === null) {
      setLiveText(status, "");
    } else {
      const z = ZONES[zoneOf(drive)];
      status.style.color = withAlpha(z.colour, 0.95);
      setLiveText(status, `drive ${drive.toFixed(2)} · sand ${z.word}`);
    }
  }

  syncHandles();
  ctx.onTick(tick);
  ctx.onDispose(() => canvasSize.disconnect());
  // The first layout lands after mount; place the handles once it has.
  requestAnimationFrame(() => {
    syncHandles();
    tick();
  });
});
