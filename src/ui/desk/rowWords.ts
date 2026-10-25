/**
 * The words a "Play will change" row shows (issue #620): what the row is, and
 * LIVE's and NEXT's value for it, in plain words a player reads at a glance.
 * Pure: the caller passes the names (scene, palette, a setting's label) so
 * this file imports no app state. The row kinds come from net/lookDiff.ts.
 */
import type { LookRow } from "../../net/lookDiff.ts";

export interface RowNames {
  scene(id: string): string;
  palette(id: string): string;
  /** A scene setting's label for `scope` (a scene id, maybe with "@…") and `key`; null when unknown. */
  setting(scope: string, key: string): string | null;
}

export interface RowWords {
  name: string;
  from: string;
  to: string;
}

/** Longer than this, a stored text reads as "changed" instead of as itself. */
const VALUE_MAX = 24;

/** The plain word for each field of a drive entry. A field not listed reads as its own name. */
const DRIVE_FIELD_WORDS: ReadonlyMap<string, string> = new Map([
  ["patch", "wires"],
  ["choice", "wires"],
  ["line", "drawn line"],
  ["lineStrength", "drawn line"],
  ["threshold", "window"],
  ["thresholdOn", "window"],
  ["windowMax", "window"],
  ["smoothness", "smoothness"],
  ["smoothnessOn", "smoothness"],
  ["readout", "reaction"],
]);

/** Names for the storage keys that are not a scene's own settings. */
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ["vibe.sceneMaster", "Master Scale"],
  ["vibe.sceneExpansion", "Master Expansion"],
  ["vibe.sceneExpansionShape", "Expansion shape"],
]);

export function describeRow(row: LookRow, names: RowNames): RowWords {
  switch (row.kind) {
    case "scene":
      return { name: "Scene", from: names.scene(row.from), to: names.scene(row.to) };
    case "palette":
      return { name: "Palette", from: names.palette(row.from), to: names.palette(row.to) };
    case "entry":
      return row.storageKey === "vibe.drives" ? driveRow(row, names) : settingRow(row, names);
    case "key":
      return {
        name: KEY_NAMES.get(row.storageKey) ?? row.storageKey.replace(/^vibe\./, ""),
        from: keyValue(row.from),
        to: keyValue(row.to),
      };
  }
}

function settingRow(row: Extract<LookRow, { kind: "entry" }>, names: RowNames): RowWords {
  return {
    name: names.setting(row.scope, row.key) ?? row.key,
    from: entryValue(row.from),
    to: entryValue(row.to),
  };
}

function driveRow(row: Extract<LookRow, { kind: "entry" }>, names: RowNames): RowWords {
  const { from, to } = driveWords(row.from, row.to);
  return { name: `${names.setting(row.scope, row.key) ?? row.key} wires`, from, to };
}

function entryValue(v: unknown): string {
  if (v === undefined) return "default";
  if (typeof v === "number") return v.toFixed(2);
  return JSON.stringify(v) ?? "changed";
}

/** A drive entry's fields that differ, as plain words. The side that has no
 *  entry reads "default"; the side that has one names what it changes. */
function driveWords(from: unknown, to: unknown): { from: string; to: string } {
  const a = fieldsOf(from);
  const b = fieldsOf(to);
  const words: string[] = [];
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[field]) === JSON.stringify(b[field])) continue;
    const word = DRIVE_FIELD_WORDS.get(field) ?? field;
    if (!words.includes(word)) words.push(word);
  }
  return {
    from: from === undefined ? "default" : "as LIVE",
    to: to === undefined ? "default" : words.join(", ") || "changed",
  };
}

function fieldsOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function keyValue(text: string | null): string {
  if (text === null) return "default";
  const n = text.trim() === "" ? Number.NaN : Number(text);
  if (Number.isFinite(n)) return n.toFixed(2);
  return text.length > VALUE_MAX ? "changed" : text;
}
