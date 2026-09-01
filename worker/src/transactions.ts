import { fetchPayPalTransactions, PRODUCTS, type NormalizedTransaction, type Product } from "./paypal";
import { AdminError, adminJson, readAdminJson } from "./security";

const PRODUCT_SET = new Set<string>(PRODUCTS);
const PAGE_SIZE = 100;
const EXPORT_LIMIT = 20_000;
const EFFECTIVE_PRODUCT = "COALESCE(product_override, product_detected)";
const SUMMARY_PRODUCTS = ["HopeSojourns", "JoshBeyondBorders", "ChristianSteps"] as const;
type SummaryProduct = typeof SUMMARY_PRODUCTS[number];
type SummaryRow = { direction: string; product: string | null; eventCode: string | null; giverKey: string | null; gross: number | null };

const TRANSACTION_COLUMNS = [
  "id",
  "transaction_id",
  "reference_transaction_id",
  "event_code",
  "transaction_date",
  "updated_date",
  "type",
  "status",
  "direction",
  "currency",
  "gross",
  "fee",
  "net",
  "counterparty_name",
  "counterparty_email",
  "counterparty_phone",
  "address_status",
  "shipping_name",
  "address_line_1",
  "address_line_2",
  "city",
  "region",
  "postal_code",
  "country_code",
  "item_title",
  "item_id",
  "item_details_json",
  "product_detected",
  "product_override",
  "invoice_number",
  "custom_number",
  "subject",
  "note",
  "ending_balance",
  "raw_json",
  "first_seen_at",
  "last_seen_at",
] as const;

const TRANSACTION_SELECT = `
  id,
  transaction_id AS transactionId,
  reference_transaction_id AS referenceTransactionId,
  (SELECT related.counterparty_name
     FROM paypal_transactions AS related
    WHERE related.transaction_id = paypal_transactions.reference_transaction_id
      AND related.event_code LIKE 'T00%'
    LIMIT 1) AS relatedCounterpartyName,
  (SELECT related.counterparty_email
     FROM paypal_transactions AS related
    WHERE related.transaction_id = paypal_transactions.reference_transaction_id
      AND related.event_code LIKE 'T00%'
    LIMIT 1) AS relatedCounterpartyEmail,
  event_code AS eventCode,
  transaction_date AS transactionDate,
  updated_date AS updatedDate,
  type,
  status,
  direction,
  currency,
  gross,
  fee,
  net,
  counterparty_name AS counterpartyName,
  COALESCE(NULLIF(TRIM(counterparty_name), ''), NULLIF(TRIM(shipping_name), ''), NULLIF(TRIM(counterparty_email), ''), transaction_id) AS displayName,
  counterparty_email AS counterpartyEmail,
  counterparty_phone AS counterpartyPhone,
  address_status AS addressStatus,
  shipping_name AS shippingName,
  address_line_1 AS addressLine1,
  address_line_2 AS addressLine2,
  city,
  region,
  postal_code AS postalCode,
  country_code AS countryCode,
  item_title AS itemTitle,
  item_id AS itemId,
  item_details_json AS itemDetailsJson,
  product_detected AS productDetected,
  product_override AS productOverride,
  ${EFFECTIVE_PRODUCT} AS product,
  invoice_number AS invoiceNumber,
  custom_number AS customNumber,
  subject,
  note,
  ending_balance AS endingBalance,
  raw_json AS rawJson,
  first_seen_at AS firstSeenAt,
  last_seen_at AS lastSeenAt,
  (SELECT delivery.status
     FROM csm_distribution_outbox AS delivery
    WHERE delivery.source_record_id = paypal_transactions.id
    ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionStatus,
  (SELECT delivery.destination
     FROM csm_distribution_outbox AS delivery
    WHERE delivery.source_record_id = paypal_transactions.id
    ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionDestination,
  (SELECT delivery.last_error
     FROM csm_distribution_outbox AS delivery
    WHERE delivery.source_record_id = paypal_transactions.id
    ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionError,
  (SELECT delivery.updated_at
     FROM csm_distribution_outbox AS delivery
    WHERE delivery.source_record_id = paypal_transactions.id
    ORDER BY delivery.source_revision DESC LIMIT 1) AS distributionUpdatedAt`;

