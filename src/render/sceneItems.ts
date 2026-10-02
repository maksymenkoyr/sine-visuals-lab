import type { AutoWeights } from "./autoTune.ts";
import type { DriveChoice } from "./drives.ts";
import type { SignalId } from "./signals.ts";
import { SETTING_GROUPS, type SceneSetting, type SettingGroup } from "./sceneSettings.ts";

/**
 * Declarative "items" for a scene with several identical, independently
 * tunable instances of the same thing (Physarum 2's four strains; a future
 * scene's several emitters/objects) — a small generator over
 * `src/render/sceneSettings.ts`'s existing flat, keyed `SceneSetting` model,
 * not a second settings system next to it. Pure, no DOM — this module never
 * imports anything under `src/ui/`.
 *
 * **Why flat.** Every place a setting lives — the localStorage store
 * (sceneSettings.ts), the drive engine (drives.ts, keyed per `spec.key`),
 * auto-tune (autoTune.ts), Looks (sceneLooks.ts), the uniform upload
 * (sceneCommon.ts's `settingUniformName`) — already keys everything by one
 * flat `string`. Generating four settings named `nutrient0`..`nutrient3`
 * instead of inventing a nested or array-valued setting means every one of
 * those systems handles an item's control exactly like any hand-written
 * setting, on day one, with no new code path to keep in sync anywhere.
 * `defineItems`/`defineItemPairs` below are purely a *naming and defaulting*
 * convenience over that model — they build ordinary `SceneSetting[]`
 * entries, nothing more, and a scene is free to mix generated and
 * hand-written settings in one `settings` array.
 *
 * **The `item` tag.** Each generated setting carries `SceneSetting.item:
 * { family, index, param, other? }` (declared on `SceneSetting` itself, in
 * sceneSettings.ts, since every consumer of a setting already imports that
 * type): `family` names the item group ("strain"), `index` is which item
 * (0-based), `param` is which per-item control this is ("nutrient"), and
 * `other` is only set by `defineItemPairs` below (a *pairwise* family like
 * `att<i><j>`) — the paired item's own index. This is what lets a panel
 * section (`scene.ts`'s `PanelSection`) find "every setting belonging to
 * item 2 of family strain" without parsing the key string back apart, and
 * what lets `src/tuning/bakeDefaults.ts` skip a generated setting — its
 * default lives in the scene's own item table above, not a literal
 * `default:` a bake could find and rewrite in source. `defineItemPairs`'s
 * `diagonal: false` skips `i === j` entirely, for a pair table that has no
 * own-item meaning (Physarum 2's Touch: a strain doesn't feed/eat its own
 * trail through this control).
 *
 * **The panel/widget split.** A scene declares *what* its items are
 * (`defineItems`/`defineItemPairs` here, plain data) and *how they're
 * shown* (`Scene.panel`, rendered by `src/ui/widgets/registry.ts`'s
 * widgets) as two separate pieces, both still pure — the actual DOM only
 * gets built in the browser, by `src/ui/deviceMenu.ts` and the widget
 * itself. Nothing under `src/render/` ever imports `src/ui/`. This is also
 * why the TV (`src/tv.ts`) and a paid scene under
 * `src/render/scenes/private/` can ignore `panel` outright: no setting of
 * any kind reaches the TV (phone-only already — see `src/net/protocol.ts`),
 * and anywhere the device menu never opens (the TV, a gallery preview, a
 * test), a scene's `settings` array — the same flat list
 * `composeSettings` below produces — is all that's ever read; `panel` only
 * matters to the one file that renders it.
 *
 * **Ordering.** `composeSettings(...lists)` concatenates its arguments and
 * stable-sorts the result by `SETTING_GROUPS` order (an ungrouped setting
 * sorts first) — the same contiguous-run-per-group invariant every
 * hand-written `settings` array already has to keep
 * (`tests/settingGroups.test.ts`), now enforced structurally instead of by
 * hand-ordering a mixed list of generated and hand-written entries.
 */

/** A per-item field that's either the same for every index, or computed
 *  from the index. Deliberately not also "a plain array read by index" —
 *  when `T` is itself an array (`drive.sceneSources`'s
 *  `readonly SignalId[]`), a bare array can't be told apart from "one array
 *  shared by every index" vs "one array per index" without extra shape
 *  info; a function has no such ambiguity for any `T`. */
export type ItemFieldValue<T> = T | ((index: number) => T);

function resolveItemField<T>(value: ItemFieldValue<T> | undefined, index: number): T | undefined {
  if (value === undefined) return undefined;
  return typeof value === "function" ? (value as (i: number) => T)(index) : value;
}

/** `SceneSetting.drive`, with every field optionally per-index — see
 *  `ItemFieldValue`. */
export interface ItemDriveParam {
  default: ItemFieldValue<DriveChoice>;
  sceneLabel?: ItemFieldValue<string>;
  gain?: ItemFieldValue<number>;
  sceneSources?: ItemFieldValue<readonly SignalId[]>;
}

