import { parseDistributionMessage, CSM_DISTRIBUTION_SCHEMA_VERSION, type CsmDistributionMessage } from "./csm-distribution-contract";
import { AdminError, adminJson, readAdminJson } from "./security";

type Income = {
  id: string; income_date: string; payer_name: string; donor_email: string | null;
  amount: number; program: string; income_kind: string; invoice_number: string | null; payment_status: string;
  record_status: string; description: string | null; payment_method: string | null;
  hs_payload_json: string | null; hs_delivery_status: string | null;
};
type Payment = { payment_date: string; amount: number; payment_method: string | null; reference_number: string | null };
const keyFor = (id: string) => `HopeSojourns:ledger-income:${id}`;
const cents = (value: number) => Math.round(Number(value) * 100);

async function audit(env: Env, id: string, event: string, details: Record<string, unknown>): Promise<void> {
  await env.LEDGER_DB.prepare(
    "INSERT INTO audit_events(id,entity_type,entity_id,event_type,metadata_json,created_at) VALUES(?1,'income',?2,?3,?4,?5)",
  ).bind(crypto.randomUUID(), id, event, JSON.stringify(details), new Date().toISOString()).run();
}

async function source(env: Env, id: string): Promise<Income> {
  const row = await env.LEDGER_DB.prepare(
    `SELECT id,income_date,payer_name,donor_email,amount,program,income_kind,invoice_number,payment_status,
      record_status,description,payment_method,hs_payload_json,hs_delivery_status FROM income WHERE id=?1`,
  ).bind(id).first<Income>();
  if (!row) throw new AdminError(404, "INCOME_NOT_FOUND", "This CSM income record was not found.");
  return row;
}

async function buildMessage(env: Env, row: Income): Promise<CsmDistributionMessage> {
  if (row.program !== "HopeSojourns" || row.income_kind !== "donation" || row.record_status !== "included" || row.payment_status !== "paid") {
    throw new AdminError(422, "NOT_HS_DONATION", "Mark this included, fully paid income as a Hope Sojourns donation first.");
  }
  if (row.invoice_number) {
    throw new AdminError(422, "INVOICED_INCOME", "Invoice-linked income is not a direct donation. Review the invoice before sending anything to Hope Sojourns.");
  }
  const payments = await env.LEDGER_DB.prepare(
    "SELECT payment_date,amount,payment_method,reference_number FROM income_payments WHERE income_id=?1 ORDER BY payment_date,id",
  ).bind(row.id).all<Payment>();
  if (payments.results.length !== 1 || cents(payments.results[0]!.amount) !== cents(row.amount)) {
    throw new AdminError(422, "PAYMENT_REVIEW_REQUIRED", "A Hope Sojourns donation must have exactly one recorded payment equal to its income amount. Review the payment history first.");
  }
  const payment = payments.results[0]!;
  const method = payment.payment_method || row.payment_method;
  if (method && /paypal|venmo|zelle/i.test(method)) {
    throw new AdminError(422, "USE_GIVING_SOURCE", "PayPal and personally received gifts use CSM Giving activity or Personally received gifts, not this ledger transfer.");
  }
  const email = row.donor_email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AdminError(422, "INVALID_DONOR_EMAIL", "Correct the donor email before sending this donation.");
  }
  const amount = cents(row.amount) / 100;
  const name = row.payer_name.normalize("NFKC").trim();
  return parseDistributionMessage({
    schemaVersion: CSM_DISTRIBUTION_SCHEMA_VERSION,
    messageId: crypto.randomUUID(), idempotencyKey: keyFor(row.id), sourceRevision: 1,
    sentAt: new Date().toISOString(), destination: "HopeSojourns", product: "HopeSojourns",
    displayName: name, masterDonorId: `ledger-income:${row.id}`,
    party: { role: "donor", displayName: name, email, phone: null, address: null },
    transaction: {
      sourceRecordId: `ledger-income:${row.id}`, paypalTransactionId: row.id,
      paypalReferenceId: null, eventCode: "LEDGER_DONATION",
      eventDate: `${payment.payment_date}T12:00:00.000Z`, status: "Completed", direction: "received",
      currency: "USD", gross: amount, fee: 0, net: amount,
      itemName: row.description || "Hope Sojourns donation", itemId: null,
    },
    ledgerIncome: { incomeId: row.id, paymentMethod: method, paymentReference: payment.reference_number },
  });
}

