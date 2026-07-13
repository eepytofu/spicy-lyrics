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
