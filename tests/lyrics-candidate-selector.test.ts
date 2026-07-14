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


test("smart mode uses word timing as a bonus when candidates are otherwise equal", () => {
  const result = selectLyricsCandidate([
    candidate("apple", 0, lineLyrics(correctRows), 1),
    candidate("amlldb", 1, wordLyrics(correctRows), 1),
  ], 240_000, "smart");
  assert.equal(result.candidate?.provider, "amlldb");
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