type TransactionFilters = {
  activity: string;
  product: string;
  direction: string;
  year: string;
  search: string;
  page: number;
};

type SyncStateRow = {
  last_success_at: string | null;
  oldest_synced_at: string | null;
  newest_synced_at: string | null;
  last_scope: string | null;
  last_result_count: number;
};

type SyncResponseInput = {
  scope: "recent" | "full";
  searchedFrom: string;
  searchedThrough: string;
  recordsFound: number;
  recordsInserted: number;
  recordsUpdated: number;
  completedAt: string;
  summary: Record<string, unknown>;
};

export function buildSyncResponse(input: SyncResponseInput): Record<string, unknown> {
  return {
    success: true,
    scope: input.scope,
    searchedFrom: input.searchedFrom,
    searchedThrough: input.searchedThrough,
    // Keep the original names for compatibility with any existing consumers.
    found: input.recordsFound,
    inserted: input.recordsInserted,
    updated: input.recordsUpdated,
    // These explicit names are the public Admin Portal response contract.
    recordsFound: input.recordsFound,
    recordsInserted: input.recordsInserted,
    recordsUpdated: input.recordsUpdated,
    sync: {
      lastSuccessAt: input.completedAt,
      newestSyncedAt: input.searchedThrough,
      lastScope: input.scope,
      lastResultCount: input.recordsFound,
    },
    summary: input.summary,
  };
}

function boundedInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function filtersFromUrl(url: URL): TransactionFilters {
  const activity = url.searchParams.get("activity") ?? "payments";
  const product = url.searchParams.get("product") ?? "";
  const direction = url.searchParams.get("direction") ?? "";
  const year = url.searchParams.get("year") ?? "";
  if (product && !PRODUCT_SET.has(product)) throw new AdminError(400, "INVALID_FILTER", "Choose a valid product filter.");
  if (direction && direction !== "received" && direction !== "sent") {
    throw new AdminError(400, "INVALID_FILTER", "Choose a valid received or sent filter.");
  }
  if (activity !== "payments" && activity !== "holds" && activity !== "all") {
    throw new AdminError(400, "INVALID_FILTER", "Choose payments, PayPal holds, or all activity.");
  }
  if (year && !/^20\d{2}$/.test(year)) throw new AdminError(400, "INVALID_FILTER", "Choose a valid year filter.");
  return {
    activity,
    product,
    direction,
    year,
    search: (url.searchParams.get("search") ?? "").normalize("NFKC").trim().slice(0, 120),
    page: boundedInteger(url.searchParams.get("page"), 1, 100_000),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function filterSql(filters: TransactionFilters): { sql: string; bindings: unknown[] } {
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (filters.activity === "payments") where.push("event_code LIKE 'T00%'");
  if (filters.activity === "holds") where.push("event_code IN ('T2101', 'T2102')");
  if (filters.product) {
    where.push(`${EFFECTIVE_PRODUCT} = ?`);
    bindings.push(filters.product);
  }
  if (filters.direction) {
    where.push("direction = ?");
    bindings.push(filters.direction);
  }
  if (filters.year) {
    where.push("substr(transaction_date, 1, 4) = ?");
    bindings.push(filters.year);
  }
  if (filters.search) {
    const search = `%${escapeLike(filters.search)}%`;
    where.push(`(
      counterparty_name LIKE ? ESCAPE '\\' OR
      counterparty_email LIKE ? ESCAPE '\\' OR
      transaction_id LIKE ? ESCAPE '\\' OR
      item_title LIKE ? ESCAPE '\\' OR
      item_id LIKE ? ESCAPE '\\' OR
      subject LIKE ? ESCAPE '\\' OR
      note LIKE ? ESCAPE '\\'
    )`);
    bindings.push(search, search, search, search, search, search, search);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", bindings };
}

function currentYear(env: Env): number {
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone: env.DISPLAY_TIME_ZONE || "America/Chicago",
      year: "numeric",
    }).format(new Date());
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  } catch {
    // UTC is a safe fallback if the configured display time zone is invalid.
  }
  return new Date().getUTCFullYear();
}

