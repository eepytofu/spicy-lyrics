import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderReadingEvidence } from "../src/utils/Lyrics/ProviderReadingEvidence.ts";
import {
  analyzeJapaneseLine,
} from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import {
  buildProviderOnlyJapaneseReading,
  buildProviderOnlyJapaneseRenderPlan,
  getProviderJapaneseLineReading,
  sourceOwnerSpans,
} from "../src/utils/Lyrics/Processing/Japanese/ProviderJapaneseReading.ts";
import {
  romanizeJapaneseKana,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseRomanizer.ts";
import {
  processJapanesePackageLine,
} from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";

function token(
  surface: string,
  readingKana: string,
  start: number,
  partOfSpeech: JapaneseAnalyzerToken["partOfSpeech"] = "other",
): JapaneseAnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech,
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "provider-fixture", rangeSource: "native" },
  };
}

function analyzer(expected: string, tokens: JapaneseAnalyzerToken[]): JapaneseAnalyzer {
  return {
    id: "provider-fixture",
    async analyze(text) {
      assert.equal(text, expected);
      return tokens;
    },
  };
}

function lineEvidence(
  providerId: ProviderReadingEvidence["providerId"],
  exactValue: string,
): ProviderReadingEvidence {
  return {
    schemaVersion: 1,
    providerId,
    lineReadings: [{
      evidenceId: `${providerId}:romanization`,
      providerId,
      evidenceKind: "romanization",
      granularity: "line",
      documentRole: "romanization",
      container: providerId === "netease" ? "lrc" : providerId === "kugou" ? "krc" : "qrc",
      responseField: providerId === "netease" ? "romalrc" : providerId === "kugou" ? "language.content[type=0]" : "roma",
      authorshipProvenance: "unknown",
      derivation: "unknown",
      rows: [{
        exactValue,
        rowOrdinal: 0,
        sourceRowOrdinal: 0,
        alignment: "rowOrdinalProven",
        validationStatus: "usable",
      }],
    }],
  };
}

function qqEvidence(
  exactValue: string,
  units: Array<{ start: number; end: number; source: string; reading?: string }>,
): ProviderReadingEvidence {
  return {
    ...lineEvidence("qq", exactValue),
    kanaLayers: [{
      transport: {
        providerId: "qq",
        container: "qrc",
        documentRole: "primary",
        responseField: "lyric",
        rawLine: "fixture",
        rawLineSha256: "0".repeat(64),
        rawLineByteLength: 7,
      },
      authorship: { authorshipProvenance: "unknown" },
      derivation: { redundantCopies: [], layersDerivedFromThis: [] },
      validation: {
        walkState: "ordinalUnitProven",
        declaredUnitCount: units.length,
        resolvedUnitCount: units.length,
        findings: [],
      },
      units: units.map((unit, ordinal) => ({
        ordinal,
        groupId: `unit-${ordinal}`,
        groupSize: 1,
        groupRole: "sole",
        source: {
          rowOrdinal: 0,
          tokenOrdinal: 0,
          utf16Start: unit.start,
          utf16End: unit.end,
          codePointCount: [...unit.source].length,
          exactSourceSlice: unit.source,
        },
        coverage: unit.reading ? "covered" : "explicitEmpty",
        ...(unit.reading ? { reading: unit.reading } : {}),
        timing: {
          state: "timingAbsent",
          offsetMs: 0,
          rawBaseStartMs: 0,
          effectiveBaseStartMs: 0,
          baseDurationMs: 0,
          rawKana: [],
          effectiveKana: [],
          internalGaps: [],
        },
        findings: [],
      })),
    }],
  };
}

function qqGroupedEvidence(
  tokenSource: string,
  reading: string,
  units: Array<{ start: number; end: number; source: string }>,
): ProviderReadingEvidence {
  const evidence = qqEvidence("", units.map((unit, index) => ({
    ...unit,
    ...(index === 0 ? { reading } : {}),
  })));
  const first = units[0];
  const last = units.at(-1)!;
  return {
    ...evidence,
    kanaLayers: evidence.kanaLayers?.map((layer) => ({
      ...layer,
      units: layer.units.map((unit, index) => ({
        ...unit,
        groupId: "fixture-group",
        groupSize: units.length,
        groupRole: index === 0 ? "groupHead" : "groupMember",
        coverage: "covered",
        ...(index === 0
          ? {
              groupSource: {
                rowOrdinal: 0,
                tokenOrdinal: 0,
                utf16Start: first.start,
                utf16End: last.end,
                readingUnitCount: units.length,
                codePointCount: Array.from(tokenSource.slice(first.start, last.end)).length,
                exactSourceSlice: tokenSource.slice(first.start, last.end),
              },
            }
          : {}),
      })),
    })),
  };
}

