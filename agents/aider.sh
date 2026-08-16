#!/usr/bin/env bash
# aider wrapper for loop.sh. Prompt arrives on stdin.
# --no-auto-commits: loop.sh owns committing, one commit per ticket.
exec aider \
  --model "${LOOP_MODEL:-anthropic/claude-opus-4-5}" \
  --yes-always \
  --no-auto-commits \
  --message "$(cat)"
