# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Physarum 2 is on `main`** (#153, merged 2026-09-27, still a draft scene).
  It shipped with a reusable framework any scene can use: per-item settings
  (`src/render/sceneItems.ts`) and custom Scene-card widgets declared in
  `Scene.panel` (`src/ui/widgets/`). Physarum 2 uses it for its strain boxes
  (live cultures, POP/TERR/VIG, Pipette, Rebalance), per-strain wirable rows,
  solo/group strain editing and Affinity. Record: `docs/scenes/physarum2.md`.
- **Wrap branch `wrap-physarum2`**: this snapshot, the Physarum 2 record's
  Measurements and saved scripts, an `AGENTS.md` read-first row for the
  widget framework, one `tuning/VOCAB.md` line. Needs a PR.
- **Open PRs:** Magnet slider #160 (touches every panel slider — rebase over
  the widget framework and check strain rows + linked ticks still work);
  Sky back as a free scene #170; phone/tablet screen-capture fix #171;
  Scene master #149; mic latency line #103; architecture doc #74; Auto dial
  ranking #73. #70 is a stale status snapshot — close it.

## Open questions

- Affinity: the user found the relationship web "odd and not informative".
  An orbit view (drag strains closer to follow, farther to avoid) plus a
  live one-line summary is proposed — prototype first, or build?
- Physarum 2 "Dose" is easy to misread; its label/description should say
  "share of agents moved into a new colony per trigger (and per Pipette tap)".
- Physarum steps can be ≈ 3.5× cheaper with a periodic spatial re-sort of
  agent storage (measured, look unchanged, prototype in
  `docs/scenes/physarum2/scripts/perf/`). Build it for `physarum2` and
  `physarum`?
- Neither Physarum scene has been judged on real music through a mic.

## Next up

- Open the PR for `wrap-physarum2`.
- Affinity redesign (per the answer above).
- Rebase #160 over the widget framework; close #70.
- 26 worktrees exist and most belong to squash-merged PRs (`git branch
  --merged` misses those): check each one's PR with `gh pr view` and prune.