test("QQ provider Kana overrides covered ranges while local readings fill gaps", async () => {
  const source = "明日行く";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("wrong raw Latin", [{ start: 0, end: 2, source: "明日", reading: "あす" }]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [token("明日", "あした", 0), token("行く", "いく", 2)]),
    providerReading: provider,
  });

  assert.equal(reading?.romaji, "asu iku");
  assert.deepEqual(
    reading?.romajiSegments?.map((segment) => segment.provenance),
    ["providerExplicit", undefined],
  );
  assert.deepEqual(
    reading?.furigana.map(({ start, end, reading, provenance }) => ({ start, end, reading, provenance })),
    [
      { start: 0, end: 2, reading: "あす", provenance: "providerExplicit" },
      { start: 2, end: 3, reading: "い", provenance: undefined },
    ],
  );
});

test("complete per-character QQ Kana composes across one analyzer token", async () => {
  const source = "今日";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("kyo u", [
      { start: 0, end: 1, source: "今", reading: "きょ" },
      { start: 1, end: 2, source: "日", reading: "う" },
    ]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [token(source, "こんにち", 0)]),
    providerReading: provider,
  });
  assert.equal(reading?.romaji, "kyou");
  assert.equal(reading?.romajiSegments?.[0]?.provenance, "providerExplicit");
  assert.deepEqual(reading?.furigana.map(({ reading }) => reading), ["きょ", "う"]);
});

test("QQ grouped Kana owns its full gikun range across non-reading okurigana", async () => {
  const source = "痛みと怒れる人を";
  const provider = getProviderJapaneseLineReading(
    qqGroupedEvidence("怒れる人", "ラングラー", [
      { start: 0, end: 1, source: "怒" },
      { start: 3, end: 4, source: "人" },
    ]),
    0,
    source,
    [{
      index: 0,
      rawText: "怒れる人",
      normalizedText: "怒れる人",
      start: 3,
      end: 7,
    }],
  );
  assert.deepEqual(provider?.furigana, [{
    start: 3,
    end: 7,
    reading: "ラングラー",
    provenance: "providerExplicit",
  }]);
  assert.equal(buildProviderOnlyJapaneseReading(source, provider)?.romaji, "…mitoranguraawo");

  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [
      token("痛み", "いたみ", 0),
      token("と", "と", 2, "particle"),
      token("怒れる", "おこれる", 3),
      token("人", "ひと", 6),
      token("を", "を", 7, "particle"),
    ]),
    providerReading: provider,
  });
  assert.equal(reading?.romaji, "itami to ranguraa wo");
  assert.equal(reading?.romaji?.includes("reru hito"), false);
});

test("standalone sokuon merges without leaking Japanese into provider Romaji", async () => {
  const source = "喰らったったらった";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("", [{ start: 0, end: 1, source: "喰", reading: "く" }]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [
      token("喰らったったら", "くらったったら", 0),
      token("っ", "っ", 7),
      token("た", "た", 8),
    ]),
    providerReading: provider,
  });
  assert.equal(reading?.romaji, "kurattattaratta");
  assert.doesNotMatch(reading?.romaji ?? "", /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
});

