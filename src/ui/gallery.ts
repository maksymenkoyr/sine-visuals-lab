import type { Scene } from "../render/scene.ts";
import type { QualitySettings } from "../render/quality.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createSyntheticFeed } from "../audio/synthetic.ts";
import { createPreviewRenderer, type PreviewRenderer } from "../render/previewRenderer.ts";
import { createAnimClock, type AnimClock } from "../render/animClock.ts";
import { PALETTES, type Palette } from "../render/palette.ts";
import { SOURCE_URL } from "../brand.ts";
import { DISPLAY_SHARE_GUIDE, type AudioSourceChoice } from "../audio/sourcePref.ts";
import { createBrandMark, BRAND_RED } from "./brandMark.ts";
import { BANDS_AMBER, FONT_LABEL, FONT_MONO, INPUT_GREEN, SCENE_VIOLET, withAlpha } from "./controlsTheme.ts";

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
   *  src/audio/sourcePref.ts's displayCaptureSupported. Where it can't, the
   *  masthead's sound-source picker shows the microphone alone, so it
   *  never names an option a mobile visitor won't see. */
  canCaptureDisplay: () => boolean;
  /** The source a tile tap will start on — what the picker highlights. */
  sourceChoice: () => AudioSourceChoice;
  /** Fired inside the picker's click, so a live swap to screen capture still
   *  has its user gesture. Resolves once the choice has settled (a cancelled
   *  share picker leaves the old one in place); the picker then re-reads
   *  sourceChoice() rather than trusting what was clicked. */
  onSourceChoice: (next: AudioSourceChoice) => Promise<void>;
}

export interface Gallery {
  show(): void;
  hide(): void;
  /** Call every rAF tick while the gallery is showing; self-throttles to ~30fps. */
  tick(nowMs: number): void;
  setError(msg: string | null): void;
  destroy(): void;
}

const STYLE_ID = "gallery-styles";
const GROUND = "#05070a";
/** Below this the masthead stacks and the page gutters tighten. */
const NARROW_BELOW_PX = 820;

