import assert from "node:assert/strict";
import { test } from "node:test";

class FakeClassList {
  readonly values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }

  toggle(name: string, force?: boolean): void {
    if (force === false) this.values.delete(name);
    else this.values.add(name);
  }
}

class FakeElement {
  className = "";
  classList = new FakeClassList();
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  style = {
    marginLeft: "",
    values: new Map<string, string>(),
    setProperty(name: string, value: string): void {
      this.values.set(name, value);
    },
  };
  private ownTextContent = "";
  lang = "";

  get textContent(): string {
    return this.children.length > 0
      ? this.children.map((child) => child.textContent).join("")
      : this.ownTextContent;
  }

  set textContent(value: string) {
    this.ownTextContent = value;
    this.children = [];
  }

  get childElementCount(): number {
    return this.children.length;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

const storage = new Map<string, string>();
(globalThis as any).Spicetify = {
  LocalStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => storage.set(key, value),
  },
};
(globalThis as any).document = {
  querySelector: () => null,
  createElement: () => new FakeElement(),
};
(globalThis as any).MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
};

const {
  appendFuriganaText,
  appendLineExtras,
  appendSyllableRomanizedBelow,
  isJapaneseEntry,
  packAdjacentFuriganaClusters,
  renderBaseTextWithReadings,
} = await import(
  "../src/utils/Lyrics/Applyer/ReadingRenderer.ts"
);
const { $japaneseReadingMode } = await import("../src/utils/uiState.ts");

const plan = {
  lineId: "jp",
  sourceUnits: [],
  readingUnits: [],
  timedReadingUnits: [{
    spanId: "0",
    canonicalRange: { startCp: 0, endCp: 1 },
    text: "watashi",
    logicalGroupId: "jp-0",
  }],
  joinedDisplayText: "watashi",
};

function render(mode: "romaji" | "furigana" | "both"): FakeElement {
  $japaneseReadingMode.set(mode);
  const line = new FakeElement();
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [{ Text: "私", JapaneseReading: { sourceText: "私", romaji: "watashi", furigana: [] } }],
    "私",
    "watashi",
    undefined,
    "I",
    [{}],
    plan,
    { useRomanized: true, isJapaneseLyrics: true }
  );
  return line;
}

test("plan romaji follows Japanese reading display mode", () => {
  const furigana = render("furigana");
  assert.equal(furigana.children.some((child) => child.className.includes("reading-plan-row")), false);
  assert.equal(furigana.children.some((child) => child.className.includes("translated-below")), true);

  for (const mode of ["romaji", "both"] as const) {
    const line = render(mode);
    assert.equal(line.children.some((child) => child.className.includes("reading-plan-row")), true, mode);
    assert.equal(line.children.some((child) => child.className.includes("translated-below")), true, mode);
  }
});

test("opaque Japanese readings bind their sidecar to the full compound window", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  const animatorEntries: Array<{
    StartTime: number;
    EndTime: number;
    RomajiElement?: HTMLElement;
    RomajiStartTime?: number;
    RomajiEndTime?: number;
  }> = [
    { StartTime: 100, EndTime: 200 },
    { StartTime: 200, EndTime: 350 },
  ];
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [
      { Text: "一", JapaneseReading: { sourceText: "一", romaji: "hitori", furigana: [] } },
      { Text: "人" },
    ],
    "一人",
    "hitori",
    undefined,
    undefined,
    animatorEntries,
    {
      ...plan,
      joinedDisplayText: "hitori",
      timedReadingUnits: [
        {
          spanId: "0",
          canonicalRange: { startCp: 0, endCp: 1 },
          text: "hitori",
          logicalGroupId: "jp-token-0",
          animationTimingRefs: ["0", "1"],
        },
        {
          spanId: "1",
          canonicalRange: { startCp: 1, endCp: 2 },
          text: "",
          logicalGroupId: "jp-token-0",
        },
      ],
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );

  assert.equal(animatorEntries[0].RomajiStartTime, 100);
  assert.equal(animatorEntries[0].RomajiEndTime, 350);
  assert.equal(animatorEntries[1].RomajiStartTime, undefined);
  assert.equal(animatorEntries[1].RomajiEndTime, undefined);
});

