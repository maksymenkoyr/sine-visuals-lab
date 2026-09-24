import type { SceneSetting } from "./sceneSettings.ts";
import { getSceneSetting, setSceneSetting, settingDefault, variantFirst } from "./sceneSettings.ts";
import { isAutoEnabled, seedAuto, setAutoEnabled } from "./autoTune.ts";
import { defaultDriveSetting, sameDriveSetting, type DriveSetting } from "./drives.ts";
import { encodeDriveSetting, getDriveSetting, resetDriveSetting, sanitizeDriveSetting, setDriveSetting, type StoredDriveSetting } from "./driveStore.ts";

/**
 * Named, shareable snapshots of one scene's own settings — the sliders in the
 * device menu's Scene card. Not "Preset": that word already means the
 * rendering quality tier (quality.ts's QualityPreset, qualityPref.ts). Not
 * Sensitivity/Expansion/Smoothing, band gains, auto-gain, quality, or power
 * mode either — those are device/room-specific and stay untouched by a Look.
 *
 * autoTune.ts's own store lists only the settings a user has switched TO
 * auto (opt-in, off by default), and the renderer reads resolveSceneSetting
 * (the music-driven value when auto, the raw stored number otherwise), not
 * the raw stored number directly. So a Look that carried every slider's
 * number, auto or not, would silently do nothing on any auto key — the
 * number would sit in sceneSettings.ts's store, shadowed by whatever the
 * music resolves to. A Look therefore stores exactly the settings that
 * aren't auto: the ones a plain apply wouldn't already reproduce. Since
 * Auto is off by default, a captured Look will usually list most or all of
 * a scene's non-variant settings in `manual` (longer codes than when Auto
 * shipped on, same format).
 *
 * applyLook is authoritative, not additive: every spec in the scene is set,
 * not just the keys the Look lists. A key absent from the Look is put back
 * to its default AND back to auto — so applying Look A then Look B can't
 * leave one of A's pins bleeding through B, and a link's sender/receiver
 * converge on identical state.
 *
 * Share-code format is version-tagged JSON (`{v:1,n,s,m,d}`), base64url of
 * its UTF-8 bytes. `d` is optional — added for SceneSetting.drive
 * (src/render/drives.ts) without bumping `v`: an old code simply lacks it,
 * and an old app decoding a new code just ignores the unknown key, same as
 * any other schema-outlives-the-link case this format tolerates. decodeLook
 * never throws — a malformed or future-versioned code (a link outlives this
 * schema) comes back null, and the caller decides what "didn't parse" means.
 *
 * Each `d` entry is one setting's captured `DriveSetting` (drives.ts), wire-
 * encoded as whichever of two shapes is smaller: a one-source, weight-1,
 * Graded `add` patch — the identity shape a plain `DriveChoice` used to be,
 * before this store had patches — encodes as that bare `DriveChoice` (a
 * string id, or `{source:"beat"|"line", …}`), so a link built by an app from
 * before patches existed still decodes here, and a link built by this app
 * for a setting nobody has multi-sourced still decodes on that older app.
 * Anything else (more than one source, a non-`add` mix, a non-1 weight, or a
 * non-Graded height) encodes as the compact patch
 * `{m: DriveMix, s: [{c: DriveChoice, w?: number, h?: HitHeight}, …]}` — an
 * old app ignores a `d` entry it can't parse as a plain choice the same way
 * it ignores `d` itself (ignore the unknown shape, fall back to the
 * setting's own default). This is the exact same `StoredDriveSetting` shape
 * `DriveEntry.patch` persists to localStorage as — one canonical wire shape
 * for a DriveSetting crossing either boundary, the same way a bare
 * `DriveChoice` already served both before patches existed — so
 * `encodeDriveSetting`/`sanitizeDriveSetting` (driveStore.ts) are reused
 * here rather than re-derived.
 */
export interface SceneLook {
  name: string;
  sceneId: string;
  /** Settings pinned by hand, and the value each was pinned to. A key absent
   *  here goes back to auto at its spec default when the Look is applied —
   *  applyLook (below) is what actually enforces that, not an "absent means
   *  auto" default in autoTune.ts's own store (that store now defaults every
   *  key to manual; a Look's apply is what puts an omitted key into auto). */
  manual: Record<string, number>;
  /** Each drive setting's captured `DriveSetting` (src/render/drives.ts),
   *  only for a setting whose setting isn't already its own `drive.default`
   *  — same "only what a plain apply wouldn't already reproduce" rule as
   *  `manual`, compared with `sameDriveSetting`. Omitted entirely when every
   *  drive setting was already at its default, and always on a Look
   *  captured before this field existed; applyLook treats a key absent here
   *  the same way it treats one absent from `manual` — back to default,
   *  authoritative. */
  drives?: Record<string, DriveSetting>;
}

const STORAGE_KEY = "vibe.looks";
const CODE_VERSION = 1;

