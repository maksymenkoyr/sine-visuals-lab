import type { SceneSetting } from "../../render/sceneSettings.ts";
import { HARMONIES, paletteStains, shuffledStains, shuffleOrder } from "../../render/scenes/physarum2Synergy.ts";
import type { WidgetCtx } from "./registry.ts";
import {
  applyEdit,
  arrowStep,
  formatValue,
  fromUnit,
  hueRailGradient,
  quantize,
  randomValue,
  toUnit,
  valuesMatch,
  wheelPoint,
  type ValueFormat,
} from "./consoleMath.ts";

/**
 * The Strain Console: every per-strain setting for all the strains at once,
 * as lanes (one row per setting with a lane per strain on a shared scale,
 * plus a Link toggle), and Stain Synergy under them with a hue wheel. Built from the "Strain Console"
 * prototype (docs/scenes/physarum2/artifacts/strain-console.html) and mounted
 * by itemBoxes.ts into its own card, in place of the old one-strain-at-a-time
 * rows and their tap/checkbox selection.
 *
 * A lane edits the existing per-item setting (`ctx.get`/`ctx.set`, the
 * exact path a slider drag takes), so a Look, a reset and the TV see nothing
 * different. What the console can't draw is a row's wire panel, sparkline
 * and reset — so releasing a lane mounts that setting's real device-menu row
 * (`ctx.mountRows`) under the lanes, where a value is also typed exactly.
 *
 * Ports (2026-10-04): every lane starts with a port, and every row has a
 * group port before its title. Until its row is mounted a port is a stand-in
 * drawn with the real port's look (`ctx.portLook`); pressing it mounts that
 * row, pinned, and the row's real port moves into the lane (`portHost`), so
 * the wires, the wire panel and the cables are the patch bay's own. The group
 * port mounts strain 0's row with the other strains `linked`, the panel's
 * multi-item path: a wire plugged in there goes to every strain, and each
 * lane's own port can still change one strain afterwards (the group port
 * then reads mixed).
 *
 * Gestures: drag to set; double-click puts the default back; arrow keys step
 * (Shift = ten times as far). Link moves all the strains together. (A Knobs
 * layout — a setting-by-strain grid — sat beside the lanes until 2026-10-03.)
 *
 * Stain Synergy: the stain settings hold what was set; what the dish shows is
 * those pulled toward the nearest colour harmony (physarum2Synergy.ts). While
 * Synergy is above 0 the Stain controls show what the dish shows (the scene's
 * `probe()` `shownStain<k>`), and grabbing one starts from that — it becomes
 * the setting, so nothing jumps under the pointer. The wheel draws the set
 * hues hollow and the shown hues filled.
 *
 * The mix row (2026-10-02), under the lanes: a preset pill writes the values
 * it names (pressed while they still match), and Back undoes the last
 * Random, preset or colour action. Random (`randomize`) rolls the
 * `mix.random` params for every item over each setting's whole range —
 * Fogleman's random species configs, whose ranges these sliders already
 * span. It has no button here since 2026-10-03: the Strains card's one
 * Random (itemBoxes.ts) calls it along with the Pairs card's own. With
 * `colourActions`,
 * Shuffle hands the hues on screen round the items in a new order and New
 * palette deals a random harmony (physarum2Synergy.ts) — both write the
 * stains, nothing else. Back's history lives at module level, keyed by
 * `stateKey`, so it survives a Look apply or card Reset like pairPads.ts's own.
 *
 * Every word a person reads here is a spec label/description, a value or a
 * preset's own name and hint; the few fixed strings (Link, Back, Shuffle,
 * New palette) are the layout's own vocabulary.
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
  /** A plain setting drawn as a row under the lanes with a hue wheel beside it
   *  (Synergy). Needs `hue`. */
  synergy?: { key: string };
  /** The mix row — see this file's header. `random` names the params
   *  `randomize` rolls; each preset sets the params its `values` name, one
   *  value per item. */
  mix?: { random: readonly string[]; presets?: readonly ConsolePreset[] };
  /** Shuffle and New palette under the Synergy wheel. Needs `hue` and
   *  `synergy`. */
  colourActions?: boolean;
}