test("Japanese romaji sweep interpolates token boundaries inside a timing span", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  const animatorEntries: Array<{
    StartTime: number;
    EndTime: number;
    RomajiElement?: HTMLElement;
    RomajiStartTime?: number;
    RomajiEndTime?: number;
  }> = [
    { StartTime: 100, EndTime: 200 },
    { StartTime: 200, EndTime: 500 },
  ];
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [
      { Text: "耳", JapaneseReading: { sourceText: "耳", romaji: "miminari", furigana: [] } },
      { Text: "鳴りが", JapaneseReading: { sourceText: "鳴りが", romaji: "ga", furigana: [] } },
    ],
    "耳鳴りが",
    "miminari ga",
    undefined,
    undefined,
    animatorEntries,
    {
      ...plan,
      sourceUnits: [
        {
          spanId: "0",
          canonicalRange: { startCp: 0, endCp: 1 },
          rawText: "耳",
          cleanText: "耳",
        },
        {
          spanId: "1",
          canonicalRange: { startCp: 1, endCp: 4 },
          rawText: "鳴りが",
          cleanText: "鳴りが",
        },
      ],
      joinedDisplayText: "miminari ga",
      timedReadingUnits: [
        {
          spanId: "0",
          canonicalRange: { startCp: 0, endCp: 1 },
          text: "miminari",
          logicalGroupId: "jp-token-0",
          animationTimingRefs: ["0", "1"],
          animationRange: { startCp: 0, endCp: 3 },
        },
        {
          spanId: "1",
          canonicalRange: { startCp: 1, endCp: 4 },
          text: " ga",
          logicalGroupId: "jp-token-1",
          animationRange: { startCp: 3, endCp: 4 },
        },
      ],
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );

  assert.equal(animatorEntries[0].RomajiStartTime, 100);
  assert.equal(animatorEntries[0].RomajiEndTime, 400);
  assert.equal(animatorEntries[1].RomajiStartTime, 400);
  assert.equal(animatorEntries[1].RomajiEndTime, 500);
});

