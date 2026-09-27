import type { SceneSetting } from "../../render/sceneSettings.ts";
import { createStrainPreview, type StrainPreview } from "../../render/scenes/physarum2Preview.ts";
import { chipBtnLitStyle, chipBtnStyle, createChipButton, groupHeading } from "../controlsKit.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { getPreviewSource } from "./previews.ts";
import { buildRelationPresets, buildRelationRows, type RelationPreset, type RelationWord } from "./relationRows.ts";
import { buildRelationWeb } from "./relationWeb.ts";

/**
 * The generic "item boxes" widget: one specimen box per item of a
 * `SceneSetting.item`-tagged family (code/label + colour LED + a preview
 * area), a shared selection, and the selected item's own controls rendered
 * as real device-menu rows below the boxes. Built for Physarum 2's four
 * strains but generic over any scene's item family — a future scene reuses
 * this by declaring its own `Scene.panel` entry with `widget: "itemBoxes"`.
 *
 * `options` (see `ItemBoxesOptions` below): `labels`/`colours` per item,
 * `rowOrder` — the per-item param keys (`SceneSetting.item.param`) to show,
 * in order — an optional `relations` block for a *pairwise* family
 * (`att<i><j>`, via `sceneItems.ts`'s `defineItemPairs`): plain-word rows
 * from the selected item to every item (including itself), a compact SVG
 * web overview, and named presets — and an optional `preview` id (Phase 3).
 * Affinity has no selection of its own — it always follows the box selection
 * (the approved UX) — so a click on a box, a web node, or an experiment pill
 * all funnel through the same `ctx.rerender()` (see registry.ts's header for
 * why a whole-card rebuild is the right amount of work here rather than
 * patching this widget's own DOM). The current selection is the one piece of
 * state this widget keeps of its own, in localStorage keyed by (scene,
 * family) — a convenience only, wrapped in try/catch like every other
 * localStorage read/write in this codebase (sceneSettings.ts's own store is
 * the precedent).
 *
 * **Phase 3 (`options.preview`).** When set, `src/ui/widgets/previews.ts`'s
 * registry resolves it to a `PreviewSource` (size/agent count + an
 * `effective()` reader) and this widget:
 *   - mounts a live-stepping `<canvas>` per box (a self-contained
 *     `physarum2Preview.ts` sim, put-image-data'd through an offscreen
 *     native-resolution canvas onto the visible, CSS-scaled one — the exact
 *     two-canvas smoothing trick the "Physarum Lab" prototype's own
 *     `draw()` used, so a small backing buffer never looks pixelated), only
 *     stepping/drawing while both the Scene card is open (`ctx.onTick` only
 *     ever fires while the device menu is open — see registry.ts's header)
 *     and the box itself is on screen (`IntersectionObserver`), and only
 *     *stepping* every other tick (the draw itself is cheap; the agent+blur
 *     loop is what four boxes' worth would otherwise cost every rAF tick —
 *     see docs/scenes/physarum2.md's Phase 3 entry for the measured cost);
 *   - adds a POP/TERR/VIG readout row per box (`ctx.probe()` for
 *     population/territory, `ctx.driveValue()` on the item's own Nutrient
 *     setting for Vigour — no scene involvement for that last one);
 *   - adds a population bar + Rebalance button below the boxes
 *     (`ctx.command("rebalance", {})`);
 *   - adds a Pipette toggle next to it: while armed, the next pointerdown on
 *     the main visualisation canvas (`#gl` — see index.html) calls
 *     `ctx.command("inject", {x, y, strain})` with the tap converted to that
 *     canvas's own 0..1 fraction (DOM y-down flipped to the shader's
 *     vUv y-up — see physarum2.ts's coverUv/roomUv paragraph) and shows a
 *     brief amber ring at the tap point; staying armed for repeated taps
 *     until toggled off, Esc, or the panel closing (`ctx.onDispose`) removes
 *     the listener. This is deliberately a *toggle*, not an always-on tap:
 *     the canvas is also what the person is just watching, so accidental
 *     injects from an unrelated tap would be surprising — "this screen only"
 *     is stated in the button's own title since neither command reaches a
 *     paired TV. Armed-state is kept in an in-memory map keyed by (scene,
 *     family), like the selection above, but never in localStorage — an
 *     armed pipette shouldn't survive a reload.
 */

