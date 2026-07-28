import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import {
  kuromojiJapaneseAnalyzer,
  normalizeKuromojiTokens,
} from "../src/utils/Lyrics/Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

function token(
  surface: string,
  start: number,
  readingKana: string,
  fields: Partial<JapaneseAnalyzerToken> = {}
): JapaneseAnalyzerToken {
  return {
    surface,
    start,
    end: start + surface.length,
    readingKana,
    pronunciationKana: readingKana,
    partOfSpeech: "other",
    morphologyFeatures: [],
    baseForm: surface,
    conjugationType: "",
    conjugationForm: "",
    provenance: { analyzerId: "test", rangeSource: "native" },
    ...fields,
  };
}

test("Kuromoji adapter exposes exact repeated-token ranges and typed provenance", () => {
  const tokens = normalizeKuromojiTokens("時の時", [
    {
      surface_form: "時",
      reading: "トキ",
      pronunciation: "トキ",
      pos: "名詞",
      basic_form: "時",
      verbose: { word_id: 1, word_type: "KNOWN", word_position: 1 },
    },
    {
      surface_form: "の",
      reading: "ノ",
      pronunciation: "ノ",
      pos: "助詞",
      pos_detail_1: "連体化",
      basic_form: "の",
      verbose: { word_id: 2, word_type: "KNOWN", word_position: 2 },
    },
    {
      surface_form: "時",
      reading: "トキ",
      pronunciation: "トキ",
      pos: "名詞",
      basic_form: "時",
      verbose: { word_id: 1, word_type: "KNOWN", word_position: 3 },
    },
  ]);

  assert.deepEqual(
    tokens.map(({ start, end }) => [start, end]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ]
  );
  assert.deepEqual(
    tokens.map(({ readingKana }) => readingKana),
    ["とき", "の", "とき"]
  );
  assert.equal(tokens[1].partOfSpeech, "particle");
  assert.equal(tokens[1].provenance.rawPartOfSpeechDetail1, "連体化");
  assert.equal(tokens[2].provenance.nativeWordPosition, 3);
});

test("an injected analyzer and kana romanizer own the complete reading pass", async () => {
  let analyzerCalls = 0;
  let romanizerCalls = 0;
  const analyzer: JapaneseAnalyzer = {
    id: "fixture-analyzer",
    async analyze(text) {
      analyzerCalls += 1;
      assert.equal(text, "私");
      return [
        token("私", 0, "わたし", {
          partOfSpeech: "pronoun",
          provenance: { analyzerId: "fixture-analyzer", rangeSource: "native" },
        }),
      ];
    },
  };

  const prepared = await prepareJapaneseLineAnalysis("私", undefined, undefined, {
    analyzer,
    kanaRomanizer(kana) {
      romanizerCalls += 1;
      assert.equal(kana, "わたし");
      return "watashi";
    },
  });

  assert.equal(analyzerCalls, 1);
  assert.equal(romanizerCalls > 0, true);
  assert.equal(prepared?.reading.romaji, "watashi");
  assert.deepEqual(
    prepared?.reading.furigana.map(({ start, end, reading }) => [start, end, reading]),
    [[0, 1, "わたし"]]
  );
});

test("experimental analyzer failures do not silently fall back to Kuromoji", async () => {
  const analyzer: JapaneseAnalyzer = {
    id: "failing-experiment",
    async analyze() {
      throw new Error("experimental analyzer failed");
    },
  };

  await assert.rejects(
    prepareJapaneseLineAnalysis("私", undefined, undefined, { analyzer }),
    /experimental analyzer failed/u
  );
});

test("Kuromoji compatibility overrides do not leak into another analyzer", async () => {
  const analyzedToken = token("君", 0, "くん", {
    partOfSpeech: "pronoun",
    provenance: { analyzerId: "fixture-analyzer", rangeSource: "native" },
  });
  const kanaRomanizer = (kana: string) => (kana === "きみ" ? "kimi" : "kun");
  const experiment: JapaneseAnalyzer = {
    id: "fixture-analyzer",
    async analyze() {
      return [analyzedToken];
    },
  };
  const kuromojiProfile: JapaneseAnalyzer = {
    ...kuromojiJapaneseAnalyzer,
    async analyze() {
      return [
        {
          ...analyzedToken,
          provenance: { analyzerId: "kuromoji", rangeSource: "surfaceAligned" },
        },
      ];
    },
  };

  const experimentReading = await prepareJapaneseLineAnalysis("君", undefined, undefined, {
    analyzer: experiment,
    kanaRomanizer,
  });
  const productionReading = await prepareJapaneseLineAnalysis("君", undefined, undefined, {
    analyzer: kuromojiProfile,
    kanaRomanizer,
  });

  assert.equal(experimentReading?.reading.romaji, "kun");
  assert.equal(productionReading?.reading.romaji, "kimi");
});

test("canonical particle behavior remains shared without raw analyzer POS labels", async () => {
  const analyzer: JapaneseAnalyzer = {
    id: "fixture-analyzer",
    async analyze() {
      return [
        token("私", 0, "わたし", { partOfSpeech: "noun" }),
        token("は", 1, "は", { partOfSpeech: "particle" }),
      ];
    },
  };
  const reading = await prepareJapaneseLineAnalysis("私は", undefined, undefined, {
    analyzer,
    kanaRomanizer: (kana) => (kana === "わたし" ? "watashi" : "ha"),
  });

  assert.equal(reading?.reading.romaji, "watashi wa");
});

test("analyzer tokens must match their declared source ranges", async () => {
  const analyzer: JapaneseAnalyzer = {
    id: "misaligned-experiment",
    async analyze() {
      return [token("君", 0, "きみ")];
    },
  };

  await assert.rejects(
    prepareJapaneseLineAnalysis("私", undefined, undefined, { analyzer }),
    /does not match its source range/u
  );
});
