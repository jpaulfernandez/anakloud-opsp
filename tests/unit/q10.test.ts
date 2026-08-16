import { describe, expect, it } from "vitest";
import {
  Q10_MODEL_ID_LIST,
  Q10_PAYER_ID_LIST,
  isNotSureModel,
  modelUnitLabel,
  parseQ10Amount,
  q10IsAnswered,
} from "../../lib/q10";
import {
  Q10_MODEL_OPTIONS,
  Q10_NOT_SURE_MODEL,
  Q10_PAYER_OPTIONS,
} from "../../lib/questions";

// Pure Q10 helpers (F03-T10, anakloud-baseline-questions.md Q10). The option
// lists, the model-derived unit label and the "answered" rule are deterministic
// behaviour the shell's forward-navigation depends on, so they are verified
// without a browser — including the acceptances that "not sure yet" passes and
// that the (c) unit label follows the model chosen in (b).

describe("Q10 option lists", () => {
  it("offers exactly the seven payer options, verbatim from the baseline", () => {
    expect([...Q10_PAYER_OPTIONS]).toEqual([
      "center",
      "parent",
      "pediatrician/clinic",
      "school",
      "LGU/DOH",
      "HMO",
      "other",
    ]);
    expect(Q10_PAYER_ID_LIST).toHaveLength(7);
  });

  it("offers exactly the eight model options, including 'not sure yet'", () => {
    expect([...Q10_MODEL_OPTIONS]).toEqual([
      "monthly subscription per center",
      "per-seat/per-therapist",
      "per active child per month",
      "per session fee",
      "freemium with parent upgrade",
      "commission on referrals",
      "grant or institutional funding",
      "not sure yet",
    ]);
    expect(Q10_MODEL_ID_LIST).toHaveLength(8);
  });
});

describe("isNotSureModel", () => {
  it("recognises the 'not sure yet' escape hatch by its exact string", () => {
    expect(isNotSureModel(Q10_NOT_SURE_MODEL)).toBe(true);
    expect(isNotSureModel("not sure yet")).toBe(true);
    expect(isNotSureModel("per session fee")).toBe(false);
  });
});

describe("modelUnitLabel", () => {
  it("derives the amount's unit label from the model chosen in (b)", () => {
    // The acceptance: "Q10(c)'s unit label follows the model chosen in (b)".
    expect(modelUnitLabel("monthly subscription per center")).toBe(
      "per center per month",
    );
    expect(modelUnitLabel("per-seat/per-therapist")).toBe("per seat (a therapist)");
    expect(modelUnitLabel("per active child per month")).toBe(
      "per active child per month",
    );
    expect(modelUnitLabel("per session fee")).toBe("per session");
    expect(modelUnitLabel("freemium with parent upgrade")).toBe("per parent upgrade");
    expect(modelUnitLabel("commission on referrals")).toBe("per referral");
    expect(modelUnitLabel("grant or institutional funding")).toBe("grant amount");
  });

  it("supplies no unit for 'not sure yet', which has no amount to charge", () => {
    expect(modelUnitLabel("not sure yet")).toBe("");
  });
});

describe("parseQ10Amount", () => {
  it("parses a plain peso amount and one with thousands separators", () => {
    expect(parseQ10Amount("2500")).toBe(2500);
    expect(parseQ10Amount("2,500")).toBe(2500);
  });

  it("returns null for a blank or non-numeric amount", () => {
    expect(parseQ10Amount("")).toBeNull();
    expect(parseQ10Amount("   ")).toBeNull();
    expect(parseQ10Amount("pesos")).toBeNull();
  });
});

describe("q10IsAnswered", () => {
  it("is answered once payer and model are set and the amount and month are filled", () => {
    expect(
      q10IsAnswered({
        payer: "center",
        model: "monthly subscription per center",
        amount: "2,500",
        firstPeso: "2026-11",
      }),
    ).toBe(true);
  });

  it("treats 'not sure yet' on the model as a complete, valid answer", () => {
    // The acceptance: "Selecting 'not sure yet' on Q10(b) passes validation".
    // Someone who hasn't settled the model has no amount and no first-peso
    // month to give, so neither is demanded — nothing is invented to pass.
    expect(
      q10IsAnswered({
        payer: "center",
        model: "not sure yet",
        amount: "",
        firstPeso: "",
      }),
    ).toBe(true);
  });

  it("is not answered while the payer or the model is unselected", () => {
    expect(
      q10IsAnswered({
        payer: null,
        model: "not sure yet",
        amount: "",
        firstPeso: "",
      }),
    ).toBe(false);
    expect(
      q10IsAnswered({
        payer: "center",
        model: null,
        amount: "2500",
        firstPeso: "2026-11",
      }),
    ).toBe(false);
  });

  it("is not answered for a concrete model without an amount and month", () => {
    // A real model commits the respondent to a number and a first-peso month;
    // those two are what make "per center per month" a usable economics line.
    expect(
      q10IsAnswered({
        payer: "center",
        model: "per session fee",
        amount: "",
        firstPeso: "",
      }),
    ).toBe(false);
    expect(
      q10IsAnswered({
        payer: "center",
        model: "per session fee",
        amount: "500",
        firstPeso: "",
      }),
    ).toBe(false);
  });
});