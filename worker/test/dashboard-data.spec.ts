import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type DashboardData = { summarize: (data: Record<string, unknown>, year: number) => Record<string, number> };
const windowObject: { CSMDashboardData?: DashboardData } = {};
runInNewContext(readFileSync(resolve(process.cwd(), "../admin/dashboard-data.js"), "utf8"), { window: windowObject });
const summarize = windowObject.CSMDashboardData!.summarize;

describe("CSM command-center accounting", () => {
  it("separates CSM and HS receipts from JBB pass-through funds", () => {
    const data = {
      paypal_activity: [
        { status: "COMPLETED", transaction_date: "2026-09-20", program: "ChristianSteps", accounting_class: "contribution", gross: 100, fee: -3 },
        { status: "COMPLETED", transaction_date: "2026-09-20", program: "HopeSojourns", accounting_class: "contribution", gross: 200, fee: -6 },
        { status: "COMPLETED", transaction_date: "2025-12-20", program: "JoshBeyondBorders", accounting_class: "agency_receipt", net: 90 },
        { status: "COMPLETED", transaction_date: "2026-09-20", program: "JoshBeyondBorders", accounting_class: "agency_disbursement", net: -30 },
        { status: "COMPLETED", transaction_date: "2026-09-20", program: "HopeSojourns", accounting_class: "internal_transfer", net: -50 },
        { status: "PENDING", transaction_date: "2026-09-20", program: "ChristianSteps", accounting_class: "contribution", gross: 500, fee: 0 },
      ],
      income: [
        { id: "c", program: "ChristianSteps", record_status: "included", payment_status: "paid" },
        { id: "h", program: "HopeSojourns", record_status: "included", payment_status: "paid" },
        { id: "s", program: "Shared", record_status: "included", payment_status: "paid" },
        { id: "j", program: "JoshBeyondBorders", record_status: "included", payment_status: "paid" },
        { id: "v", program: "ChristianSteps", record_status: "included", payment_status: "void" },
      ],
      income_payments: [
        { income_id: "c", payment_date: "2026-09-21", amount: 75 },
        { income_id: "h", payment_date: "2026-09-21", amount: 25 },
        { income_id: "s", payment_date: "2026-09-21", amount: 10 },
        { income_id: "j", payment_date: "2026-09-21", amount: 500 },
        { income_id: "v", payment_date: "2026-09-21", amount: 200 },
      ],
      expenses: [
        { tax_year: 2026, program: "ChristianSteps", record_status: "included", amount: 40 },
        { tax_year: 2026, program: "HopeSojourns", record_status: "included", amount: 20 },
        { tax_year: 2026, program: "Shared", record_status: "included", amount: 15 },
        { tax_year: 2026, program: "JoshBeyondBorders", record_status: "included", amount: 999 },
      ],
    };
    const result = summarize(data, 2026);
    expect(result.csmReceived).toBe(185);
    expect(result.hopeReceived).toBe(225);
    expect(result.recordedReceipts).toBe(410);
    expect(result.csmExpenses).toBe(55);
    expect(result.hopeExpenses).toBe(20);
    expect(result.recordedOutflow).toBe(84);
    expect(result.jbbReceived).toBe(0);
    expect(result.jbbSent).toBe(30);
    expect(result.jbbDue).toBe(60);
  });
});
