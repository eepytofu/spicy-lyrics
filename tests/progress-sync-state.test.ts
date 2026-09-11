import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialLocalPositionSyncState,
  LOCAL_SOURCE_RECOVERY_STREAK,
  LOCAL_SOURCE_STALL_TIMEOUT,
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

test("a stalled local source switches to timestamped player state", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 10_000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 10_000),
  });
  const threshold = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 10_000 + LOCAL_SOURCE_STALL_TIMEOUT,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1500, 10_000 + LOCAL_SOURCE_STALL_TIMEOUT),
  });
  const stalled = resolveLocalPositionSample(threshold.state, {
    sampledPosition: 1000,
    sampledAt: 10_000 + LOCAL_SOURCE_STALL_TIMEOUT + 1,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(5000, 10_000 + LOCAL_SOURCE_STALL_TIMEOUT + 1),
  });
  const advanced = resolveLocalPositionSample(stalled.state, {
    sampledPosition: 1000,
    sampledAt: 11_501,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(5000, 10_501),
  });

  assert.deepEqual(threshold.position, { StartedSyncAt: 10_000, Position: 1000 });
  assert.deepEqual(stalled.position, { StartedSyncAt: 10_501, Position: 5000 });
  assert.deepEqual(advanced.position, { StartedSyncAt: 11_501, Position: 6000 });
  assert.equal(stalled.state.rawSource?.usingPlaybackState, true);
});

test("three fresh local samples recover from the timestamped fallback", () => {
  let result = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 10_000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 10_000),
  });
  result = resolveLocalPositionSample(result.state, {
    sampledPosition: 1000,
    sampledAt: 10_501,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1501, 10_501),
  });

  for (let index = 1; index <= LOCAL_SOURCE_RECOVERY_STREAK; index += 1) {
    result = resolveLocalPositionSample(result.state, {
      sampledPosition: 1000 + index * 16,
      sampledAt: 10_501 + index * 16,
      trackUri: "spotify:track:a",
      isPlaying: true,
      playerState: playerState(1501 + index * 16, 10_501 + index * 16),
    });
    assert.equal(
      result.state.rawSource?.usingPlaybackState,
      index < LOCAL_SOURCE_RECOVERY_STREAK,
    );
  }

  assert.deepEqual(result.position, { StartedSyncAt: 10_549, Position: 1048 });
});

test("pause time does not create a stall and preserves fallback hysteresis", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 10_000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 10_000),
  });
  const fallback = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 10_501,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1501, 10_501),
  });
  const paused = resolveLocalPositionSample(fallback.state, {
    sampledPosition: 1000,
    sampledAt: 70_501,
    trackUri: "spotify:track:a",
    isPlaying: false,
    playerState: playerState(1501, 10_501),
  });
  const resumed = resolveLocalPositionSample(paused.state, {
    sampledPosition: 1016,
    sampledAt: 70_517,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1517, 70_517),
  });

  assert.equal(paused.state.rawSource?.usingPlaybackState, true);
  assert.equal(paused.state.rawSource?.lastChangeAt, 70_501);
  assert.equal(resumed.state.rawSource?.usingPlaybackState, true);
  assert.deepEqual(resumed.position, { StartedSyncAt: 70_517, Position: 1517 });
});

test("an unavailable player state keeps the extrapolating local anchor", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 10_000,
    trackUri: "spotify:track:a",
    isPlaying: true,
  });
  const stalled = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 10_501,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(Number.NaN, 10_501),
  });

  assert.equal(stalled.state.rawSource?.usingPlaybackState, true);
  assert.deepEqual(stalled.position, { StartedSyncAt: 10_000, Position: 1000 });
});

test("a track change resets a selected timestamped fallback", () => {
  const first = resolveLocalPositionSample(initialLocalPositionSyncState(), {
    sampledPosition: 1000,
    sampledAt: 10_000,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1000, 10_000),
  });
  const fallback = resolveLocalPositionSample(first.state, {
    sampledPosition: 1000,
    sampledAt: 10_501,
    trackUri: "spotify:track:a",
    isPlaying: true,
    playerState: playerState(1501, 10_501),
  });
  const nextTrack = resolveLocalPositionSample(fallback.state, {
    sampledPosition: 1000,
    sampledAt: 20_000,
    trackUri: "spotify:track:b",
    isPlaying: true,
    playerState: playerState(1000, 20_000),
  });

  assert.equal(fallback.state.rawSource?.usingPlaybackState, true);
  assert.equal(nextTrack.state.rawSource?.usingPlaybackState, false);
  assert.deepEqual(nextTrack.position, { StartedSyncAt: 20_000, Position: 1000 });
});
