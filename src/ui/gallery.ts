import type { Scene } from "../render/scene.ts";
import type { QualityPreset, QualitySettings } from "../render/quality.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createSyntheticFeed } from "../audio/synthetic.ts";
import { createPreviewRenderer, type PreviewRenderer } from "../render/previewRenderer.ts";
import { createAnimClock, type AnimClock } from "../render/animClock.ts";
import { PALETTES, type Palette } from "../render/palette.ts";
import { PRODUCT_NAME, SOURCE_URL } from "../brand.ts";
import { RENDER_FPS_CAP_FLOOR, shouldRenderFrame, targetFrameIntervalMs } from "../render/framePace.ts";
import { getPowerMode } from "../render/powerMode.ts";
import { selectDueTiles, type ScheduleCandidate } from "../render/previewSchedule.ts";
import { createPreviewBudgetController, type PreviewBudgetController } from "../render/previewBudget.ts";

export interface GallerySceneEntry {
  scene: Scene;
  /** Whether this device's GPU quality preset can run the scene fullscreen. */
  enabled: boolean;
  /** Rougher, unpolished scenes sit behind the gallery's collapsed "draft"
   *  section and carry a small badge — see DRAFT_SCENE_IDS in scenes/index.ts. */
  draft: boolean;
  /** Shown on a disabled tile, e.g. "Needs a faster device". */
  reason?: string;
}

export interface GalleryDeps {
  scenes: () => GallerySceneEntry[];
  quality: () => QualitySettings;
  /** The real (mic-driven) frame, once audio is running — null before then,
   *  which is what makes tiles fall back to their synthetic groove. */
  liveFrame: () => FeatureFrame | null;
  /** Fired synchronously inside the tile's click handler, so the gesture is
   *  still fresh enough to unlock getUserMedia/AudioContext downstream. */
  onPick: (sceneId: string) => void;
  onDisabledPick: (sceneId: string, reason: string) => void;
  /** Whether this device can offer the Screen source at all — see
   *  src/audio/sourcePref.ts's displayCaptureSupported. Branches the
   *  subtitle's copy so it never names an option a mobile visitor won't see. */
  canCaptureDisplay: () => boolean;
}

export interface Gallery {
  show(): void;
  hide(): void;
  /** Call every rAF tick while the gallery is showing; self-throttles to the
   *  device's own render-rate cap (framePace.ts), same policy as the
   *  fullscreen viz, and further self-limits which tiles actually redraw —
   *  see the priority-band comments above createGallery. */
  tick(nowMs: number): void;
  setError(msg: string | null): void;
  destroy(): void;
}

const rootStyle = `
  position: fixed; inset: 0; z-index: 15; overflow-y: auto; display: none;
  background: #000; color: #fff; font-family: system-ui, sans-serif;
  padding: 28px 20px 40px;
`;
const headerStyle = `max-width: 1100px; margin: 0 auto 24px;`;
const titleStyle = `font-size: 22px; font-weight: 700;`;
const subtitleStyle = `font-size: 13px; opacity: 0.55; margin-top: 4px;`;
const sourceLinkStyle = `font-size: 12px; opacity: 0.45; margin-top: 6px; display: inline-block; color: inherit;`;
const errorStyle = `
  max-width: 1100px; margin: 0 auto 16px; padding: 10px 14px; border-radius: 8px;
  background: #4a1a1a; border: 1px solid #f66a; font-size: 13px; display: none;
`;
const gridStyle = `
  display: grid; gap: 16px; max-width: 1100px; margin: 0 auto;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
`;
const tileStyle = `
  background: #111; border: 1px solid #fff2; border-radius: 16px; padding: 8px;
  cursor: pointer; text-align: left; font: inherit; color: #fff;
  display: block; width: 100%;
`;
const canvasStyle = `width: 100%; display: block; aspect-ratio: 16 / 9; border-radius: 12px; background: #000;`;
const captionStyle = `display: flex; justify-content: space-between; align-items: baseline; padding: 10px 6px 4px;`;
// The name sits alongside its (optional) draft badge in one flex group so the
// badge stays right next to the name rather than being pushed to the tile's
// far edge by captionStyle's space-between — `reason` still owns that edge.
const nameGroupStyle = `display: flex; align-items: baseline; gap: 7px; min-width: 0;`;
const nameStyle = `
  font-size: 14px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
`;
const badgeStyle = `
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
  color: #fffa; background: #fff2; border: 1px solid #fff3;
  border-radius: 999px; padding: 1px 7px; flex-shrink: 0;
`;
const reasonStyle = `font-size: 11px; opacity: 0.6; flex-shrink: 0;`;
// Sized as a real button, not a caption: this is how the draft scenes are
// reached at all, and it has to be findable on a TV or a phone at arm's length.
const draftToggleStyle = `
  display: block; margin: 28px auto 0; padding: 14px 28px;
  background: #fff1; border: 1px solid #fff3; color: #fffd; font: inherit;
  font-size: 17px; font-weight: 600; letter-spacing: 0.01em;
  cursor: pointer; border-radius: 999px; min-height: 48px;
`;

