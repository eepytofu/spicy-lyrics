import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJapaneseBoundaryPlan } from "../src/utils/Lyrics/Fork/JukujikunMerge.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerReadingState,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import {
  normalizeKuromojiTokens,
} from "../src/utils/Lyrics/Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import { applyKuromojiReadingOverrides } from "../src/utils/Lyrics/Processing/Japanese/KuromojiReadingPolicy.ts";
import {
  applyProductivePersonCounterReadings,
  applyVerifiedLexicalReadings,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseReadingResolver.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

type RawTokenSpec = {
  surface: string;
  reading: string;
  pos?: string;
  detail1?: string;
  detail2?: string;
};

type PipelineFixture = {
  text: string;
  rawTokens: RawTokenSpec[];
  expectedRawReading: string;
  expectedAdapterReading: string;
  expectedResolvedReading: string;
  expectedRomaji: string;
  expectedFurigana: Array<{ start: number; end: number; reading: string }>;
};

const fixtures: PipelineFixture[] = [
  {
    text: "私",
    rawTokens: [
      {
        surface: "私",
        reading: "ワタクシ",
        pos: "名詞",
        detail1: "代名詞",
      },
    ],
    expectedRawReading: "わたくし",
    expectedAdapterReading: "わたし",
    expectedResolvedReading: "わたし",
    expectedRomaji: "watashi",
    expectedFurigana: [{ start: 0, end: 1, reading: "わたし" }],
  },
  {
    text: "一人きり",
    rawTokens: [
      { surface: "一", reading: "イチ", detail1: "数" },
      {
        surface: "人",
        reading: "ニン",
        detail1: "接尾",
        detail2: "助数詞",
      },
      {
        surface: "きり",
        reading: "キリ",
        pos: "助詞",
        detail1: "副助詞",
      },
    ],
    expectedRawReading: "いちにんきり",
    expectedAdapterReading: "いちにんきり",
    expectedResolvedReading: "ひとりきり",
    expectedRomaji: "hitori kiri",
    expectedFurigana: [{ start: 0, end: 2, reading: "ひとり" }],
  },
  {
    text: "目蓋",
    rawTokens: [
      { surface: "目", reading: "メ" },
      { surface: "蓋", reading: "フタ" },
    ],
    expectedRawReading: "めふた",
    expectedAdapterReading: "めふた",
    expectedResolvedReading: "まぶた",
    expectedRomaji: "mabuta",
    expectedFurigana: [
      { start: 0, end: 1, reading: "ま" },
      { start: 1, end: 2, reading: "ぶた" },
    ],
  },
  {
    text: "音楽",
    rawTokens: [{ surface: "音楽", reading: "オンガク" }],
    expectedRawReading: "おんがく",
    expectedAdapterReading: "おんがく",
    expectedResolvedReading: "おんがく",
    expectedRomaji: "ongaku",
    expectedFurigana: [
      { start: 0, end: 1, reading: "おん" },
      { start: 1, end: 2, reading: "がく" },
    ],
  },
];

const kanaToRomaji = (kana: string): string =>
  ({
    わたし: "watashi",
    いち: "ichi",
    にん: "nin",
    ひとり: "hitori",
    きり: "kiri",
    め: "me",
    ふた: "futa",
    ま: "ma",
    ぶた: "buta",
    おんがく: "ongaku",
  })[kana] || kana;

function normalizeFixtureTokens(fixture: PipelineFixture): JapaneseAnalyzerToken[] {
  return normalizeKuromojiTokens(
    fixture.text,
    fixture.rawTokens.map((token) => ({
      surface_form: token.surface,
      reading: token.reading,
      pronunciation: token.reading,
      pos: token.pos || "名詞",
      pos_detail_1: token.detail1 || "一般",
      pos_detail_2: token.detail2 || "*",
      basic_form: token.surface,
    })),
  );
}

function readingState(tokens: readonly JapaneseAnalyzerToken[]): JapaneseAnalyzerReadingState[] {
  return tokens.map((token) => ({
    romaji: "",
    consumed: false,
    surface: token.surface,
    readingKana: token.readingKana,
    start: token.start,
    end: token.end,
  }));
}

function activeReading(entries: readonly JapaneseAnalyzerReadingState[]): string {
  return entries
    .filter((entry) => !entry.consumed)
    .map((entry) => entry.readingKana || "")
    .join("");
}

function analyzerFor(
  fixture: PipelineFixture,
  tokens: readonly JapaneseAnalyzerToken[],
): JapaneseAnalyzer {
  return {
    id: "kuromoji-pipeline-fixture",
    applyReadingOverrides: applyKuromojiReadingOverrides,
    async analyze(text) {
      assert.equal(text, fixture.text);
      return tokens;
    },
  };
}

test("Japanese accuracy harness records every reading-policy stage", async () => {
  const snapshots = [];

  for (const fixture of fixtures) {
    const tokens = normalizeFixtureTokens(fixture);
    const rawReading = tokens.map((token) => token.readingKana).join("");

    const adapterEntries = readingState(tokens);
    applyKuromojiReadingOverrides(adapterEntries, tokens);
    const adapterReading = activeReading(adapterEntries);

    const resolvedEntries = structuredClone(adapterEntries);
    const lexicalAudit = applyVerifiedLexicalReadings(
      fixture.text,
      tokens,
      resolvedEntries,
    );
    const counterAudit = applyProductivePersonCounterReadings(
      fixture.text,
      tokens,
      resolvedEntries,
    );
    const resolvedReading = activeReading(resolvedEntries);
    const boundaryPlan = buildJapaneseBoundaryPlan(
      resolvedEntries,
      tokens,
      fixture.text,
    );

    const analysis = await prepareJapaneseLineAnalysis(
      fixture.text,
      {
        analyzer: analyzerFor(fixture, tokens),
        kanaRomanizer: kanaToRomaji,
      },
    );

    assert.equal(rawReading, fixture.expectedRawReading, `${fixture.text}: raw adapter`);
    assert.equal(
      adapterReading,
      fixture.expectedAdapterReading,
      `${fixture.text}: Kuromoji policy`,
    );
    assert.equal(
      resolvedReading,
      fixture.expectedResolvedReading,
      `${fixture.text}: bounded resolver`,
    );
    if (fixture.text === "目蓋") {
      assert.deepEqual(boundaryPlan[1], {
        tokenIndex: 1,
        joinsPrevious: true,
        reasons: ["linguistic"],
      });
    }
    assert.equal(analysis?.reading.romaji, fixture.expectedRomaji, `${fixture.text}: romaji`);
    assert.deepEqual(
      analysis?.reading.furigana.map(({ start, end, reading }) => ({
        start,
        end,
        reading,
      })),
      fixture.expectedFurigana,
      `${fixture.text}: geometry`,
    );

    snapshots.push({
      text: fixture.text,
      rawReading,
      adapterReading,
      resolvedReading,
      lexicalDecisions: lexicalAudit.applied.length,
      counterDecisions: counterAudit.applied.length,
      romaji: analysis?.reading.romaji,
      furigana: analysis?.reading.furigana.map(({ start, end, reading }) => ({
        start,
        end,
        reading,
      })),
    });
  }

  assert.deepEqual(
    snapshots.map(({ text, lexicalDecisions, counterDecisions }) => ({
      text,
      lexicalDecisions,
      counterDecisions,
    })),
    [
      { text: "私", lexicalDecisions: 0, counterDecisions: 0 },
      { text: "一人きり", lexicalDecisions: 0, counterDecisions: 1 },
      { text: "目蓋", lexicalDecisions: 2, counterDecisions: 0 },
      { text: "音楽", lexicalDecisions: 0, counterDecisions: 0 },
    ],
  );
});

test("Japanese policy ablation reports which layer contributes accuracy", () => {
  const scores = {
    rawAdapter: 0,
    kuromojiPolicy: 0,
    boundedResolver: 0,
  };

  for (const fixture of fixtures) {
    const tokens = normalizeFixtureTokens(fixture);
    const rawReading = tokens.map((token) => token.readingKana).join("");
    if (rawReading === fixture.expectedResolvedReading) scores.rawAdapter += 1;

    const entries = readingState(tokens);
    applyKuromojiReadingOverrides(entries, tokens);
    if (activeReading(entries) === fixture.expectedResolvedReading) {
      scores.kuromojiPolicy += 1;
    }

    applyVerifiedLexicalReadings(fixture.text, tokens, entries);
    applyProductivePersonCounterReadings(fixture.text, tokens, entries);
    if (activeReading(entries) === fixture.expectedResolvedReading) {
      scores.boundedResolver += 1;
    }
  }

  assert.deepEqual(scores, {
    rawAdapter: 1,
    kuromojiPolicy: 2,
    boundedResolver: 4,
  });
});
