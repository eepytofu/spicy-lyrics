import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCjkDocumentBranch,
  resolveCjkDocumentContext,
  resolveCjkLineRoute,
  scriptBranchForLine,
} from "../src/utils/Lyrics/Fork/TextDetection.ts";
import {
  partitionCjkReadingRuns,
  romanizeChineseDominantCjkText,
} from "../src/utils/Lyrics/Processing/CjkLanguageRouting.ts";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";

test("a small kana island does not flip a Chinese-dominant document", () => {
  const lyrics = [
    "\u65e0\u5927\u788d",
    "\u6ca1\u4f24\u5230\u8111\u888b",
    "\u5982\u679c\u6211\u4e0b\u624b\u592a\u91cd\u3059\u307f\u307e\u305b\u3093",
    "\u4e60\u6b66\u5341\u8f7d",
    "\u6ca1\u4e0b\u5c71\u6ca1\u8c08\u604b\u7231",
  ].join("\n");

  assert.equal(resolveCjkDocumentBranch(lyrics, "jpn", "ja"), "Chinese");
});

test("ordinary kana-bearing Japanese lyrics remain Japanese-dominant", () => {
  const lyrics = [
    "\u672c\u5f53\u306b\u3059\u307f\u307e\u305b\u3093",
    "\u4eca\u65e5\u306f\u5927\u4e08\u592b",
    "\u79c1\u306e\u5fc3\u306f\u5143\u6c17\u3067\u3059",
  ].join("\n");

  assert.equal(resolveCjkDocumentBranch(lyrics, "jpn", "ja"), "Japanese");
});

test("balanced Japanese documents tolerate occasional kanji-only lines", () => {
  const lyrics = [
    "\u4eca\u65e5\u306f\u5927\u4e08\u592b",
    "\u79c1\u306e\u5fc3\u306f\u5143\u6c17\u3067\u3059",
    "\u5922\u5e0c\u671b",
    "\u9752\u6625",
  ].join("\n");

  assert.equal(resolveCjkDocumentBranch(lyrics, "jpn", "ja"), "Japanese");
});

test("Japanese-dominant bilingual documents route long Chinese Han lines separately", () => {
  const lines = [
    "静かな庭で猫が眠っている",
    "明日の朝までここで待とう",
    "远山风雨终归寂静",
    "长夜无声灯火微明",
  ];
  const document = resolveCjkDocumentContext(lines.join("\n"), "jpn", "ja");
  assert.deepEqual(document, { branch: "Japanese", bilingual: true });

  const context = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "jpn",
    iso2Language: "ja",
    cjkDominantBranch: document.branch,
    cjkBilingual: document.bilingual,
  };
  assert.equal(resolveCjkLineRoute(lines[0], context), "Japanese");
  assert.equal(resolveCjkLineRoute(lines[2], context), "Chinese");
  assert.equal(resolveCjkLineRoute(lines[3], context), "Chinese");
});

test("Traditional Chinese form evidence can establish a bilingual document", () => {
  const lines = [
    "静かな庭で猫が眠っている",
    "明日の朝までここで待とう",
    "遠山風雨終歸寂靜",
    "長夜無聲燈火微明",
  ];
  const document = resolveCjkDocumentContext(lines.join("\n"), "jpn", "ja");
  assert.deepEqual(document, { branch: "Japanese", bilingual: true });

  const context = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "jpn",
    iso2Language: "ja",
    cjkDominantBranch: document.branch,
    cjkBilingual: document.bilingual,
  };
  assert.equal(resolveCjkLineRoute(lines[2], context), "Chinese");
  assert.equal(resolveCjkLineRoute(lines[3], context), "Chinese");
});

test("bounded Mandarin phrases resolve short Han lines only in established CJK context", () => {
  const bilingualContext = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "jpn",
    iso2Language: "ja",
    cjkDominantBranch: "Japanese" as const,
    cjkBilingual: true,
  };
  const japaneseContext = {
    ...bilingualContext,
    presentScripts: ["Japanese"] as const,
    cjkBilingual: false,
  };

  // Constructed equivalent of the private corpus miss, not a lyric excerpt.
  assert.equal(resolveCjkLineRoute("我知道呀", bilingualContext), "Chinese");
  assert.equal(resolveCjkLineRoute("我知道呀", japaneseContext), "Japanese");
});

test("Japanese Han forms and repeated lines cannot invent bilingual evidence", () => {
  const kanjiHeavy = [
    "静かな庭で猫が眠っている",
    "明日の朝までここで待とう",
    "人々往来 反戦記録",
    "旧国街道 鉄橋横断",
  ].join("\n");
  assert.deepEqual(resolveCjkDocumentContext(kanjiHeavy, "jpn", "ja"), {
    branch: "Japanese",
    bilingual: false,
  });

  const repeated = [
    "静かな庭で猫が眠っている",
    "静かな庭で猫が眠っている",
    "静かな庭で猫が眠っている",
    "远山风雨终归寂静",
    "长夜无声灯火微明",
  ].join("\n");
  assert.deepEqual(resolveCjkDocumentContext(repeated, "jpn", "ja"), {
    branch: "Japanese",
    bilingual: false,
  });
  const repeatedContext = {
    presentScripts: ["Japanese"] as const,
    primaryLanguage: "jpn",
    iso2Language: "ja",
    cjkDominantBranch: "Japanese" as const,
    cjkBilingual: false,
  };
  assert.equal(resolveCjkLineRoute("远山风雨终归寂静", repeatedContext), "Japanese");
  assert.equal(resolveCjkLineRoute("人々往来 反戦記録", repeatedContext), "Japanese");
});

