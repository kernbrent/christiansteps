import { AdminError, adminJson, readAdminJson } from "./security";
import { deleteAttachmentsForRecord } from "./attachments";

const OWNER_ID = "primary";
const MAX_NOTES_LENGTH = 10_000;
const RECORD_STATUS = ["included", "excluded", "needs_review"] as const;
const PAYMENT_STATUS = ["unpaid", "partial", "paid", "overdue", "void"] as const;
const PROGRAMS = ["ChristianSteps", "HopeSojourns", "Shared"] as const;

const RECORD_FIELDS = {
  categories: ["name", "tax_line", "color", "is_active", "sort_order"],
  clients: ["name", "company", "email", "phone", "notes", "is_active"],
  projects: ["client_id", "name", "description", "start_date", "end_date", "is_active"],
  trip_templates: [
    "name", "origin", "destination", "business_purpose", "miles", "toll_amount", "toll_vendor",
    "payment_method", "client_id", "project_id", "program", "notes", "is_active",
  ],
  mileage_rates: ["effective_from", "effective_to", "rate_per_mile", "label", "is_active"],
  expenses: [
    "expense_date", "vendor", "amount", "program", "category_id", "description", "business_purpose",
    "payment_method", "client_id", "project_id", "tax_year", "reimbursable", "reimbursed",
    "deductibility_percent", "record_status", "cpa_review", "cpa_notes", "notes",
  ],
  income: [
    "income_date", "client_id", "project_id", "payer_name", "invoice_number", "invoice_date",
    "due_date", "amount", "program", "payment_status", "description", "payment_method", "tax_year",
    "record_status", "cpa_review", "cpa_notes", "notes",
  ],
  income_payments: ["income_id", "payment_date", "amount", "payment_method", "reference_number", "notes"],
  mileage_entries: [
    "mileage_date", "origin", "destination", "business_purpose", "miles", "program", "client_id",
    "project_id", "tax_year", "record_status", "cpa_review", "cpa_notes", "notes",
  ],
} as const;

export type RecordTable = keyof typeof RECORD_FIELDS;
type JsonRecord = Record<string, unknown>;
type NormalizedRecord = Record<string, string | number | null>;

type ProjectRow = { client_id: string };
type ClientRow = { id: string };
type ExistingRelationshipRow = { client_id: string | null; project_id: string | null };
type MileageRateRow = { effective_from: string; effective_to: string; is_active: number };

export function recordTable(value: string): RecordTable | null {
  return Object.prototype.hasOwnProperty.call(RECORD_FIELDS, value) ? value as RecordTable : null;
}

function has(body: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function requiredText(body: JsonRecord, key: string, maximum: number): string | undefined {
  if (!has(body, key)) return undefined;
  if (typeof body[key] !== "string") throw new AdminError(422, "INVALID_RECORD", `${key} must be text.`);
  const value = body[key].trim();
  if (!value || value.length > maximum) {
    throw new AdminError(422, "INVALID_RECORD", `${key} must contain between 1 and ${maximum} characters.`);
  }
  return value;
}

function optionalText(body: JsonRecord, key: string, maximum = MAX_NOTES_LENGTH): string | null | undefined {
  if (!has(body, key)) return undefined;
  if (body[key] === null || body[key] === "") return null;
  if (typeof body[key] !== "string") throw new AdminError(422, "INVALID_RECORD", `${key} must be text.`);
  const value = body[key].trim();
  if (!value) return null;
  if (value.length > maximum) throw new AdminError(422, "INVALID_RECORD", `${key} is too long.`);
  return value;
}

function dateValue(body: JsonRecord, key: string, nullable = false): string | null | undefined {
  if (!has(body, key)) return undefined;
  if (nullable && (body[key] === null || body[key] === "")) return null;
  if (typeof body[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body[key])) {
    throw new AdminError(422, "INVALID_RECORD", `${key} must be a valid date.`);
  }
  const [year, month, day] = body[key].split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw new AdminError(422, "INVALID_RECORD", `${key} must be a valid date.`);
  }
  return body[key];
}

