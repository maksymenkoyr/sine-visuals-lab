---
description: Hand research on to build sessions — at the end of a session, write down what was worked out as a plan; as the first message of a new session, pick the plan up and build its next phase
argument-hint: [topic]
---

One command for both ends of a hand-off. A research session works something
out (prototypes, the user's calls, the phases); later build sessions build
it, one phase each, from `plans/<topic>.md`. That file is all a build session
inherits, so anything it needs must be written there.

**Which end:** if `/handoff` is the first message of the session, pick up;
otherwise write. `$1` is the topic, a short kebab-case slug. Without it,
write names one from the work, and pick up lists the plans on `origin/main`
that still have an unticked phase, each with its next phase, and asks.

Paid-scene work never goes in this repo: its plan lives at
`src/render/scenes/private/plans/<topic>.md`, and committing and pushing it
is the user's.

## Write (end of a session)

1. **Start from what's there.** Fetch. If `plans/<topic>.md` exists on
   `origin/main` or in an open PR, update that file; never start a second.
2. **Write it from this session**, in the format below:
   - The opening paragraph is for the user: what this builds and why, in
     plain words, readable without the session.
   - Decisions are the user's calls, in their words where they chose, each
     with why or what it beat. A guess of yours is an open question, not a
     decision.
   - Each phase is one build session and one PR, ordered so every phase
     leaves `main` working. Lead with what the user can see when it's done.
   - Every artifact URL on its own line, nothing after it.
3. **Ship the plan on its own** with `/ship`, a docs-only PR. Then tell the
   user to merge it and start each build session with `/handoff <topic>`. A
   build branch cut before the plan reaches `main` would stack on an
   unmerged PR.

## Pick up (start of a session)

1. **Read the plan from `origin/main`.** If it's only in an open PR, stop
   and name the PR to merge first.
2. **Find the next phase:** the first unticked one with no open PR. Build
   PRs name their phase in the body (`Hand-off: plans/<topic>.md, phase
   <N>`), so `gh pr list --search "plans/<topic>.md in:body"` shows which
   phases are in flight.
3. **Read before building:** the phase's "Read first", every artifact the
   plan links (Artifact `read`), and "Learned while building". Then do
   CLAUDE.md's `origin/main` and open-PR check for the phase itself.
4. **Say which phase you're building, in one line.** If an open question
   blocks it, ask that now and wait.
5. **Build it.** A decision that turns out wrong goes back to the user; never
   change one silently.
6. **Update the plan in the same PR:** tick the phase as
   `- [x] **<N>. …** — PR #<n>` (push that line once `/ship` has given the
   number), resolve the open questions it answered, and add to "Learned
   while building" whatever the next phase needs to know.
7. **Finish with `/ship`**, with the `Hand-off:` line in the PR body.

## The plan's format

```markdown
# <Topic in plain words>

<A short paragraph for the user: what this builds and why.>

Researched <YYYY-MM-DD>.

## Decisions

- <What the user chose> — <why, or what it beat>

## Prototypes

<Artifact title>
<artifact URL>

## Rejected

- <Idea> — <why not>

## Open questions

- <Question> — blocks phase <N>

## Phases

Each phase is one build session and one PR.

- [ ] **1. <What the user can see when it's done>**
  - Touches: <files, systems>
  - Read first: <headers, docs, records>
  - Done when: <the observable result, and its checks>

## Learned while building

- <YYYY-MM-DD>, phase <N>, PR #<n>: <what the next phase needs to know>
```
