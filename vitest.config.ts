import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Paid scenes keep their tests next to them in the private checkout
    // (src/render/scenes/privateScenes.ts); nothing matches in the public repo.
    include: ["tests/**/*.test.ts", "src/render/scenes/private/**/*.test.ts"],
  },
});
