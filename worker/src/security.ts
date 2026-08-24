const ADMIN_BODY_LIMIT = 64 * 1024;
const SESSION_HOURS = 8;
const REMEMBER_SESSION_DAYS = 30;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_FAILURE_LIMIT = 5;
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;

type AdminEnv = Env & {
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
};

type AdminSessionRow = {
  id: string;
  csrf_token: string;
  expires_at: string;
};

type LoginAttemptRow = {
  failure_count: number;
  window_started_at: string;
  blocked_until: string | null;
};

type AdminCredentialRow = {
  algorithm: string;
  password_salt: string;
  password_hash: string;
  iterations: number;
};

type CloudflareSubtleCrypto = SubtleCrypto & {
  timingSafeEqual?(left: ArrayBuffer | ArrayBufferView, right: ArrayBuffer | ArrayBufferView): boolean;
};

export class AdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message);
  }
}

export function securityHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store, private",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}

export function adminJson(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readAdminJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = (request.headers.get("content-type")?.split(";", 1)[0] ?? "").trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new AdminError(415, "UNSUPPORTED_MEDIA_TYPE", "Send this request as JSON.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > ADMIN_BODY_LIMIT) {
    throw new AdminError(413, "REQUEST_TOO_LARGE", "This request is too large.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > ADMIN_BODY_LIMIT) {
    throw new AdminError(413, "REQUEST_TOO_LARGE", "This request is too large.");
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) throw new Error("Expected an object.");
    return value;
  } catch {
    throw new AdminError(400, "INVALID_JSON", "This request could not be read.");
  }
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: string): boolean {
  if (!origin) return false;
  return allowedOrigins
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .some(allowedOrigin => {
      if (allowedOrigin === origin) return true;
      if (!allowedOrigin.endsWith(":*")) return false;
      try {
        const requested = new URL(origin);
        const allowed = new URL(allowedOrigin.slice(0, -2));
        return requested.protocol === allowed.protocol && requested.hostname === allowed.hostname;
      } catch {
        return false;
      }
    });
}

export function requireAllowedOrigin(request: Request, env: AdminEnv): void {
  if (!isAllowedOrigin(request.headers.get("origin"), env.ALLOWED_ORIGINS)) {
    throw new AdminError(403, "ORIGIN_REJECTED", "This request did not come from an approved Christian Steps page.");
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const subtle = crypto.subtle as CloudflareSubtleCrypto;
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(leftHash, rightHash);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index]! ^ rightBytes[index]!;
  return difference === 0;
}

function requireSessionSecret(env: AdminEnv): string {
  if (!env.ADMIN_SESSION_SECRET) {
    throw new AdminError(503, "ADMIN_NOT_CONFIGURED", "The Admin Portal is not configured yet.");
  }
  return env.ADMIN_SESSION_SECRET;
}

export async function deriveAdminPasswordHash(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PASSWORD_HASH_ITERATIONS,
): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PASSWORD_HASH_ITERATIONS) {
    throw new Error(`PBKDF2 iterations must be between 1 and ${PASSWORD_HASH_ITERATIONS}.`);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations,
  }, key, 256);
  return base64Url(new Uint8Array(bits));
}

export function adminPasswordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 12) return "Use at least 12 characters for the new password.";
  if (password.length > 128) return "Use no more than 128 characters for the new password.";
  if (/[\u0000-\u001F\u007F]/.test(password)) return "The new password cannot contain control characters.";
  const categories = [
    /\p{Lu}/u.test(password),
    /\p{Ll}/u.test(password),
    /\p{N}/u.test(password),
    /[^\p{L}\p{N}\s]/u.test(password),
  ].filter(Boolean).length;
  return categories < 3
    ? "Use at least three of these: uppercase letters, lowercase letters, numbers, and symbols."
    : null;
}

async function storedAdminCredential(env: AdminEnv): Promise<AdminCredentialRow | null> {
  return env.DB.prepare(
    "SELECT algorithm, password_salt, password_hash, iterations FROM admin_credentials WHERE id = 'primary' LIMIT 1",
  ).first<AdminCredentialRow>();
}

