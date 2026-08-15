import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertChineseLyricsText } from "../src/utils/Lyrics/ChineseCharacterConversion.ts";
import { collectTranslationLineRefs } from "../src/utils/Lyrics/Fork/TranslationLines.ts";
import { lyricsLineSnapshots } from "../src/utils/Lyrics/LyricsCandidateSelector.ts";
import {
  indexedVisibleLyricsEntries,
  isProviderInfoEntry,
  isProviderInfoEvidence,
  isProviderInfoKind,
  providerInfoKind,
  shouldHideProviderInfoEntry,
} from "../src/utils/Lyrics/ProviderInfo.ts";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("provider-info markers are additive and filtering preserves source identity", () => {
  const lines = [
    { Text: "title", ProviderInfoKind: "trackHeader" },
    { Text: "credit", ProviderInfoKind: "credit" },
    { Text: "lyric" },
    { Text: "holder", ProviderInfoKind: "rightsHolder" },
    { Text: "rights", ProviderInfoKind: "rightsNotice" },
    { Text: "campaign", ProviderInfoKind: "providerNotice" },
  ];

  assert.equal(providerInfoKind(lines[0]), "trackHeader");
  assert.equal(providerInfoKind(lines[3]), "rightsHolder");
  assert.equal(providerInfoKind({ ProviderInfoKind: "unknown" }), undefined);
  assert.equal(isProviderInfoKind("providerNotice"), true);
  assert.equal(isProviderInfoKind("unknown"), false);
  assert.equal(isProviderInfoEntry(lines[4]), true);
  assert.equal(shouldHideProviderInfoEntry(lines[0], false), false);
  assert.equal(shouldHideProviderInfoEntry(lines[5], false), true);
  assert.deepEqual(
    indexedVisibleLyricsEntries(lines, (line) => line, true),
    [{ entry: lines[2], sourceIndex: 2 }],
  );
  assert.deepEqual(
    indexedVisibleLyricsEntries(lines, (line) => line, false).map(({ sourceIndex }) => sourceIndex),
    [0, 1, 2, 3, 4],
  );
});

test("marked rows and the frozen legacy fallback do not contribute Smart Match evidence", () => {
  const lyrics = {
    Type: "Line",
    Content: [
      { Text: "普通歌词", StartTime: 1, EndTime: 2 },
      { Text: "unrecognized info", StartTime: 2, EndTime: 3, ProviderInfoKind: "credit" },
      { Text: "作词：legacy", StartTime: 3, EndTime: 4 },
    ],
  };

  assert.deepEqual(lyricsLineSnapshots(lyrics).map(({ text }) => text), ["普通歌词"]);
  assert.equal(isProviderInfoEvidence({}, "composer: legacy"), true);
  assert.equal(isProviderInfoEvidence({}, "喧笑："), false);
  assert.equal(isProviderInfoEvidence({}, "water: falling"), false);
});

test("provider-info rows are excluded from Han conversion and translation inputs", () => {
  const lyrics = {
    Type: "Static",
    Lines: [
      { Text: "作詞：繁體", ProviderInfoKind: "credit" },
      { Text: "風裡" },
    ],
  };

  convertChineseLyricsText(lyrics, "simplified", () => true);
  assert.equal(lyrics.Lines[0].Text, "作詞：繁體");
  assert.equal(lyrics.Lines[1].Text, "风里");
  assert.deepEqual(
    collectTranslationLineRefs(lyrics).map(({ sourceText }) => sourceText),
    ["风里"],
  );

  const timed = {
    Type: "Syllable",
    Content: [{
      Lead: {
        ProviderInfoKind: "credit",
        Syllables: [{ Text: "作詞：繁體" }],
      },
      Background: [{ Syllables: [{ Text: "背景繁體" }] }],
    }],
  };
  convertChineseLyricsText(timed, "simplified", () => true);
  assert.equal(timed.Content[0].Lead.Syllables[0].Text, "作詞：繁體");
  assert.equal(timed.Content[0].Background[0].Syllables[0].Text, "背景繁體");
});

test("line-timed backgrounds remain translation inputs", () => {
  const lyrics = {
    Type: "Line",
    Content: [{
      Text: "lead",
      Background: [{ Text: "background" }],
    }],
  };

  assert.deepEqual(
    collectTranslationLineRefs(lyrics).map(({ sourceText }) => sourceText),
    ["lead", "background"],
  );
});

test("processing skips provider-info rows before cleanup or readings", () => {
  const source = readSource("../src/utils/Lyrics/ProcessLyrics.ts");
  assert.match(source, /for \(const line of lyrics\.Lines\) \{\s*if \(isProviderInfoEntry\(line\)\) continue;\s*const textProjection = projectLyricsText/u);
  assert.match(source, /for \(const vocalGroup of lyrics\.Content\) \{\s*if \(isProviderInfoEntry\(vocalGroup\)\) continue;/u);
  assert.match(source, /if \(isProviderInfoEntry\(vocalGroup\.Lead\)\) continue;/u);
});

test("all native renderers filter complete marked rows and keep source indices", () => {
  for (const relativePath of [
    "../src/utils/Lyrics/Applyer/Static.ts",
    "../src/utils/Lyrics/Applyer/Synced/Line.ts",
    "../src/utils/Lyrics/Applyer/Synced/Syllable.ts",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /indexedVisibleLyricsEntries/u, relativePath);
    assert.match(source, /\$hideEmbeddedProviderInfo\.get\(\)/u, relativePath);
    assert.match(source, /spicyLyricsLineId = `lead:\$\{sourceIndex\}`/u, relativePath);
    assert.match(source, /visibleLines\.map\(\(\{ entry \}\) => entry\)/u, relativePath);
  }
});

test("copy filtering covers Static, Line, and Syllable shapes before formatting", () => {
  const source = readSource("../src/utils/Lyrics/CopyLyrics.ts");
  assert.match(source, /lyrics\.Type === "Static"[\s\S]*?!shouldHideProviderInfoEntry\(line, hideProviderInfo\)/u);
  assert.match(source, /lyrics\.Type === "Line"[\s\S]*?shouldHideProviderInfoEntry\(line, hideProviderInfo\)/u);
  assert.match(source, /lyrics\.Type === "Syllable"[\s\S]*?shouldHideProviderInfoEntry\(group\?\.Lead, hideProviderInfo\)/u);
  assert.match(source, /hideProviderInfo = \$hideEmbeddedProviderInfo\.get\(\)/u);
});
