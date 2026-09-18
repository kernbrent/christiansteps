import { AdminError, adminJson, securityHeaders } from "./security";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type AttachmentRow = {
  id: string;
  record_type: "expense" | "income";
  expense_id: string | null;
  income_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
};

type StoragePathRow = { storage_path: string };

function validId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(value);
}

function recordType(value: string | null): "expense" | "income" | null {
  return value === "expense" || value === "income" ? value : null;
}

function uploadedFileName(request: Request): string {
  const encoded = request.headers.get("x-file-name");
  if (!encoded || encoded.length > 720) throw new AdminError(422, "INVALID_FILE", "The attachment needs a file name.");
  let value = "";
  try {
    value = decodeURIComponent(encoded);
  } catch {
    throw new AdminError(422, "INVALID_FILE", "The attachment file name is invalid.");
  }
  value = value.replace(/[\\/\u0000-\u001F\u007F]/g, "-").trim();
  if (!value || value.length > 240) throw new AdminError(422, "INVALID_FILE", "The attachment file name is invalid.");
  return value;
}

function acceptedMimeType(request: Request, fileName: string): string {
  const requested = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (ALLOWED_TYPES.has(requested)) return requested;
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const inferred = EXTENSION_TYPES[extension];
  if (requested === "application/octet-stream" && inferred) return inferred;
  throw new AdminError(415, "UNSUPPORTED_FILE_TYPE", "Use an image, PDF, text, Word, or Excel file.");
}

async function audit(env: Env, attachmentId: string, eventType: string): Promise<void> {
  await env.LEDGER_DB.prepare(
    `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
     VALUES (?1, 'attachment', ?2, ?3, NULL, ?4)`,
  ).bind(crypto.randomUUID(), attachmentId, eventType, new Date().toISOString()).run();
}

export async function uploadAttachment(request: Request, env: Env, url: URL): Promise<Response> {
  const type = recordType(url.searchParams.get("recordType"));
  const recordId = url.searchParams.get("recordId");
  if (!type || !validId(recordId)) throw new AdminError(422, "INVALID_FILE", "Choose a valid expense or income record.");
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new AdminError(411, "FILE_SIZE_REQUIRED", "The attachment size could not be verified.");
  }
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    throw new AdminError(413, "FILE_TOO_LARGE", "Attachments must be 15 MB or smaller.");
  }
  if (!request.body) throw new AdminError(422, "EMPTY_FILE", "Choose a non-empty attachment.");
  const fileName = uploadedFileName(request);
  const mimeType = acceptedMimeType(request, fileName);
  const table = type === "expense" ? "expenses" : "income";
  const exists = await env.LEDGER_DB.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(recordId).first();
  if (!exists) throw new AdminError(404, "NOT_FOUND", "The related bookkeeping record no longer exists.");

  const id = crypto.randomUUID();
  const storagePath = `${type}/${recordId}/${id}`;
  const createdAt = new Date().toISOString();
  await env.LEDGER_ATTACHMENTS.put(storagePath, request.body, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { attachmentId: id, recordType: type },
  });
  try {
    await env.LEDGER_DB.prepare(
      `INSERT INTO attachments (
        id, owner_id, record_type, expense_id, income_id, storage_path, file_name, mime_type, size_bytes, created_at
      ) VALUES (?1, 'primary', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      id,
      type,
      type === "expense" ? recordId : null,
      type === "income" ? recordId : null,
      storagePath,
      fileName,
      mimeType,
      contentLength,
      createdAt,
    ).run();
    await audit(env, id, "uploaded");
  } catch (error) {
    await env.LEDGER_ATTACHMENTS.delete(storagePath);
    throw error;
  }
  return adminJson({
    attachment: {
      id,
      owner_id: "primary",
      record_type: type,
      expense_id: type === "expense" ? recordId : null,
      income_id: type === "income" ? recordId : null,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: contentLength,
      created_at: createdAt,
    },
  }, 201);
}

export async function downloadAttachment(env: Env, id: string): Promise<Response> {
  if (!validId(id)) throw new AdminError(404, "NOT_FOUND", "Attachment not found.");
  const attachment = await env.LEDGER_DB.prepare(
    `SELECT id, record_type, expense_id, income_id, storage_path, file_name, mime_type, size_bytes, created_at
     FROM attachments WHERE id = ?1`,
  ).bind(id).first<AttachmentRow>();
  if (!attachment) throw new AdminError(404, "NOT_FOUND", "Attachment not found.");
  const object = await env.LEDGER_ATTACHMENTS.get(attachment.storage_path);
  if (!object?.body) throw new AdminError(404, "FILE_NOT_FOUND", "The stored attachment could not be found.");
  const headers = securityHeaders();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", attachment.mime_type || "application/octet-stream");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  const fallback = attachment.file_name.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/["\\]/g, "-");
  headers.set("Content-Disposition", `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`);
  return new Response(object.body, { status: 200, headers });
}

export async function deleteAttachment(env: Env, id: string): Promise<Response> {
  if (!validId(id)) throw new AdminError(404, "NOT_FOUND", "Attachment not found.");
  const attachment = await env.LEDGER_DB.prepare("SELECT storage_path FROM attachments WHERE id = ?1")
    .bind(id)
    .first<StoragePathRow>();
  if (!attachment) throw new AdminError(404, "NOT_FOUND", "Attachment not found.");
  await env.LEDGER_ATTACHMENTS.delete(attachment.storage_path);
  await env.LEDGER_DB.prepare("DELETE FROM attachments WHERE id = ?1").bind(id).run();
  await audit(env, id, "deleted");
  return adminJson({ success: true });
}

export async function deleteAttachmentsForRecord(
  env: Env,
  type: "expense" | "income",
  recordId: string,
): Promise<void> {
  const field = type === "expense" ? "expense_id" : "income_id";
  const result = await env.LEDGER_DB.prepare(`SELECT storage_path FROM attachments WHERE ${field} = ?1`)
    .bind(recordId)
    .all<StoragePathRow>();
  await Promise.all(result.results.map(item => env.LEDGER_ATTACHMENTS.delete(item.storage_path)));
}
