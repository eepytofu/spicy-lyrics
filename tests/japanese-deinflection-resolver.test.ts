import assert from "node:assert/strict";
import test from "node:test";
import {
  JAPANESE_DEINFLECTION_METADATA,
  JAPANESE_DEINFLECTION_RULES,
} from "../src/utils/Lyrics/Processing/Japanese/GeneratedJapaneseDeinflectionData.ts";
import {
  deinflectJapaneseRuleSurface,
  deinflectJapaneseSurface,
  reinflectJapaneseRuleSurface,
  type JapaneseDeinflectionRuleTuple,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseDeinflection.ts";
import {
  collectJapaneseDeinflectionCandidates,
  resolveJapaneseDeinflectionReadings,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseDeinflectionResolver.ts";
import type { JapaneseAnalyzerToken } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";
import type {
  JapaneseReadable,
  JapaneseTokenEntry,
} from "../src/utils/Lyrics/Reading/JapaneseReadingModel.ts";

function token(
  surface: string,
  start: number,
  end: number,
  readingKana: string,
  partOfSpeech: JapaneseAnalyzerToken["partOfSpeech"] = "other",
): JapaneseAnalyzerToken {
  return {
    surface,
    start,
    end,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech,
    morphologyFeatures: [],
    baseForm: "",
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

function entry(value: JapaneseAnalyzerToken): JapaneseTokenEntry {
  return {
    start: value.start,
    end: value.end,
    surface: value.surface,
    readingKana: value.readingKana,
    romaji: "",
    consumed: false,
  };
}

test("generated data pins all Yomitan transform families and compact sources", () => {
  assert.equal(JAPANESE_DEINFLECTION_METADATA.yomitanRelease, "26.7.21.0");
  assert.equal(JAPANESE_DEINFLECTION_METADATA.jmdictRevision, "JMdict.2026-07-28");
  assert.equal(
    JAPANESE_DEINFLECTION_METADATA.yomitanTransformSourceSha256,
    "467b7973efec4ba871bda47a0098e13585aa223b936a95a8d734bea474d0589a",
  );
  assert.equal(
    JAPANESE_DEINFLECTION_METADATA.jmdictTermBanksSha256,
    "d66650a297348fae4ec5cb09fa43378534ca447fbad3efc2deb8e28e1498a8af",
  );
  assert.equal(JAPANESE_DEINFLECTION_METADATA.transformFamilies, 54);
  assert.equal(JAPANESE_DEINFLECTION_METADATA.transformRules, 834);
  assert.equal(JAPANESE_DEINFLECTION_RULES.length, 834);
  assert.equal(JAPANESE_DEINFLECTION_METADATA.lemmaEntries, 12_634);
  assert.equal(JAPANESE_DEINFLECTION_METADATA.rejectedLemmaEntries, 904);
});

test("every generated transform rule reverses its own surface rewrite", () => {
  const families = new Set<string>();
  for (const rawRule of JAPANESE_DEINFLECTION_RULES) {
    const rule = rawRule as JapaneseDeinflectionRuleTuple;
    families.add(rule[0]);
    const dictionaryForm = rule[2] === "wholeWord" ? rule[4] : `仮${rule[4]}`;
    const inflectedForm = reinflectJapaneseRuleSurface(dictionaryForm, rule);
    assert.ok(inflectedForm, `${rule[0]}#${rule[1]} must reinflect`);
    assert.equal(
      deinflectJapaneseRuleSurface(inflectedForm, rule),
      dictionaryForm,
      `${rule[0]}#${rule[1]}`,
    );
  }
  assert.equal(families.size, 54);
});

test("full deinflection resolves representative simple and stacked forms", async () => {
  const lost = await deinflectJapaneseSurface("失くした");
  assert.ok(lost.candidates.some((candidate) =>
    candidate.lemma === "失くす"
    && candidate.lemmaReading === "なくす"
    && candidate.projectedReading === "なくした"
    && candidate.trace.map((frame) => frame.family).includes("-た")
  ));

  const change = await deinflectJapaneseSurface("変われる");
  assert.ok(change.candidates.some((candidate) =>
    candidate.lemma === "変わる"
    && candidate.projectedReading === "かわれる"
    && candidate.trace.map((frame) => frame.family).includes("potential")
  ));

  const stacked = await deinflectJapaneseSurface("食べられなかった");
  assert.ok(stacked.candidates.some((candidate) =>
    candidate.lemma === "食べる"
    && candidate.projectedReading === "たべられなかった"
    && candidate.trace.length >= 3
  ));
});

test("representative production transform families preserve projected readings", async () => {
  const fixtures = [
    ["書いた", "書く", "かいた", "-た"],
    ["書かない", "書く", "かかない", "negative"],
    ["書いて", "書く", "かいて", "-て"],
    ["書きました", "書く", "かきました", "-ます"],
    ["書かれる", "書く", "かかれる", "passive"],
    ["変われる", "変わる", "かわれる", "potential"],
    ["書かせる", "書く", "かかせる", "causative"],
    ["高かった", "高い", "たかかった", "-た"],
    ["食べちゃった", "食べる", "たべちゃった", "-ちゃう"],
    ["帰ろっか", "帰る", "かえろっか", "volitional slang"],
    ["書かへん", "書く", "かかへん", "kansai-ben negative"],
  ] as const;

  for (const [surface, lemma, projectedReading, family] of fixtures) {
    const result = await deinflectJapaneseSurface(surface);
    assert.equal(result.budgetExceeded, false, surface);
    assert.ok(result.candidates.some((candidate) =>
      candidate.lemma === lemma
      && candidate.projectedReading === projectedReading
      && candidate.geometryEvidence === "okurigana"
      && candidate.trace.some((frame) => frame.family === family)
    ), surface);
  }
});

test("state, depth, and candidate limits abstain explicitly", async () => {
  assert.equal(
    (await deinflectJapaneseSurface("失くした", { maxStates: 1 })).budgetExceeded,
    true,
  );
  assert.equal(
    (await deinflectJapaneseSurface("食べさせられなかった", { maxDepth: 1 })).budgetExceeded,
    true,
  );
  assert.equal(
    (await deinflectJapaneseSurface("食べられなかった", { maxCandidates: 1 })).budgetExceeded,
    true,
  );
});

test("candidate collection proposes 失くした without mutating Kuromoji-owned tokens or entries", async () => {
  const tokens = [
    token("失", 0, 1, "しつ", "verb"),
    token("くし", 1, 3, "くし"),
    token("た", 3, 4, "た", "auxiliaryVerb"),
  ];
  const entries = tokens.map(entry);
  const beforeTokens = structuredClone(tokens);
  const beforeEntries = structuredClone(entries);
  const records = await collectJapaneseDeinflectionCandidates("失くした", tokens, entries);

  assert.deepEqual(records, [{
    status: "wouldCorrect",
    start: 0,
    end: 4,
    surface: "失くした",
    baselineReading: "しつくした",
    lemma: "失くす",
    lemmaReading: "なくす",
    projectedReading: "なくした",
    traceFamilies: ["-た"],
  }]);
  assert.deepEqual(tokens, beforeTokens);
  assert.deepEqual(entries, beforeEntries);
});

test("production Japanese analysis always applies safe deinflection corrections", async () => {
  const tokens = [
    token("失", 0, 1, "しつ", "verb"),
    token("くし", 1, 3, "くし"),
    token("た", 3, 4, "た", "auxiliaryVerb"),
  ];
  const productionAnalyzer = {
    id: "kuromoji",
    version: "test",
    dictionaryId: "test",
    analyze: async () => structuredClone(tokens),
  };
  const rawAnalyzer = {
    ...productionAnalyzer,
    id: "raw-kuromoji-test-double",
  };
  const options = {
    analyzer: productionAnalyzer,
    kanaRomanizer: (kana: string) => kana,
  };

  const baseline = await prepareJapaneseLineAnalysis("失くした", {
    ...options,
    analyzer: rawAnalyzer,
  });

  const production = await prepareJapaneseLineAnalysis("失くした", options);
  assert.equal(baseline?.reading.romaji, "しつ くし た");
  assert.equal(production?.reading.romaji, "なくした");
  assert.deepEqual(production?.reading.furigana, [{ start: 0, end: 1, reading: "な" }]);
  assert.equal(production?.reading.sourceText, baseline?.reading.sourceText);
  const syllables: Array<JapaneseReadable & { StartTime: number; EndTime: number }> = [
    { Text: "失", StartTime: 0, EndTime: 100 },
    { Text: "くし", StartTime: 100, EndTime: 200 },
    { Text: "た", StartTime: 200, EndTime: 300 },
  ];
  production?.applyToSyllables(syllables, [
    { index: 0, rawText: "失", normalizedText: "失", start: 0, end: 1 },
    { index: 1, rawText: "くし", normalizedText: "くし", start: 1, end: 3 },
    { index: 2, rawText: "た", normalizedText: "た", start: 3, end: 4 },
  ]);
  assert.deepEqual(
    syllables.map(({ StartTime, EndTime }) => ({ StartTime, EndTime })),
    [
      { StartTime: 0, EndTime: 100 },
      { StartTime: 100, EndTime: 200 },
      { StartTime: 200, EndTime: 300 },
    ],
  );
  assert.deepEqual(
    syllables.map((syllable) => syllable.JapaneseReading?.romaji),
    ["な", "くし", "た"],
  );
});

test("current verified corrections agree and provider-authored readings retain precedence", async () => {
  const changeTokens = [token("変", 0, 1, "へん"), token("われる", 1, 4, "われる")];
  const corrected = changeTokens.map(entry);
  corrected[0].readingKana = "か";
  const agreement = await collectJapaneseDeinflectionCandidates("変われる", changeTokens, corrected);
  assert.equal(agreement.find((record) => record.surface === "変われる")?.status, "agreesWithProduction");

  const lostTokens = [
    token("失", 0, 1, "しつ"),
    token("くし", 1, 3, "くし"),
    token("た", 3, 4, "た", "auxiliaryVerb"),
  ];
  const providerEntries = lostTokens.map(entry);
  providerEntries[0].readingKana = "な";
  providerEntries[0].readingProvenance = "providerExplicit";
  const provider = await collectJapaneseDeinflectionCandidates("失くした", lostTokens, providerEntries);
  assert.equal(provider.find((record) => record.surface === "失くした")?.status, "providerWins");
});

test("context traps abstain instead of copying Yomitan scanner mistakes", async () => {
  const ambiguousToken = token("大人気なく", 0, 5, "だいにんきなく");
  const ambiguous = await collectJapaneseDeinflectionCandidates(
    "大人気なく",
    [ambiguousToken],
    [entry(ambiguousToken)],
  );
  assert.equal(ambiguous.find((record) => record.surface === "大人気なく")?.status, "ambiguous");

  for (const text of ["今日はいい天気", "私から離れる"]) {
    const whole = token(text, 0, text.length, "");
    const records = await collectJapaneseDeinflectionCandidates(text, [whole], [entry(whole)]);
    assert.equal(records.some((record) => record.status === "wouldCorrect"), false, text);
  }

  const wrapped = await deinflectJapaneseSurface("包まれて");
  assert.ok(wrapped.rejectedAmbiguous > 0);
  const wrappedToken = token("包まれて", 0, 4, "つつまれて");
  const wrappedRecords = await collectJapaneseDeinflectionCandidates(
    "包まれて",
    [wrappedToken],
    [entry(wrappedToken)],
  );
  assert.equal(wrappedRecords[0]?.status, "ambiguous");

  const phrase = await deinflectJapaneseSurface("蓋を開けた");
  assert.deepEqual(phrase.candidates, []);

  const adult = token("大人", 0, 2, "おとな", "noun");
  const purchase = token("買い", 2, 4, "かい", "suffix");
  purchase.morphologyFeatures = ["suffix"];
  const purchaseEntries = [entry(adult), entry(purchase)];
  purchaseEntries[1].readingKana = "がい";
  const purchaseRecords = await collectJapaneseDeinflectionCandidates(
    "大人買い",
    [adult, purchase],
    purchaseEntries,
  );
  assert.equal(purchaseRecords.some((record) => record.status === "wouldCorrect"), false);

  const geometryToken = token("打目戍れば", 0, 5, "");
  const geometryRecords = await collectJapaneseDeinflectionCandidates(
    "打目戍れば",
    [geometryToken],
    [entry(geometryToken)],
  );
  assert.equal(geometryRecords[0]?.status, "geometryMissing");
});

test("overlapping exact-token candidates are diagnostics, never corrections", async () => {
  const tokens = [
    token("泣き", 0, 2, "なき", "verb"),
    token("出し", 2, 4, "だし", "verb"),
    token("そう", 4, 6, "そう", "auxiliaryVerb"),
  ];
  const records = await collectJapaneseDeinflectionCandidates(
    "泣き出しそう",
    tokens,
    tokens.map(entry),
  );
  assert.ok(records.some((record) => record.status === "overlap"));
  assert.equal(records.some((record) => record.status === "wouldCorrect"), false);
});

test("punctuation, whitespace, and kana-only spans remain untouched", async () => {
  const fixtures = [
    [" ", ""],
    ["。", ""],
    ["ながれてく", "ながれてく"],
  ] as const;
  for (const [surface, reading] of fixtures) {
    const value = token(surface, 0, surface.length, reading);
    const tokens = [value];
    const entries = [entry(value)];
    const beforeTokens = structuredClone(tokens);
    const beforeEntries = structuredClone(entries);
    assert.deepEqual(await collectJapaneseDeinflectionCandidates(surface, tokens, entries), []);
    assert.deepEqual(tokens, beforeTokens);
    assert.deepEqual(entries, beforeEntries);
  }
});

test("resolver reports the correction it applied", async () => {
  const tokens = [
    token("失", 0, 1, "しつ"),
    token("くし", 1, 3, "くし"),
    token("た", 3, 4, "た", "auxiliaryVerb"),
  ];
  const records = await resolveJapaneseDeinflectionReadings(
    "失くした",
    tokens,
    tokens.map(entry),
  );
  assert.equal(records.at(-1)?.status, "corrected");
});
