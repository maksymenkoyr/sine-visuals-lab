# Contributing to Sine Visuals Lab

Thanks for wanting to help. Two things to know before your first pull
request, then the practical stuff.

## The license agreement (CLA)

Every contribution requires agreeing to the Contributor License Agreement in
[CLA.md](CLA.md) — once, on your first pull request, by posting the one-line
comment that the `license/cla` check asks for (it's also at the end of
CLA.md).

Here's the honest framing of why: the code in this repository is licensed
AGPL-3.0-or-later and will stay that way — it stays open source for everyone,
your contribution included, and a contribution made here is never taken out
of this repository and sold as a closed, paid scene. What funds the work is
built around it: a paid tier on the hosted site, some scenes sold separately
(made outside this repository and not under the AGPL), and commercial
licenses for businesses that want the code without the AGPL's obligations.
The CLA is what makes those possible alongside your code — without it, code
contributed under the AGPL alone would require anything built together with
it to be released under the AGPL too. You keep the copyright to your code;
the CLA grants the maintainer a license broad enough to make that model work.
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
  what to read before touching what — live in [CLAUDE.md](CLAUDE.md).

## Practical setup

```
npm install
npm run dev          # visualizer + controller (HTTPS, for mic access)
npm run dev:worker   # Cloudflare Worker backend, for phone/TV pairing
```

Before opening a pull request, run the two gates that CI enforces:

```
npm run typecheck
npm run test
```

Both also run automatically on every pull request — see
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).
