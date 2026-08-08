import assert from "node:assert/strict";
import test from "node:test";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import { resolveJapaneseDictionaryCoverage } from "../src/utils/Lyrics/Processing/Japanese/JapaneseReadingFallback.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import type { JapaneseTokenEntry } from "../src/utils/Lyrics/Reading/JapaneseReadingModel.ts";

function token(
  surface: string,
  start: number,
  readingKana: string,
): JapaneseAnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: {
      analyzerId: "kuromoji",
      analyzerVersion: "test",
      dictionaryId: "test",
      rangeSource: "surfaceAligned",
    },
  };
}

function analyzer(tokens: readonly JapaneseAnalyzerToken[]): JapaneseAnalyzer {
  return {
    id: "kuromoji",
    async analyze(text) {
      assert.equal(tokens.map((value) => value.surface).join(""), text);
      return structuredClone(tokens);
    },
  };
}

async function analyze(
  text: string,
  tokens: readonly JapaneseAnalyzerToken[],
) {
  return prepareJapaneseLineAnalysis(text, {
    analyzer: analyzer(tokens),
    kanaRomanizer: (kana) => kana,
  });
}

test("unique JMdict reading fills a complete split-token gap with proven geometry", async () => {
  const result = await analyze("磊々", [token("磊", 0, ""), token("々", 1, "々")]);

  assert.equal(result?.reading.sourceText, "磊々");
  assert.equal(result?.reading.romaji, "らいらい");
  assert.deepEqual(result?.reading.furigana, [
    { start: 0, end: 1, reading: "らい" },
    { start: 1, end: 2, reading: "らい" },
  ]);
});

test("the Japanese-script gate retains analyzer evidence carried by 々", async () => {
  const result = await analyze("々", [token("々", 0, "くりかえし")]);

  assert.equal(result?.reading.romaji, "くりかえし");
});

test("partial dictionary matches cannot invent readings inside one unresolved gap island", async () => {
  const tokens = [token("落", 0, ""), token("々", 1, "々")];
  const entries: JapaneseTokenEntry[] = tokens.map((value) => ({
    start: value.start,
    end: value.end,
    surface: value.surface,
    readingKana: value.readingKana,
    romaji: "",
    consumed: false,
  }));

  await resolveJapaneseDictionaryCoverage("落々", tokens, entries);

  assert.deepEqual(entries.map((entry) => entry.readingKana), ["", "々"]);
  assert.equal(entries.some((entry) => entry.consumed), false);
});

test("an exact iteration-mark word may end before a separate unresolved word", async () => {
  const tokens = [
    token("磊", 0, ""),
    token("々", 1, "々"),
    token("落", 2, ""),
    token("々", 3, "々"),
  ];
  const entries: JapaneseTokenEntry[] = tokens.map((value) => ({
    start: value.start,
    end: value.end,
    surface: value.surface,
    readingKana: value.readingKana,
    romaji: "",
    consumed: false,
  }));

  await resolveJapaneseDictionaryCoverage("磊々落々", tokens, entries);

  assert.equal(entries[0].readingKana, "らいらい");
  assert.equal(entries[1].consumed, true);
  assert.deepEqual(entries.slice(2).map((entry) => entry.readingKana), ["", "々"]);
});

test("the verified complete 磊々落々 idiom supplies the JMdict-missing second half", async () => {
  const result = await analyze("磊々落々", [
    token("磊", 0, ""),
    token("々", 1, "々"),
    token("落", 2, ""),
    token("々", 3, "々"),
  ]);

  assert.equal(result?.reading.romaji, "らいらいらくらく");
  assert.deepEqual(result?.reading.furigana, [
    { start: 0, end: 1, reading: "らい" },
    { start: 1, end: 2, reading: "らい" },
    { start: 2, end: 3, reading: "らく" },
    { start: 3, end: 4, reading: "らく" },
  ]);
});

test("JMdict orthographic aliases fill 搔き without replacing canonical analyzer evidence", async () => {
  const alias = await analyze("搔き", [token("搔", 0, ""), token("き", 1, "き")]);
  const canonical = await analyze("掻き", [token("掻き", 0, "かき")]);

  assert.equal(alias?.reading.romaji, "かき");
  assert.deepEqual(alias?.reading.furigana, [{ start: 0, end: 1, reading: "か" }]);
  assert.equal(canonical?.reading.romaji, "かき");
  assert.deepEqual(canonical?.reading.furigana, [{ start: 0, end: 1, reading: "か" }]);
});

test("exact mixed-word geometry splits only dictionary-proven Kanji boundaries", async () => {
  const fixtures = [
    {
      text: "二度と",
      tokens: [token("二度と", 0, "にどと")],
      furigana: [
        { start: 0, end: 1, reading: "に" },
        { start: 1, end: 2, reading: "ど" },
      ],
    },
    {
      text: "目指す",
      tokens: [token("目指す", 0, "めざす")],
      furigana: [
        { start: 0, end: 1, reading: "め" },
        { start: 1, end: 2, reading: "ざ" },
      ],
    },
    {
      text: "仕掛けた",
      tokens: [token("仕掛け", 0, "しかけ"), token("た", 3, "た")],
      furigana: [
        { start: 0, end: 1, reading: "し" },
        { start: 1, end: 2, reading: "か" },
      ],
    },
    {
      text: "仕舞い",
      tokens: [token("仕舞い", 0, "しまい")],
      furigana: [
        { start: 0, end: 1, reading: "し" },
        { start: 1, end: 2, reading: "ま" },
      ],
    },
  ] as const;

  for (const fixture of fixtures) {
    const result = await analyze(fixture.text, fixture.tokens);
    assert.deepEqual(result?.reading.furigana, fixture.furigana, fixture.text);
    assert.equal(result?.reading.sourceText, fixture.text);
  }
});

test("provider-authored readings and non-dictionary gaps remain untouched", async () => {
  const tokens = [token("搔き", 0, "そら")];
  const entries: JapaneseTokenEntry[] = [{
    start: 0,
    end: 2,
    surface: "搔き",
    readingKana: "そら",
    romaji: "",
    consumed: false,
    readingProvenance: "providerExplicit",
  }];

  await resolveJapaneseDictionaryCoverage("搔き", tokens, entries);

  assert.equal(entries[0].readingKana, "そら");
  assert.equal(entries[0].provenFurigana, undefined);
});
