import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanonicalLine } from "../src/utils/Lyrics/Processing/Canonical.ts";
import {
  alignJapaneseReadingUnitTexts,
  annotateJapaneseLine,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnnotationProcessor.ts";
import {
  buildJapanesePackageParsedLine,
  processJapanesePackageLine,
} from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";
import { buildRenderPlan } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import {
  applyJapaneseReadingToSyllables,
  buildJapaneseLineTextMap,
  prepareJapaneseLineAnalysis,
  projectJapaneseReadingToSource,
} from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import {
  ChineseProviderJapaneseTextProjection,
} from "../src/utils/Lyrics/Processing/Japanese/ChineseProviderJapaneseRepair.ts";
import { timedFuriganaGroups } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";
import {
  addStructuredProviderRubyReadings,
  projectProviderAuthoredJapaneseReadings,
} from "../src/utils/Lyrics/Processing/Japanese/ProviderAuthoredReading.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";

function singleTokenAnalyzer(surface: string, readingKana: string): JapaneseAnalyzer {
  const token: JapaneseAnalyzerToken = {
    surface,
    start: 0,
    end: surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "timing-fixture", rangeSource: "native" },
  };
  return {
    id: "timing-fixture",
    async analyze(text) {
      assert.equal(text, surface);
      return [token];
    },
  };
}

function tokenAnalyzer(
  source: string,
  specs: Array<{
    surface: string;
    readingKana: string;
    partOfSpeech?: JapaneseAnalyzerToken["partOfSpeech"];
  }>,
): JapaneseAnalyzer {
  let start = 0;
  const tokens = specs.map((spec) => {
    const token: JapaneseAnalyzerToken = {
      surface: spec.surface,
      start,
      end: start + spec.surface.length,
      readingKana: spec.readingKana,
      pronunciationKana: spec.readingKana,
      partOfSpeech: spec.partOfSpeech || "other",
      morphologyFeatures: [],
      baseForm: spec.surface,
      conjugationType: "",
      conjugationForm: "",
      provenance: { analyzerId: "annotation-fixture", rangeSource: "native" },
    };
    start = token.end;
    return token;
  });
  return {
    id: "annotation-fixture",
    async analyze(text) {
      assert.equal(text, source);
      return tokens;
    },
  };
}

test("halfwidth Kana analysis maps following furigana back to provider text", async () => {
  const analysis = await prepareJapaneseLineAnalysis("ｶﾞ時計", {
    analyzer: tokenAnalyzer("ガ時計", [
      { surface: "ガ", readingKana: "ガ" },
      { surface: "時計", readingKana: "トケイ" },
    ]),
    kanaRomanizer: (kana) => ({ ガ: "ga", トケイ: "tokei" })[kana] ?? kana,
  });
  assert.ok(analysis);
  assert.equal(analysis.reading.sourceText, "ｶﾞ時計");
  assert.equal(analysis.reading.displayText, undefined);
  assert.deepEqual(
    analysis.reading.furigana.map(({ start, end, reading }) => ({ start, end, reading })),
    [{ start: 2, end: 4, reading: "とけい" }],
  );

  const syllable: any = { Text: "ｶﾞ時計" };
  analysis.applyToSyllables([syllable]);
  assert.equal(syllable.Text, "ｶﾞ時計");
  assert.equal(syllable.JapaneseReading?.sourceText, "ｶﾞ時計");
  assert.deepEqual(
    syllable.JapaneseReading?.furigana.map(({ start, end, reading }) => ({ start, end, reading })),
    [{ start: 2, end: 4, reading: "とけい" }],
  );
});

