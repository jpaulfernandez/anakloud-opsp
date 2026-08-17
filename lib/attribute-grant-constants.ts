// F14-T05 — attribute grant constants shared between server and client without
// importing node builtins.

/** The request header the comparison client sends its grant over. Never a URL value. */
export const ATTRIBUTE_GRANT_HEADER = "x-attribute-grant";

/**
 * The grant lifetime in milliseconds. Short on purpose — it only needs to cover
 * the immediate attributed fetch after the confirmation, and a longer TTL would
 * let attributed mode linger across a session (F14-T05 "SHALL NOT persist
 * attributed mode across a page load, a navigation, or a session").
 */
export const ATTRIBUTE_GRANT_TTL_MS = 5 * 60 * 1000;

/** The scope a grant authorises: one facilitator, one cohort, one question. */
export interface AttributeGrantScope {
  respondentId: string;
  cohortId: string;
  qid: string;
}