const PREVIEW_W = 480;
const PREVIEW_H = 270;

// A thumbnail doesn't need fullscreen-viz quality — same per-pixel raymarch
// cost as the real thing otherwise, across every scene, every tick.
const PREVIEW_QUALITY_SCALE = 0.4;

// Tiles don't all need to redraw at the same rate: rather than spreading one
// shared frame rate thin across every visible tile (what used to happen —
// see the round-robin this replaced), each tile gets its own target
// interval by priority band, and previewSchedule.ts's overdue-first
// selection spends the per-tick draw budget on whichever tiles actually hit
// their target. A tile that's skipped costs nothing to leave alone — the
// last blit it made stays on screen — so concentrating the budget on the
// tile the user is actually looking at, at full rate, beats making every
// visible tile equally choppy.
//
// Expressed as multiples of the base interval (itself the device's own
// render-rate cap, see tickIntervalMs()) so they scale automatically with
// Energy saving On and with a floor-preset device's slower cap, rather than
// hardcoding separate fps numbers that could drift out of step with it.
const NEAR_INTERVAL_MULT = 3;
const FAR_INTERVAL_MULT = 10;

// Eligibility cutoff (a tile below this intersection ratio is skipped
// entirely, same threshold the old visible/not-visible flag used) and the
// near/far split within what remains — "near" is substantially on screen,
// "far" is a sliver scrolled into view but not what anyone's looking at.
const MIN_VISIBLE_RATIO = 0.01;
const NEAR_VISIBLE_RATIO = 0.6;

// Per-tick draw-budget ceiling by detected device quality (quality.ts) —
// the most tiles previewBudgetController is ever allowed to ask for, even
// once its own EWMA says the device has room. floor/low keep roughly what
// the old fixed round-robin constant gave every device; mid/high can afford
// far more since a preview tile costs a small fraction of one fullscreen
// viz frame at PREVIEW_QUALITY_SCALE.
const BUDGET_CEILING_BY_PRESET: Record<QualityPreset, number> = {
  high: 12,
  mid: 6,
  low: 3,
  floor: 2,
};

/** Derives a permanently-reduced quality for gallery previews from the
 *  device's detected/chosen quality — a snapshot, not a live reference, so it
 *  stays fixed regardless of what the main viz's quality governor
 *  (governor.ts) later does to the fullscreen settings object. Never scales
 *  *up*: Math.min keeps a floor-preset device's own (already low) ceiling as
 *  the limit. */
function reducedPreviewQuality(q: QualitySettings): QualitySettings {
  return {
    preset: q.preset,
    renderScale: Math.min(q.renderScale, 0.5),
    maxParticles: Math.round(q.maxParticles * PREVIEW_QUALITY_SCALE),
    raymarchSteps: Math.max(8, Math.round(q.raymarchSteps * PREVIEW_QUALITY_SCALE)),
    bloomPasses: 0,
    detail: Math.min(q.detail, PREVIEW_QUALITY_SCALE),
  };
}

