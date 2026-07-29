import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCanonicalLine } from "../src/utils/Lyrics/Processing/Canonical.ts";
import type { RenderPlan } from "../src/utils/Lyrics/Processing/Model.ts";
import { buildRenderPlan } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { annotateJapaneseLine } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnnotationProcessor.ts";
import type { JapaneseAnalyzer } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnalyzer.ts";
import {
  applyVerifiedLexicalReadings,
  collectProductivePersonCounterReadings,
  collectVerifiedLexicalReadings,
  type ProductivePersonCounterAudit,
} from "../src/utils/Lyrics/Processing/Japanese/JapaneseReadingResolver.ts";
import { normalizeKuromojiTokens } from "../src/utils/Lyrics/Processing/Japanese/KuromojiJapaneseAnalyzer.ts";
import { timedFuriganaGroups } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";
import { prepareJapaneseLineAnalysis } from "../src/utils/Lyrics/Reading/JapaneseReading.ts";

type RawTokenSpec = {
  surface: string;
  reading: string;
  pos?: string;
  detail1?: string;
  detail2?: string;
};

function normalizedTokens(text: string, specs: readonly RawTokenSpec[]) {
  return normalizeKuromojiTokens(
    text,
    specs.map((spec) => ({
      surface_form: spec.surface,
      reading: spec.reading,
      pronunciation: spec.reading,
      pos: spec.pos || "名詞",
      pos_detail_1: spec.detail1 || "一般",
      pos_detail_2: spec.detail2 || "*",
      basic_form: spec.surface,
    }))
  );
}

function analyzerFor(text: string, specs: readonly RawTokenSpec[]): JapaneseAnalyzer {
  const tokens = normalizedTokens(text, specs);
  return {
    id: "kuromoji-shape-fixture",
    async analyze(actualText) {
      assert.equal(actualText, text);
      return tokens;
    },
  };
}

const kanaToRomaji = (kana: string): string =>
  ({
    いち: "ichi",
    に: "ni",
    にん: "nin",
    ひとり: "hitori",
    ふたり: "futari",
    きり: "kiri",
    とも: "tomo",
    だけ: "dake",
    かずと: "kazuto",
  })[kana] || kana;

const ichi = (): RawTokenSpec => ({
  surface: "一",
  reading: "イチ",
  detail1: "数",
});
const ni = (): RawTokenSpec => ({
  surface: "二",
  reading: "ニ",
  detail1: "数",
});
const personCounter = (): RawTokenSpec => ({
  surface: "人",
  reading: "ニン",
  detail1: "接尾",
  detail2: "助数詞",
});

test("bounded resolver corrects 一人きり reading and keeps jukujikun ruby whole", async () => {
  const options = {
    analyzer: analyzerFor("一人きり", [
      ichi(),
      personCounter(),
      { surface: "きり", reading: "キリ", detail1: "非自立" },
    ]),
    kanaRomanizer: kanaToRomaji,
  };
  const analysis = await prepareJapaneseLineAnalysis(
    "一人きり",
    options,
  );

  assert.equal(analysis?.reading.romaji, "hitori kiri");
  assert.deepEqual(
    analysis?.reading.furigana.map(({ start, end, reading }) => ({ start, end, reading })),
    [{ start: 0, end: 2, reading: "ひとり" }]
  );

  const parsed = {
    id: "person-counter",
    displayText: "一人きり",
    paragraphProvenance: "unavailable",
    spans: [
      {
        id: "0",
        rawText: "一",
        cleanText: "一",
        startMs: 0,
        endMs: 1,
        providerPartOfWord: true,
      },
      {
        id: "1",
        rawText: "人",
        cleanText: "人",
        startMs: 1,
        endMs: 2,
        providerPartOfWord: true,
      },
      {
        id: "2",
        rawText: "きり",
        cleanText: "きり",
        startMs: 2,
        endMs: 3,
        providerPartOfWord: true,
      },
    ],
  } as const;
  const canonical = buildCanonicalLine(parsed);
  const plan: RenderPlan = {
    lineId: "person-counter",
    sourceUnits: canonical.spanMappings,
    readingUnits: [],
    timedReadingUnits: [],
    joinedDisplayText: "一人きり",
    furigana: analysis?.reading.furigana || [],
  };
  const groups = timedFuriganaGroups(plan);
  assert.deepEqual(groups.groups[0]?.spanIds, ["0", "1"]);
  assert.equal(groups.groups[0]?.reading, "ひとり");

  const annotation = await annotateJapaneseLine(
    canonical,
    options,
    analysis,
  );
  assert.ok(annotation);
  const readingPlan = buildRenderPlan(parsed, canonical, [annotation!]);
  assert.deepEqual(
    readingPlan.timedReadingUnits.map(({ text, animationTimingRefs }) => ({
      text,
      animationTimingRefs,
    })),
    [
      { text: "hitori", animationTimingRefs: ["0", "1"] },
      { text: "", animationTimingRefs: undefined },
      { text: " kiri", animationTimingRefs: undefined },
    ],
  );
});

