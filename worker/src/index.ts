import {
  AdminError,
  adminJson,
  authenticate,
  changePassword,
  isAllowedOrigin,
  login,
  logout,
  sessionInfo,
} from "./security";
import {
  donorTransactions,
  exportTransactions,
  listTransactions,
  syncPayPal,
  updateTransactionProduct,
} from "./transactions";

function routePath(pathname: string): string {
  const stripped = pathname.replace(/^\/api\/admin(?=\/|$)/, "");
  return stripped || "/";
}

async function route(request: Request, env: Env, path: string, url: URL): Promise<Response> {
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
  if (request.method === "POST" && path === "/logout") return logout(request, env);
  if (request.method === "POST" && path === "/password") return changePassword(request, env);
  if (request.method === "POST" && path === "/paypal/sync") {
    await authenticate(request, env, true);
    return syncPayPal(request, env);
  }

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
    const path = routePath(url.pathname);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("origin");
      if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin!,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin",
        },
      });
    }
    try {
      return await route(request, env, path, url);
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
export { adminPasswordPolicyError, deriveAdminPasswordHash, isAllowedOrigin, secureEqual } from "./security";
