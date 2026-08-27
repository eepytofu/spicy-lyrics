import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPhoneticMerges,
  buildJapaneseBoundaryPlan,
  japaneseTokenJoinsPrevious,
  type JapaneseBoundaryPlan,
  type MergeableEntry,
} from "../src/utils/Lyrics/Fork/JukujikunMerge.ts";
import type { JapaneseAnalyzerToken } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import { romanizeJapaneseKana } from "../src/utils/Lyrics/Processing/Japanese/JapaneseRomanizer.ts";

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

function boundaryPlanFor(source: string, surfaces: string[]): JapaneseBoundaryPlan {
  let cursor = 0;
  const entries: MergeableEntry[] = surfaces.map((surface) => {
    const start = source.indexOf(surface, cursor);
    assert.notEqual(start, -1, `missing ${surface} in ${source}`);
    cursor = start + surface.length;
    return { surface, romaji: surface, consumed: false, start, end: cursor };
  });
  const tokens = surfaces.map((surface) => analyzerToken(surface));
  return buildJapaneseBoundaryPlan(entries, tokens, source);
}

function joins(plan: JapaneseBoundaryPlan): boolean[] {
  return plan.map(({ joinsPrevious }) => joinsPrevious);
}

test("Japanese local romaji keeps source-attached slashes attached", () => {
  const plan = boundaryPlanFor("D/N/A", ["D", "/", "N", "/", "A"]);
  assert.deepEqual(joins(plan), [false, true, true, true, true]);
  assert.deepEqual(plan.slice(1).map(({ reasons }) => reasons), [
    ["sourceAdjacency"],
    ["sourceAdjacency"],
    ["sourceAdjacency"],
    ["sourceAdjacency"],
  ]);
});

test("Japanese local romaji preserves explicitly spaced slashes", () => {
  const spaced = boundaryPlanFor("A / B", ["A", "/", "B"]);
  assert.deepEqual(joins(spaced), [false, false, false]);
  assert.deepEqual(spaced.slice(1).map(({ reasons }) => reasons), [
    ["sourceWhitespace"],
    ["sourceWhitespace"],
  ]);
  assert.deepEqual(joins(boundaryPlanFor("A/ B", ["A", "/", "B"])), [
    false,
    true,
    false,
  ]);
  assert.deepEqual(joins(boundaryPlanFor("A /B", ["A", "/", "B"])), [
    false,
    false,
    true,
  ]);
});

test("Japanese local romaji uses Latin spacing around parentheticals", () => {
  const surfaces = ["な", "(", "それ", "いけっ", "!", ")"];
  const plan = boundaryPlanFor("な(それいけっ!)", surfaces);
  assert.deepEqual(joins(plan), [false, false, true, false, true, true]);
  assert.deepEqual(plan.slice(1).map(({ reasons }) => reasons), [
    ["linguistic"],
    ["punctuation"],
    ["linguistic"],
    ["punctuation"],
    ["punctuation"],
  ]);

  const romaji = ["na", "(", "sore", "ike", "!", ")"];
  const rendered = romaji
    .map((text, index) =>
      `${index > 0 && !japaneseTokenJoinsPrevious(plan, index) ? " " : ""}${text}`
    )
    .join("");
  assert.equal(rendered, "na (sore ike!)");
});

test("Japanese local romaji preserves attached mixed-script labels and parenthetical spaces", () => {
  const surfaces = ["暁", "Records", "(", "akatsuki", "records", ")"];
  const plan = boundaryPlanFor("暁Records (akatsuki records)", surfaces);
  assert.deepEqual(joins(plan), [false, true, false, true, false, true]);
  assert.deepEqual(plan.slice(1).map(({ reasons }) => reasons), [
    ["mixedScript"],
    ["sourceWhitespace"],
    ["punctuation"],
    ["sourceWhitespace"],
    ["punctuation"],
  ]);

  const romaji = ["akatsuki", "Records", "(", "akatsuki", "records", ")"];
  const rendered = romaji
    .map((text, index) =>
      `${index > 0 && !japaneseTokenJoinsPrevious(plan, index) ? " " : ""}${text}`
    )
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
  const boundaryPlan = buildJapaneseBoundaryPlan(entries, tokens);
  const rendered = entries
    .map((entry, index) =>
      entry.romaji
        ? `${index > 0 && !japaneseTokenJoinsPrevious(boundaryPlan, index) ? " " : ""}${entry.romaji}`
        : ""
    )
    .join("");

  assert.deepEqual(
    entries.map((entry) => entry.romaji),
    ["sore", "ike", "e", "", "!"]
  );
  assert.equal(rendered, "sore ikee!");
});

