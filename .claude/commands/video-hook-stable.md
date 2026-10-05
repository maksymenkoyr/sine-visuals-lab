---
description: Make a short vertical video of the best parts of the current Stable version, built around one viral hook and cut to the user's song
---

**The idea:** a short vertical video that shows the best parts of the current Stable version to one
audience, built around one viral hook and cut to the user's song. It is the main ad: its job is to
make a stranger stop scrolling and want the app.

Read `docs/video-house-style.md` and the header of `tools/promo/promo.mjs` first. The engine's
defaults already play the Shape below. Change only what the user asks for, and record each new call
in the Shape, noting what it replaced.

All commands are `node tools/promo/promo.mjs <step> --video hook`.

## Audience

The two audiences are in the house style. A video speaks to one of them first, in their situation and
their words. The other can come along when the hook is about what they share: a party or concert
people remember. What both get: visuals that look like a pro made them, for no money and no effort.

## Hook

The hook is the first 1–2 s: the picture, the caption and the song's drop landing together. It stops
the scroll by **opening a loop**: it makes viewers doubt what they see, puts them in a scene they know,
or names a gap, so they watch on to close it. A slogan is not a hook. A finished statement about the
product ("Your music, drawn live.", "Party visuals that run themselves.") opens nothing, and nobody
stays for it.

Patterns that open a loop:

- **Doubt**: the viewer questions what they're seeing ("Nobody animated this. It's hearing the song.").
- **POV**: a scene the viewer knows and wants to be in ("POV: you're the friend who brings the visuals").
- **Contrast**: a gap in price or effort ("Clubs pay a VJ for this. This is a free browser tab.").
- **Before/after**: one thing, transformed on the drop ("My party's TV: before vs after").
- **Callout**: names the viewer ("Small DJs: your screen doesn't need a budget.").

Rules:

- **One hook, for one audience.** If the release suggests two, keep one.
- **It lands in frame 1.** Viewers decide whether to swipe in about 1.5 s. So frame 1 is the video's
  best moment with the caption on it, and the drop hits within the first bar. Nothing comes before it:
  no logo, title or version card, which all read as an ad.
- **It works with the sound on and off.** The picture changes on the drop for viewers with sound; the
  caption carries it for viewers without.
- **The video closes the loop.** Every later clip is a **proof**: it shows the hook coming true in a new
  way, with a new picture every 3–5 s. A proof shows exactly what the hook claims: if the hook says
  the music moves the picture, nothing scripted may change that clip. Cut any clip that doesn't prove
  it. A loop the video never closes is bait, and viewers punish it.
- **The end pays it off.** The version card names what made the hook true. Nothing follows it.
- **It's made to be sent.** Reach comes from shares, not likes: on the app's Instagram, the stories
  someone shared reached several times more people than the rest. The best hooks make a viewer send
  the video to someone: the friend who throws the parties, the DJ they know.

Sources (2026-10-05): TikTok's Hook → Body → Close, and most ad recall landing in the first six seconds
(ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads); the 1.5 s swipe
decision and a change every 3–5 s (socialync.io/blog/short-form-video-structure-guide-2026); hooks as
open loops (curiosity gap, pattern interrupt, POV, before/after) whose picture, caption and sound agree
(kineclip.com/blog/how-to-write-viral-hooks-short-form-2026, hooklayer.dev/guides/viral-hooks).

## Inputs

- **Version**: none needed; the engine takes what Stable serves now.
- **Song**: `--song <file or link>`. Without it, the last run's song is reused. When the user names
  several songs, measure each one's tempo and drop (`song.py`, then the bass by bar around the drop)
  and cut each drop, one bar before to eight after, into a `song-review/` folder at one loudness so the
  user can listen; a song without a drop, or without a steady tempo, can't carry the Shape.
- **Several songs** in one video: write `<work>/mix.json` (its shape is in `tools/promo/mix.py`) and run
  `song` without `--song`. A mix.json is not carried to a new work folder: copy it there before `song`.
  They must share a tempo within a few bpm. Before recording, make a review
  copy of the mix and check that each drop and switch lands on its planned beat.
- **Look**: `--look "<Looks-card share link>"` opens the video. Without it, the last run's look is
  reused; with none at all the opening is a plain Physarum 2 stand-in, and you say so.

Each of steps 1–4 ends on the user's answer (house style).

## 1. Pick the audience

Say which audience this video speaks to, and why the current Stable serves them best. The user
confirms or switches.

