import type { PanelSection } from "../../render/scene.ts";
import type { SceneSetting } from "../../render/sceneSettings.ts";
import type { CardSpec } from "../controlsKit.ts";

/**
 * Where a scene's `Scene.panel` sections (src/render/scene.ts,
 * src/render/sceneItems.ts) become real DOM. `src/ui/deviceMenu.ts` renders
 * each section by looking up its `widget` id here and calling the
 * registered builder with a `WidgetCtx` — a small capability object rather
 * than deviceMenu's own internals, so a widget never imports deviceMenu.ts
 * and stays testable/reusable on its own (a widget file only ever imports
 * this module, src/render/*, and other src/ui/ helpers like
 * controlsKit.ts/controlsTheme.ts).
 *
 * `appendRow` is the one bridge into deviceMenu's real row-building code
 * (`appendSettingRow`): a widget that wants an ordinary slider/patch-bay row
 * for one of its item settings gets the *actual* row — drive chip, wire
 * panel, jack, cables, pin — by calling this instead of building its own
 * look-alike. `get`/`set` go through the exact same store path a slider
 * drag uses (deviceMenu's `onSceneSettingChange`), so a widget's own custom
 * controls (Physarum 2's Affinity pads) read/write storage, Looks and reset
 * identically to a plain row, just with different UI.
 *
 * `ctx.rerender()` re-runs the *whole* Scene card (deviceMenu.ts's
 * `renderSceneSettings`) — the same rebuild a scene switch, a Look apply, a
 * variant switch or a card Reset already does. It reuses 100% of the
 * existing jack/cable/pin teardown (driveRowHandles, sceneRowHandles, the
 * pinned-row reconciliation) for free instead of a second, easy-to-drift
 * bookkeeping path, but it's a sledgehammer: every row flashes, every
 * preview canvas would restart (Phase 3's own `previewCache` is what stops
 * that today), and any open patch panel/hover state resets. Right for
 * something that actually changes every row's own profile (a Look apply, a
 * variant switch), wrong for anything a widget expects to happen often and
 * cheaply, like a selection change.
 *
 * For that, `ctx.mountRows(container, rows)` (2026-09-27b) mounts real
 * device-menu rows the same way `appendRow` does, but scoped: it snapshots
 * `sceneRowHandles`/`driveRowHandles`/`driveSparkCanvases`/`linkedByKey`
 * before and after building `rows`, so the `{ dispose(): void }` it returns
 * can unregister exactly what that call added — and nothing else already on
 * the card — then remove that call's own DOM subtree and trigger the
 * existing cable recompute (`refreshPatchHighlight`). A widget whose
 * selection change only swaps out the *rows* below some unrelated,
 * persistent DOM (the boxes and their live preview canvases, say — see
 * itemBoxes.ts) calls `dispose()` on its previous mount and `mountRows()`
 * again with the new set, instead of `ctx.rerender()`: the boxes, canvases
 * and any per-tick state never move. A widget that needs its own state to
 * survive either kind of rebuild (which item is selected, say) persists it
 * itself (localStorage, try/catch — see itemBoxes.ts) rather than relying on
 * anything here to carry it across.
 *
 * `onTick`/`onDispose` are for a widget that keeps its own per-frame state or
 * a resource outside the rebuilt DOM subtree (a ResizeObserver on `window`, a
 * listener on the main canvas): `onTick` callbacks join the device menu's own
 * unthrottled per-tick pass (deviceMenu.ts's `sceneRowHandles` loop), and
 * every registered `onDispose` runs right before the next full Scene-card
 * rebuild. itemBoxes.ts uses both — `onTick` to step and draw its live
 * previews and refresh its readouts, `onDispose` to remove its canvas and
 * window listeners — on top of its rows, which tick through the handles
 * `appendRow` registers.
 */

/** One other selected item's own same-param setting — see `appendRow`'s own
 *  `opts.linked` doc comment below for the full contract. */
export interface LinkedSetting {
  /** The same-param setting on another selected item (e.g. another
   *  strain's own Nutrient spec). */
  spec: SceneSetting;
  /** This item's own short display name (e.g. "PP-C3"), for a "Mixed — …"
   *  drive summary. */
  label: string;
  /** This item's own colour, reused for its divergent-value tick — omitted
   *  draws a neutral tick instead. */
  colour?: string;
}

