# F10 — Comparison & divergence scoring

**Phase:** P1 · **Depends on:** F09 · **Blocks:** F14

## What this is

The workhorse screen, and the reason the whole exercise pays off: all six answers to one question, side by side, with a deterministic verdict on how far apart they are.

The scoring here is **computed without AI** (FR-31). That is what makes acceptance criterion 11 possible — divergence classification runs with the model fully disabled. F14 later layers an AI read *on top of* this, never in place of it.

The anonymised/attributed toggle is a safety feature, not a preference. Anonymised is the default; switching to attributed requires a confirmation, because the failure mode is projecting names onto a wall in front of six people who were promised otherwise (`ui_ux.md` §4.18).

## Scope

- Divergence scoring library: agreement rate, modal answer, spread, aligned/soft split/hard split classification
- `GET /api/admin/question/:qid`
- Comparison screen with responsive equal-height cards
- Anonymised ⇄ attributed toggle with confirmation and per-load re-randomisation
- CSV export with query-level private exclusion
- Projection-ready comparison sheet

## Exit criteria

- Every closed question classifies with the AI disabled
- Anonymised mode cannot be exited without an explicit confirmation
- CSV contains no private rows
- Card order in anonymised mode differs between two loads of the same question

## Risks

- Thresholds for soft vs hard split are configurable with defaults from `tech_infrastructure.md`. Put them in config, not inline constants — the facilitator will want to tune them after seeing real data, on the day.
