# Business & legal

The monetization model and legal structure decided in the pre-release review
(September 2026), and the reasoning — so future changes to license, CLA, or
branding are made knowing what they'd break. Nothing here is legal advice;
it's the project's own record of its plan.

## The model

The code is AGPL-3.0-or-later, permanently. Anyone may use, self-host, fork,
or even sell services on it, provided they honor the license. Revenue comes
from a different layer: the **hosted instance** (sinevisualslab.com), whose
Terms of Service — not the code license — will make commercial use paid while
individual use stays free. The AGPL governs the code; a ToS governs a
service; they don't conflict, and copyright law doesn't reach the service
layer. A second, optional revenue lane is selling **commercial licenses** to
businesses that want the code without AGPL obligations (the Qt/MySQL
dual-license model) — that lane only exists because of the CLA, below.

## Why the CLA exists

Every contributor owns the copyright to their lines. Code merged *without* a
license grant is available to the project under the AGPL only — which means
one merged outside PR, however small, permanently forecloses dual-licensing
(there's no practical way to retrofit consent later). Hence
[`CLA.md`](../CLA.md), required from the very first outside contribution:
contributors keep their copyright and grant a license broad enough for
commercial licensing. The funding rationale is stated openly in
[`CONTRIBUTING.md`](../CONTRIBUTING.md) — surprise relicensing, not
paperwork, is what has historically burned projects' communities.

Enforcement is mechanical: CLA Assistant posts a `license/cla` status check
on every PR, and that check is in `main`'s required checks alongside CI. The
signable text of record is a public gist under the maintainer's account — it
must stay byte-identical to `CLA.md` whenever either is amended.

## The name

**Sine Visuals Lab.** In trademark terms, "Sine" is the distinctive element
that makes the mark ownable; "Visuals Lab" is descriptive and unprotectable
on its own. No registration yet, deliberately: US rights accrue from public
use (the git history and deploys are the timestamped evidence); the EU is
registration-first, which is a reason to file at stage 2, not before. The
README's License section carves the name and logo out of the AGPL grant —
forks are welcome, but under their own name. `src/brand.ts` is the single
home of the product name and source URL; it's the one file a fork is
expected to change.

## Obligations already wired in

- **AGPL §13**: a network service built from AGPL code must offer its source
  to users. The gallery header and the TV corner both render a source link
  fed from `src/brand.ts`.
- **Privacy**: [`PRIVACY.md`](../PRIVACY.md) — every claim in it was
  verified against `src/net/protocol.ts` (no audio on the wire) and
  `server/room.ts` (no storage, no logs). It must be replaced by a real
  privacy policy the moment accounts or payments exist.

## Stage 2 — deferred until the first paying customer

In rough order:

1. **Taking money without a company is fine**: a merchant of record
   (Paddle, Lemon Squeezy) is legally the seller, handles worldwide
   VAT/sales tax, and pays out to an individual. A legal entity is deferred
   *liability protection*, not a legal gate — form one when revenue
   justifies the overhead, then repoint the merchant account at it.
2. **Terms of Service** for the hosted instance — the document that actually
   implements "free for individuals, paid for commercial use", plus
   acceptable use and liability caps.
3. **Real privacy policy** replacing PRIVACY.md (GDPR applies once EU users
   have accounts).
4. **Trademark filing** on "Sine Visuals Lab": USPTO and EUIPO, Nice
   classes 9 (software), 41 (entertainment), 42 (SaaS).
5. **Commercial license text**, if the dual-license lane is wanted.

None of it needs to start until a real prospect asks how to pay.
