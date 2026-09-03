import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearAllLyricsCaches,
  clearCurrentLyricsCaches,
  type LyricsCacheLifecycleDependencies,
} from "../src/utils/Lyrics/LyricsCacheLifecycle.ts";

function lifecycleDependencies(
  calls: string[],
  revisionIds: string[] = [],
): LyricsCacheLifecycleDependencies {
  return {
    async removeProcessed(trackId) {
      calls.push(`processed:${trackId}`);
    },
    async clearProcessed() {
      calls.push("processed:all");
    },
    async removeRevision(revisionId) {
      calls.push(`revision:${revisionId}`);
    },
    async clearRevisions() {
      calls.push("revision:all");
    },
    async resetCandidate(trackUri) {
      calls.push(`candidate:${trackUri}`);
      return { affected: revisionIds.length > 0, revisionIds };
    },
    async resetCandidates() {
      calls.push("candidate:all");
      return ["spotify:track:one"];
    },
    async clearLegacySelection(trackUri) {
      calls.push(`legacy:${trackUri}`);
    },
    clearCandidateSession(trackUri) {
      calls.push(`session:${trackUri ?? "all"}`);
    },
  };
}

test("current-song clearing resets its candidate before evicting only referenced cache entries", async () => {
  const calls: string[] = [];
  await clearCurrentLyricsCaches(
    "track-one",
    "spotify:track:track-one",
    lifecycleDependencies(calls, ["selected-revision", "automatic-revision"]),
  );

  assert.deepEqual(calls.slice(0, 2), [
    "candidate:spotify:track:track-one",
    "session:spotify:track:track-one",
  ]);
  assert.deepEqual(
    new Set(calls.slice(2)),
    new Set([
      "processed:track-one",
      "legacy:spotify:track:track-one",
      "revision:selected-revision",
      "revision:automatic-revision",
    ]),
  );
  assert.equal(calls.includes("processed:all"), false);
  assert.equal(calls.includes("revision:all"), false);
});

test("current-song clearing still removes processed and legacy state without a candidate", async () => {
  const calls: string[] = [];
  await clearCurrentLyricsCaches(
    "track-one",
    "spotify:track:track-one",
    lifecycleDependencies(calls),
  );

  assert.equal(calls.some((call) => call.startsWith("revision:")), false);
  assert.ok(calls.includes("processed:track-one"));
  assert.ok(calls.includes("legacy:spotify:track:track-one"));
});

test("clear-all resets candidates and sessions before destroying processed and revision caches", async () => {
  const calls: string[] = [];
  await clearAllLyricsCaches(lifecycleDependencies(calls));

  assert.deepEqual(calls.slice(0, 2), ["candidate:all", "session:all"]);
  assert.deepEqual(
    new Set(calls.slice(2)),
    new Set(["processed:all", "revision:all"]),
  );
  assert.equal(calls.some((call) => call.startsWith("legacy:")), false);
});
