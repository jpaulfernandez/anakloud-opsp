import { randomBytes } from "node:crypto";
import type { ClientBase } from "./db";

// Resume code lifecycle (F02-T03, FR-4, tech_infrastructure.md §9).
//
// A resume code is the passwordless restorer: six characters drawn from an
// alphabet that excludes O/0 and I/1, so a code written on a napkin or read
// over the phone can never be misread. It is generated the first time a
// respondent's answer is saved (getOrCreateResumeCode), shown immediately and
// emailed best-effort if an address is held. Claiming with the code is
// case-insensitive — the alphabet is unambiguous precisely because there is
// no letter/digit pair to confuse, so treating both cases as the same code
// costs no safety. Entry is throttled per IP to five attempts an hour, the
// one brute-force surface the product has; past that the code path refuses
// until the hour rolls out of the window.
//
// Two hard rules governed by this module:
//  - emailing the code never blocks the questionnaire. getOrCreateResumeCode
//    calls emailResumeCode, which catches every failure and reports a boolean.
//    Losing RESEND_API_KEY, Resend being down, a bad address — none of these
//    may stop a first save from succeeding.
//  - no function here writes a resume code to a log sink (grep-tested).

export const RESUME_CODE_LENGTH = 6;

/**
 * 32 symbols — a power of two, so a byte can be indexed without modulo bias.
 * The 26 letters minus I and O, plus the digits 2-9: no ambiguity under any
 * font or in speech.
 */
export const RESUME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const RESUME_MAX_ATTEMPTS = 5;
export const RESUME_WINDOW_MS = 60 * 60 * 1000;

/** A fresh resume code: six uniform picks from the unambiguous alphabet. */
export function generateResumeCode(): string {
  const bytes = randomBytes(RESUME_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    // 32 symbols fit in five bits; the low five bits of any byte index them
    // with no rejection and no bias.
    code += RESUME_ALPHABET[byte & 0x1f];
  }
  return code;
}

/**
 * Case-insensitive form used for storage-independent comparisons and lookups.
 * A typed code is trimmed and uppercased; because the alphabet has no letter
 * and digit that resemble each other, uppercasing is unambiguous.
 */
export function normalizeResumeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * True when the code is either:
 * 1. exactly six symbols from the unambiguous set (standard generated code), or
 * 2. a named hyphenated code (e.g. "HANNAH-4829").
 */
export function isValidResumeCode(raw: string): boolean {
  const normalized = normalizeResumeCode(raw);
  if (normalized.length === RESUME_CODE_LENGTH) {
    for (const ch of normalized) {
      if (!RESUME_ALPHABET.includes(ch)) return false;
    }
    return true;
  }
  // Allow hyphenated custom codes like "HANNAH-4829"
  return /^[A-Z0-9]{2,16}-[A-Z0-9]{2,16}$/.test(normalized);
}

export interface RateLimitDecision {
  reject: boolean;
  /** Only when reject is true: how long until the window no longer holds five. */
  retryAfterMs: number | null;
}

/**
 * Decide whether a new attempt from an IP may proceed, from the attempts it
 * already made inside the rolling hour. The 6th attempt within any 60-minute
 * window is refused; it stays refused until the earliest still-counted attempt
 * ages out, which is the "remainder of the hour".
 */
export function decideResumeAttempt(
  recentAttempts: readonly Date[],
  now: Date,
): RateLimitDecision {
  const windowStart = now.getTime() - RESUME_WINDOW_MS;
  const inWindow = recentAttempts
    .filter((a) => a.getTime() >= windowStart)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length < RESUME_MAX_ATTEMPTS) {
    return { reject: false, retryAfterMs: null };
  }
  const oldest = inWindow[0];
  return {
    reject: true,
    retryAfterMs: oldest.getTime() + RESUME_WINDOW_MS - now.getTime(),
  };
}

