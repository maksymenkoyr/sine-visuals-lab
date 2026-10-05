---
description: Make the explainer video — a calm look at what the app is, its functions and use cases, for someone already interested; 9:16 and 16:9 from current Stable
---

**The idea:** a calm video for someone who is already interested (the hook video or a friend sent
them) and wants to understand what is in front of them: what the app does, its main functions and
what they are for. It doesn't compete for attention, so it can take its time, but stays under
`style.json` `videos.explainer.maxSec`. Both 9:16 and 16:9, at true 60 fps, filmed on current Stable.
It grew out of the approved showcase video (v10, 2026-10-04), whose Shape it keeps.

Read `docs/video-house-style.md` and the header of `tools/promo/promo.mjs` first. Don't redesign the
Shape: change only what the user asks for, narrowly, and record each new call in it, dated, with what
it replaced.

All commands are `node tools/promo/promo.mjs <step> --video explainer --work <work>`; the work dir
defaults to `tools/.cache/promo/explainer/<date>/`.

## 1. What to show

The functions come from the feature map, `docs/feature-map.md` (while PR #360 is open:
`git show origin/worktree-feature-map:docs/feature-map.md`). Take its Core lines, then its Key ones,
that a viewer can see working within two bars, and say each as what it does for a host or a DJ (a use
case), not the panel's name. Propose which Shape sections stay and which `chapters` to add between the
wiring and the shuffle; the user picks.

## 2. Inputs

- **Songs**: the user names them. Download them into the work dir (`yt-dlp` via `uvx`, bestaudio),
  then make a 48 kHz mono loudness-normalised wav for the fake mic and a 48 kHz stereo one for the mix
  (or reuse `tools/.cache/promo-songs/`). Find the bed song's drop from the bass energy, not the coarse
  beat tracker.
- **The user's two screen recordings** (Cmd+Shift+5, Chrome, the live site): (1) Mic → Chrome's mic
  prompt → Allow, then Share a tab → the picker → Window → a music window → app audio on → Share with
  audio; (2) the gallery, the pointer moving to a scene tile, the click, the scene running. Chrome's own
  prompts can't be filmed headlessly, and clicking a permission prompt by synthesized input is blocked:
  ask the user to record, never drive their screen. Copy both into `<work>/rec/`.
- **Looks** for each scene shot: the user's Stable share codes, or explore extremes (Random, Master
  Scale and Expansion pushed up) and show contact sheets to pick from. After Stable changes, compare
  three stills per shot with the intended look and say which no longer reproduces; don't silently
  invent a replacement.

## 3. Plan

Copy `tools/promo/showcase/showcase.example.json` to `<work>/showcase.json` (set `work`), fill the
songs, `bed`, the clip windows, `drop`, `wiring`, `chapters`, `shuffle` and the captions, then `plan`:
it prints the time table. Show it; the user approves or changes it.

## 4. Build and check

- **Clips**: one entry per shot in `<work>/takes.json` with `mode: "clip"` (format in the
  `capture.mjs` header and `tools/promo/takes.json`): scene shots through `shots/scene-look.mjs` with the
  look's share code; the wiring takes through `shots/seg4d.mjs` (its header has the three framings).
  Then `record`; `record <clip>…` redoes only those.
- **The recordings**: set `intro` and `gallery` in `showcase.json` by looking at frames (source times,
  camera points, click times, blur boxes for other windows), then run the prep scripts as the header of
  `tools/promo/showcase/edit.py` lists them: `track_pointer.py`, `intro.py` (v and h), `gallery.py`,
  `camera.py`.
- `cards`, then `render` (both formats), then `check` (sync, repeats, loud, length) and look at a
  strip of every section in both formats: captions covering an action, UI that shouldn't be there,
  washed-out looks. Then `deliver`.

## Shape

v10, about 40 s, both formats, every cut on a beat. Agreed over ten rounds (2026-10-04).

1. **Use mic. / Or share screen.** (recording 1): one continuous shot per input, on the button, then
   one smooth glide (eased, a soft pull-back swell mid-way, never a stop) to Chrome's prompt, and an
   eased slow motion around the final click. Fast-forward the dull part (choosing the window) only after
   the camera has arrived.
2. **No install. Right in the browser.** (recording 2): wide on the whole page with the user's real
   pointer, then a zoom following the tracked pointer to the tile; the scene opens at that zoom and
   eases out, the pointer erased there. Crop away the browser chrome, Chrome's sharing bar, the room
   badge, the scene toolbar's ROOM button and the status line; blur other windows in the share picker.
3. **The drop**: the bed song's drop lands on the first scene; one-bar then half-bar cuts across the
   showcase scenes, each recorded with its own song as the fake mic.
4. **Deep customisation** / *Wire any signal to any setting*: one wire built in full on the current
   panel: pin a setting's port, wire a signal jack (the cable shows), drag the wire's strength, threshold
   on and up, then two or three scene settings with big visible effects. Sliders ~1.3 s each ("50%
   faster" than 2 s), short pauses so each response shows, every monitor card open the whole time.
   Horizontal is filmed oversized and the camera pushes into the wiring box, the monitors, the scene
   settings, then pulls back wide; vertical cuts on beats between the monitor column and the settings
   column.
5. **Chapters** (optional, from step 1): feature shots cut on the bed's grid, each with its caption.
6. **Any song. Any scene.**: six short shots, each swapping song and scene, each starting on a strong
   bass hit of its song.
7. **End card**: the logo and sinevisualslab.com, held for `end.length` in `showcase.json`, the last
   song at full level to the last frame. The
   last shot dips out and the card fades in (this video's named exception to the house style's no-fade
   rule).

Text: big and small lines on a dark translucent box, placed per format where it covers no action
(the horizontal share caption top right). Pairing a TV stays hidden (no room code, no ROOM button, no
`host (XXXX)` status) until the user decides otherwise (asked 2026-10-05).

**Rejected:**
- hard cuts from button to prompt; freezes before the click; extra LISTENING shots;
- a black "or" title card ("or" rides on the share shot's caption);
- a synthetic white tap dot; "Tap a scene. It's running.";
- many quick wiring actions ("chaotic"), a dead last move that changes nothing, hidden monitors;
- shots nobody asked for (v6: "further from what I wanted").
