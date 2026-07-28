import assert from "node:assert/strict";
import { test } from "node:test";
import {
  needsSyllableSpaceBefore,
  resolveSyllableBoundary,
} from "../src/utils/Lyrics/Processing/SyllableBoundaries.ts";

test("native syllable boundaries belong to the preceding timed fragment", () => {
  const title = [
    { Text: "Shout ", IsPartOfWord: false },
    { Text: "It ", IsPartOfWord: false },
    { Text: "Out ", IsPartOfWord: false },
    { Text: "Loud!!! - ", IsPartOfWord: false },
    { Text: "暁", IsPartOfWord: true },
    { Text: "Records (", IsPartOfWord: true },
    { Text: "akatsuki ", IsPartOfWord: false },
    { Text: "records)", IsPartOfWord: true },
  ];

  assert.deepEqual(
    title.map((_, index) => needsSyllableSpaceBefore(title, index)),
    [false, false, false, false, false, false, false, false],
  );
  assert.equal(title.map((unit) => unit.Text).join(""), "Shout It Out Loud!!! - 暁Records (akatsuki records)");
});

test("a provider boundary without literal whitespace inserts one visual space", () => {
  const words = [
    { Text: "一起", IsPartOfWord: false },
    { Text: "sing", IsPartOfWord: false },
  ];
  assert.equal(needsSyllableSpaceBefore(words, 1), true);
});

test("a script transition alone does not become a provider/source boundary", () => {
  const words = [
    { Text: "ぶち壊して", IsPartOfWord: true },
    { Text: "shout it out loud", IsPartOfWord: true },
  ];

  assert.equal(needsSyllableSpaceBefore(words, 1), false);
  assert.deepEqual(resolveSyllableBoundary(words, 1).kinds, ["readability"]);
  assert.equal(words.map((word) => word.Text).join(""), "ぶち壊してshout it out loud");
});

test("boundary resolution keeps authored, provider, linguistic, and readability evidence distinct", () => {
  const authored = resolveSyllableBoundary([
    { Text: "魂 ", IsPartOfWord: false },
    { Text: "大", IsPartOfWord: true },
  ], 1);
  assert.deepEqual(authored.kinds, ["authoredWhitespace"]);
  assert.equal(authored.needsNormalizedSpace, false);
  assert.equal(authored.needsReadabilityGap, false);

  const provider = resolveSyllableBoundary([
    { Text: "一起", IsPartOfWord: false },
    { Text: "sing", IsPartOfWord: true },
  ], 1);
  assert.deepEqual(provider.kinds, ["providerSemantic"]);
  assert.equal(provider.needsNormalizedSpace, true);

  const linguistic = resolveSyllableBoundary([
    { Text: "今日", IsPartOfWord: true },
    { Text: "は", IsPartOfWord: true, RomajiSpaceBefore: true },
  ], 1);
  assert.deepEqual(linguistic.kinds, ["linguistic"]);
  assert.equal(linguistic.needsReadingSpace, true);
  assert.equal(linguistic.needsNormalizedSpace, false);
});
