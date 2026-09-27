import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // A git worktree's node_modules is a symlink to another checkout's real
    // directory (CLAUDE.md's branching workflow) — without this, Vite
    // resolves an asset import (e.g. controlsTheme.ts's `?url` font import)
    // to that real, outside-the-worktree path and then denies serving it as
    // outside the project root. Preserving the symlink keeps the resolved
    // id under this worktree's own node_modules instead.
    preserveSymlinks: true,
  },
  test: {
    environment: "node",
    // Paid scenes keep their tests next to them in the private checkout
    // (src/render/scenes/privateScenes.ts); nothing matches in the public repo.
    include: ["tests/**/*.test.ts", "src/render/scenes/private/**/*.test.ts"],
  },
});
