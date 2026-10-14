import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { autoResolvable, parseDiff3, resolveSegments } from "../tools/fixConflictsLib.mjs";

const diff3 = (before: string, ours: string, base: string, theirs: string, after = "") =>
  `${before}<<<<<<< ours\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> theirs\n${after}`;

describe("resolveSegments", () => {
  it("keeps both sides when both only added lines, upstream first", () => {
    const text = diff3("a\n", "from main\n", "", "from branch\n", "z\n");
    const r = resolveSegments(parseDiff3(text));
    expect(r).toEqual({ text: "a\nfrom main\nfrom branch\nz\n", settled: 1, left: 0 });
  });

  it("keeps one copy when both sides made the same change", () => {
    const r = resolveSegments(parseDiff3(diff3("", "x\n", "w\n", "x\n")));
    expect(r.text).toBe("x\n");
    expect(r.left).toBe(0);
  });

  it("takes the side that changed when the other left the original alone", () => {
    const r = resolveSegments(parseDiff3(diff3("", "w\n", "w\n", "x\n")));
    expect(r.text).toBe("x\n");
  });

  it("leaves a real disagreement as ours/theirs markers", () => {
    const r = resolveSegments(parseDiff3(diff3("a\n", "one\n", "w\n", "two\n", "z\n")));
    expect(r).toEqual({
      text: "a\n<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\nz\n",
      settled: 0,
      left: 1,
    });
  });

  it("settles the easy conflicts of a file and leaves the hard one", () => {
    const text = `${diff3("", "a\n", "", "b\n", "mid\n")}${diff3("", "one\n", "w\n", "two\n")}`;
    const r = resolveSegments(parseDiff3(text));
    expect(r.settled).toBe(1);
    expect(r.left).toBe(1);
    expect(r.text.startsWith("a\nb\nmid\n<<<<<<< ours\n")).toBe(true);
  });

  it("joins an inserted last line that has no newline", () => {
    const conflict = { ours: ["last"], base: [], theirs: ["more\n"] };
    expect(resolveSegments([conflict]).text).toBe("last\nmore\n");
  });

  it("rejects text that stops inside a conflict", () => {
    expect(() => parseDiff3("<<<<<<< ours\nx\n")).toThrow("unterminated");
  });
});

