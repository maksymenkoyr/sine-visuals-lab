---
description: Make the release promo video — a vertical montage of what changed, cut to the user's song
---

Make the promo video for a Stable release. The machinery is `tools/promo/` — read the header of
`tools/promo/promo.mjs` first; this file is the playbook around it: what to ask, what to write by hand,
what to check at each step.

## Inputs (ask only for what is missing)

- **Version**: default is what Stable serves now (`curl -s https://www.sinevisualslab.com/version.json`).
  The recorder films the deployed site, so the release must already be live.
- **Song**: the user's own track (a file, or a link for `uvx yt-dlp -f ba -x --audio-format wav`; note
  that yt-dlp's `--print` downloads nothing). Say once that posting it needs the rights.
- **Opening look**: a share link from the Looks card ("Save current as…", then share), which is
  `?look=<code>#/v/<scene>`. Without one the opening is a stand-in — say so, don't hide it.
- Output folder (default `~/Movies/sine-visuals-lab-v<version>-promo`), `--drop-beat` (default places the
  song's first drop on a Physarum 2 re-roll).

## Write `lines.json` by hand

1. `node tools/promo/promo.mjs notes --version <v>` writes the Stable release page to the work folder.
2. Turn it into `tools/.cache/promo/v<v>/lines.json`, shaped like `tools/promo/lines.v0.2.0.json`:
   plain-word lines, not PR titles; one change per line; short enough to fit (`cards.mjs` warns when
   they don't). Put changes the viewer can **see** in `carousel` groups and the rest in `card` groups.
3. Leave out anything about draft scenes (`DRAFT_SCENE_IDS` in `src/render/scenes/index.ts`), paid scenes
   (never), and internal work (docs, tooling, tests).
4. The release notes miss things the user remembers. Show them the lines (a page they can read, or the
   list in chat) and **let them add and cut before rendering**. The text is the video's content.

## Run, and look at every step

`song` → `record` → `cards` → `compose` → `encode` (or `all`), each as `node tools/promo/promo.mjs <step> --version <v> …`.

- `song`: the bpm should match what they count (a half or double reading: pass `--bpm`). `dropTime` must exist.
- `record`: every take must say `OK`. A `SLOW` that survives its retries means the machine was busy: close
  other work and re-run that take (`node tools/promo/record.mjs <take>` with `BPM`/`PROMO_WORK` set). The
  panel takes find controls by their visible text and `.vc-*` classes; when the UI is reworked a take
  can silently do nothing — tile a few frames of each take (Pillow; Homebrew ffmpeg may be broken) and
  check that something moves.
- `cards`: no `WARN` lines.
- `compose`: tile ~16 frames across the video and look at them before encoding. Cuts should land on
  beats; the carousel should be readable; text must sit inside the middle of the screen (Stories covers the
  top ~13 % and bottom ~19 %).
- `encode`: confirm the duration, and that the drop is on the chosen beat (rms of the exported audio
  jumps there).

## Taste, from the first video (v0.2.0, 2026-10)

Calm cuts, not a flurry. No clip of a scene alone without text. Text low in the frame, never covering what
changed; changes you can see go in the carousel. Scene footage may move boldly; the interface should be
zoomed toward the part that changed. Vertical 9:16. Under 30 s unless told otherwise. The user wanted the
list to be complete — "many changes were missed" — so ask for what's missing rather than trimming.

## Deliver

Give the path, the length, what is still a stand-in (the opening, if no look was given), and the song
rights note. Do not post anywhere. Save what you learned about the user's preferences to memory.

Automation note: this needs a real GPU (Metal), so it runs on the user's Mac after
`npm run release` is merged and live — not in CI, where software rendering stutters.
