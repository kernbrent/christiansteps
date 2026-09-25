import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const adminScript = readFileSync(resolve(testDirectory, "../../admin/admin.js"), "utf8");
const adminPage = readFileSync(resolve(testDirectory, "../../admin/index.html"), "utf8");
const ledgerPage = readFileSync(resolve(testDirectory, "../../admin/ledger/index.html"), "utf8");
const ledgerScript = readFileSync(resolve(testDirectory, "../../admin/ledger/assets/app.js"), "utf8");
const ledgerStyles = readFileSync(resolve(testDirectory, "../../admin/ledger/assets/admin.css"), "utf8");
const personalGiftsPage = readFileSync(resolve(testDirectory, "../../admin/personal-gifts/index.html"), "utf8");
const personalGiftProcessPage = readFileSync(resolve(testDirectory, "../../admin/personal-gifts/process.html"), "utf8");
const accountPage = readFileSync(resolve(testDirectory, "../../admin/account/index.html"), "utf8");
const accessPage = readFileSync(resolve(testDirectory, "../../admin/access/index.html"), "utf8");
const portalNavigationStyles = readFileSync(resolve(testDirectory, "../../admin/portal-navigation.css"), "utf8");
const sharedNavigationScript = readFileSync(resolve(testDirectory, "../../admin/shared-navigation.js"), "utf8");

describe("Admin Portal refresh contract", () => {
  it("reloads the transaction view after synchronization and accepts both count contracts", () => {
    expect(adminScript).toContain("await loadTransactions({ throwOnError: true, showError: false })");
    expect(adminScript).toContain("result.recordsFound ?? result.found ?? 0");
    expect(adminScript).toContain("result.recordsInserted ?? result.inserted ?? 0");
    expect(adminScript).toContain("result.recordsUpdated ?? result.updated ?? 0");
  });

  it("forces fresh API reads and unique workbook downloads", () => {
    expect(adminScript).toContain('cache: isRead ? "no-store" : options.cache');
    expect(adminScript).toContain('url.searchParams.set("_fresh", String(Date.now()))');
    expect(adminScript).toContain("generatedStamp");
  });

  it("uses versioned Admin Portal assets", () => {
    expect(adminPage).toMatch(/admin\.css\?v=\d{8}\.\d+/);
    expect(adminPage).toMatch(/admin\.js\?v=\d{8}\.\d+/);
    expect(adminPage).toMatch(/favicon\.png\?v=\d{8}\.\d+/);
  });

  it("requires a manual submission while preserving saved-password autofill", () => {
    const startup = adminScript.match(/function boot\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";
    expect(startup).not.toContain('api("/session")');
    expect(startup).not.toContain("showPortal(");
    expect(adminScript).toContain('byId("login-form").addEventListener("submit", signIn)');
    expect(adminPage).toMatch(/<input id="login-user-id" name="userId" type="text" autocomplete="username" required/);
    expect(adminPage).toContain('<label for="login-user-id">User ID</label>');
    expect(adminPage).toContain('autocomplete="current-password"');
    expect(adminScript).toContain('userId: form.get("userId")');
    expect(adminScript).not.toContain('localStorage.setItem(REMEMBER_ME_PREFERENCE_KEY, byId("login-password").value)');
  });

  it("links the giving portal to the isolated ministry ledger", () => {
    expect(adminPage).toContain('href="/admin/ledger/"');
    expect(ledgerPage).toContain('data-route="paypal"');
    expect(ledgerPage).toContain('href="../"');
    expect(ledgerScript).toContain("PayPal remains the source of truth");
    expect(ledgerScript).toContain("Due to JBB");
  });

  it("recovers a stale security token and keeps dialog errors readable", () => {
    expect(ledgerScript).toContain('error.code === "CSRF_REJECTED"');
    expect(ledgerScript).toContain('apiRequest("/session", { retryCsrf: false })');
    expect(ledgerScript).toContain('target.className = "form-message dialog-form-error"');
    expect(ledgerStyles).toContain(".dialog-form-error");
  });

  it("accepts non-invoice income using the amount received", () => {
    const incomeFormSource = ledgerScript.match(/function incomeForm[\s\S]*?function tripWeekDates/)?.[0] || "";
    const saveIncomeSource = ledgerScript.match(/async function saveIncome[\s\S]*?function showMileageDuplicateWarning/)?.[0] || "";
    expect(incomeFormSource).toContain('invoice_date: ""');
    expect(incomeFormSource).toContain("Invoice amount (only if invoiced)");
    expect(incomeFormSource).not.toMatch(/name="amount"[^>]*required/);
    expect(saveIncomeSource).toContain("const recordAmount = invoiceAmount > 0 ? invoiceAmount : initialPayment");
    expect(saveIncomeSource).toContain("Enter an invoice amount when invoice details are provided.");
    expect(saveIncomeSource).toContain("Enter either an invoice amount or an amount received.");
    expect(saveIncomeSource).toContain("amount: recordAmount");
  });

  it("versions both ledger assets after interface changes", () => {
    expect(ledgerPage).toMatch(/admin\.css\?v=\d{8}\.\d+/);
    expect(ledgerPage).toMatch(/app\.js\?v=\d{8}\.\d+/);
  });

  it("provides left-side navigation throughout the CSM portal", () => {
    expect(adminPage).toContain('class="portal csm-portal-shell"');
    expect(adminPage).toContain('class="csm-portal-sidebar"');
    expect(personalGiftsPage).toContain('class="csm-portal-sidebar"');
    expect(personalGiftProcessPage).toContain('class="csm-portal-sidebar"');
    expect(ledgerPage).toContain('class="sidebar" id="sidebar"');
    expect(accountPage).toContain('class="finance-sidebar"');
    expect(accessPage).toContain('class="finance-sidebar"');
    expect(portalNavigationStyles).toContain("grid-template-columns: 16.5rem minmax(0, 1fr)");
    expect(sharedNavigationScript).toContain('icon.className = "csm-nav-mark"');
  });
});
