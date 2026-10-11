export const meta = {
  name: 'grade-runs',
  description: 'Per GitHub issue: one Opus grader compares every recorded run of it side by side and grades plan, code, review and final code',
  whenToUse: 'Run through /plan-code-review grade, after several runs of the same issues are recorded. Record it with tools/workflow-stats.mjs like any run.',
  phases: [
    { title: 'Grade', detail: 'one grader per issue, every run of it side by side' },
  ],
}

// The independent measurement for /plan-code-review. A run's own review
// grades the plan and the code, but nothing graded the review: a lenient or
// over-picky reviewer looked the same as a good one. Here one fresh agent per
// issue reads every recorded run of that issue at once and grades each run
// on what `SCHEMA`'s run entry asks: the plan, the code the coder handed
// over, the first review (are its findings real, what did it miss), and the
// branch's final code after the reviewer's own fixes.
//
// It reads the runs through `node tools/workflow-stats.mjs materials`, which
// names each run by its run ID only and leaves out the models and the
// reviewer's own grades, so the grader can't tell the setups apart or anchor
// on the reviewer. The report then sets the reviewer's code grade against the
// grader's. Seeing the runs side by side is the point: a bug one run caught
// shows what the others missed. It runs once per issue, not once per run, so
// its cost grows only with how many runs of an issue it reads.
//
// The grader works only from git objects (`git diff`, `git show`): every
// run's commits must still be in this clone, and it checks out nothing. Runs
// on different bases aren't comparable, so `base` picks the bench series
// (tools/plan-code-review-bench.json); without it the grader reads the runs
// made on origin/main.
//
// Its label is "rungrade #<issue>", which tools/workflow-stats.mjs parses.
//
// args: { issues: [346, 353], base: '39cbc28b…' }, or an array of issue numbers

const MODEL = { model: 'opus', effort: 'high' }

const input = Array.isArray(args) ? { issues: args } : (args || {})
const ISSUES = input.issues || []
if (!ISSUES.length) throw new Error('grade-runs: pass issue numbers in args')
const bench = input.base ? ` --bench ${input.base}` : ''
log(`grader ${MODEL.model}/${MODEL.effort} · ${ISSUES.length} issue(s)${input.base ? ` · bench ${input.base.slice(0, 8)}` : ' · runs on origin/main'}`)

const GRADE = { type: 'string', enum: ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'none'] }
const PROBLEM = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocking', 'should-fix', 'nit'] },
    summary: { type: 'string', description: 'what is wrong, with file and line' },
  },
  required: ['severity', 'summary'],
}

const SCHEMA = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      description: 'one entry per run in the materials, by its run ID',
      items: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          plan_grade: { ...GRADE, description: "'none' for a run with no plan" },
          plan_reason: { type: 'string' },
          code_grade: { ...GRADE, description: 'the code commit, as the coder handed it over' },
          code_reason: { type: 'string' },
          review_grade: { ...GRADE, description: "the first review's findings: real, rightly rated, nothing important missed. 'none' for a run with no review" },
          review_reason: { type: 'string' },
          findings_real: { type: 'array', items: { type: 'string' }, description: 'ids of review findings that are real problems' },
          findings_wrong: { type: 'array', items: { type: 'string' }, description: 'ids of review findings that are not real, or are rated far off' },
          missed: { type: 'array', items: PROBLEM, description: 'real problems in the code commit that the review did not raise' },
          final_code_grade: GRADE,
          final_code_reason: { type: 'string' },
          final_open: { type: 'array', items: PROBLEM, description: 'real problems still in the final commit, including any the reviewer\'s own fixes brought in' },
        },
        required: ['run_id', 'plan_grade', 'plan_reason', 'code_grade', 'code_reason', 'review_grade', 'review_reason', 'findings_real', 'findings_wrong', 'missed', 'final_code_grade', 'final_code_reason', 'final_open'],
      },
    },
    ranking: { type: 'array', items: { type: 'string' }, description: 'run IDs, best final code first' },
    notes: { type: 'string' },
  },
  required: ['runs', 'ranking', 'notes'],
}

const results = await parallel(ISSUES.map((n) => () => agent(
  `Grade every recorded attempt at GitHub issue #${n} side by side. Several setups of models each planned, coded and reviewed it on their own; you are the independent measurement that compares them, so grade honestly and on one scale across the runs. Do NOT edit files, check anything out, or commit.\n` +
  `1. Read the issue: \`gh api 'repos/{owner}/{repo}/issues/${n}' --jq '.title, .body'\`. Title and body only: later comments may describe a fix.\n` +
  `2. Run \`node tools/workflow-stats.mjs materials ${n}${bench}\`. It lists each run by run ID with its commits, its plan, the first review's findings, and what the reviewer then fixed itself. Never read the stats store, the report or the workflow journals: they name the models, and you must not know which setup made which run.\n` +
  `3. For each run, read \`git diff <base> <code>\` (what the coder handed over) and \`git diff <code> <final>\` (the reviewer's fixes), and \`git show <commit>:<path>\` for the code around them. A commit missing from this clone: say so in notes and grade only what you can see.\n` +
  `4. Grade each run on the plan (correct, complete, followable, true about the code), the code commit (resolves the issue, edge cases, test strength: would each new test fail with the change reverted, the CLAUDE.md comment rules), the review (each finding real and rightly rated, what it missed in the code commit), and the final commit. Use the other runs as evidence: a problem one run handled shows where another fell short. Give 'none' where a run had no plan or no review.\n` +
  `5. Rank the runs by their final code, best first.`,
  { label: `rungrade #${n}`, phase: 'Grade', ...MODEL, schema: SCHEMA },
)))

return { grader: MODEL, base: input.base || null, results: results.filter(Boolean) }