test("invalid QQ ranges are omitted without corrupting the remaining evidence", () => {
  const source = "明日";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("a su", [
      { start: 0, end: 1, source: "違", reading: "あ" },
      { start: 1, end: 2, source: "日", reading: "す" },
    ]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  assert.deepEqual(provider?.furigana, [
    { start: 1, end: 2, reading: "す", provenance: "providerExplicit" },
  ]);
});

test("KuGou uses the same structured-range contract and Soda abstains", () => {
  const qq = qqEvidence("a su", [{ start: 0, end: 2, source: "明日", reading: "あす" }]);
  const kugou: ProviderReadingEvidence = {
    ...qq,
    providerId: "kugou",
    lineReadings: qq.lineReadings?.map((layer) => ({
      ...layer,
      providerId: "kugou",
      container: "krc",
      responseField: "language.content[type=0]",
    })),
    kanaLayers: qq.kanaLayers?.map((layer) => ({
      ...layer,
      transport: { ...layer.transport, providerId: "kugou", container: "krc" },
    })),
  };
  assert.equal(
    getProviderJapaneseLineReading(kugou, 0, "明日", sourceOwnerSpans("明日"))
      ?.furigana[0]?.reading,
    "あす",
  );
  assert.equal(
    buildProviderOnlyJapaneseReading(
      "明日",
      getProviderJapaneseLineReading(kugou, 0, "明日", sourceOwnerSpans("明日")),
    )?.romaji,
    "asu",
  );
  assert.equal(getProviderJapaneseLineReading({
    schemaVersion: 1,
    providerId: "soda",
    phoneticLanes: [{
      evidenceId: "soda:empty",
      providerId: "soda",
      rawNumericKind: 0,
      rawLanguage: null,
      evidenceKind: "phonetic",
      targetScript: "empty",
      authorshipProvenance: "unknown",
      validationStatus: "shapeProven",
      validationFindings: [],
      rows: [],
    }],
  }, 0, "明日", sourceOwnerSpans("明日")), undefined);
});

test("NetEase line romanization remains evidence-only and local analysis owns readings", async () => {
  const source = "続く雫";
  const provider = getProviderJapaneseLineReading(
    lineEvidence("netease", "tsu zu ku shi zu ku"),
    0,
    source,
    sourceOwnerSpans(source),
  );
  assert.equal(provider, undefined);

  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [
      token("続く", "つづく", 0),
      token("雫", "しずく", 2),
    ]),
    providerReading: provider,
  });

  assert.equal(reading?.romaji, "tsuzuku shizuku");
  assert.deepEqual(reading?.furigana, [
    { start: 0, end: 1, reading: "つづ" },
    { start: 2, end: 3, reading: "しずく" },
  ]);
  assert.equal(
    reading?.romajiSegments?.some((segment) => segment.provenance === "provider"),
    false,
  );
});

test("provider-only projection derives display from exact Kana evidence", () => {
  const source = "明日";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("ignored raw Latin", [{ start: 0, end: 2, source, reading: "あす" }]),
    0,
    source,
    sourceOwnerSpans(source),
  );

  assert.equal(buildProviderOnlyJapaneseReading(source, provider)?.romaji, "asu");
  assert.equal(buildProviderOnlyJapaneseReading(source, undefined), undefined);
});