function idValue(body: JsonRecord, key: string, nullable = false): string | null | undefined {
  if (!has(body, key)) return undefined;
  if (nullable && (body[key] === null || body[key] === "")) return null;
  if (typeof body[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(body[key])) {
    throw new AdminError(422, "INVALID_RECORD", `${key} is invalid.`);
  }
  return body[key];
}

function numberValue(body: JsonRecord, key: string, minimum: number, maximum: number): number | undefined {
  if (!has(body, key)) return undefined;
  const value = typeof body[key] === "number" ? body[key] : Number.NaN;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AdminError(422, "INVALID_RECORD", `${key} is outside the allowed range.`);
  }
  return value;
}

function integerValue(body: JsonRecord, key: string, minimum: number, maximum: number): number | undefined {
  const value = numberValue(body, key, minimum, maximum);
  if (value !== undefined && !Number.isInteger(value)) {
    throw new AdminError(422, "INVALID_RECORD", `${key} must be a whole number.`);
  }
  return value;
}

function booleanValue(body: JsonRecord, key: string): number | undefined {
  if (!has(body, key)) return undefined;
  if (body[key] === true || body[key] === 1) return 1;
  if (body[key] === false || body[key] === 0) return 0;
  throw new AdminError(422, "INVALID_RECORD", `${key} must be true or false.`);
}

function enumValue<T extends string>(body: JsonRecord, key: string, values: readonly T[]): T | undefined {
  if (!has(body, key)) return undefined;
  if (typeof body[key] !== "string" || !values.includes(body[key] as T)) {
    throw new AdminError(422, "INVALID_RECORD", `${key} is invalid.`);
  }
  return body[key] as T;
}

function put(target: NormalizedRecord, key: string, value: string | number | null | undefined): void {
  if (value !== undefined) target[key] = value;
}

