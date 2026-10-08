# Entropic Collapse (`swarm`)

A few hundred particles, each with a position and a phase, drawn as a graph of
thin additive lines between near neighbours on pure black. They fall from a
scattered net into one body: a white core of in-step particles that breathes
with the tempo, inside a thin, fixed ring of out-of-step "drifters". Colour
follows crowding: the packed core is white, the rim magenta to rose, its
loosest tips orange-red and lime. A hit knocks a few particles out of step
(they fly out to the rim and fall back in as they re-sync), loudness adds
phase jitter, and a drop throws the whole swarm back out so it collapses
again. On every bass hit the whole swarm thumps (swells on screen) and its
lines flash. In development, on main.

## Where the code is

- `src/render/scenes/swarm/swarmSim.ts` is the whole simulation, pure (no GL,
  no DOM): `createSwarm`, `stepSwarm`, `scatterPhases` (a hit), `rescatter` (a
  drop), `collapseTrap` (the collapse ramp), `collectEdges` (what the draw
  reads: edges plus each particle's crowd colour coordinate) and
  `swarmMetrics`. Its header says the model; `DEFAULT_SWARM_PARAMS` holds the
  tuned constants, `SCATTER_MAX_SHARE`, `DENSE_NEIGHBOURS` and
  `CROWD_DIMMING` the hit and colour rules.
- `src/render/scenes/swarm/index.ts` is the scene: `SETTINGS`, the drive reads
  (`drives.value` for Breath, Heat, Thump and Beat flash, `drives.fired`
  for Scatter and Re-collapse), the Scene breath wave, the drawn hit
  reactions (`THUMP_SCALE`, `FLASH_GAIN`), the fixed-step loop, framing
  (`FRAME_SCALE`), `TIER_PARTICLES`.
- `src/render/scenes/swarm/glsl.ts` is the two programs (instanced edge quads,
  instanced node sprites) and the crowd ramp (`RAMP_GLSL`).
- `tests/swarmSim.test.ts` pins the look's invariants (a locked share, the rim
  radius, the core contracting on the beat) and the determinism, momentum and
  hit behaviour.
- Plugs into: drives (`src/render/drives.ts`), the metronome
  (`AnimFrame.metronomeBeats`/`metronomeLevel`) for the Scene breath, the
  quality preset for the default particle count (`src/render/quality.ts`). No
  float target, no bloom: the tone curve lives in the blend (glsl.ts header).

## References

- "Entropic collapse", r/creativecoding, posted 2025-08 —
  <https://www.reddit.com/r/creativecoding/comments/1mzbbgy/entropic_collapse/>
  (video `v.redd.it/dv8ddycbt1lf1`, 870×720, 30 fps, 86 s, **no audio track**).
  Studied as inspiration: the look (a proximity graph of a few hundred
  particles, white core, coloured rim, black ground) and the motion (a
  scattered net collapsing, then a core breathing inside a rim that holds
  still). The post's text describes the idea — each particle has a phase that
  shapes how it attracts and repels, and nearby phases pull into sync. It
  also links the author's source code; **that code was never opened**: this
  scene is independent work, its physics designed from scratch in our own
  prototype (below), swarmalator-flavoured in the sense of the published
  model by O'Keeffe, Ha & Strogatz (2017).
- Measured in the `/ref` bundle `tools/.cache/refs/entropic-collapse/`
  (whole clip, 0–86.4 s). The author's on-screen sliders are legible in the
  frames: Min Distance 150 and Max Distance 400 never move; "Temperature Drag"
  is moved through the clip.

## Measurements

2026-10-03, reference (bundle `entropic-collapse`, plus the bundle's
`scripts/measure_breath.py` per frame at 30 fps) beside ours (headless Metal
shots at 1280×720, `?audio=synthetic&bpm=128`, measured with the same metric
by `scripts/measure_pngs.py`; r in half-heights from the lit centroid):

| What | Reference | Ours |
|---|---|---|
| Audio | none (no audio stream) | — |
| Hard cuts | none in 86 s | none |
| Breath period | 0.77 s (15–30 s), 0.70 s (30–45 s), 0.88–1.0 s (50–70 s), 0.80 s (70–75 s) | 2 beats = 0.94 s at 128 bpm |
| Pulse stops | 35–40 s and 75 s on, when Drag is raised to ≈0.7–0.95 | when the metronome fades (quiet) and hits stop |
| White core r90 | 0.21 contracted → 0.30–0.35 expanded | 0.21 → 0.32 |
| Coloured rim r50 | 0.46, steady from ~10 s | 0.41 in the sim, × `FRAME_SCALE` → 0.46 |
| Opening collapse | scattered net → blob over ~12–15 s (core r90 0.56 → 0.21) | clumps 0–4 s, one body by 8 s, rim + core by 12 s |
| Particles | ≈256 nodes counted at 8 s (spread state) | 256 default (mid tier) |
| Hues (lit area) | rose/magenta 300–330° 83–94 %, ground #000 | white core, magenta → rose → ember rim |
| Stroke / glow | 1.9–3.7 px, glow e-fold 1.3–6 px | 1.6 px at 720 px tall, 1 px feather |