test("tsumetaimori timed words retain furigana beside authored spaces", async () => {
  const syllables = [
    { Text: "氷", StartTime: 155.53, EndTime: 157.19, IsPartOfWord: true },
    { Text: "の", StartTime: 157.19, EndTime: 158.23, IsPartOfWord: true },
    { Text: "花 ", StartTime: 158.23, EndTime: 159.85, IsPartOfWord: false },
    { Text: "こ", StartTime: 159.85, EndTime: 159.98, IsPartOfWord: true },
  ];
  const mapped = buildJapaneseLineTextMap(syllables);
  assert.equal(mapped.sourceText, "氷の花 こ");

  await processJapanesePackageLine(mapped.sourceText, syllables, mapped.spans, syllables, {
    analyzer: tokenAnalyzer(mapped.sourceText, [
      { surface: "氷", readingKana: "コオリ" },
      { surface: "の", readingKana: "ノ", partOfSpeech: "particle" },
      { surface: "花", readingKana: "ハナ" },
      { surface: " ", readingKana: "" },
      { surface: "こ", readingKana: "コ" },
    ]),
    kanaRomanizer: (kana) =>
      ({
        こおり: "koori",
        の: "no",
        はな: "hana",
        こ: "ko",
      })[kana] || kana,
  });

  assert.equal(syllables[2].JapaneseReading?.sourceText, "花 ");
  assert.deepEqual(
    syllables[2].JapaneseReading?.furigana.map(({ start, end, reading }) => ({
      start,
      end,
      reading,
    })),
    [{ start: 0, end: 1, reading: "はな" }],
  );

  assert.equal(
    projectJapaneseReadingToSource(
      {
        sourceText: "花",
        romaji: "hana",
        furigana: [{ start: 0, end: 1, reading: "はな" }],
      },
      "花!",
    ),
    undefined,
  );
});

async function timedJapaneseAnnotation(
  surface: string,
  readingKana: string,
  romaji: Readonly<Record<string, string>>,
) {
  const spanTexts = Array.from(surface);
  const line = {
    id: `jp-${surface}`,
    displayText: surface,
    paragraphProvenance: "lineBoundary" as const,
    spans: spanTexts.map((text, index) => ({
      id: String(index),
      rawText: text,
      cleanText: text,
      startMs: index * 100,
      endMs: (index + 1) * 100,
      providerPartOfWord: true,
    })),
  };
  const canonical = buildCanonicalLine(line);
  const annotation = await annotateJapaneseLine(
    canonical,
    {
      analyzer: singleTokenAnalyzer(surface, readingKana),
      kanaRomanizer: (kana) => romaji[kana] ?? kana,
    },
  );
  assert.ok(annotation);
  return buildRenderPlan(line, canonical, [annotation!]);
}

test("Japanese annotation keeps split spans as unique timing owners", async () => {
  const line = { id: "jp", displayText: "だんだん剥がれてく", paragraphProvenance: "lineBoundary" as const,
    spans: ["だん", "だん", "剥", "がれて", "く"].map((text, index) => ({ id: String(index), rawText: text,
      cleanText: text, startMs: index * 100, endMs: (index + 1) * 100, providerPartOfWord: true })) };
  const canonical = buildCanonicalLine(line);
  const annotation = await annotateJapaneseLine(canonical, {
    analyzer: singleTokenAnalyzer("だんだん剥がれてく", "だんだんはがれてく"),
    kanaRomanizer: () => "dandan hagareteku",
  });
  assert.ok(annotation);
  const plan = buildRenderPlan(line, canonical, [annotation!]);
  assert.equal(plan.timedReadingUnits.length, 5);
  assert.equal(new Set(plan.timedReadingUnits.map((unit) => unit.spanId)).size, 5);
  assert.equal(plan.joinedDisplayText.length > 0, true);
});

