// Type declarations for docCheckLib.mjs, hand-written because tests/*.ts is
// typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in docCheckLib.mjs by hand.

export interface Paragraph {
  line: number;
  text: string;
}

export interface CandidateParagraph extends Paragraph {
  names: string[];
}

export interface TypeSafeQuestion {
  type: "noul";
  instructions: { paragraph: string; question: string };
  criteria: { true: string; false: string };
}

export interface TypeSafeRequest {
  model: string;
  state: { file: string; diff: string };
  questions: Record<string, TypeSafeQuestion>;
}

export const MAX_QUESTIONS: number;

export function splitParagraphs(text: string): Paragraph[];

export function touchedNames(path: string, diffText: string): string[];

export function candidateParagraphs(paragraphs: Paragraph[], names: string[]): CandidateParagraph[];

export function buildRequest(
  path: string,
  diffText: string,
  candidates: CandidateParagraph[],
  options?: { maxDiffChars?: number },
): TypeSafeRequest;

export function chunk<T>(array: T[], size: number): T[][];
