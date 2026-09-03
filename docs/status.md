# Status

This file is expected to be rewritten wholesale each session — it's a snapshot,
not a history. Keep it short enough to read in one glance. Use `/wrap` to
regenerate it at session close.

## In flight

- **Powder scene** (this session) — branch `worktree-powder-scene`, draft
  PR #77. A GPU powder cloud after the user's UE4 short: MRT RGBA8 ping-pong
  sim, spring + curl turbulence with a lobe warp, coherent heat field for the
  red, stateless cube bursts on big hits. Plan executed by an Opus subagent
  in three passes (Sonnet was rate-limited); typecheck/tests green; verified
  headless on synthetic audio, on the actual track through a fake mic, at
  floor quality, in the gallery, and with the auto/manual probe sign-off.
  Registered as a draft scene. Rough edges: first ~4 s after load, big-hit
  refractory tuned on one 140 BPM track, cubes spray a ring not a plume.
- **Three scenes from the same reference landed in parallel today**: Plume
  (PR #75, `worktree-plume-scene`), Neon Fluid (PR #76, `worktree-neon-fluid`,
  a stable-fluids dye sim — a different look) and Powder (PR #77). Plume and
  Powder both chase the same video; nobody has compared them side by side.
- **Other open drafts**: PR #74 (`worktree-docs-architecture`, diagrams-first
  architecture doc), PR #73 (`worktree-auto-dial-ranking`, tempoLock unstick
  + dial ranking). PR #72 (`docs-business`) and PR #70 (`wrap-status`) are
  marked ready, not draft.
- **Worktrees with no PR**: `agent-ae8a69d86e9c44e97`, `bake-defaults`,
  `docs-index`, `setting-groups`, `tuning-spotlight` (all unlocked, idle);
  `auto-hint-description` is locked but sits exactly at `main` — either a
  session about to start or a stale lock.
- `origin` carries several dozen `worktree-*` branches, most already merged
  in spirit through other PRs; not pruned.

## Open questions

- Plume (#75) vs Powder (#77): keep both as drafts, merge one, or fold the
  stronger parts of each into one scene? Needs a real-music look at both.
- Powder's cube bursts: is the "loud section + strong kick, ~every few
  seconds" rule the right feel on slower or sparser music than the reference
  track?
- Is the locked `auto-hint-description` worktree in use, or a stale lock?

## Next up

- Judge PR #77 on real music in the app (mic), side by side with PR #75, then
  decide the question above.
- Merge or close the ready PRs #72 and #70.
- Review drafts #73, #74, #76.
- Prune the stale remote `worktree-*` branches and release idle worktrees.
