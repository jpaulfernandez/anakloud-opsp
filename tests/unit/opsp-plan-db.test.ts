import { describe, expect, it } from "vitest";
import { getPlanPayload, loadPlanCells } from "../../lib/opsp-plan-db";
import { CELL_REGISTRY } from "../../lib/opsp-seed";

describe("Plan Payload & Audience Filtering", () => {
  it("loads all 32 cells with default initial values without a database connection", async () => {
    const cells = await loadPlanCells(null);
    expect(Object.keys(cells).length).toBe(32);

    for (const def of CELL_REGISTRY) {
      expect(cells[def.id]).toBeDefined();
      expect(cells[def.id].cellId).toBe(def.id);
      expect(cells[def.id].content).toBeDefined();
    }
  });

  it("omits facilitator notes in Room mode payload", async () => {
    const payload = await getPlanPayload(null, "room");
    expect(payload.audienceMode).toBe("room");

    for (const def of CELL_REGISTRY) {
      const notes = payload.facilitatorNotes[def.id];
      expect(notes).toBeDefined();
      expect(notes.length).toBe(0);
    }
  });

  it("includes facilitator notes in Facilitator mode payload", async () => {
    const payload = await getPlanPayload(null, "facilitator");
    expect(payload.audienceMode).toBe("facilitator");

    const swt2Notes = payload.facilitatorNotes["SWT-2"];
    expect(swt2Notes).toBeDefined();
    expect(swt2Notes.length).toBeGreaterThan(0);
  });

  it("preserves free-text string numbers and custom notations in metrics cells", async () => {
    const payload = await getPlanPayload(null, "room");
    const t35_2 = payload.cells["T35-2"].content as Record<string, string>;
    expect(t35_2["MRR"]).toBe("₱2,500,000");
  });
});
