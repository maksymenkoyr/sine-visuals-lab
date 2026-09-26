#!/usr/bin/env node
// Reads the anonymous usage counts (server/usage.ts) back out of Workers
// Analytics Engine: sessions (`start`) and scene views per day, per country
// and per scene, with the owner's `?me=1` browsers left out.
//
//   node tools/usage.mjs            # last 30 days
//   node tools/usage.mjs 7          # last 7 days
//   node tools/usage.mjs 30 --me    # include the owner's own events
//
// Auth: CLOUDFLARE_API_TOKEN, an API token with Account > Account Analytics >
// Read (dash.cloudflare.com/profile/api-tokens). A `wrangler login` session
// can't stand in: its OAuth scopes don't cover the Analytics Engine SQL API.
// CLOUDFLARE_ACCOUNT_ID is optional; without it the token's first account
// is used.
//
// Counts are SUM(_sample_interval), not COUNT(): Analytics Engine may sample
// under load, and the interval re-weights each surviving row.
//
// Column names follow the blob order in usageDataPoint() — blob1 kind,
// blob2 scene, blob3 source, blob4 me|visitor, blob5 country, blob6 device.

const DATASET = "sinevisualslab_usage"; // wrangler.toml [[analytics_engine_datasets]]

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
const includeMe = args.includes("--me");

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN (Account Analytics: Read) — see the header of this file.");
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

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) account = JSON.parse(await api("/accounts")).result[0]?.id;

async function sql(query) {
  const text = await api(`/accounts/${account}/analytics_engine/sql`, { method: "POST", body: query });
  return JSON.parse(text).data;
}

const where = `timestamp > NOW() - INTERVAL '${days}' DAY${includeMe ? "" : " AND blob4 = 'visitor'"}`;
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