function transactionValues(transaction: NormalizedTransaction, now: string): unknown[] {
  return [
    transaction.id,
    transaction.transactionId,
    transaction.referenceTransactionId || null,
    transaction.eventCode,
    transaction.transactionDate,
    transaction.updatedDate || null,
    transaction.type,
    transaction.status,
    transaction.direction,
    transaction.currency,
    transaction.gross,
    transaction.fee,
    transaction.net,
    transaction.counterpartyName || null,
    transaction.counterpartyEmail || null,
    transaction.counterpartyPhone || null,
    transaction.addressStatus || null,
    transaction.shippingName || null,
    transaction.address.line1 || null,
    transaction.address.line2 || null,
    transaction.address.city || null,
    transaction.address.region || null,
    transaction.address.postalCode || null,
    transaction.address.countryCode || null,
    transaction.itemTitle || null,
    transaction.itemId || null,
    JSON.stringify(transaction.itemDetails),
    transaction.productDetected,
    null,
    transaction.invoiceNumber || null,
    transaction.customNumber || null,
    transaction.subject || null,
    transaction.note || null,
    transaction.endingBalance,
    transaction.rawJson,
    now,
    now,
  ];
}

function upsertStatement(env: Env, transaction: NormalizedTransaction, now: string): D1PreparedStatement {
  const placeholders = TRANSACTION_COLUMNS.map(() => "?").join(", ");
  const updates = TRANSACTION_COLUMNS
    .filter(column => !["id", "transaction_id", "event_code", "product_override", "first_seen_at"].includes(column))
    .map(column => `${column} = excluded.${column}`)
    .join(", ");
  return env.DB.prepare(
    `INSERT INTO paypal_transactions (${TRANSACTION_COLUMNS.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
  ).bind(...transactionValues(transaction, now));
}

async function saveTransactions(env: Env, transactions: NormalizedTransaction[]): Promise<{ inserted: number; updated: number }> {
  const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM paypal_transactions").first<{ count: number }>();
  const now = new Date().toISOString();
  for (let offset = 0; offset < transactions.length; offset += 50) {
    const chunk = transactions.slice(offset, offset + 50);
    if (chunk.length) await env.DB.batch(chunk.map(transaction => upsertStatement(env, transaction, now)));
  }
  const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM paypal_transactions").first<{ count: number }>();
  const inserted = Math.max(0, Number(after?.count ?? 0) - Number(before?.count ?? 0));
  return { inserted, updated: Math.max(0, transactions.length - inserted) };
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export function buildSummary(year: number, rows: SummaryRow[]): Record<string, unknown> {
  const products: Record<SummaryProduct, number> = { HopeSojourns: 0, JoshBeyondBorders: 0, ChristianSteps: 0 };
  const sentProducts: Record<SummaryProduct, number> = { HopeSojourns: 0, JoshBeyondBorders: 0, ChristianSteps: 0 };
  const donationCounts: Record<SummaryProduct, number> = { HopeSojourns: 0, JoshBeyondBorders: 0, ChristianSteps: 0 };
  const giverSets: Record<SummaryProduct, Set<string>> = {
    HopeSojourns: new Set(),
    JoshBeyondBorders: new Set(),
    ChristianSteps: new Set(),
  };
  const totalGivers = new Set<string>();
  let total = 0;
  let sentTotal = 0;
  let donationCount = 0;
  for (const row of rows) {
    const gross = Number(row.gross ?? 0);
    if (!Number.isFinite(gross) || !/^T00\d{2}$/.test(row.eventCode ?? "")) continue;
    const isSummaryProduct = SUMMARY_PRODUCTS.includes(row.product as SummaryProduct);
    const product = row.product as SummaryProduct;
    if (row.direction === "received" && gross > 0 && isSummaryProduct) {
      total += gross;
      products[product] += gross;
      donationCounts[product] += 1;
      donationCount += 1;
      const giverKey = (row.giverKey ?? "").trim().toLowerCase();
      if (giverKey) {
        giverSets[product].add(giverKey);
        totalGivers.add(giverKey);
      }
    }
    if (row.direction === "sent" && gross < 0) {
      sentTotal += Math.abs(gross);
      if (isSummaryProduct) sentProducts[product] += Math.abs(gross);
    }
  }
  for (const product of SUMMARY_PRODUCTS) {
    products[product] = roundMoney(products[product]);
    sentProducts[product] = roundMoney(sentProducts[product]);
  }
  const giverCounts: Record<SummaryProduct, number> = {
    HopeSojourns: giverSets.HopeSojourns.size,
    JoshBeyondBorders: giverSets.JoshBeyondBorders.size,
    ChristianSteps: giverSets.ChristianSteps.size,
  };
  return {
    year,
    products,
    total: roundMoney(total),
    donationCounts,
    giverCounts,
    donationCount,
    giverCount: totalGivers.size,
    sentProducts,
    sentTotal: roundMoney(sentTotal),
  };
}

async function summary(env: Env): Promise<Record<string, unknown>> {
  const year = currentYear(env);
  const totals = await env.DB.prepare(
    `SELECT direction,
       ${EFFECTIVE_PRODUCT} AS product,
       event_code AS eventCode,
       gross,
       LOWER(TRIM(COALESCE(NULLIF(counterparty_email, ''), NULLIF(counterparty_name, ''), transaction_id))) AS giverKey
     FROM paypal_transactions
     WHERE status = 'Completed'
       AND currency = 'USD'
       AND ((direction = 'received' AND gross > 0) OR (direction = 'sent' AND gross < 0))
       AND substr(transaction_date, 1, 4) = ?1`,
  ).bind(String(year)).all<SummaryRow>();
  return buildSummary(year, totals.results);
}

async function years(env: Env): Promise<number[]> {
  const result = await env.DB.prepare(
    "SELECT DISTINCT substr(transaction_date, 1, 4) AS year FROM paypal_transactions ORDER BY year DESC",
  ).all<{ year: string }>();
  return result.results.map(row => Number(row.year)).filter(Number.isInteger);
}

async function syncState(env: Env): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    `SELECT last_success_at, oldest_synced_at, newest_synced_at, last_scope, last_result_count
     FROM paypal_sync_state WHERE id = 'primary'`,
  ).first<SyncStateRow>();
  return row ? {
    lastSuccessAt: row.last_success_at,
    oldestSyncedAt: row.oldest_synced_at,
    newestSyncedAt: row.newest_synced_at,
    lastScope: row.last_scope,
    lastResultCount: row.last_result_count,
  } : null;
}

export async function listTransactions(env: Env, url: URL): Promise<Response> {
  const filters = filtersFromUrl(url);
  const filtered = filterSql(filters);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const listStatement = env.DB.prepare(
    `SELECT ${TRANSACTION_SELECT}
     FROM paypal_transactions
     ${filtered.sql}
     ORDER BY transaction_date DESC, id DESC
     LIMIT ? OFFSET ?`,
  ).bind(...filtered.bindings, PAGE_SIZE, offset);
  const countStatement = env.DB.prepare(
    `SELECT COUNT(*) AS count FROM paypal_transactions ${filtered.sql}`,
  ).bind(...filtered.bindings);
  const [listResult, countResult, totals, availableYears, state] = await Promise.all([
    listStatement.all<Record<string, unknown>>(),
    countStatement.first<{ count: number }>(),
    summary(env),
    years(env),
    syncState(env),
  ]);
  const total = Number(countResult?.count ?? 0);
  return adminJson({
    transactions: listResult.results,
    summary: totals,
    years: availableYears,
    sync: state,
    pagination: {
      page: filters.page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    },
  });
}

export async function exportTransactions(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT ${TRANSACTION_SELECT}
     FROM paypal_transactions
     ORDER BY transaction_date DESC, id DESC
     LIMIT ?1`,
  ).bind(EXPORT_LIMIT).all<Record<string, unknown>>();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM paypal_transactions").first<{ count: number }>();
  if (Number(count?.count ?? 0) > EXPORT_LIMIT) {
    throw new AdminError(413, "EXPORT_TOO_LARGE", "The transaction workbook is too large to create in one download.");
  }
  return adminJson({ transactions: result.results, summary: await summary(env), generatedAt: new Date().toISOString() });
}

