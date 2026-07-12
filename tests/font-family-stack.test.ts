import assert from "node:assert/strict";
import test from "node:test";
import { toCssFontFamilyStack, toHanLanguageFontStack } from "../src/utils/cssFontFamily.ts";

test("font family stack preserves fallback order", () => {
  assert.equal(
    toCssFontFamilyStack('Inter, "Noto Sans JP", Segoe UI, sans-serif'),
    '"Inter", "Noto Sans JP", "Segoe UI", sans-serif'
  );
});

test("font family stack rejects CSS declaration injection", () => {
  assert.equal(toCssFontFamilyStack("Inter; color: red, serif"), "serif");
});

test("Han language stacks preserve the Latin font and reorder Noto fallbacks", () => {
  const stack = '"SF Pro Display", "Noto Sans JP", "Noto Sans SC", sans-serif';
  assert.equal(toHanLanguageFontStack(stack, "ja"), '"SF Pro Display", "Noto Sans JP", "Noto Sans SC", sans-serif');
  assert.equal(toHanLanguageFontStack(stack, "zh-Hans"), '"SF Pro Display", "Noto Sans SC", "Noto Sans JP", sans-serif');
});

test("Han language stacks insert missing Noto fallbacks before generic families", () => {
  assert.equal(
    toHanLanguageFontStack('"SF Pro Display", sans-serif', "ja"),
    '"SF Pro Display", "Noto Sans JP", "Noto Sans SC", sans-serif'
  );
});

test("Han language stacks put Noto ahead of secondary fallbacks", () => {
  assert.equal(
    toHanLanguageFontStack('"SF Pro Display", "Segoe UI", "Microsoft YaHei", sans-serif', "zh-Hans"),
    '"SF Pro Display", "Noto Sans SC", "Noto Sans JP", "Segoe UI", "Microsoft YaHei", sans-serif'
  );
});
