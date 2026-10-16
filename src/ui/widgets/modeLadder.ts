import { plateFieldAt, plateGauge, plateModeTable, plateOutline, PLATE_SHAPES, SQUARE, type PlateMode } from "../../render/scenes/chladniPlates.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { SCENE_VIOLET } from "../controlsTheme.ts";
import { setHintText } from "../hintSwatches.ts";
import { setLiveText } from "../liveText.ts";
import { watchOnScreen } from "../onScreen.ts";

/**
 * Chladni's Mode ladder (`Scene.panel` widget "modeLadder", its own card): one
 * row per figure of the plate on screen, low notes first, each with a picture
 * of its nodal lines and a bar for how hard it rings right now — its
 * amplitude in createPlateResponse, on a scale that never moves (RING_FLOOR
 * to RING_FULL: on broadband music every figure rings a little, and from 0
 * the bars would all read alike). The plate
 * sharpens those rings by Resonance before it blends the strongest few, so
 * the shares of the figures it draws (marked, the lead brightest) are much
 * steeper than the bars; and with Figure hold up, a challenger can ring
 * harder than the lead without taking the plate yet. The line under the list
 * names the figures on the plate, so they read even when scrolled out of
 * view.
 *
 * Clicking a row locks the plate on its figure: the scene's Locked figure
 * setting (the figure's table index plus one; 0 = none) makes the plate show
 * it alone whatever the music does, while the bars keep moving. Clicking it
 * again lets the music choose. ("Lock", not "pin": pin opens a wire panel,
 * docs/vocabulary.md.) Because it is a setting, the lock reaches the pop-out
 * output and a room's TV, and rides in a saved Look. It names a rung, not a
 * figure, so switching plates keeps the same rung locked on the new plate.
 *
 * Every reading comes from the scene's probe() (chladni.ts): `plate`,
 * `ring<k>` per table mode, and `slot<j>`/`share<j>` for the figures on the
 * plate, strongest first.
 */

const THUMB_PX = 44;
// A bar's ends, from the rings measured on the tempo-eval tracks and a song
// through the mic (docs/scenes/chladni.md, Measurements): the floor sits
// under the average figure's mean ring, full a little under the loudest.
const RING_FLOOR = 0.15;
const RING_FULL = 0.6;
// |f| over the figure's peak below which a thumbnail pixel lies on a line.
const LINE_WIDTH = 0.09;
// A figure drawn with less of the plate than this isn't marked.
const MARK_SHARE = 0.04;
// The shares and the line under the list change at most this often, so the
// numbers can be read; bars and marks follow every tick.
const WORDS_MS = 200;

const thumbCache = new Map<number, ImageData[]>();

/** Every figure of `shape` as a THUMB_PX square picture of its nodal lines. */
function thumbsFor(shape: number, table: readonly PlateMode[]): ImageData[] {
  const cached = thumbCache.get(shape);
  if (cached) return cached;
  const n = table.length;
  const px = THUMB_PX * THUMB_PX;
  const field = new Float32Array(n * px);
  const inside = new Uint8Array(px);
  const peak = new Float32Array(n);
  const outline = plateOutline(shape);
  for (let j = 0; j < THUMB_PX; j++) {
    // Canvas rows run down; the plate's y runs up.
    const y = 1 - (2 * (j + 0.5)) / THUMB_PX;
    for (let i = 0; i < THUMB_PX; i++) {
      const x = -1 + (2 * (i + 0.5)) / THUMB_PX;
      const t = j * THUMB_PX + i;
      if (plateGauge(outline, x, y) > 1) continue;
      inside[t] = 1;
      // The square is analytic, as CHLADNI_GLSL's chladni() draws it.
      const baked = shape === SQUARE ? null : plateFieldAt(shape, x, y);
      for (let k = 0; k < n; k++) {
        const { n: a, m: b, sign } = table[k];
        const f = baked
          ? baked[3 * k]
          : Math.cos(a * Math.PI * x) * Math.cos(b * Math.PI * y) + sign * Math.cos(b * Math.PI * x) * Math.cos(a * Math.PI * y);
        field[k * px + t] = f;
        peak[k] = Math.max(peak[k], Math.abs(f));
      }
    }
  }
  const [r, g, b] = [1, 3, 5].map((o) => parseInt(SCENE_VIOLET.slice(o, o + 2), 16));
  const out: ImageData[] = [];
  for (let k = 0; k < n; k++) {
    const img = new ImageData(THUMB_PX, THUMB_PX);
    const scale = peak[k] > 0 ? 1 / peak[k] : 0;
    for (let t = 0; t < px; t++) {
      if (!inside[t]) continue;
      const d = Math.min(1, (Math.abs(field[k * px + t]) * scale) / LINE_WIDTH);
      const line = 1 - d * d * (3 - 2 * d);
      img.data[4 * t] = r;
      img.data[4 * t + 1] = g;
      img.data[4 * t + 2] = b;
      img.data[4 * t + 3] = Math.round(255 * (0.1 + 0.9 * line));
    }
    out.push(img);
  }
  thumbCache.set(shape, out);
  return out;
}

interface Row {
  button: HTMLButtonElement;
  fill: HTMLElement;
  tag: HTMLElement;
  scale: number;
  on: "" | "lead" | "on";
}

