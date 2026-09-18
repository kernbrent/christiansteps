import { AdminError, adminJson, readAdminJson } from "./security";

const OWNER_ID = "primary";
const MAX_ARTIFACT_BYTES = 15 * 1024 * 1024;
const ARTIFACT_TYPES = ["contract", "mou", "logo", "invoice", "signature", "other"] as const;
type ArtifactType = typeof ARTIFACT_TYPES[number];

type ArtifactRow = {
  id: string;
  client_id: string | null;
  artifact_type: ArtifactType;
  display_name: string;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  source_url: string | null;
};

type ArtifactContext = {
  type: ArtifactType;
  clientId: string | null;
  projectId: string | null;
  invoiceId: string | null;
  displayName: string;
  notes: string | null;
};

const GENERAL_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/plain", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const INVOICE_MIME_TYPES = new Set([
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function decodedHeader(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function cleanText(value: unknown, maximum: number, required = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new AdminError(422, "INVALID_ARTIFACT", "Complete the required file name.");
    return null;
  }
  if (typeof value !== "string") throw new AdminError(422, "INVALID_ARTIFACT", "File details must be text.");
  const result = value.trim();
  if ((!result && required) || result.length > maximum) {
    throw new AdminError(422, "INVALID_ARTIFACT", "A file detail is missing or too long.");
  }
  return result || null;
}

function idValue(value: string | null, label: string, required = false): string | null {
  if (!value && !required) return null;
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(value)) {
    throw new AdminError(422, "INVALID_ARTIFACT", `${label} is invalid.`);
  }
  return value;
}