test("bounded resolver corrects 二人 and explicit lyric readings still win", async () => {
  const ordinary = await prepareJapaneseLineAnalysis("二人とも", {
    analyzer: analyzerFor("二人とも", [
      ni(),
      personCounter(),
      { surface: "とも", reading: "トモ", pos: "助詞", detail1: "副助詞" },
    ]),
    kanaRomanizer: kanaToRomaji,
  });
  assert.equal(ordinary?.reading.romaji, "futari tomo");

  const explicit = await prepareJapaneseLineAnalysis("一人(かずと)だけ", {
    analyzer: analyzerFor("一人だけ", [
      ichi(),
      personCounter(),
      { surface: "だけ", reading: "ダケ", pos: "助詞", detail1: "副助詞" },
    ]),
    kanaRomanizer: kanaToRomaji,
  });
  assert.equal(explicit?.reading.displayText, "一人だけ");
  assert.equal(explicit?.reading.romaji, "kazuto dake");
  assert.deepEqual(
    explicit?.reading.furigana.map(({ start, end, reading, provenance }) => ({
      start,
      end,
      reading,
      provenance,
    })),
    [{ start: 0, end: 2, reading: "かずと", provenance: "providerExplicit" }]
  );
});

test("counter audit isolates wins and records conservative abstentions", () => {
  const cases: Array<{
    text: string;
    specs: RawTokenSpec[];
    decisions: number;
    reason?: ProductivePersonCounterAudit["abstentions"][number]["reason"];
  }> = [
    { text: "一人", specs: [ichi(), personCounter()], decisions: 1 },
    { text: "二人", specs: [ni(), personCounter()], decisions: 1 },
    {
      text: "一人きり",
      specs: [ichi(), personCounter(), { surface: "きり", reading: "キリ" }],
      decisions: 1,
    },
    {
      text: "二人とも",
      specs: [ni(), personCounter(), { surface: "とも", reading: "トモ" }],
      decisions: 1,
    },
    {
      text: "一人一人",
      specs: [ichi(), personCounter(), ichi(), personCounter()],
      decisions: 2,
    },
    {
      text: "十一人",
      specs: [{ surface: "十", reading: "ジュウ", detail1: "数" }, ichi(), personCounter()],
      decisions: 0,
      reason: "insideLargerNumber",
    },
    {
      text: "一人さん",
      specs: [
        ichi(),
        personCounter(),
        { surface: "さん", reading: "サン", detail1: "接尾", detail2: "人名" },
      ],
      decisions: 0,
      reason: "nameLikeContext",
    },
    {
      text: "二人君",
      specs: [ni(), personCounter(), { surface: "君", reading: "キミ", pos: "代名詞" }],
      decisions: 0,
      reason: "nameLikeContext",
    },
    {
      text: "一人称",
      specs: [{ surface: "一人称", reading: "イチニンショウ" }],
      decisions: 0,
    },
    {
      text: "一人前",
      specs: [ichi(), { surface: "人前", reading: "ニンマエ", detail1: "接尾", detail2: "助数詞" }],
      decisions: 0,
    },
    {
      text: "二人三脚",
      specs: [{ surface: "二人三脚", reading: "ニニンサンキャク" }],
      decisions: 0,
    },
  ];

  for (const fixture of cases) {
    const audit = collectProductivePersonCounterReadings(
      fixture.text,
      normalizedTokens(fixture.text, fixture.specs)
    );
    assert.equal(audit.decisions.length, fixture.decisions, fixture.text);
    if (fixture.reason) {
      assert.equal(audit.abstentions[0]?.reason, fixture.reason, fixture.text);
    } else {
      assert.equal(audit.abstentions.length, 0, fixture.text);
    }
  }
});