export function normalizeRecordPayload(table: RecordTable, body: JsonRecord): NormalizedRecord {
  const result: NormalizedRecord = {};
  switch (table) {
    case "categories":
      put(result, "name", requiredText(body, "name", 100));
      put(result, "tax_line", optionalText(body, "tax_line", 180));
      if (has(body, "color")) {
        if (typeof body.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
          throw new AdminError(422, "INVALID_RECORD", "Choose a valid category color.");
        }
        result.color = body.color;
      }
      put(result, "is_active", booleanValue(body, "is_active"));
      put(result, "sort_order", integerValue(body, "sort_order", -10_000, 10_000));
      break;
    case "clients":
      put(result, "name", requiredText(body, "name", 160));
      put(result, "company", optionalText(body, "company", 180));
      put(result, "email", optionalText(body, "email", 254));
      put(result, "phone", optionalText(body, "phone", 60));
      put(result, "notes", optionalText(body, "notes"));
      put(result, "is_active", booleanValue(body, "is_active"));
      break;
    case "projects":
      put(result, "client_id", idValue(body, "client_id"));
      put(result, "name", requiredText(body, "name", 160));
      put(result, "description", optionalText(body, "description"));
      put(result, "start_date", dateValue(body, "start_date", true));
      put(result, "end_date", dateValue(body, "end_date", true));
      put(result, "is_active", booleanValue(body, "is_active"));
      break;
    case "trip_templates":
      put(result, "name", requiredText(body, "name", 100));
      put(result, "origin", requiredText(body, "origin", 240));
      put(result, "destination", requiredText(body, "destination", 240));
      put(result, "business_purpose", requiredText(body, "business_purpose", 500));
      put(result, "miles", numberValue(body, "miles", 0.01, 999_999.99));
      put(result, "toll_amount", numberValue(body, "toll_amount", 0, 999_999.99));
      put(result, "toll_vendor", optionalText(body, "toll_vendor", 180));
      put(result, "payment_method", optionalText(body, "payment_method", 100));
      put(result, "client_id", idValue(body, "client_id", true));
      put(result, "project_id", idValue(body, "project_id", true));
      put(result, "program", enumValue(body, "program", PROGRAMS));
      put(result, "notes", optionalText(body, "notes"));
      put(result, "is_active", booleanValue(body, "is_active"));
      break;
    case "mileage_rates": {
      const effectiveFrom = dateValue(body, "effective_from");
      const effectiveTo = dateValue(body, "effective_to");
      put(result, "effective_from", effectiveFrom);
      put(result, "effective_to", effectiveTo);
      put(result, "rate_per_mile", numberValue(body, "rate_per_mile", 0, 100));
      put(result, "label", optionalText(body, "label", 180));
      put(result, "is_active", booleanValue(body, "is_active"));
      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
        throw new AdminError(422, "INVALID_MILEAGE_RATE", "The ending date must be on or after the starting date.");
      }
      break;
    }
    case "expenses":
      put(result, "expense_date", dateValue(body, "expense_date"));
      put(result, "vendor", requiredText(body, "vendor", 180));
      put(result, "amount", numberValue(body, "amount", 0.01, 999_999_999.99));
      put(result, "program", enumValue(body, "program", PROGRAMS));
      put(result, "category_id", idValue(body, "category_id", true));
      put(result, "description", optionalText(body, "description"));
      put(result, "business_purpose", optionalText(body, "business_purpose"));
      put(result, "payment_method", optionalText(body, "payment_method", 100));
      put(result, "client_id", idValue(body, "client_id", true));
      put(result, "project_id", idValue(body, "project_id", true));
      put(result, "tax_year", integerValue(body, "tax_year", 2000, 2100));
      put(result, "reimbursable", booleanValue(body, "reimbursable"));
      put(result, "reimbursed", booleanValue(body, "reimbursed"));
      put(result, "deductibility_percent", numberValue(body, "deductibility_percent", 0, 100));
      put(result, "record_status", enumValue(body, "record_status", RECORD_STATUS));
      put(result, "cpa_review", booleanValue(body, "cpa_review"));
      put(result, "cpa_notes", optionalText(body, "cpa_notes"));
      put(result, "notes", optionalText(body, "notes"));
      break;
    case "income":
      put(result, "income_date", dateValue(body, "income_date"));
      put(result, "client_id", idValue(body, "client_id", true));
      put(result, "project_id", idValue(body, "project_id", true));
      put(result, "payer_name", requiredText(body, "payer_name", 180));
      put(result, "invoice_number", optionalText(body, "invoice_number", 100));
      put(result, "invoice_date", dateValue(body, "invoice_date", true));
      put(result, "due_date", dateValue(body, "due_date", true));
      put(result, "amount", numberValue(body, "amount", 0.01, 999_999_999.99));
      put(result, "program", enumValue(body, "program", PROGRAMS));
      put(result, "payment_status", enumValue(body, "payment_status", PAYMENT_STATUS));
      put(result, "description", optionalText(body, "description"));
      put(result, "payment_method", optionalText(body, "payment_method", 100));
      put(result, "tax_year", integerValue(body, "tax_year", 2000, 2100));
      put(result, "record_status", enumValue(body, "record_status", RECORD_STATUS));
      put(result, "cpa_review", booleanValue(body, "cpa_review"));
      put(result, "cpa_notes", optionalText(body, "cpa_notes"));
      put(result, "notes", optionalText(body, "notes"));
      break;
    case "income_payments":
      put(result, "income_id", idValue(body, "income_id"));
      put(result, "payment_date", dateValue(body, "payment_date"));
      put(result, "amount", numberValue(body, "amount", 0.01, 999_999_999.99));
      put(result, "payment_method", optionalText(body, "payment_method", 100));
      put(result, "reference_number", optionalText(body, "reference_number", 180));
      put(result, "notes", optionalText(body, "notes"));
      break;
    case "mileage_entries":
      put(result, "mileage_date", dateValue(body, "mileage_date"));
      put(result, "origin", requiredText(body, "origin", 240));
      put(result, "destination", requiredText(body, "destination", 240));
      put(result, "business_purpose", requiredText(body, "business_purpose", 500));
      put(result, "miles", numberValue(body, "miles", 0.01, 999_999.99));
      put(result, "program", enumValue(body, "program", PROGRAMS));
      put(result, "client_id", idValue(body, "client_id", true));
      put(result, "project_id", idValue(body, "project_id", true));
      put(result, "tax_year", integerValue(body, "tax_year", 2000, 2100));
      put(result, "record_status", enumValue(body, "record_status", RECORD_STATUS));
      put(result, "cpa_review", booleanValue(body, "cpa_review"));
      put(result, "cpa_notes", optionalText(body, "cpa_notes"));
      put(result, "notes", optionalText(body, "notes"));
      break;
  }
  return result;
}

