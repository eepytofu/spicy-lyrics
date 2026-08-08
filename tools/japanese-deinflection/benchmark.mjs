import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import Kuroshiro from "kuroshiro";
import kuromoji from "kuromoji";

import { fixtures } from "../../builds/private-research/experiments/sudachi-full/fixtures.mjs";
import { badAppleLines } from "../../builds/private-research/experiments/upstream-release-benchmark/bad-apple.mjs";

const HELD_OUT_SONGS = [
  { songId: 3022, lyricsId: 3775 },
  { songId: 288238, lyricsId: 78398 },
  { songId: 164074, lyricsId: 47076 },
  { songId: 112085, lyricsId: 26658 },
  { songId: 185363, lyricsId: 54252 },
  { songId: 161199, lyricsId: 46279 },
];
const VISIBLE_CORPUS_LINES = fixtures.map(({ text }) => text);
const LEXICAL_GUARD_LINES = [
  "同じ阿呆でも踊らにゃ損損",
  "終えるななんて何様だ",
];
const EXPECTED_TARGETS = 44;
const EXPECTED_HELD_OUT_LINES = 276;
const GATES = {
  gzipBytes: 2 * 1024 * 1024,
  incrementalPeakHeapBytes: 32 * 1024 * 1024,
  coldInitializationMs: 500,
  addedP95MsPerLine: 2,
};
const kuroshiroUtil = Kuroshiro.Util || Kuroshiro.default?.Util;
if (!kuroshiroUtil) throw new Error("Kuroshiro kana romanizer was unavailable");

let settingsBlob = null;
Object.defineProperty(globalThis, "Spicetify", {
  configurable: true,
  value: {
    LocalStorage: {
      get: () => settingsBlob,
      set: (_key, value) => {
        settingsBlob = value;
      },
    },
  },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const [
  japaneseReading,
  kuromojiAdapter,
  kuromojiPolicy,
  readingResolver,
  deinflectionEngine,
  deinflectionResolver,
] = await Promise.all([
  import("../../src/utils/Lyrics/Reading/JapaneseReading.ts"),
  import("../../src/utils/Lyrics/Processing/Japanese/KuromojiJapaneseAnalyzer.ts"),
  import("../../src/utils/Lyrics/Processing/Japanese/KuromojiReadingPolicy.ts"),
  import("../../src/utils/Lyrics/Processing/Japanese/JapaneseReadingResolver.ts"),
  import("../../src/utils/Lyrics/Processing/Japanese/JapaneseDeinflection.ts"),
  import("../../src/utils/Lyrics/Processing/Japanese/JapaneseDeinflectionResolver.ts"),
]);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] || 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function splitLyricLines(value) {
  return String(value || "")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function loadHeldOutLines() {
  const songs = [];
  for (const { songId, lyricsId } of HELD_OUT_SONGS) {
    const response = await fetch(
      `https://vocadb.net/api/songs/${songId}?fields=Lyrics,Names,Artists`,
      { headers: { "User-Agent": "SpicyLyricsResearch/1.0 (private resolver benchmark)" } },
    );
    if (!response.ok) throw new Error(`VocaDB song ${songId} failed: ${response.status}`);
    const payload = await response.json();
    const lyrics = payload.lyrics?.find(({ id }) => id === lyricsId);
    if (!lyrics) throw new Error(`VocaDB song ${songId} did not expose lyric entry ${lyricsId}`);
    const lines = splitLyricLines(lyrics.value);
    songs.push({ songId, lyricsId, lineCount: lines.length, lines });
  }
  const lines = songs.flatMap((song) => song.lines);
  if (lines.length !== EXPECTED_HELD_OUT_LINES) {
    throw new Error(`Held-out corpus changed: expected ${EXPECTED_HELD_OUT_LINES}, received ${lines.length}`);
  }
  return { songs, lines };
}

async function buildTokenizer() {
  const dictionaryPath = fileURLToPath(
    new URL("../../node_modules/kuromoji/dict/", import.meta.url),
  ).replaceAll("\\", "/");
  const started = performance.now();
  const tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, value) =>
      error ? reject(error) : resolve(value));
  });
  return { tokenizer, initializationMs: performance.now() - started };
}

function assertExactTokenRanges(text, tokens) {
  let cursor = 0;
  for (const token of tokens) {
    if (token.start !== cursor || text.slice(token.start, token.end) !== token.surface) {
      throw new Error(`Kuromoji token range did not reconstruct line hash ${sha256(text)}`);
    }
    cursor = token.end;
  }
  if (cursor !== text.length) {
    throw new Error(`Kuromoji token tail did not reconstruct line hash ${sha256(text)}`);
  }
}

