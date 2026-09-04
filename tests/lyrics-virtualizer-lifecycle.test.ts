import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as scrollPolicy from "../src/utils/Lyrics/LyricsScrollPolicy.ts";

// Constructed lifecycle fixtures. The production virtualizer adapter and Maid
// execute unchanged; deterministic platform boundaries supply geometry, events,
// clocks and TanStack notifications (not its internal range algorithm).
function compile(path: string): string {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
}
const virtualizerCode = compile("../src/utils/Lyrics/LyricsVirtualizer.ts");
const maidCode = compile("../src/modules/Maid.ts");

class Events {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(name: string, callback: () => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(callback);
  }
  removeEventListener(name: string, callback: () => void) {
    this.listeners.get(name)?.delete(callback);
  }
  emit(name: string) {
    for (const callback of this.listeners.get(name) ?? []) callback();
  }
}

class Element extends Events {
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    contains: (name: string) => this.classes.has(name),
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  readonly children: Element[] = [];
  parentElement: Element | null = null;
  root = false;
  clientWidth = 1000;
  clientHeight = 600;
  scrollTop = 0;
  get offsetWidth() {
    return this.clientWidth;
  }
  get offsetHeight() {
    return this.clientHeight;
  }
  get isConnected(): boolean {
    return this.root || !!this.parentElement?.isConnected;
  }
  getBoundingClientRect() {
    return { top: -(this.parentElement?.scrollTop ?? 0) };
  }
  scrollTo({ top }: { top: number }) {
    this.scrollTop = top;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child: Element) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: Element) {
    assert.equal(child.parentElement, this);
    this.children.splice(this.children.indexOf(child), 1);
    child.parentElement = null;
    return child;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
}

class Observer {
  disconnected = false;
  readonly callback: (entries: unknown[]) => void;
  constructor(callback: (entries: unknown[]) => void) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

type Item = { index: number; start: number; size: number };
type Options = {
  count: number;
  onChange: (v: Engine) => void;
  getScrollElement: () => Element;
  measureElement: (element: Element) => number;
};
class Engine {
  items: Item[] = [
    { index: 0, start: 0, size: 100 },
    { index: 1, start: 100, size: 100 },
  ];
  scrollRect = { width: 1000, height: 600 };
  scrollOffset = 0;
  updates = 0;
  cleanups = 0;
  shouldAdjustScrollPositionOnItemSizeChange?: () => boolean;
  readonly measurementsCache: Array<{ start: number; size: number }>;
  readonly measurements: Element[] = [];
  onMeasure?: () => void;
  readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.measurementsCache = Array.from({ length: options.count }, (_, index) => ({
      start: index * 100,
      size: 600,
    }));
  }
  _willUpdate() {
    this.updates++;
    this.options.onChange(this);
  }
  get scrollElement() {
    return this.options.getScrollElement();
  }
  _cleanup() {
    this.cleanups++;
  }
  getTotalSize() {
    return this.options.count * 100;
  }
  getVirtualItems() {
    return this.items;
  }
  measureElement(element: Element) {
    this.measurements.push(element);
    this.options.measureElement(element);
    const callback = this.onMeasure;
    this.onMeasure = undefined;
    callback?.();
  }
  window(indices: number[]) {
    this.items = indices.map((index) => ({ index, start: index * 100, size: 100 }));
    this.options.onChange(this);
  }
}

type WindowChange = {
  mounted: Array<{ index: number; element: Element; wrapper: Element }>;
  unmounted: Array<{ index: number; element: Element; wrapper: Element }>;
  mountedIndices: number[];
};
type API = {
  initLyricsVirtualizer: (scroll: Element, container: Element, lines: Element[]) => void;
  destroyLyricsVirtualizer: () => void;
  getLyricsVirtualizer: () => Engine | null;
  setOnMountedLyricsWindowChange: (callback: (change: WindowChange) => void) => void;
  scrollLyricsToIndex: (index: number, align: "center", instant: boolean) => void;
};