/** The gallery's base tick interval — same cap policy as the fullscreen viz
 *  (see app.ts's renderIntervalMs, which this mirrors): a floor-preset
 *  device gets RENDER_FPS_CAP_FLOOR, everyone else framePace.ts's normal
 *  cap, and a deliberate Energy saving On always drops to the floor rate
 *  regardless of preset. The gallery previously ignored power mode
 *  entirely — this is what makes "On" actually reach preview tiles. */
function tickIntervalMs(preset: QualityPreset): number {
  return getPowerMode() === "on" ? 1000 / RENDER_FPS_CAP_FLOOR : targetFrameIntervalMs(preset);
}

/** How often one tile wants to be redrawn, as a multiple of the shared base
 *  interval — see the NEAR_INTERVAL_MULT/FAR_INTERVAL_MULT comment above.
 *  Disabled tiles are pinned to the slow band regardless of hover/scroll:
 *  they can't be picked, so there's nothing to lose by starving them for
 *  budget the pickable tiles can use instead.
 *
 *  `noContention` is what keeps the common case — the default gallery's
 *  handful of featured tiles, comfortably inside the budget — identical to
 *  "draw everyone every tick": banding only exists to ration a budget that's
 *  actually scarce, and with room to spare there's nothing to ration. Without
 *  it, a 3-tile gallery with nothing hovered would throttle two of its three
 *  tiles to the near/far rate for no reason — the exact regression this
 *  guards against. */
function targetIntervalMsFor(t: Tile, isFocused: boolean, baseIntervalMs: number, noContention: boolean): number {
  if (!t.enabled) return baseIntervalMs * FAR_INTERVAL_MULT;
  if (isFocused || noContention) return baseIntervalMs;
  return t.visibleRatio >= NEAR_VISIBLE_RATIO
    ? baseIntervalMs * NEAR_INTERVAL_MULT
    : baseIntervalMs * FAR_INTERVAL_MULT;
}

interface Tile {
  scene: Scene;
  canvas: HTMLCanvasElement;
  sink: ReturnType<PreviewRenderer["attach"]>;
  feed: ReturnType<typeof createSyntheticFeed>;
  palette: Palette;
  anim: AnimClock;
  /** Wall-clock ms this tile last actually drew — distinct from the shared
   *  tick cadence now that tiles draw at their own priority-band rate, so
   *  each tile's anim clock (pulse decay, flow phase, etc.) advances by its
   *  own true elapsed time, not the global tick interval (which would
   *  under-decay/under-advance a tile drawn less often than every tick).
   *  0 = never drawn yet. */
  lastDrawMs: number;
  /** Whether this device's GPU quality preset can run the scene fullscreen —
   *  mirrors GallerySceneEntry.enabled. A disabled tile always lands in the
   *  slow "far" priority band regardless of hover/scroll position, freeing
   *  budget for tiles the user can actually pick. */
  enabled: boolean;
  /** This tile's last IntersectionObserver ratio (0..1) — drives both the
   *  eligibility cutoff and the near/far priority split. Draft tiles start
   *  at 0 (built into a possibly still-collapsed section, before the
   *  observer's first callback can fire); featured tiles start at 1. */
  visibleRatio: number;
}

