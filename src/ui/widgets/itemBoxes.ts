import { createStrainPreview, type StrainPreview } from "../../render/scenes/physarum2Preview.ts";
import type { AffinityPreset, PairWords } from "../../render/scenes/physarum2Affinity.ts";
import { chipBtnLitStyle, chipBtnStyle, createChipButton } from "../controlsKit.ts";
import { SCENE_VIOLET } from "../controlsTheme.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { getPreviewSource, type PreviewEffective } from "./previews.ts";
import { buildPairPads } from "./pairPads.ts";
import { buildStrainConsole, type ConsoleOptions } from "./strainConsole.ts";

/**
 * The generic "item boxes" widget: one live specimen box per item of a
 * `SceneSetting.item`-tagged family (code/label + colour LED + a live preview
 * culture + POP/TERR/VIG readouts), the population bar with Rebalance and the
 * Pipette, and — mounted as their own cards right after the Scene card — the
 * Strain Console (`options.console`, src/ui/widgets/strainConsole.ts: every
 * per-item setting for all the items at once, as Lanes or Knobs) and the
 * Pairs pads (`options.relations`, src/ui/widgets/pairPads.ts). Built for
 * Physarum 2's four strains but generic over any scene's item family — a
 * future scene reuses this by declaring its own `Scene.panel` entry with
 * `widget: "itemBoxes"`.
 *
 * **No selection.** The boxes used to be a selection (tap = solo, checkbox =
 * group) whose rows showed one strain's settings at a time; the Strain Console
 * replaced that (2026-09-29), so a box now just names a strain for the
 * Pipette: tapping it aims the pipette at that strain and arms it; tapping the
 * armed box again disarms. Nothing here is persisted (an armed pipette
 * shouldn't survive a reload).
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
 *     setting for Vigour — no scene involvement for that last one). POP is
 *     the measured headcount — nobody sets it (physarum2.ts's Switching
 *     rule) — so the bar below is a read-only readout with Rebalance;
 *   - adds a Pipette toggle next to Rebalance: while armed, the next
 *     pointerdown on the main visualisation canvas (`#gl` — see index.html)
 *     calls `ctx.command("inject", {x, y, strain})` with the tap converted to
 *     that canvas's own 0..1 fraction (DOM y-down flipped to the shader's
 *     vUv y-up — see physarum2.ts's coverUv/roomUv paragraph) and shows a
 *     brief amber ring at the tap point; staying armed for repeated taps
 *     until toggled off, Esc, or the panel closing (`ctx.onDispose`) removes
 *     the listener. This is deliberately a *toggle*, not an always-on tap:
 *     the canvas is also what the person is just watching, so accidental
 *     injects from an unrelated tap would be surprising — "this screen only"
 *     is stated in the button's own title since neither command reaches a
 *     paired TV.
 *
 * One `effective()` reading per item per tick feeds the preview, the box's own
 * colour and the console's colours — Synergy and Stain move a strain's colour
 * live, so nothing here keeps the base colour past the first paint.
 */

export interface ItemBoxesOptions {
  /** Per-item display code/name, in index order. */
  labels: readonly string[];
  /** Per-item CSS colour, same order as `labels` — the colour until a preview
   *  source supplies the live one. */
  colours: readonly string[];
  /** A registered id in src/ui/widgets/previews.ts — see this file's header.
   *  Omit for the old sized placeholder swatch (no live preview/readouts/
   *  population bar/pipette). */
  preview?: string;
  /** Key of the plain setting that shapes the population split (Switching),
   *  drawn as a row under the population bar. List it in the section's
   *  `PanelSection.settings` too so the Scene card doesn't show it twice. */
  headcountSetting?: string;
  /** The Strain Console card (strainConsole.ts) — omit for no per-item
   *  settings card. */
  console?: ConsoleOptions & { title: string };
  relations?: {
    title: string;
    /** `item.param` of each pair table the Pairs widget edits
     *  (`defineItemPairs`'s own `key`, e.g. `{ smell: "att", touch:
     *  "touch" }`) — `touch` omitted hides the Smell/Touch switch. */
    tables: { smell: string; touch?: string };
    /** Short codes (e.g. "A1") for axis captions and pad-header values —
     *  same order as `labels`. */
    shortLabels: readonly string[];
    words: PairWords;
    presets?: readonly AffinityPreset[];
  };
}

