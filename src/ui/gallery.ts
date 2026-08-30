import type { Scene } from "../render/scene.ts";
import type { QualitySettings } from "../render/quality.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createSyntheticFeed } from "../audio/synthetic.ts";
import { createPreviewRenderer, type PreviewRenderer } from "../render/previewRenderer.ts";
import { createAnimClock, type AnimClock } from "../render/animClock.ts";
import { PALETTES, type Palette } from "../render/palette.ts";

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
}

export interface Gallery {
  show(): void;
  hide(): void;
  /** Call every rAF tick while the gallery is showing; self-throttles to ~30fps. */
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
const draftToggleStyle = `
  display: block; margin: 20px auto 0; padding: 8px 14px;
  background: none; border: none; color: #fff9; font: inherit; font-size: 13px;
  cursor: pointer; border-radius: 999px;
`;

const PREVIEW_W = 480;
const PREVIEW_H = 270;
const PREVIEW_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / PREVIEW_FPS;

// A thumbnail doesn't need fullscreen-viz quality — same per-pixel raymarch
// cost as the real thing otherwise, across every scene, every tick. And
// tiles don't all need to redraw every tick either: round-robin a handful
// per tick so each one lands around ~10fps, which reads as smooth motion at
// thumbnail size while cutting preview GPU work roughly 3x.
const PREVIEW_QUALITY_SCALE = 0.4;
const PREVIEW_TILES_PER_TICK = 3;

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

interface Tile {
  scene: Scene;
  canvas: HTMLCanvasElement;
  sink: ReturnType<PreviewRenderer["attach"]>;
  feed: ReturnType<typeof createSyntheticFeed>;
  palette: Palette;
  anim: AnimClock;
  /** Wall-clock ms this tile last actually drew — distinct from the shared
   *  tick cadence now that tiles round-robin, so each tile's anim clock
   *  (pulse decay, flow phase, etc.) advances by its own true elapsed time,
   *  not the global tick interval (which would under-decay/under-advance a
   *  tile that's only drawn every few ticks). 0 = never drawn yet. */
  lastDrawMs: number;
}

export function createGallery(deps: GalleryDeps): Gallery {
  const root = document.createElement("div");
  root.style.cssText = rootStyle;

  const header = document.createElement("div");
  header.style.cssText = headerStyle;
  const title = document.createElement("div");
  title.textContent = "Audio Visualizations";
  title.style.cssText = titleStyle;
  const subtitle = document.createElement("div");
  subtitle.textContent = "Pick a visual — tap to start with your mic.";
  subtitle.style.cssText = subtitleStyle;
  header.append(title, subtitle);

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
  let rrIndex = 0;

  // Draft-section state. Rebuilt (along with everything else) on every show(),
  // so these describe the *current* build cycle, not something persisted
  // across it — draftsExpanded is the one flag that survives a rebuild.
  let pendingDrafts: GallerySceneEntry[] = [];
  let pendingDraftStartIndex = 0;
  let draftsBuilt = false;
  let draftsExpanded = false;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const tile = tiles.find((t) => t.canvas === e.target);
        if (tile) (tile.canvas.dataset.visible = e.isIntersecting ? "1" : "0");
      }
    },
    { threshold: 0.01 },
  );

  function buildTile(entry: GallerySceneEntry, i: number, into: HTMLElement): void {
    const btn = document.createElement("button");
    btn.style.cssText = tileStyle + (entry.enabled ? "" : "opacity: 0.45;");

    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    canvas.style.cssText = canvasStyle;
    // Draft tiles may be built into a still-collapsed (display: none) section —
    // mark them not-visible up front so tick()'s round-robin never draws one
    // in the brief window before the IntersectionObserver's first callback.
    if (entry.draft) canvas.dataset.visible = "0";

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

    tiles.push({
      scene: entry.scene,
      canvas,
      sink: preview?.attach(canvas) ?? null,
      feed: createSyntheticFeed({ bpm: 116 + i * 4, phaseOffsetSec: i * 0.17 }),
      palette: PALETTES[i % PALETTES.length],
      anim: createAnimClock(),
      lastDrawMs: 0,
    });
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
      preview ??= createPreviewRenderer(reducedPreviewQuality(deps.quality()));
      if (!preview) {
        errorBanner.textContent = "WebGL2 preview unavailable on this device.";
        errorBanner.style.display = "block";
      }
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
      if (!visible || !preview) return;
      if (document.visibilityState !== "visible") return;
      if (nowMs - lastDrawMs < FRAME_INTERVAL_MS) return;
      lastDrawMs = nowMs;

      const timeSec = nowMs / 1000;
      const live = deps.liveFrame();

      // Round-robin a handful of tiles per tick rather than redrawing every
      // visible one — see the PREVIEW_TILES_PER_TICK comment above. Degrades
      // to "draw everything, every tick" automatically once eligible.length
      // <= PREVIEW_TILES_PER_TICK (small galleries see no change).
      const eligible = tiles.filter((t) => t.sink && t.canvas.dataset.visible !== "0");
      const drawCount = Math.min(PREVIEW_TILES_PER_TICK, eligible.length);

      for (let i = 0; i < drawCount; i++) {
        const t = eligible[rrIndex % eligible.length];
        rrIndex++;

        // Each tile's own elapsed-time-since-last-draw, not the shared tick
        // interval — a tile only drawn every few ticks still decays/advances
        // by the real time that's passed, not just one tick's worth.
        const tileDt = t.lastDrawMs === 0 ? FRAME_INTERVAL_MS / 1000 : (nowMs - t.lastDrawMs) / 1000;
        t.lastDrawMs = nowMs;

        const frame = live ?? t.feed.frame(timeSec);
        const anim = t.anim.advance(tileDt, frame);
        preview.drawTo(t.sink!, t.scene, frame, t.palette, anim);
      }
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
