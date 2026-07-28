import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createInterludeLine,
  interludeDotWindows,
} from "../src/utils/Lyrics/Applyer/Synced/Interlude.ts";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classNames = new Set<string>();
  readonly tagName: string;
  textContent = "";
  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classNames.add(name)),
  };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

test("interlude timing retains the three-dot attack window and pre-hide padding", () => {
  assert.deepEqual(interludeDotWindows(2, 5, -550), [
    { startTime: 2000, endTime: 2816.6666666666665 },
    { startTime: 2816.6666666666665, endTime: 3633.3333333333335 },
    { startTime: 3633.3333333333335, endTime: 4450 },
  ]);
  assert.deepEqual(interludeDotWindows(0, 0.3, -550), [
    { startTime: 0, endTime: 0 },
    { startTime: 0, endTime: 0 },
    { startTime: 0, endTime: 0 },
  ]);
});

test("line and syllable applyers delegate interlude DOM construction", () => {
  for (const relativePath of [
    "../src/utils/Lyrics/Applyer/Synced/Line.ts",
    "../src/utils/Lyrics/Applyer/Synced/Syllable.ts",
  ]) {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    assert.match(source, /createInterludeLine/u);
    assert.doesNotMatch(source, /musicalDots/u);
    assert.doesNotMatch(source, /classList\.add\("dotGroup"\)/u);
  }
});

test("interlude builder emits the stable line, group, dots, and timing registrations", () => {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tagName: string) => new FakeElement(tagName),
    },
  });

  try {
    const interlude = createInterludeLine(2, 5, true, -550);
    const element = interlude.element as unknown as FakeElement;
    assert.deepEqual([...element.classNames], ["line", "musical-line", "OppositeAligned"]);
    assert.equal(element.children.length, 1);
    assert.deepEqual([...element.children[0].classNames], ["dotGroup"]);
    assert.deepEqual(
      element.children[0].children.map((dot) => ({
        tagName: dot.tagName,
        classes: [...dot.classNames],
        text: dot.textContent,
      })),
      Array.from({ length: 3 }, () => ({
        tagName: "span",
        classes: ["word", "dot"],
        text: "•",
      })),
    );
    assert.deepEqual(interlude.line, {
      HTMLElement: interlude.element,
      StartTime: 2000,
      EndTime: 5000,
      TotalTime: 3000,
      DotLine: true,
    });
    assert.deepEqual(
      interlude.dots.map(({ StartTime, EndTime, TotalTime, Dot }) => ({
        StartTime,
        EndTime,
        TotalTime,
        Dot,
      })),
      [
        { StartTime: 2000, EndTime: 2816.6666666666665, TotalTime: 816.6666666666665, Dot: true },
        { StartTime: 2816.6666666666665, EndTime: 3633.3333333333335, TotalTime: 816.666666666667, Dot: true },
        { StartTime: 3633.3333333333335, EndTime: 4450, TotalTime: 816.6666666666665, Dot: true },
      ],
    );
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
});
