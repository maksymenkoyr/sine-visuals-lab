---
description: Run the live-tuning loop against a scene
argument-hint: <sceneId> [bpm]
---

Run the tuning loop from `docs/tuning.md` against scene `$1` (default bpm `$2`
or 120 if not given). Read `docs/tuning.md` first if you haven't this session.

1. Open `https://localhost:5173/?audio=synthetic&bpm=$2&tune=A#/v/$1` (dev
   server must already be running — `npm run dev`). Start
   `node tools/tune-watch.mjs` in the background and subscribe to its stdout,
   so marks and scrubbed values arrive without polling.
2. Prefer **pointing over guessing**: write a `focus` list into
   `tuning/params.json` naming the settings under discussion and the phrase
   behind each, and let the user scrub them — the menu will ring and scroll to
   those rows, and each landed value comes back as a `TUNED` line. Only write
   `settings` values directly when you need to pin something for comparison.
   If the number in question is a constant rather than a `SceneSetting`,
   promote it to a `draft: true` setting first (see `docs/tuning.md`).
3. Confirm a change lands via the numeric probe (`tools/tune-probe.mjs` or
   `window.__viz.probe()`) — answer with numbers, not pixels, per
   `src/tuning/probe.ts`'s own principle.
4. Use `tools/tune-sheet.mjs` for a contact sheet across a stretch of audio, or
   `tools/tune-ab.mjs` to compare two param sets directly, if a single probe
   read isn't enough to judge the change.
5. Mark (`Alt+M` in-browser, or the mark endpoint) anything worth keeping as a
   before/after reference.

At the end, append any phrase → param mapping this session settled on to
`tuning/VOCAB.md`, and note it in `docs/status.md` if the work is unfinished.
