# Video house style

The app has three promo videos, one skill each, all made by the engine in `tools/promo/` (its map is
the header of `tools/promo/promo.mjs`):

| Video | Skill | For | What it does |
|---|---|---|---|
| Release | `/video-release-stable` | people who already follow the app | shows what the last Stable release changed |
| Hook | `/video-hook-stable` | strangers scrolling | the main ad: one viral hook, then proofs |
| Explainer | `/video-explainer-stable` | someone already interested | calmly shows what the app is, its functions and use cases |

Each skill holds its own Shape (the user's calls for that video, with what they turned down). This
file holds the calls that apply to every video. When a Shape and this file disagree, the Shape wins
for that video, and it says so. Formats, frame rate and the length limit of each video are in
`tools/promo/style.json` under `videos.<video>`.

## Who watches

Two audiences (the user, 2026-10-05): **small DJs and artists** who want their party or concert to
look good and be remembered but have no budget or crew for visuals; and **home-party hosts** who want
a good vibe with no effort, where a TV or a few monitors is a bonus, not the pitch. Speak in their
situation and their words, never the panel's names.

## Working with the user

- Every step that needs a choice ends on the user's explicit answer. A pleased reply ("oh yeah baby")
  is approval of an idea, not a pick: ask which one.
- A proposal, list or plan table goes in a message of its own, never next to a question tool, which
  hides it ("I didn't see any list"). Then ask in at most five plain lines.
- Change only what was asked, narrowly. A round that added shots nobody asked for was "further from
  what I wanted". "Same X but …" keeps X's look and changes only the named behaviour.
- Judge a look change on frames side by side with the previous round, not by numbers.
- Record each new call in the video's Shape, dated, with what it replaced.

## Type

The system font (SF Pro on the Mac), sentence case. Never the app's Chakra Petch or Share Tech Mono
("I hate it"). The font stacks live in `tools/promo/cards/*.mjs`.

## Time and sound

- Every cut lands on a beat of the song. Each Shape sets its own pace; one-beat cuts were "too
  dynamic" wherever they were tried.
- Nothing fades out, picture or music, unless the video's Shape names the fade. The music plays at
  full level to the last frame and the video stops on a bar line.

## Placement

In 9:16, text sits where it covers no action. For videos whose `style.json` entry has `safeBand`,
captions stay inside `storiesBand` (Stories covers the top and bottom of the frame with its own UI);
`check.py safe` checks it.

## Footage

- Film the live Stable site: every video shows what a visitor gets today. The release must be live
  before recording.
- Scenes hear the song itself through the fake mic, never the synthetic feed (on that feed Chladni
  held one figure and Physarum barely pulsed: "flat, low sync to the music"). Panel takes may use the
  synthetic feed.
- One capture at a time, on the user's Mac (Metal GPU), never CI. Another job's encode makes takes
  stutter: wait for it rather than keep a choppy take.
- Check every take before using it: its gate line, motion and sync for scene takes, and a few tiled
  frames, because a reworked panel can make a take silently do nothing.
- No macOS "show mouse clicks" markers ("too ugly").

## Second screens

The pop-out window and a Room TV are drawn as devices: a laptop with its Cue (Space) and Play
(Option) keys lit while pressed, over the second screen, whose frame glows orange during Cue and
flashes green on Play. Cue is a peek: it shows only while Space is held (`src/ui/outputKeys.ts`).
Whether a video shows pairing a TV is that video's call.

## Content

- Never a paid scene, never a scene in Stable's `DRAFT_SCENE_IDS`, never internal work.
- What changed comes from PR bodies, not titles: the best changes hide in bodies, and the user caught
  missed lines twice ("I'm pretty sure something was missed"). Check each claim against the release's
  final state, since a later PR may undo it.

## Songs

The user's songs are usually commercial. Say once that posting needs their rights, offer the silent
master and `CUES.md` for adding licensed music in the platform's editor, and never commit songs,
takes, clips or recordings.

## Delivery

`promo.mjs deliver` writes the master, a share copy, a silent copy, a small preview and `CUES.md`.
Send the preview: the master is over the send limit (`style.json` `delivery.sendLimitMB`). Give the
path, the length and what was reused or is a stand-in. Post nothing.