test("provider-only QQ derives Latin from Kana and keeps partial gaps visible", () => {
  const source = "明日行く";
  const raw = " wrong raw Latin ";
  const provider = getProviderJapaneseLineReading(
    qqEvidence(raw, [{ start: 0, end: 2, source: "明日", reading: "あす" }]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  const reading = buildProviderOnlyJapaneseReading(source, provider);
  assert.equal(reading?.romaji, "asu…ku");
  assert.deepEqual(reading?.furigana, [
    { start: 0, end: 2, reading: "あす", provenance: "providerExplicit" },
  ]);
  assert.equal(reading?.romajiSegments?.[0]?.provenance, "providerExplicit");
  const plan = buildProviderOnlyJapaneseRenderPlan(
    source,
    sourceOwnerSpans(source),
    [{ StartTime: 10, EndTime: 20 }],
    reading!,
  );
  assert.equal(plan?.joinedDisplayText, "asu…ku");
  assert.deepEqual(plan?.furigana, [{
    canonicalRange: { startCp: 0, endCp: 2 },
    reading: "あす",
    provenance: "providerExplicit",
  }]);
});

test("provider-only QQ works without a Latin sidecar and ignores Latin without Kana", () => {
  const source = "今日";
  const kanaOnly = getProviderJapaneseLineReading(
    qqEvidence("", [
      { start: 0, end: 1, source: "今", reading: "きょ" },
      { start: 1, end: 2, source: "日", reading: "う" },
    ]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  assert.equal(buildProviderOnlyJapaneseReading(source, kanaOnly)?.romaji, "kyou");

  const latinOnly = getProviderJapaneseLineReading(
    lineEvidence("qq", "kyo u"),
    0,
    source,
    sourceOwnerSpans(source),
  );
  assert.equal(latinOnly, undefined);
  assert.equal(buildProviderOnlyJapaneseReading(source, latinOnly), undefined);
});

test("structured QQ digit readings normalize without using raw per-mora Latin", () => {
  const source = "３ ２ １ go fight";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("sa n   ni   i chi   go  fight ", [
      { start: 0, end: 1, source: "３", reading: "さん" },
      { start: 2, end: 3, source: "２", reading: "に" },
      { start: 4, end: 5, source: "１", reading: "いち" },
    ]),
    0,
    source,
    sourceOwnerSpans(source),
  );

  const reading = buildProviderOnlyJapaneseReading(source, provider);
  assert.equal(reading?.romaji, "san ni ichi go fight");
});

test("partial QQ readings retain local lyric boundaries around numbers and Latin", async () => {
  const source = "うぴうぴはにー3 2 1(うーーfight)";
  const provider = getProviderJapaneseLineReading(
    qqEvidence("u pi u pi ha ni i sa n   ni   i chi ( u u : fight) ", [
      { start: 7, end: 8, source: "3", reading: "さん" },
      { start: 9, end: 10, source: "2", reading: "に" },
      { start: 11, end: 12, source: "1", reading: "いち" },
    ]),
    0,
    source,
    sourceOwnerSpans(source),
  );
  const reading = await analyzeJapaneseLine(source, {
    analyzer: analyzer(source, [
      token("う", "う", 0),
      token("ぴうぴはに", "ぴうぴはに", 1),
      token("ー", "ー", 6),
      token("3", "", 7),
      token(" ", "", 8),
      token("2", "", 9),
      token(" ", "", 10),
      token("1", "", 11),
      token("(", "", 12),
      token("う", "う", 13),
      token("ーー", "ーー", 14),
      token("fight", "", 16),
      token(")", "", 21),
    ]),
    providerReading: provider,
  });

  assert.equal(reading?.romaji, "upi upi hanii san ni ichi (uuu fight)");
  assert.deepEqual(
    reading?.romajiSegments?.filter((segment) => segment.provenance)
      .map((segment) => segment.text.trim()),
    ["san", "ni", "ichi"],
  );

  const syllables = [
    { Text: "うぴうぴはにー", StartTime: 0, EndTime: 700, IsPartOfWord: true },
    { Text: "3 ", StartTime: 700, EndTime: 900, IsPartOfWord: false },
    { Text: "2 ", StartTime: 900, EndTime: 1100, IsPartOfWord: false },
    { Text: "1", StartTime: 1100, EndTime: 1200, IsPartOfWord: true },
    { Text: "(うーーfight)", StartTime: 1200, EndTime: 2200, IsPartOfWord: true },
  ];
  const spans = [
    { index: 0, rawText: syllables[0].Text, normalizedText: syllables[0].Text, start: 0, end: 7 },
    { index: 1, rawText: syllables[1].Text, normalizedText: syllables[1].Text, start: 7, end: 9 },
    { index: 2, rawText: syllables[2].Text, normalizedText: syllables[2].Text, start: 9, end: 11 },
    { index: 3, rawText: syllables[3].Text, normalizedText: syllables[3].Text, start: 11, end: 12 },
    { index: 4, rawText: syllables[4].Text, normalizedText: syllables[4].Text, start: 12, end: 22 },
  ];
  const packageResult = await processJapanesePackageLine(
    source,
    syllables,
    spans,
    syllables,
    {
      analyzer: analyzer(source, [
        token("う", "う", 0),
        token("ぴうぴはに", "ぴうぴはに", 1),
        token("ー", "ー", 6),
        token("3", "", 7),
        token(" ", "", 8),
        token("2", "", 9),
        token(" ", "", 10),
        token("1", "", 11),
        token("(", "", 12),
        token("う", "う", 13),
        token("ーー", "ーー", 14),
        token("fight", "", 16),
        token(")", "", 21),
      ]),
      providerReading: provider,
    },
  );
  assert.equal(packageResult.plan.joinedDisplayText, "upi upi hanii san ni ichi (uuu fight)");
  assert.equal(
    packageResult.plan.readingUnits.map((unit) => unit.text).join(""),
    packageResult.plan.joinedDisplayText,
  );
});

test("internal Modified Hepburn keeps focused Kana and punctuation behavior", () => {
  assert.equal(romanizeJapaneseKana("がっこう"), "gakkou");
  assert.equal(romanizeJapaneseKana("っ"), "'");
  assert.equal(romanizeJapaneseKana("わんっつーさんしっ"), "wanttsuusanshi'");
  assert.equal(romanizeJapaneseKana("しんえつ"), "shin'etsu");
  assert.equal(romanizeJapaneseKana("スーパー"), "suupaa");
  assert.equal(romanizeJapaneseKana("ﾌｧｲﾙ"), "fairu");
  assert.equal(romanizeJapaneseKana("ぢゃ"), "ja");
  assert.equal(romanizeJapaneseKana("「すき！」"), "「suki！」");
});
