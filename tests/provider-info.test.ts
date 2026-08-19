import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertChineseLyricsText } from "../src/utils/Lyrics/ChineseCharacterConversion.ts";
import { collectTranslationLineRefs } from "../src/utils/Lyrics/Fork/TranslationLines.ts";
import { lyricsLineSnapshots } from "../src/utils/Lyrics/LyricsCandidateSelector.ts";
import {
  isProviderInfoEntry,
  isProviderInfoMatchingEvidence,
  isProviderInfoKind,
  providerInfoKind,
} from "../src/utils/Lyrics/ProviderInfo.ts";
import {
  indexedVisibleLyricsEntries,
  shouldExcludeFromLyricsMatching,
  shouldExcludeLyricsCopyEntry,
  shouldHideLyricsDisplayEntry,
  shouldSkipGeneratedLyricsProcessing,
} from "../src/utils/Lyrics/LyricsSemanticPolicy.ts";

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("provider-line consumer policies keep provider info and vocal cues as separate axes", () => {
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
  assert.equal(shouldSkipGeneratedLyricsProcessing(lines[0]), true);
  assert.equal(shouldExcludeFromLyricsMatching(lines[0], lines[0].Text), true);
  assert.equal(shouldHideLyricsDisplayEntry(lines[0], {
    hideProviderInfo: false,
    showVocalistLabels: true,
  }), false);
  assert.equal(shouldExcludeLyricsCopyEntry(lines[5], {
    hideProviderInfo: false,
    showVocalistLabels: true,
  }), true);

  const cue = {
    Type: "Vocal",
    Text: "小月白：",
    StartTime: 35.489,
    EndTime: 35.968,
    OppositeAligned: false,
    VocalCue: { Label: "小月白", Form: "labelColon" },
  };
  assert.equal(isProviderInfoEntry(cue), false);
  assert.equal(shouldSkipGeneratedLyricsProcessing(cue), false);
  assert.equal(shouldExcludeFromLyricsMatching(cue, cue.Text), true);
  assert.equal(shouldHideLyricsDisplayEntry(cue, {
    hideProviderInfo: false,
    showVocalistLabels: true,
  }), false);
  assert.equal(shouldExcludeLyricsCopyEntry(cue, {
    hideProviderInfo: true,
    showVocalistLabels: false,
  }), true);

  const ttmlLine = { Text: "ordinary", VocalAgentId: "duet", SongPart: "Chorus" };
  assert.equal(shouldSkipGeneratedLyricsProcessing(ttmlLine), false);
  assert.equal(shouldExcludeFromLyricsMatching(ttmlLine, ttmlLine.Text), false);
  assert.equal(shouldHideLyricsDisplayEntry(ttmlLine, {
    hideProviderInfo: true,
    showVocalistLabels: false,
  }), false);
  assert.equal(shouldExcludeLyricsCopyEntry(ttmlLine, {
    hideProviderInfo: true,
    showVocalistLabels: false,
  }), false);
});

test("display filtering preserves source identity and source indices", () => {
  const lines = [
    { Text: "title", ProviderInfoKind: "trackHeader" },
    { Text: "credit", ProviderInfoKind: "credit" },
    { Text: "lyric" },
    { Text: "holder", ProviderInfoKind: "rightsHolder" },
    { Text: "rights", ProviderInfoKind: "rightsNotice" },
    { Text: "campaign", ProviderInfoKind: "providerNotice" },
  ];
  assert.deepEqual(
    indexedVisibleLyricsEntries(lines, (line) => line, {
      hideProviderInfo: true,
      showVocalistLabels: true,
    }),
    [{ entry: lines[2], sourceIndex: 2 }],
  );
  assert.deepEqual(
    indexedVisibleLyricsEntries(lines, (line) => line, {
      hideProviderInfo: false,
      showVocalistLabels: true,
    }).map(({ sourceIndex }) => sourceIndex),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    indexedVisibleLyricsEntries(
      [...lines, { Text: "合：", VocalCue: { Label: "合", Form: "labelColon" } }],
      (line) => line,
      { hideProviderInfo: false, showVocalistLabels: false },
    ).map(({ sourceIndex }) => sourceIndex),
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
      { Text: "合：", StartTime: 4, EndTime: 5, VocalCue: { Label: "合", Form: "labelColon" } },
    ],
  };

  assert.deepEqual(lyricsLineSnapshots(lyrics).map(({ text }) => text), ["普通歌词"]);
  assert.equal(isProviderInfoMatchingEvidence({}, "composer: legacy"), true);
  assert.equal(isProviderInfoMatchingEvidence({}, "喧笑："), false);
  assert.equal(isProviderInfoMatchingEvidence({}, "water: falling"), false);
});

