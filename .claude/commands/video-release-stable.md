---
description: Make the release video — what the last Stable release changed, played through the agreed Shape and cut to the user's song
---

**The idea:** a vertical video, for people who already follow the app, that shows what the last Stable
release changed: its changelog played through the Shape below and cut to the user's song.

Read `docs/video-house-style.md` and the header of `tools/promo/promo.mjs` first. The engine's defaults
already play the Shape: don't redesign it. Change only what the user asks for, and record each new
call in the Shape, dated, with what it replaced.

All commands are `node tools/promo/promo.mjs <step> --video release`.

## Inputs

- **Version**: none needed; the engine takes what Stable serves now.
- **Song**: `--song <file or link>`; without it the last release's song is reused.
- **Opening look**: `--look "<Looks-card share link>"`; without it the last release's look is reused.
  With none at all the opening is a plain Physarum 2 stand-in: say so.

## 1. The changes

`notes` writes the release page to the work folder. Its written notes (above the folded list) were
made for this video by `/release` (its Shape): start `<work>/lines.json` from them, shaped like
`tools/promo/shapes/release.example.json`. Only a release without written notes needs every PR body
read (a Sonnet subagent), each change checked against the release's final state.

- `groups`: every change, in plain words, one per line, short enough to fit (`cards` warns): each
  highlight's heading and each bold row of "Also in this release", under the area its emoji or heading
  names. Group order: Scenes, Controls, Output and rooms, Sound and beat, Release.
- `demos`: clips that show a visible change happening, one caption each; the highlights are the
  first candidates, their headings the captions. The first stays the Physarum
  2 re-roll (`song_p2r`): the song's drop lands on it. The available takes are in
  `tools/promo/takes.json`; a new kind of change may need a new panel take (copy a `ui_*` entry there
  and its script in `tools/promo/shots/take-ui.mjs`).

Show the lines as a plain list and let the user add and cut.

## 2. The plan

`song` (when the work folder has none yet), then `plan` prints the time table from the lines. Show
it; the user approves or changes it.

## 3. Build and check

`all`, or step by step `song` → `record` → `cards` → `render` → `check`. `record <take>…` re-records
only those takes.

- `song`: the bpm must match what the user counts (a half or double reading: `--bpm`), and `dropTime`
  must be the real drop.
- `record`: every take prints `OK`. The two-screen takes are timed to their slot in the plan, so
  re-record them after a reorder; their second screen must change only on Cue (while Space is held)
  and Play.
- `cards`: no `WARN` lines.
- `render`, then `check`: look at about 16 frames across the video (`check.py strip`, its header has
  the call); cuts on beats, each caption names what its clip shows,
  the drop on the first demo, lists complete. When the video runs long, ask what to cut rather than
  trimming lines.

Then `deliver`.

## Shape

Vertical 9:16 for phone Stories, about 30 s plus the end hold (v0.2.0: 31.9 s), every cut on a beat,
calm cuts. Agreed over six rounds on the v0.2.0 video (2026-10-03/04).

1. **Opening look**: the user's look, a second, untouched, reacting to the song.
2. **Version card**: held a couple of seconds over the look. GitHub-release flavoured: a green tag
   icon, the version, the app name under it. Its approved size is the v0.2.0 one; the hook video's
   slimmer card is the user's call to make here (asked 2026-10-05, not yet answered).
3. **Demos**: the song's drop lands on the first. One caption at a time along the bottom; the next
   slides in as the old one leaves (plain translucent panel, white hairline, group name and n / N).
   - Interface demos: the camera leans toward the part that changes.
   - Scene footage: a steady camera. Physarum 2 starts from the user's look and re-rolls every two
     bars from the drop (every two beats never let a dish grow).
   - Pop-out, Cue/Play and Room as devices (house style). Cue/Play: a palette on the laptop leaves the
     pop-out alone, holding Space previews it there, a tap of Option sends it. Room: add the TV by its
     code, then a palette and a tap of Option, twice; the TV follows each time.
4. **Change lists**: every group over steady scene footage, as a list card held low in the frame
   (a header bar with the group name and a count, rows divided by rules), its rows scrolling through
   like a carousel: a new row comes in at the bottom as the top one leaves. Lists stay complete.
5. **End**: the last list is cut away on a beat and the scene holds a couple of seconds; the video
   stops on a bar line.

Style: half as GitHub-ish as a release page ("50 % less GitHub-ish"): no merge icons or coloured pills
on rows and captions, white accents; only the version card keeps GitHub's tag.

**Rejected:**
- the green "Latest" badge on the version card;
- a row of carousel cards for the demo captions;
- a big list card in the middle of the screen;
- a wheel/picker with shrinking rows ("too far a jump from what we had");
- a fade to black, a music fade-out;
- screen captures without device frames or keys (a phone-layout controller with a small inset; a bare
  laptop-over-TV split).
