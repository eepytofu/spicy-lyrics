import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPhoneticMerges,
  computeNoSpaceBefore,
  type MergeableEntry,
} from "../src/utils/Lyrics/Fork/JukujikunMerge.ts";
import type { JapaneseAnalyzerToken } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";

function analyzerToken(
  surface: string,
  readingKana = "",
  fields: Partial<JapaneseAnalyzerToken> = {}
): JapaneseAnalyzerToken {
  return {
    surface,
    start: 0,
    end: surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: "",
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "test", rangeSource: "surfaceAligned" },
    ...fields,
  };
}

function spacingFor(source: string, surfaces: string[]): boolean[] {
  let cursor = 0;
  const entries: MergeableEntry[] = surfaces.map((surface) => {
    const start = source.indexOf(surface, cursor);
    assert.notEqual(start, -1, `missing ${surface} in ${source}`);
    cursor = start + surface.length;
    return { surface, romaji: surface, consumed: false, start, end: cursor };
  });
  const tokens = surfaces.map((surface) => analyzerToken(surface));
  return computeNoSpaceBefore(entries, tokens);
}

test("Japanese local romaji keeps source-attached slashes attached", () => {
  assert.deepEqual(spacingFor("D/N/A", ["D", "/", "N", "/", "A"]), [false, true, true, true, true]);
});

test("Japanese local romaji preserves explicitly spaced slashes", () => {
  assert.deepEqual(spacingFor("A / B", ["A", "/", "B"]), [false, false, false]);
  assert.deepEqual(spacingFor("A/ B", ["A", "/", "B"]), [false, true, false]);
  assert.deepEqual(spacingFor("A /B", ["A", "/", "B"]), [false, false, true]);
});

test("Japanese local romaji uses Latin spacing around parentheticals", () => {
  const surfaces = ["な", "(", "それ", "いけっ", "!", ")"];
  const noSpaceBefore = spacingFor("な(それいけっ!)", surfaces);
  assert.deepEqual(noSpaceBefore, [false, false, true, false, true, true]);

  const romaji = ["na", "(", "sore", "ike", "!", ")"];
  const rendered = romaji
    .map((text, index) => `${index > 0 && !noSpaceBefore[index] ? " " : ""}${text}`)
    .join("");
  assert.equal(rendered, "na (sore ike!)");
});

test("Japanese local romaji preserves attached mixed-script labels and parenthetical spaces", () => {
  const surfaces = ["暁", "Records", "(", "akatsuki", "records", ")"];
  const noSpaceBefore = spacingFor("暁Records (akatsuki records)", surfaces);
  assert.deepEqual(noSpaceBefore, [false, true, false, true, false, true]);

  const romaji = ["akatsuki", "Records", "(", "akatsuki", "records", ")"];
  const rendered = romaji
    .map((text, index) => `${index > 0 && !noSpaceBefore[index] ? " " : ""}${text}`)
    .join("");
  assert.equal(rendered, "akatsukiRecords (akatsuki records)");
});

test("Japanese local romaji joins a separately tokenized long-vowel mark", () => {
  const entries: MergeableEntry[] = [
    { surface: "それ", romaji: "sore", consumed: false },
    { surface: "いけ", romaji: "ike", consumed: false },
    { surface: "ー", romaji: "ー", consumed: false },
    { surface: "っ", romaji: "tsu", consumed: false },
    { surface: "!", romaji: "!", consumed: false },
  ];
  const tokens = [
    analyzerToken("それ", "それ"),
    analyzerToken("いけ", "いけ"),
    analyzerToken("ー"),
    analyzerToken("っ", "っ"),
    analyzerToken("!"),
  ];

  applyPhoneticMerges(entries, tokens);
  const noSpaceBefore = computeNoSpaceBefore(entries, tokens);
  const rendered = entries
    .map((entry, index) =>
      entry.romaji ? `${index > 0 && !noSpaceBefore[index] ? " " : ""}${entry.romaji}` : ""
    )
    .join("");

  assert.deepEqual(
    entries.map((entry) => entry.romaji),
    ["sore", "ike", "e", "", "!"]
  );
  assert.equal(rendered, "sore ikee!");
});

test("Japanese local romaji formats combined punctuation tokens", () => {
  const entries: MergeableEntry[] = [
    { surface: "ぞ", romaji: "zo", consumed: false },
    { surface: "!(", romaji: "!(", consumed: false },
    { surface: "それ", romaji: "sore", consumed: false },
    { surface: "いけ", romaji: "ike", consumed: false },
    { surface: "ー", romaji: "ー", consumed: false },
    { surface: "っ", romaji: "tsu", consumed: false },
    { surface: "!)", romaji: "!)", consumed: false },
  ];
  const tokens = [
    analyzerToken("ぞ", "ぞ"),
    analyzerToken("!("),
    analyzerToken("それ", "それ"),
    analyzerToken("いけ", "いけ"),
    analyzerToken("ー"),
    analyzerToken("っ", "っ"),
    analyzerToken("!)"),
  ];

  applyPhoneticMerges(entries, tokens);
  const noSpaceBefore = computeNoSpaceBefore(entries, tokens);
  const rendered = entries
    .map((entry, index) =>
      entry.romaji ? `${index > 0 && !noSpaceBefore[index] ? " " : ""}${entry.romaji}` : ""
    )
    .join("");

  assert.equal(rendered, "zo! (sore ikee!)");
});

test("Japanese local romaji joins a token that starts with sokuon", () => {
  const entries: MergeableEntry[] = [
    { surface: "い", romaji: "i", consumed: false },
    { surface: "っけ", romaji: "kke", consumed: false },
  ];
  const tokens = [analyzerToken("い", "い"), analyzerToken("っけ", "っけ")];
  const noSpaceBefore = computeNoSpaceBefore(entries, tokens);
  assert.deepEqual(noSpaceBefore, [false, true]);
});

test("Japanese sokuon merging never duplicates trailing punctuation", () => {
  const chantEntries: MergeableEntry[] = [
    { surface: "はっ", romaji: "hatsu", consumed: false },
    { surface: "はっ", romaji: "hatsu", consumed: false },
    { surface: ")", romaji: ")", consumed: false },
  ];
  applyPhoneticMerges(chantEntries, [
    analyzerToken("はっ", "はっ"),
    analyzerToken("はっ", "はっ"),
    analyzerToken(")"),
  ]);
  assert.deepEqual(
    chantEntries.map((entry) => entry.romaji),
    ["ha", "hha", ")"]
  );

  const exclamationEntries: MergeableEntry[] = [
    { surface: "くるっ", romaji: "kurutsu", consumed: false },
    { surface: "!", romaji: "!", consumed: false },
  ];
  applyPhoneticMerges(exclamationEntries, [analyzerToken("くるっ", "くるっ"), analyzerToken("!")]);
  assert.deepEqual(
    exclamationEntries.map((entry) => entry.romaji),
    ["kuru", "!"]
  );
});
