import type { SceneSetting } from "../../render/sceneSettings.ts";
import { HARMONIES } from "../../render/scenes/physarum2Synergy.ts";
import type { WidgetCtx } from "./registry.ts";
import {
  applyEdit,
  arcPath,
  arrowStep,
  formatValue,
  fromUnit,
  hueRailGradient,
  knobDelta,
  quantize,
  toUnit,
  wheelPoint,
  type ValueFormat,
} from "./consoleMath.ts";

/**
 * The Strain Console: every per-strain setting for all the strains at once,
 * as **Lanes** (one row per setting with a lane per strain on a shared scale,
 * plus a Link toggle) or **Knobs** (a setting-by-strain grid), and Stain
 * Synergy under them with a hue wheel. Built from the "Strain Console"
 * prototype (docs/scenes/physarum2/artifacts/strain-console.html) and mounted
 * by itemBoxes.ts into its own card, in place of the old one-strain-at-a-time
 * rows and their tap/checkbox selection.
 *
 * A lane or knob edits the existing per-item setting (`ctx.get`/`ctx.set`, the
 * exact path a slider drag takes), so a Look, a reset and the TV see nothing
 * different. What the console can't draw is a row's jack, Receives patch,
 * sparkline and reset — so releasing a lane or knob mounts that setting's real
 * device-menu row (`ctx.mountRows`) under the grid, and that row is where a
 * source is patched in. The full-size row is also where a setting with no
 * jack (Sensor angle, Trail life) is typed exactly.
 *
 * Gestures (both layouts): drag to set; double-click puts the default back;
 * arrow keys step (Shift = ten times as far). Lanes: Link moves all the
 * strains together. Knobs: drag any way — right or up turns it up, left or
 * down turns it down, a fixed distance sweeps the whole range (consoleMath's
 * KNOB_PX), Shift is a fifth of the speed, Alt moves all the strains together;
 * a faint + and − on the diagonal a drag turns it along light up on the side
 * being turned toward and fade at a limit; a small tick marks the default.
 *
 * Stain Synergy: the stain settings hold what was set; what the dish shows is
 * those pulled toward the nearest colour harmony (physarum2Synergy.ts). While
 * Synergy is above 0 the Stain controls show what the dish shows (the scene's
 * `probe()` `shownStain<k>`), and grabbing one starts from that — it becomes
 * the setting, so nothing jumps under the pointer. The wheel draws the set
 * hues hollow and the shown hues filled.
 *
 * Every word a person reads here is a spec label/description or a value; the
 * few fixed strings (Lanes, Knobs, Link) are the layout's own vocabulary.
 */

export interface ConsoleOptions {
  /** `SceneSetting.item.param` keys, in display order. */
  params: readonly string[];
  /** How a param's value reads; default `plain`. */
  formats?: Readonly<Record<string, ValueFormat>>;
  /** The param that is a hue shift over each item's own base colour (Stain):
   *  its lane rail shows that item's hue across the range. `baseHues` are in
   *  turns, one per item. */
  hue?: { param: string; baseHues: readonly number[] };
  /** A plain setting drawn as a row under the grid with a hue wheel beside it
   *  (Synergy). Needs `hue`. */
  synergy?: { key: string };
}

export interface StrainConsoleArgs {
  ctx: WidgetCtx;
  /** The card body to build into. */
  container: HTMLElement;
  family: string;
  /** Short display codes, one per item. */
  labels: readonly string[];
  /** Fallback per-item colours (CSS) until `tick` supplies live ones. */
  colours: readonly string[];
  opts: ConsoleOptions;
  /** Prefix for this console's localStorage keys. */
  stateKey: string;
}

export interface StrainConsole {
  /** Refreshes every control from the settings. `colours` are the items' live
   *  colours (CSS), stain and all. */
  tick(colours: readonly string[]): void;
  dispose(): void;
}

type Layout = "lanes" | "knobs";

function readLayout(key: string): Layout {
  try {
    return localStorage.getItem(key) === "knobs" ? "knobs" : "lanes";
  } catch {
    return "lanes";
  }
}
function writeLayout(key: string, v: Layout): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Not fatal — the layout just won't survive a reload.
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
const KNOB_A0 = (135 * Math.PI) / 180;
const KNOB_ARC = (270 * Math.PI) / 180;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

interface Cell {
  spec: SceneSetting;
  /** Repaints this control from `value` in `colour`. */
  paint(value: number, colour: string): void;
}

