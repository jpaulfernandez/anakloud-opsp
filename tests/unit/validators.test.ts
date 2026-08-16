import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validators, type Verdict } from "../../lib/validators";
import { QUESTION_IDS, type QuestionId } from "../../lib/questions";

// Deterministic validators (F05-T01, spec.md §7.1). The acceptances that
// matter here are: pass and fail cases for every §7.1 rule (including the Q11
// vague-verb blocklist and the Q7 conjunction count), a validator that imports
// nothing doing I/O, deterministic repeated runs, and the "not sure yet" Q10
// exemption. The neutral-domain example/hint strings are F05-T02, so none of
// the verdicts here should carry one yet.
//
// Values are the stored §3.1 shapes from lib/questions.ts. Note that answer
// content may mention clinics, centers etc. freely — the neutral-domain rule
// (tech_infrastructure.md §5.2) constrains hints and examples, not what a
// respondent writes or what a validator judges.

const ok = (v: Verdict) => expect(v.ok).toBe(true);
const notOk = (v: Verdict) => expect(v.ok).toBe(false);

function futureMonth(): string {
  return `${new Date().getFullYear() + 2}-01`;
}

describe("Q1 — at least 200 characters", () => {
  it("passes a 200-character answer", () => {
    ok(validators.q1({ text: "a".repeat(200) }));
  });

  it("fails at 199 characters", () => {
    notOk(validators.q1({ text: "a".repeat(199) }));
  });

  it("fails an empty answer", () => {
    notOk(validators.q1({ text: "" }));
  });

  it("fails a non-object value", () => {
    notOk(validators.q1(null));
  });
});

describe("Q3 — metric name, parseable number, unit", () => {
  it("passes a complete triple", () => {
    ok(validators.q3({ metric: "active centers", value: 1500, unit: "centers", why: "" }));
  });

  it("does not judge the why field (the §7.1 rule does not ask for it)", () => {
    ok(validators.q3({ metric: "active centers", value: 1500, unit: "centers", why: "" }));
  });

  it("fails a blank metric name", () => {
    notOk(validators.q3({ metric: "   ", value: 1500, unit: "centers", why: "x" }));
  });

  it("fails a blank unit", () => {
    notOk(validators.q3({ metric: "active centers", value: 1500, unit: "", why: "x" }));
  });

  it("fails a value that is not a finite number", () => {
    notOk(validators.q3({ metric: "active centers", value: "1,500", unit: "centers", why: "x" }));
    notOk(validators.q3({ metric: "active centers", value: NaN, unit: "centers", why: "x" }));
  });
});

describe("Q4 — non-empty, ≤140 chars, single sentence", () => {
  it("passes a single sentence", () => {
    ok(validators.q4({ text: "We become the default platform for the region." }));
  });

  it("does not count a decimal point as a sentence terminator", () => {
    ok(validators.q4({ text: "grow 3.5x by year ten." }));
  });

  it("fails an empty answer", () => {
    notOk(validators.q4({ text: "  " }));
  });

  it("fails more than one sentence", () => {
    notOk(validators.q4({ text: "We reach 10,000 centers. Then we grow to 20,000 today." }));
  });

  it("fails an answer over 140 characters", () => {
    notOk(validators.q4({ text: "w".repeat(141) }));
  });
});

describe("Q6 — reason ≥8 words, non-empty, not a restatement", () => {
  it("passes a substantive reason of at least 8 words", () => {
    ok(
      validators.q6({
        choice: "center",
        why: "the center is the one that pays us every month and keeps the service running",
      }),
    );
  });

  it("fails an empty reason", () => {
    notOk(validators.q6({ choice: "center", why: "" }));
  });

  it("fails a reason under 8 words", () => {
    notOk(validators.q6({ choice: "center", why: "the center pays us" }));
  });

  it("fails a reason that just restates the chosen party", () => {
    notOk(
      validators.q6({
        choice: "center",
        why: "we should all go with the center because that is our side then",
      }),
    );
  });
});

