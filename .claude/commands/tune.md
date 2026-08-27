---
description: Run the live-tuning loop against a scene
argument-hint: <sceneId> [bpm]
---

Run the tuning loop from `docs/tuning.md` against scene `$1` (default bpm `$2`
or 120 if not given). Read `docs/tuning.md` first if you haven't this session.

1. Open `https://localhost:5173/#/v/$1?audio=synthetic&bpm=$2` (dev server must
   already be running — `npm run dev`).
2. Edit `tuning/params.json` for the change under discussion; confirm it lands
   via the numeric probe (`tools/tune-probe.mjs` or `window.__viz.probe()`) —
   answer with numbers, not pixels, per `src/tuning/probe.ts`'s own principle.
3. Use `tools/tune-sheet.mjs` for a contact sheet across a stretch of audio, or
   `tools/tune-ab.mjs` to compare two param sets directly, if a single probe
   read isn't enough to judge the change.
4. Mark (`Alt+M` in-browser, or the mark endpoint) anything worth keeping as a
   before/after reference.

At the end, append any phrase → param mapping this session settled on to
`tuning/VOCAB.md`, and note it in `docs/status.md` if the work is unfinished.
