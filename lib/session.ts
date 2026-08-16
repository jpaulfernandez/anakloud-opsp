import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClientBase } from "pg";

// The session cookie (F02-T02, FR-3, tech_infrastructure.md §4, §9).
//
// The invite link is exchanged once for a session cookie signed with
// SESSION_SECRET; from then on the cookie carries identity and the link is
// dropped from the URL. The core here is pure: createSessionToken signs a
// small payload, parseSessionToken verifies the HMAC and returns null on any
// tampering, and sessionCookieOptions fixes the hard requirements — httpOnly,
// SameSite=Lax — with no Max-Age, because a session must survive for the whole
// life of the cohort (F02-T02's "SHALL NOT expire a session while the cohort
// is open" is exactly "never set a TTL on the cookie").
//
// resolveSession is the one database touch, added here because F02-T02 also
// requires that a cohort closing mid-questionnaire must not lock out a
// respondent: the session is SESSION admitted read-only rather than refused.
// F02-T06 reuses this as the per-request identity/authorisation source.
//
// No function here writes a cookie value or token to a log sink — a unit test
// greps the source and finds none, the same guarantee F02-T01 holds for invite
// tokens.

export const SESSION_COOKIE = "align_session";

export interface SessionPayload {
  respondentId: string;
  cohortId: string;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
}

/** The result of resolving a session cookie against the database. */
export interface ResolvedSession {
  respondentId: string;
  cohortId: string;
  isFacilitator: boolean;
  /**
   * The respondent's submission lock state, read live at resolution time.
   * Non-null means the answers are immutable (PR5) — the value the admin gate
   * keys on later (F09). `submitted_at` is null until submit, and a facilitator
   * unlock does not clear it (tech_infrastructure.md §3).
   */
  submittedAt: Date | null;
  /**
   * True when the respondent's cohort is not open. The session is admitted,
   * never refused — read-only only. Set at resolution time, not claim time, so
   * a cohort that closes after the cookie was issued is reflected correctly.
   */
  readOnly: boolean;
}

/** Lifetime of the cookie attributes that make the session survive the cohort. */
export function sessionCookieOptions(): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/" };
}

function requireSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to sign a session");
  }
  return secret;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Sign a session payload into an opaque cookie value: base64url JSON body plus
 * an HMAC-SHA256 (keyed on SESSION_SECRET) suffix. The payload is readable but
 * unforgeable — the signature is what makes a client-crafted cookie fail.
 */
export function createSessionToken(payload: SessionPayload): string {
  const secret = requireSecret();
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

/**
 * Verify a cookie value and recover its payload, or return null. Null covers a
 * malformed value, a signature mismatch (a forged or tampered cookie), and a
 * well-formed signature over an unreadable payload. No distinction leaks.
 */
export function parseSessionToken(token: string | undefined): SessionPayload | null {
  if (typeof token !== "string" || token === "") return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const theirSig = token.slice(dot + 1);

  const secret = requireSecret();
  if (!safeEqual(theirSig, sign(body, secret))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.respondentId !== "string" || record.respondentId === "") {
    return null;
  }
  if (typeof record.cohortId !== "string" || record.cohortId === "") {
    return null;
  }
  return { respondentId: record.respondentId, cohortId: record.cohortId };
}

/**
 * Resolve a signed session cookie to the respondent's live state. Returns null
 * for an invalid/unknown session. A session whose respondent still exists is
 * always admitted — if the cohort closed, `readOnly` is true rather than the
 * session being refused. Cohort status is read live, so it stays correct even
 * when it changes after the cookie was issued.
 */
export async function resolveSession(
  db: ClientBase,
  token: string | undefined,
): Promise<ResolvedSession | null> {
  const payload = parseSessionToken(token);
  if (!payload) return null;

  const { rows } = await db.query(
    `select r.is_facilitator, r.submitted_at, c.status
       from respondents r
       join cohorts c on c.id = r.cohort_id
      where r.id = $1`,
    [payload.respondentId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    respondentId: payload.respondentId,
    cohortId: payload.cohortId,
    isFacilitator: row.is_facilitator,
    submittedAt: row.submitted_at,
    readOnly: row.status !== "open",
  };
}