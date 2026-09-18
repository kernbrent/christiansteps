import {sharedRoutes,sharedEnabled,recordSharedActivity} from './shared-identity';
import {
  AdminError,
  adminJson,
  authenticate,
  changePassword,
  isAllowedOrigin,
  login,
  logout,
  requireAllowedOrigin,
  sessionInfo,
} from "./security";
import {
  createManualBankTransfer,
  donorTransactions,
  exportTransactions,
  listTransactions,
  syncPayPal,
  updateTransactionProduct,
} from "./transactions";
import { listDistributionOutbox, receiveDistributionStatus, sendDistributions } from "./distribution";
import { deleteAttachment, downloadAttachment, uploadAttachment } from "./attachments";
import { deleteClientArtifact, downloadClientArtifact, uploadClientArtifact } from "./artifacts";
import { invoiceBrandingAsset } from "./invoice-branding";
import {
  createInvoice,
  deleteInvoice,
  deleteInvoiceProfile,
  markInvoicePaid,
  updateInvoice,
} from "./invoices";
import {csmDonationSplit} from './donation-splits';
import { syncPayPalLedger } from "./ledger-paypal";
import {
  bookkeepingData,
  createRecord,
  deleteRecord,
  recordTable,
  updateRecord,
  updateSettings,
} from "./records";
import { createTripBatch } from "./trips";

function routePath(pathname: string): string {
  const stripped = pathname.replace(/^\/api\/admin(?=\/|$)/, "");
  return stripped || "/";
}

function decodedId(value: string): string {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new AdminError(400, "INVALID_ID", "That record reference is invalid.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(decoded)) {
    throw new AdminError(400, "INVALID_ID", "That record reference is invalid.");
  }
  return decoded;
}

async function requireMutation(request: Request, env: Env): Promise<void> {
  requireAllowedOrigin(request, env);
  await authenticate(request, env, true);
}