export async function donorTransactions(env: Env, url: URL): Promise<Response> {
  const year = url.searchParams.get("year") ?? String(currentYear(env));
  if (!/^20\d{2}$/.test(year)) throw new AdminError(400, "INVALID_YEAR", "Choose a valid giving year.");
  const result = await env.DB.prepare(
    `SELECT ${TRANSACTION_SELECT}
     FROM paypal_transactions
     WHERE direction = 'received'
       AND status = 'Completed'
       AND currency = 'USD'
       AND gross > 0
       AND event_code LIKE 'T00%'
       AND ${EFFECTIVE_PRODUCT} IN ('HopeSojourns', 'JoshBeyondBorders', 'ChristianSteps')
       AND substr(transaction_date, 1, 4) = ?1
     ORDER BY transaction_date ASC, id ASC
     LIMIT 5000`,
  ).bind(year).all<Record<string, unknown>>();
  return adminJson({ year: Number(year), transactions: result.results });
}

export async function updateTransactionProduct(request: Request, env: Env, transactionId: string): Promise<Response> {
  const body = await readAdminJson(request);
  const product = body.product === null || body.product === "" ? null : body.product;
  if (product !== null && (typeof product !== "string" || !PRODUCT_SET.has(product))) {
    throw new AdminError(422, "INVALID_PRODUCT", "Choose a valid product or automatic classification.");
  }
  const result = await env.DB.prepare(
    "UPDATE paypal_transactions SET product_override = ?1, last_seen_at = ?2 WHERE id = ?3",
  ).bind(product, new Date().toISOString(), transactionId).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new AdminError(404, "TRANSACTION_NOT_FOUND", "This PayPal transaction was not found.");
  }
  return adminJson({ success: true, transactionId, productOverride: product });
}

