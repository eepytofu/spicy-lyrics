import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildCanonicalLine } from "../src/utils/Lyrics/Processing/Canonical.ts";
import {
  buildTextAnalysisProjection,
  mapAnalysisCodePointRangeToDisplay,
  mapAnalysisUtf16RangeToDisplay,
  mapDisplayUtf16RangeToAnalysis,
} from "../src/utils/Lyrics/Processing/TextAnalysisProjection.ts";
import {
  cleanInvisibles,
  cleanInvisiblesPreserveEdges,
} from "../src/utils/Lyrics/Fork/TextDetection.ts";

test("NFKC analysis preserves compatibility characters in display coordinates", () => {
  const projection = buildTextAnalysisProjection("ｶﾞ時計：Ａ");
  assert.equal(projection.displayText, "ｶﾞ時計：Ａ");
  assert.equal(projection.analysisText, "ガ時計:A");
  assert.equal(projection.coordinateSafe, true);
  assert.deepEqual(
    mapAnalysisUtf16RangeToDisplay(projection, { start: 1, end: 3 }),
    { start: 2, end: 4 },
  );
  assert.deepEqual(
    mapAnalysisCodePointRangeToDisplay(projection, { start: 1, end: 3 }),
    { start: 2, end: 4 },
  );
  assert.deepEqual(
    mapDisplayUtf16RangeToAnalysis(projection, { start: 2, end: 4 }),
    { start: 1, end: 3 },
  );

  const expandedCompatibility = buildTextAnalysisProjection("㍑");
  assert.equal(
    mapAnalysisUtf16RangeToDisplay(expandedCompatibility, { start: 1, end: 2 }),
    undefined,
  );
});

test("canonical text keeps provider compatibility characters", () => {
  const canonical = buildCanonicalLine({
    id: "compatibility",
    displayText: "ｶﾞ時計：Ａ",
    paragraphProvenance: "lineBoundary",
    spans: [{
      id: "source",
      rawText: "ｶﾞ時計：Ａ",
      cleanText: "ｶﾞ時計：Ａ",
      startMs: 0,
      endMs: 1000,
      providerPartOfWord: true,
    }],
  });
  assert.equal(canonical.text, "ｶﾞ時計：Ａ");
  assert.deepEqual(canonical.spanMappings[0].canonicalRange, { startCp: 0, endCp: 6 });
});

test("Static, Line, and Syllable cleanup preserves provider characters for display and copy", () => {
  const lyrics = [
    { type: "Static", text: cleanInvisibles(" \u200bＡ：㍑\ufeff ") },
    { type: "Line", text: cleanInvisibles(" \u200bＡ：㍑\ufeff ") },
    { type: "Syllable", text: cleanInvisiblesPreserveEdges("\u200bｶﾞ\u00a0") },
  ];

  assert.deepEqual(lyrics.map(({ type, text }) => ({
    type,
    display: text,
    copy: text.replace(/\s+/gu, " ").trim(),
    analysis: buildTextAnalysisProjection(text).analysisText,
  })), [
    { type: "Static", display: "Ａ：㍑", copy: "Ａ：㍑", analysis: "A:リットル" },
    { type: "Line", display: "Ａ：㍑", copy: "Ａ：㍑", analysis: "A:リットル" },
    { type: "Syllable", display: "ｶﾞ ", copy: "ｶﾞ", analysis: "ガ " },
  ]);
});

test("cache reprocessing advances without changing reading-plan schema", () => {
  const processSource = readFileSync(
    new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url),
    "utf8",
  );
  const fetchSource = readFileSync(
    new URL("../src/utils/Lyrics/fetchLyrics.ts", import.meta.url),
    "utf8",
  );
  const copySource = readFileSync(
    new URL("../src/utils/Lyrics/CopyLyrics.ts", import.meta.url),
    "utf8",
  );

  assert.match(processSource, /LYRICS_PROCESSING_VERSION = 80/u);
  assert.match(processSource, /READING_PLAN_SCHEMA_VERSION = 5/u);
  assert.match(fetchSource, /lyrics\.ProcessingVersion === LYRICS_PROCESSING_VERSION/u);
  assert.doesNotMatch(copySource, /normalize\(["']NFKC["']\)/u);
});
