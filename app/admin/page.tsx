import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { fetchRoster, type RosterEntry } from "@/lib/roster";
import { fetchBudget, fetchGuardTrips } from "@/lib/admin-strip";
import { loadConfig } from "@/lib/config";
import type { AdminStripData } from "@/lib/level-strip";
import LevelStrip from "./LevelStrip";

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
    // F09-T04 — the header strip. The level is the deterministic boot pin;
    // budget, circuit and guard-trip counts come from the row the cohort
    // either does or does not have yet (F12 writes them). Assembled server-side
    // so the strip is honest and never renders to a respondent.
    const { aiLevel } = loadConfig();
    const strip: AdminStripData = {
      level: aiLevel,
      budget: await fetchBudget(db, session.cohortId),
      guardTrips: await fetchGuardTrips(db, session.cohortId),
    };
    return <AdminDashboard roster={roster} strip={strip} />;
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
}: {
  roster: RosterEntry[];
  strip: AdminStripData;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Admin
      </h1>
      <LevelStrip data={strip} />
      <RosterTable roster={roster} />
    </main>
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