test("Japanese annotation preserves exact reading ranges across partial timing spans", async () => {
  const line = {
    id: "jp-partial-span",
    displayText: "耳鳴りが",
    paragraphProvenance: "lineBoundary" as const,
    spans: [
      {
        id: "0",
        rawText: "耳",
        cleanText: "耳",
        startMs: 100,
        endMs: 200,
        providerPartOfWord: true,
      },
      {
        id: "1",
        rawText: "鳴りが",
        cleanText: "鳴りが",
        startMs: 200,
        endMs: 500,
        providerPartOfWord: false,
      },
    ],
  };
  const tokens: JapaneseAnalyzerToken[] = [
    {
      surface: "耳鳴り",
      start: 0,
      end: 3,
      readingKana: "みみなり",
      pronunciationKana: "みみなり",
      partOfSpeech: "noun",
      morphologyFeatures: [],
      baseForm: "耳鳴り",
      conjugationType: "",
      conjugationForm: "",
      provenance: { analyzerId: "partial-span-fixture", rangeSource: "native" },
    },
    {
      surface: "が",
      start: 3,
      end: 4,
      readingKana: "が",
      pronunciationKana: "が",
      partOfSpeech: "particle",
      morphologyFeatures: [],
      baseForm: "が",
      conjugationType: "",
      conjugationForm: "",
      provenance: { analyzerId: "partial-span-fixture", rangeSource: "native" },
    },
  ];
  const analyzer: JapaneseAnalyzer = {
    id: "partial-span-fixture",
    async analyze(text) {
      assert.equal(text, "耳鳴りが");
      return tokens;
    },
  };
  const canonical = buildCanonicalLine(line);
  const annotation = await annotateJapaneseLine(
    canonical,
    {
      analyzer,
      kanaRomanizer: (kana) =>
        ({ みみなり: "miminari", が: "ga" })[kana] ?? kana,
    },
  );
  assert.ok(annotation);

  const plan = buildRenderPlan(line, canonical, [annotation]);
  assert.deepEqual(
    plan.timedReadingUnits.map((unit) => ({
      spanId: unit.spanId,
      text: unit.text,
      animationTimingRefs: unit.animationTimingRefs,
      animationRange: unit.animationRange,
    })),
    [
      {
        spanId: "0",
        text: "miminari",
        animationTimingRefs: ["0", "1"],
        animationRange: { startCp: 0, endCp: 3 },
      },
      {
        spanId: "1",
        text: " ga",
        animationTimingRefs: undefined,
        animationRange: { startCp: 3, endCp: 4 },
      },
    ],
  );
});

test("structured-provider Japanese lines keep authored English spaces without duplicating timed words", async () => {
  const syllables = [
    { Text: "ぶ", IsPartOfWord: true },
    { Text: "ち", IsPartOfWord: true },
    { Text: "壊", IsPartOfWord: true },
    { Text: "し", IsPartOfWord: true },
    { Text: "て", IsPartOfWord: false },
    { Text: "shout ", IsPartOfWord: false },
    { Text: "it ", IsPartOfWord: false },
    { Text: "out ", IsPartOfWord: false },
    { Text: "loud", IsPartOfWord: true },
  ];
  const map = buildJapaneseLineTextMap(syllables);
  assert.equal(map.lineText, "ぶち壊して shout it out loud");

  const parsed = buildJapanesePackageParsedLine(
    map.lineText,
    map.spans,
    syllables.map((_, index) => ({ StartTime: index * 100, EndTime: (index + 1) * 100 })),
  );
  const canonical = buildCanonicalLine(parsed);

  assert.equal(canonical.text, "ぶち壊して shout it out loud");
  assert.equal(new Set(canonical.spanMappings.map((unit) => unit.spanId)).size, syllables.length);
});

test("Japanese timed-unit alignment keeps spaces in mixed title and credit lines", () => {
  for (const fixture of [
    {
      units: ["Shout", "It", "Out", "Loud!!! -", "akatsuki", "Records   (", "akatsuki", "records)"],
      display: "Shout It Out Loud!!! - akatsukiRecords (akatsuki records)",
    },
    {
      units: ["shoujouseze", "", "", "", "-", "akatsuki", "Records   (", "akatsuki", "records)"],
      display: "shoujouseze - akatsukiRecords (akatsuki records)",
    },
  ]) {
    const aligned = alignJapaneseReadingUnitTexts(fixture.units, fixture.display);
    assert.equal(aligned.join(""), fixture.display);
  }
});

