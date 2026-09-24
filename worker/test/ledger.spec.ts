import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accountingClassFor } from "../src/ledger-paypal";
import { normalizeRecordPayload } from "../src/records";
import { normalizeTripBatchPayload } from "../src/trips";

describe("ministry fund accounting", () => {
  it("recognizes CSM and Hope Sojourns gifts but treats JBB money as an agency liability", () => {
    expect(accountingClassFor("ChristianSteps", "received")).toBe("contribution");
    expect(accountingClassFor("HopeSojourns", "received")).toBe("contribution");
    expect(accountingClassFor("JoshBeyondBorders", "received")).toBe("agency_receipt");
    expect(accountingClassFor("JoshBeyondBorders", "sent")).toBe("agency_disbursement");
    expect(accountingClassFor("HopeSojourns", "sent")).toBe("internal_transfer");
    expect(accountingClassFor("HopeSojourns", "sent", "T0400")).toBe("internal_transfer");
    expect(accountingClassFor("HopeSojourns", "sent", "T0401")).toBe("internal_transfer");
    expect(accountingClassFor("HopeSojourns", "sent", "T0403")).toBe("internal_transfer");
    expect(accountingClassFor("ChristianSteps", "received", "T0300")).toBe("internal_transfer");
  });

  it("accepts ministry programs on manual records and rejects JBB as a manual operating program", () => {
    expect(normalizeRecordPayload("expenses", { program: "HopeSojourns" })).toEqual({ program: "HopeSojourns" });
    expect(normalizeRecordPayload("income", { program: "ChristianSteps" })).toEqual({ program: "ChristianSteps" });
    expect(() => normalizeRecordPayload("expenses", { program: "JoshBeyondBorders" })).toThrow(/program is invalid/i);
  });

  it("requires a ministry program for mileage batches", () => {
    const base = {
      dates: ["2026-09-17"],
      origin: "McKinney, TX",
      destination: "Dallas, TX",
      business_purpose: "Ministry meeting",
      miles: 65,
      program: "HopeSojourns",
      record_status: "included",
      cpa_review: false,
      toll_amount: 0,
    };
    expect(normalizeTripBatchPayload(base).program).toBe("HopeSojourns");
    expect(() => normalizeTripBatchPayload({ ...base, program: "JoshBeyondBorders" })).toThrow(/valid ministry program/i);
  });

  it("copies payments and bank transfers while excluding PayPal holds and releases", () => {
    const source = readFileSync(resolve(process.cwd(), "src/ledger-paypal.ts"), "utf8");
    expect(source).toContain("WHERE source.event_code LIKE 'T00%'");
    expect(source).toContain("source.event_code IN ('T0300', 'T0400', 'T0401', 'T0403')");
    expect(source).not.toContain("UPDATE paypal_transactions");
    expect(source).not.toContain("DELETE FROM paypal_transactions");
    expect(source).not.toContain("INSERT INTO csm_distribution_outbox");
  });
});

describe("isolated ledger schema", () => {
  it("stores the PayPal projection by immutable source record ID", () => {
    const migration = readFileSync(resolve(process.cwd(), "ledger-migrations/0006_paypal_fund_accounting.sql"), "utf8");
    expect(migration).toContain("source_record_id TEXT NOT NULL UNIQUE");
    expect(migration).toContain("agency_receipt");
    expect(migration).toContain("agency_disbursement");
    expect(migration).not.toContain("REFERENCES paypal_transactions");
  });

  it("requires invoices and reusable invoice profiles to retain their ministry", () => {
    const migration = readFileSync(resolve(process.cwd(), "ledger-migrations/0007_invoice_programs.sql"), "utf8");
    const invoiceSource = readFileSync(resolve(process.cwd(), "src/invoices.ts"), "utf8");
    expect(migration.match(/ADD COLUMN program/g)).toHaveLength(2);
    expect(invoiceSource).toContain("payload.program, payload.total_amount");
    expect(invoiceSource).toContain("amount, program, payment_status");
  });

  it("adds Scholarship as an active expense category without duplicating an existing category", () => {
    const migration = readFileSync(resolve(process.cwd(), "ledger-migrations/0008_scholarship_category.sql"), "utf8");
    expect(migration).toContain("INSERT OR IGNORE INTO categories");
    expect(migration).toContain("'Scholarship'");
    expect(migration).toContain("'Scholarships and grants'");
    expect(migration).toContain("SET is_active = 1");
  });
});
