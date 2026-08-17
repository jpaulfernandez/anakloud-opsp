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
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 text-base">
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          Admin
        </h1>
        <p
          data-testid="admin-locked"
          className="mt-3 text-base leading-relaxed text-neutral-600"
        >
          Finish your own answers first.{" "}
          <Link href="/" className="font-semibold text-cobalt-600 hover:text-cobalt-700 underline">
            Resume your questionnaire
          </Link>
        </p>
      </div>
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
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6 text-base space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700 mb-1">
            Facilitator
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            Your cohort
          </h1>
        </div>
      </div>

      <LevelStrip data={strip} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CanvasNav />
        <ExportNav />
      </div>

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
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card flex items-center justify-between gap-4">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Build
        </span>
        <h3 className="text-base font-bold text-neutral-900 mt-0.5">
          Official Team Plan
        </h3>
      </div>
      <Link
        href="/admin/official-opsp"
        data-testid="official-opsp-link"
        className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-cobalt hover:bg-cobalt-700 active:scale-[0.98] transition-all"
      >
        Official OPSP canvas &rarr;
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
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card flex items-center justify-between gap-4">
      <div>
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Exports
        </span>
        <h3 className="text-base font-bold text-neutral-900 mt-0.5">
          Session Presentation
        </h3>
      </div>
      <Link
        href="/admin/projection"
        data-testid="projection-link"
        className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 active:scale-[0.98] transition-all"
      >
        Projection sheet &rarr;
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
  not_started: "bg-neutral-100 text-neutral-600 border border-neutral-200",
  in_progress: "bg-amber-50 text-amber-900 border border-amber-200",
  submitted: "bg-emerald-50 text-emerald-900 border border-emerald-200",
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
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
        Compare answers
      </div>
      <ul className="divide-y divide-neutral-100">
        {QUESTION_IDS.map((id) => (
          <li key={id}>
            <Link
              href={`/admin/question/${id}`}
              data-testid="comparison-link"
              className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm text-neutral-800 hover:bg-cobalt-50/50 hover:text-cobalt-900 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 shrink-0 font-mono text-xs font-bold text-cobalt-600">
                  Q{id.replace("q", "")}
                </span>
                <span className="font-medium">{QUESTION_MAP[id].text}</span>
              </div>
              <span className="text-xs text-neutral-400">&rarr;</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RosterTable({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card overflow-hidden">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Team ({roster.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table
          data-testid="roster-table"
          className="w-full border-collapse text-sm text-neutral-700"
        >
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Progress</th>
              <th className="px-3 py-2.5 font-semibold">Last active</th>
              <th className="px-3 py-2.5 font-semibold">Time spent</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row) => (
              <tr
                key={row.respondentId}
                data-testid="roster-row"
                className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors"
              >
                <td className="px-3 py-3 align-top">
                  <div className="font-semibold text-neutral-900">{row.name}</div>
                  {row.isFacilitator && (
                    <div className="inline-block mt-0.5 rounded bg-cobalt-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cobalt-700">
                      Facilitator
                    </div>
                  )}
                  {row.unlock && (
                    <div
                      data-testid="roster-unlock"
                      className="mt-1 text-xs text-amber-700"
                    >
                      Reopened by {row.unlock.byName} ·{" "}
                      {formatDateTime(row.unlock.at)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  <span
                    data-testid="roster-status"
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[row.status]}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td className="px-3 py-3 tabular-nums font-medium text-neutral-900 align-top">
                  {row.progress} / {row.total}
                </td>
                <td className="px-3 py-3 tabular-nums text-xs text-neutral-500 align-top">
                  {row.lastActiveAt ? formatDateTime(row.lastActiveAt) : "—"}
                </td>
                <td className="px-3 py-3 tabular-nums text-xs text-neutral-500 align-top">
                  {formatDuration(row.timeSpentSeconds)}
                </td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-sm text-neutral-500">
                  No one has been invited to this cohort yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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