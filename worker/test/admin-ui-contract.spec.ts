import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const adminScript = readFileSync(resolve(testDirectory, "../../admin/admin.js"), "utf8");
const adminPage = readFileSync(resolve(testDirectory, "../../admin/index.html"), "utf8");

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
});