test("provider-info rows skip generated work while vocal cues use ordinary lyric processing", () => {
  const lyrics = {
    Type: "Static",
    Lines: [
      { Text: "作詞：繁體", ProviderInfoKind: "credit" },
      { Text: "小月白：", VocalCue: { Label: "小月白", Form: "labelColon" } },
      { Text: "風裡" },
    ],
  };

  convertChineseLyricsText(lyrics, "simplified", () => true);
  assert.equal(lyrics.Lines[0].Text, "作詞：繁體");
  assert.equal(lyrics.Lines[1].Text, "小月白：");
  assert.equal(lyrics.Lines[2].Text, "风里");
  assert.deepEqual(
    collectTranslationLineRefs(lyrics).map(({ sourceText }) => sourceText),
    ["小月白：", "风里"],
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
  assert.match(source, /for \(const line of lyrics\.Lines\) \{\s*if \(shouldSkipGeneratedLyricsProcessing\(line\)\) continue;\s*const textProjection = projectLyricsText/u);
  assert.match(source, /for \(const vocalGroup of lyrics\.Content\) \{\s*if \(shouldSkipGeneratedLyricsProcessing\(vocalGroup\)\) continue;/u);
  assert.match(source, /if \(shouldSkipGeneratedLyricsProcessing\(vocalGroup\.Lead\)\) continue;/u);
});

test("all native renderers filter complete marked rows and keep source indices", () => {
  for (const relativePath of [
    "../src/utils/Lyrics/Applyer/Static.ts",
    "../src/utils/Lyrics/Applyer/Synced/Line.ts",
    "../src/utils/Lyrics/Applyer/Synced/Syllable.ts",
  ]) {
    const source = readSource(relativePath);
    assert.match(source, /indexedVisibleLyricsEntries/u, relativePath);
    assert.match(source, /shouldSkipGeneratedLyricsProcessing/u, relativePath);
    assert.match(source, /\$hideEmbeddedProviderInfo\.get\(\)/u, relativePath);
    assert.match(source, /\$showVocalistLabels\.get\(\)/u, relativePath);
    assert.match(source, /spicyLyricsLineId = `lead:\$\{sourceIndex\}`/u, relativePath);
    assert.match(source, /visibleLines\.map\(\(\{ entry \}\) => entry\)/u, relativePath);
  }
});

test("format-specific render traversal preserves timing, backgrounds, and seek topology", () => {
  const staticSource = readSource("../src/utils/Lyrics/Applyer/Static.ts");
  assert.match(staticSource, /indexedVisibleLyricsEntries\(\s*data\.Lines,/u);
  assert.doesNotMatch(staticSource, /appendInterludeLine/u);

  const lineSource = readSource("../src/utils/Lyrics/Applyer/Synced/Line.ts");
  assert.match(lineSource, /indexedVisibleLyricsEntries\(\s*data\.Content,/u);
  assert.match(lineSource, /arr\[index \+ 1\]\?\.entry\.StartTime/u);
  assert.match(lineSource, /line\.Background\?\.forEach\(\(background, backgroundIndex\)/u);
  assert.match(
    lineSource,
    /spicyLyricsLineId = `background:\$\{sourceIndex\}:\$\{backgroundIndex\}`/u,
  );
  assert.match(lineSource, /appendInterludeLine\([\s\S]*?arr\[index \+ 1\]\.entry\.StartTime/u);

  const syllableSource = readSource("../src/utils/Lyrics/Applyer/Synced/Syllable.ts");
  assert.match(syllableSource, /indexedVisibleLyricsEntries\(\s*data\.Content,/u);
  assert.match(syllableSource, /arr\[index \+ 1\]\?\.entry\.Lead\.StartTime/u);
  assert.match(syllableSource, /line\.Background\.forEach\(\(bg\)/u);
  assert.match(syllableSource, /StartTime: ConvertTime\(bg\.StartTime\)/u);
  assert.match(syllableSource, /appendInterludeLine\([\s\S]*?nextLineStartTime/u);
  assert.match(syllableSource, /isVocalCueEntry\(line\.Lead\) \? line\.Lead : line/u);
});

test("copy filtering keeps its Static, Line, and Syllable assembly paths", () => {
  const source = readSource("../src/utils/Lyrics/CopyLyrics.ts");
  assert.match(source, /lyrics\.Type === "Static"[\s\S]*?!shouldExcludeLyricsCopyEntry\(line/u);
  assert.match(source, /lyrics\.Type === "Line"[\s\S]*?shouldExcludeLyricsCopyEntry\(line/u);
  assert.match(source, /lyrics\.Type === "Syllable"[\s\S]*?shouldExcludeLyricsCopyEntry\(group\?\.Lead/u);
  assert.match(source, /hideProviderInfo = \$hideEmbeddedProviderInfo\.get\(\)/u);
  assert.match(source, /showVocalistLabels = \$showVocalistLabels\.get\(\)/u);
  assert.match(source, /for \(const background of line\?\.Background \?\? \[\]\)/u);
  assert.match(source, /for \(const bg of group\?\.Background \?\? \[\]\)/u);
});
