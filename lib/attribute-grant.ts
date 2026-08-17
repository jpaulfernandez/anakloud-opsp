// F14-T05 — the server-issued grant that gates attributed names (FR-30,
// ui_ux.md §4.18, spec.md §10 criterion 12). Hardening the F10-T02 comparison
// endpoint so attributed mode is unreachable by URL manipulation alone.
//
// Before F14-T05 the GET endpoint served names off a bare `?mode=attributed`
// query value — any facilitator who could read a URL (bookmarking it, typing
// it, or opening a shared link mid-session) could pull the named payload
// without ever passing the F10-T04 confirmation. That confirmation is a
// client-side dialog, so the server could not tell a confirmed request from a
// fabricated one: there was no capability that only the confirmation flow
// produced.
//
// This module is that capability, and it is deliberately server-only. Names are
// served only when the comparison GET carries a short-lived, signed attribute
// grant that the client obtains from a separate POST endpoint *after* the
// facilitator passes the "Show names" confirmation. The grant is:
//
//   - signed with SESSION_SECRET (the same HMAC as the session cookie), so a
//     facilitator or a scripted inspection cannot forge one from the URL;
//   - scoped to the exact { respondentId, cohortId, qid } it was issued for, so
//     a grant for one question or cohort never authorises another;
//   - short-lived (a few minutes), so it cannot persist across a page load, a
//     navigation or a session — which is what "SHALL NOT persist attributed
//     mode" looks like as a capability rather than a preference.
//
// Because the grant rides a request *header* and never lives in the URL, no URL
// manipulation (query, fragment, path) can reach attributed mode. The fail-safe
// is always anonymised: a missing, forged, expired or mismatched grant serves
// no names, and never an error.

import { createHmac, timingSafeEqual } from "crypto";
import {
  ATTRIBUTE_GRANT_HEADER,
  ATTRIBUTE_GRANT_TTL_MS,
  type AttributeGrantScope,
} from "./attribute-grant-constants";

export {
  ATTRIBUTE_GRANT_HEADER,
  ATTRIBUTE_GRANT_TTL_MS,
  type AttributeGrantScope,
};

function requireSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to sign an attribute grant");
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
 * Sign an attribute grant for the given scope and validity window. The payload
 * is readable but unforgeable — the HMAC-SHA256 signature on SESSION_SECRET is
 * what stops a client from minting one by URL manipulation alone.
 */
export function createAttributeGrant(
  scope: AttributeGrantScope,
  now: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...scope, iat: now, exp: now + ATTRIBUTE_GRANT_TTL_MS }),
  ).toString("base64url");
  const sig = sign(body, requireSecret());
  return `${body}.${sig}`;
}

/**
 * Verify a grant against the scope the request expects, at time `now`. True only
 * when the token is well-formed and signed, not expired, and scoped to the exact
 * respondent, cohort and question of the request. Anything else — a forged
 * token, a different secret, an expired grant, a valid grant for the wrong
 * question/cohort/respondent, a malformed value — is false, and a false grant
 * never serves names: the route falls back to anonymised. A missing
 * SESSION_SECRET also verifies false (signing cannot be checked), so names stay
 * off rather than ever leaking into a degraded environment.
 */
export function verifyAttributeGrant(
  token: string | null | undefined,
  scope: AttributeGrantScope,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string" || token === "") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const body = token.slice(0, dot);
  const theirSig = token.slice(dot + 1);

  let secret: string;
  try {
    secret = requireSecret();
  } catch {
    return false;
  }
  if (!safeEqual(theirSig, sign(body, secret))) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object") return false;
  const record = parsed as Record<string, unknown>;
  if (record.respondentId !== scope.respondentId) return false;
  if (record.cohortId !== scope.cohortId) return false;
  if (record.qid !== scope.qid) return false;
  if (typeof record.exp !== "number" || record.exp <= now) return false;
  return true;
}