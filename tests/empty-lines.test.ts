import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayBaseText,
  hasLyricsText,
  hasRenderableLyrics,
  hasRenderableText,
  isEmptyLyrics,
  isEmptyLyricsLine,
  removeEmptyLyricsLines,
  stripEmptyLyricsLines,
} from "../src/utils/Lyrics/EmptyLines.ts";
import { ensureSourceEvidence } from "../src/utils/Lyrics/Processing/SourceEvidence.ts";

test("lyrics text ignores blank and zero-width-only values", () => {
  assert.equal(hasLyricsText("hello"), true);
  assert.equal(hasLyricsText("  \u200B\uFEFF"), false);
  assert.equal(hasLyricsText(undefined), false);
});

test("romanization-only entries remain renderable in the base slot", () => {
  const entry = { Text: "", TransliteratedText: "romaji" };
  assert.equal(hasRenderableText(entry), true);
  assert.equal(displayBaseText(entry), "romaji");
  assert.equal(hasRenderableText({ Text: " ", TransliteratedText: "" }), false);
});

test("line visibility includes renderable backgrounds", () => {
  assert.equal(isEmptyLyricsLine({ Text: "", Background: [{ Text: "back" }] }), false);
  assert.equal(
    isEmptyLyricsLine({
      Lead: { Syllables: [{ Text: "" }] },
      Background: [{ Syllables: [{ Text: "back" }] }],
    }),
    false,
  );
});

test("pruning removes blank rows but keeps authored timing owners inside a live group", () => {
  const lyrics = {
    Type: "Syllable",
    source: "fixture",
    Content: [
      {
        Type: "Vocal",
        Lead: {
          StartTime: 1,
          EndTime: 3,
          Syllables: [
            { Text: "kept", StartTime: 1, EndTime: 2, IsPartOfWord: true },
            { Text: " ", StartTime: 2, EndTime: 3, IsPartOfWord: false },
            { Text: "\u200B", StartTime: 3, EndTime: 3, IsPartOfWord: true },
          ],
        },
      },
      {
        Type: "Vocal",
        Lead: {
          StartTime: 3,
          EndTime: 4,
          Syllables: [{ Text: "\u200B", StartTime: 3, EndTime: 4, IsPartOfWord: true }],
        },
      },
    ],
  };

  ensureSourceEvidence(lyrics);
  stripEmptyLyricsLines(lyrics);

  assert.equal(lyrics.Content.length, 1);
  assert.deepEqual(lyrics.Content[0].Lead.Syllables.map((entry) => entry.Text), ["kept", " "]);
  assert.equal(lyrics.SourceEvidence?.lines.length, 2);
  assert.equal(lyrics.SourceEvidence?.lines[0].timingOwners.length, 3);
  assert.equal(lyrics.SourceEvidence?.lines[1].providerText, "\u200B");
});

test("candidate and post-prune emptiness use recognised lyric shapes", () => {
  assert.equal(hasRenderableLyrics({ Type: "Static", Lines: [{ Text: "" }] }), false);
  assert.equal(hasRenderableLyrics({ Type: "Static" }), false);
  assert.equal(
    hasRenderableLyrics({ Type: "Static", Lines: [{ Text: "", RomanizedText: "ro" }] }),
    true,
  );
  assert.deepEqual(removeEmptyLyricsLines([{ Text: "" }, { Text: "kept" }]), [
    { Text: "kept" },
  ]);
  assert.equal(isEmptyLyrics({ Lines: [] }), true);
  assert.equal(isEmptyLyrics({ Type: "Static" }), false);
});
