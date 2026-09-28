#!/usr/bin/env node
// Prints the scene-version map for a build — `node tools/scene-versions.mjs
// stable|insider|preview|dev` → the `byUnit` object tools/sceneVersions.mjs
// computed (`null` if git/origin/production wasn't available — see that
// file's header for why that's a warning, not a crash). One level down from
// tools/app-version.mjs: that prints the one build-wide number, this prints
// every scene's own.
//
// Not run by CI — the Vite plugins (vite-build-info-plugin.ts,
// vite-scene-versions-plugin.ts) call tools/sceneVersions.mjs directly during
// `npm run build`. This is for a human (or a rehearsal script) asking "what
// would the scenes look like on channel X right now".
import { computeSceneVersions } from "./sceneVersions.mjs";

const CHANNELS = new Set(["stable", "insider", "preview", "dev"]);
const channel = process.argv[2];

if (!CHANNELS.has(channel)) {
  console.error("usage: node tools/scene-versions.mjs stable|insider|preview|dev");
  process.exit(2);
}

const result = await computeSceneVersions({ root: process.cwd(), channel });
console.log(JSON.stringify(result?.byUnit ?? null, null, 2));
