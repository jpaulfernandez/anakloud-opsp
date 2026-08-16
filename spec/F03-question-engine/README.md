# F03 — Question engine & input types

**Phase:** P1 · **Depends on:** F01, F02 · **Blocks:** F04, F05, F06

## What this is

The questionnaire itself: one shell that renders any question, plus the twelve input types. `tech_infrastructure.md` §12 calls this out as the real work in P1, and names the two hard pieces: the matrix pivot (Q5) and the tap-to-assign ranking (Q8).

The design rule that shapes everything here is **one question, one screen** (`ui_ux.md` D1). Someone who can see all fifteen questions at once will compose a coherent narrative across them, and a coherent narrative is precisely what a baseline must not contain.

## Scope

- Question shell: progress dots, section label, question text, helper text, input slot, coach slot, confidence slot, save slot, navigation
- All twelve input types from FR-10
- Confidence sliders on the six marked questions
- Accessibility conformance across all of it

## Exit criteria

- All fifteen questions render and accept input at 360px width
- Q8 ranking is completable with one thumb and with a keyboard alone
- Q5 completes as four short column-major screens on mobile, and the pivot is offered as a toggle on desktop too
- No open-text field has placeholder text
- Q14(d) renders with its lock treatment and its own copy

## Risks

- **Q8 is the mobile risk.** Drag-and-drop on touch is fragile and no drag library is permitted. Tap-to-assign is the specified solution; build it that way rather than reaching for a library.
- **Anchoring creeps in through UI details.** Placeholder text, dropdown units, a default hours value of 40, a fixed card order in Q8 — each of these is a small anchor that quietly manufactures the consensus the exercise exists to detect. Each is explicitly forbidden below.
- Q8 content is blocked on the fourth app's name (plan blocker 2).
