import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricsCandidateSessionStore } from "../src/utils/Lyrics/LyricsCandidateSession.ts";

test("candidate sessions are bounded by uri, source signature, and expiry", () => {
  const store = new LyricsCandidateSessionStore<{ provider: string }, { kind: string }>();
  store.set(
    {
      uri: "spotify:track:one",
      signature: "sources:a",
      records: [{ provider: "qq" }],
      failures: [],
      recommendedRevisionId: "recommended",
      automaticRevisionId: "auto",
      activeRevisionId: "auto",
      alternativesLoaded: true,
      searchOverrides: { title: "忘却の翼", artist: "霜月はるか" },
    },
    1_000
  );

  assert.equal(store.get("spotify:track:one", "sources:a", 1_001)?.records[0].provider, "qq");
  assert.equal(
    store.get("spotify:track:one", "sources:a", 1_001)?.recommendedRevisionId,
    "recommended",
  );
  assert.deepEqual(
    store.get("spotify:track:one", "sources:a", 1_001)?.searchOverrides,
    { title: "忘却の翼", artist: "霜月はるか" },
  );
  assert.equal(store.get("spotify:track:two", "sources:a", 1_001), null);
  assert.equal(store.get("spotify:track:one", "sources:b", 1_001), null);
  assert.equal(store.get("spotify:track:one", "sources:a", 301_000), null);
});

test("candidate sessions clone caller and reader state", () => {
  const store = new LyricsCandidateSessionStore<{ provider: string }, never>();
  const records = [{ provider: "qq" }];
  store.set(
    {
      uri: "spotify:track:one",
      signature: "sources:a",
      records,
      failures: [],
      recommendedRevisionId: "recommended",
      automaticRevisionId: "auto",
      activeRevisionId: "auto",
      alternativesLoaded: false,
      searchOverrides: null,
    },
    1_000
  );
  records[0].provider = "mutated";
  const first = store.get("spotify:track:one", "sources:a", 1_001)!;
  first.records[0].provider = "reader mutation";

  assert.equal(store.get("spotify:track:one", "sources:a", 1_002)?.records[0].provider, "qq");
  store.setActiveRevision("spotify:track:one", "manual");
  assert.equal(store.get("spotify:track:one", "sources:a", 1_003)?.activeRevisionId, "manual");
  store.clearForTrackChange("spotify:track:two");
  assert.equal(store.get("spotify:track:one", "sources:a", 1_004), null);
});
