# Room: who may Play, and Cue and effects on every screen

Today Cue and held effects (Blackout, Strobe, Freeze, Invert) reach only the laptop's pop-out window; a TV in the room never sees them, and any device with a panel can change the room's Main look with Play. This plan makes the room work like one rig: by default only the owner (the laptop that opened the room) can Play to Main and may let other devices play, and Cue and effects go through the room to every screen that shows Main, together, without ever changing Main.

Researched 2026-10-06.

## Decisions

- Only the owner can Play to Main by default; the owner can let any other device play, and take it back — the user: "only host device by default can push to main. also it can grant guest permission to push to main." Before, every device with a panel could change Main.
- Cue and effects are global: they reach every Main screen through the room — the user: "cue and effects are global", after hearing that a room trip would land a steady picture delay (`RENDER_DELAY_MS`) after the press, the delay a TV that follows the laptop already draws with. It beat today's pop-out-only Cue, which the user had earlier judged "would not work good" when it had to rewrite Main.
- Cue and effects ride as their own messages that the room passes on and never stores; Main never changes — accepted ("ok good") over Cue rewriting Main and putting it back, which would flash MAIN CHANGED on every panel and could leave a TV stuck on the preview if the release got lost.
- Pictures of the room draw it as a layer above the devices, not as one more device — the user: "they are not in the same dimension".
- Maps of the room show the devices and what travels (Play, Cue, sound), never a breakdown of control kinds — the user, on a "what skips Play/Cue" overlay: "it's not even needed at all. we don't need specify what exactly device setting we controle or room setting or effects or scene transtition or whatever".

## Prototypes

Room Map (live model: devices, Main, Play right, global Cue, sound)
https://claude.ai/artifact/CvE2UtRHasKHqeN3wxyouT

## Rejected

- Cue as a temporary rewrite of Main — every other panel would read MAIN CHANGED, and a lost release would leave the TV on the preview.
- A "Mark what skips Play/Cue" breakdown sorting controls into device settings, room settings, effects and transitions — not needed; it also made Screen and Ears look like effects.

## Open questions

- Labels in PR #385 are guesses: the Room view row "Play" with "Can play / Can't play", and the bar line "MAIN ≠ YOURS — ASK THE OWNER FOR PLAY" — blocks merging phase 1
- Who may send Cue and effects to the room: the same devices that may Play (the owner plus those it allowed), with everyone else's effects staying on their own window? — blocks phase 2
- Two devices hold CUE at once: does the last one win? — blocks phase 2
- Which screens take a cue: the TV, the pop-out, and any device whose Screen is Main (Own and Off opt out)? Does a panel device on Main show someone else's cue over its own window while they hold it? — blocks phase 2
- Effects held on two devices at once: do they combine on every screen? — blocks phase 3
- Does the sender's own window wait the same picture delay, so every screen flashes together, or flash at once and lead the TV? — blocks phase 3
- "Effects" is a so-so name; "Holds" or "Hits" were offered, nothing chosen — blocks nothing; rename separately

## Phases

Each phase is one build session and one PR.

- [x] **1. A guest has no PLAY until the owner allows it; the Room view has a Play row only the owner can change** — PR #385 (draft: answer the label question, then merge before phase 2)
  - Touches: `server/roomDevices.ts` (`canPlay`, `mayPlay`), `server/roomCore.ts`, `src/net/roomMessages.ts`, `src/net/roomBridge.ts`, `src/ui/outputControls.ts`, `src/ui/roomView.ts`, `tools/room-smoke.mjs`
  - Read first: `server/roomRules.ts` and `src/net/roomMessages.ts` headers
  - Done when: a guest that edits its look reads ASK THE OWNER FOR PLAY with no PLAY; after the owner's Can play its Play changes the laptop; `tools/room-smoke.mjs smoke` passes against `npm run dev:worker`

- [ ] **2. Holding CUE on a device that may Play shows its Preview on the TV and every other Main screen; letting go brings Main back**
  - Touches: `server/roomCore.ts` and `server/roomRules.ts` (a relayed, never-stored cue message, allowed by `mayPlay`), `src/net/roomMessages.ts` (vocabulary), a pure cue state machine next to `src/net/mainPlay.ts` (resent while held, dropped when the resends stop, stamped with the room clock), `src/net/roomBridge.ts` (`canCue` from the Play right, `setCue`), `src/tv.ts` (show the cue over Main), `src/app.ts` (panel devices on Main), `src/ui/outputControls.ts` (state line), tests, `tools/room-smoke.mjs`
  - Read first: `src/net/outputSync.ts` header (`createCueController`), `src/ui/outputKeys.ts`, `src/net/roomBridge.ts`, `src/net/mainPlay.ts`, `server/roomDevices.ts` (`RENDER_DELAY_MS`, `pictureDelayMs`), `src/net/lookSync.ts`
  - Done when: in a live room (laptop, iPad, TV) the laptop's held CUE shows on the TV and the iPad about one picture delay after the press and leaves on release; nobody's bar changes from MAIN = YOURS; cutting the laptop's socket mid-hold brings the TV back to Main; a device without Play is refused; gates and room smoke pass

- [ ] **3. Holding an effect on a device that may Play shows it on every Main screen at the same moment**
  - Touches: `src/render/heldEffects.ts`, the `effects` pattern in `src/net/outputSync.ts`, a relayed effects message in `server/roomCore.ts`, `src/net/roomBridge.ts` (`sendEffects`, a no-op today), `src/tv.ts` (draw effects the way `src/output.ts` does with `compositor.setEffects`), `src/app.ts` (the sender's own window and the picture delay), tests, `tools/room-smoke.mjs`
  - Read first: `src/render/heldEffects.ts` and `src/render/compositor.ts` headers, `docs/architecture.md` (held effects), phase 2's cue state machine
  - Done when: a held Strobe on the laptop flashes the laptop, pop-out, iPad and TV together in a headless capture; a lost release clears on the TV; a device without Play keeps its effects on its own window; gates and room smoke pass

## Learned while building

- 2026-10-06, phase 1, PR #385: the only sender of `lookPatch` is `MainPlay` (its automatic sends are owner-only), so the server check in `applyPatch` is the real gate. `src/tv.ts` draws no held effects yet; only `src/output.ts` does. A live room check: `npm run dev:worker` needs a `dist/` folder, a second Worker needs its own `--inspector-port`, Vite finds the Worker through `VITE_WORKER_URL`, and a copy of main for "before" shots comes from `git archive origin/main` (the worktree guard refuses `git worktree add` elsewhere).
