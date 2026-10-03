# Plan: <topic>

For a plan handed to a cheap, low-effort model (`/exec-cheap plans/<topic>.md`).
It starts with no context and won't infer anything, so be literal: exact files,
exact symbols, the edit itself. Work that would touch `src/render/scenes/private/`
or a paid scene does not belong in a plan — it must not go through OpenRouter.

## Goal

One or two sentences: what changes and why. Nothing the steps don't deliver.

## Read first

- `<file or header comment the model must read before editing>`

## Do not touch

- `<files, systems and behaviours that stay as they are>`

## Steps

Each step is one commit. Keep each small enough for one short session.

### 1. <verb + object>

- File: `<path>`; symbol: `<function/const>`
- Edit: <the change, close to a diff — old behaviour → new behaviour>
- Check: `npm run typecheck` and `npm run test` pass; <any step-specific check>

### 2. <…>

## Done when

- `npm run typecheck` and `npm run test` pass.
- <observable result; for a visualization change, the before/after screenshots
  AGENTS.md requires — say which scene, which query, where to save them>