## 2. Pick the hook

Offer three or four hooks for that audience, each from a different pattern. For each, give the caption,
the frame-1 shot and the proofs that would close its loop, then say which you'd pick and why. The last
run's hook is a candidate only if it still opens a loop.

## 3. Pick the proofs

Candidates are what the current Stable does best on screen:

- the featured scenes (those not in `DRAFT_SCENE_IDS` in Stable's `src/render/scenes/index.ts`),
  reacting to the song;
- this release's changes: `notes` writes the changelog to the work folder; read the PR bodies too.

Keep a candidate only if it proves the hook to that audience and its change shows within two bars at
phone size, and rank the keepers by how hard they grab. A clip of the panel being tweaked works against
a no-effort promise. The available takes are in `tools/promo/takes.json`; a new proof may need a new
take (copy a `ui_*` entry there and its script in `tools/promo/shots/take-ui.mjs`).

## 4. Show the plan

Write `<work>/lines.json`, shaped like `tools/promo/shapes/hook.example.json`, run `song` if the work
folder has none yet, then `plan` prints the time table. Show it on its own; the user adds, cuts, reorders and rewords, and you re-run `plan`.

## 5. Build and check

`all`, or step by step: `song` → `record` → `cards` → `render` → `check` → `deliver`. `record <take>…`
re-records only those takes.

- `song`: the bpm must match what the user counts (for a half or double reading, pass `--bpm`).
  `dropTime` must be the real drop: check the bass by bar around it, since the detector can pick an
  earlier swell.
- `record`: every take prints `OK`. The two-screen takes are timed to their slot in the plan, so
  re-record them after a reorder. In their footage, the second screen must change only during Cue and
  on Play.
- `cards`: no `WARN` lines.
- `render`, then `check`: look at about 16 frames across the video (`check.py strip`, its header has
  the call). Cuts land on beats, each caption
  names what its clip shows, `safe` prints no `WARN`. Then watch the first two seconds muted and alone:
  they must open the loop and make you want the rest. Confirm the drop lands on the first proof and the
  length is within `style.json` `videos.hook.maxSec`.

## Shape

Vertical 9:16 for phone Stories, every cut on a beat.

1. **Opening** (one bar): the hook's frame-1 shot with its caption big in the middle. Unless the hook
   needs another shot, that is the user's look, untouched, reacting to the song.
2. **Proofs**, back to back:
   - The song's drop lands on the first. By default that is Physarum 2 re-rolling from the user's
     look; its takes re-roll every two bars from the drop, since a dish re-rolled every two beats never
     grows. A re-roll is a click, so it can't prove a hook that says the music alone moves the picture.
   - Put the strongest first. Alternate scene and interface proofs, so every cut changes the picture.
     The two-screen proofs go last.
   - Each proof is two bars; a two-screen proof gets as many whole bars as its action needs.
   - Interface proofs carry a caption: one line in plain words about what the viewer sees, not the
     panel's name for the feature. It slides in as the last one leaves, on a translucent card with a
     white hairline. Scene proofs carry none; the picture speaks.
   - The palette proof taps a few palettes, each on a beat.
   - Scene proofs keep a steady camera. Interface proofs: the camera leans toward the part that changes.
   - Pop-out and Room are drawn as devices (house style). Room: add the TV by its code, then a palette
     and Play, twice; the TV follows each time.
3. **End**: the opening's scene alone for a bar, then a slim version card (a green tag icon, the version,
   the app name) over it for about three bars. With several songs, the song switches a couple of times
   under the card, a bar of each next song from its drop, so the look shows it follows any track. The
   video stops on a bar line.

**Songs**: one, or a few on one tempo, cut into one soundtrack (`mix.json`). A second song comes in
mid-video on a bar line, into its last build bar, so its drop lands on a scene proof.

The style is half as GitHub-ish as a release page: white accents (the app's own), no icons or pills on
captions. Only the version card keeps GitHub's tag.

**Rejected:**
- the changelog montage as this video (2026-10-05): it lives on as the release video,
  `/video-release-stable`;
- slogans as the hook ("Your music, drawn live.", 2026-10-05): a statement about the product opens no
  loop. Replaced by the viral hook above, picked for an audience (steps 1–2).
- keeping the last release's opening line by default (2026-10-05);
- the "Latest" badge on the version card, and its first, taller size ("slimmer", 2026-10-05);
- captions on scene proofs ("Slime mold that dances to your set" and the like, 2026-10-05).