export interface WidgetCtx {
  sceneId: string;
  /** The active scene's full, flat settings list (SceneSetting[]) — the
   *  same array deviceMenu.ts's flat loop walks. */
  specs: readonly SceneSetting[];
  /** `specs` filtered to one item family, optionally narrowed to one
   *  item's index — src/render/sceneItems.ts's `SceneSetting.item` tag. */
  specsFor(family: string, index?: number): SceneSetting[];
  /** The setting's current *stored* value (`getSceneSetting` — not
   *  auto-tune-resolved: a widget reading a setting the Scene master or Auto
   *  can scale, like Cross-smell, sees the manual number, not what the GPU
   *  actually runs — see physarum2Affinity.ts's pair cultures for a caller
   *  that has to live with this). */
  get(spec: SceneSetting): number;
  /** Writes through the exact path a slider drag uses. */
  set(spec: SceneSetting, value: number): void;
  /** The setting's current live drive reading — the exact number a row's own
   *  sparkline draws (`SceneDrives.valueOf(key, rest)`, drives.ts): 0 while
   *  the setting is still on its "Scene" default (a row's sparkline shows the
   *  same flat 0 until something is actually patched — see drives.ts's
   *  header), `rest` (default 0) while a real patch has nothing plugged in
   *  (every source unplugged or muted — drives.ts's header's "Nothing
   *  plugged in" paragraph: the reading to use so an unplugged jack doesn't
   *  read as an honest 0 for a control whose neutral isn't 0), the real
   *  combined/gained reading once patched and live, and 0 while the panel is
   *  closed or nothing is playing. Exists so a preview widget
   *  (src/ui/widgets/previews.ts) can reproduce a scene's own effective-value
   *  formula (physarum2.ts's `resolveStrainEffective`) without recomputing
   *  any drive-combination arithmetic of its own. */
  driveValue(spec: SceneSetting, rest?: number): number;
  /** Passthrough to the active scene's own `probe()` (scene.ts) — null for a
   *  scene with none. */
  probe(): Record<string, number> | null;
  /** Passthrough to the active scene's own `command()` (scene.ts) — a no-op
   *  for a scene with none. */
  command(name: string, args: Record<string, number>): void;
  /** Mounts `spec` as a real device-menu row (drive chip, wire panel,
   *  jack, cables, A/T, reset — deviceMenu.ts's own `appendSettingRow`)
   *  into `container`. `opts.linked` is the multi-item-selection bridge
   *  (itemBoxes.ts's own multi-strain edit, 2026-09-27): every OTHER item
   *  currently selected alongside `spec`'s own item, sharing the same
   *  `spec.item.param`. When given, deviceMenu applies any edit this row
   *  makes — a value (slider drag, typed value, reset arrow, T mute), an
   *  Auto toggle, or a drive/patch change (anything in the wire panel,
   *  jack/cable wiring, reset to scene default) — to every linked setting
   *  too, and shows a divergent-value tick per linked item on a numeric
   *  row's slider track (and a "Mixed — …" drive summary) for as long as
   *  they disagree with `spec`. `opts.ownLabel` is `spec`'s own item's
   *  short name (e.g. "PP-A1") — needed only to name it in that "Mixed —
   *  …" line alongside `linked`'s own labels; harmless to omit when
   *  `linked` is empty/omitted, which makes this an ordinary single-item
   *  row exactly as before. No widget supplies `linked` today (itemBoxes.ts
   *  dropped its multi-item selection); itemSelection.ts's
   *  `formatMixedSummary` is the one rule of that path still in use. */
  appendRow(container: HTMLElement, spec: SceneSetting, opts?: { ownLabel?: string; linked?: readonly LinkedSetting[] }): void;
  /** Mounts several rows (each the same shape `appendRow` takes — a spec
   *  plus its own optional `ownLabel`/`linked`) into `container` as one
   *  scoped unit: `dispose()` unregisters exactly what these rows
   *  registered (drive row handles, spark canvases, jack/cable entries via
   *  `linkedByKey`) and removes exactly their DOM, then triggers the
   *  existing cable recompute — see this file's header for why a widget
   *  reaches for this instead of `ctx.rerender()` on a selection change. A
   *  mount that happens to recreate the row currently pinned open (by
   *  `sceneId`+`spec.key`) picks its patch panel back up automatically,
   *  mirroring what a full rebuild's own pinned-row reconciliation does.
   *  Safe to call again with a fresh `rows` set after disposing the
   *  previous call's handle — that's the whole update path (itemBoxes.ts's
   *  selection change: dispose the old rows section, mount the new one). */
  mountRows(
    container: HTMLElement,
    rows: readonly { spec: SceneSetting; ownLabel?: string; linked?: readonly LinkedSetting[] }[],
  ): { dispose(): void };
  /** Mounts a whole extra card (controlsKit.ts's `createCard`) as a sibling
   *  of the Scene card, right after it in the controls column — for a widget
   *  section that reads as its own block rather than more rows inside the
   *  Scene card (Physarum 2's Affinity pads, 2026-09-28: the user wanted "air"
   *  and the card's own hover/pin behaviour, not a `groupHeading` inside the
   *  Scene card body). Built fresh on every call, exactly once per widget
   *  mount, the same as the widget's own DOM built straight into the
   *  `container` a plain `registerWidget` builder gets — deviceMenu.ts clears
   *  every card a widget mounted this way at the top of the next
   *  `renderSceneSettings()` (a scene switch, a Look apply, a card Reset),
   *  so nothing needs its own `ctx.onDispose` just to avoid leaking across a
   *  rebuild. The returned `body` is where the widget appends its own
   *  content, exactly like the `container` a `registerWidget` builder or
   *  `appendRow` receives. `spec.foldId` behaves exactly as it does for any
   *  other card — pick one that can't collide with another mounted card on
   *  the same scene (e.g. `${sceneId}-${family}-affinity`, not the bare
   *  scene id) since panelFolds.ts's persistence is keyed by that string
   *  alone. The card's title is marked as a keyboard block (deviceMenu.ts's
   *  markBlock) automatically, the same as the Scene card's own title or a
   *  group heading — no separate call needed. */
  mountCard(spec: CardSpec): { el: HTMLElement; body: HTMLElement };
  /** Makes `rowEl` pinnable/soloable exactly like an ordinary non-drive
   *  Scene-card row (a toggle or enum picker with no `spec.drive`): hovering
   *  or focusing anything inside it wakes it (the plain `.vc-row` CSS this
   *  file's callers already give their rows), and a press anywhere on it —
   *  `rowEl` is passed as its own "value control", so `isCardPress`
   *  (deviceMenu.ts) never excludes a pad, a fader or a button inside it —
   *  pins it: the `.vc-drive-pinned` ring, Escape to unpin, Tab-while-pinned,
   *  and Solo (which shows only the pinned row, or the Scene card when
   *  nothing is) all fall out of the exact same bookkeeping a real setting's
   *  row gets, because this reuses that bookkeeping's own non-drive branch
   *  rather than a second, parallel pin system (deviceMenu.ts's
   *  `registerPinnableRow`, factored out of `appendSettingRow`'s own
   *  `registerPinRow` for this).
   *
   *  `spec` is the pin's identity — deviceMenu.ts's `pinned`/`pinRowHandles`
   *  are keyed by `(sceneId, spec.key)`, a real `SceneSetting`, but a row
   *  built this way often doesn't edit one single setting (Physarum 2's
   *  pairs row edits up to sixteen `att`/`touch` cells from one drag; the mix
   *  row's Random/Nudge/Back touch a whole table at once) — there's no
   *  single real spec that would honestly name "this row". The fix used here
   *  is a **synthetic `SceneSetting`**: a plain object with a unique `key`
   *  and otherwise-unused filler fields (`label`/`min`/`max`/`step`/
   *  `default`), never returned by `ctx.specsFor`/`ctx.specs`, never read by
   *  `ctx.get`/`ctx.set`, never uploaded to a uniform or written into a Look.
   *  It's safe precisely because every consumer of `pinned.spec` elsewhere in
   *  deviceMenu.ts already has to tolerate a spec with no `.drive` and no
   *  `.item` — an ordinary toggle/enum row is exactly that today — so a
   *  synthetic spec is indistinguishable from that existing case: patch/jack/
   *  cable code reads `spec.drive` (absent, so "no patch"), the per-tick
   *  external-change poll is already gated on `pinned?.spec.drive`, and nothing
   *  else dereferences a field this object doesn't have. A widget makes its
   *  own synthetic spec with a small helper (pairPads.ts's `rowSpec`) rather
   *  than this file minting one, since only the widget knows a key that's
   *  unique within its own mount. */
  registerCard(rowEl: HTMLElement, spec: SceneSetting): void;
  /** Registers `fn` to run on every device-menu tick (unthrottled) while
   *  this section is mounted — cleared automatically on the next rebuild. */
  onTick(fn: () => void): void;
  /** Registers `fn` to run once, right before the next full Scene-card
   *  rebuild (a selection change via `rerender()`, a scene switch, a Look
   *  apply, a card Reset). */
  onDispose(fn: () => void): void;
  /** Re-runs the whole Scene card — see this file's header for why a widget
   *  reaches for this instead of patching its own DOM on a selection
   *  change. */
  rerender(): void;
}

export type WidgetBuild = (container: HTMLElement, section: PanelSection, ctx: WidgetCtx) => void;

const widgets = new Map<string, WidgetBuild>();

export function registerWidget(id: string, build: WidgetBuild): void {
  widgets.set(id, build);
}

export function getWidget(id: string): WidgetBuild | undefined {
  return widgets.get(id);
}

export function listWidgetIds(): readonly string[] {
  return [...widgets.keys()];
}