test("Japanese mixed title analysis follows authored cross-script and parenthetical boundaries", async () => {
  const syllables = [
    { Text: "Shout ", IsPartOfWord: false },
    { Text: "It ", IsPartOfWord: false },
    { Text: "Out ", IsPartOfWord: false },
    { Text: "Loud!!! - ", IsPartOfWord: false },
    { Text: "暁", IsPartOfWord: true },
    { Text: "Records (", IsPartOfWord: true },
    { Text: "akatsuki ", IsPartOfWord: false },
    { Text: "records)", IsPartOfWord: true },
  ];
  const map = buildJapaneseLineTextMap(syllables);
  assert.equal(map.lineText, "Shout It Out Loud!!! - 暁Records (akatsuki records)");

  const expected = "Shout It Out Loud!!! - akatsukiRecords (akatsuki records)";
  const reading = (await prepareJapaneseLineAnalysis(map.lineText, {
    analyzer: singleTokenAnalyzer(map.lineText, "あかつき"),
    kanaRomanizer: () => expected,
  }))?.reading;
  assert.equal(reading?.romaji, expected);
});

test("Japanese romaji uses a Latin comma without changing source punctuation", async () => {
  const source = "きっと、きれい";
  const reading = (await prepareJapaneseLineAnalysis(source, {
    analyzer: tokenAnalyzer(source, [
      { surface: "きっと", readingKana: "きっと" },
      { surface: "、", readingKana: "" },
      { surface: "きれい", readingKana: "きれい" },
    ]),
    kanaRomanizer: (kana) =>
      ({
        きっと: "kitto",
        きれい: "kirei",
      })[kana] || kana,
  }))?.reading;

  assert.equal(reading?.sourceText, source);
  assert.equal(reading?.romaji, "kitto, kirei");
});

test("Japanese furigana ranges are exported as code-point coordinates", async () => {
  const line = { id: "astral-jp", displayText: "😀今日", paragraphProvenance: "lineBoundary" as const,
    spans: [{ id: "0", rawText: "😀", cleanText: "😀", startMs: 0, endMs: 100, providerPartOfWord: true },
      { id: "1", rawText: "今日", cleanText: "今日", startMs: 100, endMs: 200, providerPartOfWord: false }] };
  const canonical = buildCanonicalLine(line);
  const annotation = await annotateJapaneseLine(canonical);
  for (const segment of (annotation?.furigana || []) as any[]) {
    assert.ok(segment.canonicalRange.startCp >= 1);
    assert.ok(segment.canonicalRange.endCp <= 3);
  }
});

test("provider-authored reading keeps source evidence and emits explicit furigana", async () => {
  const reading = (await prepareJapaneseLineAnalysis(
    "今宵も天(そら)は明るく",
    {
      analyzer: tokenAnalyzer("今宵も天は明るく", [
        { surface: "今宵", readingKana: "こよい" },
        { surface: "も", readingKana: "も", partOfSpeech: "particle" },
        { surface: "天", readingKana: "てん" },
        { surface: "は", readingKana: "は", partOfSpeech: "particle" },
        { surface: "明るく", readingKana: "あかるく" },
      ]),
      kanaRomanizer: (kana) =>
        ({
          こよい: "koyoi",
          も: "mo",
          そら: "sora",
          は: "ha",
          あかるく: "akaruku",
        })[kana] || kana,
    },
  ))?.reading;
  assert.ok(reading);
  assert.equal(reading!.sourceText, "今宵も天(そら)は明るく");
  assert.equal(reading!.displayText, "今宵も天は明るく");
  assert.match(reading!.romaji || "", /sora/);
  assert.equal(reading!.furigana.some((segment) =>
    segment.reading === "そら" && segment.provenance === "providerExplicit"
  ), true);
});

