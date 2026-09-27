import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isPositionSampleCurrent } from "../src/utils/Gets/ProgressSyncState.ts";

test("a synced position belongs only to the track that requested it", () => {
  const sample = {
    StartedSyncAt: 100,
    Position: 200,
    TrackUri: "spotify:track:old",
  };
  assert.equal(isPositionSampleCurrent(sample, "spotify:track:old"), true);
  assert.equal(isPositionSampleCurrent(sample, "spotify:track:new"), false);
  assert.equal(isPositionSampleCurrent({ StartedSyncAt: 100, Position: 200 }, null), false);
});

test("interval restarts retain one destruction cleanup", async () => {
  const source = await readFile("src/utils/IntervalManager.ts", "utf8");
  assert.equal(source.match(/this\.maid\.Give\(\(\) => this\.Stop\(\)\)/g)?.length, 1);
});
