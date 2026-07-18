import assert from "node:assert/strict";
import { test } from "node:test";

class FakeClassList {
  readonly values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
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
  style = { marginLeft: "" };
  textContent = "";
  lang = "";

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
    .filter((child) => child.className.includes("furigana-reading") && child.textContent === "せい");
  assert.equal(renderedReadings.length, 1);
});

test("adjacent ruby clusters are packed while isolated ruby can overhang", () => {
  const adjacent = new FakeElement();
  appendFuriganaText(adjacent as unknown as HTMLElement, "極星", [
    { start: 0, end: 1, reading: "きょく" },
    { start: 1, end: 2, reading: "ぼし" },
  ]);
  assert.equal(adjacent.children.length, 2);
  assert.equal(adjacent.children.every((cluster) => cluster.classList.values.has("furigana-cluster-packed")), true);

  const isolated = new FakeElement();
  appendFuriganaText(isolated as unknown as HTMLElement, "極の星", [
    { start: 0, end: 1, reading: "きょく" },
    { start: 2, end: 3, reading: "ほし" },
  ]);
  assert.equal(isolated.children.some((cluster) => cluster.classList.values.has("furigana-cluster-packed")), false);
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
