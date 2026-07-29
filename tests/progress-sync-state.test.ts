import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialLocalPositionSyncState,
  resolveLocalPositionSample,
} from "../src/utils/Gets/ProgressSyncState.ts";

const playerState = (positionAsOfTimestamp: number, timestamp: number) => ({
  positionAsOfTimestamp,
  timestamp,
});

test("repeated local samples keep their first playing anchor", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 5000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 5000),
  });
  const repeated = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 5200,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 5000),
  });

  assert.deepEqual(repeated.position, { StartedSyncAt: 5000, Position: 1000 });
  assert.equal(repeated.stateJumped, false);
});

test("new local samples and pauses refresh the anchor", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 5000,
    trackUri: "spotify:track:a",
    isPlaying: true,
  });
  const advanced = resolveLocalPositionSample(first.state, {
    sampledPosition: 1100,
    sampledAt: 5100,
    trackUri: "spotify:track:a",
    isPlaying: true,
  });
  const paused = resolveLocalPositionSample(advanced.state, {
    sampledPosition: 1100,
    sampledAt: 9000,
    trackUri: "spotify:track:a",
    isPlaying: false,
  });

  assert.deepEqual(advanced.position, { StartedSyncAt: 5100, Position: 1100 });
  assert.deepEqual(paused.position, { StartedSyncAt: 9000, Position: 1100 });
});

test("a same-position track change cannot inherit the old anchor", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 0,
    sampledAt: 1000,
    trackUri: "spotify:track:a",
    isPlaying: true,
  });
  const nextTrack = resolveLocalPositionSample(first.state, {
    sampledPosition: 0,
    sampledAt: 8000,
    trackUri: "spotify:track:b",
    isPlaying: true,
  });

  assert.deepEqual(nextTrack.position, { StartedSyncAt: 8000, Position: 0 });
});

test("a playback-state discontinuity invalidates a repeated sample once", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 5000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 5000),
  });
  const sought = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 5100,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(5000, 5100),
  });
  const stable = resolveLocalPositionSample(sought.state, {
    sampledPosition: 1000,
    sampledAt: 5200,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(5000, 5100),
  });

  assert.equal(sought.stateJumped, true);
  assert.equal(sought.position.StartedSyncAt, 5100);
  assert.equal(stable.stateJumped, false);
  assert.equal(stable.position.StartedSyncAt, 5100);
});
