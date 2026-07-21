import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import {
  buildCjkReadingContextText,
  romanizeChineseDominantCjkText,
} from "../src/utils/Lyrics/Processing/CjkLanguageRouting.ts";
import { buildMandarinWordLayout, romanizeMandarin } from "../src/utils/Lyrics/Fork/Romanization.ts";

test("Chinese timed readings remove provider boundaries before contextual Pinyin", () => {
  const source = Array.from("空杯如行舟浪荡醉梦里走");
  const isolated = ["kōng", "bēi", "rú", "háng", "zhōu", "làng", "dàng", "zuì", "mèng", "lǐ", "zǒu"];
  const partOfWord = [true, true, true, true, false, true, true, true, true, true, false];
  const group = {
    StartTime: 0,
    EndTime: 11,
    Syllables: source.map((Text, index) => ({
      Text,
      RomanizedText: isolated[index],
      StartTime: index,
      EndTime: index + 1,
      IsPartOfWord: partOfWord[index],
    })),
  };

  const contextText = buildCjkReadingContextText(group.Syllables);
  const expected = romanizeMandarin(contextText);
  const plan = buildTimedGenericPlan(group, expected, "Chinese");

  assert.equal(contextText, "空杯如行舟浪荡醉梦里走");
  assert.equal(expected, "kōng bēi rú xíng zhōu làng dàng zuì mèng lǐ zǒu");
  assert.ok(plan);
  assert.equal(plan.joinedDisplayText, expected);
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.text), [
    "kōng", " bēi", " rú", " xíng", " zhōu", " làng", " dàng", " zuì", " mèng", " lǐ", " zǒu",
  ]);
});

test("Mandarin complete dictionary keeps contextual polyphones on provider timing owners", () => {
  const group = {
    StartTime: 0,
    EndTime: 2,
    Syllables: [
      { Text: "\u8bd7", StartTime: 0, EndTime: 1, RomanizedText: "sh\u012b" },
      { Text: "\u884c", StartTime: 1, EndTime: 2, RomanizedText: "x\u00edng" },
    ],
  };

  const plan = buildTimedGenericPlan(group, romanizeMandarin("\u8bd7\u884c"), "Chinese");
  assert.ok(plan);
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.text), ["sh\u012b", " h\u00e1ng"]);
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.spanId), ["0", "1"]);
});

test("optional Mandarin word joining changes display boundaries but not timing owners", () => {
  const group = {
    StartTime: 0,
    EndTime: 2,
    Syllables: [
      { Text: "诗", StartTime: 0, EndTime: 1, RomanizedText: "shī" },
      { Text: "行", StartTime: 1, EndTime: 2, RomanizedText: "xíng" },
    ],
  };
  const display = romanizeMandarin("诗行");
  const plan = buildTimedGenericPlan(group, display, "Chinese", {
    mandarinWordLayout: buildMandarinWordLayout("诗行"),
  });

  assert.ok(plan);
  assert.equal(plan.joinedDisplayText, "shīháng");
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.text), ["shī", "háng"]);
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.spanId), ["0", "1"]);
});

test("Mandarin word joining preserves explicit provider whitespace", () => {
  const group = {
    StartTime: 0,
    EndTime: 2,
    Syllables: [
      { Text: "诗 ", StartTime: 0, EndTime: 1, RomanizedText: "shī" },
      { Text: "行", StartTime: 1, EndTime: 2, RomanizedText: "xíng" },
    ],
  };
  const plan = buildTimedGenericPlan(group, romanizeMandarin("诗行"), "Chinese", {
    mandarinWordLayout: buildMandarinWordLayout("诗行"),
  });

  assert.equal(plan?.joinedDisplayText, "shī háng");
});

test("Mandarin word joining handles several Han characters in one timing owner", () => {
  const group = {
    StartTime: 0,
    EndTime: 2,
    Syllables: [
      { Text: "诗行", StartTime: 0, EndTime: 2, RomanizedText: "shī xíng" },
    ],
  };
  const plan = buildTimedGenericPlan(group, romanizeMandarin("诗行"), "Chinese", {
    mandarinWordLayout: buildMandarinWordLayout("诗行"),
  });

  assert.equal(plan?.joinedDisplayText, "shīháng");
  assert.deepEqual(plan?.timedReadingUnits.map((unit) => unit.spanId), ["0"]);
});

test("Chinese context reconstruction preserves authored Latin word spaces", () => {
  assert.equal(buildCjkReadingContextText([
    { Text: "一起", IsPartOfWord: true },
    { Text: "sing", IsPartOfWord: false },
    { Text: "along", IsPartOfWord: false },
    { Text: "吧", IsPartOfWord: false },
  ]), "一起 sing along 吧");
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

test("quoted QQ timing keeps contextual neutral-tone Pinyin and readable spacing", async () => {
  const syllables = [
    { Text: "“", RomanizedText: "“", StartTime: 0, EndTime: 0, IsPartOfWord: true },
    { Text: "喂", RomanizedText: "wèi", StartTime: 0, EndTime: 1, IsPartOfWord: false },
    { Text: " ", RomanizedText: "", StartTime: 1, EndTime: 1, IsPartOfWord: true },
    { Text: "奶", RomanizedText: "nǎi", StartTime: 1, EndTime: 2, IsPartOfWord: true },
    { Text: "奶", RomanizedText: "nǎi", StartTime: 2, EndTime: 3, IsPartOfWord: true },
    { Text: "你", RomanizedText: "nǐ", StartTime: 3, EndTime: 4, IsPartOfWord: true },
    { Text: "好", RomanizedText: "hǎo", StartTime: 4, EndTime: 5, IsPartOfWord: true },
    { Text: "吗", RomanizedText: "ma", StartTime: 5, EndTime: 6, IsPartOfWord: true },
    { Text: "?”", RomanizedText: "?”", StartTime: 6, EndTime: 6, IsPartOfWord: true },
  ];
  const contextText = buildCjkReadingContextText(syllables);
  const contextual = await romanizeChineseDominantCjkText(contextText, {
    romanizeHan: (text) => romanizeMandarin(text),
    romanizeKana: (text) => text,
  });
  const plan = buildTimedGenericPlan({ StartTime: 0, EndTime: 6, Syllables: syllables }, contextual, "Chinese");

  assert.equal(contextText, "“喂 奶奶你好吗?”");
  assert.equal(contextual, "“wèi nǎi nai nǐ hǎo ma ?”");
  assert.ok(plan);
  assert.equal(plan.joinedDisplayText, "“wèi nǎi nai nǐ hǎo ma?”");
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.text), [
    "“", "wèi", "", " nǎi", " nai", " nǐ", " hǎo", " ma", "?”",
  ]);
});

test("Chinese timed alignment preserves authored slash spacing", () => {
  const attached = buildTimedGenericPlan({
    StartTime: 0,
    EndTime: 5,
    Syllables: Array.from("D/N/A").map((Text, index) => ({
      Text,
      RomanizedText: Text,
      StartTime: index,
      EndTime: index + 1,
      IsPartOfWord: true,
    })),
  }, "D/N/A", "Chinese");
  const spaced = buildTimedGenericPlan({
    StartTime: 0,
    EndTime: 5,
    Syllables: ["A", " ", "/", " ", "B"].map((Text, index) => ({
      Text,
      RomanizedText: Text,
      StartTime: index,
      EndTime: index + 1,
      IsPartOfWord: true,
    })),
  }, "A / B", "Chinese");

  assert.equal(attached?.joinedDisplayText, "D/N/A");
  assert.equal(spaced?.joinedDisplayText, "A / B");
});
