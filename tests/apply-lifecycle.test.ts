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
  const resetCalls = [
    "EmitNotApplyed()",
    "DestroyAllLyricsContainers()",
    "ClearLyricsContentArrays()",
    "ClearScrollSimplebar()",
    "ClearLyricsPageContainer()",
  ];
  const offsets = resetCalls.map((call) => source.indexOf(call));
  assert.equal(offsets.every((offset) => offset >= 0), true);
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
  assert.ok(source.indexOf("resetLyricsApplyState()") < source.indexOf("CreateLyricsContainer()"));
  assert.match(source, /initLyricsVirtualizer\(scrollElement, virtualContainer, lineElements\)/u);
  assert.match(source, /EmitApply\(data\.Type, content\)/u);
  assert.match(source, /setRomanizedStatus\(useRomanized\)/u);
});

test("the global dispatcher delegates valid lyric teardown to the shared lifecycle", () => {
  const source = readSource("../src/utils/Lyrics/Global/Applyer.ts");
  assert.doesNotMatch(source, /EmitNotApplyed/u);
  assert.doesNotMatch(source, /DestroyAllLyricsContainers/u);
  assert.doesNotMatch(source, /ClearLyricsContentArrays/u);
  assert.doesNotMatch(source, /ClearScrollSimplebar/u);
  assert.doesNotMatch(source, /ClearLyricsPageContainer/u);
  assert.match(source, /resetLyricsApplyState\(\);\s*ShowQueueLoader\(\)/u);
  assert.match(source, /if \(noticeContent\) \{\s*resetLyricsApplyState\(\)/u);
});

test("background processing has one renderer listener", () => {
  const appSource = readSource("../src/app.tsx");
  const pageSource = readSource("../src/components/Pages/PageView.ts");
  assert.doesNotMatch(appSource, /addEventListener\("spicy-lyrics:processing-ready"/u);
  assert.match(pageSource, /addEventListener\("spicy-lyrics:processing-ready"/u);
});
