import { AdminError } from "./security";

export async function invoiceBrandingAsset(env: Env, name: string): Promise<Response> {
  if (name !== "signature") throw new AdminError(404, "NOT_FOUND", "That invoice asset does not exist.");
  const signature = await env.LEDGER_DB.prepare(
    `SELECT storage_path, file_name, mime_type
     FROM client_artifacts
     WHERE artifact_type = 'signature' AND client_id IS NULL AND is_current = 1 AND storage_path IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
  ).first<{ storage_path: string; file_name: string | null; mime_type: string | null }>();
  if (!signature) {
    throw new AdminError(404, "SIGNATURE_NOT_CONFIGURED", "Upload the Christian Steps Ministries signature in Client Files before generating an invoice.");
  }
  const object = await env.LEDGER_ATTACHMENTS.get(signature.storage_path);
  if (!object) throw new AdminError(404, "SIGNATURE_NOT_CONFIGURED", "The saved business signature file could not be found.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", signature.mime_type || "image/png");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `inline; filename="${(signature.file_name || "career-steps-signature.png").replaceAll('"', "")}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