async function verifyAdminPassword(env: AdminEnv, password: string): Promise<boolean> {
  const credential = await storedAdminCredential(env);
  if (!credential) {
    if (!env.ADMIN_PASSWORD) throw new AdminError(503, "ADMIN_NOT_CONFIGURED", "The Admin Portal is not configured yet.");
    return secureEqual(password, env.ADMIN_PASSWORD);
  }
  const salt = base64UrlBytes(credential.password_salt);
  if (
    credential.algorithm !== "PBKDF2-SHA256" ||
    !salt ||
    salt.byteLength !== PASSWORD_SALT_BYTES ||
    credential.iterations !== PASSWORD_HASH_ITERATIONS ||
    !/^[A-Za-z0-9_-]{40,60}$/.test(credential.password_hash)
  ) {
    console.error(JSON.stringify({ event: "admin_credential_invalid" }));
    throw new AdminError(503, "ADMIN_NOT_CONFIGURED", "The Admin Portal is not configured yet.");
  }
  return secureEqual(
    await deriveAdminPasswordHash(password, salt, credential.iterations),
    credential.password_hash,
  );
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const item of cookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookie(token: string, maxAgeSeconds: number | null): string {
  const persistence = maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`;
  return `cs_admin_session=${token}; Path=/api/admin${persistence}; HttpOnly; Secure; SameSite=Strict`;
}

export async function authenticate(request: Request, env: AdminEnv, requireCsrf = false): Promise<AdminSessionRow> {
  const token = cookieValue(request, "cs_admin_session");
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new AdminError(401, "AUTH_REQUIRED", "Sign in to continue.");
  }
  const tokenHash = await hashText(token);
  const session = await env.DB.prepare(
    "SELECT id, csrf_token, expires_at FROM admin_sessions WHERE token_hash = ?1 LIMIT 1",
  ).bind(tokenHash).first<AdminSessionRow>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    if (session) await env.DB.prepare("DELETE FROM admin_sessions WHERE id = ?1").bind(session.id).run();
    throw new AdminError(401, "SESSION_EXPIRED", "Your session expired. Sign in again.", {
      "Set-Cookie": sessionCookie("", 0),
    });
  }
  if (requireCsrf) {
    const csrf = request.headers.get("x-csrf-token") ?? "";
    if (!csrf || !(await secureEqual(csrf, session.csrf_token))) {
      throw new AdminError(403, "CSRF_REJECTED", "Refresh the Admin Portal and try again.");
    }
  }
  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), session.id)
    .run();
  return session;
}

function auditStatement(
  env: AdminEnv,
  entityType: string,
  entityId: string,
  eventType: string,
  metadata?: unknown,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_events (id, entity_type, entity_id, event_type, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(
    crypto.randomUUID(),
    entityType,
    entityId,
    eventType,
    metadata === undefined ? null : JSON.stringify(metadata),
    new Date().toISOString(),
  );
}

async function audit(env: AdminEnv, entityType: string, entityId: string, eventType: string, metadata?: unknown): Promise<void> {
  await auditStatement(env, entityType, entityId, eventType, metadata).run();
}

async function loginKey(request: Request, sessionSecret: string): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  return hashText(`${sessionSecret}:login:${address}`);
}

async function checkLoginBlock(env: AdminEnv, keyHash: string): Promise<LoginAttemptRow | null> {
  const attempt = await env.DB.prepare(
    "SELECT failure_count, window_started_at, blocked_until FROM admin_login_attempts WHERE key_hash = ?1",
  ).bind(keyHash).first<LoginAttemptRow>();
  if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(attempt.blocked_until) - Date.now()) / 1000));
    throw new AdminError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.", {
      "Retry-After": String(retryAfter),
    });
  }
  return attempt;
}

async function recordLoginFailure(env: AdminEnv, keyHash: string, current: LoginAttemptRow | null): Promise<void> {
  const now = new Date();
  const inCurrentWindow = Boolean(
    current && Date.parse(current.window_started_at) > now.getTime() - LOGIN_WINDOW_MINUTES * 60_000,
  );
  const failureCount = inCurrentWindow && current ? current.failure_count + 1 : 1;
  const windowStartedAt = inCurrentWindow && current ? current.window_started_at : now.toISOString();
  const blockedUntil = failureCount >= LOGIN_FAILURE_LIMIT
    ? new Date(now.getTime() + LOGIN_WINDOW_MINUTES * 60_000).toISOString()
    : null;
  await env.DB.prepare(
    `INSERT INTO admin_login_attempts (key_hash, failure_count, window_started_at, blocked_until, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (key_hash) DO UPDATE SET
       failure_count = excluded.failure_count,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`,
  ).bind(keyHash, failureCount, windowStartedAt, blockedUntil, now.toISOString()).run();
  if (blockedUntil) {
    throw new AdminError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.", {
      "Retry-After": String(LOGIN_WINDOW_MINUTES * 60),
    });
  }
}

export async function login(request: Request, env: AdminEnv): Promise<Response> {
  requireAllowedOrigin(request, env);
  const sessionSecret = requireSessionSecret(env);
  const body = await readAdminJson(request);
  const password = typeof body.password === "string" ? body.password : "";
  const rememberMe = body.rememberMe === true;
  const keyHash = await loginKey(request, sessionSecret);
  const attempt = await checkLoginBlock(env, keyHash);
  if (!password || password.length > 256 || !(await verifyAdminPassword(env, password))) {
    await recordLoginFailure(env, keyHash, attempt);
    console.warn(JSON.stringify({ event: "admin_login_failed" }));
    throw new AdminError(401, "INVALID_CREDENTIALS", "The password is incorrect.");
  }

  const now = new Date();
  const lifetimeSeconds = rememberMe ? REMEMBER_SESSION_DAYS * 86_400 : SESSION_HOURS * 3_600;
  const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1000);
  const token = randomToken();
  const csrfToken = randomToken(24);
  const userAgent = request.headers.get("user-agent") ?? "";
  const userAgentHash = userAgent ? await hashText(`${sessionSecret}:ua:${userAgent}`) : null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_login_attempts WHERE key_hash = ?1").bind(keyHash),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?1").bind(now.toISOString()),
    env.DB.prepare(
      `INSERT INTO admin_sessions (id, token_hash, csrf_token, created_at, expires_at, last_seen_at, user_agent_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      crypto.randomUUID(),
      await hashText(token),
      csrfToken,
      now.toISOString(),
      expiresAt.toISOString(),
      now.toISOString(),
      userAgentHash,
    ),
  ]);
  await audit(env, "admin_session", "portal", "login", { remembered: rememberMe });
  return adminJson({ authenticated: true, csrfToken, expiresAt: expiresAt.toISOString() }, 200, {
    "Set-Cookie": sessionCookie(token, rememberMe ? lifetimeSeconds : null),
  });
}

