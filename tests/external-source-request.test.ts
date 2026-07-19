import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_WORKER_REQUEST_VERSION,
  externalSourceRequestUrl,
} from "../src/utils/Lyrics/ExternalSourceRequest.ts";

const info = {
  id: "spotify:id/with spaces",
  title: "Collaboration (DJ版)",
  artist: "Lead, Guest",
  artists: ["Lead", "Guest"],
  album: "Collaboration",
  durationMs: 202_000,
};

test("Worker requests carry a cache-busting contract version and every artist", () => {
  const url = new URL(externalSourceRequestUrl("https://worker.example/", info, "kugou"));

  assert.equal(url.pathname, "/v1/lyrics/kugou/spotify%3Aid%2Fwith%20spaces");
  assert.deepEqual(url.searchParams.getAll("artist_name"), ["Lead", "Guest"]);
  assert.equal(url.searchParams.get("request_version"), String(EXTERNAL_WORKER_REQUEST_VERSION));
});

test("custom lyric servers keep their existing unversioned request contract", () => {
  const url = new URL(externalSourceRequestUrl("https://custom.example/v1/", info));

  assert.equal(url.pathname, "/v1/spotify%3Aid%2Fwith%20spaces");
  assert.equal(url.searchParams.has("request_version"), false);
});