registerWidget("modeLadder", (_container, section, ctx: WidgetCtx) => {
  const lockSpec = ctx.specs.find((s) => s.key === "lockFigure");
  const shapeSpec = ctx.specs.find((s) => s.key === "plateShape");
  if (!lockSpec) return;

  const right = document.createElement("span");
  right.textContent = "low notes first";
  right.style.cssText = "font-size: 11px; color: rgba(255,255,255,0.45); letter-spacing: 0.02em;";
  const card = ctx.mountCard({ title: section.title, accent: SCENE_VIOLET, right, foldId: `${ctx.sceneId}-mode-ladder` });

  const wrap = document.createElement("div");
  wrap.className = "vc-row";
  wrap.style.setProperty("--vc-accent", SCENE_VIOLET);
  const list = document.createElement("div");
  list.className = "vc-ladder-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Figures, low to high note. Press one to lock the plate on it.");
  const readout = document.createElement("div");
  readout.className = "vc-ladder-readout";
  const hintEl = document.createElement("div");
  hintEl.className = "vc-hint";
  setHintText(hintEl, section.hint ?? "");
  wrap.append(list, readout, hintEl);
  card.body.appendChild(wrap);
  const onScreen = watchOnScreen(list);

  let shape = -1;
  let table: readonly PlateMode[] = [];
  let rows: Row[] = [];
  let locked = -1;
  let lastWords = -Infinity;

  const storedLock = () => Math.round(ctx.get(lockSpec)) - 1;

  function syncPressed(): void {
    rows.forEach((row, k) => {
      const on = k === locked;
      row.button.setAttribute("aria-pressed", String(on));
      row.button.title = `${on ? "Let go of" : "Lock"} ${table[k].desc}`;
    });
    lastWords = -Infinity;
  }

  function build(s: number): void {
    shape = s;
    table = plateModeTable(s);
    const pictures = thumbsFor(s, table);
    list.replaceChildren();
    list.style.setProperty("--vc-ladder-name", `${Math.max(...table.map((m) => m.desc.length))}ch`);
    rows = table.map((mode, k) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vc-ladder-row";
      const thumb = document.createElement("canvas");
      thumb.width = thumb.height = THUMB_PX;
      thumb.setAttribute("aria-hidden", "true");
      thumb.getContext("2d")?.putImageData(pictures[k], 0, 0);
      const name = document.createElement("span");
      name.className = "vc-ladder-name";
      name.textContent = mode.desc;
      const track = document.createElement("span");
      track.className = "vc-ladder-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "vc-ladder-fill";
      track.appendChild(fill);
      const tag = document.createElement("span");
      tag.className = "vc-ladder-tag";
      button.append(thumb, name, track, tag);
      button.addEventListener("click", () => {
        locked = storedLock() === k ? -1 : k;
        ctx.set(lockSpec!, locked + 1);
        syncPressed();
      });
      list.appendChild(button);
      return { button, fill, tag, scale: -1, on: "" };
    });
    syncPressed();
    // Bring a locked figure into view once the rows have a layout.
    requestAnimationFrame(() => {
      const row = rows[locked];
      if (row) list.scrollTop = row.button.offsetTop - (list.clientHeight - row.button.offsetHeight) / 2;
    });
  }

  function tick(): void {
    const probe = ctx.probe();
    const onPlate = probe && Number.isFinite(probe.plate) && probe.plate! >= 0 ? probe.plate! : null;
    const s = onPlate ?? (shapeSpec ? Math.round(ctx.get(shapeSpec)) : SQUARE);
    if (s !== shape && s >= 0 && s < PLATE_SHAPES.length) {
      locked = storedLock();
      build(s);
    }
    // Follow a lock changed elsewhere (a Look, the room, a reset).
    const stored = storedLock();
    if (stored !== locked) {
      locked = stored;
      syncPressed();
    }
    if (!onScreen()) return;

    const now = performance.now();
    const words = now - lastWords >= WORDS_MS;
    if (words) lastWords = now;
    const marks = new Map<number, number>();
    if (probe) {
      for (let j = 0; `slot${j}` in probe; j++) {
        const share = probe[`share${j}`] ?? 0;
        if (share >= MARK_SHARE) marks.set(probe[`slot${j}`]!, share);
      }
    }
    let lead = -1;
    let best = 0;
    for (const [k, share] of marks) {
      if (share > best) {
        best = share;
        lead = k;
      }
    }

    rows.forEach((row, k) => {
      const ring = ((probe?.[`ring${k}`] ?? 0) - RING_FLOOR) / (RING_FULL - RING_FLOOR);
      const scale = Math.round(Math.max(0, Math.min(1, Number.isFinite(ring) ? ring : 0)) * 200) / 200;
      if (scale !== row.scale) {
        row.scale = scale;
        row.fill.style.transform = `scaleX(${scale})`;
      }
      const on = k === lead ? "lead" : marks.has(k) ? "on" : "";
      if (on !== row.on) {
        row.on = on;
        if (on) row.button.dataset.on = on;
        else delete row.button.dataset.on;
      }
      if (words) setLiveText(row.tag, k === locked ? "locked" : on ? `${Math.round(marks.get(k)! * 100)}%` : "");
    });

    if (!words) return;
    if (!probe) setLiveText(readout, "");
    else if (locked >= 0 && locked < table.length) setLiveText(readout, `Locked: ${table[locked].desc} · the music can't move it`);
    else {
      const shown = [...marks].sort((a, b) => b[1] - a[1]).map(([k, share]) => `${table[k]?.desc ?? "?"} ${Math.round(share * 100)}%`.replace(/ /g, "\u00a0"));
      setLiveText(readout, shown.length ? `On the plate: ${shown.join(" · ")}` : "");
    }
  }

  ctx.onTick(tick);
  ctx.onDispose(() => onScreen.disconnect());
  tick();
});
