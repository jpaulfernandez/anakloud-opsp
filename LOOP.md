# LOOP.md

The autonomous build loop: take the next ticket from the tracker, implement it, verify it, move on. Stop cleanly the moment something can't be fixed.

---

## The rule

```
next ticket from spec/TRACKER.md where status = Not started
  → implement it
  → ./verify.sh
      pass → mark Done, commit, take the next ticket
      fail → fix and re-verify, up to 3 attempts total
               still failing → write BLOCKED.md, mark the ticket Blocked, STOP
```

The loop does not skip a failing ticket and carry on. A failure at F03-T04 usually means F03-T05 is about to fail for the same reason, and a run that limps through fifteen tickets leaving damage behind is worse than one that stops at the first real problem and waits for a human.

---

## Architecture: why bash, and why the model isn't driving

**The loop is a bash script. The model works inside it, not above it.**

The control flow here — find the next ticket, invoke the agent, run verify, count attempts, decide whether to continue or halt — is entirely deterministic. There is no judgement in it. Handing that to a model makes the retry ceiling and the stop condition probabilistic, which is precisely wrong for the part of the system whose whole job is to behave predictably while nobody is watching. A model asked to "try three times" will sometimes try five, sometimes give up at two, and will occasionally decide the failure doesn't count.

So: the script owns the counting and the stopping. The model owns the implementation, which is the part that actually needs judgement.

**Not Python.** Python earns its place when there is real parsing or state to manage. Here the only thing to read out of the tracker is the first row whose status is `Not started` — one `awk` line. Bash gets there with zero dependencies, no venv, and no interpreter version to pin.

**Harness-agnostic by parameter.** The agent is invoked through `$AGENT_CMD`, so the loop runs against Claude Code, opencode, aider, or anything else that accepts a prompt on stdin and can write files. Swapping harnesses is an environment variable, not an edit.

```bash
AGENT_CMD="claude -p" ./loop.sh
```

```bash
AGENT_CMD="opencode run -m anthropic/claude-sonnet-5" ./loop.sh
```

**On model size.** A small model is enough to *run* a loop — but nothing is running the loop except bash, so the question doesn't arise. The model in `$AGENT_CMD` is doing the implementation, and that work is not small: it reads four source documents, reconciles their conflicts, and writes tested code against EARS requirements where the `SHALL NOT` clauses matter as much as the `SHALL` ones. Use a capable model there. The economical split is a capable model inside the loop and no model at all around it.

---

## What the agent does per ticket

The loop hands the agent one ticket ID and nothing else. The agent then:

1. Reads [`AGENTS.md`](AGENTS.md) — the working agreement, the non-negotiables, the code style.
2. Reads the ticket in `spec/F0n-*/tickets.md` and its feature `README.md`.
3. Reads whatever source documents the ticket's **Traces** line points at, in `docs/`.
4. Sets the ticket to `In progress` in `spec/TRACKER.md`.
5. Implements it, following the EARS requirements literally. Every `SHALL NOT` is a hard constraint.
6. Writes the tests the acceptance criteria describe.
7. Runs `./verify.sh`.
8. Sets the ticket to `Done`, updates the **Last updated** date and **Done** count at the top of the tracker.

Ticket order is tracker order: top to bottom, which is feature order, which is the build order from `tech_infrastructure.md` §12. The agent does not reorder, batch, or look ahead.

---

## Retry behaviour

Three attempts per ticket, total — the first pass plus two repairs.

| Attempt | What the agent is told |
|---|---|
| 1 | Implement the ticket |
| 2 | `./verify.sh` failed. Here is the output. Fix it |
| 3 | It failed again. Here is the output. Fix it. This is the last attempt |

Each attempt's full output goes to `.loop-logs/<ticket>-attempt-<n>.log`.

A repair attempt fixes the failure. It does not delete the failing test, loosen an assertion, or mark the ticket done anyway. If the ticket's requirement turns out to be wrong, that is a halt, not a workaround — write it up in `BLOCKED.md` and let a human decide.

---

## Halting

After three failed attempts the loop appends to `BLOCKED.md` and exits non-zero:

```markdown
## F03-T07 — 2026-08-16T14:22:11Z

**Attempts:** 3
**Verify step that failed:** npx playwright test

**Reason**
Keyboard-only completion of the Q8 ranking fails: the up/down controls
are not reachable by tab order after a card moves into the ordered list.

**Last 40 lines of output**
```
…
```

**Suggested next step**
Ticket requires an explicit keyboard alternative to tapping. The current
implementation attaches controls only to pool cards, not to ordered ones.
```

The loop also sets the ticket to `Blocked` in `spec/TRACKER.md` with a pointer to the entry, so the two files agree.

`BLOCKED.md` is the loop's output. `spec/TRACKER.md` remains the plan of record. When a blocker is resolved, clear the `BLOCKED.md` entry and set the ticket back to `Not started`.

---

## Running it

```bash
./loop.sh
```

Options, all environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_CMD` | `claude -p` | The agent invocation |
| `MAX_ATTEMPTS` | `3` | Attempts per ticket before halting |
| `MAX_TICKETS` | `0` | Stop after N tickets; `0` means run until blocked or done |
| `NO_COMMIT` | unset | Set to `1` to skip the per-ticket commit |

Run a single ticket to see how it behaves before letting it run unattended:

```bash
MAX_TICKETS=1 ./loop.sh
```

### Unattended runs need a permission flag

`claude -p` will stop and ask before editing files. For an unattended run you have to grant that up front — with Claude Code that means adding `--permission-mode acceptEdits` (or a broader flag) to `AGENT_CMD`. That is a real decision, not a formality: you are letting a model write to this repository without a human approving each change.

```bash
AGENT_CMD="claude -p --permission-mode acceptEdits" ./loop.sh
```

Decide it deliberately rather than reaching for the widest flag that makes the prompt go away.

---

## Before the first unattended run

**Put this repository under version control.** It currently isn't one:

```bash
git init && git add -A && git commit -m "Plan and specs before first build loop"
```

An autonomous loop writing code with no version control has no undo. The loop commits after each passing ticket precisely so a bad run is `git reset` rather than a forensic exercise — but that only works if there is a repository to reset. If `git` isn't available the loop still runs and simply skips committing.

**Expect the first ticket to be slow.** F01-T01 creates the scaffold that `verify.sh` depends on, including installing Playwright browsers. Until it lands, `./verify.sh` has nothing to run.

**Watch the first two or three tickets.** The loop is only worth leaving alone once you have seen it succeed and seen it halt.