async function route(request: Request, env: Env, path: string, url: URL): Promise<Response> {
  const shared=await sharedRoutes(request,env,path);if(shared)return shared;
  if (request.method === "POST" && path === "/login") return login(request, env);
  if (request.method === "GET" && path === "/session") return sessionInfo(request, env);

  if (request.method === "GET" && path === "/transactions") {
    await authenticate(request, env);
    return listTransactions(env, url);
  }
  if (request.method === "GET" && path === "/transactions/export") {
    await authenticate(request, env);
    return exportTransactions(env);
  }
  if (request.method === "GET" && path === "/donors") {
    await authenticate(request, env);
    return donorTransactions(env, url);
  }
  if (request.method === "GET" && path === "/distribution/outbox") {
    await authenticate(request, env);
    return listDistributionOutbox(env, url);
  }
  if (request.method === "POST" && path === "/distribution/send") {
    await authenticate(request, env, true);
    return sendDistributions(request, env);
  }
  if (request.method === "POST" && path === "/logout") return logout(request, env);
  if (request.method === "POST" && path === "/password") return changePassword(request, env);
  if (request.method === "POST" && path === "/paypal/sync") {
    await authenticate(request, env, true);
    return syncPayPal(request, env);
  }
  if (request.method === "POST" && path === "/bank-transfers") {
    await requireMutation(request, env);
    return createManualBankTransfer(request, env);
  }

  if (request.method === "GET" && path === "/data") {
    await authenticate(request, env);
    if(!sharedEnabled(env)|| (await authenticate(request,env)).user?.is_admin || (await authenticate(request,env)).user?.permissions.finances==='edit')await syncPayPalLedger(env);
    return bookkeepingData(env);
  }
  if (request.method === "PATCH" && path === "/settings") {
    await requireMutation(request, env);
    return updateSettings(request, env);
  }
  if (request.method === "POST" && path === "/attachments") {
    await requireMutation(request, env);
    return uploadAttachment(request, env, url);
  }
  if (request.method === "POST" && path === "/trips/batch") {
    await requireMutation(request, env);
    return createTripBatch(request, env);
  }
  if (request.method === "POST" && path === "/artifacts") {
    await requireMutation(request, env);
    return uploadClientArtifact(request, env, url);
  }
  if (request.method === "POST" && path === "/invoices") {
    await requireMutation(request, env);
    return createInvoice(request, env);
  }

  const brandingMatch = path.match(/^\/invoice-assets\/(signature)$/);
  if (brandingMatch?.[1] && request.method === "GET") {
    await authenticate(request, env);
    return invoiceBrandingAsset(env, brandingMatch[1]);
  }

  const attachmentMatch = path.match(/^\/attachments\/([^/]+)$/);
  if (attachmentMatch?.[1]) {
    const id = decodedId(attachmentMatch[1]);
    if (request.method === "GET") {
      await authenticate(request, env);
      return downloadAttachment(env, id);
    }
    if (request.method === "DELETE") {
      await requireMutation(request, env);
      return deleteAttachment(env, id);
    }
  }

  const artifactMatch = path.match(/^\/artifacts\/([^/]+)$/);
  if (artifactMatch?.[1]) {
    const id = decodedId(artifactMatch[1]);
    if (request.method === "GET") {
      await authenticate(request, env);
      return downloadClientArtifact(env, id);
    }
    if (request.method === "DELETE") {
      await requireMutation(request, env);
      return deleteClientArtifact(env, id);
    }
  }

  const invoicePaidMatch = path.match(/^\/invoices\/([^/]+)\/paid$/);
  if (invoicePaidMatch?.[1] && request.method === "POST") {
    await requireMutation(request, env);
    return markInvoicePaid(request, env, decodedId(invoicePaidMatch[1]));
  }

  const invoiceMatch = path.match(/^\/invoices\/([^/]+)$/);
  if (invoiceMatch?.[1]) {
    const id = decodedId(invoiceMatch[1]);
    if (request.method === "PATCH") {
      await requireMutation(request, env);
      return updateInvoice(request, env, id);
    }
    if (request.method === "DELETE") {
      await requireMutation(request, env);
      return deleteInvoice(env, id);
    }
  }

  const profileMatch = path.match(/^\/invoice-profiles\/([^/]+)$/);
  if (profileMatch?.[1] && request.method === "DELETE") {
    await requireMutation(request, env);
    return deleteInvoiceProfile(env, decodedId(profileMatch[1]));
  }

  const recordsMatch = path.match(/^\/records\/([a-z_]+)(?:\/([^/]+))?$/);
  if (recordsMatch?.[1]) {
    const table = recordTable(recordsMatch[1]);
    if (!table) throw new AdminError(404, "NOT_FOUND", "Not found.");
    if (request.method === "POST" && !recordsMatch[2]) {
      await requireMutation(request, env);
      return createRecord(request, env, table);
    }
    if (recordsMatch[2]) {
      const id = decodedId(recordsMatch[2]);
      if (request.method === "PATCH") {
        await requireMutation(request, env);
        return updateRecord(request, env, table, id);
      }
      if (request.method === "DELETE") {
        await requireMutation(request, env);
        return deleteRecord(env, table, id);
      }
    }
  }

  const splitMatch=path.match(/^\/donation-splits\/(.+)$/);
  if(splitMatch && ['GET','PUT'].includes(request.method)){if(request.method==='PUT')requireAllowedOrigin(request,env);const session=await authenticate(request,env,request.method==='PUT');return csmDonationSplit(request,env,decodeURIComponent(splitMatch[1]!),session.user_id||`CSM admin session ${session.id}`);}
  const productMatch = path.match(/^\/transactions\/(.+)\/product$/);
  if (request.method === "POST" && productMatch?.[1]) {
    await authenticate(request, env, true);
    let transactionId = "";
    try {
      transactionId = decodeURIComponent(productMatch[1]);
    } catch {
      throw new AdminError(400, "INVALID_TRANSACTION", "This transaction reference is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,20}$/.test(transactionId)) {
      throw new AdminError(400, "INVALID_TRANSACTION", "This transaction reference is invalid.");
    }
    return updateTransactionProduct(request, env, transactionId);
  }

  throw new AdminError(404, "NOT_FOUND", "Not found.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/csm-distribution/status") {
      return receiveDistributionStatus(request, env);
    }
    const path = routePath(url.pathname);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("origin");
      if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin!,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-File-Name",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin",
        },
      });
    }
    try {
      const response=await route(request, env, path, url); if(sharedEnabled(env))await recordSharedActivity(request,env,response); return response;
    } catch (error) {
      if (error instanceof AdminError) {
        if (error.status >= 500) {
          console.error(JSON.stringify({ event: "admin_request_failed", code: error.code, path }));
        }
        return adminJson({ error: error.message, code: error.code }, error.status, error.headers);
      }
      console.error(JSON.stringify({
        event: "admin_unhandled_error",
        path,
        message: error instanceof Error ? error.message : "Unknown error",
      }));
      return adminJson({ error: "The Admin Portal encountered an unexpected error.", code: "SERVER_ERROR" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

export { routePath };
export { detectProduct, normalizeTransaction } from "./paypal";
export { adminPasswordPolicyError, deriveAdminPasswordHash, isAllowedOrigin, isValidUserId, secureEqual } from "./security";
