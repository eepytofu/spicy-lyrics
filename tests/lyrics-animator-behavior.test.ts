import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import Spline from "cubic-spline";
import { easeSinOut } from "d3-ease";
import { Spring } from "../src/modules/Spring.ts";
import * as shared from "../src/utils/Lyrics/Animator/Shared.ts";
import * as extraGradient from "../src/utils/Lyrics/Animator/ExtraGradient.ts";
import * as animatorState from "../src/utils/Lyrics/Animator/Lyrics/AnimatorState.ts";
import { FrameStyleWriter } from "../src/utils/Lyrics/Animator/Lyrics/FrameStyleWriter.ts";

// Constructed behavior fixtures, not linguistic evidence. Execute the complete
// production animator with its real splines, springs, state helpers and writer.
// Only host stores, the virtualizer event source, clock and DOM are substituted.
const animatorCode = ts.transpileModule(
  readFileSync(
    new URL("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }
).outputText;

class Element {
  isConnected = false;
  readonly classes = new Set<string>();
  readonly children: Element[] = [];
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  readonly style = {
    setProperty: (key: string, value: string) => {
      this.writes.push(key);
      this.values.set(key, value);
    },
    removeProperty: (key: string) => {
      this.writes.push(key);
      const previous = this.values.get(key) ?? "";
      this.values.delete(key);
      return previous;
    },
  };
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
  matches(selector: string): boolean {
    return selector.split(",").some((part) => this.classes.has(part.trim().slice(1)));
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(selector === "*" || child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

function store<T>(initial: T) {
  let value = initial;
  const listeners: Array<(value: T) => void> = [];
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      listeners.forEach((listener) => listener(value));
    },
    subscribe: (listener: (value: T) => void) => {
      listeners.push(listener);
      listener(value);
    },
  };
}

function row(start: number, end: number, kind: "word" | "letter" | "dot" = "word") {
  const element = new Element();
  element.classes.add("line");
  const wordElement = new Element();
  const romaji = new Element();
  const ruby = new Element();
  const letterElement = new Element();
  wordElement.children.push(romaji, ruby, ...(kind === "letter" ? [letterElement] : []));
  element.children.push(wordElement);
  const word = {
    StartTime: start,
    EndTime: end,
    HTMLElement: wordElement,
    Dot: kind === "dot",
    LetterGroup: kind === "letter",
    RomajiElement: kind === "dot" ? undefined : romaji,
    TimedRubyAnchorElement: kind === "dot" ? undefined : ruby,
    TimedRubyAnchorOffsetEm: 0.4,
    Letters:
      kind === "letter"
        ? [{ StartTime: start, EndTime: end, HTMLElement: letterElement }]
        : undefined,
  };
  const line = {
    StartTime: start,
    EndTime: end,
    HTMLElement: element,
    HasExtraSidecars: kind !== "dot",
    DotLine: kind === "dot",
    Syllables: { Lead: [word] },
  };
  const wrapper = new Element();
  wrapper.children.push(element);
  return { line, element, wrapper, wordElement, romaji, ruby, letterElement };
}

function harness(type: "Syllable" | "Line", rows: ReturnType<typeof row>[], simple = false) {
  let now = 0;
  let settleRequests = 0;
  type Item = { index: number; element: Element; wrapper: Element };
  type WindowChange = { mounted: Item[]; unmounted: Item[]; mountedIndices: number[] };
  let onWindow: (change: WindowChange) => void = () => {
    throw new Error("missing mount listener");
  };
  let mounted: number[] = [];
  const timers: Array<() => void> = [];
  const dependencies: Record<string, unknown> = {
    "cubic-spline": Spline,
    "d3-ease": { easeSinOut },
    "../../../../utils/stores.ts": {
      $currentLyricsType: store(type),
      $simpleLyricsMode: store(simple),
      $simpleLyricsModeRenderingType: store("calculate"),
    },
    "../../lyrics.ts": {
      LyricsObject: {
        Types: {
          Syllable: { Lines: rows.map((item) => item.line) },
          Line: { Lines: rows.map((item) => item.line) },
        },
      },
      preHiddenDotLineMs: 500,
      SimpleLyricsMode_LetterEffectsStrengthConfig: {},
      requestPausedAnimationSettle: () => {
        settleRequests++;
      },
    },
    "../Shared.ts": shared,
    "../ExtraGradient.ts": extraGradient,
    "./AnimatorState.ts": animatorState,
    "../../LyricsVirtualizer.ts": {
      setOnMountedLyricsWindowChange: (callback: typeof onWindow) => {
        onWindow = callback;
      },
    },
    "../../../../modules/Spring.ts": { Spring },
    "./FrameStyleWriter.ts": { frameStyleWriter: new FrameStyleWriter() },
  };
  const exports: { Animate?: (position: number) => void } = {};
  runInNewContext(animatorCode, {
    exports,
    console,
    require: (name: string) => {
      assert.ok(name in dependencies, `unexpected animator dependency: ${name}`);
      return dependencies[name];
    },
    performance: { now: () => now },
    setTimeout: (callback: () => void) => timers.push(callback),
  });
  const item = (index: number): Item => ({
    index,
    element: rows[index].element,
    wrapper: rows[index].wrapper,
  });
  return {
    mount(indices: number[]) {
      const added = indices.filter((index) => !mounted.includes(index));
      const removed = mounted.filter((index) => !indices.includes(index));
      for (const index of [...added, ...removed]) {
        for (const element of [rows[index].wrapper, ...rows[index].wrapper.querySelectorAll("*")]) {
          element.isConnected = indices.includes(index);
        }
      }
      mounted = indices;
      onWindow({ mounted: added.map(item), unmounted: removed.map(item), mountedIndices: indices });
    },
    frame(position: number, elapsed = 16) {
      now += elapsed;
      exports.Animate!(position);
    },
    get settleRequests() {
      return settleRequests;
    },
  };
}

test("animator paints only the mounted window, including newly mounted active lines", () => {
  const rows = Array.from({ length: 300 }, (_, index) => row(index * 1000, (index + 1) * 1000));
  const visits = rows.map(() => 0);
  rows.forEach((fixture, index) => {
    Object.defineProperty(fixture.line, "HTMLElement", {
      get: () => {
        visits[index]++;
        return fixture.element;
      },
    });
  });
  const animator = harness("Syllable", rows);
  animator.mount([98, 99, 100, 101]);
  assert.equal(rows[100].element.classes.has("NotSung"), true);
  animator.frame(100_500);
  assert.equal(rows[99].element.classes.has("Sung"), true);
  assert.equal(rows[100].element.classes.has("Active"), true);
  assert.equal(rows[101].element.classes.has("NotSung"), true);
  assert.equal(rows[100].wordElement.values.get("--gradient-position"), "40%");
  assert.equal(rows[100].romaji.values.get("--extra-gradient-position"), "30%");
  assert.equal(rows[200].wordElement.writes.length, 0);
  assert.equal(visits[200], 0, "off-window rows are not scanned to check their connection");
  assert.deepEqual([...rows[200].element.classes], ["line"]);
  animator.mount([198, 199, 200, 201]);
  const previousVisits = visits[100];
  animator.frame(200_500);
  assert.equal(rows[200].element.classes.has("Active"), true);
  assert.equal(rows[200].wordElement.values.get("--gradient-position"), "40%");
  assert.equal(visits[100], previousVisits, "the previous window is no longer visited");
  assert.equal(animator.settleRequests, 2);
});

for (const simple of [false, true]) {
  test(`remounted words, letters and ruby reset after forward/backward seeks (simple=${simple})`, () => {
    const rows = [row(1000, 2000), row(2000, 3000, "letter"), row(3000, 4000, "dot")];
    const animator = harness("Syllable", rows, simple);
    animator.mount([0, 1, 2]);
    animator.frame(5000);
    const gradient = simple ? "--SLM_GradientPosition" : "--gradient-position";
    assert.equal(rows[0].wordElement.values.get(gradient), "100%");
    assert.equal(rows[1].letterElement.values.get(gradient), "100%");
    assert.equal(rows[0].ruby.values.get("--timed-furigana-gradient-position"), "100%");
    assert.equal(rows[2].wordElement.values.get("opacity"), "1");
    animator.mount([]);
    const previousWrites = rows[0].wordElement.writes.length;
    animator.frame(0);
    assert.equal(rows[0].wordElement.writes.length, previousWrites);
    animator.mount([0, 1, 2]);
    animator.frame(0);
    assert.equal(rows[0].wordElement.values.get(gradient), simple ? "-50%" : "-20%");
    assert.equal(rows[1].letterElement.values.get(gradient), simple ? "-50%" : "-20%");
    assert.equal(rows[0].romaji.values.get("--extra-gradient-position"), simple ? "-50%" : "-40%");
    assert.equal(
      rows[0].ruby.values.get("--timed-furigana-gradient-position"),
      simple ? "-50%" : "-20%"
    );
    assert.equal(rows[2].wordElement.values.get("opacity"), simple ? "0.27" : "0.35");
    for (const fixture of rows) assert.equal(fixture.element.classes.has("NotSung"), true);
  });
}

test("remount invalidates cached paint even when the timeline state is unchanged", () => {
  const rows = [row(1000, 2000)];
  const animator = harness("Syllable", rows);
  animator.mount([0]);
  animator.frame(0);
  animator.mount([]);
  rows[0].wordElement.values.clear();
  animator.mount([0]);
  animator.frame(0);
  assert.equal(rows[0].wordElement.values.get("--gradient-position"), "-20%");
  const writes = rows[0].wordElement.writes.length;
  animator.frame(0);
  assert.equal(
    rows[0].wordElement.writes.length,
    writes,
    "settled unchanged frames do not repaint words"
  );
});

test("line-timed sidecars and glow settle across multiline seeks and window teardown", () => {
  const rows = [row(0, 1000), row(1000, 2000), row(2000, 3000)];
  const animator = harness("Line", rows);
  animator.mount([0, 1, 2]);
  animator.frame(500);
  assert.equal(rows[0].element.values.get("--gradient-position"), "50%");
  animator.frame(1500);
  assert.equal(rows[0].element.classes.has("Sung"), true);
  assert.equal(rows[0].element.values.get("--extra-gradient-position"), "100%");
  assert.equal(rows[0].element.values.get("--text-shadow-opacity"), "0%");
  assert.equal(rows[1].element.classes.has("Active"), true);
  assert.equal(rows[1].element.values.get("--extra-gradient-position"), "30%");
  assert.equal(rows[2].element.values.get("--extra-gradient-position"), "-40%");
  animator.frame(500);
  assert.equal(rows[1].element.classes.has("NotSung"), true);
  assert.equal(rows[1].element.values.get("--text-shadow-opacity"), "0%");
  animator.mount([]);
  const writes = rows.map((fixture) => fixture.element.writes.length);
  animator.frame(2500);
  assert.deepEqual(
    rows.map((fixture) => fixture.element.writes.length),
    writes
  );
});
