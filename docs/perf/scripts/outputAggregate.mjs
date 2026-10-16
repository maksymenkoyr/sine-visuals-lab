// Merges outputIsolation.mjs result files (PR #541) per condition: output
// render-gap misses (gaps between rendered output frames over the long-gap
// threshold), missed frames at the frame cadence, gaps over the longer
// threshold, rendered frames per window, plus close/seen detection times. The
// thresholds and the cadence are set in `stats()` in outputIsolation.mjs.
//
// Run from the repo root on the JSON that outputIsolation.mjs writes (by default
// in tools/.cache/perf-probes/, named `<mode>-results.json`):
//   node docs/perf/scripts/outputAggregate.mjs FILE.json [FILE.json …]
// Prints one line per condition (with a dpr suffix when a file was not run at
// dpr 1); writes nothing. No browser, GPU or dev server is needed.
const { readFileSync } = await import("node:fs");
const rows = process.argv.slice(2).flatMap((f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  return j.results.map((r) => ({ ...r, file: f.split("/").pop(), dsf: j.dsf }));
});
const by = new Map();
for (const r of rows) {
  const k = `${r.cond}${r.dsf !== 1 ? ` @dpr${r.dsf}` : ""}`;
  if (!by.has(k)) by.set(k, []);
  by.get(k).push(r);
}
const mean = (a) => (a.reduce((p, q) => p + q, 0) / a.length).toFixed(1);
for (const [k, rs] of by) {
  const g = (f) => rs.map(f);
  const o25 = g((r) => r.render.over25);
  const m60 = g((r) => r.render.missed60);
  const o50 = g((r) => r.render.over50);
  const n = g((r) => r.render.frames);
  const mx = g((r) => r.render.maxMs);
  const lost = g((r) => r.out.lost);
  console.log(
    `${k.padEnd(34)} reps ${rs.length} | >25ms mean ${mean(o25)} [${o25.join(",")}] | missed60 mean ${mean(m60)} [${m60.join(",")}] | >50ms [${o50.join(",")}] | max ${Math.max(...mx)} | frames ${Math.min(...n)}-${Math.max(...n)} | rAF lost@120 mean ${mean(lost)} | main>25 mean ${mean(g((r) => r.main.over25))} | pic ${g((r) => r.pictureSamples).join(",")} | rend ${[...new Set(g((r) => r.renderers))].join("/")} | closed ${Math.min(...g((r) => r.closedMs))}-${Math.max(...g((r) => r.closedMs))}ms | seen ${Math.min(...g((r) => r.seenMs))}-${Math.max(...g((r) => r.seenMs))}ms`,
  );
}
