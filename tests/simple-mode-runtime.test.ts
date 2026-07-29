import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("emphasis timing reads the current Simple Mode at render time", () => {
  const source = readSource("../src/utils/Lyrics/Applyer/Utils/Emphasize.ts");
  assert.match(source, /const emphasisTimingOffsets = \(\) => \(\{[\s\S]*\$simpleLyricsMode\.get\(\)/u);
  assert.match(source, /const timingOffsets = emphasisTimingOffsets\(\);/u);
  assert.doesNotMatch(source, /const Substractions/u);
});
