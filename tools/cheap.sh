#!/usr/bin/env bash
# Launch Claude Code against a cheap OpenRouter model, leaving the Anthropic
# subscription session untouched. Owns the "how do I run the cheap model"
# knowledge; `.claude/commands/exec-cheap.md` calls it, and you can run it by
# hand (`tools/cheap.sh` for an interactive session, or with normal `claude`
# arguments such as `-p "…"`).
#
# Why a script and not a shell function: a Bash tool call in a Claude session
# doesn't load your ~/.zshrc, so a function would not exist there.
#
# Why its own CLAUDE_CONFIG_DIR: Claude Code prefers a saved Anthropic login
# over ANTHROPIC_* env vars. A separate config dir has no login, so the env
# vars win and the subscription is never used for this model.
#
# Needs OPENROUTER_API_KEY exported. CHEAP_MODEL overrides the model slug
# (default below; an `@preset/<name>` slug works too).

set -euo pipefail

: "${OPENROUTER_API_KEY:?export OPENROUTER_API_KEY first}"
MODEL="${CHEAP_MODEL:-xiaomi/mimo-v2.6-flash}"

# Every model slot maps to the cheap model, so nothing falls back to an
# Anthropic model id (which OpenRouter would bill per token).
export CLAUDE_CONFIG_DIR="${CHEAP_CONFIG_DIR:-$HOME/.claude-cheap}"
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL"

exec claude "$@"
