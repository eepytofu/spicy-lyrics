import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("the build configuration and committed lockfile use npm consistently", () => {
  const config = readFileSync(new URL("../spice.config.ts", import.meta.url), "utf8");
  assert.match(config, /packageManager:\s*["']npm["']/u);
  assert.equal(existsSync(new URL("../package-lock.json", import.meta.url)), true);
  assert.equal(existsSync(new URL("../bun.lock", import.meta.url)), false);
  assert.ok(repositoryRoot);
});