describe("Q7 — non-empty, ≤120 chars, at most one conjunction", () => {
  it("passes one conjunction", () => {
    ok(validators.q7({ text: "we are the only ones who do it faster and cheaper" }));
  });

  it("does not treat 'and' inside a word as a conjunction", () => {
    ok(validators.q7({ text: "we understand the market more deeply than anyone" }));
  });

  it("fails two or more conjunctions (a feature list)", () => {
    notOk(validators.q7({ text: "faster and cheaper and simpler and easier" }));
  });

  it("fails an empty answer", () => {
    notOk(validators.q7({ text: "" }));
  });

  it("fails an answer over 120 characters", () => {
    notOk(validators.q7({ text: "w".repeat(121) }));
  });
});

describe("Q9 — all three fields non-empty, each ≥4 words", () => {
  const valid = {
    items: [
      "we will not build a streaming service",
      "we will not chase enterprise contracts next year",
      "we will not hire sales people before we have a product",
    ],
  };

  it("passes three substantive refusals", () => {
    ok(validators.q9(valid));
  });

  it("fails when one field is too short", () => {
    notOk(validators.q9({ items: ["no", ...valid.items.slice(1)] }));
  });

  it("fails when a field is empty", () => {
    notOk(validators.q9({ items: ["", ...valid.items.slice(1)] }));
  });

  it("fails when the tuple is not length three", () => {
    notOk(validators.q9({ items: valid.items.slice(0, 2) }));
  });
});

describe("Q10 — four parts, future month, 'not sure yet' exempt", () => {
  it("passes a fully specified answer with a future month", () => {
    ok(
      validators.q10({
        payer: "center",
        model: "monthly subscription per center",
        amount: 25000,
        unit: "per center per month",
        first_peso: futureMonth(),
      }),
    );
  });

  it("treats 'not sure yet' as complete even with the date unset", () => {
    ok(
      validators.q10({
        payer: "parent",
        model: "not sure yet",
        amount: 0,
        unit: "",
        first_peso: "",
      }),
    );
  });

  it("treats 'not sure yet' as complete even with a past date", () => {
    ok(
      validators.q10({
        payer: "parent",
        model: "not sure yet",
        amount: 0,
        unit: "",
        first_peso: "2000-01",
      }),
    );
  });

  it("fails a past month", () => {
    notOk(
      validators.q10({
        payer: "center",
        model: "monthly subscription per center",
        amount: 25000,
        unit: "per center per month",
        first_peso: "2000-01",
      }),
    );
  });

  it("fails an empty payer", () => {
    notOk(
      validators.q10({
        payer: "",
        model: "monthly subscription per center",
        amount: 25000,
        unit: "per center per month",
        first_peso: futureMonth(),
      }),
    );
  });

  it("fails an amount that is not a number", () => {
    notOk(
      validators.q10({
        payer: "center",
        model: "monthly subscription per center",
        amount: "25,000",
        unit: "per center per month",
        first_peso: futureMonth(),
      }),
    );
  });
});

describe("Q11 — every done-condition is verifiable", () => {
  const rock = (done_when: string, what = "Launch beta") => ({
    rocks: [{ what, done_when }, { what: "", done_when: "" }, { what: "", done_when: "" }],
    starred: 0 as 0 | 1 | 2,
  });

  it("passes a condition with a number", () => {
    ok(validators.q11(rock("ship to 5 centers by 30 November")));
  });

  it("passes a condition with a date", () => {
    ok(validators.q11(rock("finish before December")));
  });

  it("passes a condition that points at a countable noun", () => {
    ok(validators.q11(rock("sign agreements with three partner clinics")));
  });

  it("fails a sole vague verb from the blocklist", () => {
    notOk(validators.q11(rock("improve")));
  });

  it("fails a pair of vague verbs", () => {
    notOk(validators.q11(rock("improve and enhance")));
  });

  it("fails the 'improve onboarding' shape (no countable noun)", () => {
    notOk(validators.q11(rock("improve onboarding")));
  });

  it("fails the phrase 'level up'", () => {
    notOk(validators.q11(rock("level up")));
  });

  it("fails a started rock with a blank done-condition", () => {
    notOk(validators.q11(rock("", "Launch beta")));
  });

  it("passes when only the untouched optional blocks are empty", () => {
    ok(
      validators.q11({
        rocks: [
          { what: "Ship", done_when: "to 5 centers" },
          { what: "", done_when: "" },
          { what: "", done_when: "" },
        ],
        starred: 0 as 0 | 1 | 2,
      }),
    );
  });
});

