import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const adminScript = readFileSync(resolve(process.cwd(), "../admin/admin.js"), "utf8");
const adminPage = readFileSync(resolve(process.cwd(), "../admin/index.html"), "utf8");

describe("Admin dialog behavior", () => {
  it("keeps every dialog open when its backdrop is clicked", () => {
    expect(adminScript).toContain("preventDialogBackdropDismissal");
    expect(adminScript).toContain("event.stopImmediatePropagation()");
    expect(adminPage.match(/closedby="closerequest"/g)).toHaveLength(3);
  });
});