/** Every resume-code attempt recorded from an IP within the rolling hour. */
export async function recentResumeAttempts(
  db: ClientBase,
  ip: string,
  now: Date = new Date(),
): Promise<Date[]> {
  const windowStart = new Date(now.getTime() - RESUME_WINDOW_MS);
  const { rows } = await db.query(
    `select attempted_at
       from resume_code_attempts
      where ip = $1 and attempted_at >= $2::timestamptz
      order by attempted_at`,
    [ip, windowStart],
  );
  return (rows as { attempted_at: string }[]).map((r) => new Date(r.attempted_at));
}

/** Record one resume-code claim attempt from an IP. */
export async function recordResumeAttempt(
  db: ClientBase,
  ip: string,
): Promise<void> {
  await db.query(
    "insert into resume_code_attempts (ip, attempted_at) values ($1, now())",
    [ip],
  );
}

/** What a valid resume code resolves to, for issuing a session cookie. */
export interface ResumedRespondent {
  respondentId: string;
  cohortId: string;
  isFacilitator: boolean;
}

/**
 * Resolve a resume code to its respondent, or null. Matching is
 * case-insensitive. Cohort status is deliberately not checked here: a session
 * is admitted regardless and the read-only/accept state is decided at session
 * resolution time (resolveSession in lib/session.ts), so a cohort closing
 * mid-questionnaire never locks a respondent out.
 */
export async function resolveByResumeCode(
  db: ClientBase,
  rawCode: string,
): Promise<ResumedRespondent | null> {
  const code = normalizeResumeCode(rawCode);
  if (!isValidResumeCode(code)) return null;

  const { rows } = await db.query(
    `select r.id as respondent_id, r.cohort_id, r.is_facilitator
       from respondents r
      where upper(r.resume_code) = $1`,
    [code],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    respondentId: row.respondent_id,
    cohortId: row.cohort_id,
    isFacilitator: row.is_facilitator,
  };
}

export interface ResumeCodeOutcome {
  code: string;
  /** True only when the code was generated by this call, i.e. this was the first save. */
  created: boolean;
  /** Whether the code email succeeded. Always false when no address is held. */
  emailed: boolean;
}

/**
 * The first-save hook: return the respondent's existing resume code, or generate
 * and persist a fresh one. When a code is generated for a respondent who holds
 * an email address, the code is emailed best-effort — a failure here must not
 * block the save, so emailResumeCode never throws and its boolean is ignored
 * by the caller rather than treated as load-bearing.
 */
export async function getOrCreateResumeCode(
  db: ClientBase,
  respondentId: string,
): Promise<ResumeCodeOutcome> {
  const { rows } = await db.query(
    "select resume_code, email from respondents where id = $1",
    [respondentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no respondent ${respondentId}`);

  if (row.resume_code && row.resume_code !== "") {
    return { code: row.resume_code, created: false, emailed: false };
  }

  const code = generateResumeCode();
  await db.query(
    "update respondents set resume_code = $1 where id = $2",
    [code, respondentId],
  );

  let emailed = false;
  if (row.email && row.email !== "") {
    const result = await emailResumeCode(code, row.email);
    emailed = result.sent;
  }
  return { code, created: true, emailed };
}

export type ResumeEmailSender = (
  to: string,
  payload: { subject: string; html: string },
) => Promise<boolean>;

/** The verified sender address this deployment emails from. */
const RESEND_FROM = "Align <align@anakloud.ph>";

async function defaultResendSender(
  to: string,
  payload: { subject: string; html: string },
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to, ...payload }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Email a resume code. The sender is injectable so tests can force a failure;
 * absent a key, absent the network, or a throwing sender, this resolves to
 * `{ sent: false }` instead of throwing. That is the whole "email failure does
 * not block the questionnaire" guarantee.
 */
export async function emailResumeCode(
  code: string,
  email: string,
  sender: ResumeEmailSender = defaultResendSender,
): Promise<{ sent: boolean }> {
  try {
    const sent = await sender(email, {
      subject: "Your resume code",
      html: `<p>Your resume code is <strong>${code}</strong>.</p>`,
    });
    return { sent };
  } catch {
    return { sent: false };
  }
}