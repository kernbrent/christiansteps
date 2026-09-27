import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { receiveLedgerDonationStatus, sendLedgerDonation } from "../src/ledger-donations";
import { updateRecord, deleteRecord } from "../src/records";

const opened: DatabaseSync[] = [];
afterEach(() => opened.splice(0).forEach(db => db.close()));
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function fixture() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  for (const file of ["0001_bookkeeping.sql", "0009_income_donation_delivery.sql"]) {
    db.exec(readFileSync(`ledger-migrations/${file}`, "utf8"));
  }
  db.prepare(`INSERT INTO income(id,income_date,payer_name,amount,program,payment_status,tax_year,record_status,cpa_review,
    income_kind,donor_email,created_at,updated_at) VALUES(?, '2026-09-25','Example Giver',100,'HopeSojourns','paid',2026,'included',0,
    'donation','giver@example.test','2026-09-25','2026-09-25')`).run(id);
  db.prepare(`INSERT INTO income_payments(id,income_id,payment_date,amount,payment_method,reference_number,created_at,updated_at)
    VALUES('payment-1',?,'2026-09-25',100,'Check','1234','2026-09-25','2026-09-25')`).run(id);
  class Statement {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) { this.values = values; return this; }
    async first<T>() { return (db.prepare(this.sql).get(...this.values as []) || null) as T | null; }
    async all<T>() { return { results: db.prepare(this.sql).all(...this.values as []) as T[] }; }
    async run() { return { meta: { changes: Number(db.prepare(this.sql).run(...this.values as []).changes) } }; }
  }
  const delivered: string[] = [];
  const env = {
    LEDGER_DB: { prepare: (sql: string) => new Statement(sql) },
    HOPE_ADMIN: { fetch: vi.fn(async (_url: string, options: RequestInit) => {
      delivered.push(String(options.body));
      return Response.json({ status: "pending", inboxId: "hope-inbox-1" }, { status: 202 });
    }) },
    CSM_DISTRIBUTION_SECRET: "test-secret",
  } as unknown as Env;
  const request = (body: unknown = { confirmUniqueSource: true }) => new Request("https://example.test/api/admin/records/income/" + id + "/send-to-hope", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { db, env, request, delivered };
}

it("requires an explicit, fully paid Hope Sojourns donation with one source payment", async () => {
  const f = fixture();
  await expect(sendLedgerDonation(f.request({}), f.env, id)).rejects.toMatchObject({ code: "CONFIRM_SOURCE" });
  f.db.exec("UPDATE income SET income_kind='earned'");
  await expect(sendLedgerDonation(f.request(), f.env, id)).rejects.toMatchObject({ code: "NOT_HS_DONATION" });
  f.db.exec("UPDATE income SET income_kind='donation',invoice_number='INV-1'");
  await expect(sendLedgerDonation(f.request(), f.env, id)).rejects.toMatchObject({ code: "INVOICED_INCOME" });
  f.db.exec("UPDATE income SET invoice_number=NULL; UPDATE income_payments SET amount=50; UPDATE income SET payment_status='paid'");
  await expect(sendLedgerDonation(f.request(), f.env, id)).rejects.toMatchObject({ code: "PAYMENT_REVIEW_REQUIRED" });
  f.db.exec("UPDATE income_payments SET amount=100,payment_method='PayPal'");
  await expect(sendLedgerDonation(f.request(), f.env, id)).rejects.toMatchObject({ code: "USE_GIVING_SOURCE" });
  expect(f.db.prepare("SELECT hs_payload_json FROM income WHERE id=?").get(id)?.hs_payload_json).toBeNull();
});

it("sends one immutable donation identity, locks the source, and records Hope Sojourns approval", async () => {
  const f = fixture();
  const result = await (await sendLedgerDonation(f.request(), f.env, id)).json() as { status: string };
  expect(result.status).toBe("pending");
  expect(f.delivered).toHaveLength(1);
  const message = JSON.parse(f.delivered[0]!);
  expect(message.transaction).toMatchObject({ eventCode: "LEDGER_DONATION", gross: 100, fee: 0, net: 100 });
  expect(message.ledgerIncome).toMatchObject({ incomeId: id, paymentMethod: "Check", paymentReference: "1234" });
  await expect(updateRecord(f.request({ payer_name: "Changed" }), f.env, "income", id)).rejects.toMatchObject({ code: "HS_GIFT_LOCKED" });
  await expect(deleteRecord(f.env, "income_payments", "payment-1")).rejects.toMatchObject({ code: "HS_GIFT_LOCKED" });
  const callback = await receiveLedgerDonationStatus(f.env, { idempotencyKey: `HopeSojourns:ledger-income:${id}`, status: "approved", inboxId: "hope-inbox-1", recordId: "hope-record-1" });
  expect(callback.status).toBe(200);
  expect(f.db.prepare("SELECT hs_delivery_status,hs_record_id FROM income WHERE id=?").get(id)).toMatchObject({ hs_delivery_status: "approved", hs_record_id: "hope-record-1" });
  await sendLedgerDonation(f.request(), f.env, id);
  expect(f.delivered).toHaveLength(1);
});

it("retries an uncertain delivery with the same frozen payload", async () => {
  const f = fixture();
  vi.mocked(f.env.HOPE_ADMIN.fetch).mockRejectedValueOnce(new Error("connection lost"));
  await expect(sendLedgerDonation(f.request(), f.env, id)).rejects.toMatchObject({ code: "HS_DELIVERY_FAILED" });
  expect(f.db.prepare("SELECT hs_delivery_status FROM income WHERE id=?").get(id)?.hs_delivery_status).toBe("failed");
  await sendLedgerDonation(f.request(), f.env, id);
  expect(f.delivered).toHaveLength(1);
  expect(JSON.parse(f.delivered[0]!).idempotencyKey).toBe(`HopeSojourns:ledger-income:${id}`);
});
