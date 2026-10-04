---
description: Make the promo video for the last Stable release — its changelog played through the agreed scenario, cut to the user's song
---

Make the promo video for the last Stable release. Two inputs make it: the release's **changelog** (what
the video says) and the **Scenario** below (how it says it — the user's calls on the v0.2.0 video, every
one asked for, with the alternatives they turned down). The machinery is `tools/promo/`; read the header
of `tools/promo/promo.mjs` first. The code's defaults already play the Scenario: **don't redesign it** —
change only what the user asks for, and record each new call in the Scenario with what it replaced.

## Inputs — it should just work

- **Version**: none needed — `promo.mjs` takes what Stable serves now. The recorder films the deployed
  site, so the release must be live (`npm run release` merged and deployed).
- **Song**: `--song <file or link>`; without it the last release's song is reused (`promo.mjs` keeps it
  as `<work>/song.wav`). Ask only if the user may want a new one; say once that posting needs the rights.
- **Opening look**: `--look "<Looks-card share link>"` (`?look=<code>#/v/<scene>`; an Insiders link works
  on Stable); without it the last release's look is reused. With none at all the opening is a plain
  Physarum 2 stand-in — say so, don't hide it.
- Output: `~/Movies/sine-visuals-lab-v<version>-promo/` (`encode` overwrites the file there).

## From the changelog to `lines.json`

1. `node tools/promo/promo.mjs notes` writes the release page (the changelog) to the work folder
   (`tools/.cache/promo/v<version>/`).
2. The changelog is PR titles; the good changes are often buried in PR bodies. Read every PR body in the
   release (a Sonnet subagent) before drafting — the user caught missing lines twice ("I'm pretty sure
   something was missed"). Check each claim against the release's final state: a later PR may undo or
   reshape an earlier one (Cue became pop-out-only; Tail became per-lane).
3. Write `<work>/lines.json`, shaped like `tools/promo/lines.v0.2.0.json` (its `demos` are the v0.2.0
   scenario's slots; keep their order and takes, and swap a caption or a panel take only for a change
   this release shows better):
   - `groups`: **every** change, plain words not PR titles, one change per line, short enough to fit
     (`cards.mjs` warns). Group order: Scenes, Controls, Output and rooms, Sound and beat, Release.
   - `demos`: clips that show a visible change happening, each with a one-line caption. The first stays
     the Physarum 2 re-roll (`song_p2r`) — the song's drop lands on it. A new kind of change may need a
     new panel take in `record.mjs` (copy a `ui_*` one).
4. Leave out anything about draft scenes (`DRAFT_SCENE_IDS` in the release's
   `src/render/scenes/index.ts`), paid scenes (never), and internal work (docs, tooling, tests).
5. Show the user the lines as a plain list in its own message — not next to a question tool, which hides
   it ("I didn't see any list") — and **let them add and cut before rendering**.

## Scenario

In order, as the video plays (vertical 9:16 for phone Stories, about 30 s plus the end hold, every cut on
a beat, calm cuts):

1. **Opening look** — the user's look, a second, untouched, reacting to the song.
2. **Version card** — held a couple of seconds over the look. GitHub-release flavoured: a green tag icon,
   the version ("0.2.0 - beta"), the app name under it. *Rejected*: the green "Latest" badge.
3. **Demos** — the song's first drop lands on the first one (a Physarum 2 re-roll). One caption at a
   time along the bottom; the next slides in as the old one leaves (plain translucent panel, white
   hairline, group name and n / N). *Rejected*: a row of carousel cards.
   - Interface demos: the camera leans toward the part that changes.
   - Scene footage: a steady camera; scenes react to the song itself, never the synthetic feed (the first
     cut's Chladni and half its Physarum looked "flat, low sync to the music"). Physarum 2 starts from the
     user's look and re-rolls every two bars from the drop (every two beats never let a dish grow).
   - **Pop-out, Cue/Play and Room** are drawn as devices: a laptop (its panel's left column hidden so
     its own picture shows) with its Space (Cue) and Option (Play) keys on the deck, lit while pressed,
     over the second screen ("Pop-out window" or "TV"), whose frame glows orange while Cue shows the
     laptop's look there and flashes green on Play. Cue/Play: a palette on the laptop leaves the pop-out
     alone; holding Space previews it there until release (Cue is a peek, not a hold —
     `src/ui/outputKeys.ts`); a tap of Option sends it for good. Room: add the TV by its code, then a
     palette and a tap of Option, twice — the TV follows each time. *Rejected*: screen captures without
     device frames or keys (a phone-layout controller with a small inset; a bare laptop-over-TV split).
4. **Change lists** — every group, over steady scene footage: the list card (header bar with the group
   name and a count, rows divided by rules) held low in the frame, showing `VISIBLE` rows (`cards.mjs`),
   its rows scrolling through like a carousel — a new row comes in at the bottom as the top one leaves.
   Lists stay complete; when the video runs long, ask what to cut rather than trimming lines.
   *Rejected*: a big list card in the middle of the screen; a wheel/picker with shrinking rows ("too far a
   jump from what we had").
5. **End** — the last list is cut away on a beat and the scene holds a couple of seconds; the video stops
   on a bar line. Nothing fades out, picture or music. *Rejected*: a fade to black, a music fade-out.

Style throughout: half as GitHub-ish as a release page ("50 % less GitHub-ish") — no merge icons or
coloured pills on rows and captions, white accents (the app's own accent is white); only the version card
keeps GitHub's tag.

## Run, and look at every step

`node tools/promo/promo.mjs all [--song …] [--look …]`, or step by step: `song` → `record` → `cards` →
`compose` → `encode`. `record <take>…` re-records only those takes.

- `song`: the bpm should match what they count (a half or double reading: pass `--bpm`). `dropTime` must exist.
- `record`: every take must say `OK`. A `SLOW` that survives its retries means the machine was busy — the
  two-screen takes (two pages at once) go first when another job encodes on this Mac; wait for it rather
  than keep a choppy take. The panel takes find controls by their visible text and `.vc-*` classes; when
  the UI is reworked a take can silently do nothing — tile a few frames of each take (Pillow; Homebrew
  ffmpeg may be broken) and check that something moves. Check scene takes with
  `tools/promo/motion.py <take> --from <drop beat + 3>` — motion and sync to the song's hits (on the
  synthetic feed Chladni held one figure, motion 1.7; on the song 3.9, sync 0.56; plain Physarum 2 barely
  pulses, 1.08 vs the look's 1.48). For the two-screen takes, look at the second screen's frames: it
  must change only on Cue (until release) and Play.
- `cards`: no `WARN` lines.
- `compose`: tile ~16 frames across the video and look at them before encoding. Cuts on beats; each
  caption names what its clip shows; text inside the middle of the screen (Stories covers the top ~13 % and
  bottom ~19 %).
- `encode`: confirm the duration, that the drop is on the first demo (rms of the exported audio jumps
  there), and that the music runs at full level to the last frame. The full file is over the 30 MB send
  limit — send a 720p preview copy for review.

## Deliver

Give the path, the length, what was reused (song, look) or is a stand-in, and the song rights note. Do
not post anywhere. Record any new call in the Scenario, with what it replaced.

Automation note: this needs a real GPU (Metal), so it runs on the user's Mac after the release is live —
not in CI, where software rendering stutters.
