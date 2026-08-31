import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LYRICS_SOURCE_ORDER,
  getLyricsSourceDefinition,
  normalizeLyricsSourceOrder,
  normalizeLyricsServerUrl,
  parseCustomLyricsServers,
  resolveLyricsSourceLabel,
} from "../src/utils/Lyrics/LyricsSourcePreferences.ts";

test("default source priority ends with Spotify then LRCLIB", () => {
  assert.deepEqual(DEFAULT_LYRICS_SOURCE_ORDER.slice(-2), ["spotify", "lrclib"]);
  assert.deepEqual(normalizeLyricsSourceOrder("[]").slice(-2), ["spotify", "lrclib"]);
});

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

test("external provider labels use canonical service names", () => {
  assert.equal(getLyricsSourceDefinition("qq", []).label, "QQ Music");
  assert.equal(getLyricsSourceDefinition("kugou", []).label, "KuGou");
  assert.equal(getLyricsSourceDefinition("netease", []).label, "NetEase Cloud Music");
  assert.equal(getLyricsSourceDefinition("soda", []).label, "Soda Music");
  assert.equal(resolveLyricsSourceLabel("netease", "NetEase", "netease"), "NetEase Cloud Music");
  assert.equal(resolveLyricsSourceLabel("kugou", "Kugou", "kugou"), "KuGou");
  assert.equal(resolveLyricsSourceLabel("soda", "Qishui", "soda"), "Soda Music");
  assert.equal(resolveLyricsSourceLabel("qq", "Spicy Lyrics (qq)", "spicy"), "Spicy Lyrics (qq)");
  assert.equal(resolveLyricsSourceLabel("qq", "Untrusted label", "qq"), "QQ Music");
});

test("provider descriptions use canonical timing tier names", () => {
  const providers = ["musixmatch", "lrclib", "amlldb", "qq", "kugou", "netease", "soda"] as const;
  const descriptions = providers.map(
    (provider) => getLyricsSourceDefinition(provider, []).description
  );
  assert.ok(descriptions.every((description) => !/(?:word|syllable|line)-synced|plain lyrics/iu.test(description)));
  assert.match(descriptions.join(" "), /Syllable/);
  assert.match(descriptions.join(" "), /Line/);
  assert.match(descriptions.join(" "), /Static/);
});