export function createGallery(deps: GalleryDeps): Gallery {
  const root = document.createElement("div");
  root.style.cssText = rootStyle;

  const header = document.createElement("div");
  header.style.cssText = headerStyle;
  const title = document.createElement("div");
  title.textContent = PRODUCT_NAME;
  title.style.cssText = titleStyle;
  const subtitle = document.createElement("div");
  subtitle.textContent = deps.canCaptureDisplay()
    ? "Pick a visual — tap to start on your mic, or share a tab for cleaner sound."
    : "Pick a visual — tap to start with your mic.";
  subtitle.style.cssText = subtitleStyle;
  // The AGPL §13 network-source offer — see src/brand.ts.
  const sourceLink = document.createElement("a");
  sourceLink.textContent = "Source (AGPL-3.0)";
  sourceLink.href = SOURCE_URL;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener";
  sourceLink.style.cssText = sourceLinkStyle;
  header.append(title, subtitle, sourceLink);

  const errorBanner = document.createElement("div");
  errorBanner.style.cssText = errorStyle;

  const grid = document.createElement("div");
  grid.style.cssText = gridStyle;

  // Collapsed by default — see expandDrafts/collapseDrafts below. Built lazily
  // so a first-time visitor never pays for compiling the draft shaders.
  const draftToggle = document.createElement("button");
  draftToggle.style.cssText = draftToggleStyle;
  draftToggle.style.display = "none";

  const draftGrid = document.createElement("div");
  draftGrid.style.cssText = gridStyle;
  draftGrid.style.display = "none";

  root.append(header, errorBanner, grid, draftToggle, draftGrid);
  document.body.appendChild(root);

  let preview: PreviewRenderer | null = null;
  let tiles: Tile[] = [];
  let lastDrawMs = 0;
  let visible = false;
  // The device preset last captured in show() — drives both the tick
  // interval (tickIntervalMs()) and the budget controller's ceiling
  // (BUDGET_CEILING_BY_PRESET). Not read from deps.quality() live inside
  // tick(): reducedPreviewQuality() already treats the device quality as a
  // one-time snapshot for the same reason (see its own comment), and a mid-
  // session preset change would otherwise resize the tick cadence a running
  // animation is being timed against.
  let preset: QualityPreset = "mid";
  // Rebuilt fresh each show() alongside everything else tiles-related — see
  // the comment on `preset` above for why it isn't just read live.
  let budgetController: PreviewBudgetController | null = null;
  // The tile currently under the pointer, if any — see the delegated
  // pointerover/pointerleave listeners below. Falls back to "nearest the
  // viewport center" in tick() when null (e.g. on a touch device, or the
  // pointer is elsewhere on the page).
  let hoveredTile: Tile | null = null;

  // Draft-section state. Rebuilt (along with everything else) on every show(),
  // so these describe the *current* build cycle, not something persisted
  // across it — draftsExpanded is the one flag that survives a rebuild.
  let pendingDrafts: GallerySceneEntry[] = [];
  let pendingDraftStartIndex = 0;
  let draftsBuilt = false;
  let draftsExpanded = false;

  // Reverse lookup from DOM element back to Tile, for the IntersectionObserver
  // callback and the delegated pointer listeners below — avoids an O(tiles)
  // Array.find on every callback/event. WeakMaps need no explicit teardown on
  // rebuild: entries for discarded elements just become unreachable.
  const tileByCanvas = new WeakMap<Element, Tile>();
  const tileByButton = new WeakMap<Element, Tile>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const tile = tileByCanvas.get(e.target);
        if (tile) tile.visibleRatio = e.intersectionRatio;
      }
    },
    // A handful of steps, not just one crossing point: tick() needs a
    // continuous-enough signal to tell "a sliver scrolled into view" (far
    // band) from "substantially on screen" (near band), not just in/out.
    { threshold: [0, MIN_VISIBLE_RATIO, 0.25, NEAR_VISIBLE_RATIO, 0.75, 1] },
  );

  // Delegated rather than per-tile: one pair of listeners on the root covers
  // every tile, present and future (drafts built lazily on expand included).
  root.addEventListener("pointerover", (e) => {
    const btn = (e.target as Element | null)?.closest("button") ?? null;
    hoveredTile = btn ? (tileByButton.get(btn) ?? null) : null;
  });
  // pointerleave (not pointerout) doesn't bubble, so it only fires here when
  // the pointer actually leaves the gallery's root — exactly the "moved
  // somewhere pointerover can't tell us about" case pointerover's own
  // bubbling already covers for every in-root move.
  root.addEventListener("pointerleave", () => {
    hoveredTile = null;
  });

  /** The one tile that gets drawn every tick regardless of the shared
   *  budget — whichever the pointer is over, or, with no pointer involved
   *  (touch, or the pointer is elsewhere on the page), whichever
   *  eligible+enabled tile sits nearest the viewport's vertical center, on
   *  the theory that's the one a phone user scrolling the gallery is most
   *  likely looking at. Reads layout (getBoundingClientRect) only for the
   *  already-small eligible set, and only once per tick. */
  function pickFocusedTile(eligible: Tile[]): Tile | null {
    if (hoveredTile !== null && eligible.includes(hoveredTile)) return hoveredTile;

    const centerY = window.innerHeight / 2;
    let best: Tile | null = null;
    let bestDist = Infinity;
    for (const t of eligible) {
      if (!t.enabled) continue;
      const rect = t.canvas.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  }

  function buildTile(entry: GallerySceneEntry, i: number, into: HTMLElement): void {
    const btn = document.createElement("button");
    btn.style.cssText = tileStyle + (entry.enabled ? "" : "opacity: 0.45;");

    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    canvas.style.cssText = canvasStyle;

    const caption = document.createElement("div");
    caption.style.cssText = captionStyle;
    const nameGroup = document.createElement("div");
    nameGroup.style.cssText = nameGroupStyle;
    const name = document.createElement("span");
    name.textContent = entry.scene.name;
    name.style.cssText = nameStyle;
    nameGroup.appendChild(name);
    if (entry.draft) {
      const badge = document.createElement("span");
      badge.textContent = "DRAFT";
      badge.style.cssText = badgeStyle;
      nameGroup.appendChild(badge);
    }
    caption.appendChild(nameGroup);
    if (!entry.enabled && entry.reason) {
      const reason = document.createElement("span");
      reason.textContent = entry.reason;
      reason.style.cssText = reasonStyle;
      caption.appendChild(reason);
    }

    btn.append(canvas, caption);
    btn.addEventListener("click", () => {
      if (entry.enabled) deps.onPick(entry.scene.id);
      else deps.onDisabledPick(entry.scene.id, entry.reason ?? "unavailable");
    });
    into.appendChild(btn);
    observer.observe(canvas);
    preview?.host.mount(entry.scene);

    const tile: Tile = {
      scene: entry.scene,
      canvas,
      sink: preview?.attach(canvas) ?? null,
      feed: createSyntheticFeed({ bpm: 116 + i * 4, phaseOffsetSec: i * 0.17 }),
      palette: PALETTES[i % PALETTES.length],
      anim: createAnimClock(),
      lastDrawMs: 0,
      enabled: entry.enabled,
      // Draft tiles may be built into a still-collapsed (display: none)
      // section — start at 0 so tick() never draws one in the brief window
      // before the IntersectionObserver's first callback can fire.
      visibleRatio: entry.draft ? 0 : 1,
    };
    tiles.push(tile);
    tileByCanvas.set(canvas, tile);
    tileByButton.set(btn, tile);
  }

  function updateToggleLabel(): void {
    draftToggle.textContent = draftsExpanded ? "▾ Hide draft scenes" : `▸ Show ${pendingDrafts.length} draft scenes`;
  }

  function expandDrafts(): void {
    if (!draftsBuilt) {
      pendingDrafts.forEach((entry, j) => buildTile(entry, pendingDraftStartIndex + j, draftGrid));
      draftsBuilt = true;
    }
    draftGrid.style.display = "grid";
    draftsExpanded = true;
    updateToggleLabel();
  }

  function collapseDrafts(): void {
    draftGrid.style.display = "none";
    draftsExpanded = false;
    updateToggleLabel();
  }

  draftToggle.addEventListener("click", () => {
    if (draftsExpanded) collapseDrafts();
    else expandDrafts();
  });

  function buildTiles(): void {
    for (const t of tiles) observer.unobserve(t.canvas);
    grid.innerHTML = "";
    draftGrid.innerHTML = "";
    tiles = [];
    draftsBuilt = false;
    // Avoid holding a reference to a Tile object this rebuild is about to
    // discard — pickFocusedTile() would just filter it back out via its own
    // eligible-tiles check, but there's no reason to carry it across.
    hoveredTile = null;

    const entries = deps.scenes();
    preview?.setSize(PREVIEW_W, PREVIEW_H);

    const featured = entries.filter((e) => !e.draft);
    pendingDrafts = entries.filter((e) => e.draft);
    pendingDraftStartIndex = featured.length;

    featured.forEach((entry, i) => buildTile(entry, i, grid));

    draftToggle.style.display = pendingDrafts.length > 0 ? "block" : "none";
    updateToggleLabel();

    // Re-expand across a rebuild (e.g. returning from a viz) so browsing the
    // draft section doesn't silently re-collapse it out from under the user.
    if (draftsExpanded) expandDrafts();
    else draftGrid.style.display = "none";
  }

  return {
    show(): void {
      preset = deps.quality().preset;
      preview ??= createPreviewRenderer(reducedPreviewQuality(deps.quality()));
      if (!preview) {
        errorBanner.textContent = "WebGL2 preview unavailable on this device.";
        errorBanner.style.display = "block";
      }
      // Start at half the device's ceiling rather than the ceiling itself —
      // an optimistic-but-not-maximal guess that a few ticks of
      // recordTick() will correct in either direction (see
      // STEP_DOWN_TICKS/STEP_UP_TICKS in previewBudget.ts), rather than
      // risking a brief overload right as the gallery opens.
      budgetController = createPreviewBudgetController(
        Math.max(1, Math.round(BUDGET_CEILING_BY_PRESET[preset] / 2)),
      );
      buildTiles();
      root.style.display = "block";
      visible = true;
      lastDrawMs = 0;
    },

    hide(): void {
      // Deliberately does NOT unmount the preview scenes: SceneHost.mount()
      // already steals ownership from whichever host currently holds a
      // scene (see sceneHost.ts), so when the fullscreen viz mounts the one
      // scene it needs, that single scene silently migrates off the preview
      // context — the other two stay mounted here and don't need their
      // shader recompiled the next time the gallery is shown.
      visible = false;
      root.style.display = "none";
    },

    tick(nowMs: number): void {
      if (!visible || !preview || !budgetController) return;
      if (document.visibilityState !== "visible") return;
      const intervalMs = tickIntervalMs(preset);
      // shouldRenderFrame(), not a raw `<` comparison — see framePace.ts's
      // header for why the naive comparison quantizes against vsync and
      // silently loses a third of the intended rate.
      if (!shouldRenderFrame(nowMs, lastDrawMs, intervalMs)) return;
      lastDrawMs = nowMs;

      const timeSec = nowMs / 1000;
      const live = deps.liveFrame();

      const eligible = tiles.filter((t) => t.sink && t.visibleRatio > MIN_VISIBLE_RATIO);
      if (eligible.length === 0) return;

      const ceiling = Math.min(BUDGET_CEILING_BY_PRESET[preset], eligible.length);
      const budget = budgetController.budgetFor(ceiling);
      // The common case — a handful of featured tiles well inside the
      // budget — skips banding (and the getBoundingClientRect reads in
      // pickFocusedTile) entirely: see targetIntervalMsFor's comment.
      const noContention = budget >= eligible.length;
      const focused = noContention ? null : pickFocusedTile(eligible);
      const candidates: ScheduleCandidate[] = eligible.map((t) => ({
        lastDrawMs: t.lastDrawMs,
        targetIntervalMs: targetIntervalMsFor(t, t === focused, intervalMs, noContention),
      }));

      const dueIndices = selectDueTiles(candidates, nowMs, budget);

      const drawStartMs = performance.now();
      for (const idx of dueIndices) {
        const t = eligible[idx];

        // Each tile's own elapsed-time-since-last-draw, not the shared tick
        // interval — a tile drawn less often than every tick still
        // decays/advances its anim clock by the real time that's passed.
        const tileDt = t.lastDrawMs === 0 ? intervalMs / 1000 : (nowMs - t.lastDrawMs) / 1000;
        t.lastDrawMs = nowMs;

        const frame = live ?? t.feed.frame(timeSec);
        const anim = t.anim.advance(tileDt, frame);
        preview.drawTo(t.sink!, t.scene, frame, t.palette, anim);
      }
      budgetController.recordTick(performance.now() - drawStartMs, dueIndices.length);
    },

    setError(msg: string | null): void {
      errorBanner.textContent = msg ?? "";
      errorBanner.style.display = msg ? "block" : "none";
    },

    destroy(): void {
      observer.disconnect();
      preview?.dispose();
      root.remove();
    },
  };
}
