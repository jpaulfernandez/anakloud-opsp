#!/usr/bin/env bash
# Qwen Code wrapper for loop.sh. Prompt arrives on stdin.
#
# -p "" is required to select non-interactive mode; qwen appends -p to
# whatever arrives on stdin, so an empty -p sends the piped prompt alone.
# --approval-mode yolo: no human is present to answer a tool prompt.
exec qwen \
  -m "${LOOP_MODEL:-deepseek-v4-flash-0731}" \
  --approval-mode yolo \
  -p ""
