// The "How to read this" panel's content (F07-T04, FR-25, ui_ux.md §4.14).
// Pure and static, with no I/O and no network: every word here is authored in
// the repository, never generated at runtime and never fetched, so the guide
// a respondent sees is exactly the text this module ships. One explanation per
// Part B cell (lib/opsp.ts), each covering the three things ui_ux.md §4.14
// asks for — what the cell is for, what a strong one looks like, what a weak
// one looks like — at roughly forty words total. The unit test asserts no cell
// key is missing one, and the view renders this structure verbatim in a
// persistent panel (right column at desktop, bottom sheet on mobile).

import type { OpspCellId } from "./opsp";

/** One cell's static guide entry, split by the three §4.14 questions. */
export interface OpspHowtoEntry {
  /** What the cell is for. */
  purpose: string;
  /** What a strong one looks like. */
  strong: string;
  /** What a weak one looks like. */
  weak: string;
}

/** The authored guide, one entry per Part B cell. No cell key is missing one. */
export const OPSP_HOWTO: Record<OpspCellId, OpspHowtoEntry> = {
  core_values: {
    purpose:
      "The few principles you refuse to trade even when it costs the team money or time.",
    strong: "Names a real boundary and the situation that would test it.",
    weak: "A slogan such as \u201cintegrity\u201d that nobody would ever violate.",
  },
  purpose: {
    purpose:
      "Why the company exists, and which people would be worse off if it quietly vanished.",
    strong: "Names a specific person and a gap only you close.",
    weak: "Generic \u2014 \u201cimprove lives\u201d \u2014 or a feature list instead of an outcome.",
  },
  bhag: {
    purpose:
      "A ten-to-twenty-five-year goal, big enough to stretch belief yet concrete enough to aim at.",
    strong: "A vivid, specific future state you could picture on a good day.",
    weak: "A wish like \u201cbe the best\u201d with no target anyone can test.",
  },
  three_year_targets: {
    purpose:
      "The one or two numbers that, a few years out, prove the BHAG is becoming real.",
    strong: "Names a metric and a number you would defend to a sceptical investor.",
    weak: "Vague momentum like \u201cgrow a lot\u201d with nothing measurable to hold.",
  },
  sandbox_core_customer: {
    purpose:
      "The tight slice of customers you choose to serve first, before anything else tempts you in.",
    strong: "Names who pays, who decides and who benefits.",
    weak: "\u201cEveryone\u201d \u2014 that is not a sandbox, that is a wish.",
  },
  sandbox_boundaries: {
    purpose: "The explicit edges of what you will and will not build right now.",
    strong: "Draws a clean line you can hold against a feature request.",
    weak: "A wishlist of everything, or a boundary so loose it means nothing.",
  },
  brand_promise: {
    purpose: "The single thing a customer can always count on you delivering.",
    strong: "A genuine commitment you can actually keep.",
    weak: "Marketing fluff, or a precise claim the product cannot honour.",
  },
  profit_per_x: {
    purpose:
      "The profit you intend to make per unit of whatever you sell \u2014 per customer, per month, per delivery.",
    strong: "Picks one honest X and a credible number.",
    weak: "Skips the denominator, or guesses a figure you cannot defend.",
  },
  year1_critical_number: {
    purpose: "The single number, a year out, that most needs to be true.",
    strong: "A metric you could count this quarter.",
    weak: "An aspiration like \u201cbe profitable\u201d you cannot actually measure.",
  },
  key_initiatives: {
    purpose: "The handful of biggest bets for the coming year, in order.",
    strong: "Names a few clear initiatives ranked by importance.",
    weak: "An unprioritised laundry list you could never finish.",
  },
  quarterly_theme: {
    purpose:
      "This quarter\u2019s focus in one sentence \u2014 the idea every rock hangs from.",
    strong: "Names a real focus for this exact quarter.",
    weak: "Vague, or it describes the whole year rather than ninety days.",
  },
  quarterly_rocks: {
    purpose:
      "The three to five concrete wins for the quarter, each with a clear done-when.",
    strong: "Finishable in ninety days and measurable by anyone.",
    weak: "A task list with no outcome, or so many rocks none can land.",
  },
  number1_priority: {
    purpose: "The single rock you would drop everything else to finish.",
    strong: "One thing, specific, with a clear done-when.",
    weak: "Hedges between several goals, or mixes two different problems.",
  },
  accountability_face: {
    purpose:
      "Who actually owns what across the company now \u2014 the honest split, not an org chart.",
    strong: "A named person against every function.",
    weak: "Leaves gaps, or assigns everything vaguely to \u201cthe team\u201d.",
  },
  swt_threats: {
    purpose: "The biggest risk that could sink the plan, named honestly.",
    strong: "A specific threat you could plausibly really face.",
    weak: "Generic market risk, or a list so long nothing is prioritised.",
  },
  capacity: {
    purpose: "Your honest weekly hours available to this company.",
    strong: "A real number with the rest of your life accounted for.",
    weak: "An optimistic round figure you will be too tired to sustain.",
  },
};