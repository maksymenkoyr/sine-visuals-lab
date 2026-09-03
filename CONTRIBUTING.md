# Contributing to Sine Visuals Lab

Thanks for wanting to help. Two things to know before your first pull
request, then the practical stuff.

## The license agreement (CLA)

Every contribution requires agreeing to the Contributor License Agreement in
[CLA.md](CLA.md) — once, on your first pull request, by posting the comment
it describes.

Here's the honest framing of why: this project is licensed AGPL-3.0-or-later
and will stay that way — the source stays free, forever, for everyone. The
CLA lets the maintainer *additionally* sell commercial licenses and paid
hosted usage to businesses, which is what funds the time to build the free
version. You keep the copyright to your code; the CLA grants the maintainer a
license broad enough to make that model work. If that trade isn't one you
want to make, that's a legitimate position — but then please open an issue
describing your change instead of a pull request, so someone who has signed
can implement it independently.

## Ground rules for code

- **Dependencies must be AGPL-compatible**, and any third-party code bundled
  into the client build gets an entry in
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
