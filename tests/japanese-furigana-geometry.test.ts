import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import { timedFuriganaGroups } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";
import { JAPANESE_FURIGANA_GEOMETRY_BUCKETS } from "../src/utils/Lyrics/Processing/Japanese/GeneratedJitendexFuriganaGeometry.ts";
import { lookupJitendexFuriganaGeometry } from "../src/utils/Lyrics/Processing/Japanese/JitendexFuriganaGeometry.ts";
import { buildCanonicalLine } from "../src/utils/Lyrics/Processing/Canonical.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

function analyzerToken(surface: string, readingKana: string): JapaneseAnalyzerToken {
  return {
    surface,
    start: 0,
    end: surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "noun",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "geometry-fixture", rangeSource: "native" },
  };
}

function fixtureAnalyzer(surface: string, readingKana: string): JapaneseAnalyzer {
  return {
    id: "geometry-fixture",
    async analyze(text) {
      assert.equal(text, surface);
      return [analyzerToken(surface, readingKana)];
    },
  };
}

async function projectedFurigana(surface: string, readingKana: string) {
  return (
    await prepareJapaneseLineAnalysis(surface, undefined, undefined, {
      analyzer: fixtureAnalyzer(surface, readingKana),
      kanaRomanizer: (kana) => kana,
    })
  )?.reading.furigana.map(({ start, end, reading }) => ({ start, end, reading }));
}

function characterSpans(text: string): ParsedLine {
  return {
    id: "geometry-fixture",
    displayText: text,
    paragraphProvenance: "unavailable",
    spans: Array.from(text).map((character, index) => ({
      id: String(index),
      rawText: character,
      cleanText: character,
      startMs: index,
      endMs: index + 1,
      providerPartOfWord: true,
    })),
  };
}

async function projectedTimedGroups(surface: string, readingKana: string) {
  const analysis = await prepareJapaneseLineAnalysis(surface, undefined, undefined, {
    analyzer: fixtureAnalyzer(surface, readingKana),
    kanaRomanizer: (kana) => kana,
  });
  assert.ok(analysis);
  const canonical = buildCanonicalLine(characterSpans(surface));
  return timedFuriganaGroups({
    sourceUnits: canonical.spanMappings,
    furigana: analysis.reading.furigana,
  } as any);
}

test("exact consensus geometry splits an ordinary compound", () => {
  assert.deepEqual(lookupJitendexFuriganaGeometry("運命", "ウンメイ"), [
    { start: 0, end: 1, reading: "うん" },
    { start: 1, end: 2, reading: "めい" },
  ]);
  assert.deepEqual(lookupJitendexFuriganaGeometry("一際", "ヒトキワ"), [
    { start: 0, end: 1, reading: "ひと" },
    { start: 1, end: 2, reading: "きわ" },
  ]);
  assert.deepEqual(lookupJitendexFuriganaGeometry("流星", "リュウセイ"), [
    { start: 0, end: 1, reading: "りゅう" },
    { start: 1, end: 2, reading: "せい" },
  ]);
});

test("special, disputed, and unreachable readings abstain", () => {
  assert.equal(lookupJitendexFuriganaGeometry("運命", "さだめ"), undefined);
  assert.equal(lookupJitendexFuriganaGeometry("一昨日", "おととい"), undefined);
  assert.equal(lookupJitendexFuriganaGeometry("海女", "あま"), undefined);
  assert.equal(lookupJitendexFuriganaGeometry("上手", "じょうず"), undefined);
  assert.equal(lookupJitendexFuriganaGeometry("一歩", "いっぽ"), undefined);
});

test("product projection uses detailed geometry and preserves broad fallback", async () => {
  assert.deepEqual(await projectedFurigana("運命", "うんめい"), [
    { start: 0, end: 1, reading: "うん" },
    { start: 1, end: 2, reading: "めい" },
  ]);
  assert.deepEqual(await projectedFurigana("運命", "さだめ"), [
    { start: 0, end: 2, reading: "さだめ" },
  ]);
  assert.deepEqual(await projectedFurigana("海女", "あま"), [
    { start: 0, end: 2, reading: "あま" },
  ]);
});

test("detailed compounds keep per-character timing while special readings stay grouped", async () => {
  const ordinary = await projectedTimedGroups("運命", "うんめい");
  assert.equal(ordinary.groups.length, 0);
  assert.equal(ordinary.bySpanId.size, 0);

  const special = await projectedTimedGroups("運命", "さだめ");
  assert.equal(special.groups.length, 1);
  assert.deepEqual(special.groups[0].spanIds, ["0", "1"]);
  assert.equal(special.groups[0].reading, "さだめ");
});

test("tracked metadata verifies the generated asset bytes and entry count", () => {
  const asset = readFileSync(
    new URL(
      "../src/utils/Lyrics/Processing/Japanese/GeneratedJitendexFuriganaGeometry.ts",
      import.meta.url
    )
  );
  const metadata = JSON.parse(
    readFileSync(
      new URL("../tools/japanese-furigana-geometry/generated-metadata.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(JAPANESE_FURIGANA_GEOMETRY_BUCKETS.length, 256);
  assert.equal(metadata.output.entries, 37_465);
  assert.equal(createHash("sha256").update(asset).digest("hex"), metadata.output.sha256);
});

test("every generated record round-trips through the runtime lookup", () => {
  let entries = 0;
  for (const bucket of JAPANESE_FURIGANA_GEOMETRY_BUCKETS) {
    for (const record of bucket.split("\n")) {
      if (!record) continue;
      const [surface, geometry] = record.split("\t");
      const characters = Array.from(surface);
      const utf16Offsets = [0];
      for (const character of characters) {
        utf16Offsets.push(utf16Offsets.at(-1)! + character.length);
      }

      let codePointCursor = 0;
      let reading = "";
      const expected = geometry.split("|").map((encoded) => {
        const separator = encoded.indexOf(":");
        const length = Number.parseInt(encoded.slice(0, separator), 36);
        const segmentReading = encoded.slice(separator + 1);
        const nextCursor = codePointCursor + length;
        const segment = {
          start: utf16Offsets[codePointCursor],
          end: utf16Offsets[nextCursor],
          reading: segmentReading,
        };
        codePointCursor = nextCursor;
        reading += segmentReading;
        return segment;
      });

      assert.deepEqual(lookupJitendexFuriganaGeometry(surface, reading), expected, surface);
      entries += 1;
    }
  }
  assert.equal(entries, 37_465);
});
