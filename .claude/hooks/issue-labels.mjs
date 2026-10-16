#!/usr/bin/env node
// Claude Code PreToolUse hook on Bash and the GitHub MCP's issue_write (wired
// in .claude/settings.json): a new issue must carry one difficulty label, or
// it is refused (exit 2) with the rules of docs/issue-labels.md.
//   - The hook runs no model: the refusal tells the model that filed the issue
//     to judge both the difficulty and `human` (it takes a read of the task).
//     An issue that passes without `human` gets a reminder of that rule.
//   - For Bash only a command that runs `gh issue create` counts (at the start
//     of a line or after `;`, `&`, `|` or `(`, so a script that merely quotes
//     it passes), and only the command text is read. An issue made on the
//     GitHub site, or by someone else, doesn't pass through here.
//   - The label names and the check live in tools/difficultyLib.mjs, shared
//     with the correction loop (tools/difficulty.mjs).

import { readFileSync } from "node:fs";
import { checkNewIssue } from "../../tools/difficultyLib.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const tool = input.tool_input ?? {};

let labels = null;
if (input.tool_name === "Bash") {
  if (typeof tool.command === "string" && /(^|[\n;&|(]\s*)gh\s+issue\s+create\b/.test(tool.command)) labels = tool.command;
} else if (tool.method === "create") {
  labels = Array.isArray(tool.labels) ? tool.labels : [];
}
if (labels === null) process.exit(0);

const verdict = checkNewIssue(labels);
if (verdict?.refuse) {
  process.stderr.write(verdict.refuse + "\n");
  process.exit(2);
}
if (verdict?.remind) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: verdict.remind } }) + "\n");
}
process.exit(0);
