import { AdminError, adminJson, readAdminJson } from "./security";

const OWNER_ID = "primary";
const MAX_BATCH_DATES = 31;
const RECORD_STATUS = ["included", "excluded", "needs_review"] as const;
const PROGRAMS = ["ChristianSteps", "HopeSojourns", "Shared"] as const;

type JsonRecord = Record<string, unknown>;
type RecordStatus = typeof RECORD_STATUS[number];
type Program = typeof PROGRAMS[number];

export type NormalizedTripBatch = {
  dates: string[];
  origin: string;
  destination: string;
  businessPurpose: string;
  miles: number;
  program: Program;
  clientId: string | null;
  projectId: string | null;
  recordStatus: RecordStatus;
  cpaReview: boolean;
  cpaNotes: string | null;
  notes: string | null;
  tollAmount: number;
  tollVendor: string;
  tollPaymentMethod: string | null;
  templateId: string | null;
  templateName: string | null;
  allowDuplicates: boolean;
};

type ProjectRow = { client_id: string };
type TemplateRow = { id: string };
type CategoryRow = { id: string };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function requiredText(body: JsonRecord, key: string, maximum: number, label: string): string {
  if (typeof body[key] !== "string") throw new AdminError(422, "INVALID_TRIP", `${label} is required.`);
  const value = body[key].trim();
  if (!value || value.length > maximum) {
    throw new AdminError(422, "INVALID_TRIP", `${label} must contain between 1 and ${maximum} characters.`);
  }
  return value;
}

function optionalText(body: JsonRecord, key: string, maximum: number): string | null {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null;
  if (typeof body[key] !== "string") throw new AdminError(422, "INVALID_TRIP", `${key} must be text.`);
  const value = body[key].trim();
  if (!value) return null;
  if (value.length > maximum) throw new AdminError(422, "INVALID_TRIP", `${key} is too long.`);
  return value;
}

function optionalId(body: JsonRecord, key: string): string | null {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null;
  if (typeof body[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(body[key])) {
    throw new AdminError(422, "INVALID_TRIP", `${key} is invalid.`);
  }
  return body[key];
}

function boundedNumber(body: JsonRecord, key: string, minimum: number, maximum: number, label: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AdminError(422, "INVALID_TRIP", `${label} is outside the allowed range.`);
  }
  return value;
}

export function normalizeTripBatchPayload(body: JsonRecord): NormalizedTripBatch {
  if (!Array.isArray(body.dates) || body.dates.length < 1 || body.dates.length > MAX_BATCH_DATES) {
    throw new AdminError(422, "INVALID_TRIP", `Choose between 1 and ${MAX_BATCH_DATES} trip dates.`);
  }
  if (!body.dates.every(validDate)) throw new AdminError(422, "INVALID_TRIP", "Every trip date must be a valid date.");
  const dates = [...new Set(body.dates)].sort();
  const recordStatus = body.record_status;
  if (typeof recordStatus !== "string" || !RECORD_STATUS.includes(recordStatus as RecordStatus)) {
    throw new AdminError(422, "INVALID_TRIP", "Choose a valid record status.");
  }
  if (typeof body.cpa_review !== "boolean") {
    throw new AdminError(422, "INVALID_TRIP", "CPA review must be true or false.");
  }
  if (body.allow_duplicates !== undefined && typeof body.allow_duplicates !== "boolean") {
    throw new AdminError(422, "INVALID_TRIP", "The duplicate choice must be true or false.");
  }
  const program = body.program;
  if (typeof program !== "string" || !PROGRAMS.includes(program as Program)) {
    throw new AdminError(422, "INVALID_TRIP", "Choose a valid ministry program.");
  }
  const tollAmount = boundedNumber(body, "toll_amount", 0, 999_999.99, "Toll amount");
  return {
    dates,
    origin: requiredText(body, "origin", 240, "Origin"),
    destination: requiredText(body, "destination", 240, "Destination"),
    businessPurpose: requiredText(body, "business_purpose", 500, "Business purpose"),
    miles: boundedNumber(body, "miles", 0.01, 999_999.99, "Miles"),
    program: program as Program,
    clientId: optionalId(body, "client_id"),
    projectId: optionalId(body, "project_id"),
    recordStatus: recordStatus as RecordStatus,
    cpaReview: body.cpa_review,
    cpaNotes: optionalText(body, "cpa_notes", 10_000),
    notes: optionalText(body, "notes", 10_000),
    tollAmount,
    tollVendor: optionalText(body, "toll_vendor", 180) || "Tolls",
    tollPaymentMethod: optionalText(body, "toll_payment_method", 100),
    templateId: optionalId(body, "template_id"),
    templateName: optionalText(body, "template_name", 100),
    allowDuplicates: body.allow_duplicates === true,
  };
}