test("Japanese local romaji separates generated numeric readings from adjacent Japanese", () => {
  const plan = boundaryPlanFor("うま3 2 1おりゃ", ["うま", "3", " ", "2", " ", "1", "おりゃ"]);
  assert.deepEqual(joins(plan), [false, false, true, false, true, false, false]);
  assert.deepEqual(plan[1].reasons, ["mixedScript"]);
  assert.deepEqual(plan[6].reasons, ["mixedScript"]);
});

test("Japanese long marks do not swallow opening punctuation or following Latin", () => {
  const parenthetical = boundaryPlanFor("うーー(うま)", ["う", "ーー", "(", "うま", ")"]);
  assert.deepEqual(joins(parenthetical), [false, true, false, true, true]);

  const latin = boundaryPlanFor("うーーfight", ["う", "ーー", "fight"]);
  assert.deepEqual(joins(latin), [false, true, false]);
  assert.deepEqual(latin[2].reasons, ["linguistic"]);
});

test("Japanese trailing sokuon before literal Latin remains a separated cutoff", () => {
  const entries: MergeableEntry[] = [
    { surface: "そーわっ", readingKana: "そーわっ", romaji: "soowatsu", consumed: false },
    { surface: "so", romaji: "so", consumed: false },
  ];
  const tokens = [analyzerToken("そーわっ", "そーわっ"), analyzerToken("so")];
  applyPhoneticMerges(entries, tokens);
  const plan = buildJapaneseBoundaryPlan(entries, tokens, "そーわっso");
  assert.deepEqual(entries.map((entry) => entry.romaji), ["soowa'", "so"]);
  assert.deepEqual(joins(plan), [false, false]);
});

test("Japanese morphological prefixes stay attached to their lexical token", () => {
  const entries: MergeableEntry[] = [
    { surface: "お", romaji: "o", consumed: false, start: 0, end: 1 },
    { surface: "ねだり", romaji: "nedari", consumed: false, start: 1, end: 4 },
  ];
  const tokens = [
    analyzerToken("お", "お", { partOfSpeech: "prefix" }),
    analyzerToken("ねだり", "ねだり", { partOfSpeech: "verb" }),
  ];
  assert.deepEqual(joins(buildJapaneseBoundaryPlan(entries, tokens, "おねだり")), [false, true]);
});

test("Japanese phonetic merging repairs leading long marks and split small Kana", () => {
  const longEntries: MergeableEntry[] = [
    { surface: "こんな", readingKana: "こんな", romaji: "konna", consumed: false },
    { surface: "ーレースー", readingKana: "ーれーすー", romaji: "-reesuu", consumed: false },
    { surface: "はー", readingKana: "はー", romaji: "haa", consumed: false },
  ];
  const longTokens = [
    analyzerToken("こんな", "こんな"),
    analyzerToken("ーレースー", "ーれーすー"),
    analyzerToken("はー", "はー"),
  ];
  applyPhoneticMerges(longEntries, longTokens, romanizeJapaneseKana);
  const longPlan = buildJapaneseBoundaryPlan(longEntries, longTokens);
  assert.equal(
    longEntries.map((entry, index) =>
      `${index > 0 && !japaneseTokenJoinsPrevious(longPlan, index) ? " " : ""}${entry.romaji}`
    ).join(""),
    "konnaa reesuu haa",
  );

  const smallEntries: MergeableEntry[] = [
    { surface: "ずき", readingKana: "ずき", romaji: "zuki", consumed: false },
    { surface: "ゅんどきゅん", readingKana: "ゅんどきゅん", romaji: "yundokyun", consumed: false },
  ];
  const smallTokens = [
    analyzerToken("ずき", "ずき"),
    analyzerToken("ゅんどきゅん", "ゅんどきゅん"),
  ];
  applyPhoneticMerges(smallEntries, smallTokens, romanizeJapaneseKana);
  const smallPlan = buildJapaneseBoundaryPlan(smallEntries, smallTokens);
  assert.equal(
    smallEntries.map((entry, index) =>
      `${index > 0 && !japaneseTokenJoinsPrevious(smallPlan, index) ? " " : ""}${entry.romaji}`
    ).join(""),
    "zukyundokyun",
  );
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
  const boundaryPlan = buildJapaneseBoundaryPlan(entries, tokens);
  const rendered = entries
    .map((entry, index) =>
      entry.romaji
        ? `${index > 0 && !japaneseTokenJoinsPrevious(boundaryPlan, index) ? " " : ""}${entry.romaji}`
        : ""
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
  const boundaryPlan = buildJapaneseBoundaryPlan(entries, tokens);
  assert.deepEqual(joins(boundaryPlan), [false, true]);
  assert.deepEqual(boundaryPlan[1].reasons, ["phonetic"]);
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
