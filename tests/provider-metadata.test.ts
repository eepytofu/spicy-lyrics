import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearProviderMetadataReadings,
  isProviderInfoLine,
  providerMetadataSeekTimeMs,
  useReadingsForProviderLine,
} from "../src/utils/Lyrics/Processing/ProviderMetadata.ts";

test("provider metadata remains literal and skips all reading overlays", () => {
  const readingFields = {
    JapaneseReading: { sourceText: "词", romaji: "kotoba", furigana: [] },
    ReadingRenderPlan: { joinedDisplayText: "kotoba" },
    ReadingPrimaryScript: "Japanese",
    RomanizedText: "kotoba",
    TransliteratedText: "kotoba",
    ProviderRomanizedText: "kotoba",
    RomajiSpaceBefore: true,
  };
  const group = {
    IsProviderInfo: true,
    Syllables: [
      { Text: "词", ...structuredClone(readingFields) },
      { Text: "：", ...structuredClone(readingFields) },
      { Text: "Stack", ...structuredClone(readingFields) },
    ],
    ...structuredClone(readingFields),
  };

  assert.equal(clearProviderMetadataReadings(group), true);
  for (const entry of [group, ...group.Syllables]) {
    for (const field of Object.keys(readingFields)) {
      assert.equal(field in entry, false, `${field} should be removed`);
    }
  }
  assert.equal(group.Syllables.map((syllable) => syllable.Text).join(""), "词：Stack");
});

test("ordinary lyric lines retain their reading data", () => {
  const group = {
    IsMetadata: false,
    JapaneseReading: { sourceText: "声も", romaji: "koe mo", furigana: [] },
    Syllables: [{ Text: "声" }, { Text: "も" }],
  };

  assert.equal(clearProviderMetadataReadings(group), false);
  assert.equal(group.JapaneseReading.romaji, "koe mo");
});

test("legacy static metadata and timed provider info share reading semantics", () => {
  assert.equal(isProviderInfoLine({ IsMetadata: true }), true);
  assert.equal(isProviderInfoLine({ IsProviderInfo: true }), true);
  assert.equal(isProviderInfoLine({}), false);
});

test("metadata suppresses raw provider readings before background processing finishes", () => {
  assert.equal(useReadingsForProviderLine({ IsProviderInfo: true }, true), false);
  assert.equal(useReadingsForProviderLine({ IsMetadata: true }, true), false);
  assert.equal(useReadingsForProviderLine({ IsMetadata: false }, true), true);
  assert.equal(useReadingsForProviderLine({ IsMetadata: false }, false), false);
});

test("metadata keeps its raw provider start time for click-to-seek", () => {
  assert.equal(providerMetadataSeekTimeMs({ IsProviderInfo: true, StartTime: 26.31 }), 26_310);
  assert.equal(providerMetadataSeekTimeMs({ IsMetadata: true, StartTime: 33.485 }), 33_485);
  assert.equal(providerMetadataSeekTimeMs({ IsMetadata: false, StartTime: 45.45 }), undefined);
});
