import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLyricsSourceOrder,
  normalizeLyricsServerUrl,
  parseCustomLyricsServers,
} from "../src/utils/Lyrics/LyricsSourcePreferences.ts";

test("source order retains valid custom servers and restores built-ins", () => {
  const custom = parseCustomLyricsServers('[{"id":"custom:one","name":"One","url":"https://one.example/api"}]');
  const order = normalizeLyricsSourceOrder('["custom:one","qq","spicy","unknown"]', custom);
  assert.deepEqual(order.slice(0, 3), ["custom:one", "qq", "spicy"]);
  assert.ok(order.includes("musixmatch"));
  assert.ok(!order.includes("unknown" as any));
});

test("server URLs require HTTPS except for local development", () => {
  assert.equal(normalizeLyricsServerUrl("https://worker.example/"), "https://worker.example");
  assert.equal(normalizeLyricsServerUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeLyricsServerUrl("http://worker.example"), null);
  assert.deepEqual(
    parseCustomLyricsServers('[{"id":"custom:unsafe","name":"Unsafe","url":"http://worker.example"}]'),
    []
  );
});
