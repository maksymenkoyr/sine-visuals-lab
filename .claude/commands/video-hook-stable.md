---
description: Make a short vertical video of the best parts of the current Stable version, built around one viral hook and cut to the user's song
---

**The idea:** a short vertical video that shows the best parts of the current Stable version to one
audience, built around one viral hook and cut to the user's song.

## Audience

Who the app is for (the user, 2026-10-05):

- **Small DJs and artists** who want their party or concert to look good and be remembered, but have
  no budget or crew for visuals.
- **Home-party hosts** who want a good vibe with no effort: turn it on and it runs. Putting it on a TV
  or a few monitors is a bonus, not the pitch.

What both get: visuals that look like a pro made them, for no money and no effort. A video speaks to
one of them first, in their situation and their words, never the panel's. The other can come along
when the hook is about what they share: a party or concert people remember.

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

The machinery is `tools/promo/`; read the header of `tools/promo/promo.mjs` first. Its defaults already
play the Shape below. Change only what the user asks for, and record each new call in the Shape,
noting what it replaced.

## Inputs

- **Version**: none needed. `promo.mjs` takes what Stable serves now. The recorder films the deployed
  site, so the release must be live.
- **Song**: `--song <file or link>`. Without it, the last release's song is reused. Say once that
  posting needs its rights. When the user names several songs, measure each one's tempo and drop
  (`song.py`) and recommend one; a song without a drop, or without a steady tempo, can't carry the Shape.
- **Look**: `--look "<Looks-card share link>"` opens the video. Without it, the last release's look is
  reused; with none at all the opening is a plain Physarum 2 stand-in, and you say so.
- Output goes to `~/Movies/sine-visuals-lab-v<version>-promo/`.

Each of steps 1–4 ends on the user's answer: show your proposal in a message of its own, ask in at
most five plain lines, and go on only once they have chosen. A pleased reply to a list is not a
choice; ask which one.

## 1. Pick the audience

Say which audience this video speaks to, and why this release serves them best. The user confirms or
switches.

## 2. Pick the hook

Offer three or four hooks for that audience, each from a different pattern. For each, give the caption,
the frame-1 shot and the proofs that would close its loop, then say which you'd pick and why. The last
release's hook is a candidate only if it still opens a loop.

## 3. Pick the proofs

Candidates are what the current Stable does best on screen:

- the featured scenes (those not in `DRAFT_SCENE_IDS` in Stable's `src/render/scenes/index.ts`),
  reacting to the song;
- this release's changes. `node tools/promo/promo.mjs notes` writes the changelog to the work folder.
  It holds only PR titles, and the best changes hide in PR bodies, so read every body (a Sonnet
  subagent). Check each change against the release's final state, because a later PR may undo it.

Keep a candidate only if it proves the hook to that audience and its change shows within two bars at
phone size, and rank the keepers by how hard they grab. A clip of the panel being tweaked works against
a no-effort promise. Leave out paid scenes, draft scenes and internal work. The available takes are
the `T` table in `tools/promo/record.mjs`; a new proof may need a new take (copy a `ui_*` one).

## 4. Show the plan

Show the plan as a table, with times in seconds from the song's bpm. A question tool in the same
message hides the table ("I didn't see any list").

| Time | On screen | Caption |
|---|---|---|
| 0.0–1.4 s | Opening: the hook's frame-1 shot | The hook |
| 1.4–4.1 s | Drop: the first proof | What it shows, in plain words |
| … | … | … |
| 22.0–24.7 s | End: version card over the opening's scene | — |

Let the user add, cut, reorder and reword. Then write `<work>/lines.json`, shaped like
`tools/promo/lines.v0.2.0.json`.

## 5. Build and check

`node tools/promo/promo.mjs all [--song …] [--look …]`, or step by step: `song` → `record` → `cards` →
`compose` → `encode`. `record <take>…` re-records only those takes. Look at every step:

- `song`: the bpm must match what the user counts (for a half or double reading, pass `--bpm`).
  `dropTime` must be the real drop: check the bass by bar around it, since the detector can pick an
  earlier swell.
- `record`: every take must say `OK`. A `SLOW` that survives its retries means the Mac was busy; wait
  for other encodes to finish rather than keep a choppy take. Panel takes find controls by visible text
  and `.vc-*` classes, so a reworked UI can make one silently do nothing: tile a few frames of each take
  and check that something moves. Check scene takes with `tools/promo/motion.py <take> --from <drop
  beat + 3>`. The two-screen takes are timed to their slot in `lines.json`, so re-record them after a
  reorder. In their footage, the second screen must change only during Cue (while Space is held) and on
  Play.
- `cards`: no `WARN` lines.
- `compose`: tile about 16 frames across the video. Check that cuts land on beats, that each caption
  names what its clip shows, and that text stays in the middle band (Stories covers the top ~13 % and
  the bottom ~19 %). Then watch the first two seconds muted and alone: they must open the loop and make
  you want the rest.
- `encode`: confirm the length, that the drop lands on the first proof (the audio's rms jumps there),
  and that the music plays at full level to the last frame. The full file is over the 30 MB send
  limit, so send a 720p preview copy.

Deliver the path, the length, what was reused (song, look) or is a stand-in, and the song-rights note.
Post nothing. This needs a Metal GPU, so it runs on the user's Mac after the release is live, never in
CI.

## Shape

Vertical 9:16 for phone Stories, at most 30 s, every cut on a beat.

1. **Opening** (one bar): the hook's frame-1 shot with its caption big in the middle. Unless the hook
   needs another shot, that is the user's look, untouched, reacting to the song.
2. **Proofs**, back to back:
   - The song's drop lands on the first. By default that is Physarum 2 re-rolling from the user's
     look; its takes re-roll every two bars from the drop, since a dish re-rolled every two beats never
     grows. A re-roll is a click, so it can't prove a hook that says the music alone moves the picture.
   - Put the strongest first. Alternate scene and interface proofs, so every cut changes the picture.
     The two-screen proofs go last.
   - Each proof is two bars; a two-screen proof gets as many whole bars as its action needs.
   - The caption is one line in plain words about what the viewer sees, not the panel's name for the
     feature. It slides in as the last one leaves, on a translucent card with a white hairline.
   - Scene proofs keep a steady camera and hear the song itself, never the synthetic feed (on that feed
     Chladni held one figure and Physarum barely pulsed: "flat, low sync to the music").
   - Interface proofs: the camera leans toward the part that changes.
   - Pop-out and Room are drawn as devices: a laptop, with its Space (Cue) and Option (Play) keys lit
     while pressed, above the second screen. That screen's frame glows orange while Cue shows the
     laptop's look on it and flashes green on Play. Cue is a peek: it shows only while Space is held
     (`src/ui/outputKeys.ts`). Room: add the TV by its code, then a palette and Play, twice; the TV
     follows each time.
3. **End**: the version card (a green tag icon, the version, the app name) over the opening's scene,
   held about two bars. The video stops on a bar line.

Nothing fades out, picture or music. The style is half as GitHub-ish as a release page: white accents
(the app's own), no icons or pills on captions. Only the version card keeps GitHub's tag.

**Rejected:**
- the changelog montage, replaced on 2026-10-05 by this shape. It had the version card second and
  every change in scrolling lists.
- slogans as the hook ("Your music, drawn live.", 2026-10-05): a statement about the product opens no
  loop. Replaced by the viral hook above, picked for an audience (steps 1–2).
- keeping the last release's opening line by default (2026-10-05);
- the "Latest" badge on the version card;
- one-beat cuts ("too dynamic");
- fades;
- screen captures without device frames.
