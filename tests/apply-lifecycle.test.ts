import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("all lyric applyers share one container, credits, scrolling, styling, and emit lifecycle", () => {
  for (const relativePath of [
    "../src/utils/Lyrics/Applyer/Static.ts",
    "../src/utils/Lyrics/Applyer/Synced/Line.ts",
    "../src/utils/Lyrics/Applyer/Synced/Syllable.ts",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /beginLyricsApply/u);
    assert.match(source, /finishLyricsApply/u);
    assert.doesNotMatch(source, /DestroyAllLyricsContainers/u);
    assert.doesNotMatch(source, /ApplyLyricsCredits/u);
    assert.doesNotMatch(source, /initLyricsVirtualizer/u);
    assert.doesNotMatch(source, /LyricsStylingContainer/u);
  }
});

test("the shared lifecycle keeps the apply order and virtualizer inputs explicit", () => {
  const source = readSource("../src/utils/Lyrics/Applyer/ApplyLifecycle.ts");
  const orderedCalls = [
    "EmitNotApplyed()",
    "DestroyAllLyricsContainers()",
    "CreateLyricsContainer()",
    "ClearLyricsContentArrays()",
    "ClearScrollSimplebar()",
    "ClearLyricsPageContainer()",
  ];
  const offsets = orderedCalls.map((call) => source.indexOf(call));
  assert.equal(offsets.every((offset) => offset >= 0), true);
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
  assert.match(source, /initLyricsVirtualizer\(scrollElement, virtualContainer, lineElements\)/u);
  assert.match(source, /EmitApply\(data\.Type, content\)/u);
  assert.match(source, /setRomanizedStatus\(useRomanized\)/u);
});
