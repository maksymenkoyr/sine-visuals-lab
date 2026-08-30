import type { SceneSetting } from "./sceneSettings.ts";
import { getSceneSetting, setSceneSetting } from "./sceneSettings.ts";
import { isAutoEnabled, seedAuto, setAutoEnabled } from "./autoTune.ts";

/**
 * Named, shareable snapshots of one scene's own settings — the sliders in the
 * device menu's Scene card. Not "Preset": that word already means the
 * rendering quality tier (quality.ts's QualityPreset, qualityPref.ts). Not
 * Sensitivity/Expansion/Smoothing, band gains, auto-gain, quality, or power
 * mode either — those are device/room-specific and stay untouched by a Look.
 *
 * autoTune.ts stores auto state as exceptions: a setting absent from its
 * store is auto by default, and the renderer reads resolveSceneSetting (the
 * music-driven value), not the raw stored number. So a Look that carried
 * every slider's number, auto or not, would silently do nothing on any auto
 * key — the number would sit in sceneSettings.ts's store, shadowed by
 * whatever the music resolves to. A Look therefore stores exactly what
 * autoTune.ts's own store stores: the manual exceptions, nothing else. This
 * also keeps codes short, since auto-at-default is every setting's resting
 * state.
 *
 * applyLook is authoritative, not additive: every spec in the scene is set,
 * not just the keys the Look lists. A key absent from the Look is put back
 * to its default AND back to auto — so applying Look A then Look B can't
 * leave one of A's pins bleeding through B, and a link's sender/receiver
 * converge on identical state.
 *
 * Share-code format is version-tagged JSON (`{v:1,n,s,m}`), base64url of its
 * UTF-8 bytes. decodeLook never throws — a malformed or future-versioned
 * code (a link outlives this schema) comes back null, and the caller decides
 * what "didn't parse" means.
 */
export interface SceneLook {
  name: string;
  sceneId: string;
  /** Settings pinned by hand, and the value each was pinned to. A key absent
   *  here resolves from the music at its spec default — the same "absent
   *  means auto" rule autoTune.ts's own exception store uses. */
  manual: Record<string, number>;
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
  for (const spec of specs) {
    if (!isAutoEnabled(sceneId, spec.key)) manual[spec.key] = getSceneSetting(sceneId, spec);
  }
  return { name, sceneId, manual };
}

/** Sets every spec in the scene — pins the keys the Look lists, and returns
 *  every other key to auto at its default. See the module header for why
 *  this has to be authoritative rather than additive. */
export function applyLook(look: SceneLook, specs: readonly SceneSetting[]): void {
  for (const spec of specs) {
    const value = look.manual[spec.key];
    if (value !== undefined) {
      setAutoEnabled(look.sceneId, spec.key, false);
      setSceneSetting(look.sceneId, spec, value);
    } else {
      setSceneSetting(look.sceneId, spec, spec.default);
      seedAuto(look.sceneId, spec.key, spec.default);
      setAutoEnabled(look.sceneId, spec.key, true);
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
  return toBase64Url(JSON.stringify({ v: CODE_VERSION, n: look.name, s: look.sceneId, m: look.manual }));
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
    return { name: parsed.n, sceneId: parsed.s, manual };
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
