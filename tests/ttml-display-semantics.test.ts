import assert from "node:assert/strict";
import { test } from "node:test";
import {
  needsTtmlDisplaySpaceBefore,
  suppressJapaneseCjkProviderGapAfter,
} from "../src/utils/Lyrics/Processing/TtmlDisplaySemantics.ts";
import { needsSyllableSpaceBefore } from "../src/utils/Lyrics/Processing/SyllableBoundaries.ts";

const syllables = (left: string, right: string) => [
  { Text: left, IsPartOfWord: false },
  { Text: right, IsPartOfWord: true },
];

test("Japanese TTML CJK timing boundaries stay in source semantics but not visual spacing", () => {
  const units = syllables("夢", "見て");
  assert.equal(needsSyllableSpaceBefore(units, 1), true);
  assert.equal(suppressJapaneseCjkProviderGapAfter(units, 0, "ja"), true);
  assert.equal(needsTtmlDisplaySpaceBefore(units, 1, "ja"), false);
});

test("the display projection abstains for unknown, Chinese, Latin, punctuation, and joined boundaries", () => {
  assert.equal(suppressJapaneseCjkProviderGapAfter(syllables("夢", "見て"), 0, undefined), false);
  assert.equal(suppressJapaneseCjkProviderGapAfter(syllables("夢", "見て"), 0, "zh-Hans"), false);
  assert.equal(suppressJapaneseCjkProviderGapAfter(syllables("hello", "world"), 0, "ja"), false);
  assert.equal(suppressJapaneseCjkProviderGapAfter(syllables("夢", "!"), 0, "ja"), false);
  assert.equal(
    suppressJapaneseCjkProviderGapAfter(
      [
        { Text: "夢", IsPartOfWord: true },
        { Text: "見て", IsPartOfWord: true },
      ],
      0,
      "ja"
    ),
    false
  );
  assert.equal(needsTtmlDisplaySpaceBefore(syllables("hello", "world"), 1, "ja"), true);
});
