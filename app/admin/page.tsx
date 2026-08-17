import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { fetchRoster, type RosterEntry } from "@/lib/roster";
import { fetchBudget, fetchGuardTrips, advanceAndPersistBudgetAlerts } from "@/lib/admin-strip";
import {
  fetchCohortLive,
  resolveServedLevel,
  type CohortLifecycleState,
} from "@/lib/cohort-lifecycle";
import { loadConfig } from "@/lib/config";
import { guardTripAlert, type AdminStripData } from "@/lib/level-strip";
import { QUESTION_IDS, QUESTION_MAP } from "@/lib/questions";
import { fetchContaminationAudit, type ContaminationAudit } from "@/lib/contamination";
import LevelStrip from "./LevelStrip";
import CohortLifecycle from "./CohortLifecycle";
import ContaminationSection from "./ContaminationAudit";

// F09-T02 — the admin-locked UI state (ui_ux.md §6 "Admin locked", FR-28).
//
// FR-28 keeps the admin view closed until the facilitator's own answers are
// submitted, enforced in code not by convention. The API gate (F09-T01,
// requireAdminSession) already refuses admin traffic server-side; this page is
// the honest client face of that same rule. Its whole job is to hold the
// facilitator at a rule — "Finish your own answers first." with a way back into
// their questionnaire — and to render none of the dashboard behind that
// message. Because the lock is decided from the DB-resolved session (via the
// pure adminPageView), the page can never show admin content to someone simply
// because their browser asked for the URL.
//
// The single-admission rule is not skippable from the client: an unauthenticated
// visitor is redirected to the claim screen by requirePageSession, a
// non-facilitator goes back to their own questionnaire ("away"), and only a
// submitted facilitator reaches the dashboard (which F09-T03 fills with the
// roster). Nothing here reads a header, body or query value.
//
// F09-T03 — the dashboard carries the roster: name, status, progress, last
// active and time spent (FR-29, ui_ux.md §4.17), plus F06-T05 unlock events
// with actor and timestamp. The roster is fetched server-side through the same
// fetchRoster that backs /api/admin/roster, so the rendered screen and the API
// share one payload shape. Both select no answer content — see lib/roster.ts.

export default async function AdminPage() {
  const db = createDbClient();
  await db.connect();
  try {
    // No valid session → redirect to the claim screen ("/"), never the admin area.
    const session = await requirePageSession(db);

    const view = adminPageView(session);
    if (view === "away") {
      // A respondent is not part of the admin; send them back to their own
      // questionnaire rather than framing them as a locked facilitator.
      redirect("/");
    }
    if (view === "locked") {
      return <AdminLocked />;
    }
    // Only a submitted facilitator reaches the roster fetch, so FR-28 holds:
    // nobody reads their team's answers before their own are locked.
    const roster = await fetchRoster(db, session.respondentId, session.cohortId);
    // F09-T04 — the header strip. The level is the deterministic boot pin,
    // overridable per cohort by the facilitator's level pin (F09-T05); budget,
    // circuit and guard-trip counts come from the row the cohort either does or
    // does not have yet (F12 writes them). Assembled server-side so the strip
    // is honest and never renders to a respondent.
    const { aiLevel } = loadConfig();
    // F09-T05 — the cohort lifecycle control needs the cohort's name, status
    // and current pin, and the strip must reflect a pinned level on the next
    // request (no redeploy). fetchCohortLive reads the live cohorts row, so a
    // pin lands without a server restart.
    const cohort = await fetchCohortLive(db, session.cohortId);
    const servedLevel = resolveServedLevel(aiLevel, cohort?.aiLevelPin ?? null);
    const budget = await fetchBudget(db, session.cohortId);
    const guardTrips = await fetchGuardTrips(db, session.cohortId);
    const strip: AdminStripData = {
      level: servedLevel,
      budget,
      guardTrips,
      // F12-T07 — advance the cohort's budget-warning state so each threshold
      // fires once, and surface the guard-trip alert at 3+ trips (§11).
      budgetAlerts:
        budget === null
          ? []
          : await advanceAndPersistBudgetAlerts(db, session.cohortId, budget),
      guardAlert: guardTripAlert(guardTrips),
    };
    // F13-T06 — the contamination audit, computed deterministically over the
    // interaction log and the divergence scorer. No AI call; a read-only figure
    // for the facilitator once the cohort's answers are in (FR-20).
    const audit = await fetchContaminationAudit(
      db,
      session.respondentId,
      session.cohortId,
    );
    return (
      <AdminDashboard roster={roster} strip={strip} cohort={cohort} audit={audit} />
    );
  } finally {
    await db.end();
  }
}

/**
 * The locked state (FR-28): a rule, not an error. No error styling and no
 * partial admin content — the only thing on the screen is the rule and the
 * way back in to the facilitator's own (unfinished) questionnaire. The resume
 * landing at "/" is the route that maps a returning session onto Continue and
 * the answered list, so the link points there.
 */
