import { describe, expect, it } from "vitest";
import { buildSummary } from "../src/transactions";

describe("transaction summary", () => {
  it("keeps all received giving in the large total and reports sent amounts separately", () => {
    const result = buildSummary(2026, [
      { direction: "received", product: "ChristianSteps", gross: 745.53 },
      { direction: "sent", product: "ChristianSteps", gross: -95.53 },
      { direction: "received", product: "JoshBeyondBorders", gross: 1_293.05 },
      { direction: "sent", product: "JoshBeyondBorders", gross: -293.05 },
      { direction: "sent", product: "Unassigned", gross: -1_609.78 },
    ]);

    expect(result.products).toEqual({ HopeSojourns: 0, JoshBeyondBorders: 1_293.05, ChristianSteps: 745.53 });
    expect(result.total).toBe(2_038.58);
    expect(result.sentProducts).toEqual({ HopeSojourns: 0, JoshBeyondBorders: 293.05, ChristianSteps: 95.53 });
    expect(result.sentTotal).toBe(388.58);
  });
});
