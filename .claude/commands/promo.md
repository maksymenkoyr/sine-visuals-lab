---
description: Make the release promo video — a vertical montage of what changed, cut to the user's song
---

Make the promo video for a Stable release. The machinery is `tools/promo/` — read the header of
`tools/promo/promo.mjs` first; this file is the playbook around it: what to ask, what to write by hand,
what to check at each step, and the video the user agreed on. The defaults in the code already make that
video; **don't redesign it** — every point under "The agreed video" was asked for, and the rejected
alternatives next to them were tried and turned down.

## Inputs (ask only for what is missing)

- **Version**: default is what Stable serves now (`curl -s https://www.sinevisualslab.com/version.json`).
  The recorder films the deployed site, so the release must already be live.
- **Song**: the user's own track (a file, or a link for `uvx yt-dlp -f ba -x --audio-format wav`; note
  that yt-dlp's `--print` downloads nothing, and without a system ffmpeg yt-dlp leaves a .webm — convert
  it with the imageio-ffmpeg binary). Say once that posting it needs the rights.
- **Opening look**: a share link from the Looks card ("Save current as…", then share), which is
  `?look=<code>#/v/<scene>`; an Insiders link works on Stable. Ask for it — the user's own look opens the
  video and, when it is a Physarum 2 one, is what the Physarum footage starts from. Without one the opening
  is a stand-in — say so, don't hide it.
- Output folder (default `~/Movies/sine-visuals-lab-v<version>-promo`; `encode` overwrites the file there).

## Write `lines.json` by hand

1. `node tools/promo/promo.mjs notes --version <v>` writes the Stable release page to the work folder.
2. The release notes are PR titles; the good changes are often buried in PR bodies. Read every PR body in
   the release (a Sonnet subagent) before drafting — the user caught missing lines twice ("I'm pretty sure
   something was missed"). Check claims against the final state: a later PR in the same release may undo
   or reshape an earlier one (Cue became pop-out-only; Tail became per-lane).
3. Write `tools/.cache/promo/v<v>/lines.json`, shaped like `tools/promo/lines.v0.2.0.json`:
   - `groups`: **every** change, plain words not PR titles, one change per line, short enough to fit
     (`cards.mjs` warns). Group order: Scenes, Controls, Output and rooms, Sound and beat, Release.
   - `demos`: the clips that show a visible change happening, each with a one-line caption. Start from
     v0.2.0's set and swap in this release's visible changes; the first demo must be the Physarum 2
     re-roll take (`song_p2r`) — the song's drop lands on it. A new kind of change may need a new panel
     take in `record.mjs` (copy a `ui_*` one).
4. Leave out anything about draft scenes (`DRAFT_SCENE_IDS` in the release's `src/render/scenes/index.ts`),
   paid scenes (never), and internal work (docs, tooling, tests).
5. Show the user the lines as a plain list in its own message — not next to a question tool, which hides
   it ("I didn't see any list") — in plain words, and **let them add and cut before rendering**.

## The agreed video (v0.2.0, 2026-10 — each point is the user's call)

- **Shape**: the opening look → the version card held a couple of seconds → the demo clips → the full
  change lists → a short fade. Vertical 9:16 for phone Stories, about 30 s (not over). Calm cuts, every
  cut on a beat. The song's first drop lands on the first demo.
- **Version card**: GitHub-release flavoured — a green tag icon, the version ("0.2.0 - beta"), the app
  name under it. *Rejected*: the green "Latest" badge.
- **Demo captions**: one caption at a time along the bottom; the next slides in as the old one leaves.
  Plain translucent panel with a white hairline, group name and n / N. *Rejected*: a row of carousel
  cards.
- **Change lists**: the list card (header bar with the group name and a count, rows divided by rules)
  held low in the frame, showing `VISIBLE` rows (`cards.mjs`), its rows scrolling through like a
  carousel — a new row comes in at the bottom as the top one leaves. *Rejected*: a big list card in the
  middle of the screen; a wheel/picker with shrinking rows ("too far a jump from what we had").
- **Less GitHub everywhere except the version card**: no merge icons or coloured pills on rows and
  captions; white accents (the app's own accent is white). The user's words: "50 % less GitHub-ish".
- **Scene footage**: a steady camera (no zoom, roll or punch) behind the lists; scenes react to the
  song itself, never the synthetic feed — the first cut's Chladni and half its Physarum looked "flat,
  low sync to the music". Physarum 2 starts from the user's look and re-rolls every two bars from the
  drop (every two beats never let a dish grow).
- **Interface demos**: the camera leans toward the part that changes.
- **Room**: shown working, not just paired — a laptop over the TV, labelled, both on the song: add the
  TV by its code, then change the palette on the laptop (the TV keeps its look) and press Play, and the
  TV follows; twice. *Rejected*: a phone-layout controller with a small TV inset.
- **Lists stay complete**; when the video runs long, ask what to cut rather than trimming lines.

## Run, and look at every step

`song` → `record` → `cards` → `compose` → `encode` (or `all`), each as `node tools/promo/promo.mjs <step> --version <v> …`
(add `--look "<link>"` to `record`). `record <take>…` re-records only those takes.

- `song`: the bpm should match what they count (a half or double reading: pass `--bpm`). `dropTime` must exist.
- `record`: every take must say `OK`. A `SLOW` that survives its retries means the machine was busy: close
  other work and re-run that take. The panel takes find controls by their visible text and `.vc-*`
  classes; when the UI is reworked a take can silently do nothing — tile a few frames of each take (Pillow;
  Homebrew ffmpeg may be broken) and check that something moves. Scene takes and the room hear the song
  (a fake mic); check scene takes with `tools/promo/motion.py <take> --from <drop beat + 3>` — motion and
  sync to the song's hits. On the synthetic feed Chladni held one figure (motion 1.7); on the song it keeps
  changing (3.9, sync 0.56). Plain Physarum 2 barely pulses on the song (pulse 1.08 vs the look's 1.48).
  For the room, look at the TV frames after each Play: the TV must change only then.
- `cards`: no `WARN` lines.
- `compose`: tile ~16 frames across the video and look at them before encoding. Cuts on beats; each
  caption names what its clip shows; text inside the middle of the screen (Stories covers the top ~13 % and
  bottom ~19 %).
- `encode`: confirm the duration, and that the drop is on the first demo (rms of the exported audio jumps
  there). The full file is over the 30 MB send limit — send a 720p preview copy for review.

## Deliver

Give the path, the length, what is still a stand-in (the opening, if no look was given), and the song
rights note. Do not post anywhere. Save new preference calls here, under "The agreed video", with what
they replaced.

Automation note: this needs a real GPU (Metal), so it runs on the user's Mac after
`npm run release` is merged and live — not in CI, where software rendering stutters.