export async function sendLedgerDonation(request: Request, env: Env, id: string): Promise<Response> {
  const row = await source(env, id);
  if (!row.hs_payload_json) {
    const body = await readAdminJson(request);
    if (body.confirmUniqueSource !== true) throw new AdminError(422, "CONFIRM_SOURCE", "Confirm this donation is not already recorded in CSM PayPal or Personally received gifts.");
    const message = await buildMessage(env, row);
    const now = new Date().toISOString();
    await env.LEDGER_DB.prepare(
      "UPDATE income SET hs_payload_json=?1,hs_delivery_status='queued',hs_sent_at=?2,updated_at=?2 WHERE id=?3 AND hs_payload_json IS NULL",
    ).bind(JSON.stringify(message), now, id).run();
    await audit(env, id, "hope_delivery_queued", { amount: message.transaction.gross, idempotencyKey: message.idempotencyKey });
  }
  const current = await source(env, id);
  if (current.hs_delivery_status === "approved" || current.hs_delivery_status === "denied") {
    return adminJson({ status: current.hs_delivery_status, duplicate: true });
  }
  if (!current.hs_payload_json || !env.HOPE_ADMIN || !env.CSM_DISTRIBUTION_SECRET) {
    throw new AdminError(503, "HS_DELIVERY_UNAVAILABLE", "The Hope Sojourns review connection is unavailable.");
  }
  const message = parseDistributionMessage(JSON.parse(current.hs_payload_json));
  try {
    const response = await env.HOPE_ADMIN.fetch("https://csm.internal/internal/csm-distribution", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSM-Distribution-Secret": env.CSM_DISTRIBUTION_SECRET },
      body: JSON.stringify(message),
    });
    const result = await response.json() as { status?: string; inboxId?: string; error?: string };
    if (!response.ok || !["pending", "needs_match", "approved", "denied"].includes(result.status || "")) {
      throw new Error(result.error || `Hope Sojourns returned HTTP ${response.status}`);
    }
    await env.LEDGER_DB.prepare(
      "UPDATE income SET hs_delivery_status=?1,hs_inbox_id=?2,hs_delivery_error=NULL,updated_at=?3 WHERE id=?4 AND hs_delivery_status NOT IN ('approved','denied')",
    ).bind(result.status, result.inboxId || null, new Date().toISOString(), id).run();
    await audit(env, id, "hope_delivery_accepted", { status: result.status, inboxId: result.inboxId || null });
    return adminJson({ status: result.status, inboxId: result.inboxId || null });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown connection failure";
    await env.LEDGER_DB.prepare(
      "UPDATE income SET hs_delivery_status='failed',hs_delivery_error=?1,updated_at=?2 WHERE id=?3 AND hs_delivery_status NOT IN ('approved','denied')",
    ).bind(detail.slice(0, 500), new Date().toISOString(), id).run();
    await audit(env, id, "hope_delivery_failed", { error: detail.slice(0, 500) });
    throw new AdminError(502, "HS_DELIVERY_FAILED", "Hope Sojourns did not confirm receipt. The source is saved; use Retry send after checking the connection.");
  }
}

export async function receiveLedgerDonationStatus(env: Env, body: Record<string, unknown>): Promise<Response> {
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const id = key.startsWith("HopeSojourns:ledger-income:") ? key.slice("HopeSojourns:ledger-income:".length) : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!/^[a-f0-9-]{36}$/i.test(id) || !["approved", "denied"].includes(status)) return adminJson({ error: "Invalid ledger donation status" }, 422);
  const row = await source(env, id);
  if (!row.hs_payload_json || parseDistributionMessage(JSON.parse(row.hs_payload_json)).idempotencyKey !== key) return adminJson({ error: "Unknown ledger donation" }, 404);
  if (["approved", "denied"].includes(row.hs_delivery_status || "") && row.hs_delivery_status !== status) return adminJson({ error: "Final decision cannot be changed" }, 409);
  await env.LEDGER_DB.prepare(
    "UPDATE income SET hs_delivery_status=?1,hs_inbox_id=COALESCE(?2,hs_inbox_id),hs_record_id=COALESCE(?3,hs_record_id),hs_delivery_error=NULL,updated_at=?4 WHERE id=?5",
  ).bind(status, typeof body.inboxId === "string" ? body.inboxId : null, typeof body.recordId === "string" ? body.recordId : null, new Date().toISOString(), id).run();
  await audit(env, id, "hope_decision_received", { status });
  return adminJson({ success: true });
}
