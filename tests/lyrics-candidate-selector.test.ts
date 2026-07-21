import assert from "node:assert/strict";
import test from "node:test";
import {
  lyricsTextSimilarity,
  selectLyricsCandidate,
  type LyricsCandidate,
} from "../src/utils/Lyrics/LyricsCandidateSelector.ts";

const lineLyrics = (rows: Array<[string, number]>) => ({
  Type: "Line",
  Content: rows.map(([Text, StartTime], index) => ({ Text, StartTime, EndTime: rows[index + 1]?.[1] ?? 240 })),
});

const staticLyrics = (rows: Array<[string, number]>) => ({
  Type: "Static",
  Lines: rows.map(([Text]) => ({ Text })),
});

const wordLyrics = (rows: Array<[string, number]>) => ({
  Type: "Syllable",
  Content: rows.map(([text, start], index) => ({
    Lead: {
      StartTime: start,
      EndTime: rows[index + 1]?.[1] ?? 240,
      Syllables: [...text].map((Text, wordIndex) => ({
        Text,
        StartTime: start + wordIndex * 0.2,
        EndTime: start + wordIndex * 0.2 + 0.18,
        IsPartOfWord: true,
      })),
    },
  })),
});

const correctRows: Array<[string, number]> = [
  ["風啊 何時來自雲上", 12],
  ["吹拂時間枝椏", 19],
  ["尋到心底那聲迴響", 27],
  ["雨啊 共訴琴聲悠長", 35],
  ["聞弦何愁知音", 43],
];

const wrongRows: Array<[string, number]> = [
  ["完全不同的一首歌", 10],
  ["錯誤版本仍然有逐字時間", 17],
  ["但是內容並不匹配", 24],
  ["不應只因逐字同步勝出", 31],
  ["這是錯誤候選", 38],
];

function candidate(provider: string, orderIndex: number, lyrics: any, confidence = 0.9): LyricsCandidate {
  return { provider, orderIndex, lyrics, match: { confidence } };
}

test("comparison treats Traditional and Simplified Chinese lyrics as equivalent", () => {
  const traditional = lineLyrics(correctRows);
  const simplified = lineLyrics(correctRows.map(([text, time]) => [
    text.replace("風", "风").replace("時", "时").replace("雲", "云").replace("間", "间").replace("尋", "寻").replace("聲", "声").replace("迴", "回").replace("訴", "诉").replace("聞", "闻"),
    time,
  ]));
  assert.ok(lyricsTextSimilarity(traditional, simplified) > 0.95);
});

test("smart mode prefers an agreeing line candidate over a mismatched word candidate", () => {
  const candidates = [
    candidate("amlldb", 0, wordLyrics(correctRows), 1),
    candidate("apple", 1, lineLyrics(correctRows), 1),
    candidate("qq", 2, wordLyrics(wrongRows), 0.72),
  ];
  const result = selectLyricsCandidate(candidates, 240_000, "smart");
  assert.equal(result.candidate?.provider, "amlldb");
  const qq = result.diagnostics.candidates.find((entry) => entry.provider === "qq");
  assert.ok((qq?.textAgreementScore ?? 100) < 40);
});

test("smart mode allows a healthy line candidate to beat malformed word timing", () => {
  const malformed = wordLyrics(correctRows);
  malformed.Content[2].Lead.Syllables[0].StartTime = 400;
  malformed.Content[2].Lead.Syllables[0].EndTime = 399;
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 1, malformed, 0.95),
  ], 240_000, "smart");
  assert.equal(result.candidate?.provider, "apple");
});

