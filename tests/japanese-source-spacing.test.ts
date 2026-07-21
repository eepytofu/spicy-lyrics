import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeNoSpaceBefore,
  type MergeableEntry,
} from "../src/utils/Lyrics/Fork/JukujikunMerge.ts";

function spacingFor(source: string, surfaces: string[]): boolean[] {
  let cursor = 0;
  const entries: MergeableEntry[] = surfaces.map((surface) => {
    const start = source.indexOf(surface, cursor);
    assert.notEqual(start, -1, `missing ${surface} in ${source}`);
    cursor = start + surface.length;
    return { surface, romaji: surface, consumed: false, start, end: cursor };
  });
  const tokens = surfaces.map((surface_form) => ({ surface_form }));
  return computeNoSpaceBefore(entries, tokens);
}

test("Japanese local romaji keeps source-attached slashes attached", () => {
  assert.deepEqual(
    spacingFor("D/N/A", ["D", "/", "N", "/", "A"]),
    [false, true, true, true, true],
  );
});

test("Japanese local romaji preserves explicitly spaced slashes", () => {
  assert.deepEqual(
    spacingFor("A / B", ["A", "/", "B"]),
    [false, false, false],
  );
  assert.deepEqual(
    spacingFor("A/ B", ["A", "/", "B"]),
    [false, true, false],
  );
  assert.deepEqual(
    spacingFor("A /B", ["A", "/", "B"]),
    [false, false, true],
  );
});
