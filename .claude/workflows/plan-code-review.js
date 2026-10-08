export const meta = {
  name: 'plan-code-review',
  description: 'Per GitHub issue: one model plans, a cheaper one codes, a stronger one reviews; findings loop back for correction rounds',
  whenToUse: 'Run through /plan-code-review. Record every run with tools/workflow-stats.mjs so the stage models can be compared.',
  phases: [
    { title: 'Plan', detail: 'a detailed plan per issue, no edits' },
    { title: 'Code', detail: 'implements the plan on a fresh branch in a fresh worktree' },
    { title: 'Review', detail: 'typecheck, tests, graded review; the reviewer does not fix' },
    { title: 'Correct', detail: 'plan findings go back to the planner, code findings to the coder, then review again' },
    { title: 'Finish', detail: 'only if findings outlive the rounds: the reviewer fixes them itself' },
  ],
}

// One issue goes through plan → code → review in a pipeline, so issues don't
// wait on each other. A review that leaves blocking or should-fix findings
// starts a correction round: findings the plan caused go back to the planner
// for a plan amendment, then the coder fixes everything in the same worktree,
// then the reviewer looks again. After `maxRounds` rounds, any findings still
// open go to a finish step where the reviewer's model fixes them itself, so
// every branch ends shippable and the stats show what the loop couldn't do.
//
// The stage models come from `args.models` and default to `DEFAULT_MODELS`.
// Different models in different runs are the experiment that
// tools/workflow-stats.mjs compares. The recorder reads `WORKFLOW_VERSION`
// from this script, so bump it when a prompt or schema changes enough to make
// old runs a different setup. Agent labels ("review #346 r2") are what the
// recorder parses, so keep their shape.
//
// Launch it from a session that is NOT inside a worktree (EnterWorktree).
// Only the code stage gets its own worktree; every later stage cds into that
// one, and an agent spawned from a worktree-isolated session inherits the
// sandbox and may not write anywhere else. The second trial run lost every
// fix round that way. A fix round that didn't move the branch now stops the
// loop and the run says so, instead of reviewing the same commit again.
//
// args: an array of issue numbers, or
//   { issues: [346, 353], tag: 'r3', maxRounds: 2, models: { code: { model: 'sonnet', effort: 'medium' } } }
// `tag` goes into branch names, so a rerun of the same issue gets a fresh
// branch instead of colliding with an earlier attempt.

const WORKFLOW_VERSION = 4
const DEFAULT_MAX_ROUNDS = 2

const DEFAULT_MODELS = {
  plan: { model: 'sonnet', effort: 'high' },
  code: { model: 'haiku', effort: 'medium' },
  review: { model: 'opus', effort: 'high' },
}

const input = Array.isArray(args) ? { issues: args } : (args || {})
const pick = (stage) => ({ ...DEFAULT_MODELS[stage], ...((input.models || {})[stage] || {}) })
const models = { plan: pick('plan'), code: pick('code'), review: pick('review') }
const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS
const tag = input.tag || `v${WORKFLOW_VERSION}`
const ISSUES = (input.issues || []).map(i => (typeof i === 'number' ? { n: i } : i))
if (!ISSUES.length) throw new Error('plan-code-review: pass issue numbers in args')
log(`v${WORKFLOW_VERSION} · plan ${models.plan.model}/${models.plan.effort} · code ${models.code.model}/${models.code.effort} · review ${models.review.model}/${models.review.effort} · up to ${maxRounds} correction round(s) · tag ${tag}`)