test("smart mode accepts instantaneous textual tokens as valid word timing", () => {
  const baseline = wordLyrics(correctRows);
  const withInstantPunctuation = structuredClone(baseline);
  const firstLine = withInstantPunctuation.Content[0].Lead.Syllables;
  const boundary = firstLine[0].EndTime;
  firstLine.splice(1, 0, {
    Text: "/",
    StartTime: boundary,
    EndTime: boundary,
    IsPartOfWord: true,
  });

  const baselineResult = selectLyricsCandidate([
    candidate("baseline", 0, baseline, 1),
  ], 240_000, "smart");
  const punctuationResult = selectLyricsCandidate([
    candidate("punctuation", 0, withInstantPunctuation, 1),
  ], 240_000, "smart");

  assert.equal(
    punctuationResult.diagnostics.candidates[0].structuralTimingScore,
    baselineResult.diagnostics.candidates[0].structuralTimingScore,
  );
});


test("smart mode uses word timing as a bonus when candidates are otherwise equal", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("amlldb", 1, wordLyrics(correctRows), 1),
  ], 240_000, "smart");
  assert.equal(result.candidate?.provider, "amlldb");
  assert.ok(result.diagnostics.candidates.find((entry) => entry.provider === "amlldb")?.reasons.includes("word-synced timing"));
  assert.ok(result.diagnostics.candidates.find((entry) => entry.provider === "apple")?.reasons.includes("line-synced timing"));
});

test("smart mode prefers credible word timing with slightly lower track confidence", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 4, wordLyrics(correctRows), 0.9),
  ], 240_000, "smart");

  assert.equal(result.candidate?.provider, "qq");
  assert.ok(
    (result.diagnostics.candidates.find((entry) => entry.provider === "qq")?.totalScore ?? 0)
      < (result.diagnostics.candidates.find((entry) => entry.provider === "apple")?.totalScore ?? 0),
  );
  assert.ok(
    (result.diagnostics.candidates.find((entry) => entry.provider === "qq")?.selectionScore ?? 0)
      > (result.diagnostics.candidates.find((entry) => entry.provider === "apple")?.selectionScore ?? 0),
  );
});

test("smart mode prefers the verified strong word-timed profile over an exact line match", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 3, lineLyrics(correctRows), 1),
    candidate("kugou", 5, wordLyrics(correctRows), 0.865),
  ], 240_000, "smart");

  assert.equal(result.candidate?.provider, "kugou");
  const apple = result.diagnostics.candidates.find((entry) => entry.provider === "apple");
  const kugou = result.diagnostics.candidates.find((entry) => entry.provider === "kugou");
  assert.ok((kugou?.selectionScore ?? 0) > (apple?.selectionScore ?? 0));
  assert.equal(kugou?.trackMatchScore, 86.5);
});

test("smart mode does not let timing detail rescue a weak track match", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 4, wordLyrics(correctRows), 0.79),
  ], 240_000, "smart");

  assert.equal(result.candidate?.provider, "apple");
});

test("smart mode uses the best agreeing timing peer instead of averaging in an offset source", () => {
  const shiftedRows = correctRows.map(([text, start]) => [text, start + 6] as [string, number]);
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(shiftedRows), 1),
    candidate("qq", 4, wordLyrics(correctRows), 0.97),
    candidate("kugou", 5, wordLyrics(correctRows), 0.97),
  ], 240_000, "smart");

  assert.equal(result.candidate?.provider, "qq");
  const qq = result.diagnostics.candidates.find((entry) => entry.provider === "qq");
  const apple = result.diagnostics.candidates.find((entry) => entry.provider === "apple");
  assert.equal(qq?.timingAgreementScore, 100);
  assert.equal(apple?.timingAgreementScore, 30);
  assert.equal(qq?.reasons.includes("line timing differs from agreeing sources"), false);
  assert.equal(apple?.reasons.includes("line timing differs from agreeing sources"), true);
});

