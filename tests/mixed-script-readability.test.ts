import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMixedScriptReadingForDisplay,
  hasMixedScriptReadabilityBoundary,
  needsMixedScriptReadabilityGapBefore,
  projectFuriganaSegmentsForReadability,
  projectMixedScriptReadability,
} from "../src/utils/Lyrics/Processing/MixedScriptReadability.ts";

test("display projection separates Latin from adjacent non-Latin letters", () => {
  for (const [source, display] of [
    ["ぶち壊してshout it out loud", "ぶち壊して shout it out loud"],
    ["shout君", "shout 君"],
    ["暁Records", "暁 Records"],
    ["안녕world", "안녕 world"],
    ["Приветworld", "Привет world"],
    ["κόσμοςworld", "κόσμος world"],
    ["مرحباworld", "مرحبا world"],
  ]) {
    assert.equal(projectMixedScriptReadability(source).text, display);
  }
});

test("display projection does not disturb authored spacing, punctuation, or digits", () => {
  for (const source of [
    "ぶち壊して shout it out loud",
    "D/N/A",
    "A / B",
    "君(shout)",
    "第1Verse",
    "123ABC",
  ]) {
    assert.equal(projectMixedScriptReadability(source).text, source);
  }
});

test("readability boundaries remain separate from provider word boundaries", () => {
  const attached = [
    { Text: "ぶち壊して", IsPartOfWord: true },
    { Text: "shout it out loud", IsPartOfWord: true },
  ];
  const providerBoundary = [
    { Text: "ぶち壊して", IsPartOfWord: false },
    { Text: "shout it out loud", IsPartOfWord: true },
  ];

  assert.equal(hasMixedScriptReadabilityBoundary("て", "s"), true);
  assert.equal(needsMixedScriptReadabilityGapBefore(attached, 1), true);
  assert.equal(needsMixedScriptReadabilityGapBefore(providerBoundary, 1), false);
});

test("furigana ranges stay attached to their source glyph after projection", () => {
  const trailingLatin = projectMixedScriptReadability("命shout");
  assert.deepEqual(trailingLatin.insertedBeforeUtf16, [1]);
  assert.deepEqual(
    projectFuriganaSegmentsForReadability(
      [{ start: 0, end: 1, reading: "いのち" }],
      trailingLatin,
    ),
    [{ start: 0, end: 1, reading: "いのち" }],
  );

  const leadingLatin = projectMixedScriptReadability("shout命");
  assert.deepEqual(
    projectFuriganaSegmentsForReadability(
      [{ start: 5, end: 6, reading: "いのち" }],
      leadingLatin,
    ),
    [{ start: 6, end: 7, reading: "いのち" }],
  );
});

test("displayed romanization separates retained Latin source runs", () => {
  assert.equal(
    formatMixedScriptReadingForDisplay(
      "ぶち壊してshout it out loud",
      "buchikowashiteshout it out loud",
    ),
    "buchikowashite shout it out loud",
  );
  assert.equal(
    formatMixedScriptReadingForDisplay(
      "暁Records (akatsuki records)",
      "akatsukiRecords (akatsuki records)",
    ),
    "akatsuki Records (akatsuki records)",
  );
  assert.equal(
    formatMixedScriptReadingForDisplay("go君", "gokimi"),
    "go kimi",
  );
});