const REQUIRED_FIELDS: Record<RecordTable, readonly string[]> = {
  categories: ["name", "color", "is_active", "sort_order"],
  clients: ["name", "is_active"],
  projects: ["client_id", "name", "is_active"],
  trip_templates: ["name", "origin", "destination", "business_purpose", "miles", "toll_amount", "is_active"],
  mileage_rates: ["effective_from", "effective_to", "rate_per_mile", "is_active"],
  expenses: [
    "expense_date", "vendor", "amount", "program", "tax_year", "reimbursable", "reimbursed",
    "deductibility_percent", "record_status", "cpa_review",
  ],
  income: ["income_date", "payer_name", "amount", "program", "payment_status", "tax_year", "record_status", "cpa_review"],
  income_payments: ["income_id", "payment_date", "amount"],
  mileage_entries: ["mileage_date", "origin", "destination", "business_purpose", "miles", "program", "tax_year", "record_status", "cpa_review"],
};

function requireCreateFields(table: RecordTable, payload: NormalizedRecord): void {
  const missing = REQUIRED_FIELDS[table].filter(field => payload[field] === undefined || payload[field] === null);
  if (missing.length) throw new AdminError(422, "INVALID_RECORD", `Complete the required ${missing[0]} field.`);
}

function databaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/MILEAGE_RATE_OVERLAP/i.test(message)) {
    throw new AdminError(409, "MILEAGE_RATE_OVERLAP", "This date range overlaps another active mileage rate.");
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    throw new AdminError(409, "DUPLICATE_RECORD", "A record with those unique details already exists.");
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    throw new AdminError(409, "RECORD_IN_USE", "This item is linked to another bookkeeping record.");
  }
  if (/CHECK constraint failed|NOT NULL constraint failed/i.test(message)) {
    throw new AdminError(422, "INVALID_RECORD", "Review the record fields and try again.");
  }
  throw error;
}

async function audit(env: Env, table: string, id: string, eventType: string): Promise<void> {
  await env.LEDGER_DB.prepare(
    `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, NULL, ?5)`,
  ).bind(crypto.randomUUID(), table, id, eventType, new Date().toISOString()).run();
}

async function validateProjectRelationship(
  env: Env,
  table: RecordTable,
  id: string | null,
  payload: NormalizedRecord,
): Promise<void> {
  if (table === "projects") {
    const clientId = payload.client_id as string | null | undefined;
    if (clientId === undefined && id) return;
    if (!clientId) throw new AdminError(422, "INVALID_RECORD", "Choose a client before saving the project.");
    const client = await env.LEDGER_DB.prepare("SELECT id FROM clients WHERE id = ?1").bind(clientId).first<ClientRow>();
    if (!client) throw new AdminError(422, "INVALID_RECORD", "The selected client no longer exists.");
    return;
  }
  if (!(["expenses", "income", "mileage_entries", "trip_templates"] as RecordTable[]).includes(table)) return;
  let clientId = payload.client_id as string | null | undefined;
  let projectId = payload.project_id as string | null | undefined;
  if (id && (clientId === undefined || projectId === undefined)) {
    const existing = await env.LEDGER_DB.prepare(`SELECT client_id, project_id FROM ${table} WHERE id = ?1`)
      .bind(id)
      .first<ExistingRelationshipRow>();
    if (!existing) throw new AdminError(404, "NOT_FOUND", "That record no longer exists.");
    if (clientId === undefined) clientId = existing.client_id;
    if (projectId === undefined) projectId = existing.project_id;
  }
  if (!projectId) return;
  if (!clientId) throw new AdminError(422, "INVALID_RECORD", "Choose a client for the selected project.");
  const project = await env.LEDGER_DB.prepare("SELECT client_id FROM projects WHERE id = ?1").bind(projectId).first<ProjectRow>();
  if (!project || project.client_id !== clientId) {
    throw new AdminError(422, "INVALID_RECORD", "The selected project does not belong to that client.");
  }
}

