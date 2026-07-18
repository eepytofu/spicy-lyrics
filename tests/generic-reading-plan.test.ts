import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";

test("Chinese timed readings use contextual full-line pinyin with visible spaces", () => {
  const source = Array.from("空杯如行舟浪荡醉梦里走");
  const isolated = ["kōng", "bēi", "rú", "háng", "zhōu", "làng", "dàng", "zuì", "mèng", "lǐ", "zǒu"];
  const group = {
    StartTime: 0,
    EndTime: 11,
    Syllables: source.map((Text, index) => ({
      Text,
      RomanizedText: isolated[index],
      StartTime: index,
      EndTime: index + 1,
      IsPartOfWord: index < source.length - 1,
    })),
  };

  const expected = "kōng bēi rú xíng zhōu làng dàng zuì mèng lǐ zǒu";
  const plan = buildTimedGenericPlan(group, expected, "Chinese");

  assert.ok(plan);
  assert.equal(plan.joinedDisplayText, expected);
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.text), [
    "kōng", " bēi", " rú", " xíng", " zhōu", " làng", " dàng", " zuì", " mèng", " lǐ", " zǒu",
  ]);
});

test("TIAN TIAN keeps contextual pinyin spacing across unequal AMLL timing units", () => {
  // AMLL TTML DB Spotify fixture 1gGqSeBtsWhphQNoj8cAuS, line L29.
  // The final provider span owns both the last Han character and punctuation, so the full-line
  // reading has 17 whitespace tokens while the provider has 16 timing units.
  const source = [
    "\u4e0d", "\u8fc7", "\u6211", "\u4eec", "\u4eca", "\u540e", "\u5e94", "\u8be5", "\u4e5f", "\u4e0d", "\u4f1a", "\u518d", "\u89c1", "\u4e86", "\u5bf9", "\u5427?",
  ];
  const isolated = [
    "b\u00f9", "gu\u00f2", "w\u01d2", "m\u00e9n", "j\u012bn", "h\u00f2u", "y\u012bng", "g\u0101i", "y\u011b", "b\u00f9", "hu\u00ec", "z\u00e0i", "ji\u00e0n", "le", "du\u00ec", "b\u0101 ?",
  ];
  const group = {
    StartTime: 0,
    EndTime: 16,
    Syllables: source.map((Text, index) => ({
      Text,
      RomanizedText: isolated[index],
      StartTime: index,
      EndTime: index + 1,
      IsPartOfWord: index < source.length - 1,
    })),
  };
  const expected = "b\u00f9 gu\u00f2 w\u01d2 men j\u012bn h\u00f2u y\u012bng g\u0101i y\u011b b\u00f9 hu\u00ec z\u00e0i ji\u00e0n le du\u00ec b\u0101 ?";

  const plan = buildTimedGenericPlan(group, expected, "Chinese");

  assert.ok(plan);
  assert.equal(plan.joinedDisplayText, expected);
  assert.equal(plan.timedReadingUnits.length, source.length);
  assert.equal(plan.timedReadingUnits[0].text, "b\u00f9");
  assert.equal(plan.timedReadingUnits[3].text, " men");
  assert.equal(plan.timedReadingUnits.slice(1).every((unit) => /^\s/u.test(unit.text)), true);
  assert.equal(plan.timedReadingUnits.at(-1)?.text, " b\u0101 ?");
});