/** One per-item control, shared across every index of the family unless a
 *  field is given as a per-index function — see `defineItems`. */
export interface ItemParam {
  /** Becomes the generated key's prefix: `defineItems("strain", 4, { key:
   *  "nutrient", ... })` yields settings keyed `nutrient0`..`nutrient3`. */
  key: string;
  label: string;
  description?: string;
  group?: SettingGroup;
  min: number;
  max: number;
  step: number;
  default: ItemFieldValue<number>;
  type?: "boolean" | "enum";
  options?: readonly string[];
  advanced?: boolean;
  auto?: ItemFieldValue<AutoWeights>;
  drive?: ItemDriveParam;
}

/** One `SceneSetting` per index `0..count-1`, keyed `<param.key><index>`
 *  and tagged `item: { family, index, param: param.key }` — see this
 *  file's header. */
export function defineItems(family: string, count: number, param: ItemParam): SceneSetting[] {
  const out: SceneSetting[] = [];
  for (let index = 0; index < count; index++) {
    const drive = param.drive
      ? {
          default: resolveItemField(param.drive.default, index)!,
          sceneLabel: resolveItemField(param.drive.sceneLabel, index),
          gain: resolveItemField(param.drive.gain, index),
          sceneSources: resolveItemField(param.drive.sceneSources, index),
        }
      : undefined;
    out.push({
      key: `${param.key}${index}`,
      label: param.label,
      description: param.description,
      group: param.group,
      min: param.min,
      max: param.max,
      step: param.step,
      default: resolveItemField(param.default, index)!,
      type: param.type,
      options: param.options,
      advanced: param.advanced,
      auto: resolveItemField(param.auto, index),
      drive,
      item: { family, index, param: param.key },
    });
  }
  return out;
}

/** One pairwise control (`att<i><j>` — an attraction/affinity matrix), over
 *  every family. */
export interface PairwiseParam {
  key: string;
  /** Per-pair label; `(i, j)` are both item indices, `i === j` is the
   *  "own"/diagonal pair. Defaults to a plain "`<family> i→j`" — a scene
   *  with meaningful item names (codes, say) should supply this instead. */
  label?: (i: number, j: number) => string;
  description?: string;
  group?: SettingGroup;
  min: number;
  max: number;
  step: number;
  /** `default[i][j]`, a function, or one plain number shared by every pair
   *  (Physarum 2's Touch, which starts at rest for every strain) — mirrors a
   *  plain matrix rather than forcing a flat per-pair list. */
  default: readonly (readonly number[])[] | ((i: number, j: number) => number) | number;
  /** False skips `i === j`, for a pair table that has no own-item meaning
   *  (Physarum 2's Touch: a strain doesn't feed/eat its own trail through
   *  this control) — the diagonal is simply never emitted, rather than
   *  emitted and ignored, so it can't sit as a permanently dead key in
   *  Looks, resets or share codes. Default true (the diagonal is emitted,
   *  as before). */
  diagonal?: boolean;
  /** Copied onto every generated spec — see `SceneSetting.masterScale`. */
  masterScale?: false;
}

/** One `SceneSetting` per `(i, j)` pair over `0..count-1` (`i === j`
 *  included unless `param.diagonal === false`), keyed `<param.key><i><j>`
 *  and tagged `item: { family, index: i, param: param.key, other: j }` —
 *  see this file's header. */
export function defineItemPairs(family: string, count: number, param: PairwiseParam): SceneSetting[] {
  const out: SceneSetting[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      if (param.diagonal === false && i === j) continue;
      const def =
        typeof param.default === "function"
          ? param.default(i, j)
          : typeof param.default === "number"
            ? param.default
            : param.default[i]![j]!;
      out.push({
        key: `${param.key}${i}${j}`,
        label: param.label ? param.label(i, j) : `${family} ${i}→${j}`,
        description: param.description,
        group: param.group,
        min: param.min,
        max: param.max,
        step: param.step,
        default: def,
        masterScale: param.masterScale,
        item: { family, index: i, param: param.key, other: j },
      });
    }
  }
  return out;
}

/** Concatenates every list, then stable-sorts by `SETTING_GROUPS` order (an
 *  ungrouped setting sorts before every grouped one, matching how a scene
 *  with no groups at all already reads) — see this file's header. */
export function composeSettings(...lists: readonly (readonly SceneSetting[])[]): SceneSetting[] {
  const rank = (g: SettingGroup | undefined): number => (g === undefined ? -1 : SETTING_GROUPS.indexOf(g));
  // concat, not .flat(): this runs at module load (physarum2.ts), and the TV
  // runtimes the es2017 build target exists for (vite.config.ts) lack .flat().
  return ([] as SceneSetting[])
    .concat(...lists)
    .map((spec, order) => ({ spec, order }))
    .sort((a, b) => rank(a.spec.group) - rank(b.spec.group) || a.order - b.order)
    .map((x) => x.spec);
}