export interface ItemBoxesOptions {
  /** Per-item display code/name, in index order. */
  labels: readonly string[];
  /** Per-item CSS colour, same order as `labels`. */
  colours: readonly string[];
  /** `SceneSetting.item.param` values to render, in display order, for
   *  whichever item is selected. */
  rowOrder: readonly string[];
  /** A registered id in src/ui/widgets/previews.ts — see this file's header.
   *  Omit for the old sized placeholder swatch (no live preview/readouts/
   *  population bar/pipette). */
  preview?: string;
  relations?: {
    /** The pairwise family's key prefix (`defineItemPairs`'s own `key`,
     *  e.g. "att") — `<prefix><i><j>` is looked up directly. */
    prefix: string;
    title: string;
    words: readonly RelationWord[];
    presets?: readonly RelationPreset[];
  };
}

function selectStoreKey(sceneId: string, family: string): string {
  return `vibe.widgetSelect.${sceneId}.${family}`;
}

// Whether the pipette is armed, per (scene, family) — in-memory only (never
// localStorage: an armed pipette shouldn't survive a reload) but keyed the
// same way the selection above is, so it survives a `ctx.rerender()` (a box
// or Affinity-word click) instead of resetting the moment someone picks a
// different strain to inject next — see this file's header.
const pipetteArmedByFamily = new Map<string, boolean>();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A brief amber flash at the tap point — document-body-fixed so it isn't
 *  clipped by the panel's own scroll container, styled by controlsTheme.ts's
 *  `.vc-pipette-ring`/`@keyframes vc-pipette-pulse`. */
function showPipetteRing(clientX: number, clientY: number): void {
  const ring = document.createElement("div");
  ring.className = "vc-pipette-ring";
  ring.style.left = `${clientX}px`;
  ring.style.top = `${clientY}px`;
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 700);
}

function readSelected(sceneId: string, family: string, count: number): number {
  try {
    const raw = localStorage.getItem(selectStoreKey(sceneId, family));
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 && n < count ? n : 0;
  } catch {
    return 0;
  }
}

function writeSelected(sceneId: string, family: string, index: number): void {
  try {
    localStorage.setItem(selectStoreKey(sceneId, family), String(index));
  } catch {
    // Not fatal — the selection just won't survive a reload.
  }
}

function findPairSpec(
  specs: readonly SceneSetting[],
  family: string,
  param: string,
  i: number,
  j: number,
): SceneSetting | undefined {
  return specs.find((s) => s.item?.family === family && s.item.param === param && s.item.index === i && s.item.other === j);
}

