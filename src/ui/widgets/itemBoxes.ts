import type { SceneSetting } from "../../render/sceneSettings.ts";
import { groupHeading } from "../controlsKit.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { buildRelationPresets, buildRelationRows, type RelationPreset, type RelationWord } from "./relationRows.ts";
import { buildRelationWeb } from "./relationWeb.ts";

/**
 * The generic "item boxes" widget: one specimen box per item of a
 * `SceneSetting.item`-tagged family (code/label + colour LED + a colour
 * swatch area — live previews/readouts are Phase 3, so the swatch is just a
 * sized placeholder for now), a shared selection, and the selected item's
 * own controls rendered as real device-menu rows below the boxes. Built for
 * Physarum 2's four strains but generic over any scene's item family — a
 * future scene reuses this by declaring its own `Scene.panel` entry with
 * `widget: "itemBoxes"`.
 *
 * `options` (see `ItemBoxesOptions` below): `labels`/`colours` per item,
 * `rowOrder` — the per-item param keys (`SceneSetting.item.param`) to show,
 * in order — and an optional `relations` block for a *pairwise* family
 * (`att<i><j>`, via `sceneItems.ts`'s `defineItemPairs`): plain-word rows
 * from the selected item to every item (including itself), a compact SVG
 * web overview, and named presets. Affinity has no selection of its own —
 * it always follows the box selection (the approved UX) — so a click on a
 * box, a web node, or an experiment pill all funnel through the same
 * `ctx.rerender()` (see registry.ts's header for why a whole-card rebuild
 * is the right amount of work here rather than patching this widget's own
 * DOM). The current selection is the one piece of state this widget keeps
 * of its own, in localStorage keyed by (scene, family) — a convenience
 * only, wrapped in try/catch like every other localStorage read/write in
 * this codebase (sceneSettings.ts's own store is the precedent).
 */

export interface ItemBoxesOptions {
  /** Per-item display code/name, in index order. */
  labels: readonly string[];
  /** Per-item CSS colour, same order as `labels`. */
  colours: readonly string[];
  /** `SceneSetting.item.param` values to render, in display order, for
   *  whichever item is selected. */
  rowOrder: readonly string[];
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

    // Placeholder for Phase 3's live pure-item preview — sized now so that
    // work is a drop-in rather than a layout change.
    const preview = document.createElement("div");
    preview.className = "vc-item-preview";
    preview.setAttribute("aria-hidden", "true");

    box.append(head, preview);
    box.addEventListener("click", () => {
      if (i === selected) return;
      writeSelected(ctx.sceneId, family, i);
      ctx.rerender();
    });
    boxesEl.appendChild(box);
  }
  container.appendChild(boxesEl);

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
