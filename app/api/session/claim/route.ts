import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { resolveInvite } from "@/lib/invites";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

// Session claim (F02-T02, tech_infrastructure.md §4, §9).
//
// POST /api/session/claim — an invite token in, a session cookie out. The
// token is exchanged once for the cookie; resolveInvite collapses "unknown",
// "revoked" and "closed cohort" into null, so the response is a boolean — the
// client cannot tell which failure applied and shows the single neutral screen
// (F02-T01). Only a token on an open cohort receives a cookie; a respondent
// whose cohort later closes is admitted read-only by session *resolution*,
// not by a first claim. The token is read from the request body only and never
// written to a log or a URL.

/**
 * The post-claim destination, free of any token. Name entry / ground rules
 * (F02-T04, F02-T05) replace this with their own first-run destination; the
 * requirement here is only that the URL no longer carries the invite token.
 */
const CLAIM_REDIRECT = "/";

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return claimFailure();
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (token === "") return claimFailure();

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

    return NextResponse.json({ ok: true, redirectTo: CLAIM_REDIRECT });
  } finally {
    await db.end();
  }
}

/** The single, reason-free decline. Same shape for invalid, revoked, closed. */
function claimFailure() {
  return NextResponse.json({ ok: false });
}