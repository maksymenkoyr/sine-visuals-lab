# Contributing to Sine Visuals Lab

Thanks for wanting to help. Two things to know before your first pull
request, then the practical stuff.

## The license agreement (CLA)

Every contribution requires agreeing to the Contributor License Agreement in
[CLA.md](CLA.md) — once, on your first pull request, by posting the one-line
comment that the `license/cla` check asks for (it's also at the end of
CLA.md).

Here's the honest framing of why: the code in this repository is licensed
AGPL-3.0-or-later, and whatever is released here stays available under that
license for everyone — your contribution included. What funds the work is
built around it: a paid tier on the hosted site, some scenes sold separately
(made outside this repository and not under the AGPL), and commercial
licenses for businesses that want the code without the AGPL's obligations.
The CLA is what makes those possible alongside your code — without it, code
contributed under the AGPL alone would require anything built together with
it to be released under the AGPL too. You keep the copyright to your code;
the CLA grants the maintainer a license broad enough to make that model work.
The maintainer's policy is that code contributed here isn't moved into the
separately sold scenes; that's a statement of intent, and the CLA itself is
the whole of the legal agreement.
If that trade isn't one you
want to make, that's a legitimate position — but then please open an issue
describing your change instead of a pull request, so someone who has signed
can implement it independently.

## Ground rules for code

- **Dependencies must be permissively licensed** — MIT, BSD, Apache-2.0,
  ISC, the SIL Open Font License, or similar. Not GPL, LGPL or AGPL: a
  copyleft dependency binds whatever it's combined with, including the scenes
  sold outside this repository. If you're unsure about one, ask in an issue
  first. Any third-party code bundled into the client build gets an entry in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **Don't port third-party implementations** (shaders, algorithms,
  visualizations) into a scene — write it as independent work. Ported code
  carries its author's copyright and license whether or not you copy it
  verbatim.
- The working rules for the codebase itself — documentation conventions,
  what to read before touching what — live in [CLAUDE.md](CLAUDE.md). They
  are written to Claude Code, but hold for any contributor.

## Practical setup

```
npm install
npm run dev          # visualizer + controller (HTTPS, for mic access)
npm run dev:worker   # Cloudflare Worker backend, for phone/TV pairing
```

Before opening a pull request, run the check that CI enforces (typecheck,
code rules, lint, unused code, licenses, secrets, tests and bundle size; the
`tools/check.mjs` header explains each):

```
npm run check
```

`npm install` also sets up a git hook that runs it before every push. It
runs automatically on every pull request too, and again on every deploy —
see [.github/workflows/deploy.yml](.github/workflows/deploy.yml) (PR checks
and previews, plus the Insiders channel on every push to `main`) and
[.github/workflows/release.yml](.github/workflows/release.yml) (the Stable
channel, released deliberately rather than on every push).

CI also opens every free, non-draft scene in headless Chromium against the
built site before it deploys (`tools/scene-smoke.mjs`); run
`npm run smoke:scenes` after a build to do the same locally.