function buildProductionEntries(text, tokens) {
  const entries = tokens.map((token) => ({
    start: token.start,
    end: token.end,
    surface: token.surface,
    readingKana: token.readingKana,
    romaji: "",
    consumed: false,
  }));
  kuromojiPolicy.applyKuromojiReadingOverrides(entries, tokens);
  readingResolver.applyVerifiedLexicalReadings(text, tokens, entries);
  readingResolver.applyProductivePersonCounterReadings(text, tokens, entries);
  return entries;
}

async function processLine(text, resolverEnabled = true) {
  const analysis = await japaneseReading.prepareJapaneseLineAnalysis(text, {
    analyzer: resolverEnabled ? productionAnalyzer : baselineAnalyzer,
    kanaRomanizer: (kana) => kuroshiroUtil.kanaToRomaji(kana),
  });
  return JSON.stringify(analysis?.reading ?? null);
}

async function measureLines(lines, repetitions, resolverEnabled) {
  const samples = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const text of lines) {
      const started = performance.now();
      await processLine(text, resolverEnabled);
      samples.push(performance.now() - started);
    }
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    samples: samples.length,
  };
}

async function measureResolverStage(lines, repetitions) {
  const samples = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const text of lines) {
      const tokens = tokenMap.get(text);
      const entries = buildProductionEntries(text, tokens);
      const started = performance.now();
      await deinflectionResolver.resolveJapaneseDeinflectionReadings(text, tokens, entries);
      samples.push(performance.now() - started);
    }
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    samples: samples.length,
  };
}

const targetCount = fixtures.reduce((total, fixture) => total + fixture.targets.length, 0);
if (fixtures.length !== 27 || targetCount !== EXPECTED_TARGETS) {
  throw new Error(`Historical corpus changed: ${fixtures.length} lines / ${targetCount} targets`);
}

const heldOut = await loadHeldOutLines();
const corpusGroups = [
  { id: "historical-27-line", lines: VISIBLE_CORPUS_LINES },
  { id: "bad-apple-complete", lines: badAppleLines },
  { id: "lexical-guard", lines: LEXICAL_GUARD_LINES },
  { id: "held-out-276-line", lines: heldOut.lines },
];
const allLines = corpusGroups.flatMap(({ lines }) => lines);
const uniqueLines = [...new Set([...allLines, "失くした"] )];
const { tokenizer, initializationMs: kuromojiInitializationMs } = await buildTokenizer();
const tokenMap = new Map();
for (const text of uniqueLines) {
  const tokens = kuromojiAdapter.normalizeKuromojiTokens(text, tokenizer.tokenize(text));
  assertExactTokenRanges(text, tokens);
  tokenMap.set(text, tokens);
}

const productionAnalyzer = {
  id: "kuromoji",
  applyReadingOverrides: kuromojiPolicy.applyKuromojiReadingOverrides,
  async analyze(text) {
    let tokens = tokenMap.get(text);
    if (!tokens) {
      tokens = kuromojiAdapter.normalizeKuromojiTokens(text, tokenizer.tokenize(text));
      assertExactTokenRanges(text, tokens);
      tokenMap.set(text, tokens);
    }
    return tokens;
  },
};
const baselineAnalyzer = {
  ...productionAnalyzer,
  id: "kuromoji-baseline-benchmark",
};
deinflectionEngine.releaseJapaneseDeinflectionData();

// Warm every pre-resolver production dependency before attributing incremental cost.
for (const text of [...VISIBLE_CORPUS_LINES, ...badAppleLines]) await processLine(text, false);
if (globalThis.gc) globalThis.gc();

const generatedSource = await readFile(
  new URL("../../src/utils/Lyrics/Processing/Japanese/GeneratedJapaneseDeinflectionData.ts", import.meta.url),
);
const generatedGzipBytes = gzipSync(generatedSource, { level: 9 }).length;

const timingLines = [...VISIBLE_CORPUS_LINES, ...badAppleLines, ...LEXICAL_GUARD_LINES];

deinflectionEngine.releaseJapaneseDeinflectionData();
if (globalThis.gc) globalThis.gc();
const productionHeapStart = process.memoryUsage().heapUsed;
let productionHeapPeak = productionHeapStart;
for (const text of ["失くした", ...timingLines]) {
  await processLine(text, false);
  productionHeapPeak = Math.max(productionHeapPeak, process.memoryUsage().heapUsed);
}
const productionPeakHeapBytes = Math.max(0, productionHeapPeak - productionHeapStart);

if (globalThis.gc) globalThis.gc();
const resolverHeapStart = process.memoryUsage().heapUsed;
let resolverHeapPeak = resolverHeapStart;
const coldStarted = performance.now();
await processLine("失くした", true);
const coldInitializationMs = performance.now() - coldStarted;
resolverHeapPeak = Math.max(resolverHeapPeak, process.memoryUsage().heapUsed);
for (const text of timingLines) {
  await processLine(text, true);
  resolverHeapPeak = Math.max(resolverHeapPeak, process.memoryUsage().heapUsed);
}
const resolverPeakHeapBytes = Math.max(0, resolverHeapPeak - resolverHeapStart);
const incrementalPeakHeapBytes = Math.max(0, resolverPeakHeapBytes - productionPeakHeapBytes);

