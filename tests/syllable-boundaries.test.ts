import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSyllableSpaceBefore } from "../src/utils/Lyrics/Processing/SyllableBoundaries.ts";

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
