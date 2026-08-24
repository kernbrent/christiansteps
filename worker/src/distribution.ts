import {
  CSM_DISTRIBUTION_SCHEMA_VERSION,
  destinationForProduct,
  isEligibleDistributionSource,
  parseDistributionMessage,
  type CsmDestination,
  type CsmDistributionMessage,
} from "./csm-distribution-contract";
import { AdminError, adminJson, readAdminJson, secureEqual } from "./security";

type DistributionEnv = Env & {
  HOPE_ADMIN?: Fetcher;
  JBB_ADMIN?: Fetcher;
  CSM_DISTRIBUTION_SECRET?: string;
};

type SourceRow = {
  id: string;
  transactionId: string;
  referenceTransactionId: string | null;
  eventCode: string;
  transactionDate: string;
  status: string;
  direction: "received" | "sent";
  currency: string;
  gross: number;
  fee: number;
  net: number;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  counterpartyPhone: string | null;
  shippingName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  itemTitle: string | null;
  itemId: string | null;
  product: string;
};

type OutboxRow = {
  id: string;
  message_id: string;
  idempotency_key: string;
  payload_json: string;
  status: string;
  attempt_count: number;
};

const RECIPIENT_STATUSES = new Set(["received", "pending", "needs_match", "approved", "denied", "failed"]);

const normalizeEmail = (value: string | null): string | null => {
  const normalized = (value || "").normalize("NFKC").trim().toLowerCase();
  return normalized || null;
};

const displayNameFor = (row: SourceRow): string =>
  (row.counterpartyName || row.shippingName || row.counterpartyEmail || row.transactionId).normalize("NFKC").trim();

function sourceStatement(env: DistributionEnv, ids: string): D1PreparedStatement {
  return env.DB.prepare(
    `SELECT id,
      transaction_id AS transactionId,
      reference_transaction_id AS referenceTransactionId,
      event_code AS eventCode,
      transaction_date AS transactionDate,
      status,
      direction,
      currency,
      gross,
      fee,
      net,
      counterparty_name AS counterpartyName,
      counterparty_email AS counterpartyEmail,
      counterparty_phone AS counterpartyPhone,
      shipping_name AS shippingName,
      address_line_1 AS addressLine1,
      address_line_2 AS addressLine2,
      city,
      region,
      postal_code AS postalCode,
      country_code AS countryCode,
      item_title AS itemTitle,
      item_id AS itemId,
      COALESCE(product_override, product_detected) AS product
    FROM paypal_transactions
    WHERE id IN (${ids})`,
  );
}

async function loadSources(env: DistributionEnv, ids: string[]): Promise<Map<string, SourceRow>> {
  const placeholders = ids.map(() => "?").join(", ");
  const result = await sourceStatement(env, placeholders).bind(...ids).all<SourceRow>();
  return new Map(result.results.map(row => [row.id, row]));
}