test("timed-group suppression removes only the selected line segment", () => {
  $japaneseReadingMode.set("furigana");
  const line = new FakeElement();
  renderBaseTextWithReadings(
    line as unknown as HTMLElement,
    {
      Text: "生生",
      JapaneseReading: {
        sourceText: "生生",
        furigana: [
          { start: 0, end: 1, reading: "せい", lineSegmentKey: "0:1\u0000せい" },
          { start: 1, end: 2, reading: "せい", lineSegmentKey: "1:2\u0000せい" },
        ],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true, suppressedFuriganaKeys: ["0:1\u0000せい"] },
  );

  const renderedReadings = line.children
    .flatMap((cluster) => cluster.children)
    .filter((child) =>
      child.className.includes("furigana-reading") &&
      child.dataset.furigana === "せい"
    );
  assert.equal(renderedReadings.length, 1);
});

test("furigana carries its source range into a non-positioned karaoke paint layer", () => {
  const line = new FakeElement();
  appendFuriganaText(line as unknown as HTMLElement, "今も私の中", [
    { start: 2, end: 3, reading: "わたし" },
    { start: 4, end: 5, reading: "なか" },
  ]);

  const readings = line.children
    .flatMap((cluster) => cluster.children)
    .filter((child) => child.dataset.furigana !== undefined);
  assert.equal(readings.length, 2);
  assert.deepEqual(
    readings.map((reading) => ({
      label: reading.dataset.furigana,
      start: reading.style.values.get("--furigana-source-start"),
      scale: reading.style.values.get("--furigana-source-scale"),
      layer: reading.children[0]?.className,
      text: reading.children[0]?.textContent,
    })),
    [
      {
        label: "わたし",
        start: `${(2 / 5) * 100}%`,
        scale: "5",
        layer: "furigana-reading-text",
        text: "わたし",
      },
      {
        label: "なか",
        start: `${(4 / 5) * 100}%`,
        scale: "5",
        layer: "furigana-reading-text",
        text: "なか",
      },
    ],
  );
});

test("Chinese-provider repair renders projected kanji without mutating source text", () => {
  $japaneseReadingMode.set("furigana");
  const line = new FakeElement();
  const entry = {
    Text: "梦见ては",
    JapaneseReading: {
      sourceText: "梦见ては",
      displayText: "夢見ては",
      furigana: [],
    },
  };
  renderBaseTextWithReadings(
    line as unknown as HTMLElement,
    entry,
    { useRomanized: false, isJapaneseLyrics: true },
  );
  assert.equal(entry.Text, "梦见ては");
  assert.equal(entry.JapaneseReading.sourceText, "梦见ては");
  assert.equal(line.textContent, "夢見ては");
});

test("only directly adjacent ruby clusters reserve reading width", () => {
  const adjacent = new FakeElement();
  appendFuriganaText(adjacent as unknown as HTMLElement, "極星", [
    { start: 0, end: 1, reading: "きょく" },
    { start: 1, end: 2, reading: "ぼし" },
  ]);
  packAdjacentFuriganaClusters(adjacent.children as unknown as HTMLElement[]);
  assert.equal(adjacent.children.length, 2);
  assert.equal(adjacent.children.every((cluster) => cluster.classList.values.has("furigana-cluster-packed")), true);

  const isolated = new FakeElement();
  appendFuriganaText(isolated as unknown as HTMLElement, "極の星", [
    { start: 0, end: 1, reading: "きょく" },
    { start: 2, end: 3, reading: "ほし" },
  ]);
  packAdjacentFuriganaClusters(isolated.children as unknown as HTMLElement[]);
  const rubyClusters = isolated.children.filter((cluster) =>
    !cluster.className.includes("furigana-plain-cluster")
  );
  const plainClusters = isolated.children.filter((cluster) =>
    cluster.className.includes("furigana-plain-cluster")
  );
  assert.equal(rubyClusters.every((cluster) => !cluster.classList.values.has("furigana-cluster-packed")), true);
  assert.equal(plainClusters.every((cluster) => !cluster.classList.values.has("furigana-cluster-packed")), true);
});

test("full-line lyrics automatically pack split compounds without widening isolated ruby", () => {
  $japaneseReadingMode.set("furigana");
  const line = new FakeElement();
  renderBaseTextWithReadings(
    line as unknown as HTMLElement,
    {
      Text: "一際輝く流星の尾",
      JapaneseReading: {
        sourceText: "一際輝く流星の尾",
        furigana: [
          { start: 0, end: 1, reading: "ひと" },
          { start: 1, end: 2, reading: "きわ" },
          { start: 2, end: 3, reading: "かがや" },
          { start: 4, end: 5, reading: "りゅう" },
          { start: 5, end: 6, reading: "せい" },
          { start: 7, end: 8, reading: "お" },
        ],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );

  const clusters = line.children.map((cluster) => ({
    base: cluster.children.find((child) => child.className === "furigana-base")?.textContent,
    packed: cluster.classList.values.has("furigana-cluster-packed"),
  }));
  assert.deepEqual(clusters, [
    { base: "一", packed: true },
    { base: "際", packed: true },
    { base: "輝", packed: true },
    { base: "く", packed: false },
    { base: "流", packed: true },
    { base: "星", packed: true },
    { base: "の", packed: false },
    { base: "尾", packed: false },
  ]);
});

test("timed provider spans reserve every real ruby without widening plain spacers", () => {
  const left = new FakeElement();
  const right = new FakeElement();
  const separated = new FakeElement();
  appendFuriganaText(left as unknown as HTMLElement, "涙", [{ start: 0, end: 1, reading: "なみだ" }]);
  appendFuriganaText(right as unknown as HTMLElement, "流", [{ start: 0, end: 1, reading: "なが" }]);
  appendFuriganaText(separated as unknown as HTMLElement, "声", [{ start: 0, end: 1, reading: "こえ" }]);

  const spacer = new FakeElement();
  appendFuriganaText(spacer as unknown as HTMLElement, "を", []);
  packAdjacentFuriganaClusters([
    left.children[0],
    right.children[0],
    spacer.children[0],
    separated.children[0],
  ] as unknown as HTMLElement[]);

  assert.equal(left.children[0].classList.values.has("furigana-cluster-packed"), true);
  assert.equal(right.children[0].classList.values.has("furigana-cluster-packed"), true);
  assert.equal(separated.children[0].classList.values.has("furigana-cluster-packed"), false);
  assert.equal(spacer.children[0].classList.values.has("furigana-cluster-packed"), false);
});

test("isolated inochi overhangs while adjacent tamashii and ooi stay packed", () => {
  const inochi = new FakeElement();
  const mo = new FakeElement();
  appendFuriganaText(inochi as unknown as HTMLElement, "命", [
    { start: 0, end: 1, reading: "いのち" },
  ]);
  appendFuriganaText(mo as unknown as HTMLElement, "も", []);
  packAdjacentFuriganaClusters([
    inochi.children[0],
    mo.children[0],
  ] as unknown as HTMLElement[]);
  assert.equal(inochi.children[0].classList.values.has("furigana-cluster-packed"), false);

  const tamashii = new FakeElement();
  const authoredSpace = new FakeElement();
  const ooi = new FakeElement();
  appendFuriganaText(tamashii as unknown as HTMLElement, "魂", [
    { start: 0, end: 1, reading: "たましい" },
  ]);
  appendFuriganaText(authoredSpace as unknown as HTMLElement, " ", []);
  appendFuriganaText(ooi as unknown as HTMLElement, "大", [
    { start: 0, end: 1, reading: "おお" },
  ]);
  packAdjacentFuriganaClusters([
    tamashii.children[0],
    authoredSpace.children[0],
    ooi.children[0],
  ] as unknown as HTMLElement[]);
  assert.equal(tamashii.children[0].classList.values.has("furigana-cluster-packed"), true);
  assert.equal(authoredSpace.children[0].classList.values.has("furigana-cluster-packed"), false);
  assert.equal(ooi.children[0].classList.values.has("furigana-cluster-packed"), true);
});

test("plain Japanese tails expose wrap points beside ruby clusters", () => {
  for (const fixture of [
    { text: "今日はダービーめでたいな(それいけーっ!)", rubyEnd: 2, reading: "きょう" },
    { text: "本命穴ウマかきわけて(ふーわっ ふーわっ)", rubyEnd: 3, reading: "ほんめいあな" },
  ]) {
    const line = new FakeElement();
    appendFuriganaText(line as unknown as HTMLElement, fixture.text, [
      { start: 0, end: fixture.rubyEnd, reading: fixture.reading },
    ]);

    const renderedBase = line.children
      .map((cluster) => cluster.children.find((child) => child.className === "furigana-base")?.textContent || "")
      .join("");
    const plainBase = line.children
      .filter((cluster) => cluster.className.includes("furigana-plain-cluster"))
      .map((cluster) => cluster.children.find((child) => child.className === "furigana-base")?.textContent || "");

    assert.equal(renderedBase, fixture.text);
    assert.equal(plainBase.join(""), fixture.text.slice(fixture.rubyEnd));
    assert.ok(plainBase.length > 1);
    assert.equal(plainBase.includes("("), false);
    assert.equal(plainBase.includes(")"), false);
  }
});

test("explicit readings tint only derived furigana while displaying the immutable source as ruby", () => {
  $japaneseReadingMode.set("furigana");
  const line = new FakeElement();
  renderBaseTextWithReadings(
    line as unknown as HTMLElement,
    {
      Text: "天(そら)",
      JapaneseReading: {
        sourceText: "天(そら)",
        displayText: "天",
        romaji: "sora",
        furigana: [{ start: 0, end: 1, reading: "そら", provenance: "providerExplicit" }],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );
  const cluster = line.children[0];
  const reading = cluster.children.find((child) => child.textContent === "そら")!;
  const base = cluster.children.find((child) => child.textContent === "天")!;
  assert.equal(reading.classList.values.has("reading-origin-provider-explicit"), true);
  assert.equal(base.classList.values.has("reading-origin-provider-explicit"), false);
});

test("romaji-only mode marks the explicit reading span", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "天(そら)",
      JapaneseReading: {
        sourceText: "天(そら)",
        displayText: "天",
        romaji: "sora",
        romajiSegments: [{ text: "sora", provenance: "providerExplicit" }],
        furigana: [{ start: 0, end: 1, reading: "そら", provenance: "providerExplicit" }],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );
  const romanized = line.children.find((child) => child.className.includes("romanized-below"))!;
  assert.equal(romanized.children[0].classList.values.has("reading-origin-provider-explicit"), true);
});

test("whitespace-only romaji projection differences retain explicit reading spans", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "古(いにしえ)の智(ち)唯一つの住処",
      ReadingRenderPlan: { ...plan, joinedDisplayText: "inishie no chi tada hitotsu no sumika" },
      JapaneseReading: {
        sourceText: "古(いにしえ)の智(ち)唯一つの住処",
        displayText: "古の智唯一つの住処",
        romaji: "inishie no chi tada hitotsu no sumika",
        romajiSegments: [
          { text: "inishie", provenance: "providerExplicit" },
          { text: "  no" },
          { text: " chi", provenance: "providerExplicit" },
          { text: " tada hitotsu no sumika " },
        ],
        furigana: [],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );
  const romanized = line.children.find((child) => child.className.includes("romanized-below"))!;
  assert.equal(romanized.children.length, 4);
  assert.equal(romanized.children[0].classList.values.has("reading-origin-provider-explicit"), true);
  assert.equal(romanized.children[2].classList.values.has("reading-origin-provider-explicit"), true);
});

test("semantic romaji projection differences still fall back to plain text", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "天(そら)",
      ReadingRenderPlan: { ...plan, joinedDisplayText: "sora" },
      JapaneseReading: {
        sourceText: "天(そら)",
        displayText: "天",
        romaji: "sora",
        romajiSegments: [{ text: "ama", provenance: "providerExplicit" }],
        furigana: [],
      },
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );
  const romanized = line.children.find((child) => child.className.includes("romanized-below"))!;
  assert.equal(romanized.children.length, 0);
  assert.equal(romanized.textContent, "sora");
});

test("attached mixed-script source stays exact while lyric and romaji display readable gaps", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  const entry = {
    Text: "ぶち壊してshout it out loud",
    JapaneseReading: {
      sourceText: "ぶち壊してshout it out loud",
      romaji: "buchikowashiteshout it out loud",
      furigana: [],
    },
  };

  appendLineExtras(
    line as unknown as HTMLElement,
    entry,
    { useRomanized: true, isJapaneseLyrics: true },
  );

  const romanized = line.children.find((child) => child.className.includes("romanized-below"))!;
  assert.equal(entry.Text, "ぶち壊してshout it out loud");
  assert.equal(entry.JapaneseReading.sourceText, "ぶち壊してshout it out loud");
  assert.equal(romanized.textContent, "buchikowashite shout it out loud");
  assert.equal(line.classList.values.has("HasExtras"), true);
  assert.equal(romanized.className, "romanized-below");

  const base = new FakeElement();
  renderBaseTextWithReadings(
    base as unknown as HTMLElement,
    entry,
    { useRomanized: false, isJapaneseLyrics: true },
  );
  assert.equal(base.textContent, "ぶち壊して shout it out loud");
});