function harness() {
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const document = Object.assign(new Events(), {
    hidden: false,
    createElement: () => new Element(),
  });
  const platform = {
    Element,
    MutationObserver: Observer,
    ResizeObserver: Observer,
    document,
    console,
    requestAnimationFrame: (callback: () => void) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => {
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => {
      assert.equal(delay, 250, "keep the self-heal interval");
      const id = ++sequence;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => intervals.delete(id),
  };
  const maidExports = {};
  runInNewContext(maidCode, {
    ...platform,
    exports: maidExports,
    require: (name: string) => {
      assert.equal(name, "./Scheduler");
      return { IsScheduled: () => false };
    },
  });
  const exports = {} as API;
  const dependencies: Record<string, unknown> = {
    "@tanstack/virtual-core": {
      Virtualizer: Engine,
      elementScroll() {},
      observeElementRect() {},
      observeElementOffset() {},
    },
    "../../modules/Maid.ts": maidExports,
    "../Logger.ts": class {
      debug() {}
      info() {}
    },
    "./LyricsScrollPolicy.ts": scrollPolicy,
  };
  runInNewContext(virtualizerCode, {
    ...platform,
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const events: WindowChange[] = [];
  exports.setOnMountedLyricsWindowChange((change) => events.push(change));
  function init() {
    const scroll = new Element();
    scroll.root = true;
    const container = new Element();
    scroll.appendChild(container);
    const lines = Array.from({ length: 6 }, () => {
      const el = new Element();
      el.classes.add("line");
      return el;
    });
    exports.initLyricsVirtualizer(scroll, container, lines);
    return { scroll, container, lines, engine: exports.getLyricsVirtualizer()! };
  }
  function flushFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  }
  return { ...exports, init, events, frames, timers, intervals, document, flushFrame };
}

test("virtualizer publishes connected mount deltas, preserves wrapper identity and avoids no-op events", () => {
  const h = harness();
  const { engine, lines } = h.init();
  assert.deepEqual(Array.from(h.events[0].mountedIndices), [0, 1]);
  const first = h.events[0].mounted[0];
  assert.equal(first.element, lines[0]);
  assert.equal(first.wrapper.isConnected, true);
  assert.equal(first.wrapper.children[0], first.element);
  const initialEvents = h.events.length;
  engine.window([0, 1]);
  assert.equal(h.events.length, initialEvents);
  lines[0].classes.add("Active");
  engine.window([1, 2]);
  const changed = h.events.at(-1)!;
  assert.deepEqual(
    Array.from(changed.mounted, (item) => item.index),
    [2]
  );
  assert.deepEqual(
    Array.from(changed.unmounted, (item) => item.index),
    [0]
  );
  assert.equal(changed.unmounted[0].wrapper.isConnected, false);
  assert.equal(lines[0].classes.has("Active"), true, "animator owns timeline classes");
  engine.window([0, 1]);
  assert.equal(h.events.at(-1)!.mounted[0].wrapper, first.wrapper);
  h.destroyLyricsVirtualizer();
});

test("replacement rejects old engine notifications and retains the mounted-window subscriber", () => {
  const h = harness();
  const old = h.init();
  const current = h.init();
  assert.equal(old.engine.cleanups, 1);
  assert.deepEqual(Array.from(h.events[1].mountedIndices), []);
  assert.deepEqual(
    Array.from(h.events[1].unmounted, (item) => item.index),
    [0, 1]
  );
  const eventCount = h.events.length;
  old.engine.window([4, 5]);
  assert.equal(h.events.length, eventCount);
  assert.equal(current.container.children.length, 2);
  current.engine.window([2, 3]);
  assert.equal(h.events.length, eventCount + 1);
  h.destroyLyricsVirtualizer();
  assert.equal(h.getLyricsVirtualizer(), null);
  assert.equal(current.container.children.length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(current.scroll.listeners.get("scroll")?.size, 0);
  assert.equal(h.document.listeners.get("visibilitychange")?.size, 0);
});

test("synchronous measure notifications rerun using the latest window without duplicate mounts", () => {
  const h = harness();
  const { engine, container } = h.init();
  engine.onMeasure = () => engine.window([3, 4]);
  engine.window([1, 2]);
  assert.deepEqual(container.children.map((el) => el.getAttribute("data-index")).sort(), [
    "3",
    "4",
  ]);
  assert.deepEqual(Array.from(h.events.at(-1)!.mountedIndices), [3, 4]);
  h.destroyLyricsVirtualizer();
});

test("visibility recovery repairs a stale zero viewport without changing hidden measurements", () => {
  const h = harness();
  const { engine } = h.init();
  h.flushFrame();
  h.flushFrame();
  engine.scrollRect = { width: 0, height: 0 };
  h.document.hidden = true;
  for (const callback of h.intervals.values()) callback();
  assert.deepEqual(engine.scrollRect, { width: 0, height: 0 });
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  h.flushFrame();
  assert.equal(engine.scrollRect.width, 1000);
  assert.equal(engine.scrollRect.height, 600);
  h.destroyLyricsVirtualizer();
});

for (const initFramesElapsed of [0, 1]) {
  test(`old init and visibility frames cannot affect replacement lyrics after ${initFramesElapsed} frames`, () => {
    const h = harness();
    h.init();
    if (initFramesElapsed) h.flushFrame();
    h.document.emit("visibilitychange");
    const oldCallbacks = [...h.frames.values()];
    const current = h.init();
    const measurements = current.engine.measurements.length;
    const pendingFrames = h.frames.size;
    for (const callback of oldCallbacks) callback();
    assert.equal(
      current.engine.measurements.length,
      measurements,
      "stale recovery must not remeasure the replacement"
    );
    assert.equal(h.frames.size, pendingFrames, "stale init must not enqueue its second frame");
    h.destroyLyricsVirtualizer();
    assert.equal(h.frames.size, 0, "destroy cancels all lifecycle-owned frames");
  });
}

test("repeated visibility notifications share one pending recovery frame", () => {
  const h = harness();
  const { engine } = h.init();
  h.flushFrame();
  h.flushFrame();
  h.document.emit("visibilitychange");
  h.document.emit("visibilitychange");
  h.document.emit("visibilitychange");
  assert.equal(h.frames.size, 1);
  const measurements = engine.measurements.length;
  h.flushFrame();
  assert.equal(engine.measurements.length - measurements, 2);
  h.destroyLyricsVirtualizer();
});

test("a stale scroll retry cannot clear the replacement's convergence or frame handle", () => {
  const h = harness();
  h.init();
  h.flushFrame();
  h.flushFrame();
  h.scrollLyricsToIndex(4, "center", true);
  const oldCallbacks = [...h.frames.values()];
  const current = h.init();
  h.flushFrame();
  h.flushFrame();
  h.scrollLyricsToIndex(4, "center", true);
  assert.equal(current.engine.shouldAdjustScrollPositionOnItemSizeChange?.(), false);
  for (const callback of oldCallbacks) callback();
  assert.equal(current.engine.shouldAdjustScrollPositionOnItemSizeChange?.(), false);
  h.destroyLyricsVirtualizer();
  assert.equal(h.frames.size, 0);
});