const GRADE = { type: 'string', enum: ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] }

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'short stable id, e.g. F1; keep the same id for the same problem across rounds' },
    severity: { type: 'string', enum: ['blocking', 'should-fix', 'nit'] },
    origin: { type: 'string', enum: ['plan', 'code', 'environment'], description: 'plan = the coder followed a wrong or missing instruction; code = the coder went wrong on its own' },
    kind: { type: 'string', enum: ['bug', 'weak-test', 'missing-test', 'docs', 'style', 'dead-code', 'other'] },
    file: { type: 'string' },
    line: { type: 'number' },
    summary: { type: 'string', description: 'what is wrong and what a correct fix looks like' },
    fixed: { type: 'boolean', description: 'true only if this is a finding from an earlier round that is now resolved' },
  },
  required: ['id', 'severity', 'origin', 'kind', 'file', 'summary', 'fixed'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'the issue title' },
    already_done: { type: 'boolean', description: 'true if origin/main or an open PR already covers this issue' },
    overlap_note: { type: 'string' },
    slug: { type: 'string', description: 'two or three lowercase words joined by dashes, for the branch name' },
    plan: { type: 'string', description: 'detailed step-by-step implementation plan in markdown' },
  },
  required: ['title', 'already_done', 'overlap_note', 'slug', 'plan'],
}

const CODE_SCHEMA = {
  type: 'object',
  properties: {
    worktree_path: { type: 'string', description: 'absolute path of the worktree you worked in (output of pwd)' },
    branch: { type: 'string' },
    base: { type: 'string', description: 'the origin/main sha the branch started from' },
    commit: { type: 'string', description: 'final commit sha' },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    deviations: { type: 'string', description: 'where and why you departed from the plan; empty if none' },
  },
  required: ['worktree_path', 'branch', 'base', 'commit', 'typecheck_passed', 'tests_passed', 'deviations'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issue_resolved: { type: 'boolean' },
    plan_grade: GRADE,
    plan_grade_reason: { type: 'string' },
    code_grade: GRADE,
    code_grade_reason: { type: 'string', description: 'grade of the branch as it stands now' },
    findings: { type: 'array', items: FINDING, description: 'every finding still open, plus earlier-round findings now resolved (fixed: true)' },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    ready_to_ship: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['issue_resolved', 'plan_grade', 'plan_grade_reason', 'code_grade', 'code_grade_reason', 'findings', 'typecheck_passed', 'tests_passed', 'ready_to_ship', 'notes'],
}

const AMEND_SCHEMA = {
  type: 'object',
  properties: {
    amendment: { type: 'string', description: 'the corrected instructions for each plan finding, written for the coder' },
  },
  required: ['amendment'],
}

// `blocked` lets an agent that couldn't reach the worktree say so and still
// return valid output; without it a blocked agent burns its retries on the
// schema and kills the issue's whole pipeline.
const BLOCKED = { type: 'string', description: 'empty, or why you could not work in the worktree at all' }

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'HEAD sha after your commit' },
    addressed: { type: 'array', items: { type: 'string' }, description: 'finding ids you fixed' },
    not_addressed: { type: 'string', description: 'finding ids you could not fix, and why' },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    blocked: BLOCKED,
  },
  required: ['commit', 'addressed', 'not_addressed', 'blocked'],
}

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING, description: 'the findings you were given, each marked fixed or not' },
    issue_resolved: { type: 'boolean' },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    final_commit: { type: 'string' },
    ready_to_ship: { type: 'boolean' },
    notes: { type: 'string' },
    blocked: BLOCKED,
  },
  required: ['findings', 'issue_resolved', 'ready_to_ship', 'notes', 'blocked'],
}

const GIT_RULES = 'Never use git stash (refs/stash is shared with parallel agents), never push, never touch main. '
const INDEPENDENT = 'This is an independent attempt: do not look at other worktrees under .claude/worktrees, other local branches for this issue, or earlier attempts at it. Work only from origin/main and what you are given here. '
const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'
const open = (findings) => findings.filter(f => !f.fixed && f.severity !== 'nit')
// Agents report short or full shas; a prefix only counts at abbreviation length.
const sameSha = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 7 && (a.startsWith(b) || b.startsWith(a))))
const listFindings = (fs) => fs.map(f => `- [${f.id}] ${f.severity}, ${f.origin}, ${f.kind}: ${f.file}${f.line ? `:${f.line}` : ''}: ${f.summary}`).join('\n')