function artifactType(value: string | null): ArtifactType {
  if (!value || !ARTIFACT_TYPES.includes(value as ArtifactType)) {
    throw new AdminError(422, "INVALID_ARTIFACT", "Choose a valid file type.");
  }
  return value as ArtifactType;
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) {
    throw new AdminError(422, "INVALID_ARTIFACT", "Enter a valid HTTPS URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AdminError(422, "INVALID_ARTIFACT", "Enter a valid HTTPS URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const compactHostname = hostname.replace(/^\[|\]$/g, "");
  const blocked = hostname === "localhost" || hostname.endsWith(".local") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
    compactHostname === "::1" || compactHostname.startsWith("fc") || compactHostname.startsWith("fd") ||
    compactHostname.startsWith("fe8") || compactHostname.startsWith("fe9") || compactHostname.startsWith("fea") ||
    compactHostname.startsWith("feb") || compactHostname.startsWith("::ffff:");
  if (parsed.protocol !== "https:" || blocked || parsed.username || parsed.password) {
    throw new AdminError(422, "INVALID_ARTIFACT", "Use a public HTTPS URL without embedded credentials.");
  }
  return parsed.toString();
}

function fileNameSafe(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").trim();
  if (!cleaned || cleaned.length > 240) {
    throw new AdminError(422, "INVALID_ARTIFACT", "The file name is missing or too long.");
  }
  return cleaned;
}

function assertMime(type: ArtifactType, mime: string): void {
  const allowed = type === "logo" || type === "signature"
    ? LOGO_MIME_TYPES
    : type === "invoice"
      ? INVOICE_MIME_TYPES
      : GENERAL_MIME_TYPES;
  if (!allowed.has(mime)) {
    throw new AdminError(415, "UNSUPPORTED_FILE", "That file format is not supported for this type of document.");
  }
}

async function validateContext(env: Env, context: ArtifactContext): Promise<void> {
  if (context.type !== "signature" && !context.clientId) {
    throw new AdminError(422, "INVALID_ARTIFACT", "Choose a client for this file.");
  }
  if (context.clientId) {
    const client = await env.LEDGER_DB.prepare("SELECT id FROM clients WHERE id = ?1").bind(context.clientId).first();
    if (!client) throw new AdminError(422, "INVALID_ARTIFACT", "The selected client no longer exists.");
  }
  if (context.projectId) {
    const project = await env.LEDGER_DB.prepare("SELECT client_id FROM projects WHERE id = ?1")
      .bind(context.projectId)
      .first<{ client_id: string }>();
    if (!project || project.client_id !== context.clientId) {
      throw new AdminError(422, "INVALID_ARTIFACT", "The selected project does not belong to this client.");
    }
  }
  if (context.invoiceId) {
    const invoice = await env.LEDGER_DB.prepare("SELECT client_id FROM invoices WHERE id = ?1")
      .bind(context.invoiceId)
      .first<{ client_id: string }>();
    if (!invoice || invoice.client_id !== context.clientId) {
      throw new AdminError(422, "INVALID_ARTIFACT", "The selected invoice does not belong to this client.");
    }
  }
}

function contextFromUrl(url: URL, displayNameFallback: string): ArtifactContext {
  const type = artifactType(url.searchParams.get("type"));
  return {
    type,
    clientId: idValue(url.searchParams.get("clientId"), "clientId"),
    projectId: idValue(url.searchParams.get("projectId"), "projectId"),
    invoiceId: idValue(url.searchParams.get("invoiceId"), "invoiceId"),
    displayName: cleanText(url.searchParams.get("displayName") || displayNameFallback, 240, true)!,
    notes: cleanText(url.searchParams.get("notes"), 2_000),
  };
}

async function insertArtifact(
  env: Env,
  context: ArtifactContext,
  details: { storagePath: string | null; fileName: string | null; mimeType: string | null; sizeBytes: number | null; sourceUrl: string | null },
): Promise<Response> {
  const artifactId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.LEDGER_DB.prepare(
    `INSERT INTO client_artifacts (
       id, owner_id, client_id, project_id, linked_invoice_id, artifact_type, display_name,
       storage_path, file_name, mime_type, size_bytes, source_url, notes, is_current, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14, ?14)`,
  ).bind(
    artifactId, OWNER_ID, context.clientId, context.projectId, context.invoiceId, context.type,
    context.displayName, details.storagePath, details.fileName, details.mimeType, details.sizeBytes,
    details.sourceUrl, context.notes, now,
  ).run();
  const artifact = await env.LEDGER_DB.prepare(
    `SELECT id, owner_id, client_id, project_id, linked_invoice_id, artifact_type, display_name,
       file_name, mime_type, size_bytes, source_url, notes, is_current, created_at, updated_at
     FROM client_artifacts WHERE id = ?1`,
  ).bind(artifactId).first();
  return adminJson({ artifact }, 201);
}

export async function uploadClientArtifact(request: Request, env: Env, url: URL): Promise<Response> {
  const contentType = (request.headers.get("content-type") || "application/octet-stream").split(";")[0]!.trim().toLowerCase();
  if (contentType === "application/json") {
    const body = await readAdminJson(request);
    const displayName = cleanText(body.display_name, 240, true)!;
    const context = contextFromUrl(url, displayName);
    context.displayName = displayName;
    context.notes = cleanText(body.notes, 2_000);
    await validateContext(env, context);
    return insertArtifact(env, context, {
      storagePath: null,
      fileName: null,
      mimeType: context.type === "logo" ? "image/external" : null,
      sizeBytes: null,
      sourceUrl: safeUrl(body.source_url),
    });
  }

  const fileName = fileNameSafe(decodedHeader(request.headers.get("x-file-name")));
  const context = contextFromUrl(url, fileName);
  await validateContext(env, context);
  assertMime(context.type, contentType);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_ARTIFACT_BYTES) {
    throw new AdminError(413, "FILE_TOO_LARGE", "Files must be 15 MB or smaller.");
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new AdminError(422, "EMPTY_FILE", "Choose a non-empty file.");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new AdminError(413, "FILE_TOO_LARGE", "Files must be 15 MB or smaller.");
  }
  const artifactId = crypto.randomUUID();
  const storagePath = `artifacts/${context.clientId || "business"}/${context.type}/${artifactId}/${fileName}`;
  await env.LEDGER_ATTACHMENTS.put(storagePath, bytes, {
    httpMetadata: { contentType },
    customMetadata: { originalName: fileName, artifactType: context.type },
  });
  try {
    return await insertArtifact(env, context, {
      storagePath,
      fileName,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
      sourceUrl: null,
    });
  } catch (error) {
    await env.LEDGER_ATTACHMENTS.delete(storagePath);
    throw error;
  }
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new AdminError(502, "ARTIFACT_UNAVAILABLE", "The linked file could not be opened.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new AdminError(413, "FILE_TOO_LARGE", "The linked file is too large to open here.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadClientArtifact(env: Env, artifactId: string): Promise<Response> {
  const artifact = await env.LEDGER_DB.prepare("SELECT * FROM client_artifacts WHERE id = ?1 AND is_current = 1")
    .bind(artifactId)
    .first<ArtifactRow>();
  if (!artifact) throw new AdminError(404, "NOT_FOUND", "That file no longer exists.");
  if (artifact.source_url) {
    const response = await fetch(safeUrl(artifact.source_url), { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new AdminError(502, "ARTIFACT_REDIRECT", "This link redirects. Save the final public HTTPS URL instead.");
    }
    if (!response.ok || !response.body) {
      throw new AdminError(502, "ARTIFACT_UNAVAILABLE", "The linked file could not be opened.");
    }
    const length = Number(response.headers.get("content-length") || "0");
    if (length > MAX_ARTIFACT_BYTES) throw new AdminError(413, "FILE_TOO_LARGE", "The linked file is too large to open here.");
    const mimeType = (response.headers.get("content-type") || artifact.mime_type || "application/octet-stream").split(";")[0]!.trim().toLowerCase();
    if (artifact.artifact_type === "logo" || artifact.artifact_type === "signature") assertMime(artifact.artifact_type, mimeType);
    const bytes = await boundedResponseBytes(response);
    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Disposition", `inline; filename="${fileNameSafe(artifact.display_name).replaceAll('"', "")}"`);
    return new Response(bytes, { headers });
  }
  if (!artifact.storage_path) throw new AdminError(404, "NOT_FOUND", "That file no longer exists.");
  const object = await env.LEDGER_ATTACHMENTS.get(artifact.storage_path);
  if (!object) throw new AdminError(404, "NOT_FOUND", "That file no longer exists.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", artifact.mime_type || headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  const disposition = artifact.artifact_type === "logo" || artifact.artifact_type === "signature" || artifact.mime_type === "application/pdf"
    ? "inline"
    : "attachment";
  headers.set("Content-Disposition", `${disposition}; filename="${fileNameSafe(artifact.file_name || artifact.display_name).replaceAll('"', "")}"`);
  return new Response(object.body, { headers });
}

export async function deleteClientArtifact(env: Env, artifactId: string): Promise<Response> {
  const artifact = await env.LEDGER_DB.prepare("SELECT storage_path FROM client_artifacts WHERE id = ?1")
    .bind(artifactId)
    .first<{ storage_path: string | null }>();
  if (!artifact) throw new AdminError(404, "NOT_FOUND", "That file no longer exists.");
  await env.LEDGER_DB.prepare("DELETE FROM client_artifacts WHERE id = ?1").bind(artifactId).run();
  if (artifact.storage_path) await env.LEDGER_ATTACHMENTS.delete(artifact.storage_path);
  return adminJson({ success: true });
}
