---
description: Write the Stable release — a plain-words description with pictures, opened as the release pull request; the same text becomes the GitHub Release and the release video's starting lines
---

**The idea:** one text per release, written once and read three ways: by whoever merges the release
pull request, by anyone who opens the GitHub Release, and by `/video-release-stable`, which takes its
demos and list rows from it. It's for people who play music with the app open (DJs, artists, party
hosts), not for people who read its code.

Read the header of `tools/releaseNotesLib.mjs` first (what becomes the Release, and how the generated
list under it is built), and `docs/vocabulary.md` for the panel's own words.

## 1. The facts

- `npm run release-notes -- --to origin/main` lists every change since the last release, one line per
  pull request.
- Read every PR body in it (one Sonnet subagent, medium effort). Per PR, find out what changed for a
  visitor in plain words, its keys, and what picture would show it. Also check whether a later PR in
  the same release replaced it: the notes describe the release's final state only.
- When a PR body is unclear, open Insiders (the build that ships) and look.
- Never name or show a paid scene (CLAUDE.md), even when one ships.

## 2. The notes

Write `<work>/notes.md` in the Shape below, with a work folder under the job's tmp directory. Show the
user the skeleton first: the headline, every line, and which lines get a picture. They add, cut and
reorder before any picture is taken.

## 3. Pictures

- One for every change that can be shown (the Shape says which). Write `<work>/shots.json` and run
  `node tools/promo/shots/stills.mjs --shots <work>/shots.json --out <work>/stills`. Its header lists
  the fields, and `tools/promo/shots/stills.example.json` is a past release's list. It shoots Insiders
  on the synthetic feed (Sonnet subagent, low effort, may run and re-run it).
- Look at every picture yourself. It must show the thing its line names, readable at phone width,
  with no empty card or list, no debug overlay, nothing paid. A change whose picture can't be got
  right becomes a text line.
- The notes name each picture by its local path (`src="stills/<name>.jpg"`).
  `npm run release-shots -- --notes <work>/notes.md <work>/stills/*.jpg` hosts the pictures on the
  Insiders pre-release and points the notes at them.

## 4. The release pull request

`npm run release -- --notes <work>/notes.md` opens the pull request into production, or rewrites the
open one's title and body; re-run it after every change to the notes. Add `--print` to read the
title and body first without opening anything. Give the user the link: the PR is where they read
the notes as they'll be published, pictures and all, and ask for changes. Merging is the user's call. After the merge, `.github/workflows/release.yml` opens the GitHub Release with the
same notes, and `/video-release-stable` can start from them.

## Shape

Plain words, and the panel's names for things in **bold**, as they read on screen. Keys go in `code`.
No file names, PR numbers or code words: the folded list under the notes carries those.

```markdown
**<Headline: what this release lets you do, one line>**

<Lead: two or three sentences: who gets what, and the one thing to try first.>

## <area title>

<table>
<tr>
<td width="50%" valign="top"><img src="<url>" alt="<what the picture shows>" width="360"><br><b><Line></b><br><One or two sentences: what you can do now, and where.></td>
<td width="50%" valign="top"><img …><br><b><Line></b><br>…</td>
</tr>
</table>

- **<Line>** — <one more sentence, when it helps>

## Keys

| Key | What it does |
|---|---|
| `<key>` | <…> |
```

- **Headline and lead**: what someone who has never opened the folded list should know.
- **Every change** a visitor can notice is one line, under its area. Fixes count, worded as what
  works now. Docs and tooling stay out: the folded list has them.
- **A picture wherever one can show the change** — the new card, the new look, the button, the
  open list. A new slider among others doesn't count: that change stays a text line. Never a
  picture for some changes picked as highlights while other showable ones go without.
- **Each area** is a grid two pictures wide (the change's picture, its line in bold, a sentence),
  the most visible change first; an odd last cell gets an empty `<td>` beside it. A portrait
  picture (a phone's screen, a long list) gets a narrower width, about half, so its row doesn't
  tower over the rest. The changes
  without a picture follow as a list under the grid. GitHub keeps this HTML. It sizes a table to its
  content, so the fixed picture width is what keeps two across a PR comment's column without
  scrolling sideways — and why a card's picture is cropped to the card (`stills.mjs`'s `clip`).
- **The areas** are the titles of `CATEGORIES` in `tools/releaseNotesLib.mjs`, in its order, the same
  groups as the folded list under the notes. New scenes that are still in the gallery's In
  development section go last instead, under "New scenes, in development", and say so; a scene
  still under Draft stays out.
- **The line** (bold) must read as a complete line on its own. It's what a skimmer reads, and it's one
  row of the release video's list, so it has to fit one (`tools/promo/cards/release.mjs` warns). A
  pictured change is also a demo for that video, and its line the caption.
- **Keys**: only when the release adds or moves keys, after the areas.
