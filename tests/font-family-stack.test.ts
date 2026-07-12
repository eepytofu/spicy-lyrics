import assert from "node:assert/strict";
import test from "node:test";
import { toCssFontFamilyStack } from "../src/utils/cssFontFamily.ts";

test("font family stack preserves fallback order", () => {
  assert.equal(
    toCssFontFamilyStack('Inter, "Noto Sans JP", Segoe UI, sans-serif'),
    '"Inter", "Noto Sans JP", "Segoe UI", sans-serif'
  );
});

test("font family stack rejects CSS declaration injection", () => {
  assert.equal(toCssFontFamilyStack("Inter; color: red, serif"), "serif");
});