test("timed mixed-script romaji gets a visual gap without changing timing units", () => {
  $japaneseReadingMode.set("romaji");
  const line = new FakeElement();
  const timedUnits = [
    {
      spanId: "0",
      canonicalRange: { startCp: 0, endCp: 5 },
      text: "buchikowashite",
      logicalGroupId: "jp",
    },
    {
      spanId: "1",
      canonicalRange: { startCp: 5, endCp: 10 },
      text: "shout it out loud",
      logicalGroupId: "latin",
    },
  ];

  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [
      { Text: "ぶち壊して", IsPartOfWord: true },
      { Text: "shout it out loud", IsPartOfWord: true },
    ],
    "ぶち壊してshout it out loud",
    "buchikowashiteshout it out loud",
    undefined,
    undefined,
    [{}, {}],
    {
      ...plan,
      timedReadingUnits: timedUnits,
      joinedDisplayText: "buchikowashiteshout it out loud",
    },
    { useRomanized: true, isJapaneseLyrics: true },
  );

  const row = line.children.find((child) => child.className.includes("reading-plan-row"))!;
  assert.deepEqual(row.children.map((group) => group.style.marginLeft), ["", "0.25em"]);
  assert.deepEqual(
    timedUnits.map((unit) => [unit.spanId, unit.text]),
    [
      ["0", "buchikowashite"],
      ["1", "shout it out loud"],
    ],
  );
});

