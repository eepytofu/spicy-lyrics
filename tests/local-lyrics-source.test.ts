import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import {
  createLocalLyricsEnvelope,
  normalizeLocalLyricsRaw,
  parseLocalLyricsContent,
  parseLocalLyricsRaw,
} from "../src/utils/Lyrics/LocalLyricsSource.ts";

const originalDomParser = globalThis.DOMParser;
globalThis.DOMParser = DOMParser as any;

test.after(() => {
  globalThis.DOMParser = originalDomParser;
});

const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body dur="4.000"><div><p begin="1.000" end="4.000" itunes:key="L1">legacy TTML</p></div></body></tt>`;

test("legacy TTML strings remain readable through the local source envelope", () => {
  const normalized = normalizeLocalLyricsRaw(ttml);
  assert.equal(normalized?.format, "ttml");
  assert.equal(normalized?.content, ttml);
  const lyrics = parseLocalLyricsRaw(ttml);
  assert.equal(lyrics?.source, "ldb");
  assert.equal(lyrics?.Content[0].Text, "legacy TTML");
});

test("synced LRC uses the stored track duration for its final line", () => {
  const envelope = createLocalLyricsEnvelope("[00:01.000]first\n[00:03.000]last", 5_250);
  assert.deepEqual(envelope, {
    schemaVersion: 1,
    format: "lrc",
    content: "[00:01.000]first\n[00:03.000]last",
    durationMs: 5_250,
  });
  const lyrics = parseLocalLyricsRaw(envelope);
  assert.equal(lyrics.Type, "Line");
  assert.equal(lyrics.Content[0].EndTime, 3);
  assert.equal(lyrics.Content[1].EndTime, 5.25);
  assert.equal(lyrics.EndTime, 5.25);
});

test("enhanced LRC becomes native Syllable lyrics without flattening word timing", () => {
  const content = [
    "[00:01.00]<00:01.00>A<00:01.20>B<00:01.20>!<00:02.00>",
    "[00:03.00]<00:03.00>last<00:04.00>",
  ].join("\n");
  const envelope = createLocalLyricsEnvelope(content, 5_000);
  const lyrics = parseLocalLyricsRaw(envelope);

  assert.equal(envelope?.format, "lrc");
  assert.equal(lyrics.Type, "Syllable");
  assert.equal(lyrics.Content.length, 2);
  assert.deepEqual(lyrics.Content[0].Lead.Syllables, [
    { Text: "A", StartTime: 1, EndTime: 1.2, IsPartOfWord: true },
    { Text: "B", StartTime: 1.2, EndTime: 1.2, IsPartOfWord: true },
    { Text: "!", StartTime: 1.2, EndTime: 2, IsPartOfWord: true },
  ]);
  assert.equal(lyrics.Content[1].Lead.EndTime, 4);
});

test("untimed LRC becomes static lyrics without rewriting raw download content", () => {
  const content = "first  line\nsecond [bridge] line";
  const envelope = createLocalLyricsEnvelope(content, 180_000);
  assert.equal(envelope?.format, "lrc");
  assert.equal(envelope?.content, content);
  const lyrics = parseLocalLyricsRaw(envelope);
  assert.equal(lyrics.Type, "Static");
  assert.deepEqual(lyrics.Lines, [
    { Text: "first line" },
    { Text: "second [bridge] line" },
  ]);
});

test("read-time sniffing repairs a stale envelope format", () => {
  const raw = {
    schemaVersion: 1,
    format: "ttml",
    content: "[00:01.000]sniffed LRC",
    durationMs: 2_000,
  };
  assert.equal(normalizeLocalLyricsRaw(raw)?.format, "lrc");
  assert.equal(parseLocalLyricsRaw(raw)?.Content[0].EndTime, 2);
});

test("malformed, empty, metadata-only, binary, and markup-shaped input is rejected", () => {
  for (const content of [
    "",
    "[ar:Artist]",
    "lyrics\0binary",
    "<not-ttml>lyrics</not-ttml>",
  ]) {
    assert.equal(parseLocalLyricsContent(content, 10_000), null, content);
    assert.equal(createLocalLyricsEnvelope(content, 10_000), null, content);
  }
  assert.equal(normalizeLocalLyricsRaw({ format: "lrc", content: 42 }), null);
});
