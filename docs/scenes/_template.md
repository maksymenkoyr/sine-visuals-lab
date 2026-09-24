# <Scene name> (`<id>`)

<One or two sentences: what the scene looks like and what the music does to
it. Draft or featured, and whether it's on main.>

## Where the code is

<The files and the symbols worth knowing: the scene module, its GLSL, helpers,
its tests. Name symbols; don't restate values the code owns (CLAUDE.md
rule 2). Note any shared system it plugs into: drives, beatListener,
noiseHash, bloom, and so on.>

## References

<Each reference: a link (with timestamps if relevant), what it is, and what
was taken from it — technique studied, look, timing. Word it as inspiration
or study, not "a copy of". Name the `/ref` bundle it was measured in
(`tools/.cache/refs/<bundle>/`). The downloaded media (frames, clips, audio,
comparison images) never goes into this repo: it stays in the local cache,
or in the private archive if `tools/ref-archive.py` is in use.
Write "None — original design" if there was no reference.>

## Measurements

<Dated observations from /ref reports, frame statistics, tuning probes: what
was measured, the reference's value, ours, and the date. These are dated
records, so specific numbers are fine here. Omit the section if nothing was
measured.>

## Decisions and pivots

<A dated log, newest last: what was built, what was tried and rejected and
why, what feedback changed direction. Each entry is one or two lines plus the
PR or commit.>

## Tuning notes

<The settings that matter, values that looked good, how to judge the look,
real-music vs synthetic findings, quality-tier behaviour.>

## Known issues and next steps

<What's still off, open follow-ups, ideas agreed but not done.>

## Materials

<Everything this scene was built with, and where each piece is kept:
- measurements kept from each `/ref` bundle (report, data, our own shots):
  `<id>/<bundle>/`, saved with `tools/ref-keep.py`;
- working scripts: `<id>/scripts/` if scene-specific, `tools/` if general —
  never only in a session's scratch folder;
- artifacts: the title and link, with their source in `<id>/artifacts/`
  (reference images replaced by a placeholder);
- the reference media itself (videos, frames, audio, pasted stills): never in
  this repo — the local `/ref` cache and the private archive
  (`tools/ref-archive.py`).>

## Resume here

<How to pick it back up fast:
- the dev link: `npm run dev`, then `/?audio=synthetic&bpm=120#/v/<id>`;
- the headless screenshot or probe scripts used, and the /ref commands and
  bundle names;
- the gotchas that cost time.>

## History

<PRs and key commits, oldest first: `#NN` / short hash, and one line each.>
