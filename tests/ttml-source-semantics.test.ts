import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { buildLyricsInteropSnapshot } from "../src/utils/Lyrics/Interop.ts";
import { ensureSourceEvidence } from "../src/utils/Lyrics/Processing/SourceEvidence.ts";
import { ensureSourceLyricDocument } from "../src/utils/Lyrics/Processing/SourceLyricDocument.ts";
import { parseTtmlDocument } from "../src/utils/Lyrics/TtmlDocument.ts";

test("TTML semantics survive native, evidence, source document, and interop boundaries", () => {
  const xml = readFileSync(
    new URL("./fixtures/ttml/c-word-level-roman.ttml", import.meta.url),
    "utf8"
  );
  const lyrics = parseTtmlDocument(xml, new DOMParser() as any) as any;
  lyrics.uri = "spotify:track:ttml-semantics";
  lyrics.id = "ttml-semantics";

  const evidence = ensureSourceEvidence(lyrics)!;
  assert.equal(evidence.providerLanguage, "ja");
  assert.equal(evidence.lines[0].providerLineId, "L1");
  assert.deepEqual(evidence.lines[0].providerRomanizations, [
    {
      Text: "tokei ga",
      Language: "ja-Latn",
      Words: [
        { Text: "tokei", StartTime: 1, EndTime: 2, IsPartOfWord: false },
        { Text: "ga", StartTime: 2, EndTime: 2.4, IsPartOfWord: true },
      ],
    },
  ]);
  assert.equal(Object.isFrozen(evidence.lines[0].providerRomanizations), true);
  assert.equal(Object.isFrozen(evidence.lines[0].providerRomanizations?.[0].Words), true);

  const { document, parity } = ensureSourceLyricDocument(lyrics);
  assert.equal(parity.valid, true);
  assert.equal(document?.providerLanguage, "ja");
  assert.equal(document?.lines[0].providerLineId, "L1");
  assert.deepEqual(document?.lines[0].providerTranslations, evidence.lines[0].providerTranslations);

  const snapshot = buildLyricsInteropSnapshot(lyrics)!;
  assert.equal(snapshot.version, 6);
  assert.equal(snapshot.providerLanguage, "ja");
  assert.equal(snapshot.lines[0].providerLineId, "L1");
  assert.deepEqual(snapshot.lines[0].providerRomanizations, [
    {
      text: "tokei ga",
      language: "ja-Latn",
      words: [
        {
          text: "tokei",
          providerText: "tokei",
          displayText: "tokei",
          startTime: 1,
          endTime: 2,
          isPartOfWord: false,
        },
        {
          text: "ga",
          providerText: "ga",
          displayText: "ga",
          startTime: 2,
          endTime: 2.4,
          isPartOfWord: true,
        },
      ],
    },
  ]);
});
