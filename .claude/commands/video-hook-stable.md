---
description: Make a short vertical video of the best parts of the current Stable version, built around one hook and cut to the user's song
---

**The idea:** a short vertical video that shows the best parts of the current Stable version, built
around one hook and cut to the user's song.

## Hook

The hook is the one idea the video is built around, and it is also what stops the scroll. It works as
a promise: the first second makes it, every later shot proves it, and the end pays it off.

- **One idea.** Write it as one line a stranger understands, about what they get rather than what the
  panel calls it ("Your music, drawn live."). If the release suggests two ideas, keep one.
- **It lands in the first second.** Viewers decide whether to swipe in about 1.5 s. So frame 1 shows
  the video's best moment with the line on screen, and the song's drop hits within the first bar.
  Nothing comes before it: no logo, title or version card, which all read as an ad.
- **It works with the sound on and off.** The picture changes on the drop for viewers with sound; the
  line carries it for viewers without.
- **The video keeps the promise.** Every later shot proves the line in a new way, with a new picture
  every 3–5 s. Cut any shot that doesn't prove it: a promise the video doesn't keep is worse than a
  weak hook, because viewers feel baited.
- **The end pays it off.** The version card names what made the promise come true. Nothing follows it.

The hook is worked out afresh for every video (step 1); the clips after the opening are its **proofs**.

Sources (2026-10-05): TikTok's Hook → Body → Close, and most ad recall landing in the first six seconds
(ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads); the 1.5 s swipe
decision and a change every 3–5 s (socialync.io/blog/short-form-video-structure-guide-2026).

The machinery is `tools/promo/`; read the header of `tools/promo/promo.mjs` first. Its defaults already
play the Shape below. Change only what the user asks for, and record each new call in the Shape,
noting what it replaced.

## Inputs

- **Version**: none needed. `promo.mjs` takes what Stable serves now. The recorder films the deployed
  site, so the release must be live.
- **Song**: `--song <file or link>`. Without it, the last release's song is reused. Say once that
  posting needs its rights.
- **Look**: `--look "<Looks-card share link>"` opens the video. Without it, the last release's look is
  reused; with none at all the opening is a plain Physarum 2 stand-in, and you say so.
- Output goes to `~/Movies/sine-visuals-lab-v<version>-promo/`.

## 1. Pick the hook

Work the hook out from two things:

- the app's core value: what a stranger gets from it, as the README's opening and the site's
  description (`index.html`) put it;
- what the current Stable shows best on screen: the candidates in step 2.

Offer two to four lines. For each, give its frame-1 shot and the proofs that would keep its promise,
and say which one you'd pick and why. The last release's line is one candidate, not the default. Show
them in a message of their own, then plan nothing else until the user picks one or writes their own.

## 2. Pick the proofs

A proof is a clip after the opening that shows the hook coming true in a new way. Candidates are what
the current Stable does best on screen:

- the featured scenes (those not in `DRAFT_SCENE_IDS` in Stable's `src/render/scenes/index.ts`),
  reacting to the song;
- this release's changes. `node tools/promo/promo.mjs notes` writes the changelog to the work folder.
  It holds only PR titles, and the best changes hide in PR bodies, so read every body (a Sonnet
  subagent). Check each change against the release's final state, because a later PR may undo it.

Keep a candidate only if it proves the hook and its change shows within two bars at phone size, and
rank the keepers by how hard they grab. Leave out paid scenes, draft scenes and internal work. The
available takes are the `T` table in `tools/promo/record.mjs`; a new proof may need a new take (copy a
`ui_*` one).

## 3. Show the plan, then wait

Before recording, show the user the plan as a table in a message of its own. A question tool in the
same message hides the table ("I didn't see any list"). Give times in seconds, from the song's bpm:

| Time | On screen | Caption |
|---|---|---|
| 0.0–1.4 s | Opening: the user's look | The hook's line |
| 1.4–4.1 s | Drop: Physarum 2 re-rolls | Slime mold that moves to the beat |
| … | … | … |
| 22.0–24.7 s | End: version card over the look | — |

Then ask in at most five plain lines. Let the user add, cut, reorder and reword. Then write
`<work>/lines.json`, shaped like `tools/promo/lines.v0.2.0.json`.

## 4. Build and check

`node tools/promo/promo.mjs all [--song …] [--look …]`, or step by step: `song` → `record` → `cards` →
`compose` → `encode`. `record <take>…` re-records only those takes. Look at every step:

- `song`: the bpm must match what the user counts (for a half or double reading, pass `--bpm`).
  `dropTime` must exist.
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
  the bottom ~19 %). Then watch the first two seconds muted and alone: they must say what the video is
  and make you want the rest.
- `encode`: confirm the length, that the drop lands on the first proof (the audio's rms jumps there),
  and that the music plays at full level to the last frame. The full file is over the 30 MB send
  limit, so send a 720p preview copy.

Deliver the path, the length, what was reused (song, look) or is a stand-in, and the song-rights note.
Post nothing. This needs a Metal GPU, so it runs on the user's Mac after the release is live, never in
CI.

## Shape

Vertical 9:16 for phone Stories, at most 30 s, every cut on a beat.

1. **Opening** (one bar): the user's look, untouched, reacting to the song, with the hook's line big in
   the middle.
2. **Proofs**, back to back:
   - The song's drop lands on the first: Physarum 2 re-rolling from the user's look. Its takes re-roll
     every two bars from the drop; a dish re-rolled every two beats never grows.
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
- keeping the last release's opening line by default, replaced on 2026-10-05: the hook is worked out
  for every video from the app's core value and Stable's features (step 1);
- the "Latest" badge on the version card;
- one-beat cuts ("too dynamic");
- fades;
- screen captures without device frames.