test("smart scores stay stable when an unrelated provider appears", () => {
  const base = [
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 4, wordLyrics(correctRows), 0.97),
  ];
  const withoutNoise = selectLyricsCandidate(base, 240_000, "smart");
  const withNoise = selectLyricsCandidate([
    ...base,
    candidate("soda", 6, lineLyrics(wrongRows), 1),
  ], 240_000, "smart");

  assert.equal(withoutNoise.candidate?.provider, "qq");
  assert.equal(withNoise.candidate?.provider, "qq");
  for (const provider of ["apple", "qq"]) {
    const before = withoutNoise.diagnostics.candidates.find((entry) => entry.provider === provider);
    const after = withNoise.diagnostics.candidates.find((entry) => entry.provider === provider);
    assert.equal(after?.totalScore, before?.totalScore);
    assert.equal(after?.selectionScore, before?.selectionScore);
    assert.equal(after?.priorityScore, before?.priorityScore);
  }
});

test("smart selection is independent of candidate arrival order", () => {
  const entries = [
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 4, wordLyrics(correctRows), 0.97),
    candidate("kugou", 5, wordLyrics(correctRows), 0.97),
    candidate("soda", 6, lineLyrics(wrongRows), 0.95),
  ];

  assert.equal(selectLyricsCandidate(entries, 240_000, "smart").candidate?.provider, "qq");
  assert.equal(selectLyricsCandidate([...entries].reverse(), 240_000, "smart").candidate?.provider, "qq");
});

test("source order breaks a true same-quality tie without changing scores", () => {
  const result = selectLyricsCandidate([
    candidate("later", 6, wordLyrics(correctRows), 0.95),
    candidate("earlier", 2, wordLyrics(correctRows), 0.95),
  ], 240_000, "smart");

  assert.equal(result.candidate?.provider, "earlier");
  const later = result.diagnostics.candidates.find((entry) => entry.provider === "later");
  const earlier = result.diagnostics.candidates.find((entry) => entry.provider === "earlier");
  assert.equal(later?.totalScore, earlier?.totalScore);
  assert.equal(later?.selectionScore, earlier?.selectionScore);
  assert.notEqual(later?.priorityScore, earlier?.priorityScore);
});

test("smart mode strongly penalizes plain lyrics when a credible synced candidate agrees", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, staticLyrics(correctRows), 1),
    candidate("netease", 1, lineLyrics(correctRows), 0.68),
  ], 240_000, "smart");
  assert.equal(result.candidate?.provider, "netease");
  const apple = result.diagnostics.candidates.find((entry) => entry.provider === "apple");
  assert.ok(apple?.reasons.includes("no synced timing"));
});

test("smart mode keeps plain lyrics as fallback when the synced candidate is rejected", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, staticLyrics(correctRows), 1),
    candidate("netease", 1, lineLyrics(correctRows), 0.29),
  ], 240_000, "smart");
  assert.equal(result.candidate?.provider, "apple");
});

test("smart mode penalizes a globally shifted word candidate when agreeing sources align", () => {
  const shiftedRows = correctRows.map(([text, start]) => [text, start + 6] as [string, number]);
  const result = selectLyricsCandidate([
    candidate("amlldb", 0, lineLyrics(correctRows), 1),
    candidate("apple", 1, lineLyrics(correctRows), 1),
    candidate("qq", 2, wordLyrics(shiftedRows), 1),
  ], 240_000, "smart");
  assert.notEqual(result.candidate?.provider, "qq");
  const qq = result.diagnostics.candidates.find((entry) => entry.provider === "qq");
  assert.ok(qq?.reasons.includes("line timing differs from agreeing sources"));
});

test("sync type mode preserves word-first behavior", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 1, wordLyrics(wrongRows), 0.6),
  ], 240_000, "syncType");
  assert.equal(result.candidate?.provider, "qq");
});

test("strict mode returns the first valid provider without quality comparison", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("qq", 1, wordLyrics(correctRows), 1),
  ], 240_000, "strict");
  assert.equal(result.candidate?.provider, "apple");
});

test("all modes return an empty diagnostic result when no provider succeeds", () => {
  for (const mode of ["smart", "syncType", "strict"] as const) {
    const result = selectLyricsCandidate([], 240_000, mode);
    assert.equal(result.candidate, null);
    assert.equal(result.diagnostics.selectedProvider, null);
    assert.deepEqual(result.diagnostics.candidates, []);
  }
});