export async function syncPayPal(request: Request, env: Env): Promise<Response> {
  const body = await readAdminJson(request);
  const state = await syncState(env);
  const requestedFull = body.fullHistory === true;
  const scope: "recent" | "full" = requestedFull || !state ? "full" : "recent";
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO paypal_sync_runs (id, scope, started_at, status)
     VALUES (?1, ?2, ?3, 'running')`,
  ).bind(runId, scope, startedAt).run();
  try {
    const search = await fetchPayPalTransactions(env, scope);
    const saved = await saveTransactions(env, search.transactions);
    const completedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE paypal_sync_runs SET
           completed_at = ?1,
           searched_from = ?2,
           searched_through = ?3,
           records_found = ?4,
           records_inserted = ?5,
           records_updated = ?6,
           status = 'completed'
         WHERE id = ?7`,
      ).bind(
        completedAt,
        search.searchedFrom,
        search.searchedThrough,
        search.transactions.length,
        saved.inserted,
        saved.updated,
        runId,
      ),
      env.DB.prepare(
        `INSERT INTO paypal_sync_state
           (id, last_success_at, oldest_synced_at, newest_synced_at, last_scope, last_result_count)
         VALUES ('primary', ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET
           last_success_at = excluded.last_success_at,
           oldest_synced_at = CASE
             WHEN paypal_sync_state.oldest_synced_at IS NULL OR excluded.oldest_synced_at < paypal_sync_state.oldest_synced_at
             THEN excluded.oldest_synced_at ELSE paypal_sync_state.oldest_synced_at END,
           newest_synced_at = excluded.newest_synced_at,
           last_scope = excluded.last_scope,
           last_result_count = excluded.last_result_count`,
      ).bind(completedAt, search.searchedFrom, search.searchedThrough, scope, search.transactions.length),
      env.DB.prepare(
        `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
         VALUES (?1, 'paypal_sync', ?2, 'completed', ?3, ?4)`,
      ).bind(
        crypto.randomUUID(),
        runId,
        JSON.stringify({ scope, found: search.transactions.length, ...saved }),
        completedAt,
      ),
    ]);
    return adminJson(buildSyncResponse({
      scope,
      searchedFrom: search.searchedFrom,
      searchedThrough: search.searchedThrough,
      recordsFound: search.transactions.length,
      recordsInserted: saved.inserted,
      recordsUpdated: saved.updated,
      completedAt,
      summary: await summary(env),
    }));
  } catch (error) {
    await env.DB.prepare(
      `UPDATE paypal_sync_runs SET completed_at = ?1, status = 'failed', error_code = ?2 WHERE id = ?3`,
    ).bind(
      new Date().toISOString(),
      error instanceof AdminError ? error.code : "UNEXPECTED_ERROR",
      runId,
    ).run();
    throw error;
  }
}
