import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = resolve(workerDirectory, "public");
const sourceDirectory = resolve(workerDirectory, "..", "admin");
const destinationDirectory = resolve(publicDirectory, "admin");

if (destinationDirectory !== resolve(workerDirectory, "public", "admin")) {
  throw new Error("Refusing to replace an unexpected admin asset directory.");
}

await mkdir(publicDirectory, { recursive: true });
await rm(destinationDirectory, { recursive: true, force: true });
await cp(sourceDirectory, destinationDirectory, { recursive: true, force: true });
await writeFile(resolve(publicDirectory, "_headers"), `/admin
  Cache-Control: no-store, private, max-age=0
  Pragma: no-cache
  Expires: 0

/admin/*
  Cache-Control: no-store, private, max-age=0
  Pragma: no-cache
  Expires: 0
`, "utf8");

console.log("Admin assets refreshed from the canonical source with no-cache headers.");