test("ablation exposes the exact Kuromoji baseline changed by the resolver", () => {
  const one = collectProductivePersonCounterReadings(
    "一人きり",
    normalizedTokens("一人きり", [ichi(), personCounter(), { surface: "きり", reading: "キリ" }])
  );
  const two = collectProductivePersonCounterReadings(
    "二人とも",
    normalizedTokens("二人とも", [ni(), personCounter(), { surface: "とも", reading: "トモ" }])
  );

  assert.deepEqual(
    [one, two].map(({ decisions }) => ({
      baseline: decisions[0]?.baselineReadingKana,
      resolved: decisions[0]?.readingKana,
      geometry: decisions[0]?.geometry,
    })),
    [
      { baseline: "いちにん", resolved: "ひとり", geometry: "irreducibleWholeSpan" },
      { baseline: "ににん", resolved: "ふたり", geometry: "irreducibleWholeSpan" },
    ]
  );
});

test("verified lexical resolver corrects only audited Kuromoji token shapes", async () => {
  const cases: Array<{
    text: string;
    specs: RawTokenSpec[];
    expectedFurigana: string;
    expectedRomaji: string;
    expectedDecisionCount: number;
  }> = [
    {
      text: "大人買い",
      specs: [
        { surface: "大人", reading: "オトナ" },
        { surface: "買い", reading: "カイ", pos: "動詞", detail1: "自立" },
      ],
      expectedFurigana: "おとなが",
      expectedRomaji: "otonagai",
      expectedDecisionCount: 1,
    },
    {
      text: "響めく",
      specs: [
        { surface: "響", reading: "ヒビキ" },
        { surface: "めく", reading: "メク", pos: "動詞", detail1: "非自立" },
      ],
      expectedFurigana: "どよ",
      expectedRomaji: "doyomeku",
      expectedDecisionCount: 1,
    },
    {
      text: "一歩",
      specs: [
        { surface: "一", reading: "イチ", detail1: "数" },
        { surface: "歩", reading: "ホ", detail1: "接尾", detail2: "助数詞" },
      ],
      expectedFurigana: "いっぽ",
      expectedRomaji: "ippo",
      expectedDecisionCount: 2,
    },
    {
      text: "目蓋",
      specs: [
        { surface: "目", reading: "メ" },
        { surface: "蓋", reading: "フタ" },
      ],
      expectedFurigana: "まぶた",
      expectedRomaji: "mabuta",
      expectedDecisionCount: 2,
    },
    {
      text: "変われる",
      specs: [
        { surface: "変", reading: "ヘン", detail1: "形容動詞語幹" },
        { surface: "われる", reading: "ワレル", pos: "動詞", detail1: "自立" },
      ],
      expectedFurigana: "か",
      expectedRomaji: "kawareru",
      expectedDecisionCount: 1,
    },
  ];
  const romanized = new Map([
    ["おとな", "otona"],
    ["がい", "gai"],
    ["どよ", "doyo"],
    ["めく", "meku"],
    ["いっ", "i"],
    ["ぽ", "ppo"],
    ["ま", "ma"],
    ["ぶた", "buta"],
    ["か", "ka"],
    ["われる", "wareru"],
  ]);

  for (const fixture of cases) {
    const tokens = normalizedTokens(fixture.text, fixture.specs);
    const audit = collectVerifiedLexicalReadings(fixture.text, tokens);
    assert.equal(audit.decisions.length, fixture.expectedDecisionCount, fixture.text);
    assert.equal(audit.abstentions.length, 0, fixture.text);

    const analysis = await prepareJapaneseLineAnalysis(
      fixture.text,
      {
        analyzer: analyzerFor(fixture.text, fixture.specs),
        kanaRomanizer: (kana) => romanized.get(kana) || kana,
      },
    );
    assert.equal(
      analysis?.reading.furigana.map(({ reading }) => reading).join(""),
      fixture.expectedFurigana,
      fixture.text,
    );
    assert.equal(
      analysis?.reading.romaji?.replace(/\s+/gu, ""),
      fixture.expectedRomaji,
      fixture.text,
    );
  }
});

