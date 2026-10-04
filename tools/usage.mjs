#!/usr/bin/env node
// Reads the anonymous usage counts (server/usage.ts) back out of Workers
// Analytics Engine: sessions (`start`) and scene views per day, per country
// and per scene, with the owner's `?me=1` browsers left out.
//
//   npm run usage              # last 30 days
//   npm run usage -- 7         # last 7 days
//   npm run usage -- 30 --me   # include the owner's own events
//
// "Last N days" is N whole UTC days plus today so far: the window starts at
// midnight, so a date's row reads the same whatever N is. A rolling N×24 h
// window cut the first day short.
//
// Auth: CLOUDFLARE_API_TOKEN, from the environment or from the gitignored
// `.env` at the repo root (the main checkout's, so it works from any
// worktree). It needs Account > Account Analytics > Read — create it once at
// dash.cloudflare.com/profile/api-tokens. A `wrangler login` session can't
// stand in: its OAuth scopes don't cover the Analytics Engine SQL API.
// CLOUDFLARE_ACCOUNT_ID comes from the same places and is required: a token
// with only that one permission can't list accounts to find it.
//
// Counts are SUM(_sample_interval), not COUNT(): Analytics Engine may sample
// under load, and the interval re-weights each surviving row.
//
// Column names follow the blob order in usageDataPoint() — blob1 kind,
// blob2 scene, blob3 source, blob4 me|visitor, blob5 country, blob6 device.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DATASET = "sinevisualslab_usage"; // wrangler.toml [[analytics_engine_datasets]]

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
const includeMe = args.includes("--me");

function fromDotEnv(name) {
  let root = ".";
  try {
    // --git-common-dir is the main checkout's .git, even from a worktree.
    root = dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
  } catch {}
  try {
    return readFileSync(join(root, ".env"), "utf8").match(new RegExp(`^${name}\\s*=\\s*"?([^"\\s]+)"?`, "m"))?.[1] ?? null;
  } catch {
    return null;
  }
}

const token = process.env.CLOUDFLARE_API_TOKEN ?? fromDotEnv("CLOUDFLARE_API_TOKEN");
if (!token) {
  console.error("No CLOUDFLARE_API_TOKEN — add it to .env at the repo root (see the header of this file).");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 500)}`);
  return text;
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? fromDotEnv("CLOUDFLARE_ACCOUNT_ID");
if (!account) {
  console.error("No CLOUDFLARE_ACCOUNT_ID — add it to .env next to the token (dashboard URL: dash.cloudflare.com/<account id>/…).");
  process.exit(1);
}

async function sql(query) {
  const text = await api(`/accounts/${account}/analytics_engine/sql`, { method: "POST", body: query });
  return JSON.parse(text).data;
}

const where = `timestamp >= toStartOfInterval(NOW() - INTERVAL '${days}' DAY, INTERVAL '1' DAY)${includeMe ? "" : " AND blob4 = 'visitor'"}`;
const who = includeMe ? "everyone, owner included" : "visitors only";

function table(title, rows) {
  console.log(`\n${title}`);
  if (!rows.length) return console.log("  (none)");
  const keys = Object.keys(rows[0]);
  const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  console.log("  " + keys.map((k, i) => k.padEnd(width[i])).join("  "));
  for (const r of rows) console.log("  " + keys.map((k, i) => String(r[k]).padEnd(width[i])).join("  "));
}

console.log(`Usage, last ${days} days (${who})`);

table(
  "Per day — sessions = first scene started on audio in a page load; views = every scene run",
  await sql(`SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
      SUM(IF(blob1 = 'start', _sample_interval, 0)) AS sessions,
      SUM(_sample_interval) AS views
    FROM ${DATASET} WHERE ${where} GROUP BY day ORDER BY day`),
);

table(
  "Per country",
  await sql(`SELECT blob5 AS country, SUM(IF(blob1 = 'start', _sample_interval, 0)) AS sessions, SUM(_sample_interval) AS views
    FROM ${DATASET} WHERE ${where} GROUP BY country ORDER BY sessions DESC LIMIT 30`),
);

table(
  "Per scene",
  await sql(`SELECT blob2 AS scene, SUM(_sample_interval) AS views, SUM(IF(blob1 = 'start', _sample_interval, 0)) AS opened_with
    FROM ${DATASET} WHERE ${where} GROUP BY scene ORDER BY views DESC LIMIT 50`),
);

table(
  "Per source and device",
  await sql(`SELECT blob3 AS source, blob6 AS device, SUM(IF(blob1 = 'start', _sample_interval, 0)) AS sessions
    FROM ${DATASET} WHERE ${where} GROUP BY source, device ORDER BY sessions DESC`),
);