const results = await pipeline(
  ISSUES,
  (issue) => agent(
    `You are planning GitHub issue #${issue.n} in this repo. Do NOT edit any files. ${INDEPENDENT}\n` +
    `1. Read the issue: \`gh issue view ${issue.n}\`.\n` +
    `2. \`git fetch origin\`, then grep origin/main (\`git grep <term> origin/main\`) to see whether it is already done, and skim \`gh pr list\` titles for overlap.\n` +
    `3. Read the code involved on origin/main (\`git show origin/main:<path>\`, since the checkout may be behind) and the file headers CLAUDE.md's table points to for this area.\n` +
    `4. Write a DETAILED plan a smaller model can follow mechanically: exact files, functions, the code shape of each change (snippets welcome), the header comments to update (CLAUDE.md: explain code at the top of its file; don't copy numbers from code into comments), and the verification commands. Call out pitfalls.\n` +
    `5. For every test you ask for, give inputs whose expected value is NOT trivial (not 0, not an empty result, not the test's own counters), and name the break in the code that must make that test fail. A test that still passes with the change reverted is worthless.\n` +
    `6. Mark anything you state as fact about the code that you did not read yourself as UNVERIFIED. The coder will trust everything else.`,
    { label: `plan #${issue.n}`, phase: 'Plan', ...models.plan, schema: PLAN_SCHEMA },
  ),

  (plan, issue) => {
    if (!plan || plan.already_done) { log(`#${issue.n}: skipped (${plan ? plan.overlap_note : 'no plan'})`); return null }
    const branch = `worktree-issue-${issue.n}-${tag}-${plan.slug}`.replace(/[^A-Za-z0-9._/-]/g, '-')
    return agent(
      `Implement GitHub issue #${issue.n} ("${plan.title}") by following this plan. You are in a fresh git worktree. ${GIT_RULES}${INDEPENDENT}\n` +
      `Setup, and check each step before going on:\n` +
      `1. \`pwd\`; remember it. \`git fetch origin\`.\n` +
      `2. \`git checkout -b ${branch} origin/main\`. Then \`git status --porcelain\` must print nothing and \`git rev-parse HEAD\` must equal \`git rev-parse origin/main\`; report that sha as base.\n` +
      `3. If node_modules exists and is a symlink, remove the link. Run \`npm ci\`. The worktree must have its own install.\n` +
      `Then implement, run \`npm run typecheck\` and \`npm test\` (fix failures you caused). For each new test, break the code it guards for a moment and check that the test fails, then restore. Commit with a plain-words message ending with a blank line and:\n${TRAILER}\n\n` +
      `=== PLAN ===\n${plan.plan}`,
      { label: `code #${issue.n}`, phase: 'Code', ...models.code, isolation: 'worktree', schema: CODE_SCHEMA },
    ).then(code => (code ? { plan, code } : null))
  },

  async (prev, issue) => {
    if (!prev) return null
    const { plan, code } = prev
    const where = `The work is on branch ${code.branch} in the worktree ${code.worktree_path}: cd there and run every command there. If you cannot cd there or write there, stop at once and say why in \`blocked\`; never do the work anywhere else. ${GIT_RULES}`
    let amendments = ''
    let history = []
    let review = null
    let head = code.commit
    let stalled = ''
    for (let round = 1; ; round++) {
      review = await agent(
        `Review and test the implementation of GitHub issue #${issue.n} ("${plan.title}"). ${where}\n` +
        `This is review round ${round}. The plan and the code came from different models in an experiment that gets compared across runs, so grade each one honestly and on its own. Do NOT fix anything yourself: your findings go back to the planner and the coder.\n` +
        `1. Read the issue (\`gh issue view ${issue.n}\`) and the diff \`git diff origin/main...HEAD\`.\n` +
        `2. Run \`npm run typecheck\` and \`npm test\`.\n` +
        `3. Review for correctness (does it resolve the issue, edge cases, regressions), test strength (break the guarded code: does each new test fail?), code quality (matches the surrounding idiom and comment density, no dead code) and the CLAUDE.md rules for comments.\n` +
        `4. Give each finding an origin: 'plan' when the coder faithfully followed a wrong or missing instruction, 'code' when the coder went wrong on its own. Write each summary so the coder can fix it without asking.\n` +
        (history.length ? `5. Earlier rounds found these. Re-check each by id: list it with fixed: true if resolved, or again with fixed: false (and a sharper summary) if not. Add new findings with new ids.\n${listFindings(history)}\n` : '') +
        `\n=== PLAN ===\n${plan.plan}${amendments ? `\n\n=== PLAN AMENDMENTS ===\n${amendments}` : ''}`,
        { label: `review #${issue.n} r${round}`, phase: 'Review', ...models.review, schema: REVIEW_SCHEMA },
      )
      if (!review) return null
      history = review.findings
      const todo = open(review.findings)
      if (!todo.length) { log(`#${issue.n}: review round ${round} passed`); break }
      if (round > maxRounds) break
      log(`#${issue.n}: round ${round} left ${todo.length} finding(s); correcting`)

      const planFindings = todo.filter(f => f.origin === 'plan')
      if (planFindings.length) {
        const amend = await agent(
          `You wrote the plan below for GitHub issue #${issue.n}. A reviewer found that the coder followed it faithfully but the plan itself was wrong or incomplete in these places:\n${listFindings(planFindings)}\n\n` +
          `Do NOT edit files. Read origin/main (\`git show origin/main:<path>\`) as needed and write a plan amendment: for each finding, the corrected instruction the coder should follow, with code shapes and test inputs where they help.\n\n=== PLAN ===\n${plan.plan}`,
          { label: `replan #${issue.n} r${round}`, phase: 'Correct', ...models.plan, schema: AMEND_SCHEMA },
        )
        if (amend) amendments += `${amendments ? '\n\n' : ''}Round ${round}:\n${amend.amendment}`
      }

      const fix = await agent(
        `Fix review findings on GitHub issue #${issue.n} ("${plan.title}"). ${where}\n` +
        `Fix every finding below. ${planFindings.length ? 'The ones marked plan follow the plan amendment, which overrides the plan. ' : ''}Then run \`npm run typecheck\` and \`npm test\`, break each test you touched for a moment to check it fails, and commit with a plain-words message ending with a blank line and:\n${TRAILER}\n\n` +
        `=== FINDINGS (round ${round}) ===\n${listFindings(todo)}` +
        (amendments ? `\n\n=== PLAN AMENDMENTS ===\n${amendments}` : '') + `\n\n=== ORIGINAL PLAN ===\n${plan.plan}`,
        { label: `fix #${issue.n} r${round}`, phase: 'Correct', ...models.code, schema: FIX_SCHEMA },
      )
      // A round that didn't move the branch would only re-review the same
      // commit, so stop the loop and say why.
      if (!fix) stalled = `fix round ${round} returned nothing`
      else if (fix.blocked) stalled = `fix round ${round} was blocked: ${fix.blocked}`
      else if (sameSha(fix.commit, head)) stalled = `fix round ${round} made no commit`
      if (stalled) { log(`#${issue.n}: STALLED, ${stalled}`); break }
      head = fix.commit
    }

    let finish = null
    const left = open(review.findings)
    if (left.length && !/blocked/.test(stalled)) {
      log(`#${issue.n}: ${left.length} finding(s) outlived ${maxRounds} round(s); finishing`)
      finish = await agent(
        `Finish GitHub issue #${issue.n} ("${plan.title}"). ${where}\n` +
        `Review rounds with another model ran out with these findings still open. Fix each yourself, run \`npm run typecheck\` and \`npm test\`, and commit with a plain-words message ending with a blank line and:\n${TRAILER}\n` +
        `Return every finding below marked fixed or not.\n\n${listFindings(left)}`,
        { label: `finish #${issue.n}`, phase: 'Finish', ...models.review, schema: FINISH_SCHEMA },
      )
    }
    return { issue: issue.n, title: plan.title, branch: code.branch, worktree: code.worktree_path, base: code.base, stalled, review, finish }
  },
)

return { version: WORKFLOW_VERSION, models, maxRounds, tag, results: results.filter(Boolean) }