test("structured ruby overrides analyzer reading without rewriting authored Katakana", async () => {
  const authoredReadingProjection = addStructuredProviderRubyReadings(
    projectProviderAuthoredJapaneseReadings("空"),
    [{
      start: 0,
      end: 1,
      ProviderRuby: [{ Text: "ソラ", StartTime: 1, EndTime: 2 }],
    }],
  );
  const reading = (await prepareJapaneseLineAnalysis("空", {
    authoredReadingProjection,
    analyzer: singleTokenAnalyzer("空", "くう"),
    kanaRomanizer: (kana) => ({ そら: "sora", くう: "kuu" })[kana] || kana,
  }))?.reading;

  assert.equal(reading?.romaji, "sora");
  assert.deepEqual(reading?.furigana, [
    { start: 0, end: 1, reading: "ソラ", provenance: "providerExplicit" },
  ]);
});

test("timed Japanese processing consumes only unambiguous structured ruby", async () => {
  const syllables = [{
    Text: "空",
    StartTime: 1,
    EndTime: 2,
    IsPartOfWord: true,
    ProviderRuby: [{ Text: "ソラ", StartTime: 1, EndTime: 2 }],
  }];
  const mapped = buildJapaneseLineTextMap(syllables);
  const options = {
    analyzer: singleTokenAnalyzer("空", "くう"),
    kanaRomanizer: (kana: string) => ({ そら: "sora", くう: "kuu" })[kana] || kana,
  };
  const authored = await processJapanesePackageLine(
    mapped.sourceText,
    syllables,
    mapped.spans,
    syllables,
    options,
  );
  assert.equal(authored.romaji, "sora");
  assert.equal(authored.furigana[0].reading, "ソラ");

  const ambiguousSyllables = [{
    ...syllables[0],
    ProviderRuby: [
      { Text: "ソ", StartTime: 1, EndTime: 1.5 },
      { Text: "ラ", StartTime: 1.5, EndTime: 2 },
    ],
  }];
  const ambiguous = await processJapanesePackageLine(
    mapped.sourceText,
    ambiguousSyllables,
    mapped.spans,
    ambiguousSyllables,
    options,
  );
  assert.equal(ambiguous.romaji, "kuu");
  assert.equal(ambiguous.furigana.some((segment) => segment.provenance === "providerExplicit"), false);
});

test("Chinese-provider Japanese repair is display-only and keeps source evidence", async () => {
  const reading = (await prepareJapaneseLineAnalysis(
    "梦见ては 覚めて见る",
    { textProjection: ChineseProviderJapaneseTextProjection },
  ))?.reading;
  assert.ok(reading);
  assert.equal(reading!.sourceText, "梦见ては 覚めて见る");
  assert.equal(reading!.displayText, "夢見ては 覚めて見る");
});

test("Japanese text projections fail closed when source ranges would shift", async () => {
  await assert.rejects(
    prepareJapaneseLineAnalysis("夢を見る", {
      textProjection: {
        kind: "invalid-test-projection",
        project: (text) => `${text}!`,
      },
    }),
    /changed UTF-16 length/u,
  );
});

test("proven compound geometry distributes romaji across its real timing spans", async () => {
  const plan = await timedJapaneseAnnotation("各駅", "かくえき", {
    かくえき: "kakueki",
    かく: "kaku",
    えき: "eki",
  });

  assert.deepEqual(
    plan.timedReadingUnits.map(({ spanId, text, logicalGroupId, animationTimingRefs }) => ({
      spanId,
      text,
      logicalGroupId,
      animationTimingRefs,
    })),
    [
      {
        spanId: "0",
        text: "kaku",
        logicalGroupId: "jp-token-0",
        animationTimingRefs: undefined,
      },
      {
        spanId: "1",
        text: "eki",
        logicalGroupId: "jp-token-0",
        animationTimingRefs: undefined,
      },
    ],
  );
});

test("mixed Kanji and Kana split only when every romaji piece recombines exactly", async () => {
  const plan = await timedJapaneseAnnotation("乗り込ん", "のりこん", {
    のりこん: "norikon",
    の: "no",
    り: "ri",
    こ: "ko",
    ん: "n",
  });

  assert.deepEqual(
    plan.timedReadingUnits.map(({ text, logicalGroupId }) => [text, logicalGroupId]),
    [
      ["no", "jp-token-0"],
      ["ri", "jp-token-0"],
      ["ko", "jp-token-0"],
      ["n", "jp-token-0"],
    ],
  );
  assert.equal(plan.timedReadingUnits.some((unit) => unit.animationTimingRefs), false);
});

