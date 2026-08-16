#!/usr/bin/env bash
# Claude Code wrapper for loop.sh. Prompt arrives on stdin.
# Tool allowlist lives here because parentheses in --allowedTools
# cannot survive word-splitting through $AGENT_CMD.
exec claude -p \
  --model "${LOOP_MODEL:-opus}" \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Write" "Edit" "Glob" "Grep" "Bash(npm:*)" "Bash(npx:*)" "Bash(./verify.sh)" "Bash(git:*)"