// The gallery design (option 1a of "Gallery & Scene", in the same Claude
// Design project as the controls panel's "Viz Controls"): masthead with the
// mark and the sound-source picker, a Released section of large
// tiles, a Draft section of small ones behind a fold, and a one-line footer.
// A stylesheet rather than inline cssText because nearly every rule here
// needs :hover, :focus-visible or a media query. Accents and fonts come from
// controlsTheme.ts so the gallery and the panel can't drift apart.
const stylesheet = `
.gal-root {
  position: fixed; inset: 0; z-index: 15; overflow-y: auto; display: none;
  background: ${GROUND}; color: #fff; font-family: ${FONT_LABEL};
  padding: 32px 56px 40px; box-sizing: border-box;
}
.gal-page { max-width: 1328px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
.gal-mono { font: 400 10.5px ${FONT_MONO}; text-transform: uppercase; }

.gal-mast { display: flex; align-items: center; justify-content: space-between; gap: 16px 32px; flex-wrap: wrap; }
.gal-source { display: flex; align-items: center; gap: 14px; }
.gal-source-label { letter-spacing: .14em; color: rgba(255,255,255,.5); }
.gal-source-row { display: flex; gap: 4px; }
.gal-src {
  display: flex; align-items: center; gap: 9px; padding: 10px 14px; text-align: left;
  border: 1px solid rgba(255,255,255,.16); border-radius: 3px; background: none;
  color: #fff; font: inherit; cursor: pointer;
}
.gal-src:hover { border-color: rgba(255,255,255,.4); }
.gal-src[aria-checked="true"] { border-color: ${withAlpha(INPUT_GREEN, 0.7)}; background: ${withAlpha(INPUT_GREEN, 0.12)}; }
.gal-src[data-solo] { cursor: default; }
.gal-src-dot { width: 5px; height: 5px; border-radius: 50%; border: 1px solid rgba(255,255,255,.45); box-sizing: border-box; flex: none; }
.gal-src[aria-checked="true"] .gal-src-dot { background: ${INPUT_GREEN}; border-color: ${INPUT_GREEN}; }
.gal-src-name { font: 400 13.5px ${FONT_LABEL}; }
.gal-src-hint { font: 400 9.5px ${FONT_MONO}; letter-spacing: .1em; color: rgba(255,255,255,.55); margin-top: 2px; }

.gal-error {
  display: none; padding: 10px 14px; border-radius: 3px; font-size: 13px;
  background: rgba(232,50,42,.14); border: 1px solid ${withAlpha(BRAND_RED, 0.6)};
}

.gal-section { display: flex; flex-direction: column; gap: 14px; }
.gal-section-head { display: flex; align-items: center; gap: 14px; min-height: 26px; }
.gal-section-name { letter-spacing: .16em; }
.gal-rule { flex: 1; height: 1px; background: rgba(255,255,255,.1); }
.gal-count { letter-spacing: .1em; color: rgba(255,255,255,.4); }
.gal-fold {
  display: flex; align-items: center; gap: 8px; letter-spacing: .1em;
  color: rgba(255,255,255,.55); background: none; cursor: pointer;
  border: 1px solid rgba(255,255,255,.16); border-radius: 3px; padding: 6px 12px;
}
.gal-fold:hover:not(:disabled) { color: #fff; border-color: rgba(255,255,255,.4); }
.gal-fold:disabled { cursor: progress; opacity: .7; }
.gal-fold-arrow { font-size: 8px; }

.gal-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.gal-grid-draft { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 12px; }

.gal-tile {
  display: block; width: 100%; padding: 0; text-align: left; font: inherit; color: #fff;
  border: 1px solid rgba(255,255,255,.13); border-top-color: rgba(255,255,255,.22);
  border-radius: 3px; background: rgba(255,255,255,.025); overflow: hidden; cursor: pointer;
}
.gal-tile:hover, .gal-tile:focus-visible { border-color: ${BRAND_RED}; outline: none; }
.gal-tile[data-draft] { border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.02); }
.gal-tile[data-draft]:hover, .gal-tile[data-draft]:focus-visible { border-color: ${withAlpha(SCENE_VIOLET, 0.7)}; }
.gal-tile[data-disabled] { opacity: .45; }
.gal-shot { position: relative; aspect-ratio: 16 / 9; background: ${GROUND}; }
.gal-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gal-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(5,7,10,.7), transparent 40%); pointer-events: none; }
.gal-over { position: absolute; left: 14px; right: 14px; bottom: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.gal-name { font: 500 22px/1 ${FONT_LABEL}; min-width: 0; }
.gal-start {
  font: 400 11px ${FONT_MONO}; letter-spacing: .14em; flex: none; white-space: nowrap;
  color: ${INPUT_GREEN}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.6)};
  border-radius: 3px; padding: 5px 10px; background: rgba(5,7,10,.5);
}
.gal-start[data-muted] { color: rgba(255,255,255,.7); border-color: rgba(255,255,255,.3); }
.gal-cap { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }
.gal-cap-name { font: 400 15px ${FONT_LABEL}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.gal-tag {
  font: 400 9.5px ${FONT_MONO}; letter-spacing: .12em; text-transform: uppercase; flex: none;
  color: ${SCENE_VIOLET}; border: 1px solid ${withAlpha(SCENE_VIOLET, 0.5)}; border-radius: 3px; padding: 2px 6px;
}

.gal-foot {
  display: flex; justify-content: flex-end; letter-spacing: .1em;
  padding-top: 16px; border-top: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.4);
}
.gal-foot a { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.25); }
.gal-foot a:hover { color: #fff; }

@media (max-width: ${NARROW_BELOW_PX}px) {
  .gal-root { padding: 24px 16px 32px; }
  .gal-page { gap: 24px; }
  /* No room for the label beside the mark and both options on a phone. */
  .gal-source-label { display: none; }
  .gal-mast { gap: 12px; }
  .gal-src { padding: 9px 8px; gap: 6px; }
  .gal-src-hint { letter-spacing: .06em; }
  .gal-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .gal-name { font-size: 19px; }
  /* A phone at arm's length: the fold is how the drafts are reached at all. */
  .gal-fold { min-height: 40px; padding: 8px 14px; }
}
`;

function ensureGalleryStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
  ensureGalleryStyles();
  const root = el("div", "gal-root");
  const page = el("div", "gal-page");

  // Masthead: the mark alone carries the name — no title, no blurb — and it
  // lives here and nowhere else on the page.
  const mast = el("div", "gal-mast");

  // Sound source: which capture a tile tap starts on. A radio pair where
  // screen capture exists; the microphone alone, as a plain statement, where
  // it doesn't.
  const source = el("div", "gal-source");
  const sourceRow = el("div", "gal-source-row");
  sourceRow.setAttribute("role", "radiogroup");
  sourceRow.setAttribute("aria-label", "Sound source");
  const sourceButtons = new Map<AudioSourceChoice, HTMLButtonElement>();
  const refreshSource = (): void => {
    const current = deps.sourceChoice();
    for (const [choice, btn] of sourceButtons) btn.setAttribute("aria-checked", String(choice === current));
  };
  const addSource = (choice: AudioSourceChoice, name: string, hint: string, title?: string): void => {
    const btn = el("button", "gal-src");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    if (title) btn.title = title;
    const text = el("div", "");
    text.append(el("div", "gal-src-name", name), el("div", "gal-src-hint", hint));
    btn.append(el("div", "gal-src-dot"), text);
    if (deps.canCaptureDisplay()) {
      btn.addEventListener("click", () => void deps.onSourceChoice(choice).then(refreshSource, refreshSource));
    } else {
      btn.dataset.solo = "";
      btn.tabIndex = -1;
    }
    sourceButtons.set(choice, btn);
    sourceRow.appendChild(btn);
  };
  addSource("mic", "Microphone", "DEFAULT · TAP A SCENE");
  if (deps.canCaptureDisplay()) addSource("display", "Share a tab", "CLEANER SIGNAL", DISPLAY_SHARE_GUIDE);
  source.append(el("div", "gal-mono gal-source-label", "Sound source"), sourceRow);
  mast.append(createBrandMark(56), source);

  const errorBanner = el("div", "gal-error");
  errorBanner.setAttribute("role", "alert");

  const released = el("div", "gal-section");
  const releasedHead = el("div", "gal-section-head");
  const releasedName = el("div", "gal-mono gal-section-name", "Released");
  releasedName.style.color = BANDS_AMBER;
  const releasedCount = el("div", "gal-mono gal-count");
  releasedHead.append(releasedName, el("div", "gal-rule"), releasedCount);
  const grid = el("div", "gal-grid");
  released.append(releasedHead, grid);

  // Collapsed by default — see expandDrafts/collapseDrafts below. Built lazily
  // so a first-time visitor never pays for compiling the draft shaders.
  const draftSection = el("div", "gal-section");
  const draftHead = el("div", "gal-section-head");
  const draftName = el("div", "gal-mono gal-section-name", "Draft");
  draftName.style.color = SCENE_VIOLET;
  const draftToggle = el("button", "gal-mono gal-fold");
  draftToggle.type = "button";
  const draftArrow = el("span", "gal-fold-arrow");
  const draftLabel = el("span", "");
  draftToggle.append(draftArrow, draftLabel);
  draftHead.append(draftName, el("div", "gal-rule"), draftToggle);
  const draftGrid = el("div", "gal-grid-draft");
  draftGrid.style.display = "none";
  draftSection.append(draftHead, draftGrid);

  // The Source link is the AGPL §13 network-source offer (see src/brand.ts),
  // and PRIVACY.md points readers at it — it has to stay on this page.
  const foot = el("div", "gal-mono gal-foot");
  const sourceLink = el("a", "", "Source · AGPL-3.0");
  sourceLink.href = SOURCE_URL;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener";
  foot.appendChild(sourceLink);

  page.append(mast, errorBanner, released, draftSection, foot);
  root.appendChild(page);
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
  // Bumped by every buildTiles() so an in-flight progressive draft build
  // (see expandDrafts) from a previous cycle notices and stops.
  let draftBuildGen = 0;
  /** How many draft tiles the in-flight build has mounted so far — drives the
   *  toggle's loading label; -1 = no build in flight. */
  let draftsBuiltCount = -1;

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
    const btn = el("button", "gal-tile");
    btn.type = "button";
    if (entry.draft) btn.dataset.draft = "";
    if (!entry.enabled) btn.dataset.disabled = "";

    const shot = el("div", "gal-shot");
    const canvas = el("canvas", "gal-canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    // Draft tiles may be built into a still-collapsed (display: none) section —
    // mark them not-visible up front so tick()'s round-robin never draws one
    // in the brief window before the IntersectionObserver's first callback.
    if (entry.draft) canvas.dataset.visible = "0";
    shot.appendChild(canvas);

    const reason = entry.enabled ? null : (entry.reason ?? "Unavailable");
    if (entry.draft) {
      // Small tile: the picture, then a caption bar with the name and a tag
      // (the reason it can't run here takes the tag's place when it can't).
      const cap = el("div", "gal-cap");
      cap.append(el("div", "gal-cap-name", entry.scene.name), el("div", "gal-tag", reason ?? "Draft"));
      btn.append(shot, cap);
    } else {
      // Large tile: the name and the call to action sit over the picture's
      // darkened foot.
      const start = el("div", "gal-start", reason ?? "START ›");
      if (reason) start.dataset.muted = "";
      const over = el("div", "gal-over");
      over.append(el("div", "gal-name", entry.scene.name), start);
      shot.append(el("div", "gal-shade"), over);
      btn.appendChild(shot);
    }

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
    const loading = draftsBuiltCount >= 0;
    const n = pendingDrafts.length;
    draftToggle.disabled = loading;
    draftToggle.setAttribute("aria-busy", loading ? "true" : "false");
    draftToggle.setAttribute("aria-expanded", String(draftsExpanded));
    draftArrow.textContent = draftsExpanded ? "▼" : "▶";
    draftLabel.textContent = loading
      ? `Loading drafts ${draftsBuiltCount} / ${n}`
      : `${draftsExpanded ? "Hide" : "Show"} ${n} ${n === 1 ? "draft" : "drafts"}`;
  }

  // Draft tiles are built one per animation frame rather than all at once:
  // each buildTile() compiles that scene's shaders synchronously, and doing
  // every draft in one click handler froze the page — the button couldn't
  // even repaint to say it was working. Spreading them out lets the toggle
  // show its loading label first, then the grid fill in tile by tile while
  // the page stays responsive. The extra leading frame is deliberate: rAF
  // callbacks run *before* that frame's paint, so without it the first
  // compile would still land ahead of the label's first repaint.
  function buildDraftsProgressively(): void {
    const gen = draftBuildGen;
    draftsBuiltCount = 0;
    updateToggleLabel();

    const step = (): void => {
      if (gen !== draftBuildGen) return; // a rebuild superseded this build
      if (draftsBuiltCount >= pendingDrafts.length) {
        draftsBuilt = true;
        draftsBuiltCount = -1;
        updateToggleLabel();
        return;
      }
      const j = draftsBuiltCount;
      buildTile(pendingDrafts[j], pendingDraftStartIndex + j, draftGrid);
      draftsBuiltCount = j + 1;
      updateToggleLabel();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(() => requestAnimationFrame(step));
  }

  function expandDrafts(): void {
    draftGrid.style.display = "grid";
    draftsExpanded = true;
    if (!draftsBuilt && draftsBuiltCount < 0) buildDraftsProgressively();
    else updateToggleLabel();
  }

  function collapseDrafts(): void {
    draftGrid.style.display = "none";
    draftsExpanded = false;
    updateToggleLabel();
  }

  draftToggle.addEventListener("click", () => {
    if (draftsBuiltCount >= 0) return; // still loading — the button is disabled, but belt and braces
    if (draftsExpanded) collapseDrafts();
    else expandDrafts();
  });

  function buildTiles(): void {
    for (const t of tiles) observer.unobserve(t.canvas);
    grid.innerHTML = "";
    draftGrid.innerHTML = "";
    tiles = [];
    draftsBuilt = false;
    draftBuildGen++;
    draftsBuiltCount = -1;

    const entries = deps.scenes();
    preview?.setSize(PREVIEW_W, PREVIEW_H);

    const featured = entries.filter((e) => !e.draft);
    pendingDrafts = entries.filter((e) => e.draft);
    pendingDraftStartIndex = featured.length;

    featured.forEach((entry, i) => buildTile(entry, i, grid));

    releasedCount.textContent = `${featured.length} ${featured.length === 1 ? "scene" : "scenes"}`;
    released.style.display = featured.length > 0 ? "" : "none";
    draftSection.style.display = pendingDrafts.length > 0 ? "" : "none";
    refreshSource();
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
