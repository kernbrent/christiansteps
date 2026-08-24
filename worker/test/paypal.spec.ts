import { describe, expect, it } from "vitest";
import { detectProduct, normalizeTransaction, routePath } from "../src/index";

describe("PayPal normalization", () => {
  it.each([
    [["Hope Sojourns charitable gift"], "HopeSojourns"],
    [["Josh Beyond Borders Donation", "BeyondBorders"], "JoshBeyondBorders"],
    [["Christian Steps donation"], "ChristianSteps"],
    [["A generic payment"], "Unassigned"],
  ])("classifies product metadata", (values, expected) => {
    expect(detectProduct(values)).toBe(expected);
  });

  it("keeps donor, product, item, address, and money fields", () => {
    const transaction = normalizeTransaction({
      transaction_info: {
        transaction_id: "ABC123",
        transaction_event_code: "T0013",
        transaction_initiation_date: "2026-08-20T16:00:00Z",
        transaction_status: "S",
        transaction_amount: { currency_code: "USD", value: "100.00" },
        fee_amount: { currency_code: "USD", value: "-2.48" },
        transaction_subject: "Christian Steps donation",
      },
      payer_info: {
        payer_name: { given_name: "Jane", surname: "Donor" },
        email_address: "jane@example.com",
      },
      shipping_info: {
        address: {
          address_line_1: "123 Main St",
          admin_area_2: "McKinney",
          admin_area_1: "TX",
          postal_code: "75070",
          country_code: "US",
        },
      },
      cart_info: {
        item_details: [{ item_name: "ChristianSteps", item_code: "CS-GIVE" }],
      },
    });

    expect(transaction).toMatchObject({
      id: "ABC123:T0013",
      type: "Donation Payment",
      status: "Completed",
      direction: "received",
      gross: 100,
      fee: -2.48,
      net: 97.52,
      counterpartyName: "Jane Donor",
      counterpartyEmail: "jane@example.com",
      itemTitle: "ChristianSteps",
      itemId: "CS-GIVE",
      productDetected: "ChristianSteps",
      address: { line1: "123 Main St", city: "McKinney", region: "TX", postalCode: "75070" },
    });
  });

  it("classifies negative transactions as sent", () => {
    const transaction = normalizeTransaction({
      transaction_info: {
        transaction_id: "SEND123",
        transaction_event_code: "T0400",
        transaction_initiation_date: "2026-08-20T16:00:00Z",
        transaction_status: "S",
        transaction_amount: { currency_code: "USD", value: "-40.00" },
      },
    });
    expect(transaction?.direction).toBe("sent");
  });
});

describe("admin route prefix", () => {
  it("maps the Christian Steps API prefix", () => {
    expect(routePath("/api/admin/transactions")).toBe("/transactions");
    expect(routePath("/api/admin")).toBe("/");
  });
});