describe("Q12 — ≥2 words, ≤40 chars", () => {
  it("passes a short, two-word-plus name", () => {
    ok(validators.q12({ text: "Ship the quarter" }));
  });

  it("fails an empty name", () => {
    notOk(validators.q12({ text: "  " }));
  });

  it("fails a single word", () => {
    notOk(validators.q12({ text: "Launch" }));
  });

  it("fails a name over 40 characters", () => {
    notOk(validators.q12({ text: "shortword ".repeat(5) }));
  });
});

describe("Q14 — ≤3 functions, hours 0–60", () => {
  it("passes within both bounds", () => {
    ok(validators.q14({ wants: ["product", "backend"], others: {}, hours: 20, private_note: "" }));
  });

  it("passes at the upper function bound and the lower hour bound", () => {
    ok(
      validators.q14({
        wants: ["product", "backend", "qa"],
        others: {},
        hours: 0,
        private_note: "",
      }),
    );
  });

  it("passes an empty function set at the upper hour bound", () => {
    ok(validators.q14({ wants: [], others: {}, hours: 60, private_note: "" }));
  });

  it("fails more than three functions", () => {
    notOk(
      validators.q14({
        wants: ["product", "backend", "qa", "design_ux"],
        others: {},
        hours: 20,
        private_note: "",
      }),
    );
  });

  it("fails negative hours", () => {
    notOk(validators.q14({ wants: [], others: {}, hours: -5, private_note: "" }));
  });

  it("fails hours over 60", () => {
    notOk(validators.q14({ wants: [], others: {}, hours: 61, private_note: "" }));
  });
});

describe("non-coached questions always accept (§6.3)", () => {
  it.each(["q2", "q5", "q8", "q13", "q15"] as const)(
    "%s returns ok regardless of input",
    (id) => {
      ok(validators[id]({ any: "garbage", value: 0 }));
      ok(validators[id](null));
    },
  );
});

describe("the validators map", () => {
  it("exposes a validator for every question id", () => {
    for (const id of QUESTION_IDS) {
      expect(typeof validators[id]).toBe("function");
    }
  });

  it("is deterministic across repeated invocations", () => {
    const samples: Record<QuestionId, unknown> = {
      q1: { text: "a".repeat(200) },
      q2: null,
      q3: { metric: "active centers", value: 1500, unit: "centers", why: "" },
      q4: { text: "We become the default platform for the region." },
      q5: null,
      q6: {
        choice: "center",
        why: "the center is the one that pays us every month and keeps the service running",
      },
      q7: { text: "we are the only ones who do it faster and cheaper" },
      q8: null,
      q9: {
        items: [
          "we will not build a streaming service",
          "we will not chase enterprise contracts next year",
          "we will not hire sales people before we have a product",
        ],
      },
      q10: {
        payer: "center",
        model: "monthly subscription per center",
        amount: 25000,
        unit: "per center per month",
        first_peso: futureMonth(),
      },
      q11: { rocks: [{ what: "Ship", done_when: "to 5 centers" }, { what: "", done_when: "" }, { what: "", done_when: "" }], starred: 0 },
      q12: { text: "Ship the quarter" },
      q13: null,
      q14: { wants: ["product", "backend"], others: {}, hours: 20, private_note: "" },
      q15: null,
    };
    for (const id of QUESTION_IDS) {
      const value = samples[id];
      expect(validators[id](value)).toEqual(validators[id](value));
    }
  });
});

describe("lib/validators.ts performs no I/O", () => {
  it("imports only relative modules (nothing built-in or network)", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/validators.ts"), "utf8");
    const specifiers = [
      ...source.matchAll(
        /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g,
      ),
    ]
      .map((m) => (m[1] ?? m[2] ?? m[3]) as string)
      .filter(Boolean);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith("./") || specifier.startsWith("../"),
        `lib/validators.ts must not depend on a non-relative module: ${specifier}`,
      ).toBe(true);
    }
  });
});