test("Chinese-dominant mixed lines expose Chinese Han and Japanese kana branches", () => {
  const context = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "cmn",
    iso2Language: "zh",
    cjkDominantBranch: "Chinese" as const,
  };

  assert.deepEqual(
    scriptBranchForLine("\u5982\u679c\u6211\u4e0b\u624b\u592a\u91cd\u3059\u307f\u307e\u305b\u3093", context),
    ["Japanese", "Chinese"]
  );
  assert.deepEqual(scriptBranchForLine("\u5982\u679c", context), ["Chinese"]);
  assert.deepEqual(scriptBranchForLine("\u3059\u307f\u307e\u305b\u3093", context), ["Japanese"]);
});

test("Chinese-dominant documents still route grammatical Japanese lines to furigana", () => {
  const context = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "cmn",
    iso2Language: "zh",
    cjkDominantBranch: "Chinese" as const,
  };
  const japaneseLines = [
    "\u79d1\u6238\u306e\u98a8\u5439\u304d\u8fd0\u3076\u82b1\u306e\u9999",
    "\u8fc2\u308a\u3086\u304f\u65f6\u4ee3\u306e\u65e0\u5e38\u3092\u53f9\u304f",
    "\u672c\u5f53\u306b\u3059\u307f\u307e\u305b\u3093",
  ];

  for (const line of japaneseLines) {
    assert.equal(resolveCjkLineRoute(line, context), "Japanese", line);
    assert.deepEqual(scriptBranchForLine(line, context), ["Japanese"], line);
  }
  assert.equal(
    resolveCjkLineRoute("\u5982\u679c\u6211\u4e0b\u624b\u592a\u91cd\u3059\u307f\u307e\u305b\u3093", context),
    "MixedChinese"
  );
  assert.equal(
    resolveCjkLineRoute("\u5982\u679c \u6211 \u4e0b\u624b \u592a\u91cd \u3059 \u307f \u307e \u305b \u3093", context),
    "MixedChinese"
  );
});

test("a parenthetical kana island does not pull a Chinese line into Japanese reading processing", () => {
  const context = {
    presentScripts: ["Japanese", "Chinese"] as const,
    primaryLanguage: "cmn",
    iso2Language: "zh",
    cjkDominantBranch: "Chinese" as const,
  };

  assert.equal(resolveCjkLineRoute("如果天(そら)", context), "MixedChinese");
});

test("Chinese-dominant routing invokes only the processor for each contiguous run", async () => {
  const input = "\u5982\u679c \u6211 \u4e0b\u624b \u592a\u91cd \u3059\u307f\u307e\u305b\u3093";
  assert.deepEqual(partitionCjkReadingRuns(input), [
    { kind: "Han", text: "\u5982\u679c \u6211 \u4e0b\u624b \u592a\u91cd " },
    { kind: "Kana", text: "\u3059\u307f\u307e\u305b\u3093" },
  ]);

  const calls: string[] = [];
  const output = await romanizeChineseDominantCjkText(input, {
    romanizeHan: (text) => {
      calls.push(`han:${text}`);
      return "ru guo wo xia shou tai zhong";
    },
    romanizeKana: (text) => {
      calls.push(`kana:${text}`);
      return "sumimasen";
    },
  });

  assert.equal(output, "ru guo wo xia shou tai zhong sumimasen");
  assert.deepEqual(calls, [
    "han:\u5982\u679c \u6211 \u4e0b\u624b \u592a\u91cd ",
    "kana:\u3059\u307f\u307e\u305b\u3093",
  ]);
});

test("mixed Chinese timed readings keep one timing owner per provider span", () => {
  const group = {
    StartTime: 0,
    EndTime: 2000,
    Syllables: [
      { Text: "\u5982\u679c", RomanizedText: "ru guo", StartTime: 0, EndTime: 1000, IsPartOfWord: false },
      { Text: "\u3059\u307f\u307e\u305b\u3093", RomanizedText: "sumimasen", StartTime: 1000, EndTime: 2000, IsPartOfWord: false },
    ],
  };

  const plan = buildTimedGenericPlan(group, "ru guo sumimasen", "Chinese");
  assert.ok(plan);
  assert.equal(plan.primaryScript, "Chinese");
  assert.equal(plan.joinedDisplayText, "ru guo sumimasen");
  assert.deepEqual(plan.timedReadingUnits.map((unit) => unit.spanId), ["0", "1"]);
});
