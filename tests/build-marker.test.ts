import assert from "node:assert/strict";
import test from "node:test";
import { createBuildMarker } from "../project/buildMarker.ts";

test("fork builds identify their version and exact Git revision", () => {
  assert.equal(createBuildMarker("6.2.4", "F386888\n", false), "eepytofu-6.2.4-f386888");
});

test("fork builds identify uncommitted source and unavailable Git metadata", () => {
  assert.equal(createBuildMarker("6.2.4", "f386888", true), "eepytofu-6.2.4-f386888-dirty");
  assert.equal(createBuildMarker("6.2.4", undefined, false), "eepytofu-6.2.4-unknown");
});
