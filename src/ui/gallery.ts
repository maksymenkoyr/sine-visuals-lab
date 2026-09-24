import type { Scene } from "../render/scene.ts";
import type { QualityPreset, QualitySettings } from "../render/quality.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { createSyntheticFeed } from "../audio/synthetic.ts";
import { createPreviewRenderer, type PreviewRenderer } from "../render/previewRenderer.ts";
import { createAnimClock, type AnimClock } from "../render/animClock.ts";
import { PALETTES, type Palette } from "../render/palette.ts";
import { SOURCE_URL } from "../brand.ts";
import { DISPLAY_SHARE_GUIDE, type AudioSourceChoice, type SourceState } from "../audio/sourcePref.ts";
import { createBrandMark, BRAND_RED } from "./brandMark.ts";
import { BANDS_AMBER, FONT_LABEL, FONT_MONO, INPUT_GREEN, SCENE_VIOLET, withAlpha } from "./controlsTheme.ts";
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
   *  src/audio/sourcePref.ts's displayCaptureSupported. Where it can't, the
   *  masthead's sound-source picker shows the microphone alone, so it
   *  never names an option a mobile visitor won't see. */
  canCaptureDisplay: () => boolean;
  /** Which source is live, if any — what the picker paints. Only `live` is ever painted as a highlight (see
   *  SourceState's doc comment in sourcePref.ts). Same signal drives the
   *  Input card's Source row (src/ui/deviceMenu.ts's createSourceRow). */
  sourceState: () => SourceState;
  /** Fired inside the picker's click, so starting — or live-swapping to —
   *  screen capture still has its user gesture: a click here starts listening
   *  at once, it doesn't wait for a tile. Resolves once the choice has settled (a cancelled
   *  share picker leaves the old one in place); the picker then re-reads
   *  sourceState() rather than trusting what was clicked. */
  onSourceChoice: (next: AudioSourceChoice) => Promise<void>;
}

