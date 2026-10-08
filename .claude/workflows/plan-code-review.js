export const meta = {
  name: 'plan-code-review',
  description: 'Per GitHub issue: one model plans, a cheaper one codes in a worktree, a stronger one tests, reviews and fixes',
  whenToUse: 'Run through /plan-code-review. Record every run with tools/workflow-stats.mjs so the stage models can be compared.',
  phases: [
    { title: 'Plan', detail: 'a detailed plan per issue, no edits' },
    { title: 'Code', detail: 'implements the plan on its own branch and worktree' },
    { title: 'Review', detail: 'typecheck, tests, graded review, fixes in a separate commit' },
  ],
}

// One issue goes through plan, then code, then review, in a pipeline, so
// issues don't wait on each other. The models for each stage come from
// `args.models` and default to `DEFAULT_MODELS`. Different models in
// different runs are the experiment that tools/workflow-stats.mjs compares.
// The recorder reads `WORKFLOW_VERSION` from this script, so bump it
// whenever a prompt or schema changes enough to make old runs a different
// setup.
//
// args: an array of issue numbers, or
//   { issues: [346, { n: 353, title: '…' }], models: { code: { model: 'sonnet', effort: 'medium' } } }

const WORKFLOW_VERSION = 2

const DEFAULT_MODELS = {
  plan: { model: 'sonnet', effort: 'high' },
  code: { model: 'haiku', effort: 'medium' },
  review: { model: 'opus', effort: 'high' },
}

const input = Array.isArray(args) ? { issues: args } : (args || {})
const models = {
  plan: { ...DEFAULT_MODELS.plan, ...((input.models || {}).plan || {}) },
  code: { ...DEFAULT_MODELS.code, ...((input.models || {}).code || {}) },
  review: { ...DEFAULT_MODELS.review, ...((input.models || {}).review || {}) },
}
const ISSUES = (input.issues || []).map(i => (typeof i === 'number' ? { n: i } : i))
if (!ISSUES.length) throw new Error('plan-code-review: pass issue numbers in args')
log(`v${WORKFLOW_VERSION} · plan ${models.plan.model}/${models.plan.effort} · code ${models.code.model}/${models.code.effort} · review ${models.review.model}/${models.review.effort}`)

const GRADE = { type: 'string', enum: ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] }

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'the issue title' },
    already_done: { type: 'boolean', description: 'true if origin/main or an open PR already covers this issue' },
    overlap_note: { type: 'string' },
    branch: { type: 'string', description: 'worktree-issue-<n>-<slug>' },
    plan: { type: 'string', description: 'detailed step-by-step implementation plan in markdown' },
  },
  required: ['title', 'already_done', 'overlap_note', 'branch', 'plan'],
}

const CODE_SCHEMA = {
  type: 'object',
  properties: {
    worktree_path: { type: 'string', description: 'absolute path of the worktree you worked in (output of pwd)' },
    branch: { type: 'string' },
    commit: { type: 'string', description: 'final commit sha' },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    deviations: { type: 'string', description: 'where and why you departed from the plan; empty if none' },
  },
  required: ['worktree_path', 'branch', 'commit', 'typecheck_passed', 'tests_passed', 'deviations'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issue_resolved: { type: 'boolean' },
    plan_grade: GRADE,
    plan_grade_reason: { type: 'string' },
    code_grade: GRADE,
    code_grade_reason: { type: 'string', description: 'grade of the code as the coder left it, before your fixes' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'should-fix', 'nit'] },
          origin: { type: 'string', enum: ['plan', 'code', 'environment'], description: 'plan = the coder followed a wrong or missing instruction; code = the coder went wrong on its own' },
          kind: { type: 'string', enum: ['bug', 'weak-test', 'missing-test', 'docs', 'style', 'dead-code', 'other'] },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          fixed: { type: 'boolean' },
        },
        required: ['severity', 'origin', 'kind', 'file', 'summary', 'fixed'],
      },
    },
    typecheck_passed: { type: 'boolean' },
    tests_passed: { type: 'boolean' },
    final_commit: { type: 'string' },
    ready_to_ship: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['issue_resolved', 'plan_grade', 'plan_grade_reason', 'code_grade', 'code_grade_reason', 'findings', 'typecheck_passed', 'tests_passed', 'final_commit', 'ready_to_ship', 'notes'],
}

const GIT_RULES = 'Never use git stash (refs/stash is shared with parallel agents), never push, never touch main. '

const results = await pipeline(
  ISSUES,
  (issue) => agent(
    `You are planning GitHub issue #${issue.n} in this repo. Do NOT edit any files.\n` +
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
    return agent(
      `Implement GitHub issue #${issue.n} ("${plan.title}") by following this plan. You are in a fresh git worktree. ${GIT_RULES}\n` +
      `Setup: run \`pwd\` and remember it. \`git fetch origin && git checkout -b ${plan.branch} origin/main\`, then \`npm ci\` (the worktree needs its own node_modules; don't symlink the main checkout's).\n` +
      `Then implement, run \`npm run typecheck\` and \`npm test\` (fix failures you caused). For each new test, break the code it guards for a moment and check that the test fails, then restore. Commit with a plain-words message ending with a blank line and:\nCo-Authored-By: Claude <noreply@anthropic.com>\n\n` +
      `=== PLAN ===\n${plan.plan}`,
      { label: `code #${issue.n}`, phase: 'Code', ...models.code, isolation: 'worktree', schema: CODE_SCHEMA },
    ).then(code => (code ? { plan, code } : null))
  },
  (prev, issue) => {
    if (!prev) return null
    const { plan, code } = prev
    return agent(
      `Review and test the implementation of GitHub issue #${issue.n} ("${plan.title}"). The work is on branch ${code.branch} in the worktree ${code.worktree_path}: cd there and run every command there. ${GIT_RULES}\n` +
      `The plan and the code came from different models in an experiment that gets compared across runs, so grade each one honestly and on its own.\n` +
      `1. Read the issue (\`gh issue view ${issue.n}\`) and the diff \`git diff origin/main...HEAD\`.\n` +
      `2. Run \`npm run typecheck\` and \`npm test\`.\n` +
      `3. Review for correctness (does it resolve the issue, edge cases, regressions), test strength (break the guarded code: does each new test fail?), code quality (matches the surrounding idiom and comment density, no dead code) and the CLAUDE.md rules for comments.\n` +
      `4. Record every finding as the coder left it, with its origin: 'plan' when the coder faithfully followed a wrong or missing instruction, 'code' when the coder went wrong on its own. Then fix the blocking and should-fix findings yourself in a separate commit ending with:\nCo-Authored-By: Claude <noreply@anthropic.com>\nand mark them fixed. Re-run typecheck and tests after fixing.\n` +
      `The coder reported these deviations from the plan: ${code.deviations || 'none'}\n\n=== PLAN ===\n${plan.plan}`,
      { label: `review #${issue.n}`, phase: 'Review', ...models.review, schema: REVIEW_SCHEMA },
    ).then(review => ({ issue: issue.n, title: plan.title, branch: code.branch, worktree: code.worktree_path, code, review }))
  },
)

return { version: WORKFLOW_VERSION, models, results: results.filter(Boolean) }
