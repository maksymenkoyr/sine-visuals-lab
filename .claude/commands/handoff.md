---
description: Hand work on to whoever builds it next — write it down as GitHub issues for later sessions, pick an issue up and build its next part, or lay out a part for a builder agent
argument-hint: [topic | #issue]
---

One hand-off with two kinds of receiver: a later session, which gets GitHub
issues, and a `builder` agent, which gets one part of the work as its
prompt. Both start knowing only CLAUDE.md and what they're handed, so the
same rules and the same layout serve both.

**Which end:** `/handoff #<n>` picks issue `n` up and builds its next part.
`/handoff [topic]` writes: it turns what this session worked out into
issues, `topic` naming them. `/plan-build` writes one part's layout into
a `builder` agent's prompt, under the same rules.

**Where:** issues on this repo are public. Paid-scene work, and anything the
user says isn't public, goes in issues on the private scenes repo instead
(`gh ... -R <owner/repo>` from `git -C src/render/scenes/private remote
get-url origin`). If it lacks the labels, run `gh label clone
<this owner/repo> -R <private>` once. A public issue never names or links a
private one.

## Rules for the writer

1. **Hand on only what's settled as settled.** The user's calls are
   decisions, in their words where they chose, each with why or what it
   beat. A guess of yours is an open question, never a decision. Work still
   being found out is handed on as a research part, not turned into steps.
2. **Write for a stranger.** Anything the receiver needs is in the issue, or
   named by path. `builder` can't open artifacts or the web, so copy in
   what decides the build; link the artifact too, its URL on its own line.
3. **Every step names the file, the edit and the check** that proves it. A
   step you can't write that way isn't ready: it's an open question, or the
   part is a research part.
4. **Say where things stand:** branch, PR, worktree; what's done and
   checked, what isn't.
5. **Name what to read first** (the headers CLAUDE.md lists, scene records),
   the traps found, and what was rejected so it isn't tried again.
6. **"Done when"** is what the user can see, plus the checks.
7. **One part is one session and one PR**, ordered so each leaves `main`
   working. A `builder` prompt is one part, or a slice of one, and never
   a research part.
8. **Research stays research.** When the user hands on unfinished research,
   write what was found with its evidence, the leads still open and what's
   ruled out; don't close it into a plan or guess the build parts after it.

## Rules for the receiver

1. **Check it against `origin/main` first.** An issue can be weeks old; read
   its comments too.
2. **Do what it says, nothing more.** A step that's wrong or blocked stops
   the work and goes back to the user; a decision is never changed quietly.
3. **Report** what changed, the checks run and their results (not run is
   never passed), and anything skipped or done differently.
4. **Leave it truer:** a session adds what the next part needs to know as a
   comment on the parent issue.

## Write (`/handoff [topic]`)

1. **Start from what's there.** Search open issues for the topic
   (`gh issue list --search "<words>"`) and the topic label; update an
   issue that covers it rather than opening a second.
2. **One part:** one issue. **Several:** a parent issue holding what's
   shared, and one sub-issue per part, in the layouts below.
3. **Labels:** each issue gets its difficulty and `human` as
   `docs/issue-labels.md` says (a hook refuses one without difficulty), a
   part whose steps are written gets `plan`, a research part `research`,
   and a parent with sub-issues
   gets a topic label that all of them share (`gh label create` if new).
4. **Link each part to its parent:**

   ```
   id=$(gh api repos/<owner/repo>/issues/<part> --jq .id)
   gh api -X POST repos/<owner/repo>/issues/<parent>/sub_issues -F sub_issue_id=$id
   ```

5. **Tell the user** the issue URLs, each on its own line, and that a build
   session starts with `/handoff #<parent>`.

## Pick up (`/handoff #<n>`)

1. **Read the issue with its comments** (`gh issue view <n> --comments`).
   A part: read its parent too. A parent: list its parts
   (`gh api repos/<owner/repo>/issues/<n>/sub_issues`) and take the first
   open one in the parent's Order that no PR closes yet (`gh issue view
   <part> --json closedByPullRequestsReferences`).
2. **Read first:** the part's Read first, the artifacts it links (Artifact
   `read`), then CLAUDE.md's `origin/main` and open-PR check for the part.
3. **Say which part you're building, in one line.** If an open question
   blocks it, ask now and wait.
4. **Build it**, yourself or with `/plan-build`, which hands the part to a
   `builder` agent.
5. **A research part** ends when its Done when is answered, or the leads
   run out: post the findings on the issue and bring the user what they
   decide. Write the build parts only from their calls, then close it. Any
   code or tool it leaves goes through `/ship` like a build part.
6. **Finish with `/ship`**, the PR body saying `Closes #<part>`, and the
   parent's on the last part. Then comment on the parent what the next part
   needs to know, and answer any open question the part settled there.

## Layouts

A parent, or a single-part issue (which also carries a part's sections):

```markdown
<A short paragraph for the user: what this builds and why, in plain words.>

## Decisions

- <What the user chose> — <why, or what it beat>

## Rejected

- <Idea> — <why not>

## Open questions

- <Question> — blocks #<part>

## Where things stand

- <Branch, PR, worktree; what's done and checked, what isn't>

## Rules for every part

- <What every part keeps to>

## Order

1. #<part> <what the user can see when it's done>
```

A part (a sub-issue, or a `builder` prompt without the first line):

```markdown
Part of #<parent>.

<What the user can see when it's done.>

## Read first

- `<header, record, doc>`

## Steps

- `<file>`, `<symbol>`: <the edit, close to a diff> — check: <command, or what to look at>

## Do not touch

- <files, systems and behaviours that stay as they are>

## Done when

- <the observable result, and its checks>
```

A research part (a sub-issue, or a single issue):

```markdown
Part of #<parent>.

<The question, and what the answer will let the user decide.>

## Read first

- `<header, record, doc, artifact>`

## Found so far

- <Finding> — <evidence: measurement, command, file, link>

## Ruled out

- <Idea or lead> — <why>

## Leads

- <What to try next, and why it looks promising>

## Done when

- <What answers the question, or the point to stop and report>
```

Leave out a section with nothing in it.