describe("fix-conflicts-auto.mjs in a stopped rebase", () => {
  it("settles list additions without a model and leaves a real disagreement", () => {
    const dir = mkdtempSync(join(tmpdir(), "fc-test-"));
    // Run from a git hook (pre-push), GIT_DIR and friends point at this repo; the temp repo must not inherit them.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":1}\n');
      git("add", ".");
      git("commit", "-q", "-m", "base");
      git("checkout", "-q", "-b", "feature");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n- from feature\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":3}\n');
      git("commit", "-qam", "feature");
      git("checkout", "-q", "main");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n- from main\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 3;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":2}\n');
      git("commit", "-qam", "main");
      git("checkout", "-q", "feature");
      expect(() => git("rebase", "main")).toThrow();

      const out = execFileSync("node", [join(process.cwd(), "tools/fix-conflicts-auto.mjs")], { cwd: dir, env, encoding: "utf8" });
      expect(out).toContain("auto-resolved list.md");
      expect(readFileSync(join(dir, "list.md"), "utf8")).toBe("# list\n- a\n- from main\n- from feature\n");
      // A real disagreement and the lockfile stay for the model, still conflicted.
      expect(git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean).sort()).toEqual(["code.ts", "package-lock.json"]);
      expect(readFileSync(join(dir, "code.ts"), "utf8")).toContain("<<<<<<<");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fix-conflicts-pr.sh", () => {
  // A repo whose PR branch "feature" and main both added a line to list.md, pushed to a bare origin;
  // a fake gh on PATH answers for PR 7.
  const setup = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "fc-pr-test-")));
    const work = join(root, "work");
    const bin = join(root, "bin");
    mkdirSync(work);
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), '#!/bin/sh\ncase "$*" in *headRefName*) echo feature;; *) echo main;; esac\n');
    chmodSync(join(bin, "gh"), 0o755);
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
      PATH: `${bin}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      FIX_CONFLICTS_CD_FILE: join(root, "cd"),
    };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git(root, "init", "-q", "--bare", "-b", "main", "remote.git");
    git(work, "init", "-q", "-b", "main");
    git(work, "remote", "add", "origin", join(root, "remote.git"));
    writeFileSync(join(work, "list.md"), "# list\n- a\n");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "base");
    git(work, "checkout", "-q", "-b", "feature");
    writeFileSync(join(work, "list.md"), "# list\n- a\n- from feature\n");
    git(work, "commit", "-qam", "feature");
    git(work, "push", "-q", "origin", "main", "feature");
    git(work, "checkout", "-q", "main");
    git(work, "branch", "-q", "-D", "feature");
    writeFileSync(join(work, "list.md"), "# list\n- a\n- from main\n");
    git(work, "commit", "-qam", "main");
    git(work, "push", "-q", "origin", "main");
    const run = () =>
      execFileSync("bash", [join(process.cwd(), "tools/fix-conflicts-pr.sh"), "7"], { cwd: work, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const pushed = () => ({
      log: git(root, "--git-dir=remote.git", "log", "--format=%s", "feature").trim().split("\n"),
      list: git(root, "--git-dir=remote.git", "show", "feature:list.md"),
    });
    return { root, work, git, run, pushed };
  };
  const rebased = { log: ["feature", "main", "base"], list: "# list\n- a\n- from main\n- from feature\n" };

  it("makes the PR's worktree, rebases, settles the conflict, continues and pushes", () => {
    const { root, work, run, pushed } = setup();
    try {
      run();
      expect(pushed()).toEqual(rebased);
      expect(readFileSync(join(root, "cd"), "utf8").trim()).toBe(join(work, ".claude/worktrees/feature"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continues and pushes a rebase that stopped with its conflicts already resolved", () => {
    const { root, work, git, run, pushed } = setup();
    const wt = join(work, ".claude/worktrees/feature");
    try {
      git(work, "worktree", "add", "-q", "-b", "feature", wt, "origin/feature");
      expect(() => git(wt, "rebase", "origin/main")).toThrow();
      writeFileSync(join(wt, "list.md"), rebased.list);
      git(wt, "add", "list.md");
      run();
      expect(pushed()).toEqual(rebased);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A pre-push hook, standing in for npm run check, that refuses the first `refusals` pushes.
  const refusePushes = (root: string, work: string, git: (cwd: string, ...args: string[]) => string, refusals: number) => {
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-push"), `#!/bin/sh\nn=$(cat "$0.n" 2>/dev/null || echo 0)\necho $((n + 1)) >"$0.n"\n[ "$n" -ge ${refusals} ]\n`);
    chmodSync(join(hooks, "pre-push"), 0o755);
    git(work, "config", "core.hooksPath", hooks);
  };

  it("tries a refused push once more, as a slow test on a busy machine can pass the second time", () => {
    const { root, work, git, run, pushed } = setup();
    try {
      refusePushes(root, work, git, 1);
      run();
      expect(pushed()).toEqual(rebased);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the rebase and names the command that pushes it when the push is refused twice", () => {
    const { root, work, git, run, pushed } = setup();
    try {
      refusePushes(root, work, git, 2);
      let stderr = "";
      try {
        run();
      } catch (e) {
        stderr = String((e as { stderr?: string }).stderr);
      }
      expect(stderr).toContain("then run: fix-conflicts 7");
      expect(pushed().log).toEqual(["feature", "base"]);
      expect(git(join(work, ".claude/worktrees/feature"), "log", "--format=%s").trim().split("\n")).toEqual(rebased.log);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("autoResolvable", () => {
  it("covers docs, config and code but never the lockfile", () => {
    expect(autoResolvable("docs/status.md")).toBe(true);
    expect(autoResolvable("package.json")).toBe(true);
    expect(autoResolvable("src/render/scenes/index.ts")).toBe(true);
    expect(autoResolvable("package-lock.json")).toBe(false);
    expect(autoResolvable("assets/logo.png")).toBe(false);
  });
});