function AdminLocked() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Admin
      </h1>
      <p
        data-testid="admin-locked"
        className="mt-3 text-base leading-relaxed text-neutral-600"
      >
        Finish your own answers first.{" "}
        <Link href="/" className="text-neutral-700 underline">
          Resume your questionnaire
        </Link>
      </p>
    </main>
  );
}

/**
 * The dashboard shell a submitted facilitator reaches. The roster is rendered
 * at a tighter density than the questionnaire (ui_ux.md §2: loose where the
 * respondent thinks about one thing, tight where the facilitator scans many):
 * smaller type, closer padding, a thin bordered table instead of the wide-open
 * question layout. No answer content appears anywhere (FR-29).
 */
function AdminDashboard({
  roster,
  strip,
  cohort,
  audit,
}: {
  roster: RosterEntry[];
  strip: AdminStripData;
  cohort: CohortLifecycleState | null;
  audit: ContaminationAudit;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Admin
      </h1>
      <LevelStrip data={strip} />
      <CanvasNav />
      <ExportNav />
      <ComparisonNav />
      <RosterTable roster={roster} />
      <ContaminationSection audit={audit} />
      {cohort !== null ? <CohortLifecycle initial={cohort} /> : null}
    </main>
  );
}

/**
 * The one surface required by F15-T01: the official OPSP canvas the team
 * fills in during or after the alignment session (FR-36). Added as a plain
 * facilitator link alongside the other admin tools; its route and API are
 * gated by the same submitted-facilitator admission as this dashboard.
 */
function CanvasNav() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-neutral-500">
        Build
      </span>
      <Link
        href="/admin/official-opsp"
        data-testid="official-opsp-link"
        className="rounded-md border border-neutral-900 px-2.5 py-1 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Official OPSP canvas
      </Link>
    </div>
  );
}

/**
 * The one export surface required by F10-T06 (FR-34): the projection sheet.
 * Opened at its own gated route, it is unconditionally anonymised, so adding
 * it as a plain link here never reaches an attributed view. It is an export
 * the facilitator runs before or during the session, at the dashboard's tight
 * density.
 */
function ExportNav() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-neutral-500">
        Exports
      </span>
      <Link
        href="/admin/projection"
        data-testid="projection-link"
        className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Projection sheet
      </Link>
    </div>
  );
}

const STATUS_LABEL: Record<RosterEntry["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
};

const STATUS_PILL: Record<RosterEntry["status"], string> = {
  not_started: "bg-neutral-100 text-neutral-600",
  in_progress: "bg-amber-50 text-amber-900",
  submitted: "bg-emerald-50 text-emerald-900",
};

/**
 * One question's comparison link, one per question, in registry order. The
 * per-question comparison screen (F10-T03) is the reason the whole exercise
 * pays off, so it is a first-class entry on the dashboard rather than buried.
 * Rendered at the dashboard's tight density: the question's number and text
 * only, no answer content.
 */
function ComparisonNav() {
  return (
    <div className="mt-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Compare answers
      </div>
      <ul className="mt-1 divide-y divide-neutral-100 border-t border-neutral-200">
        {QUESTION_IDS.map((id) => (
          <li key={id}>
            <Link
              href={`/admin/question/${id}`}
              data-testid="comparison-link"
              className="flex items-baseline gap-2 px-1 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <span className="w-8 shrink-0 font-mono text-xs text-neutral-500">
                Q{id.replace("q", "")}
              </span>
              <span>{QUESTION_MAP[id].text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RosterTable({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        data-testid="roster-table"
        className="w-full border-collapse text-sm text-neutral-700"
      >
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Progress</th>
            <th className="px-3 py-2 font-medium">Last active</th>
            <th className="px-3 py-2 font-medium">Time spent</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((row) => (
            <tr
              key={row.respondentId}
              data-testid="roster-row"
              className="border-b border-neutral-100"
            >
              <td className="px-3 py-2 align-top">
                <div className="font-medium text-neutral-900">{row.name}</div>
                {row.isFacilitator && (
                  <div className="text-xs text-neutral-500">Facilitator</div>
                )}
                {row.unlock && (
                  <div
                    data-testid="roster-unlock"
                    className="mt-0.5 text-xs text-amber-700"
                  >
                    Reopened by {row.unlock.byName} ·{" "}
                    {formatDateTime(row.unlock.at)}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <span
                  data-testid="roster-status"
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums align-top">
                {row.progress} / {row.total}
              </td>
              <td className="px-3 py-2 tabular-nums align-top">
                {row.lastActiveAt ? formatDateTime(row.lastActiveAt) : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums align-top">
                {formatDuration(row.timeSpentSeconds)}
              </td>
            </tr>
          ))}
          {roster.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-2 text-neutral-500">
                No one has been invited to this cohort yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A short, locale-stable date+time, e.g. "17 Aug 2026 · 14:02". */
function formatDateTime(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = MONTHS[date.getMonth()];
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${date.getFullYear()} · ${hh}:${mm}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A compact duration like "1h 05m" or "12m", or a rule for none yet. */
function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}