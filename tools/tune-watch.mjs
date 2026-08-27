#!/usr/bin/env node
// Watches tuning/marks/ and prints one line per new capture (mark or clip).
// This is the "session" half of the tuning workflow: run this in the
// background and subscribe to its stdout (e.g. via the Monitor tool) to get
// notified the instant you press Option+M / Option+C, instead of needing to
// be asked or to poll the directory by hand.
import { watch, mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "tuning", "marks");
mkdirSync(dir, { recursive: true });

const seen = new Set();

watch(dir, (_event, filename) => {
  if (!filename || !filename.endsWith(".json") || seen.has(filename)) return;
  seen.add(filename);
  console.log(`CAPTURED ${filename}`);
});

console.log(`[tune-watch] watching ${dir}`);