export function buildStrainConsole(args: StrainConsoleArgs): StrainConsole {
  const { ctx, container, family, labels, opts } = args;
  const count = labels.length;
  const layoutKey = `vibe.strainConsole.layout.${args.stateKey}`;
  let layout = readLayout(layoutKey);
  let colours: readonly string[] = args.colours;
  const disposers: (() => void)[] = [];

  // specs[p][k] — the setting behind param p for item k.
  const specs = new Map<string, SceneSetting[]>();
  for (const p of opts.params) {
    const row: SceneSetting[] = [];
    for (let k = 0; k < count; k++) {
      const s = ctx.specsFor(family, k).find((x) => x.item?.param === p);
      if (s) row.push(s);
    }
    if (row.length === count) specs.set(p, row);
  }
  const params = opts.params.filter((p) => specs.has(p));
  const fmtOf = (p: string): ValueFormat => opts.formats?.[p] ?? "plain";
  const synergySpec = opts.synergy ? ctx.specs.find((s) => s.key === opts.synergy!.key) : undefined;
  const isHue = (p: string): boolean => opts.hue?.param === p;

  const cells = new Map<string, Cell[]>();
  const link = new Map<string, boolean>();

  // ---------------- values ----------------

  const stored = (p: string): number[] => specs.get(p)!.map((s) => ctx.get(s));

  /** Stain controls read the shown hue while Synergy pulls them (the scene
   *  reports it); every other value is the stored one. */
  function shownValues(p: string, probe: Record<string, number> | null): number[] {
    const values = stored(p);
    if (isHue(p) && synergySpec && ctx.get(synergySpec) > 0 && probe) {
      return values.map((v, k) => {
        const s = probe[`shownStain${k}`];
        return typeof s === "number" ? s : v;
      });
    }
    return values;
  }

  /** Grabbing a stain Synergy has moved: what is on screen becomes the
   *  setting, so the control doesn't jump when the pointer takes it. */
  function adoptShown(p: string, k: number): void {
    if (!isHue(p) || !synergySpec || ctx.get(synergySpec) <= 0) return;
    const probe = ctx.probe();
    const s = probe?.[`shownStain${k}`];
    const spec = specs.get(p)![k]!;
    if (typeof s === "number") ctx.set(spec, quantize(s, spec));
  }

  /** Writes `v` to item k's control — every item when linked — through the
   *  same path a slider drag takes. */
  function write(p: string, k: number, v: number, linked: boolean, fine: boolean): void {
    const ss = specs.get(p)!;
    const before = ss.map((s) => ctx.get(s));
    const after = applyEdit(before, k, v, ss[k]!, linked, fine);
    for (let j = 0; j < count; j++) if (after[j] !== before[j]) ctx.set(ss[j]!, after[j]!);
  }

  // ---------------- the real row under the grid ----------------

  const detail = el("div", "vc-sc-detail");
  const detailHead = el("div", "vc-sc-detail-head");
  const detailRow = el("div", "vc-sc-detail-row");
  detail.append(detailHead, detailRow);
  detail.hidden = true;
  let detailKey = "";
  let detailHandle: { dispose(): void } | undefined;

  /** Mounts item k's real setting row under the grid — where its jack, patch
   *  and reset live. Called when a gesture on a lane or knob ends. */
  function showDetail(p: string, k: number): void {
    const spec = specs.get(p)![k]!;
    const key = `${p}:${k}`;
    if (key === detailKey) return;
    detailKey = key;
    detailHandle?.dispose();
    detail.hidden = false;
    detailHead.textContent = `${labels[k]} · ${spec.label}`;
    detailHead.style.color = colours[k] ?? "#fff";
    detailHandle = ctx.mountRows(detailRow, [{ spec }]);
  }
  disposers.push(() => detailHandle?.dispose());

  // ---------------- layouts ----------------

  const tabs = el("div", "vc-sc-tabs");
  tabs.setAttribute("role", "tablist");
  const tabBtns = (["lanes", "knobs"] as const).map((l) => {
    const b = el("button", "vc-sc-tab", l === "lanes" ? "Lanes" : "Knobs");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      layout = l;
      writeLayout(layoutKey, l);
      syncLayout();
    });
    tabs.appendChild(b);
    return b;
  });

  const lanesEl = el("div", "vc-sc-lanes");
  const knobsEl = el("div", "vc-sc-knobs");

  function syncLayout(): void {
    tabBtns.forEach((b, i) => b.setAttribute("aria-selected", String((i === 0 ? "lanes" : "knobs") === layout)));
    lanesEl.hidden = layout !== "lanes";
    knobsEl.hidden = layout !== "knobs";
  }

  // ---- Lanes ----
  for (const p of params) {
    const ss = specs.get(p)!;
    const row = el("div", "vc-sc-row");
    row.title = ss[0]!.description ?? "";
    const head = el("div", "vc-sc-row-head");
    head.appendChild(el("span", "vc-sc-row-title", ss[0]!.label));
    const linkBtn = el("button", "vc-sc-chip", "Link");
    linkBtn.type = "button";
    linkBtn.title = "Drag one strain and all of them move by the same amount";
    linkBtn.setAttribute("aria-pressed", "false");
    linkBtn.addEventListener("click", () => {
      link.set(p, !link.get(p));
      linkBtn.setAttribute("aria-pressed", String(!!link.get(p)));
    });
    head.appendChild(linkBtn);
    const lanes = el("div", "vc-sc-lane-list");
    const laneCells: Cell[] = [];
    for (let k = 0; k < count; k++) {
      const spec = ss[k]!;
      const lane = el("div", "vc-sc-lane");
      const code = el("span", "vc-sc-lane-code", labels[k]);
      const track = el("div", "vc-sc-track");
      track.tabIndex = 0;
      track.setAttribute("role", "slider");
      track.setAttribute("aria-label", `${spec.label} ${labels[k]}`);
      track.setAttribute("aria-valuemin", String(spec.min));
      track.setAttribute("aria-valuemax", String(spec.max));
      const rail = el("div", "vc-sc-rail");
      if (isHue(p)) rail.style.background = hueRailGradient(opts.hue!.baseHues[k] ?? 0);
      const fill = el("div", "vc-sc-fill");
      const thumb = el("div", "vc-sc-thumb");
      track.append(rail, fill, thumb);
      const val = el("span", "vc-sc-lane-val");
      lane.append(code, track, val);
      lanes.appendChild(lane);

      let dragging = false;
      const fromX = (e: PointerEvent, fine: boolean): void => {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return;
        write(p, k, fromUnit((e.clientX - r.left) / r.width, spec), !!link.get(p), fine);
      };
      track.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        track.focus();
        track.setPointerCapture(e.pointerId);
        dragging = true;
        adoptShown(p, k);
        fromX(e, false);
      });
      track.addEventListener("pointermove", (e) => {
        if (dragging) fromX(e, e.shiftKey);
      });
      const end = (): void => {
        if (!dragging) return;
        dragging = false;
        showDetail(p, k);
      };
      track.addEventListener("pointerup", end);
      track.addEventListener("pointercancel", end);
      track.addEventListener("dblclick", () => {
        write(p, k, spec.default, false, false);
        showDetail(p, k);
      });
      track.addEventListener("keydown", (e) => {
        const step = arrowStep(spec, e.shiftKey);
        let d = 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") d = step;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -step;
        else return;
        e.preventDefault();
        adoptShown(p, k);
        write(p, k, ctx.get(spec) + d, !!link.get(p), false);
        showDetail(p, k);
      });

      laneCells.push({
        spec,
        paint(value, colour) {
          const t = toUnit(value, spec) * 100;
          thumb.style.left = `${t}%`;
          thumb.style.background = colour;
          fill.style.width = isHue(p) ? "0" : `${t}%`;
          fill.style.background = colour;
          code.style.color = colour;
          val.textContent = formatValue(value, fmtOf(p), spec);
          track.setAttribute("aria-valuenow", value.toFixed(3));
        },
      });
    }
    row.append(head, lanes);
    lanesEl.appendChild(row);
    cells.set(`lanes:${p}`, laneCells);
  }

  // ---- Knobs ----
  const knobHeads: HTMLElement[] = [];
  knobsEl.appendChild(el("div"));
  for (let k = 0; k < count; k++) {
    const h = el("div", "vc-sc-knob-head", labels[k]);
    knobsEl.appendChild(h);
    knobHeads.push(h);
  }
  for (const p of params) {
    const ss = specs.get(p)!;
    const lbl = el("div", "vc-sc-knob-label", ss[0]!.label);
    lbl.title = ss[0]!.description ?? "";
    knobsEl.appendChild(lbl);
    const knobCells: Cell[] = [];
    for (let k = 0; k < count; k++) {
      const spec = ss[k]!;
      const kn = el("div", "vc-sc-knob");
      kn.tabIndex = 0;
      kn.setAttribute("role", "slider");
      kn.setAttribute("aria-label", `${spec.label} ${labels[k]}`);
      kn.setAttribute("aria-valuemin", String(spec.min));
      kn.setAttribute("aria-valuemax", String(spec.max));
      const kw = el("div", "vc-sc-kw");
      const plus = el("span", "vc-sc-sign vc-sc-plus", "+");
      const minus = el("span", "vc-sc-sign vc-sc-minus", "−");
      plus.setAttribute("aria-hidden", "true");
      minus.setAttribute("aria-hidden", "true");
      const svg = svgEl("svg", { viewBox: "0 0 34 34", "aria-hidden": "true" });
      const bg = svgEl("path", { fill: "none", stroke: "rgba(255,255,255,.14)", "stroke-width": "3", "stroke-linecap": "round", d: arcPath(17, 17, 13, KNOB_A0, KNOB_A0 + KNOB_ARC) });
      const fg = svgEl("path", { fill: "none", "stroke-width": "3", "stroke-linecap": "round" });
      const df = svgEl("line", { stroke: "rgba(255,255,255,.55)", "stroke-width": "1.5", "stroke-linecap": "round" });
      const nd = svgEl("line", { stroke: "#fff", "stroke-width": "2", "stroke-linecap": "round" });
      const ad = KNOB_A0 + KNOB_ARC * toUnit(spec.default, spec);
      df.setAttribute("x1", (17 + 14.5 * Math.cos(ad)).toFixed(2));
      df.setAttribute("y1", (17 + 14.5 * Math.sin(ad)).toFixed(2));
      df.setAttribute("x2", (17 + 17 * Math.cos(ad)).toFixed(2));
      df.setAttribute("y2", (17 + 17 * Math.sin(ad)).toFixed(2));
      svg.append(bg, fg, df, nd);
      kw.append(plus, minus, svg);
      const kv = el("span", "vc-sc-knob-val");
      kn.append(kw, kv);

      let drag: { x: number; y: number; raw: number } | null = null;
      let litTimer = 0;
      const lightSign = (dir: number): void => {
        plus.classList.toggle("lit", dir > 0);
        minus.classList.toggle("lit", dir < 0);
        window.clearTimeout(litTimer);
        litTimer = window.setTimeout(() => {
          plus.classList.remove("lit");
          minus.classList.remove("lit");
        }, 260);
      };
      disposers.push(() => window.clearTimeout(litTimer));
      const setActive = (on: boolean): void => {
        kn.classList.toggle("active", on);
        lbl.classList.toggle("on", on);
        knobHeads[k]!.classList.toggle("on", on);
      };
      kn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        kn.focus();
        kn.setPointerCapture(e.pointerId);
        adoptShown(p, k);
        drag = { x: e.clientX, y: e.clientY, raw: ctx.get(spec) };
        setActive(true);
      });
      kn.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (dx - dy) lightSign(dx - dy);
        // The unsnapped running value, so a slow drag isn't swallowed by the
        // step; each move applies from the last pointer position, so pressing
        // or releasing Shift/Alt mid-drag never jumps the value.
        drag.raw = Math.max(spec.min, Math.min(spec.max, drag.raw + knobDelta(dx, dy, spec, e.shiftKey)));
        write(p, k, drag.raw, e.altKey, e.shiftKey);
      });
      const end = (): void => {
        if (!drag) return;
        drag = null;
        setActive(false);
        showDetail(p, k);
      };
      kn.addEventListener("pointerup", end);
      kn.addEventListener("pointercancel", end);
      kn.addEventListener("dblclick", () => {
        write(p, k, spec.default, false, false);
        showDetail(p, k);
      });
      kn.addEventListener("keydown", (e) => {
        const step = arrowStep(spec, e.shiftKey);
        let d = 0;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") d = step;
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -step;
        else return;
        e.preventDefault();
        adoptShown(p, k);
        write(p, k, ctx.get(spec) + d, e.altKey, false);
        lightSign(d);
        showDetail(p, k);
      });
      knobsEl.appendChild(kn);

      knobCells.push({
        spec,
        paint(value, colour) {
          const t = toUnit(value, spec);
          const a = KNOB_A0 + KNOB_ARC * t;
          fg.setAttribute("d", t > 0.002 ? arcPath(17, 17, 13, KNOB_A0, a) : "");
          fg.setAttribute("stroke", colour);
          nd.setAttribute("x1", (17 + 6 * Math.cos(a)).toFixed(2));
          nd.setAttribute("y1", (17 + 6 * Math.sin(a)).toFixed(2));
          nd.setAttribute("x2", (17 + 12 * Math.cos(a)).toFixed(2));
          nd.setAttribute("y2", (17 + 12 * Math.sin(a)).toFixed(2));
          kv.textContent = formatValue(value, fmtOf(p), spec);
          kn.setAttribute("aria-valuenow", value.toFixed(3));
          kn.style.setProperty("--sc", colour);
          plus.classList.toggle("end", t > 0.998);
          minus.classList.toggle("end", t < 0.002);
        },
      });
    }
    cells.set(`knobs:${p}`, knobCells);
  }
  knobsEl.style.setProperty("--n", String(count));

  // ---------------- Synergy: the wheel and its real row ----------------

  let wheelUpdate: ((probe: Record<string, number> | null) => void) | undefined;
  const synergyEl = el("div", "vc-sc-syn");
  if (synergySpec && opts.hue) {
    const hue = opts.hue;
    const wheel = el("div", "vc-sc-wheel");
    wheel.setAttribute("aria-hidden", "true");
    wheel.appendChild(el("div", "vc-sc-wheel-ring"));
    const svg = svgEl("svg", { viewBox: "-32 -32 64 64" });
    const poly = svgEl("polygon", { fill: "rgba(255,255,255,.06)", stroke: "rgba(255,255,255,.5)", "stroke-width": "1" });
    const setDots: SVGCircleElement[] = [];
    const shownDots: SVGCircleElement[] = [];
    for (let k = 0; k < count; k++) {
      const c = svgEl("circle", { r: "2.6", fill: "none", "stroke-width": "1.2" });
      setDots.push(c);
    }
    for (let k = 0; k < count; k++) {
      const c = svgEl("circle", { r: "4", stroke: "#0b0f10", "stroke-width": "1.5" });
      shownDots.push(c);
    }
    svg.append(poly, ...setDots, ...shownDots);
    wheel.appendChild(svg);
    const rowHost = el("div", "vc-sc-syn-row");
    const harmony = el("div", "vc-sc-harmony");
    const left = el("div", "vc-sc-syn-left");
    left.append(wheel, harmony);
    synergyEl.append(left, rowHost);
    ctx.appendRow(rowHost, synergySpec);

    const stainSpecs = specs.get(hue.param);
    wheelUpdate = (probe) => {
      if (!stainSpecs) return;
      const syn = ctx.get(synergySpec);
      const hidx = probe?.harmony;
      harmony.textContent = syn > 0 && typeof hidx === "number" ? `nearest: ${HARMONIES[hidx]?.name ?? ""}` : "";
      const set = stainSpecs.map((s, k) => (hue.baseHues[k] ?? 0) + ctx.get(s));
      const shown = stainSpecs.map((s, k) => (hue.baseHues[k] ?? 0) + (probe?.[`shownStain${k}`] ?? ctx.get(s)));
      const order = shown.map((_, k) => k).sort((a, b) => (((shown[a]! % 1) + 1) % 1) - (((shown[b]! % 1) + 1) % 1));
      poly.setAttribute("points", order.map((k) => wheelPoint(shown[k]!, 25).map((x) => x.toFixed(2)).join(",")).join(" "));
      for (let k = 0; k < count; k++) {
        const [x, y] = wheelPoint(shown[k]!, 25);
        shownDots[k]!.setAttribute("cx", x.toFixed(2));
        shownDots[k]!.setAttribute("cy", y.toFixed(2));
        shownDots[k]!.setAttribute("fill", colours[k] ?? "#fff");
        const [rx, ry] = wheelPoint(set[k]!, 15);
        setDots[k]!.setAttribute("cx", rx.toFixed(2));
        setDots[k]!.setAttribute("cy", ry.toFixed(2));
        setDots[k]!.setAttribute("stroke", colours[k] ?? "#fff");
        setDots[k]!.style.opacity = syn > 0 ? "1" : "0";
      }
    };
  }

  // ---------------- assemble ----------------

  container.append(tabs, lanesEl, knobsEl, detail);
  if (synergySpec) container.appendChild(synergyEl);
  syncLayout();

  return {
    tick(next) {
      colours = next;
      const probe = ctx.probe();
      const active = layout === "lanes" ? "lanes" : "knobs";
      for (const p of params) {
        const values = shownValues(p, probe);
        const list = cells.get(`${active}:${p}`)!;
        for (let k = 0; k < count; k++) list[k]!.paint(values[k]!, colours[k] ?? "#fff");
      }
      if (layout === "knobs") knobHeads.forEach((h, k) => (h.style.color = colours[k] ?? "#fff"));
      wheelUpdate?.(probe);
    },
    dispose() {
      for (const d of disposers) d();
    },
  };
}