async function validateMileageRate(
  env: Env,
  table: RecordTable,
  id: string | null,
  payload: NormalizedRecord,
): Promise<void> {
  if (table !== "mileage_rates") return;
  let effectiveFrom = payload.effective_from as string | undefined;
  let effectiveTo = payload.effective_to as string | undefined;
  let isActive = payload.is_active as number | undefined;
  if (id && (effectiveFrom === undefined || effectiveTo === undefined || isActive === undefined)) {
    const existing = await env.LEDGER_DB.prepare(
      "SELECT effective_from, effective_to, is_active FROM mileage_rates WHERE id = ?1",
    ).bind(id).first<MileageRateRow>();
    if (!existing) throw new AdminError(404, "NOT_FOUND", "That mileage rate no longer exists.");
    effectiveFrom ??= existing.effective_from;
    effectiveTo ??= existing.effective_to;
    isActive ??= existing.is_active;
  }
  if (!effectiveFrom || !effectiveTo) return;
  if (effectiveTo < effectiveFrom) {
    throw new AdminError(422, "INVALID_MILEAGE_RATE", "The ending date must be on or after the starting date.");
  }
  if (isActive === 0) return;
  const overlap = await env.LEDGER_DB.prepare(
    `SELECT id FROM mileage_rates
     WHERE is_active = 1 AND (?1 IS NULL OR id <> ?1)
       AND NOT (effective_to < ?2 OR effective_from > ?3)
     LIMIT 1`,
  ).bind(id, effectiveFrom, effectiveTo).first();
  if (overlap) {
    throw new AdminError(409, "MILEAGE_RATE_OVERLAP", "This date range overlaps another active mileage rate.");
  }
}

export async function bookkeepingData(env: Env): Promise<Response> {
  const statements = [
    env.LEDGER_DB.prepare("SELECT * FROM app_settings WHERE owner_id = 'primary' LIMIT 1"),
    env.LEDGER_DB.prepare("SELECT * FROM categories ORDER BY sort_order, lower(name)"),
    env.LEDGER_DB.prepare("SELECT * FROM clients ORDER BY lower(name)"),
    env.LEDGER_DB.prepare("SELECT * FROM projects ORDER BY lower(name)"),
    env.LEDGER_DB.prepare("SELECT * FROM trip_templates WHERE is_active = 1 ORDER BY lower(name)"),
    env.LEDGER_DB.prepare("SELECT * FROM mileage_rates ORDER BY effective_from DESC, effective_to DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM income ORDER BY income_date DESC, created_at DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM income_payments ORDER BY payment_date DESC, created_at DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM mileage_entries ORDER BY mileage_date DESC, created_at DESC"),
    env.LEDGER_DB.prepare(
      `SELECT id, owner_id, record_type, expense_id, income_id, file_name, mime_type, size_bytes, created_at
       FROM attachments ORDER BY created_at DESC`,
    ),
    env.LEDGER_DB.prepare("SELECT * FROM invoices ORDER BY created_date DESC, created_at DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM invoice_items ORDER BY invoice_id, sort_order"),
    env.LEDGER_DB.prepare("SELECT * FROM invoice_profiles WHERE is_active = 1 ORDER BY lower(name)"),
    env.LEDGER_DB.prepare(
      `SELECT id, owner_id, client_id, project_id, linked_invoice_id, artifact_type, display_name,
         file_name, mime_type, size_bytes, source_url, notes, is_current, created_at, updated_at
       FROM client_artifacts WHERE is_current = 1 ORDER BY created_at DESC`,
    ),
    env.LEDGER_DB.prepare("SELECT * FROM paypal_ledger_activity ORDER BY transaction_date DESC, source_record_id DESC"),
    env.LEDGER_DB.prepare("SELECT * FROM ledger_sync_state WHERE id = 'paypal' LIMIT 1"),
  ];
  const results = await env.LEDGER_DB.batch(statements);
  const settings = results[0]?.results[0] ?? null;
  if (!settings) throw new AdminError(503, "DATABASE_NOT_READY", "The bookkeeping database has not been initialized.");
  return adminJson({
    settings,
    categories: results[1]?.results ?? [],
    clients: results[2]?.results ?? [],
    projects: results[3]?.results ?? [],
    trip_templates: results[4]?.results ?? [],
    mileage_rates: results[5]?.results ?? [],
    expenses: results[6]?.results ?? [],
    income: results[7]?.results ?? [],
    income_payments: results[8]?.results ?? [],
    mileage_entries: results[9]?.results ?? [],
    attachments: results[10]?.results ?? [],
    invoices: results[11]?.results ?? [],
    invoice_items: results[12]?.results ?? [],
    invoice_profiles: results[13]?.results ?? [],
    client_artifacts: results[14]?.results ?? [],
    paypal_activity: results[15]?.results ?? [],
    ledger_sync: results[16]?.results[0] ?? null,
  });
}

