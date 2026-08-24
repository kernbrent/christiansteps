import { describe, expect, it } from "vitest";
import { buildSummary, filterSql, filtersFromUrl } from "../src/transactions";

describe("transaction summary", () => {
  it("uses gross payment receipts as donations, counts distinct givers, and excludes PayPal holds", () => {
    const result = buildSummary(2026, [
      { direction: "received", product: "ChristianSteps", eventCode: "T0006", giverKey: "cs@example.com", gross: 650 },
      { direction: "sent", product: "HopeSojourns", eventCode: "T0011", giverKey: null, gross: -635.10 },
      { direction: "received", product: "JoshBeyondBorders", eventCode: "T0006", giverKey: "jbb@example.com", gross: 600 },
      { direction: "received", product: "JoshBeyondBorders", eventCode: "T0006", giverKey: "JBB@example.com", gross: 400 },
      { direction: "sent", product: "JoshBeyondBorders", eventCode: "T0000", giverKey: null, gross: -974.68 },
      { direction: "received", product: "Unassigned", eventCode: "T0000", giverKey: "unassigned@example.com", gross: 50 },
      { direction: "sent", product: "Unassigned", eventCode: "T0000", giverKey: null, gross: -25 },
      { direction: "sent", product: "ChristianSteps", eventCode: "T2101", giverKey: null, gross: -95.53 },
      { direction: "received", product: "ChristianSteps", eventCode: "T2102", giverKey: "held@example.com", gross: 95.53 },
    ]);

    expect(result.products).toEqual({ HopeSojourns: 0, JoshBeyondBorders: 1_000, ChristianSteps: 650 });
    expect(result.total).toBe(1_650);
    expect(result.donationCounts).toEqual({ HopeSojourns: 0, JoshBeyondBorders: 2, ChristianSteps: 1 });
    expect(result.giverCounts).toEqual({ HopeSojourns: 0, JoshBeyondBorders: 1, ChristianSteps: 1 });
    expect(result.donationCount).toBe(3);
    expect(result.giverCount).toBe(2);
    expect(result.sentProducts).toEqual({ HopeSojourns: 635.10, JoshBeyondBorders: 974.68, ChristianSteps: 0 });
    expect(result.sentTotal).toBe(1_634.78);
  });
});

describe("transaction filters", () => {
  it("shows payments by default while keeping holds available for audit", () => {
    const defaultFilter = filterSql(filtersFromUrl(new URL("https://example.com/api/admin/transactions")));
    expect(defaultFilter.sql).toContain("event_code LIKE 'T00%'");

    const holdsFilter = filterSql(filtersFromUrl(new URL("https://example.com/api/admin/transactions?activity=holds")));
    expect(holdsFilter.sql).toContain("event_code IN ('T2101', 'T2102')");

    const allFilter = filterSql(filtersFromUrl(new URL("https://example.com/api/admin/transactions?activity=all")));
    expect(allFilter.sql).not.toContain("event_code");
    expect(() => filtersFromUrl(
      new URL("https://example.com/api/admin/transactions?activity=unknown"),
    )).toThrow(/payments, PayPal holds, or all activity/i);
  });
});
