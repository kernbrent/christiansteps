import { describe, expect, it } from "vitest";
import {
  adminPasswordPolicyError,
  deriveAdminPasswordHash,
  isAllowedOrigin,
  secureEqual,
} from "../src/index";

describe("admin security helpers", () => {
  it("accepts the approved initial password and rejects weak replacements", () => {
    expect(adminPasswordPolicyError("ExamplePortal2016!")).toBeNull();
    expect(adminPasswordPolicyError("short")).toMatch(/12 characters/i);
    expect(adminPasswordPolicyError("alllowercaseletters")).toMatch(/three of/i);
  });

  it("derives repeatable hashes and compares values safely", async () => {
    const salt = new Uint8Array(16).fill(7);
    const first = await deriveAdminPasswordHash("ExamplePortal2016!", salt, 1_000);
    const second = await deriveAdminPasswordHash("ExamplePortal2016!", salt, 1_000);
    expect(first).toBe(second);
    expect(await secureEqual(first, second)).toBe(true);
    expect(await secureEqual(first, `${second}x`)).toBe(false);
  });

  it("allows only the configured Christian Steps origins", () => {
    const allowed = "https://christiansteps.net,https://www.christiansteps.net";
    expect(isAllowedOrigin("https://christiansteps.net", allowed)).toBe(true);
    expect(isAllowedOrigin("https://www.christiansteps.net", allowed)).toBe(true);
    expect(isAllowedOrigin("https://example.com", allowed)).toBe(false);
  });
});