test("opaque and context-sensitive readings keep one text unit but sweep the whole group", async () => {
  for (const fixture of [
    {
      surface: "一人",
      readingKana: "ひとり",
      romaji: { ひとり: "hitori" },
    },
    {
      surface: "待って",
      readingKana: "まって",
      romaji: { まって: "matte", ま: "ma", っ: "tsu", て: "te" },
    },
  ]) {
    const plan = await timedJapaneseAnnotation(
      fixture.surface,
      fixture.readingKana,
      fixture.romaji,
    );
    assert.equal(plan.timedReadingUnits[0].text, fixture.romaji[fixture.readingKana]);
    assert.deepEqual(
      plan.timedReadingUnits[0].animationTimingRefs,
      plan.timedReadingUnits.map((unit) => unit.spanId),
    );
    assert.equal(
      new Set(plan.timedReadingUnits.map((unit) => unit.logicalGroupId)).size,
      1,
    );
    assert.equal(plan.timedReadingUnits.slice(1).every((unit) => unit.text === ""), true);
  }
});

test("Chinese-provider Japanese repair preserves Japanese 占", async () => {
  const reading = (await prepareJapaneseLineAnalysis(
    "ひとり占めできるまで",
    { textProjection: ChineseProviderJapaneseTextProjection },
  ))?.reading;
  assert.ok(reading);
  assert.equal(reading!.sourceText, "ひとり占めできるまで");
  assert.equal(reading!.displayText ?? reading!.sourceText, "ひとり占めできるまで");
});

test("Chinese-provider Japanese repair reaches every timed display span", async () => {
  const syllables = ["梦", "见", "て", "は"].map((Text) => ({ Text }));
  const map = buildJapaneseLineTextMap(syllables);
  const options = { textProjection: ChineseProviderJapaneseTextProjection };
  const prepared = await prepareJapaneseLineAnalysis(
    map.lineText,
    options,
  );
  await applyJapaneseReadingToSyllables(
    map.lineText,
    syllables,
    map.spans,
    options,
    prepared,
  );

  assert.deepEqual(
    syllables.map((syllable) => syllable.JapaneseReading?.displayText || syllable.Text),
    ["夢", "見", "て", "は"],
  );
  assert.deepEqual(syllables.map((syllable) => syllable.Text), ["梦", "见", "て", "は"]);
});

test("compound explicit provenance crosses timed syllables and reaches romaji owners", () => {
  const line = { id: "compound", displayText: "永久に", paragraphProvenance: "lineBoundary" as const,
    spans: ["永", "久", "に"].map((text, index) => ({ id: String(index), rawText: text,
      cleanText: text, startMs: index * 100, endMs: (index + 1) * 100, providerPartOfWord: true })) };
  const canonical = buildCanonicalLine(line);
  const result = buildRenderPlan(line, canonical, [{
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units: canonical.spanMappings.map((mapping, index) => ({
      canonicalRange: mapping.canonicalRange,
      text: index === 0 ? "towa" : index === 2 ? " ni" : "",
      kind: "transformed" as const,
      logicalGroupId: index < 2 ? "jp-explicit" : "jp-local",
      timingRefs: [mapping.spanId],
      ...(index === 0 ? { provenance: "providerExplicit" as const } : {}),
    })),
    furigana: [{
      canonicalRange: { startCp: 0, endCp: 2 },
      reading: "とわ",
      provenance: "providerExplicit",
    }],
  }]);
  assert.equal(new Set(result.timedReadingUnits.map((unit) => unit.spanId)).size, 3);
  assert.equal(result.timedReadingUnits[0].provenance, "providerExplicit");
  const groups = timedFuriganaGroups(result);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].reading, "とわ");
  assert.equal(groups.groups[0].provenance, "providerExplicit");
});
