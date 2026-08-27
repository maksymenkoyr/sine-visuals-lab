#!/usr/bin/env node
// Watches a tuning session and prints one line per event. This is the
// "session" half of the tuning workflow: run it in the background and
// subscribe to its stdout (e.g. via the Monitor tool) to be notified the
// instant something happens, instead of needing to be asked or to poll.
//
//   node tools/tune-watch.mjs [--slot A]
//
// Two feeds, because a session produces two kinds of news:
//   CAPTURED <file>            you pressed Option+M / Option+C
//   TUNED <slot> <scene> k=v   you moved a dial and settled on a value
//
// The second is what closes the loop opened by a `focus` entry in the params
// file: I point at a dial, you scrub it, and the value you landed on arrives
// here without either of us copying a number by hand.
import { watch, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flagIndex = args.indexOf("--slot");
const slotFilter = flagIndex === -1 ? null : (args[flagIndex + 1] ?? "").toUpperCase();

const tuningDir = path.join(process.cwd(), "tuning");
const marksDir = path.join(tuningDir, "marks");
mkdirSync(marksDir, { recursive: true });

// --- marks -----------------------------------------------------------------

const seen = new Set();

watch(marksDir, (_event, filename) => {
  if (!filename || !filename.endsWith(".json") || seen.has(filename)) return;
  // Marks are named <slot>-<ts>.json once slots are in play, plain <ts>.json
  // otherwise; both should report, and --slot filters the former.
  const slot = filename.includes("-") ? filename.split("-")[0].toUpperCase() : null;
  if (slotFilter && slot && slot !== slotFilter) return;
  seen.add(filename);
  console.log(`CAPTURED ${filename}`);
});

// --- scrubbed values -------------------------------------------------------

/** Slot -> last settings seen, so only what actually changed gets printed.
 *  Without this every write reprints the whole block. */
const lastSettings = new Map();

function paramsPathFor(slot) {
  return slot === "A"
    ? path.join(tuningDir, "params.json")
    : path.join(tuningDir, `params.${slot}.json`);
}

function slotOfParamsFile(filename) {
  if (filename === "params.json") return "A";
  const m = /^params\.([A-Z0-9]{1,8})\.json$/i.exec(filename);
  return m ? m[1].toUpperCase() : null;
}

function reportParams(slot) {
  const file = paramsPathFor(slot);
  if (!existsSync(file)) return;
  let params;
  try {
    params = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Mid-write, or hand-edited into invalid JSON. The next event re-reads it.
    return;
  }
  const scene = params.scene ?? "?";
  const settings = params.settings ?? {};
  const previous = lastSettings.get(slot) ?? {};
  for (const [key, value] of Object.entries(settings)) {
    if (previous[key] === value) continue;
    console.log(`TUNED ${slot} ${scene} ${key}=${value}`);
  }
  lastSettings.set(slot, { ...settings });
}

// Seed from what's already on disk, silently, so the first thing reported is
// a change you just made rather than a replay of the whole existing file.
for (const filename of readdirSync(tuningDir)) {
  const slot = slotOfParamsFile(filename);
  if (!slot || (slotFilter && slot !== slotFilter)) continue;
  try {
    const params = JSON.parse(readFileSync(path.join(tuningDir, filename), "utf8"));
    lastSettings.set(slot, { ...(params.settings ?? {}) });
  } catch {
    // Leave it unseeded — the first change then reports every key, which is
    // noisy but never wrong.
  }
}

watch(tuningDir, (_event, filename) => {
  if (!filename) return;
  const slot = slotOfParamsFile(filename);
  if (!slot) return;
  if (slotFilter && slot !== slotFilter) return;
  reportParams(slot);
});

const scope = slotFilter ? `slot ${slotFilter}` : "all slots";
console.log(`[tune-watch] watching ${tuningDir} (${scope})`);
