import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const updateSource = readFileSync(
  new URL("../src/utils/version/CheckForUpdates.tsx", import.meta.url),
  "utf8",
);

test("fork does not advertise the original project's automatic updater", () => {
  assert.match(updateSource, /const ENABLE_UPSTREAM_UPDATE_NOTICE = false/u);
  assert.match(updateSource, /isDev \|\| !ENABLE_UPSTREAM_UPDATE_NOTICE/u);
});
