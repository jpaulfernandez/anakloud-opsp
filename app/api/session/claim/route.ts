import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { resolveInvite } from "@/lib/invites";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import {
  decideResumeAttempt,
  isValidResumeCode,
  recentResumeAttempts,
  recordResumeAttempt,
  resolveByResumeCode,
} from "@/lib/resume";
import { claimDestination } from "@/lib/respondent";

// Session claim (F02-T02, F02-T03, tech_infrastructure.md §4, §9).
//
// POST /api/session/claim — an invite token or a resume code in, a session
// cookie out.
//
// Invite token: exchanged once for the cookie; resolveInvite collapses
// "unknown", "revoked" and "closed cohort" into null, so the response is a
// boolean — the client cannot tell which failure applied and shows the single
// neutral screen (F02-T01). Only a token on an open cohort receives a cookie;
// a respondent whose cohort later closes is admitted read-only by session
// *resolution*, not by a first claim.
//
// Resume code: matched case-insensitively and throttled to five attempts per
// IP per hour (F02-T03). The 6th attempt within the hour gets a 429 with no
// session; an unknown code gets the same neutral `{ ok: false }` as an unknown
// token. Every attempt (valid or not) is recorded, so the rate limit can't be
// burned through with well-formed guesses.
//
// The token/code is read from the request body only and never written to a
// log or a URL. The one place a request supplies an identifier from a header
// is the client's own IP (x-forwarded-for), used only to key the rate limit.

/**
 * The post-claim destination is decided per respondent (claimDestination in
 * lib/respondent.ts): a respondent with no display name yet is on their first
 * run and is sent to name entry (/welcome, F02-T04), one who already has a
 * name has their session restored at the home page instead. Either way the
 * returned URL carries no invite token — the requirement here is only that the
 * token stops appearing anywhere after the initial claim exchange.
 */

export async function POST(request: Request) {
  let body: { token?: unknown; resumeCode?: unknown };
  try {
    body = (await request.json()) as { token?: unknown; resumeCode?: unknown };
  } catch {
    return claimFailure();
  }

  const token = typeof body.token === "string" ? body.token : "";
  const resumeCode = typeof body.resumeCode === "string" ? body.resumeCode : "";

  if (resumeCode !== "") return handleResumeClaim(request, resumeCode);
  if (token !== "") return handleInviteClaim(token);
  return claimFailure();
}

/** Exchange a valid invite token for a session cookie (F02-T02). */
async function handleInviteClaim(token: string): Promise<Response> {
  const db = createDbClient();
  await db.connect();
  try {
    const invite = await resolveInvite(db, token);
    if (!invite) return claimFailure();

    const sessionToken = createSessionToken({
      respondentId: invite.respondentId,
      cohortId: invite.cohortId,
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());

    const destination = await claimDestination(db, invite.respondentId);
    return NextResponse.json({ ok: true, redirectTo: destination });
  } finally {
    await db.end();
  }
}

/**
 * Exchange a resume code for a session cookie (F02-T03). Case-insensitive,
 * throttled per IP: a malformed code never counts toward the limit, but every
 * well-formed attempt does — so five guesses burn the hour regardless of what
 * they are. The limit is checked before the code is resolved, and the attempt
 * is recorded even when the code turns out unknown, because the attacker to
 * stop is the one firing well-formed guesses.
 */
async function handleResumeClaim(
  request: Request,
  resumeCode: string,
): Promise<Response> {
  if (!isValidResumeCode(resumeCode)) return claimFailure();
  const ip = requestIp(request);

  const db = createDbClient();
  await db.connect();
  try {
    const recent = await recentResumeAttempts(db, ip);
    const decision = decideResumeAttempt(recent, new Date());
    if (decision.reject) {
      return NextResponse.json(
        {
          ok: false,
          rateLimited: true,
          retryAfterSeconds: Math.ceil((decision.retryAfterMs ?? 0) / 1000),
        },
        { status: 429 },
      );
    }

    await recordResumeAttempt(db, ip);

    const respondent = await resolveByResumeCode(db, resumeCode);
    if (!respondent) return claimFailure();

    const sessionToken = createSessionToken({
      respondentId: respondent.respondentId,
      cohortId: respondent.cohortId,
    });
    const store = await cookies();
    store.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());

    const destination = await claimDestination(db, respondent.respondentId);
    return NextResponse.json({ ok: true, redirectTo: destination });
  } finally {
    await db.end();
  }
}

/**
 * The client's IP, for the resume-code rate limit. Behind a proxy the trusted
 * value is the leftmost x-forwarded-for entry; with none present a fixed key
 * keeps the claim working while grouping every source that omits the header.
 */
function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

/** The single, reason-free decline. Same shape for invalid, revoked, closed. */
function claimFailure() {
  return NextResponse.json({ ok: false });
}