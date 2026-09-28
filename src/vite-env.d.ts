/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite-build-info-plugin.ts's `config()` hook (`define`), read
// defensively (not directly) by src/version.ts — see that file's header.
declare const __BUILD_INFO__: import("./version.ts").BuildInfo;