test("an explicit Chinese reading route overrides an embedded kana island", () => {
  assert.equal(isJapaneseEntry({
    Text: "\u5982\u679c\u3059\u307f\u307e\u305b\u3093",
    ReadingPrimaryScript: "Chinese",
  }), false);
});

test("Chinese-dominant mixed readings stay visible in Japanese furigana mode", () => {
  $japaneseReadingMode.set("furigana");
  const line = new FakeElement();
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [
      { Text: "\u5982\u679c", ReadingPrimaryScript: "Chinese" },
      { Text: "\u3059\u307f\u307e\u305b\u3093", ReadingPrimaryScript: "Chinese" },
    ],
    "\u5982\u679c\u3059\u307f\u307e\u305b\u3093",
    undefined,
    undefined,
    undefined,
    [{}, {}],
    {
      ...plan,
      primaryScript: "Chinese",
      joinedDisplayText: "ru guo sumimasen",
      timedReadingUnits: [
        { spanId: "0", canonicalRange: { startCp: 0, endCp: 2 }, text: "ru guo", logicalGroupId: "cn-0" },
        { spanId: "1", canonicalRange: { startCp: 2, endCp: 7 }, text: " sumimasen", logicalGroupId: "jp-1" },
      ],
    },
    { useRomanized: true, isJapaneseLyrics: false }
  );
  assert.equal(line.children.some((child) => child.className.includes("reading-plan-row")), true);
});