// Whether the pipette is armed, and at which item, per (scene, family) — in
// memory only, but keyed so it survives a full widget rebuild (a Look apply, a
// card Reset — what still re-runs this builder) instead of resetting under one.
const pipetteArmedByFamily = new Map<string, boolean>();
const pipetteItemByFamily = new Map<string, number>();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function cssRgb(c: readonly [number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
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

/** Phase 3 preview sims persist across a full widget rebuild (a Look apply,
 *  a card Reset, reopening the panel) instead of restarting from noise every
 *  time: keyed by (scene, family, item index), looked up here and reattached
 *  to whatever new `<canvas>` this build made for it, rather than recreated
 *  with the rest of this function's own DOM. `PREVIEW_CACHE_MAX` is a safety
 *  net, not a real limit — one item family's worth of entries never gets close
 *  to it; it only matters if a session somehow visits far more item-preview
 *  scenes than exist today, and even then it just drops the oldest rather than
 *  growing forever. */
const PREVIEW_CACHE_MAX = 24;
const previewCache = new Map<string, StrainPreview>();

function cachedPreview(sceneId: string, family: string, index: number, size: number, agents: number): StrainPreview {
  const key = `${sceneId}:${family}:${index}`;
  let sim = previewCache.get(key);
  if (!sim) {
    // Distinct, deterministic seeds per box — same spirit as the
    // "Physarum Lab" prototype's own `1000 + k * 97`.
    sim = createStrainPreview({ size, agents, seed: 1000 + index * 97 });
    previewCache.set(key, sim);
    if (previewCache.size > PREVIEW_CACHE_MAX) {
      const oldest = previewCache.keys().next().value;
      if (oldest !== undefined) previewCache.delete(oldest);
    }
  }
  return sim;
}

registerWidget("itemBoxes", (container: HTMLElement, section, ctx: WidgetCtx) => {
  // Guarded, then re-declared with their definite (non-optional) type below
  // rather than relying on control-flow narrowing of `section.items`/
  // `section.options` themselves.
  if (!section.items || !section.options) return;
  const family: string = section.items;
  const opts = section.options as ItemBoxesOptions;
  const labels = opts.labels;
  const count = labels.length;
  if (count === 0) return;

  const previewSource = opts.preview ? getPreviewSource(opts.preview) : undefined;
  const pipetteKey = `${ctx.sceneId}.${family}`;
  let pipetteArmed = pipetteArmedByFamily.get(pipetteKey) ?? false;
  let pipetteItem = Math.min(count - 1, pipetteItemByFamily.get(pipetteKey) ?? 0);

  const boxEls: HTMLElement[] = [];
  const previewSims: (StrainPreview | undefined)[] = [];
  const previewCanvases: (HTMLCanvasElement | undefined)[] = [];
  const previewOffscreen: (HTMLCanvasElement | undefined)[] = [];
  const previewVisible: boolean[] = [];
  const readoutEls: ({ pop: HTMLElement; terr: HTMLElement; vig: HTMLElement } | undefined)[] = [];

  let pipetteBtn: HTMLButtonElement | undefined;
  function syncPipetteVisual(): void {
    for (let i = 0; i < count; i++) {
      const on = pipetteArmed && i === pipetteItem;
      boxEls[i]?.classList.toggle("vc-item-box-sel", on);
      boxEls[i]?.setAttribute("aria-pressed", String(on));
    }
    if (pipetteBtn) {
      pipetteBtn.style.cssText = pipetteArmed ? chipBtnLitStyle : chipBtnStyle;
      pipetteBtn.setAttribute("aria-pressed", String(pipetteArmed));
    }
  }
  function setPipette(armed: boolean, item = pipetteItem): void {
    pipetteArmed = armed;
    pipetteItem = item;
    pipetteArmedByFamily.set(pipetteKey, armed);
    pipetteItemByFamily.set(pipetteKey, item);
    syncPipetteVisual();
  }

  const boxesEl = document.createElement("div");
  boxesEl.className = "vc-item-boxes";
  for (let i = 0; i < count; i++) {
    // A `<div>` with button semantics, like the checkbox-carrying box it grew
    // from — `role`/`tabIndex`/the keydown handler below give it native-button
    // behaviour.
    const box = document.createElement("div");
    box.className = "vc-item-box";
    box.style.setProperty("--c", opts.colours[i] ?? "#fff");
    box.setAttribute("role", "button");
    box.tabIndex = 0;
    box.setAttribute("aria-pressed", "false");
    box.setAttribute("aria-label", labels[i] ?? "");
    box.title = "Aim the pipette at this one";
    boxEls[i] = box;

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
      // Reattached from the persisted cache rather than recreated — see
      // cachedPreview's doc comment (the "cultures restart on every click" fix).
      previewSims[i] = cachedPreview(ctx.sceneId, family, i, previewSource.size, previewSource.agents);
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

    const aim = (): void => setPipette(!(pipetteArmed && pipetteItem === i), i);
    box.addEventListener("click", aim);
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      aim();
    });
    boxesEl.appendChild(box);
  }
  container.appendChild(boxesEl);

  // Live colours, refreshed once per tick below — the base colour until then.
  let liveColours: string[] = [...opts.colours];
  let consoleTick: ((colours: readonly string[]) => void) | undefined;

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
    const rebalanceBtn = createChipButton("Rebalance", "Put every strain back to an equal share", () => {
      ctx.command("rebalance", {});
    });
    pipetteBtn = createChipButton(
      "Pipette",
      "Arm, then tap the visualisation to inject the chosen strain there — tap a box above to choose which. This screen only, settings/commands don't reach the TV",
      () => setPipette(!pipetteArmed),
    );
    syncPipetteVisual();
    actions.append(rebalanceBtn, pipetteBtn);
    popWrap.append(popBar, popLabels, actions);
    container.appendChild(popWrap);
    // The one setting that shapes the headcount (Switching), as a real row
    // right under the bar it moves.
    const headcountSpec = opts.headcountSetting ? ctx.specs.find((s) => s.key === opts.headcountSetting) : undefined;
    if (headcountSpec) ctx.appendRow(container, headcountSpec);

    // The pipette taps the MAIN visualisation canvas (index.html's `#gl`,
    // the same element src/app.ts renders into), not anything inside this
    // panel — the panel is separate DOM stacked above/beside it, so a tap on
    // it never reaches the canvas underneath. Capture phase, so a future
    // canvas-level handler (there is none today) can't swallow the tap first.
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
      ctx.command("inject", { x, y, strain: pipetteItem });
      showPipetteRing(e.clientX, e.clientY);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && pipetteArmed) setPipette(false);
    };
    glCanvas?.addEventListener("pointerdown", onCanvasPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    ctx.onDispose(() => {
      glCanvas?.removeEventListener("pointerdown", onCanvasPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    });

    // --- Per-tick: step/draw visible previews, refresh readouts + the
    // population bar + the console. Stepping (not drawing) only every other
    // tick — the agent+blur loop is the expensive part; see this file's
    // header. ---
    let tickCount = 0;
    ctx.onTick(() => {
      tickCount++;
      const stepThisTick = tickCount % 2 === 0;
      const probeData = ctx.probe();
      const effective: PreviewEffective[] = [];
      for (let i = 0; i < count; i++) effective.push(previewSource.effective(ctx, i));
      liveColours = effective.map((e) => cssRgb(e.color));

      for (let i = 0; i < count; i++) {
        boxEls[i]?.style.setProperty("--c", liveColours[i]!);
        const sim = previewSims[i];
        const canvas = previewCanvases[i];
        const off = previewOffscreen[i];
        if (sim && canvas && off && previewVisible[i]) {
          const octx = off.getContext("2d");
          const eff = effective[i]!;
          if (stepThisTick) sim.step(eff.motion);
          if (octx) {
            const img = octx.createImageData(sim.size, sim.size);
            img.data.set(sim.pixels(eff.color));
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
          popSegments[i]!.style.background = liveColours[i]!;
          popLabelTexts[i]!.textContent = ` ${labels[i]} ${Math.round(pct)}%`;
        }
      }
      consoleTick?.(liveColours);
    });
  }

  // The Strain Console — its own card right after the Scene card (the Pairs
  // card below follows it): the same reasoning as the Pairs card (its file
  // header, "Its own card") — a block that wants air and its own fold rather
  // than more rows inside the Scene card's body. `mountCard` is only rebuilt by
  // `renderSceneSettings` (deviceMenu.ts), the same trigger that rebuilds this
  // whole widget.
  if (opts.console) {
    const card = ctx.mountCard({
      title: opts.console.title,
      accent: SCENE_VIOLET,
      foldId: `${ctx.sceneId}-${family}-console`,
    });
    const strainConsole = buildStrainConsole({
      ctx,
      container: card.body,
      family,
      labels,
      colours: opts.colours,
      opts: opts.console,
      stateKey: `${ctx.sceneId}:${family}`,
    });
    consoleTick = (colours) => strainConsole.tick(colours);
    // Without a preview source nothing above ticks; the console still needs to.
    if (!previewSource) ctx.onTick(() => strainConsole.tick(liveColours));
    else strainConsole.tick(liveColours);
    ctx.onDispose(() => strainConsole.dispose());
  }

  const rel = opts.relations;
  if (!rel) return;

  // Its own card, right after the Scene card — see pairPads.ts's own file
  // header, "Its own card, four rows" (2026-09-28), for why this replaced a
  // plain `groupHeading` inside the Scene card body. `pair`/`effective` are the
  // same previewSource this widget's own boxes already resolved above
  // (`opts.preview`), so a pad's culture reads the identical live motion/colour
  // a specimen box's own preview does.
  const card = ctx.mountCard({
    title: rel.title,
    accent: SCENE_VIOLET,
    foldId: `${ctx.sceneId}-${family}-affinity`,
  });
  const pads = buildPairPads({
    ctx,
    container: card.body,
    family,
    count,
    labels,
    shortLabels: rel.shortLabels,
    colours: opts.colours,
    tables: rel.tables,
    words: rel.words,
    presets: rel.presets ?? [],
    effective: previewSource ? (k) => previewSource.effective(ctx, k) : undefined,
    pair: previewSource?.pair,
    stateKey: `${ctx.sceneId}:${family}`,
  });
  ctx.onTick(() => pads.tick());
  ctx.onDispose(() => pads.dispose());
});