export async function createRecord(request: Request, env: Env, table: RecordTable): Promise<Response> {
  const body = await readAdminJson(request);
  const payload = normalizeRecordPayload(table, body);
  requireCreateFields(table, payload);
  await validateProjectRelationship(env, table, null, payload);
  await validateMileageRate(env, table, null, payload);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const columns = Object.keys(payload);
  const values = Object.values(payload);
  const allColumns = ["id", "owner_id", ...columns, "created_at", "updated_at"];
  const allValues = [id, OWNER_ID, ...values, now, now];
  const placeholders = allValues.map((_, index) => `?${index + 1}`);
  try {
    await env.LEDGER_DB.prepare(`INSERT INTO ${table} (${allColumns.join(", ")}) VALUES (${placeholders.join(", ")})`)
      .bind(...allValues)
      .run();
    await audit(env, table, id, "created");
  } catch (error) {
    databaseError(error);
  }
  const row = await env.LEDGER_DB.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(id).first();
  return adminJson({ record: row }, 201);
}

export async function updateRecord(request: Request, env: Env, table: RecordTable, id: string): Promise<Response> {
  const body = await readAdminJson(request);
  const payload = normalizeRecordPayload(table, body);
  if (!Object.keys(payload).length) throw new AdminError(422, "INVALID_RECORD", "No changes were provided.");
  await validateProjectRelationship(env, table, id, payload);
  await validateMileageRate(env, table, id, payload);
  payload.updated_at = new Date().toISOString();
  const columns = Object.keys(payload);
  const values = Object.values(payload);
  const setters = columns.map((column, index) => `${column} = ?${index + 1}`);
  try {
    const result = await env.LEDGER_DB.prepare(
      `UPDATE ${table} SET ${setters.join(", ")} WHERE id = ?${values.length + 1}`,
    ).bind(...values, id).run();
    if (!result.meta.changes) throw new AdminError(404, "NOT_FOUND", "That record no longer exists.");
    await audit(env, table, id, "updated");
  } catch (error) {
    if (error instanceof AdminError) throw error;
    databaseError(error);
  }
  const row = await env.LEDGER_DB.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(id).first();
  return adminJson({ record: row });
}

export async function deleteRecord(env: Env, table: RecordTable, id: string): Promise<Response> {
  const existing = await env.LEDGER_DB.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(id).first();
  if (!existing) throw new AdminError(404, "NOT_FOUND", "That record no longer exists.");
  if (table === "expenses" || table === "income") {
    await deleteAttachmentsForRecord(env, table === "expenses" ? "expense" : "income", id);
  }
  try {
    await env.LEDGER_DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
    await audit(env, table, id, "deleted");
  } catch (error) {
    databaseError(error);
  }
  return adminJson({ success: true });
}

export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const body = await readAdminJson(request);
  const payload: NormalizedRecord = {};
  put(payload, "business_name", requiredText(body, "business_name", 180));
  put(payload, "default_tax_year", integerValue(body, "default_tax_year", 2000, 2100));
  if (has(body, "currency_code")) {
    if (typeof body.currency_code !== "string" || !/^[A-Za-z]{3}$/.test(body.currency_code)) {
      throw new AdminError(422, "INVALID_RECORD", "Use a three-letter currency code.");
    }
    payload.currency_code = body.currency_code.toUpperCase();
  }
  put(payload, "mileage_rate", numberValue(body, "mileage_rate", 0, 100));
  put(payload, "contact_email", optionalText(body, "contact_email", 254));
  payload.updated_at = new Date().toISOString();
  const columns = Object.keys(payload);
  const values = Object.values(payload);
  const setters = columns.map((column, index) => `${column} = ?${index + 1}`);
  try {
    await env.LEDGER_DB.prepare(`UPDATE app_settings SET ${setters.join(", ")} WHERE owner_id = 'primary'`)
      .bind(...values)
      .run();
    await audit(env, "app_settings", OWNER_ID, "updated");
  } catch (error) {
    databaseError(error);
  }
  const settings = await env.LEDGER_DB.prepare("SELECT * FROM app_settings WHERE owner_id = 'primary'").first();
  return adminJson({ settings });
}
