# Performance

How we know what the app costs, and how a change is judged against what it
cost before. The measuring is one command; its history is the JSON files in
[`perf/`](perf/).

## The snapshot

`npm run perf` measures a `git archive` copy of a commit (HEAD by default) on
this machine and saves `docs/perf/<date>-<sha>.json`, then compares it with
the newest snapshot before it. How each number is taken is in the header of
`tools/perf.mjs`; in short:

| Section | What it answers | Main numbers |
| --- | --- | --- |
| load | How much a visit downloads, and how soon it draws | gzip bytes fetched per page in `LOAD_PAGES`, by kind (JS, media, fonts); build total; largest JS chunks; ms to first WebGL draw |
| gpu | What each scene's own shaders cost | GPU ms per frame at each size in `GPU_SIZES`, on the isolated bench page |
| app | What a person actually gets, panel closed and open | drawn fps, frame-gap p95, hitches per minute, main-thread busy share (and its script / layout parts), GPU ms per second, JS heap; the freeze when switching to each scene, on its first visit and on a revisit; heap after GC before and after the whole tour |

`npm run perf -- compare` diffs the two newest snapshots, or any two files.
It reports only changes bigger than run-to-run noise (the `RULES` table in
`tools/perf.mjs`), worst first.

When to take one: before starting performance work (the baseline), after
each merged performance PR, and before a Stable release. `--ref <commit>`
backfills an older commit with today's instruments.

## How far to trust each number

- **Same machine only.** Snapshots record the machine model; numbers from
  two machines don't compare.
- **Close Chrome first.** The user's own Chrome shares the GPU and inflates
  GPU times and hitches, sometimes 2×. A snapshot records whether Chrome was
  running, and compare warns when only one run had it.
- **Isolated GPU ms are for ranking scenes and A/B-ing shader edits**, not
  for frame budgets: the bench GPU clocks down between its synced frames, so
  it reads higher than in the app.
- **In-app GPU ms per second is for comparing runs, not absolutes.** It is a
  timer query around every animation-frame callback, so it spans everything
  the page drew, compositing passes included, and on Metal it likely counts
  some queue time too (a near-empty scene reads a few ms per frame).
- **Main-thread share and hitches are the trustworthy app numbers.** They
  come from Chrome's own task counters and the page's own frame gaps.
- **Load bytes are exact** (gzip -9 of the built files each page fetched; the
  real CDN may use Brotli, which is a bit smaller).
- Not covered: phones, TVs and low-end laptops (nothing to drive headlessly);
  GPU memory (no web API); the pop-out output window and rooms.

## The other instruments

For digging into one finding after a snapshot points at it:

- `tools/gpu-bench.mjs` — one scene's GPU cost per draw call (`--app`), and
  pixel dumps to prove a shader edit changed nothing (`--dump`, `--compare`).
- `docs/scenes/physarum2/scripts/perf/panelprof.mjs` — a CPU profile and
  every blocking GL read with the panel open; the tool behind the panel-lag
  fixes.
- The Power card in the panel — live FPS, main thread, GPU and heap on a
  real device, including the ones the snapshot can't reach.

## Standing decisions

- Energy saving (the governor) is Off by default: a dropped frame is worse
  than any quality loss, so lowering resolution is never the default answer
  to a slow scene.

## Dated findings

Newest first. Each names the snapshot it came from.

### 2026-10-14 — first snapshot, `2026-10-14-5a44e63a.json`

M1 Pro, Retina canvas 3024×1890. The user's Chrome was running and the load
average was high, so GPU-side numbers read pessimistic; take one with Chrome
closed before judging GPU work against it. Portal has no GPU bench numbers
(the bench page missed scenes that aren't exported by name; fixed after this
run).

1. **The open panel is the biggest cost, on every scene.** Main thread goes
   from about 5% to about 50% busy (almost all script), whatever the scene.
   Released scenes drop to Caustics 30 fps, Physarum 2 28 fps, Sky 41 fps;
   even trivial scenes get frame gaps of 33 ms at p95.
2. **Every visit downloads about 5.3 MB, 4.5 MB of it media** — the gallery,
   a scene and the TV page alike (the pinned Alien / Dancers files). JS is
   640 kB gzip, one 434 kB shared chunk with every scene in it.
3. **Physarum 2 doesn't hold 60 with the panel closed**: 53 fps, about 600
   hitches a minute, 16% main thread (the census readback). Caustics holds
   60 but hitches about 150 a minute; Sky and Chladni are clean.
4. **Heavy draft scenes can't reach 60 at Retina**: Ferrofluid, Silk,
   Dancers, Crystal (isolated GPU 34–80 ms a frame), then Gates, Ink.
5. Scene switches are mostly short (under 100 ms); Storm (about 390 ms) and
   Physarum 2 (about 220 ms) are the long ones. The heap after GC grew
   6.3 → 10.7 MB over the whole tour — worth a second look, not yet a leak.