export interface ConsolePreset {
  name: string;
  /** One line shown under the pills while this preset is pressed. */
  hint: string;
  values: Readonly<Record<string, readonly number[]>>;
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
  /** Rolls the `mix.random` params for every item — see this file's header. */
  randomize(): void;
  /** The labels of the params `randomize` rolls (empty: it does nothing). */
  randomLabels: readonly string[];
  /** Refreshes every control from the settings. `colours` are the items' live
   *  colours (CSS), stain and all. */
  tick(colours: readonly string[]): void;
  dispose(): void;
}

/** Back's undo stack per console (`stateKey`) — module-level so it survives
 *  a full rebuild; in memory only. */
const HISTORY_MAX = 20;
/** How often the stand-in ports re-read their wires (ms). */
const PORT_SYNC_MS = 250;
const histories = new Map<string, Record<string, number[]>[]>();

const SVG_NS = "http://www.w3.org/2000/svg";

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
  let lastPortSync = -Infinity;
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

  // ---------------- the real row under the lanes ----------------

  const detail = el("div", "vc-sc-detail");
  const detailHead = el("div", "vc-sc-detail-head");
  const detailRow = el("div", "vc-sc-detail-row");
  detail.append(detailHead, detailRow);
  detail.hidden = true;
  let detailKey = "";
  let detailHandle: { dispose(): void } | undefined;

  /** Where each port sits: `${p}:${k}` per lane, `${p}:all` for a row's
   *  group port. The stand-in hides while the real port is moved in. */
  const portSlots = new Map<string, { slot: HTMLElement; standIn: HTMLButtonElement; specs: SceneSetting[]; look: string }>();
  let movedSlot: string | undefined;

  function addPort(host: HTMLElement, key: string, portSpecs: SceneSetting[], title: string, onPress: () => void): void {
    const slot = el("span", "vc-sc-port-slot");
    const standIn = el("button", "vc-drive-port");
    standIn.type = "button";
    standIn.title = title;
    standIn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPress();
    });
    slot.appendChild(standIn);
    host.appendChild(slot);
    portSlots.set(key, { slot, standIn, specs: portSpecs, look: "" });
  }

  /** Mounts item k's real setting row under the lanes — or, for `"all"`, the
   *  row that edits every item's setting together — where its wires, patch
   *  and reset live, its port moved into the lane. Called when a gesture on a
   *  lane ends (`pin` false) or a port is pressed (`pin` true). */
  function showDetail(p: string, k: number | "all", pin: boolean): void {
    const ss = specs.get(p)!;
    const spec = ss[k === "all" ? 0 : k]!;
    const key = `${p}:${k}`;
    if (key !== detailKey) {
      detailKey = key;
      detailHandle?.dispose();
      const prev = movedSlot ? portSlots.get(movedSlot) : undefined;
      if (prev) prev.standIn.hidden = false;
      detail.hidden = false;
      const all = k === "all";
      detailHead.textContent = all ? `All strains · ${spec.label}` : `${labels[k]} · ${spec.label}`;
      detailHead.style.color = all ? "#fff" : (colours[k] ?? "#fff");
      const target = portSlots.get(key);
      movedSlot = spec.drive && target ? key : undefined;
      if (movedSlot) target!.standIn.hidden = true;
      detailHandle = ctx.mountRows(detailRow, [
        {
          spec,
          portHost: movedSlot ? target!.slot : undefined,
          ...(all
            ? { ownLabel: labels[0], linked: ss.slice(1).map((s, j) => ({ spec: s, label: labels[j + 1]!, colour: colours[j + 1] })) }
            : {}),
        },
      ]);
    }
    if (pin && spec.drive) ctx.pin(spec);
  }
  disposers.push(() => detailHandle?.dispose());

  // ---------------- lanes ----------------

  const lanesEl = el("div", "vc-sc-lanes");

  for (const p of params) {
    const ss = specs.get(p)!;
    const row = el("div", "vc-sc-row");
    row.title = ss[0]!.description ?? "";
    const head = el("div", "vc-sc-row-head");
    const titleWrap = el("span", "vc-sc-row-name");
    if (ss[0]!.drive) {
      addPort(titleWrap, `${p}:all`, ss, `Click to wire every strain's ${ss[0]!.label} at once`, () => showDetail(p, "all", true));
    }
    titleWrap.appendChild(el("span", "vc-sc-row-title", ss[0]!.label));
    head.appendChild(titleWrap);
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
      const portCell = el("span", "vc-sc-lane-port");
      if (spec.drive) {
        addPort(portCell, `${p}:${k}`, [spec], `Click to choose what ${labels[k]}'s ${spec.label} listens to`, () => showDetail(p, k, true));
      }
      lane.append(portCell, code, track, val);
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
        showDetail(p, k, false);
      };
      track.addEventListener("pointerup", end);
      track.addEventListener("pointercancel", end);
      track.addEventListener("dblclick", () => {
        write(p, k, spec.default, false, false);
        showDetail(p, k, false);
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
        showDetail(p, k, false);
      });

      // paint() runs every tick; skip it while neither the value nor the
      // colour moved (NaN never equals, so the first call always paints).
      let lastV = NaN;
      let lastC = "";
      laneCells.push({
        spec,
        paint(value, colour) {
          if (value === lastV && colour === lastC) return;
          lastV = value;
          lastC = colour;
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
    cells.set(p, laneCells);
  }

  // ---------------- the mix row: Random, Back, presets ----------------

  let history = histories.get(args.stateKey);
  if (!history) histories.set(args.stateKey, (history = []));
  const hist = history;

  /** Writes each item's value for `p` through the slider path, skipping any
   *  that already match (so a preset doesn't persist untouched settings).
   *  Snapped to the step, except for Back (`exact`): a snapshot can hold a
   *  default that sits between steps, and must come back as it was. */
  function writeValues(p: string, values: readonly number[], exact = false): void {
    const ss = specs.get(p);
    if (!ss) return;
    for (let k = 0; k < count; k++) {
      const v = values[k];
      if (typeof v !== "number") continue;
      const q = exact ? v : quantize(v, ss[k]!);
      if (q !== ctx.get(ss[k]!)) ctx.set(ss[k]!, q);
    }
  }

  const mixEl = el("div", "vc-sc-mix");
  const mixRow = el("div", "vc-mix-row");
  const backBtn = el("button", undefined, "Back");
  backBtn.type = "button";
  backBtn.title = "Undo the last Random, preset or colour change";
  const syncBack = (): void => {
    backBtn.disabled = hist.length === 0;
  };
  /** Snapshots every console param before an action writes — Back's entry. */
  function pushHistory(): void {
    const snap: Record<string, number[]> = {};
    for (const p of params) snap[p] = stored(p);
    hist.push(snap);
    if (hist.length > HISTORY_MAX) hist.shift();
    syncBack();
  }
  backBtn.addEventListener("click", () => {
    const snap = hist.pop();
    if (snap) for (const p of Object.keys(snap)) writeValues(p, snap[p]!, true);
    syncBack();
  });

  const randomParams = (opts.mix?.random ?? []).filter((p) => specs.has(p));
  /** Random, pressed from outside (the Strains card's one Random,
   *  itemBoxes.ts): one entry on this console's Back. */
  function randomize(): void {
    if (!randomParams.length) return;
    pushHistory();
    for (const p of randomParams) writeValues(p, specs.get(p)!.map((spec) => randomValue(spec, Math.random)));
  }
  mixRow.appendChild(backBtn);
  mixEl.appendChild(mixRow);

  const presets = opts.mix?.presets ?? [];
  const presetPills: HTMLButtonElement[] = [];
  const presetHint = el("p", "vc-exp-hyp");
  if (presets.length) {
    const pills = el("div", "vc-exp-pills");
    for (const preset of presets) {
      const b = el("button", "vc-exp-pill", preset.name);
      b.type = "button";
      b.title = preset.hint;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        pushHistory();
        for (const p of Object.keys(preset.values)) writeValues(p, preset.values[p]!);
      });
      pills.appendChild(b);
      presetPills.push(b);
    }
    mixEl.append(pills, presetHint);
  }
  let lastPresetSig = "";
  /** Presses the pill whose values the stored settings still hold. */
  function syncPresets(): void {
    if (!presets.length) return;
    const sig = params.map((p) => stored(p).join(",")).join("|");
    if (sig === lastPresetSig) return;
    lastPresetSig = sig;
    const active = presets.findIndex((preset) =>
      Object.keys(preset.values).every((p) => {
        const ss = specs.get(p);
        return !ss || valuesMatch(stored(p), preset.values[p]!, ss[0]!);
      }),
    );
    presetPills.forEach((b, i) => b.setAttribute("aria-pressed", String(i === active)));
    presetHint.textContent = active >= 0 ? presets[active]!.hint : "";
  }
  syncBack();

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

    const stainSpecsForActions = specs.get(hue.param);
    if (opts.colourActions && stainSpecsForActions) {
      /** The hues on screen now (turns): base + the stain as shown. */
      const shownHues = (): number[] => {
        const probe = ctx.probe();
        return stainSpecsForActions.map((s, k) => (hue.baseHues[k] ?? 0) + (probe?.[`shownStain${k}`] ?? ctx.get(s)));
      };
      const colourRow = el("div", "vc-mix-row");
      const shuffleBtn = el("button", undefined, "Shuffle");
      shuffleBtn.type = "button";
      shuffleBtn.title = "Hand the colours on screen round the strains in a new order";
      shuffleBtn.addEventListener("click", () => {
        pushHistory();
        writeValues(hue.param, shuffledStains(shownHues(), hue.baseHues, shuffleOrder(count, Math.random)));
      });
      const paletteBtn = el("button", undefined, "New palette");
      paletteBtn.type = "button";
      paletteBtn.title = "Deal the strains a fresh set of colours from a random colour harmony";
      paletteBtn.addEventListener("click", () => {
        pushHistory();
        writeValues(hue.param, paletteStains(hue.baseHues.slice(0, count), Math.random));
      });
      colourRow.append(shuffleBtn, paletteBtn);
      synergyEl.appendChild(colourRow);
    }

    const stainSpecs = specs.get(hue.param);
    // What the wheel last drew, so a still frame writes nothing to the DOM.
    let lastHarmony = "";
    let lastPoints = "";
    let lastDots = "";
    wheelUpdate = (probe) => {
      if (!stainSpecs) return;
      const syn = ctx.get(synergySpec);
      const hidx = probe?.harmony;
      const harmonyText = syn > 0 && typeof hidx === "number" ? `nearest: ${HARMONIES[hidx]?.name ?? ""}` : "";
      if (harmonyText !== lastHarmony) {
        lastHarmony = harmonyText;
        harmony.textContent = harmonyText;
      }
      const set = stainSpecs.map((s, k) => (hue.baseHues[k] ?? 0) + ctx.get(s));
      const shown = stainSpecs.map((s, k) => (hue.baseHues[k] ?? 0) + (probe?.[`shownStain${k}`] ?? ctx.get(s)));
      const order = shown.map((_, k) => k).sort((a, b) => (((shown[a]! % 1) + 1) % 1) - (((shown[b]! % 1) + 1) % 1));
      const points = order.map((k) => wheelPoint(shown[k]!, 25).map((x) => x.toFixed(2)).join(",")).join(" ");
      if (points !== lastPoints) {
        lastPoints = points;
        poly.setAttribute("points", points);
      }
      const dotsSig = `${shown.join(",")}|${set.join(",")}|${syn > 0}|${colours.join(",")}`;
      if (dotsSig === lastDots) return;
      lastDots = dotsSig;
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

  container.appendChild(lanesEl);
  if (opts.mix || opts.colourActions) container.appendChild(mixEl);
  container.appendChild(detail);
  if (synergySpec) container.appendChild(synergyEl);

  return {
    randomize,
    randomLabels: randomParams.map((p) => specs.get(p)![0]!.label),
    tick(next) {
      colours = next;
      const probe = ctx.probe();
      for (const p of params) {
        const values = shownValues(p, probe);
        const list = cells.get(p)!;
        for (let k = 0; k < count; k++) list[k]!.paint(values[k]!, colours[k] ?? "#fff");
      }
      wheelUpdate?.(probe);
      syncPresets();
      syncBack();
      // Stand-in ports read the patch store, which decodes on every read —
      // a few times a second is plenty for a wire change to show.
      const now = performance.now();
      if (now - lastPortSync >= PORT_SYNC_MS) {
        lastPortSync = now;
        for (const port of portSlots.values()) {
          const look = ctx.portLook(port.specs);
          if (look !== port.look) port.standIn.style.cssText = port.look = look;
        }
      }
    },
    dispose() {
      for (const d of disposers) d();
    },
  };
}
