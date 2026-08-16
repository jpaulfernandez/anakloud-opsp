import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { ClientBase } from "pg";
import { resolveSession, SESSION_COOKIE } from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

// F02-T06 — session middleware and role resolution.
//
// resolveSession in lib/session.ts is the identity source; this file is the
// gate on top of it, and it is the single authorisation point for every route.
// A protected route asks this module "who is this request?" and nothing else:
// an API handler calls requireApiSession, a page calls requirePageSession. The
// request's identity is read exclusively from the signed httpOnly cookie —
// resolveSession returns null for a missing, forged or tampered cookie (its
// HMAC check is the only signature test). No header, body or query value ever
// reaches the resolution, so is_facilitator, respondentId and cohortId cannot
// be supplied by the client: that is the whole of "SHALL NOT trust any role or
// identity value supplied by the client", enforced by there being nowhere in
// the gate for such a value to enter.
//
// The two failure forms follow the route type, and they live here once so no
// route can pick the wrong one: an API route without a valid session returns
// 401; a page route redirects to the claim screen.

/** Where a page route sends someone with no valid session: the claim screen. */
export const CLAIM_SCREEN = "/";

export type ApiAuth =
  | { ok: true; session: ResolvedSession }
  | { ok: false; response: NextResponse };

/**
 * API-route gate. Resolves the request's session against the database and, when
 * the cookie is absent or fails verification, returns the 401 every protected
 * API route is required to return. The caller returns `auth.response` when
 * `!auth.ok` and otherwise uses `auth.session`; the resolution is never read
 * from the request body, headers or query.
 */
export async function requireApiSession(db: ClientBase): Promise<ApiAuth> {
  const session = await resolveSession(db, await requestToken());
  if (!session) return unauthorized();
  return { ok: true, session };
}

/**
 * Page-route gate. Same resolution, and on a missing or unverifiable session it
 * redirects to the claim screen (CLAIM_SCREEN). `redirect()` throws the
 * Next.js redirect signal, so a page that calls this is guaranteed to continue
 * only for a known, verified respondent and never renders a gated route for an
 * unauthenticated visitor.
 */
export async function requirePageSession(db: ClientBase): Promise<ResolvedSession> {
  const session = await resolveSession(db, await requestToken());
  if (!session) redirect(CLAIM_SCREEN);
  return session;
}

/**
 * The F09-T01 admin gate. `admitsAdmin` is the pure admission decision; it is
 * split out so the gate is unit-testable without a request, the same pattern as
 * the pure functions in lib/validators.ts.
 *
 * The gate admits only a session whose respondent is the cohort's facilitator
 * (`isFacilitator`) AND has submitted (`submittedAt` set). FR-28: the admin
 * view stays locked until the facilitator's own answers are locked, or
 * reading the cohort before writing their own contaminates the baseline.
 *
 * `submittedAt` is resolved live from the respondents row at request time (see
 * resolveSession), so this never depends on client state — there is no
 * environment flag, header, or query parameter that can turn the gate off.
 */
export type AdminAdmission = "unauthenticated" | "forbidden" | "allowed";

export function admitsAdmin(session: ResolvedSession | null): AdminAdmission {
  if (!session) return "unauthenticated";
  if (!session.isFacilitator || session.submittedAt === null) return "forbidden";
  return "allowed";
}

/**
 * Admin-route gate. Every `/api/admin/*` route calls this in place of
 * requireApiSession. An absent/forged session is refused with 401 (via the
 * shared requireApiSession); a valid session that fails the gate is refused
 * with 403. Both are server-side and independent of any client state.
 */
export async function requireAdminSession(db: ClientBase): Promise<ApiAuth> {
  const auth = await requireApiSession(db);
  if (!auth.ok) return auth;
  if (admitsAdmin(auth.session) !== "allowed") {
    return { ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) };
  }
  return auth;
}

/** The signed session cookie value for this request, if one was sent. */
async function requestToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** The single, reason-free 401 for an unauthenticated API call. */
function unauthorized(): ApiAuth {
  return {
    ok: false,
    response: NextResponse.json({ ok: false }, { status: 401 }),
  };
}