export async function sessionInfo(request: Request, env: AdminEnv): Promise<Response> {
  requireSessionSecret(env);
  const session = await authenticate(request, env);
  return adminJson({ authenticated: true, csrfToken: session.csrf_token, expiresAt: session.expires_at });
}

export async function logout(request: Request, env: AdminEnv): Promise<Response> {
  requireAllowedOrigin(request, env);
  const session = await authenticate(request, env, true);
  await env.DB.prepare("DELETE FROM admin_sessions WHERE id = ?1").bind(session.id).run();
  await audit(env, "admin_session", session.id, "logout");
  return adminJson({ success: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export async function changePassword(request: Request, env: AdminEnv): Promise<Response> {
  requireAllowedOrigin(request, env);
  const session = await authenticate(request, env, true);
  const body = await readAdminJson(request);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (!currentPassword || currentPassword.length > 256 || !(await verifyAdminPassword(env, currentPassword))) {
    throw new AdminError(422, "INVALID_CURRENT_PASSWORD", "The current password is incorrect.");
  }
  const policyError = adminPasswordPolicyError(newPassword);
  if (policyError) throw new AdminError(422, "INVALID_NEW_PASSWORD", policyError);
  if (!(await secureEqual(newPassword, confirmPassword))) {
    throw new AdminError(422, "PASSWORDS_DO_NOT_MATCH", "The new passwords do not match.");
  }
  if (await secureEqual(currentPassword, newPassword)) {
    throw new AdminError(422, "PASSWORD_UNCHANGED", "Choose a new password that is different from the current password.");
  }

  const salt = new Uint8Array(PASSWORD_SALT_BYTES);
  crypto.getRandomValues(salt);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO admin_credentials (id, algorithm, password_salt, password_hash, iterations, created_at, updated_at)
       VALUES ('primary', 'PBKDF2-SHA256', ?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (id) DO UPDATE SET
         algorithm = excluded.algorithm,
         password_salt = excluded.password_salt,
         password_hash = excluded.password_hash,
         iterations = excluded.iterations,
         updated_at = excluded.updated_at`,
    ).bind(
      base64Url(salt),
      await deriveAdminPasswordHash(newPassword, salt),
      PASSWORD_HASH_ITERATIONS,
      now,
      now,
    ),
    env.DB.prepare("DELETE FROM admin_sessions WHERE id <> ?1").bind(session.id),
    auditStatement(env, "admin_credential", "primary", "password_changed"),
  ]);
  return adminJson({ success: true, otherSessionsEnded: true });
}