test("active Chinese reading plans render contextual spaces between timing units", () => {
  const line = new FakeElement();
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [{ Text: "\u4e0d" }, { Text: "\u4f1a" }, { Text: "\u5427\uff1f" }],
    "\u4e0d\u4f1a\u5427\uff1f",
    undefined,
    undefined,
    undefined,
    [{}, {}, {}],
    {
      ...plan,
      primaryScript: "Chinese",
      joinedDisplayText: "b\u00f9 hu\u00ec b\u0101 \uff1f",
      timedReadingUnits: [
        { spanId: "0", canonicalRange: { startCp: 0, endCp: 1 }, text: "b\u00f9", logicalGroupId: "cn-0" },
        { spanId: "1", canonicalRange: { startCp: 1, endCp: 2 }, text: " hu\u00ec", logicalGroupId: "cn-1" },
        { spanId: "2", canonicalRange: { startCp: 2, endCp: 4 }, text: " b\u0101 \uff1f", logicalGroupId: "cn-2" },
      ],
    },
    { useRomanized: true, isJapaneseLyrics: false },
  );

  const row = line.children.find((child) => child.className.includes("reading-plan-row"));
  assert.ok(row);
  assert.deepEqual(row.children.map((group) => group.style.marginLeft), ["", "0.25em", "0.25em"]);
  assert.deepEqual(
    row.children.map((group) => group.children[0]?.textContent),
    ["b\u00f9", "hu\u00ec", "b\u0101 \uff1f"],
  );
});

test("provider and built-in translations share markup but keep independent lanes", () => {
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "どうせ水は乾く土地さ",
      ProviderTranslatedText: "反正水是干旱的土地上的",
      TranslatedText: "Bagaimanapun, air akan mengeringkan tanah ini",
    },
    {
      useRomanized: false,
      showProviderTranslations: true,
    }
  );

  assert.equal(line.children.length, 2);
  assert.equal(line.children[0]?.className.includes("translated-below"), true);
  assert.equal(line.children[0]?.lang, "zh-Hans");
  assert.equal(line.children[1]?.className.includes("translated-below"), true);
  assert.equal(line.children[1]?.lang, "");
});

test("provider translation visibility does not hide the built-in lane", () => {
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "どうせ水は乾く土地さ",
      ProviderTranslatedText: "反正水是干旱的土地上的",
      TranslatedText: "Bagaimanapun, air akan mengeringkan tanah ini",
    },
    {
      useRomanized: false,
      showProviderTranslations: false,
    }
  );

  assert.equal(line.children.length, 1);
  assert.equal(line.children[0]?.textContent, "Bagaimanapun, air akan mengeringkan tanah ini");
});

test("identical provider and built-in translations render once", () => {
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "どうせ水は乾く土地さ",
      ProviderTranslatedText: "反正水是干旱的土地上的",
      TranslatedText: "反正水是干旱的土地上的",
    },
    {
      useRomanized: false,
      showProviderTranslations: true,
    }
  );

  assert.equal(line.children.length, 1);
  assert.equal(line.children[0]?.lang, "zh-Hans");
});

test("a provider-owned generic alias stays hidden with the provider toggle off", () => {
  const line = new FakeElement();
  appendLineExtras(
    line as unknown as HTMLElement,
    {
      Text: "どうせ水は乾く土地さ",
      ProviderTranslatedText: "反正水是干旱的土地上的",
      TranslatedText: "反正水是干旱的土地上的",
    },
    {
      useRomanized: false,
      showProviderTranslations: false,
    }
  );

  assert.equal(line.children.length, 0);
});
