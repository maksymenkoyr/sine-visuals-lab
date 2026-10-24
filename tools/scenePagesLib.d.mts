// Type declarations for scenePagesLib.mjs, hand-written because tests/*.ts
// and the vite plugins are typechecked (tsconfig.json) and a .mjs has no
// inferred types of its own. Keep in sync with the JSDoc in scenePagesLib.mjs by hand.

export const SITE: string;
export const DESCRIPTION_MAX: number;
export const NEIGHBOURS: number;
export const FONT_FILE: string;
export const FONT_PATH: string;

export interface SceneMedia {
  still: string;
  loop: string;
  date: string;
}

export interface ScenePage {
  id: string;
  name: string;
  paragraphs: string[];
  media: SceneMedia;
}

export function parseScenePage(markdown: string): { id: string; name: string; paragraphs: string[] } | { error: string } | null;
export function pickMedia(names: string[]): SceneMedia | null;
export function collectScenePages(
  records: { file: string; text: string }[],
  mediaOf: (id: string) => string[],
): { pages: ScenePage[]; errors: string[] };
export function neighboursOf<T>(pages: T[], index: number): T[];
export function renderScenePage(
  page: ScenePage,
  neighbours: { id: string; name: string; media: { still: string } }[],
): string;
export function renderSceneNav(pages: { id: string; name: string }[]): string;
export function renderSitemap(pages: { id: string; media: { date: string } }[]): string;
