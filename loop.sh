#!/usr/bin/env bash
# Autonomous build loop. Protocol and rationale: LOOP.md
#
# Takes the next "Not started" ticket from spec/TRACKER.md, hands it to an
# agent, verifies the result, and moves on. Three failed attempts on one
# ticket halts the run and writes BLOCKED.md.
#
# Deliberately not -e: failures are the thing this script exists to handle.
set -uo pipefail

TRACKER="spec/TRACKER.md"
BLOCKED="BLOCKED.md"
LOGDIR=".loop-logs"

AGENT_CMD="${AGENT_CMD:-claude -p}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
MAX_TICKETS="${MAX_TICKETS:-0}"
NO_COMMIT="${NO_COMMIT:-}"

cd "$(dirname "$0")" || exit 1
mkdir -p "$LOGDIR"

if [ ! -f "$TRACKER" ]; then
  echo "loop: $TRACKER not found. Run from the repository root." >&2
  exit 1
fi

log() { printf '\n\033[1m[loop]\033[0m %s\n' "$*"; }

# First tracker row whose status column is "Not started".
# Row shape: | F01-T01 | Title | Status | Notes |
next_ticket() {
  awk -F'|' '
    /^\| *F[0-9]+-T[0-9]+ *\|/ {
      id = $2; status = $4
      gsub(/^[ \t]+|[ \t]+$/, "", id)
      gsub(/^[ \t]+|[ \t]+$/, "", status)
      if (status == "Not started") { print id; exit }
    }' "$TRACKER"
}

ticket_title() {
  awk -F'|' -v want="$1" '
    /^\| *F[0-9]+-T[0-9]+ *\|/ {
      id = $2; title = $3
      gsub(/^[ \t]+|[ \t]+$/, "", id)
      gsub(/^[ \t]+|[ \t]+$/, "", title)
      if (id == want) { print title; exit }
    }' "$TRACKER"
}

set_status() {
  local id="$1" status="$2"
  # Replace the status cell of that ticket's row only.
  awk -F'|' -v OFS='|' -v want="$1" -v new=" $2 " '
    /^\| *F[0-9]+-T[0-9]+ *\|/ {
      id = $2; gsub(/^[ \t]+|[ \t]+$/, "", id)
      if (id == want) $4 = new
    }
    { print }' "$TRACKER" > "$TRACKER.tmp" && mv "$TRACKER.tmp" "$TRACKER"
}

build_prompt() {
  local id="$1" attempt="$2" logfile="$3"
  if [ "$attempt" -eq 1 ]; then
    cat <<EOF
Work ticket $id.

Read AGENTS.md first, then LOOP.md, then find $id in spec/TRACKER.md and open
its feature folder under spec/ for the ticket text and the feature README.
Read whatever source documents in docs/ the ticket's Traces line points at.

Implement the ticket exactly as its EARS requirements state. Every SHALL NOT is
a hard constraint. Write the tests its acceptance criteria describe. Then run
./verify.sh and make it pass.

When it passes, set $id to Done in spec/TRACKER.md and update the Last updated
date and Done count at the top of that file.

Do not work on any other ticket.
EOF
  else
    cat <<EOF
Ticket $id was implemented but ./verify.sh failed. This is attempt $attempt of
$MAX_ATTEMPTS.$([ "$attempt" -eq "$MAX_ATTEMPTS" ] && printf ' This is the last attempt.')

Fix the failure. Do not delete or weaken the failing test, do not loosen an
assertion, and do not mark the ticket Done while verify is failing. If the
ticket's requirement is itself wrong, stop and say so rather than working
around it.

Verify output:

$(tail -n 120 "$logfile" 2>/dev/null)
EOF
  fi
}

write_blocked() {
  local id="$1" title="$2" logfile="$3"
  {
    printf '\n## %s — %s\n\n' "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '**Ticket:** %s\n' "$title"
    printf '**Attempts:** %s\n\n' "$MAX_ATTEMPTS"
    printf '**Last 40 lines of output**\n\n```\n'
    tail -n 40 "$logfile" 2>/dev/null
    printf '\n```\n\n'
    printf '**Full log:** `%s`\n' "$logfile"
  } >> "$BLOCKED"
}

if [ ! -f "$BLOCKED" ]; then
  printf '# Blocked\n\nHalt reasons from autonomous runs. See LOOP.md.\nThe plan of record is spec/TRACKER.md.\n' > "$BLOCKED"
fi

completed=0

while :; do
  ticket="$(next_ticket)"

  if [ -z "$ticket" ]; then
    log "No tickets left at 'Not started'. Done."
    exit 0
  fi

  if [ "$MAX_TICKETS" -gt 0 ] && [ "$completed" -ge "$MAX_TICKETS" ]; then
    log "Reached MAX_TICKETS=$MAX_TICKETS. Stopping. Next up: $ticket"
    exit 0
  fi

  title="$(ticket_title "$ticket")"
  log "$ticket — $title"
  set_status "$ticket" "In progress"

  passed=0
  attempt=1
  logfile=""

  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    logfile="$LOGDIR/${ticket}-attempt-${attempt}.log"
    log "attempt $attempt/$MAX_ATTEMPTS"

    build_prompt "$ticket" "$attempt" "$LOGDIR/${ticket}-verify.log" \
      | $AGENT_CMD 2>&1 | tee "$logfile"

    if ./verify.sh > "$LOGDIR/${ticket}-verify.log" 2>&1; then
      passed=1
      break
    fi

    log "verify failed"
    tail -n 20 "$LOGDIR/${ticket}-verify.log"
    attempt=$((attempt + 1))
  done

  if [ "$passed" -ne 1 ]; then
    log "$ticket failed $MAX_ATTEMPTS attempts. Writing $BLOCKED and stopping."
    set_status "$ticket" "Blocked"
    write_blocked "$ticket" "$title" "$LOGDIR/${ticket}-verify.log"
    exit 1
  fi

  # The agent is asked to mark it Done; enforce it so the tracker can't drift.
  set_status "$ticket" "Done"
  log "$ticket done"

  if [ -z "$NO_COMMIT" ] && git rev-parse --git-dir > /dev/null 2>&1; then
    git add -A
    git commit -q -m "$ticket — $title" && log "committed"
  fi

  completed=$((completed + 1))
done