The reference's breath period follows its Drag slider: ≈0.5 → 0.77 s;
≈0.21–0.35 → 0.88–1.0 s; ≥0.71 → no pulse.

2026-10-03, reaction on real music (the user: "it doesn't react to music
much"). Track: the cached `/ref` bundle `alt-kaleido`'s audio.wav (a 129 bpm
DJ-set clip) as the fake mic, 10–26 s, shots back to back at ~27–35/s,
scored by `swarm/scripts/react_score.py` against that bundle's librosa
onsets (106 in the window, ≈6.6/s):

| | Before | After |
|---|---|---|
| Picture | uniform grey disc, no core | core + gap + rim |
| Brightness p10→p90 swing | 2 % | 75 % |
| Change per 100 ms, 200 ms after an onset vs elsewhere | 1.04× | 1.98× |
| Per kick (trace) | — | +40 % brightness, +6.5 % radius, decaying over the beat |

## Decisions and pivots

- **Sync hypotheses (2026-10-03), from a silent reference:** nothing in it is
  audio-driven, so each was chosen for our runtime:
  1. The breath is a timer in the reference (an underdamped oscillation the
     Drag slider kills) → ours rides the metronome. Held: the metronome locks
     in ~2 s on the synthetic feed.
  2. The pauses are a state (high drag) → ours settles when the beat wave
     fades and hits stop. Held: with no hits the core packs tight and still.
  3. The opening collapse is a one-shot → ours on scene start, and on a drop
     via Re-collapse. Not yet seen on a real track (the synthetic feed rarely
     drops).
  4. No cuts → everything moves by envelopes and travel.
- **Physics, prototyped in numpy before any code** (bundle
  `scripts/proto.py`, ~25 runs; contact sheets kept locally):
  - Rest-length springs set by phase difference (in step → Min Distance,
    anti → Max) collapsed the net but gave no rim.
  - Second-harmonic coupling (two stable phase clusters) split the swarm
    into two blobs that drifted apart.
  - A constant-magnitude pull to the centroid crushed everything to a dot.
  - **What works:** a harmonic trap plus all-pairs 1/r repulsion sets the
    rim's radius by Gauss's law (√(repulsion/trap)), whatever the core does;
    a short-range attraction between *locked* particles packs the core, and
    the packed core's extra charge expels the drifters into a thin annulus —
    the gap and the rim come out of the physics. A heavy-tailed (Cauchy)
    spread of natural rates keeps a lasting drifter population.
- Ported to TypeScript by a Sonnet agent from a written plan; pair forces made
  equal and opposite (i < j). The trap ramps in (`collapseTrap`) — the
  prototype's instant trap collapsed in 2 s.
- No float render target in this repo (RGBA8 only, `chladni.ts` header):
  lines draw straight to the screen with a screen blend on
  `1 - exp(-TONE * c)`, which accumulates like a soft tone curve.
- **Tuning against the reference (2026-10-03), each pivot from a side-by-side
  with the reference's own frames:**
  - The first port's core was a tiny star (≈0.08): the core radius goes as
    repulsion / (0.6 · attraction), so the prototype's attraction was ~5×
    too strong for the reference's 0.21. Attraction lowered, line reach
    shortened (long rim→core spokes), edges brighter.
  - Hits: kicking *every* phase a little dissolved the core at one hit per
    beat (a uniform disc — the Sonnet build had lowered Scatter to 0.12 to
    hide it). Now a hit flings a small share (`SCATTER_MAX_SHARE`) half to a
    whole turn out; they fly to the rim and fall back in. A share too large
    did the same as before: per-hit share × hit rate × re-sync time must stay
    well under 1.
  - Sync was fragile: the phase coupling sat barely above the Cauchy spread's
    critical value, so 4 % flung per beat halved the locked share. Coupling
    raised until the locked share holds near two thirds with hits, and the
    spread widened for a fuller rim.
  - Colour: phase offset gave every hue an equal share (the reference is
    mostly rose/magenta), and the reference's own colours follow crowding —
    white core, magenta-rose rim, orange-red outer tips, a magenta-centred,
    green-edged sheet while it is spread out. Now crowd-based, from neighbour
    counts normalised to a reference count and reach. Crowded ends dim their
    edges (`CROWD_DIMMING`) so the core shows its lines instead of flat white.
  - Breath: one swing a beat (0.47 s at 128 bpm) was too fast for the swarm's
    inertia — measured, the core did not move. Breath's default is now a Scene
    source, the Beat wave slowed to one swing every two beats
    (`DriveSource.every` can't be set from a setting's default).
  - The lock was measured against the swarm's mean phase, so with random
    starting phases nothing attracted until the whole swarm synced, and the
    net shrank as one box under the trap. It is now measured against each
    particle's own neighbourhood mean phase (inside the attraction's reach),
    so in-step clumps form first and merge, and the trap eases in (cubic).
    (Local *agreement* — mean cos of phase differences — was tried first and
    never crossed the lock threshold: it behaves like local order squared.)