export interface Gallery {
  show(): void;
  hide(): void;
  /** Call every rAF tick while the gallery is showing; self-throttles to the
   *  device's own render-rate cap (framePace.ts), same policy as the
   *  fullscreen viz, and further self-limits which tiles actually redraw —
   *  see the priority-band comments above createGallery. */
  tick(nowMs: number): void;
  /** Repaints the sound-source picker off a fresh sourceState() — called
   *  whenever liveness changes elsewhere (src/app.ts's attachCapture,
   *  onCaptureEnded) while the gallery may already be showing, e.g. a capture
   *  survives a trip back to the gallery and the user hits Chrome's "Stop
   *  sharing" bar while browsing. A no-op while hidden; show() repaints on
   *  its own via buildTiles(). */
  syncSource(): void;
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
.gal-page { max-width: 1328px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.gal-mono { font: 400 10.5px ${FONT_MONO}; text-transform: uppercase; }

.gal-mast { display: flex; align-items: center; justify-content: space-between; gap: 16px 32px; flex-wrap: wrap; }
.gal-source { display: flex; flex-direction: column; gap: 5px; }
.gal-source-top { display: flex; align-items: center; gap: 14px; }
/* .gal-source-label and .gal-source-hint share one grid cell (justify-items:
 * end) instead of sitting side by side, so .gal-source-slot's width is fixed
 * to whichever child is wider — almost always the hint — and toggling which
 * one is visible via opacity never nudges .gal-src's fixed right edge
 * (.gal-mast's own space-between). The shimmer gradient below lives on
 * .gal-source-hint-text unconditionally, with only its animation keyed off
 * [data-prompting]: a landing pick then fades the text out from wherever the
 * sweep had already reached (the band scrolled off-screen reads as a flat
 * dim colour) instead of jumping from a moving gradient to solid colour
 * mid-fade. */
.gal-source-slot { display: grid; justify-items: end; }
.gal-source-slot > * { grid-area: 1 / 1; transition: opacity .22s ease; white-space: nowrap; }
.gal-source-label { letter-spacing: .14em; color: rgba(255,255,255,.5); }
.gal-source-hint { letter-spacing: .14em; color: rgba(255,255,255,.55); opacity: 0; }
.gal-source-slot[data-prompting] .gal-source-hint { opacity: 1; }
.gal-source-slot[data-prompting] .gal-source-label { opacity: 0; }
.gal-source-hint-arrow { display: inline-block; margin-left: .6em; }
@media (prefers-reduced-motion: no-preference) {
  .gal-source-hint-text {
    background: linear-gradient(90deg, rgba(255,255,255,.45) 40%, #fff 50%, rgba(255,255,255,.45) 60%) 100% 0 / 250% 100%;
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .gal-source-slot[data-prompting] .gal-source-hint-text { animation: gal-hint-shimmer 2.6s ease-in-out infinite; }
  .gal-source-slot[data-prompting] .gal-source-hint-arrow { animation: gal-hint-nudge 1.3s ease-in-out infinite; }
  @keyframes gal-hint-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
  @keyframes gal-hint-nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
}
.gal-source-row { display: flex; gap: 4px; }
.gal-src {
  display: flex; align-items: center; gap: 9px; padding: 10px 14px; text-align: left;
  border: 1px solid rgba(255,255,255,.16); border-radius: 3px; background: none;
  color: #fff; font: inherit; cursor: pointer;
}
.gal-src:hover { border-color: rgba(255,255,255,.4); }
/* Paint keys off data-state, not aria-checked — aria-checked stays purely
 * semantic (radio state for assistive tech). Live is the only state this
 * paints; anything else (idle) is the button's own plain default look. */
.gal-src[data-state="live"] { border-color: ${withAlpha(INPUT_GREEN, 0.7)}; background: ${withAlpha(INPUT_GREEN, 0.12)}; }
.gal-src[data-solo] { cursor: default; }
.gal-src-dot { width: 5px; height: 5px; border-radius: 50%; border: 1px solid rgba(255,255,255,.45); box-sizing: border-box; flex: none; }
.gal-src[data-state="live"] .gal-src-dot { background: ${INPUT_GREEN}; border-color: ${INPUT_GREEN}; }
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
.gal-name { font: 400 14px/1 ${FONT_LABEL}; min-width: 0; }
.gal-reason {
  font: 400 11px ${FONT_MONO}; letter-spacing: .14em; flex: none; white-space: nowrap;
  color: rgba(255,255,255,.7); border: 1px solid rgba(255,255,255,.3);
  border-radius: 3px; padding: 5px 10px; background: rgba(5,7,10,.5);
}
.gal-cap { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }
.gal-cap-name { font: 400 13px ${FONT_LABEL}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.gal-tag {
  font: 400 9.5px ${FONT_MONO}; letter-spacing: .12em; text-transform: uppercase; flex: none;
  color: ${SCENE_VIOLET}; border: 1px solid ${withAlpha(SCENE_VIOLET, 0.5)}; border-radius: 3px; padding: 2px 6px;
}

.gal-foot {
  display: flex; justify-content: flex-end; gap: 16px; letter-spacing: .1em;
  padding-top: 16px; border-top: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.4);
}
.gal-foot a { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.25); }
.gal-foot a:hover { color: #fff; }

@media (max-width: ${NARROW_BELOW_PX}px) {
  .gal-root { padding: 24px 16px 32px; }
  .gal-page { gap: 16px; }
  /* No room for the label beside the mark and both options on a phone — the
   * hint takes its place on its own line above the buttons instead. */
  .gal-source-top { flex-direction: column; align-items: flex-start; gap: 6px; }
  .gal-source-slot { justify-items: start; }
  .gal-source-slot .gal-source-label { display: none; }
  /* Otherwise the slot would still reserve its line (both children just
   * fade to opacity 0) once a pick lands — hide it outright instead, at the
   * cost of a one-line shift when that happens. */
  .gal-source-slot:not([data-prompting]) { display: none; }
  .gal-mast { gap: 12px; }
  .gal-src { padding: 9px 8px; gap: 6px; }
  .gal-src-hint { letter-spacing: .06em; }
  .gal-source-hint { letter-spacing: .06em; }
  .gal-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .gal-name { font-size: 13px; }
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
  ensureGalleryStyles();
  const root = el("div", "gal-root");
  const page = el("div", "gal-page");

  // Masthead: the mark alone carries the name — no title, no blurb — and it
  // lives here and nowhere else on the page.
  const mast = el("div", "gal-mast");

  // Sound source: which capture is listening, and the way to start one. A radio pair where
  // screen capture exists; the microphone alone, as a plain statement (no
  // radio semantics, no hint — there's nothing to choose between), where it
  // doesn't. canChoose is read once: display capture's availability never
  // changes mid-session (same assumption refreshAudioPromptButtons in
  // app.ts makes for the start prompt).
  const canChoose = deps.canCaptureDisplay();
  const source = el("div", "gal-source");
  const sourceTop = el("div", "gal-source-top");
  const sourceSlot = el("div", "gal-source-slot");
  const sourceLabel = el("div", "gal-mono gal-source-label", "Sound source");
  const sourceRow = el("div", "gal-source-row");
  if (canChoose) {
    sourceRow.setAttribute("role", "radiogroup");
    sourceRow.setAttribute("aria-label", "Sound source");
  }
  const LIVE_LABEL = "LISTENING";
  const sourceButtons = new Map<AudioSourceChoice, { btn: HTMLButtonElement; hintEl: HTMLElement; descriptor: string }>();
  // Only where there's an actual choice to nudge toward — the solo path (no
  // display capture) has nothing to pick between, so it keeps just the plain
  // label, same as before this hint existed.
  const sourceHint = canChoose ? el("div", "gal-mono gal-source-hint") : null;
  if (sourceHint) {
    sourceHint.append(
      el("span", "gal-source-hint-text", "PICK A SOURCE TO START"),
      el("span", "gal-source-hint-arrow", "›"),
    );
  }
  const refreshSource = (): void => {
    const state = deps.sourceState();
    for (const [choice, entry] of sourceButtons) {
      // Live is the only state a button ever paints — a stored preference or
      // a granted mic permission never highlights a button on its own, since
      // a user reads any highlight as "this is running" (see SourceState's
      // doc comment in sourcePref.ts).
      const uiState: "live" | "idle" = choice === state.choice && state.live ? "live" : "idle";
      entry.btn.dataset.state = uiState;
      if (canChoose) entry.btn.setAttribute("aria-checked", String(uiState === "live"));
      entry.hintEl.textContent = uiState === "live" ? LIVE_LABEL : entry.descriptor;
    }
    if (sourceHint) {
      // Both children live in .gal-source-slot's one grid cell — see that
      // rule's own comment for why this toggle can't shift .gal-src's fixed
      // position.
      sourceSlot.toggleAttribute("data-prompting", !state.live);
      sourceHint.setAttribute("aria-hidden", String(state.live));
      sourceLabel.setAttribute("aria-hidden", String(!state.live));
    }
  };
  const addSource = (choice: AudioSourceChoice, name: string, descriptor: string, title?: string): void => {
    const btn = el("button", "gal-src");
    btn.type = "button";
    if (title) btn.title = title;
    const hintEl = el("div", "gal-src-hint", descriptor);
    const text = el("div", "");
    text.append(el("div", "gal-src-name", name), hintEl);
    btn.append(el("div", "gal-src-dot"), text);
    if (canChoose) {
      btn.setAttribute("role", "radio");
      btn.addEventListener("click", () => void deps.onSourceChoice(choice).then(refreshSource, refreshSource));
    } else {
      btn.dataset.solo = "";
      btn.tabIndex = -1;
    }
    sourceButtons.set(choice, { btn, hintEl, descriptor });
    sourceRow.appendChild(btn);
  };
  addSource("mic", "Microphone", "ROOM AUDIO");
  if (canChoose) addSource("display", "Share a tab", "CLEANER SIGNAL", DISPLAY_SHARE_GUIDE);
  sourceSlot.appendChild(sourceLabel);
  if (sourceHint) sourceSlot.appendChild(sourceHint);
  sourceTop.append(sourceSlot, sourceRow);
  source.appendChild(sourceTop);
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
  // Licenses/Privacy point at the plain-text copies vite-legal-notices-plugin.ts
  // ships alongside the build (dist/*.txt), since MIT and the SIL Open Font
  // License both require their notices to travel with copies of the site.
  const foot = el("div", "gal-mono gal-foot");
  const sourceLink = el("a", "", "Source · AGPL-3.0");
  sourceLink.href = SOURCE_URL;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener";
  const licensesLink = el("a", "", "Licenses");
  licensesLink.href = "/THIRD-PARTY-NOTICES.txt";
  licensesLink.target = "_blank";
  licensesLink.rel = "noopener";
  const privacyLink = el("a", "", "Privacy");
  privacyLink.href = "/PRIVACY.txt";
  privacyLink.target = "_blank";
  privacyLink.rel = "noopener";
  foot.append(sourceLink, licensesLink, privacyLink);

  page.append(mast, errorBanner, released, draftSection, foot);
  root.appendChild(page);
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
  // Bumped by every buildTiles() so an in-flight progressive draft build
  // (see expandDrafts) from a previous cycle notices and stops.
  let draftBuildGen = 0;
  /** How many draft tiles the in-flight build has mounted so far — drives the
   *  toggle's loading label; -1 = no build in flight. */
  let draftsBuiltCount = -1;

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
    const btn = el("button", "gal-tile");
    btn.type = "button";
    if (entry.draft) btn.dataset.draft = "";
    if (!entry.enabled) btn.dataset.disabled = "";

    const shot = el("div", "gal-shot");
    const canvas = el("canvas", "gal-canvas");
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    // Not marked not-visible here: a draft tile's initial visibleRatio (0,
    // set on the Tile object below) already covers the gap before the
    // IntersectionObserver's first callback — see the Tile field's comment.
    shot.appendChild(canvas);

    const reason = entry.enabled ? null : (entry.reason ?? "Unavailable");
    if (entry.draft) {
      // Small tile: the picture, then a caption bar with the name and a tag
      // (the reason it can't run here takes the tag's place when it can't).
      const cap = el("div", "gal-cap");
      cap.append(el("div", "gal-cap-name", entry.scene.name), el("div", "gal-tag", reason ?? "Draft"));
      btn.append(shot, cap);
    } else {
      // Large tile: the name sits over the picture's darkened foot, joined by
      // the reason when the scene can't run here. The whole tile is the call
      // to action, so a runnable one carries no button of its own.
      const over = el("div", "gal-over");
      over.append(el("div", "gal-name", entry.scene.name));
      if (reason) over.append(el("div", "gal-reason", reason));
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

    syncSource(): void {
      if (visible) refreshSource();
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
