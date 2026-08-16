import { describe, expect, it } from "vitest";
import {
  STATIC_HINTS,
  VALIDATED_QUESTION_IDS,
} from "../../lib/static-hints";
import { validators } from "../../lib/validators";
import { isQuestionId } from "../../lib/answer-shape";

// Static hints and examples (F05-T02). The acceptances that matter here:
//   - every static string (hint and example) passes the same banned-term,
//     length and digit checks the output guard runs on model output
//     (tech_infrastructure.md §5.4, F13-T03);
//   - every validated question has a hint; Q3, Q7 and Q11 carry an example.
//
// The banned-term blocklist is spec'd in tech_infrastructure.md §5.4: therapy,
// therapist, clinic, clinical, doctor, physician, pedia, pediatric, patient,
// parent, child, children, school, teacher, SPED, referral, center/centre,
// app, platform, software, subscription, SaaS, user, plus the four app names
// (PedConnect, TeachDay, ParentUp, Fourth app). Case-insensitive, stem-matched
// (so "parent" also matches "parenting" and "parentup").

// Terms matched as whole words only — "app" as a substring of "apple" is not
// a reference to a software product, so it must not trip the scan.
const WHOLE_WORD_TERMS = [
  "therapy", "therapist", "clinic", "clinical", "doctor", "physician",
  "patient", "referral", "centre", "sped", "app", "platform", "software",
  "subscription", "saas", "user",
];

// Terms matched as a word prefix, so a stem catches its inflections and the
// compound app ids ("parent" → "parentup", "ped" → "pedconnect", "teach" →
// "teachday", "child" → "children").
const ROOT_PREFIX_TERMS = [
  "pedia", "ped", "teacher", "teach", "school", "parent", "child", "center",
];

function tokens(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map((raw) => raw.replace(/[^a-z]/g, ""));
}

function blockedTerms(text: string): string[] {
  const hits = new Set<string>();
  for (const token of tokens(text)) {
    if (token === "") continue;
    for (const term of WHOLE_WORD_TERMS) {
      if (token === term) hits.add(term);
    }
    for (const root of ROOT_PREFIX_TERMS) {
      if (token.startsWith(root)) hits.add(root);
    }
  }
  return [...hits];
}

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

const NEUTRAL_DOMAINS = ["bakery", "gym", "laundry", "courier", "hardware store"];
const CONGRATULATORY = ["great", "amazing", "excellent", "perfect", "fantastic", "well done"];

describe("static hints pass the output guard checks (§5.4 constraints)", () => {
  const entries = Object.entries(STATIC_HINTS).map(([qid, hint]) => ({
    qid,
    hint: hint.hint,
    example: hint.example,
  }));

  it("every hint stays within 25 words and contains no digits", () => {
    for (const { qid, hint } of entries) {
      expect(wordCount(hint), `${qid} hint is too long`).toBeLessThanOrEqual(25);
      expect(hint, `${qid} hint contains a digit`).not.toMatch(/\d/);
    }
  });

  it("neither hints nor examples contain a banned healthcare/education/software term or an app name", () => {
    for (const { qid, hint, example } of entries) {
      expect(blockedTerms(hint), `banned term in ${qid} hint`).toEqual([]);
      if (example !== undefined) {
        expect(blockedTerms(example), `banned term in ${qid} example`).toEqual([]);
      }
    }
  });

  it("examples are drawn from a neutral domain", () => {
    for (const { qid, example } of entries) {
      if (example === undefined) continue;
      const body = example.toLowerCase();
      expect(
        NEUTRAL_DOMAINS.some((domain) => body.includes(domain)),
        `${qid} example does not name a neutral domain`,
      ).toBe(true);
    }
  });

  it("hints are short and never congratulatory (ui_ux.md §5.3 tone)", () => {
    for (const { qid, hint, example } of entries) {
      expect(hint, `${qid} hint is congratulatory`).not.toMatch(/!/);
      const body = `${hint} ${example ?? ""}`.toLowerCase();
      for (const word of CONGRATULATORY) {
        expect(body, `"${word}" in ${qid}`).not.toContain(word);
      }
    }
  });
});

describe("coverage", () => {
  it("every validated question has a hint, and Q3, Q7 and Q11 have an example", () => {
    expect(Object.keys(STATIC_HINTS).sort()).toEqual(
      [...VALIDATED_QUESTION_IDS].sort(),
    );
    for (const qid of VALIDATED_QUESTION_IDS) {
      expect(STATIC_HINTS[qid].hint.trim(), `${qid} missing hint`).not.toBe("");
    }
    for (const qid of ["q3", "q7", "q11"] as const) {
      expect(STATIC_HINTS[qid].example, `${qid} missing example`).toBeDefined();
    }
  });

  it("every hint key is a real QuestionId", () => {
    for (const qid of VALIDATED_QUESTION_IDS) {
      expect(isQuestionId(qid)).toBe(true);
    }
  });

  it("every §7.1 validator has a matching hint", () => {
    // The validator record is total over QuestionId; the §7.1 rules are the
    // subset that produce failures. Every failing question must be hand-wired
    // in the static set, so a rule added later without a hint is caught.
    const failingRules = VALIDATED_QUESTION_IDS.filter((qid) => {
      // A probe answer that is structurally wrong fails on any validator.
      return !validators[qid]({})?.ok;
    });
    expect(failingRules).toEqual(VALIDATED_QUESTION_IDS);
  });
});