- **2026-10-03, "it doesn't react to music much":** measured, it didn't —
  on a real DJ track the picture's change after an onset was the same as
  anywhere else, and the core never formed: onsets fire several times a
  beat there (vs about once on the synthetic feed), and Scatter on every
  onset kept the swarm a uniform grey disc, which also hid the breath.
  - Scatter now defaults to bass hits.
  - The physics can't answer a single hit: a velocity kick on the core
    (`punchCore`, tried and removed) inflated the swarm for good at every
    strength that showed; releasing the core's attraction on the hit widened
    it on average but barely moved it inside a beat
    (`swarm/scripts/bench_punch.ts`).
  - So the per-hit snap is drawn: **Thump** (the swarm swells on screen,
    `THUMP_SCALE`) and **Beat flash** (lines and dots lift, `FLASH_GAIN`),
    both on bass hits. Beat flash on Any hit was tried first: at several
    onsets a beat it blurred into flicker.
- 2026-10-08 — Scatter and Re-collapse became hit drivers (the Reaction row,
  Flat or Sized; drives.ts's header, "Hit drivers"). Sized scales the share
  `scatterPhases` knocks out of step by how far the hit stood out; Flat, the
  default, is unchanged. Re-collapse is flat-only: a re-collapse either
  starts or it doesn't.

## Tuning notes

- The settings that shape the picture: Sync (phase coupling — how much of the
  swarm locks), Drifters (spread of natural rates — the rim's fullness),
  Breath, Scatter, Heat, Damping.
- Scatter and Sync trade off: more Scatter wants more Sync, or the core
  dissolves into a uniform disc — and the hit rate matters as much: wire
  Scatter to Any hit on busy music and the core never forms.
- Thump and Beat flash are the settings that make it read as "reacting";
  the physics settings (Breath, Scatter, Heat) move it more slowly.
- Judge reactions on real music, not the synthetic feed (it fires about one
  hit a beat, far fewer than a real track).
- Particles follows the quality preset until moved (`TIER_PARTICLES`); the
  sim cost grows with the square of the count (about 1.2 ms a step at the mid
  tier's count, measured 2026-10-03 in node).
- Judge the collapse from a fresh load. Judge Breath and Scatter on a steady
  beat after 12 s, on Metal (SwiftShader runs too slow for the sim's
  steps-per-frame cap and shows a slow-motion collapse).

## Known issues and next steps

- The contracted core sits in a grey haze of rim→core edges; the reference's
  contracted frames show a cleaner dark gap.
- The opening still goes from a loose net to one body faster between 4 and
  8 s than the reference, and that body reads white where the reference's
  spread sheet is magenta in the middle.
- The edge buffer holds a capped number of edges per particle; a very dense
  core at high Reach drops the rest silently.
- Re-collapse on a drop has not been seen on a real track yet; the hit
  reactions were measured on one track only.

## Materials

- `swarm/entropic-collapse/` — our half of the `/ref` bundle, kept with
  `tools/ref-keep.py`: report, data (`audio.json`, `look.json`,
  `series.tsv`) and the scripts:
  - `scripts/measure_breath.py` (per-frame core/rim radius and breath period
    of the reference), `count_nodes.py` (particle count), `slider_crops.py`
    (the author's on-screen slider values over time), `breath.json` (the
    per-frame output);
  - `scripts/proto.py` — the numpy physics prototype (`MODE=3` is the model
    that shipped);
  - `scripts/bench.ts` — runs the scene's own sim headless (`node
    bench.ts scatter=0.4 attract=600 …`) and prints locked share, radii and
    the core/rim neighbour counts;
  - `scripts/shot.mjs` (headless shots of the live scene), `probe.mjs`
    (metronome lock on the synthetic feed), `measure_pngs.py` (the
    reference's radius metric on our shots), `tile.py` (side-by-side strips).
- `swarm/scripts/` — the real-music reaction check: `react_shots.mjs`
  (plays a `/ref` bundle's audio.wav into the scene as the mic and shoots
  back to back), `react_score.py` (reaction ratio and brightness swing
  against the bundle's onsets), `react_trace.py` (per-shot brightness and
  radius with the onsets marked), `bench_punch.ts` (can the physics answer
  one hit).
- The reference video, frames and comparison strips: the local `/ref` cache
  (`tools/.cache/refs/entropic-collapse/`, video under `_downloads/`) and the
  private archive (`tools/ref-archive.py`).

## Resume here

- `npm run dev`, then `https://localhost:<port>/#/v/swarm` (headless checks:
  `/?audio=synthetic&bpm=128#/v/swarm`).
- Fetching the reference again: reddit blocks scripts, but the post's
  `.rss` (browser UA) names the `v.redd.it` id; the video is
  `v.redd.it/dv8ddycbt1lf1/DASH_720.mp4` (no audio representation exists).
- Physics questions: try it in `bench.ts` (seconds) or `proto.py` (contact
  sheets) before touching the scene; judge the look only on a side-by-side
  with the reference's frames (`look_1.jpg` contracted, `look_2.jpg` expanded
  in the bundle's `frames/`).

## History

- Draft added on branch `worktree-swarm-scene` (sim, scene, tests), then tuned
  against the reference the same day.
