import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FrameStyleWriter,
  type StyleDeclarationTarget,
} from "../src/utils/Lyrics/Animator/Lyrics/FrameStyleWriter.ts";

class FakeStyleTarget implements StyleDeclarationTarget {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  readonly style = {
    setProperty: (property: string, value: string): void => {
      this.writes.push(`set:${property}:${value}`);
      this.values.set(property, value);
    },
    removeProperty: (property: string): string => {
      this.writes.push(`remove:${property}`);
      const previous = this.values.get(property) ?? "";
      this.values.delete(property);
      return previous;
    },
  };
}

test("frame style writes collapse repeated properties into one flush", () => {
  const writer = new FrameStyleWriter<FakeStyleTarget>();
  const target = new FakeStyleTarget();

  writer.set(target, "opacity", "0.4");
  writer.set(target, "opacity", "0.8");
  writer.set(target, "scale", "1");
  assert.deepEqual(target.writes, []);

  writer.flush();
  assert.deepEqual(target.writes, ["set:opacity:0.8", "set:scale:1"]);
});

test("frame style cache skips equal and epsilon-equivalent values", () => {
  const writer = new FrameStyleWriter<FakeStyleTarget>();
  const target = new FakeStyleTarget();

  writer.set(target, "--progress", "40%", 0.5);
  writer.flush();
  writer.set(target, "--progress", "40.4%", 0.5);
  writer.flush();
  writer.set(target, "--progress", "41%", 0.5);
  writer.flush();

  assert.deepEqual(target.writes, ["set:--progress:40%", "set:--progress:41%"]);
});

test("remove and immediate transitions stay coherent with queued state", () => {
  const writer = new FrameStyleWriter<FakeStyleTarget>();
  const target = new FakeStyleTarget();

  writer.set(target, "animation", "queued");
  writer.setImmediate(target, "animation", "running");
  writer.flush();
  writer.remove(target, "animation");
  writer.flush();
  writer.remove(target, "animation");
  writer.flush();

  assert.deepEqual(target.writes, ["set:animation:running", "remove:animation"]);
});

test("invalidating an element discards stale queued and cached state", () => {
  const writer = new FrameStyleWriter<FakeStyleTarget>();
  const target = new FakeStyleTarget();

  writer.set(target, "opacity", "0.5");
  writer.invalidate(target);
  writer.flush();
  writer.set(target, "opacity", "0.5");
  writer.flush();

  assert.deepEqual(target.writes, ["set:opacity:0.5"]);
});