type Store = Record<string, SceneLook[]>;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const cache: Store = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — looks just won't persist across reloads.
  }
}

export function listLooks(sceneId: string): SceneLook[] {
  return cache[sceneId] ?? [];
}

/** Upsert by name — saving over an existing name replaces it in place rather
 *  than appending a duplicate. */
export function saveLook(look: SceneLook): void {
  const list = (cache[look.sceneId] ??= []);
  const i = list.findIndex((l) => l.name === look.name);
  if (i >= 0) list[i] = look;
  else list.push(look);
  persist();
}

export function deleteLook(sceneId: string, name: string): void {
  const list = cache[sceneId];
  if (!list) return;
  const next = list.filter((l) => l.name !== name);
  if (next.length === 0) delete cache[sceneId];
  else cache[sceneId] = next;
  persist();
}

export function captureLook(name: string, sceneId: string, specs: readonly SceneSetting[]): SceneLook {
  const manual: Record<string, number> = {};
  let drives: Record<string, DriveSetting> | undefined;
  for (const spec of specs) {
    // The variant (SceneSetting.variant) is always carried, auto or not:
    // every other key is stored per variant option, so a Look that left it
    // out would apply its keys into whatever option the receiver was on.
    if (spec.variant || !isAutoEnabled(sceneId, spec.key)) manual[spec.key] = getSceneSetting(sceneId, spec);
    if (spec.drive) {
      const setting = getDriveSetting(sceneId, spec);
      if (!sameDriveSetting(setting, defaultDriveSetting(spec))) (drives ??= {})[spec.key] = setting;
    }
  }
  return { name, sceneId, manual, drives };
}

/** Sets every spec in the scene — pins the keys the Look lists, and returns
 *  every other key to auto at its default. See the module header for why
 *  this has to be authoritative rather than additive. Same rule for a
 *  `SceneSetting.drive` spec's setting: listed in `look.drives` -> set to
 *  that setting, absent -> back to `spec.drive.default`. */
export function applyLook(look: SceneLook, specs: readonly SceneSetting[]): void {
  // The variant goes first (sceneSettings.ts's variantFirst): every other
  // key is stored per variant option, so it has to be switched before they
  // are written or the Look would land in the profile being left.
  for (const spec of variantFirst(specs)) {
    const value = look.manual[spec.key];
    if (value !== undefined) {
      setAutoEnabled(look.sceneId, spec.key, false);
      setSceneSetting(look.sceneId, spec, value);
    } else {
      const base = settingDefault(look.sceneId, spec);
      setSceneSetting(look.sceneId, spec, base);
      seedAuto(look.sceneId, spec.key, base);
      setAutoEnabled(look.sceneId, spec.key, true);
    }
    if (spec.drive) {
      const setting = look.drives?.[spec.key];
      if (setting !== undefined) setDriveSetting(look.sceneId, spec, setting);
      else resetDriveSetting(look.sceneId, spec);
    }
  }
}

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeLook(look: SceneLook): string {
  const payload: { v: number; n: string; s: string; m: Record<string, number>; d?: Record<string, StoredDriveSetting> } = {
    v: CODE_VERSION,
    n: look.name,
    s: look.sceneId,
    m: look.manual,
  };
  if (look.drives && Object.keys(look.drives).length > 0) {
    payload.d = {};
    for (const [key, setting] of Object.entries(look.drives)) payload.d[key] = encodeDriveSetting(setting);
  }
  return toBase64Url(JSON.stringify(payload));
}

export function decodeLook(code: string): SceneLook | null {
  try {
    const parsed = JSON.parse(fromBase64Url(code));
    if (!parsed || typeof parsed !== "object" || parsed.v !== CODE_VERSION) return null;
    if (typeof parsed.n !== "string" || typeof parsed.s !== "string") return null;
    if (!parsed.m || typeof parsed.m !== "object") return null;
    const manual: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.m)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      manual[key] = value;
    }
    let drives: Record<string, DriveSetting> | undefined;
    if (parsed.d !== undefined) {
      if (!parsed.d || typeof parsed.d !== "object") return null;
      drives = {};
      for (const [key, value] of Object.entries(parsed.d)) {
        const setting = sanitizeDriveSetting(value);
        if (setting === null) return null;
        drives[key] = setting;
      }
    }
    return { name: parsed.n, sceneId: parsed.s, manual, drives };
  } catch {
    return null;
  }
}

// In-memory only, per scene — an immediate-regret affordance for the last
// look applied (including one arriving from a share link on page load), not
// a persisted undo stack.
const undo: Record<string, SceneLook> = {};

export function primeUndo(sceneId: string, specs: readonly SceneSetting[]): void {
  undo[sceneId] = captureLook("", sceneId, specs);
}

export function takeUndo(sceneId: string): SceneLook | null {
  const look = undo[sceneId];
  if (!look) return null;
  delete undo[sceneId];
  return look;
}

export function hasUndo(sceneId: string): boolean {
  return sceneId in undo;
}