test("verified lexical resolver abstains on correct, split, and name-like near misses", () => {
  const cases = [
    {
      text: "一歩",
      specs: [{ surface: "一歩", reading: "イッポ" }],
      abstention: undefined,
    },
    {
      text: "大人 買い",
      specs: [
        { surface: "大人", reading: "オトナ" },
        { surface: " ", reading: "" },
        { surface: "買い", reading: "カイ", pos: "動詞" },
      ],
      abstention: undefined,
    },
    {
      text: "反響めく",
      specs: [
        { surface: "反響", reading: "ハンキョウ" },
        { surface: "めく", reading: "メク", pos: "動詞" },
      ],
      abstention: undefined,
    },
    {
      text: "変われる",
      specs: [
        { surface: "変わ", reading: "カワ", pos: "動詞" },
        { surface: "れる", reading: "レル", pos: "動詞", detail1: "接尾" },
      ],
      abstention: undefined,
    },
    {
      text: "目蓋さん",
      specs: [
        { surface: "目", reading: "メ" },
        { surface: "蓋", reading: "フタ" },
        { surface: "さん", reading: "サン", detail1: "接尾", detail2: "人名" },
      ],
      abstention: "nameLikeContext",
    },
  ] as const;

  for (const fixture of cases) {
    const audit = collectVerifiedLexicalReadings(
      fixture.text,
      normalizedTokens(fixture.text, fixture.specs),
    );
    assert.equal(audit.decisions.length, 0, fixture.text);
    assert.equal(audit.abstentions[0]?.reason, fixture.abstention, fixture.text);
  }
});

test("verified lexical projection is atomic when another reading layer already changed one token", () => {
  const tokens = normalizedTokens("一歩", [
    { surface: "一", reading: "イチ", detail1: "数" },
    { surface: "歩", reading: "ホ", detail1: "接尾", detail2: "助数詞" },
  ]);
  const entries = [
    {
      romaji: "ichi",
      consumed: false,
      surface: "一",
      readingKana: "いち",
      start: 0,
      end: 1,
    },
    {
      romaji: "hou",
      consumed: false,
      surface: "歩",
      readingKana: "ほう",
      start: 1,
      end: 2,
    },
  ];

  const audit = applyVerifiedLexicalReadings("一歩", tokens, entries);
  assert.equal(audit.applied.length, 0);
  assert.equal(audit.abstentions[0]?.reason, "readingStateConflict");
  assert.deepEqual(entries.map(({ readingKana }) => readingKana), ["いち", "ほう"]);
});

test("provider-authored readings override verified lexical defaults", async () => {
  const analysis = await prepareJapaneseLineAnalysis(
    "目蓋(めぶた)だけ",
    {
      analyzer: analyzerFor("目蓋だけ", [
        { surface: "目", reading: "メ" },
        { surface: "蓋", reading: "フタ" },
        { surface: "だけ", reading: "ダケ", pos: "助詞", detail1: "副助詞" },
      ]),
      kanaRomanizer: (kana) =>
        ({ めぶた: "mebuta", ま: "ma", ぶた: "buta", だけ: "dake" })[kana] || kana,
    },
  );

  assert.equal(analysis?.reading.displayText, "目蓋だけ");
  assert.equal(analysis?.reading.romaji, "mebuta dake");
  assert.deepEqual(
    analysis?.reading.furigana.map(({ start, end, reading, provenance }) => ({
      start,
      end,
      reading,
      provenance,
    })),
    [{ start: 0, end: 2, reading: "めぶた", provenance: "providerExplicit" }],
  );
});
