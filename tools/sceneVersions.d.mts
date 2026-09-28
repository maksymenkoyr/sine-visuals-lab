// Types for sceneVersions.mjs (see its header), so vite-scene-versions-plugin.ts
// and vite-build-info-plugin.ts type-check against the plain-JS tool the same
// way appVersionLib.d.mts does for appVersionLib.mjs.

export type SceneChannel = "stable" | "insider" | "preview" | "dev";

export interface SceneVersionsResult {
  /** Unit name (src/render/scenes/sceneMajors.json's own keys) -> version string. */
  byUnit: Record<string, string>;
  /** Registry binding name (e.g. "causticsScene") -> the same version string. */
  byBinding: Record<string, string>;
  /** Stable only: units the release being cut right now changes. */
  changedUnits: string[];
}

export function computeSceneVersions(opts: {
  root: string;
  channel: SceneChannel;
}): Promise<SceneVersionsResult | null>;

export function getCachedSceneVersions(opts: {
  root: string;
  channel: SceneChannel;
}): Promise<SceneVersionsResult | null>;

export function clearSceneVersionsCache(): void;
