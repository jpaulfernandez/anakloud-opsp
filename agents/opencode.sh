#!/usr/bin/env bash
# opencode wrapper for loop.sh. Prompt arrives on stdin.
# Model ids are provider-prefixed; `opencode models` lists them.
# This machine authenticates via OpenCode Zen, so the prefix is `opencode/`.
exec opencode run -m "${LOOP_MODEL:-opencode/claude-opus-5}" "$(cat)"
