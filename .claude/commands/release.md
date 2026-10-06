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
user the skeleton first: the headline, the highlights, every row. They add, cut and reorder before any
picture is taken.

## 3. Pictures

- One per highlight, plus one per new scene. Write `<work>/shots.json` and run
  `node tools/promo/shots/stills.mjs --shots <work>/shots.json --out <work>/stills`. Its header lists
  the fields. It shoots Insiders on the synthetic feed (Sonnet subagent, low effort, may run and
  re-run it).
- Look at every picture yourself. It must show the thing its heading names, readable at phone width,
  with no empty card or list, no debug overlay, nothing paid.
- `npm run release-shots -- <work>/stills/*.jpg` hosts them on the Insiders pre-release and prints the
  markdown lines for the notes.
- Before anything is uploaded, show the user a preview: the notes with the local pictures, as a private
  Artifact page.

## 4. The release pull request

`npm run release -- --notes <work>/notes.md` opens the pull request into production, or rewrites the
open one's title and body; re-run it after every change to the notes. Add `--print` to read the
title and body first without opening anything. Give the user the link. Merging
is the user's call. After the merge, `.github/workflows/release.yml` opens the GitHub Release with the
same notes, and `/video-release-stable` can start from them.

## Shape

Plain words, and the panel's names for things in **bold**, as they read on screen. Keys go in `code`.
No file names, PR numbers or code words: the folded list under the notes carries those.

```markdown
**<Headline: what this release lets you do, one line>**

<Lead: two or three sentences: who gets what, and the one thing to try first.>

## Highlights

### <area emoji> <Plain name of the change>

![<what the picture shows>](<url>)

<What you can do now, and where: the card, button or key. Two or three sentences.>

## New scenes

| ![<Name>](<url>) | ![<Name>](<url>) | ![<Name>](<url>) |
|---|---|---|
| **<Name>** — <one line> | … | … |

## Keys

| Key | What it does |
|---|---|
| `<key>` | <…> |

## Also in this release

### <area title>

- **<Row>** — <one more sentence, when it helps>
```

- **Headline and lead**: what someone who has never opened the folded list should know.
- **The areas** are the titles of `CATEGORIES` in `tools/releaseNotesLib.mjs`, in its order, leaving
  out new scenes and docs: the same groups as the folded list under the notes.
- **Highlights**: three to six, the most visible first. Each heading starts with its area's emoji,
  which is how the release video groups its demos. A heading is short enough to be a video caption
  (`tools/promo/cards/release.mjs` warns when it isn't).
- **New scenes**: only when the release adds some. A scene in the gallery's In development section
  says so in its line; one still under Draft stays out.
- **Keys**: only when the release adds or moves keys.
- **Also in this release**: every other change a visitor can notice, one bullet each, under its
  area. The bold part alone must read as a complete
  line. It's what a skimmer reads, and it's one row of the video's list, so it has to fit one
  (`cards.mjs` warns). Fixes go here too, worded as what works now. Docs and tooling stay out: the
  folded list has them.
