type PayPalLedgerProgram = "ChristianSteps" | "HopeSojourns" | "JoshBeyondBorders" | "Unassigned";
export type PayPalAccountingClass =
  | "contribution"
  | "agency_receipt"
  | "agency_disbursement"
  | "internal_transfer"
  | "unassigned";

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
  displayName: string;
  counterpartyEmail: string | null;
  itemTitle: string | null;
  itemId: string | null;
  program: PayPalLedgerProgram;
  distributionStatus: string | null;
  distributionDestination: string | null;
  sourceFirstSeenAt: string;
  sourceLastSeenAt: string;
};

const VALID_PROGRAMS = new Set<PayPalLedgerProgram>([
  "ChristianSteps",
  "HopeSojourns",
  "JoshBeyondBorders",
  "Unassigned",
]);

export function accountingClassFor(
  program: string,
  direction: string,
  eventCode = "",
): PayPalAccountingClass {
  if (eventCode === "T0300" || eventCode === "T0400") {
    return program === "Unassigned" ? "unassigned" : "internal_transfer";
  }
  if (program === "JoshBeyondBorders") {
    return direction === "received" ? "agency_receipt" : "agency_disbursement";
  }
  if (program === "ChristianSteps" || program === "HopeSojourns") {
    return direction === "received" ? "contribution" : "internal_transfer";
  }
  return "unassigned";
}

function normalizedProgram(value: string): PayPalLedgerProgram {
  return VALID_PROGRAMS.has(value as PayPalLedgerProgram)
    ? value as PayPalLedgerProgram
    : "Unassigned";
}

async function sourceRows(env: Env): Promise<SourceRow[]> {
  const result = await env.DB.prepare(
    `SELECT
       source.id,
       source.transaction_id AS transactionId,
       source.reference_transaction_id AS referenceTransactionId,
       source.event_code AS eventCode,
       source.transaction_date AS transactionDate,
       source.status,
       source.direction,
       source.currency,
       source.gross,
       source.fee,
       source.net,
       COALESCE(NULLIF(TRIM(source.counterparty_name), ''), NULLIF(TRIM(source.shipping_name), ''), NULLIF(TRIM(source.counterparty_email), ''), source.transaction_id) AS displayName,
       source.counterparty_email AS counterpartyEmail,
       source.item_title AS itemTitle,
       source.item_id AS itemId,
       COALESCE(source.product_override, source.product_detected) AS program,
       (SELECT delivery.status
          FROM csm_distribution_outbox AS delivery
         WHERE delivery.source_record_id = source.id
         ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionStatus,
       (SELECT delivery.destination
          FROM csm_distribution_outbox AS delivery
         WHERE delivery.source_record_id = source.id
         ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionDestination,
       source.first_seen_at AS sourceFirstSeenAt,
       source.last_seen_at AS sourceLastSeenAt
     FROM paypal_transactions AS source
     WHERE source.event_code LIKE 'T00%'
        OR source.event_code IN ('T0300', 'T0400')
     ORDER BY source.transaction_date DESC
     LIMIT 20000`,
  ).all<SourceRow>();
  return result.results;
}

export async function syncPayPalLedger(env: Env): Promise<{
  seen: number;
  inserted: number;
  updated: number;
}> {
  const now = new Date().toISOString();
  try {
    const rows = await sourceRows(env);
    const existing = await env.LEDGER_DB.prepare(
      "SELECT source_record_id AS sourceRecordId FROM paypal_ledger_activity",
    ).all<{ sourceRecordId: string }>();
    const existingIds = new Set(existing.results.map(row => row.sourceRecordId));
    let inserted = 0;
    let updated = 0;

    for (let offset = 0; offset < rows.length; offset += 50) {
      const statements = rows.slice(offset, offset + 50).map(row => {
        const program = normalizedProgram(row.program);
        if (existingIds.has(row.id)) updated += 1;
        else inserted += 1;
        return env.LEDGER_DB.prepare(
          `INSERT INTO paypal_ledger_activity (
             id, source_record_id, transaction_id, reference_transaction_id, event_code,
             transaction_date, status, direction, currency, gross, fee, net, display_name,
             counterparty_email, item_title, item_id, program, accounting_class,
             distribution_status, distribution_destination, source_first_seen_at,
             source_last_seen_at, imported_at, updated_at
           ) VALUES (
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
             ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23
           )
           ON CONFLICT (source_record_id) DO UPDATE SET
             reference_transaction_id = excluded.reference_transaction_id,
             transaction_date = excluded.transaction_date,
             status = excluded.status,
             direction = excluded.direction,
             currency = excluded.currency,
             gross = excluded.gross,
             fee = excluded.fee,
             net = excluded.net,
             display_name = excluded.display_name,
             counterparty_email = excluded.counterparty_email,
             item_title = excluded.item_title,
             item_id = excluded.item_id,
             program = excluded.program,
             accounting_class = excluded.accounting_class,
             distribution_status = excluded.distribution_status,
             distribution_destination = excluded.distribution_destination,
             source_last_seen_at = excluded.source_last_seen_at,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(),
          row.id,
          row.transactionId,
          row.referenceTransactionId,
          row.eventCode,
          row.transactionDate,
          row.status,
          row.direction,
          row.currency,
          row.gross,
          row.fee,
          row.net,
          row.displayName,
          row.counterpartyEmail,
          row.itemTitle,
          row.itemId,
          program,
          accountingClassFor(program, row.direction, row.eventCode),
          row.distributionStatus,
          row.distributionDestination,
          row.sourceFirstSeenAt,
          row.sourceLastSeenAt,
          now,
        );
      });
      if (statements.length) await env.LEDGER_DB.batch(statements);
    }

    await env.LEDGER_DB.prepare(
      `INSERT INTO ledger_sync_state
         (id, last_success_at, records_seen, records_inserted, records_updated, last_error)
       VALUES ('paypal', ?1, ?2, ?3, ?4, NULL)
       ON CONFLICT (id) DO UPDATE SET
         last_success_at = excluded.last_success_at,
         records_seen = excluded.records_seen,
         records_inserted = excluded.records_inserted,
         records_updated = excluded.records_updated,
         last_error = NULL`,
    ).bind(now, rows.length, inserted, updated).run();

    console.log(JSON.stringify({
      event: "ledger_paypal_projection_completed",
      recordsSeen: rows.length,
      recordsInserted: inserted,
      recordsUpdated: updated,
    }));
    return { seen: rows.length, inserted, updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ledger projection error";
    try {
      await env.LEDGER_DB.prepare(
        `INSERT INTO ledger_sync_state
           (id, records_seen, records_inserted, records_updated, last_error)
         VALUES ('paypal', 0, 0, 0, ?1)
         ON CONFLICT (id) DO UPDATE SET last_error = excluded.last_error`,
      ).bind(message.slice(0, 500)).run();
    } catch {
      // The first migration may not have run yet; preserve the original failure.
    }
    console.error(JSON.stringify({ event: "ledger_paypal_projection_failed", message }));
    throw error;
  }
}