registerWidget("itemBoxes", (container: HTMLElement, section, ctx: WidgetCtx) => {
  const family = section.items;
  const opts = section.options as ItemBoxesOptions | undefined;
  if (!family || !opts) return;
  const labels = opts.labels;
  const count = labels.length;
  if (count === 0) return;

  const selected = readSelected(ctx.sceneId, family, count);
  const previewSource = opts.preview ? getPreviewSource(opts.preview) : undefined;

  // Phase 3 per-box state, filled in the loop below only when a preview
  // source is registered — see this file's header.
  const previewSims: (StrainPreview | undefined)[] = [];
  const previewCanvases: (HTMLCanvasElement | undefined)[] = [];
  const previewOffscreen: (HTMLCanvasElement | undefined)[] = [];
  const previewVisible: boolean[] = [];
  const readoutEls: ({ pop: HTMLElement; terr: HTMLElement; vig: HTMLElement } | undefined)[] = [];

  const boxesEl = document.createElement("div");
  boxesEl.className = "vc-item-boxes";
  for (let i = 0; i < count; i++) {
    const box = document.createElement("button");
    box.type = "button";
    box.className = "vc-item-box" + (i === selected ? " vc-item-box-sel" : "");
    box.style.setProperty("--c", opts.colours[i] ?? "#fff");
    box.setAttribute("aria-pressed", String(i === selected));
    box.setAttribute("aria-label", `Select ${labels[i]}`);

    const head = document.createElement("div");
    head.className = "vc-item-box-head";
    const led = document.createElement("span");
    led.className = "vc-item-led";
    const code = document.createElement("span");
    code.className = "vc-item-code";
    code.textContent = labels[i] ?? "";
    head.append(led, code);

    let previewEl: HTMLElement;
    if (previewSource) {
      const canvas = document.createElement("canvas");
      canvas.className = "vc-item-preview";
      canvas.setAttribute("aria-hidden", "true");
      previewCanvases[i] = canvas;
      const off = document.createElement("canvas");
      off.width = previewSource.size;
      off.height = previewSource.size;
      previewOffscreen[i] = off;
      // Distinct, deterministic seeds per box — same spirit as the
      // "Physarum Lab" prototype's own `1000 + k * 97`.
      previewSims[i] = createStrainPreview({ size: previewSource.size, agents: previewSource.agents, seed: 1000 + i * 97 });
      previewVisible[i] = false;
      previewEl = canvas;
    } else {
      // Sized placeholder for a family with no registered preview.
      const placeholder = document.createElement("div");
      placeholder.className = "vc-item-preview";
      placeholder.setAttribute("aria-hidden", "true");
      previewEl = placeholder;
    }
    box.append(head, previewEl);

    if (previewSource) {
      const stats = document.createElement("div");
      stats.className = "vc-item-stats";
      const cell = (label: string): { el: HTMLElement; val: HTMLElement } => {
        const el = document.createElement("div");
        el.className = "vc-item-stat";
        const lbl = document.createElement("span");
        lbl.textContent = label;
        const val = document.createElement("b");
        val.textContent = "—";
        el.append(lbl, val);
        return { el, val };
      };
      const pop = cell("POP");
      const terr = cell("TERR");
      const vig = cell("VIG");
      stats.append(pop.el, terr.el, vig.el);
      box.appendChild(stats);
      readoutEls[i] = { pop: pop.val, terr: terr.val, vig: vig.val };
    }

    box.addEventListener("click", () => {
      if (i === selected) return;
      writeSelected(ctx.sceneId, family, i);
      ctx.rerender();
    });
    boxesEl.appendChild(box);
  }
  container.appendChild(boxesEl);

  if (previewSource) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const idx = previewCanvases.indexOf(en.target as HTMLCanvasElement);
          if (idx >= 0) previewVisible[idx] = en.isIntersecting;
        }
      },
      { threshold: 0.05 },
    );
    for (const c of previewCanvases) if (c) io.observe(c);
    ctx.onDispose(() => io.disconnect());

    // One nutrient spec per box, resolved once — Vigour reads it every tick
    // (ctx.driveValue), the widget side of the file header's Vigour bullet.
    const nutrientSpecs = Array.from({ length: count }, (_, i) => ctx.specsFor(family, i).find((s) => s.item?.param === "nutrient"));

    // --- Population bar + Rebalance + Pipette — see this file's header. ---
    const popWrap = document.createElement("div");
    popWrap.className = "vc-pop-wrap";
    const popBar = document.createElement("div");
    popBar.className = "vc-popbar";
    const popLabels = document.createElement("div");
    popLabels.className = "vc-poplabels";
    const popSegments: HTMLElement[] = [];
    const popLabelTexts: Text[] = [];
    for (let i = 0; i < count; i++) {
      const seg = document.createElement("span");
      seg.style.background = opts.colours[i] ?? "#fff";
      seg.style.width = `${100 / count}%`;
      popBar.appendChild(seg);
      popSegments.push(seg);

      const lbl = document.createElement("span");
      const dot = document.createElement("i");
      dot.style.background = opts.colours[i] ?? "#fff";
      // .vc-poplabels i's own box-shadow uses currentColor for its glow —
      // set alongside background so the glow tints the same as the dot.
      dot.style.color = opts.colours[i] ?? "#fff";
      const text = document.createTextNode(`${labels[i]} ${Math.round(100 / count)}%`);
      lbl.append(dot, text);
      popLabels.appendChild(lbl);
      popLabelTexts.push(text);
    }

    const actions = document.createElement("div");
    actions.className = "vc-pop-actions";
    const rebalanceBtn = createChipButton("Rebalance", "Reset every strain's population to an equal share", () => {
      ctx.command("rebalance", {});
    });
    const pipetteKey = `${ctx.sceneId}.${family}`;
    let pipetteArmed = pipetteArmedByFamily.get(pipetteKey) ?? false;
    const pipetteBtn = createChipButton(
      "Pipette",
      "Arm, then tap the visualisation to inject the selected strain there — this screen only, settings/commands don't reach the TV",
      () => {
        pipetteArmed = !pipetteArmed;
        pipetteArmedByFamily.set(pipetteKey, pipetteArmed);
        syncPipetteVisual();
      },
    );
    function syncPipetteVisual(): void {
      pipetteBtn.style.cssText = pipetteArmed ? chipBtnLitStyle : chipBtnStyle;
      pipetteBtn.setAttribute("aria-pressed", String(pipetteArmed));
    }
    syncPipetteVisual();
    actions.append(rebalanceBtn, pipetteBtn);
    popWrap.append(popBar, popLabels, actions);
    container.appendChild(popWrap);

    // The pipette taps the MAIN visualisation canvas (index.html's `#gl`,
    // the same element src/app.ts renders into), not anything inside this
    // panel — see this file's header for why that alone already satisfies
    // "ignore taps that land on the panel/UI" (the panel is separate DOM
    // stacked above/beside it; a tap on the panel never reaches the canvas
    // underneath). Capture phase, so a future canvas-level handler (there is
    // none today) can't swallow the tap first.
    const glCanvas = document.getElementById("gl") as HTMLCanvasElement | null;
    const onCanvasPointerDown = (e: PointerEvent): void => {
      if (!pipetteArmed || !glCanvas) return;
      const rect = glCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // DOM y grows downward; the shader's vUv (and this scene's screen-space
      // command args) grows upward — see physarum2.ts's coverUv/roomUv
      // paragraph on why this is the one flip needed here.
      const x = clamp01((e.clientX - rect.left) / rect.width);
      const y = clamp01(1 - (e.clientY - rect.top) / rect.height);
      ctx.command("inject", { x, y, strain: selected });
      showPipetteRing(e.clientX, e.clientY);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && pipetteArmed) {
        pipetteArmed = false;
        pipetteArmedByFamily.set(pipetteKey, false);
        syncPipetteVisual();
      }
    };
    glCanvas?.addEventListener("pointerdown", onCanvasPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    ctx.onDispose(() => {
      glCanvas?.removeEventListener("pointerdown", onCanvasPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    });

    // --- Per-tick: step/draw visible previews, refresh readouts + the
    // population bar. Stepping (not drawing) only every other tick — the
    // agent+blur loop is the expensive part; see this file's header. ---
    let tickCount = 0;
    ctx.onTick(() => {
      tickCount++;
      const stepThisTick = tickCount % 2 === 0;
      const probeData = ctx.probe();

      for (let i = 0; i < count; i++) {
        const sim = previewSims[i];
        const canvas = previewCanvases[i];
        const off = previewOffscreen[i];
        if (sim && canvas && off && previewVisible[i]) {
          const octx = off.getContext("2d");
          const effective = previewSource.effective(ctx, i);
          if (stepThisTick) sim.step(effective.motion);
          if (octx) {
            const img = octx.createImageData(sim.size, sim.size);
            img.data.set(sim.pixels(effective.color));
            octx.putImageData(img, 0, 0);
          }
          // Backing resolution follows the box's own CSS size (smooth,
          // non-pixelated scaling — this file's header); a zero-size canvas
          // (not yet laid out) just skips this tick's draw.
          const w = Math.round(canvas.clientWidth);
          const h = Math.round(canvas.clientHeight);
          if (w > 0 && h > 0) {
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            const vctx = canvas.getContext("2d");
            if (vctx) {
              vctx.imageSmoothingEnabled = true;
              vctx.imageSmoothingQuality = "high";
              vctx.clearRect(0, 0, canvas.width, canvas.height);
              vctx.drawImage(off, 0, 0, canvas.width, canvas.height);
            }
          }
        }

        const readout = readoutEls[i];
        if (readout) {
          const pop = probeData?.[`pop${i}`];
          const terr = probeData?.[`terr${i}`];
          const nutrientSpec = nutrientSpecs[i];
          // Prefer the scene's own reading: it includes the scene-default
          // source, which ctx.driveValue reports as 0 until a patch exists.
          const vig = probeData?.[`vig${i}`] ?? (nutrientSpec ? ctx.driveValue(nutrientSpec) : 0);
          readout.pop.textContent = pop !== undefined ? `${Math.round(pop * 100)}%` : "—";
          readout.terr.textContent = terr !== undefined ? `${Math.round(terr * 100)}%` : "—";
          readout.vig.textContent = vig.toFixed(2);
        }
      }

      if (probeData) {
        let total = 0;
        const shares: number[] = [];
        for (let i = 0; i < count; i++) {
          const p = probeData[`pop${i}`] ?? 0;
          shares.push(p);
          total += p;
        }
        for (let i = 0; i < count; i++) {
          const pct = total > 0 ? (shares[i]! / total) * 100 : 100 / count;
          popSegments[i]!.style.width = `${pct}%`;
          popLabelTexts[i]!.textContent = ` ${labels[i]} ${Math.round(pct)}%`;
        }
      }
    });
  }

  const rowsEl = document.createElement("div");
  rowsEl.className = "vc-item-rows";
  const itemSpecs = ctx.specsFor(family, selected);
  for (const paramKey of opts.rowOrder) {
    const spec = itemSpecs.find((s) => s.item?.param === paramKey);
    if (spec) ctx.appendRow(rowsEl, spec);
  }
  container.appendChild(rowsEl);

  const rel = opts.relations;
  if (!rel) return;

  container.appendChild(groupHeading(rel.title));

  const getRel = (i: number, j: number): number => {
    const spec = findPairSpec(ctx.specs, family, rel.prefix, i, j);
    return spec ? ctx.get(spec) : 0;
  };
  const setRel = (i: number, j: number, value: number): void => {
    const spec = findPairSpec(ctx.specs, family, rel.prefix, i, j);
    if (spec) ctx.set(spec, value);
    ctx.rerender();
  };

  const webWrap = document.createElement("div");
  webWrap.className = "vc-relweb-wrap";
  webWrap.appendChild(
    buildRelationWeb({
      count,
      colours: opts.colours,
      labels,
      selected,
      get: getRel,
      onSelect: (i) => {
        if (i === selected) return;
        writeSelected(ctx.sceneId, family, i);
        ctx.rerender();
      },
    }),
  );
  container.appendChild(webWrap);

  container.appendChild(buildRelationRows({ count, labels, selected, words: rel.words, get: getRel, set: setRel }));

  if (rel.presets?.length) {
    container.appendChild(
      buildRelationPresets({
        count,
        presets: rel.presets,
        get: getRel,
        apply: (matrix) => {
          for (let i = 0; i < count; i++) {
            for (let j = 0; j < count; j++) {
              const spec = findPairSpec(ctx.specs, family, rel.prefix, i, j);
              if (spec) ctx.set(spec, matrix[i]![j]!);
            }
          }
          ctx.rerender();
        },
      }),
    );
  }
});