async function validateRelationships(env: Env, input: NormalizedTripBatch): Promise<void> {
  if (input.projectId && !input.clientId) {
    throw new AdminError(422, "INVALID_TRIP", "Choose a client for the selected project.");
  }
  if (input.projectId) {
    const project = await env.LEDGER_DB.prepare("SELECT client_id FROM projects WHERE id = ?1")
      .bind(input.projectId)
      .first<ProjectRow>();
    if (!project || project.client_id !== input.clientId) {
      throw new AdminError(422, "INVALID_TRIP", "The selected project does not belong to that client.");
    }
  } else if (input.clientId) {
    const client = await env.LEDGER_DB.prepare("SELECT id FROM clients WHERE id = ?1").bind(input.clientId).first();
    if (!client) throw new AdminError(422, "INVALID_TRIP", "The selected client no longer exists.");
  }
}

function tollDescription(input: NormalizedTripBatch): string {
  return `Tolls: ${input.origin} to ${input.destination}`;
}

export async function createTripBatch(request: Request, env: Env): Promise<Response> {
  const input = normalizeTripBatchPayload(await readAdminJson(request));
  await validateRelationships(env, input);

  let templateId = input.templateId;
  if (templateId) {
    const template = await env.LEDGER_DB.prepare("SELECT id FROM trip_templates WHERE id = ?1 AND is_active = 1")
      .bind(templateId)
      .first<TemplateRow>();
    if (!template) throw new AdminError(422, "INVALID_TRIP", "The selected saved trip is no longer available.");
  }
  if (input.templateName) {
    const existing = await env.LEDGER_DB.prepare("SELECT id FROM trip_templates WHERE lower(name) = lower(?1)")
      .bind(input.templateName)
      .first<TemplateRow>();
    if (existing) throw new AdminError(409, "DUPLICATE_TEMPLATE", "A saved trip with that name already exists.");
    templateId = crypto.randomUUID();
  }

  let tollCategoryId: string | null = null;
  if (input.tollAmount > 0) {
    const category = await env.LEDGER_DB.prepare(
      "SELECT id FROM categories WHERE lower(name) = 'tolls' ORDER BY is_active DESC LIMIT 1",
    ).first<CategoryRow>();
    if (!category) throw new AdminError(503, "TOLL_CATEGORY_MISSING", "Add a Tolls expense category before logging tolls.");
    tollCategoryId = category.id;
  }

  const duplicateChecks: D1PreparedStatement[] = [];
  const duplicateKinds: Array<{ date: string; type: "mileage" | "toll" }> = [];
  for (const date of input.dates) {
    duplicateChecks.push(env.LEDGER_DB.prepare(
      `SELECT id FROM mileage_entries
       WHERE mileage_date = ?1 AND lower(origin) = lower(?2) AND lower(destination) = lower(?3)
         AND abs(miles - ?4) < 0.000001 LIMIT 1`,
    ).bind(date, input.origin, input.destination, input.miles));
    duplicateKinds.push({ date, type: "mileage" });
    if (input.tollAmount > 0) {
      duplicateChecks.push(env.LEDGER_DB.prepare(
        `SELECT id FROM expenses
         WHERE expense_date = ?1 AND category_id = ?2 AND lower(vendor) = lower(?3)
           AND lower(COALESCE(description, '')) = lower(?4) AND abs(amount - ?5) < 0.000001 LIMIT 1`,
      ).bind(date, tollCategoryId, input.tollVendor, tollDescription(input), input.tollAmount));
      duplicateKinds.push({ date, type: "toll" });
    }
  }
  const duplicateResults = duplicateChecks.length ? await env.LEDGER_DB.batch(duplicateChecks) : [];
  const duplicates = duplicateKinds.filter((_, index) => (duplicateResults[index]?.results.length ?? 0) > 0);
  if (duplicates.length && !input.allowDuplicates) {
    return adminJson({
      error: "Possible duplicate trip records were found. Review the selected dates, or save again to include them.",
      code: "POSSIBLE_DUPLICATE",
      details: { duplicates },
    }, 409);
  }

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (input.templateName && templateId) {
    statements.push(env.LEDGER_DB.prepare(
      `INSERT INTO trip_templates (
         id, owner_id, name, origin, destination, business_purpose, miles, toll_amount,
         toll_vendor, payment_method, client_id, project_id, program, notes, is_active, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?16)`,
    ).bind(
      templateId, OWNER_ID, input.templateName, input.origin, input.destination,
      input.businessPurpose, input.miles, input.tollAmount, input.tollVendor,
      input.tollPaymentMethod, input.clientId, input.projectId, input.program, input.notes, now, now,
    ));
  }

  for (const date of input.dates) {
    const mileageId = crypto.randomUUID();
    const taxYear = Number(date.slice(0, 4));
    statements.push(env.LEDGER_DB.prepare(
      `INSERT INTO mileage_entries (
         id, owner_id, mileage_date, origin, destination, business_purpose, miles, program, client_id,
         project_id, tax_year, record_status, cpa_review, cpa_notes, notes, created_at, updated_at,
         trip_batch_id, trip_template_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
    ).bind(
      mileageId, OWNER_ID, date, input.origin, input.destination, input.businessPurpose,
      input.miles, input.program, input.clientId, input.projectId, taxYear, input.recordStatus,
      input.cpaReview ? 1 : 0, input.cpaNotes, input.notes, now, now, batchId, templateId,
    ));
    if (input.tollAmount > 0 && tollCategoryId) {
      statements.push(env.LEDGER_DB.prepare(
        `INSERT INTO expenses (
           id, owner_id, expense_date, vendor, amount, program, category_id, description, business_purpose,
           payment_method, client_id, project_id, tax_year, reimbursable, reimbursed,
           deductibility_percent, record_status, cpa_review, cpa_notes, notes, created_at, updated_at,
           trip_batch_id, trip_template_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, 0, 100, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
      ).bind(
        crypto.randomUUID(), OWNER_ID, date, input.tollVendor, input.tollAmount, input.program,
        tollCategoryId, tollDescription(input), input.businessPurpose, input.tollPaymentMethod,
        input.clientId, input.projectId, taxYear, input.recordStatus, input.cpaReview ? 1 : 0,
        input.cpaNotes, input.notes, now, now, batchId, templateId,
      ));
    }
  }
  statements.push(env.LEDGER_DB.prepare(
    `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
     VALUES (?1, 'trip_batch', ?2, 'created', ?3, ?4)`,
  ).bind(crypto.randomUUID(), batchId, JSON.stringify({
    mileageCount: input.dates.length,
    tollCount: input.tollAmount > 0 ? input.dates.length : 0,
    templateId,
  }), now));

  try {
    await env.LEDGER_DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed.*trip_templates/i.test(message)) {
      throw new AdminError(409, "DUPLICATE_TEMPLATE", "A saved trip with that name already exists.");
    }
    if (/FOREIGN KEY constraint failed/i.test(message)) {
      throw new AdminError(422, "INVALID_TRIP", "A selected client, project, category, or saved trip is no longer available.");
    }
    if (/CHECK constraint failed|NOT NULL constraint failed/i.test(message)) {
      throw new AdminError(422, "INVALID_TRIP", "Review the trip details and try again.");
    }
    throw error;
  }

  return adminJson({
    batchId,
    mileageCount: input.dates.length,
    tollCount: input.tollAmount > 0 ? input.dates.length : 0,
    templateId,
  }, 201);
}