async function ensureMasterDonor(env: DistributionEnv, row: SourceRow, displayName: string): Promise<string> {
  const email = normalizeEmail(row.counterpartyEmail);
  const identityKey = email ? `email:${email}` : `paypal:${row.transactionId}`;
  const existing = await env.DB.prepare(
    "SELECT id FROM csm_master_donors WHERE identity_key = ?1",
  ).bind(identityKey).first<{ id: string }>();
  const donorId = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO csm_master_donors
      (id, identity_key, display_name, email_normalized, email, phone, address_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT (identity_key) DO UPDATE SET
       display_name = excluded.display_name,
       email_normalized = excluded.email_normalized,
       email = excluded.email,
       phone = excluded.phone,
       address_json = excluded.address_json,
       updated_at = excluded.updated_at`,
  ).bind(
    donorId,
    identityKey,
    displayName,
    email,
    row.counterpartyEmail,
    row.counterpartyPhone,
    JSON.stringify({
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      state: row.region,
      postalCode: row.postalCode,
      countryCode: row.countryCode,
    }),
    now,
  ).run();
  return donorId;
}

async function buildMessage(env: DistributionEnv, row: SourceRow): Promise<CsmDistributionMessage> {
  const destination = destinationForProduct(row.product);
  if (!destination || !isEligibleDistributionSource(row)) {
    throw new AdminError(
      422,
      "INELIGIBLE_DISTRIBUTION",
      "Only completed received or sent PayPal payment events assigned to Hope Sojourns or Josh Beyond Borders can be sent. Holds and releases are excluded.",
    );
  }
  const displayName = displayNameFor(row);
  const masterDonorId = row.direction === "received" ? await ensureMasterDonor(env, row, displayName) : null;
  const sourceRevision = 1;
  return parseDistributionMessage({
    schemaVersion: CSM_DISTRIBUTION_SCHEMA_VERSION,
    messageId: crypto.randomUUID(),
    idempotencyKey: `${destination}:${row.transactionId}:${row.eventCode}:${sourceRevision}`,
    sourceRevision,
    sentAt: new Date().toISOString(),
    destination,
    product: destination,
    displayName,
    masterDonorId,
    party: {
      role: row.direction === "received" ? "donor" : "payee",
      displayName,
      email: row.counterpartyEmail,
      phone: row.counterpartyPhone,
      address: {
        line1: row.addressLine1,
        line2: row.addressLine2,
        city: row.city,
        state: row.region,
        postalCode: row.postalCode,
        countryCode: row.countryCode,
      },
    },
    transaction: {
      sourceRecordId: row.id,
      paypalTransactionId: row.transactionId,
      paypalReferenceId: row.referenceTransactionId,
      eventCode: row.eventCode,
      eventDate: row.transactionDate,
      status: row.status,
      direction: row.direction,
      currency: row.currency,
      gross: Number(row.gross),
      fee: Number(row.fee),
      net: Number(row.net),
      itemName: row.itemTitle,
      itemId: row.itemId,
    },
  });
}

async function existingOutbox(env: DistributionEnv, idempotencyKey: string): Promise<OutboxRow | null> {
  return env.DB.prepare(
    `SELECT id, message_id, idempotency_key, payload_json, status, attempt_count
     FROM csm_distribution_outbox WHERE idempotency_key = ?1`,
  ).bind(idempotencyKey).first<OutboxRow>();
}

async function saveOutbox(env: DistributionEnv, message: CsmDistributionMessage): Promise<OutboxRow> {
  const existing = await existingOutbox(env, message.idempotencyKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO csm_distribution_outbox
      (id, message_id, idempotency_key, source_record_id, source_transaction_id, source_event_code,
       source_revision, destination, direction, display_name, master_donor_id, payload_json, status,
       attempt_count, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'queued', 0, ?13, ?13)`,
  ).bind(
    id,
    message.messageId,
    message.idempotencyKey,
    message.transaction.sourceRecordId,
    message.transaction.paypalTransactionId,
    message.transaction.eventCode,
    message.sourceRevision,
    message.destination,
    message.transaction.direction,
    message.displayName,
    message.masterDonorId,
    JSON.stringify(message),
    now,
  ).run();
  return { id, message_id: message.messageId, idempotency_key: message.idempotencyKey, payload_json: JSON.stringify(message), status: "queued", attempt_count: 0 };
}

function recipientBinding(env: DistributionEnv, destination: CsmDestination): Fetcher {
  const binding = destination === "HopeSojourns" ? env.HOPE_ADMIN : env.JBB_ADMIN || env.JBB_PAYPAL;
  if (!binding) throw new Error(`${destination} service binding is not configured`);
  return binding;
}

async function recordAttempt(
  env: DistributionEnv,
  outbox: OutboxRow,
  outcome: "accepted" | "failed",
  responseStatus: number | null,
  responseBody: unknown,
  errorMessage: string | null,
): Promise<void> {
  const attempt = outbox.attempt_count + 1;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO csm_distribution_attempts
        (id, outbox_id, attempt_number, outcome, response_status, response_json, error_message, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(crypto.randomUUID(), outbox.id, attempt, outcome, responseStatus, responseBody == null ? null : JSON.stringify(responseBody), errorMessage, now),
    env.DB.prepare(
      `UPDATE csm_distribution_outbox
       SET attempt_count = ?1, last_attempt_at = ?2, last_error = ?3, updated_at = ?2
       WHERE id = ?4`,
    ).bind(attempt, now, errorMessage, outbox.id),
  ]);
}

async function deliver(env: DistributionEnv, outbox: OutboxRow): Promise<Record<string, unknown>> {
  if (!env.CSM_DISTRIBUTION_SECRET) throw new Error("CSM distribution secret is not configured");
  const message = parseDistributionMessage(JSON.parse(outbox.payload_json));
  try {
    const response = await recipientBinding(env, message.destination).fetch("https://csm.internal/internal/csm-distribution", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSM-Distribution-Secret": env.CSM_DISTRIBUTION_SECRET,
      },
      body: JSON.stringify(message),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Recipient returned HTTP ${response.status}`);
    const status = typeof body.status === "string" && RECIPIENT_STATUSES.has(body.status) ? body.status : "received";
    await recordAttempt(env, outbox, "accepted", response.status, body, null);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE csm_distribution_outbox
         SET status = ?1, recipient_inbox_id = ?2, recipient_record_id = ?3,
             decision_reason = ?4, last_error = NULL, updated_at = ?5
         WHERE id = ?6`,
      ).bind(
        status,
        typeof body.inboxId === "string" ? body.inboxId : null,
        typeof body.recordId === "string" ? body.recordId : null,
        typeof body.reason === "string" ? body.reason : null,
        new Date().toISOString(),
        outbox.id,
      ),
      env.DB.prepare(
        `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
         VALUES (?1, 'distribution', ?2, 'delivery_accepted', ?3, ?4)`,
      ).bind(crypto.randomUUID(), outbox.id, JSON.stringify({ destination: message.destination, status }), new Date().toISOString()),
    ]);
    return { idempotencyKey: message.idempotencyKey, destination: message.destination, status, inboxId: body.inboxId || null };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown delivery error";
    await recordAttempt(env, outbox, "failed", null, null, messageText);
    await env.DB.prepare(
      "UPDATE csm_distribution_outbox SET status = 'failed', last_error = ?1, updated_at = ?2 WHERE id = ?3",
    ).bind(messageText, new Date().toISOString(), outbox.id).run();
    return { idempotencyKey: message.idempotencyKey, destination: message.destination, status: "failed", error: messageText };
  }
}

function transactionIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.transactionIds)) {
    throw new AdminError(422, "INVALID_SELECTION", "Choose at least one transaction to send.");
  }
  const ids = [...new Set(body.transactionIds.filter((value): value is string => typeof value === "string" && value.length <= 160))];
  if (!ids.length || ids.length > 100) {
    throw new AdminError(422, "INVALID_SELECTION", "Choose between 1 and 100 transactions.");
  }
  return ids;
}

export async function sendDistributions(request: Request, env: DistributionEnv): Promise<Response> {
  const ids = transactionIdsFromBody(await readAdminJson(request));
  const rows = await loadSources(env, ids);
  const results: Record<string, unknown>[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) {
      results.push({ sourceRecordId: id, status: "failed", error: "Transaction was not found." });
      continue;
    }
    try {
      const message = await buildMessage(env, row);
      const outbox = await saveOutbox(env, message);
      if (!["queued", "failed"].includes(outbox.status)) {
        results.push({ sourceRecordId: id, idempotencyKey: outbox.idempotency_key, status: outbox.status, duplicate: true });
        continue;
      }
      results.push({ sourceRecordId: id, ...(await deliver(env, outbox)) });
    } catch (error) {
      results.push({
        sourceRecordId: id,
        status: "failed",
        error: error instanceof Error ? error.message : "The transaction could not be sent.",
      });
    }
  }
  const failed = results.filter(result => result.status === "failed").length;
  return adminJson({ results, sent: results.length - failed, failed }, failed === results.length ? 422 : 200);
}

export async function listDistributionOutbox(env: DistributionEnv, url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const result = await env.DB.prepare(
    `SELECT id, message_id AS messageId, idempotency_key AS idempotencyKey,
      source_record_id AS sourceRecordId, destination, direction, display_name AS displayName,
      status, attempt_count AS attemptCount, last_attempt_at AS lastAttemptAt,
      last_error AS lastError, recipient_inbox_id AS recipientInboxId,
      recipient_record_id AS recipientRecordId, decision_reason AS decisionReason,
      created_at AS createdAt, updated_at AS updatedAt
     FROM csm_distribution_outbox ORDER BY created_at DESC LIMIT ?1`,
  ).bind(limit).all<Record<string, unknown>>();
  return adminJson({ deliveries: result.results });
}

export async function receiveDistributionStatus(request: Request, env: DistributionEnv): Promise<Response> {
  const supplied = request.headers.get("X-CSM-Distribution-Secret") || "";
  if (!env.CSM_DISTRIBUTION_SECRET || !(await secureEqual(supplied, env.CSM_DISTRIBUTION_SECRET))) {
    return adminJson({ error: "Unauthorized" }, 401);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!idempotencyKey || !RECIPIENT_STATUSES.has(status)) return adminJson({ error: "Invalid status update" }, 422);
  const outbox = await env.DB.prepare(
    "SELECT id FROM csm_distribution_outbox WHERE idempotency_key = ?1",
  ).bind(idempotencyKey).first<{ id: string }>();
  if (!outbox) return adminJson({ error: "Unknown distribution" }, 404);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE csm_distribution_outbox
       SET status = ?1, recipient_inbox_id = COALESCE(?2, recipient_inbox_id),
           recipient_record_id = COALESCE(?3, recipient_record_id), decision_reason = ?4,
           last_error = CASE WHEN ?1 = 'failed' THEN ?4 ELSE NULL END, updated_at = ?5
       WHERE id = ?6`,
    ).bind(
      status,
      typeof body?.inboxId === "string" ? body.inboxId : null,
      typeof body?.recordId === "string" ? body.recordId : null,
      typeof body?.reason === "string" ? body.reason : null,
      now,
      outbox.id,
    ),
    env.DB.prepare(
      `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
       VALUES (?1, 'distribution', ?2, 'recipient_status_updated', ?3, ?4)`,
    ).bind(crypto.randomUUID(), outbox.id, JSON.stringify({ status, idempotencyKey }), now),
  ]);
  return adminJson({ success: true });
}