deinflectionEngine.releaseJapaneseDeinflectionData();
const baselineOutputs = new Map();
for (const { id, lines } of corpusGroups) {
  baselineOutputs.set(id, await Promise.all(lines.map((line) => processLine(line, false))));
}

const outputComparison = [];
for (const { id, lines } of corpusGroups) {
  const baseline = baselineOutputs.get(id);
  const withResolver = await Promise.all(lines.map((line) => processLine(line, true)));
  const baselineBytes = JSON.stringify(baseline);
  const resolverBytes = JSON.stringify(withResolver);
  const changedLineIndexes = baseline
    .map((value, index) => value === withResolver[index] ? -1 : index)
    .filter((index) => index >= 0);
  const sourceTextPreserved = baseline.every((value, index) =>
    JSON.parse(value)?.sourceText === JSON.parse(withResolver[index])?.sourceText);
  outputComparison.push({
    id,
    lines: lines.length,
    byteEquivalent: baselineBytes === resolverBytes,
    changedLines: changedLineIndexes.length,
    sourceTextPreserved,
    baselineSha256: sha256(baselineBytes),
    resolverSha256: sha256(resolverBytes),
    containsNakushitaCorrection: withResolver.some((value) =>
      value.includes("nakushita") && value.includes('"reading":"な"')),
  });
}

const quality = {};
for (const { id, lines } of corpusGroups) {
  const counts = {};
  const samples = {};
  for (const text of lines) {
    const tokens = tokenMap.get(text);
    const entries = buildProductionEntries(text, tokens);
    const records = await deinflectionResolver.collectJapaneseDeinflectionCandidates(text, tokens, entries);
    for (const record of records) {
      counts[record.status] = (counts[record.status] || 0) + 1;
      const bucket = samples[record.status] || [];
      const sample = {
        surface: record.surface,
        baselineReading: record.baselineReading,
        lemma: record.lemma,
        projectedReading: record.projectedReading,
      };
      if (
        bucket.length < 8
        && !bucket.some((existing) => JSON.stringify(existing) === JSON.stringify(sample))
      ) bucket.push(sample);
      samples[record.status] = bucket;
    }
  }
  quality[id] = { counts, samples };
}

deinflectionEngine.releaseJapaneseDeinflectionData();
const productionWithoutResolver = await measureLines(timingLines, 8, false);
const productionWithResolver = await measureLines(timingLines, 8, true);
const fullPipelineP95DeltaMs = productionWithResolver.p95Ms - productionWithoutResolver.p95Ms;
const resolverIncrement = await measureResolverStage(timingLines, 8);
const addedP95MsPerLine = resolverIncrement.p95Ms;
deinflectionEngine.releaseJapaneseDeinflectionData();

const gateResults = {
  generatedGzip: generatedGzipBytes <= GATES.gzipBytes,
  incrementalPeakHeap: incrementalPeakHeapBytes <= GATES.incrementalPeakHeapBytes,
  coldInitialization: coldInitializationMs <= GATES.coldInitializationMs,
  addedP95: addedP95MsPerLine <= GATES.addedP95MsPerLine,
  outputBehavior: outputComparison.every((comparison) =>
    comparison.sourceTextPreserved
    && (comparison.id === "held-out-276-line"
      ? !comparison.byteEquivalent
        && comparison.changedLines > 0
        && comparison.containsNakushitaCorrection
      : comparison.byteEquivalent)),
};

const report = {
  corpus: {
    historical: { lines: fixtures.length, targets: targetCount },
    badApple: { lines: badAppleLines.length },
    lexicalGuard: { lines: LEXICAL_GUARD_LINES.length },
    heldOut: {
      lines: heldOut.lines.length,
      songs: heldOut.songs.map(({ songId, lyricsId, lineCount }) => ({ songId, lyricsId, lineCount })),
    },
  },
  artifact: { utf8Bytes: generatedSource.length, gzipBytes: generatedGzipBytes },
  performance: {
    kuromojiInitializationMs,
    coldInitializationMs,
    productionPeakHeapBytes,
    resolverPeakHeapBytes,
    incrementalPeakHeapBytes,
    productionWithoutResolver,
    productionWithResolver,
    fullPipelineP95DeltaMs,
    resolverIncrement,
    addedP95MsPerLine,
  },
  quality,
  outputComparison,
  gates: { thresholds: GATES, results: gateResults },
};

console.log(JSON.stringify(report, null, 2));
if (Object.values(gateResults).some((passed) => !passed)) {
  throw new Error(`Japanese deinflection resolver benchmark gate failed: ${JSON.stringify(gateResults)}`);
}
