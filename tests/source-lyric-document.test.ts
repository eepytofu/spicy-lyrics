import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareSourceDocumentToEvidence,
  ensureSourceLyricDocument,
  SOURCE_LYRIC_DOCUMENT_SCHEMA_VERSION,
  sourceLyricDocumentFromEvidence,
} from "../src/utils/Lyrics/Processing/SourceLyricDocument.ts";
import { ensureSourceEvidence } from "../src/utils/Lyrics/Processing/SourceEvidence.ts";

test("SourceLyricDocument is an immutable exact-source and timing projection", () => {
  const lyrics = {
    Type: "Syllable",
    source: "qq",
    fetchProvider: "qq",
    sourceDisplayName: "QQ Music",
    Content: [
      {
        Type: "Vocal",
        Lead: {
          StartTime: 10,
          EndTime: 30,
          ProviderTranslatedText: "break it",
          Syllables: [
            {
              Text: "ぶち壊して",
              StartTime: 10,
              EndTime: 20,
              IsPartOfWord: true,
              ProviderRuby: [{ Text: "ブチコワシテ", StartTime: 10, EndTime: 20 }],
            },
            {
              Text: "shout",
              StartTime: 20,
              EndTime: 30,
              IsPartOfWord: false,
            },
          ],
        },
        Background: [
          {
            StartTime: 12,
            EndTime: 18,
            Syllables: [{ Text: "(声)", StartTime: 12, EndTime: 18 }],
          },
        ],
      },
    ],
  };

  const { document, parity } = ensureSourceLyricDocument(lyrics);
  assert.equal(parity.valid, true);
  assert.equal(document?.schemaVersion, SOURCE_LYRIC_DOCUMENT_SCHEMA_VERSION);
  assert.deepEqual(document?.provider, { id: "qq", name: "QQ Music" });
  assert.deepEqual(
    document?.lines.map((line) => [line.id, line.role, line.exactText]),
    [
      ["lead:0", "lead", "ぶち壊してshout"],
      ["background:0:0", "background", "(声)"],
    ]
  );
  assert.deepEqual(document?.lines[0].timingOwners, [
    {
      id: "lead:0:span:0",
      exactText: "ぶち壊して",
      startMs: 10,
      endMs: 20,
      providerBoundaryAfter: false,
      providerRuby: [{ Text: "ブチコワシテ", StartTime: 10, EndTime: 20 }],
    },
    {
      id: "lead:0:span:1",
      exactText: "shout",
      startMs: 20,
      endMs: 30,
      providerBoundaryAfter: true,
    },
  ]);
  assert.equal(document?.lines[0].providerTranslation, "break it");
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document?.lines), true);
  assert.equal(Object.isFrozen(document?.lines[0].timingOwners), true);
  assert.equal(Object.isFrozen(document?.lines[0].timingOwners[0].providerRuby), true);
  assert.equal(Object.isFrozen(document?.lines[0].timingOwners[0].providerRuby?.[0]), true);
});

test("provider families retain identity across normalized lyric shapes", () => {
  const cases = [
    {
      provider: "spicy",
      lyrics: { Type: "Static", Lines: [{ Text: "native" }] },
      shape: "Static",
    },
    {
      provider: "apple",
      lyrics: {
        Type: "Line",
        Content: [{ Text: "apple", StartTime: 1, EndTime: 2 }],
      },
      shape: "Line",
    },
    {
      provider: "qq",
      lyrics: {
        Type: "Syllable",
        Content: [
          {
            Lead: {
              StartTime: 1,
              EndTime: 2,
              Syllables: [{ Text: "qq", StartTime: 1, EndTime: 2 }],
            },
          },
        ],
      },
      shape: "Syllable",
    },
    {
      provider: "kugou",
      lyrics: { Type: "Static", Lines: [{ Text: "kugou" }] },
      shape: "Static",
    },
    {
      provider: "netease",
      lyrics: {
        Type: "Line",
        Content: [{ Text: "netease", StartTime: 1, EndTime: 2 }],
      },
      shape: "Line",
    },
    {
      provider: "amll",
      lyrics: { Type: "Static", Lines: [{ Text: "ttml" }] },
      shape: "Static",
    },
    {
      provider: "spotify",
      lyrics: {
        Type: "Line",
        Content: [{ Text: "spotify", StartTime: 1, EndTime: 2 }],
      },
      shape: "Line",
    },
    {
      provider: "lrclib",
      lyrics: {
        Type: "Line",
        Content: [{ Text: "lrc", StartTime: 1, EndTime: 2 }],
      },
      shape: "Line",
    },
  ] as const;

  for (const fixture of cases) {
    const lyrics = {
      ...fixture.lyrics,
      source: fixture.provider,
      fetchProvider: fixture.provider,
    };
    const { document, parity } = ensureSourceLyricDocument(lyrics);
    assert.equal(parity.valid, true, fixture.provider);
    assert.equal(document?.provider?.id, fixture.provider);
    assert.equal(document?.normalizedShape, fixture.shape);
  }
});

test("dual-run parity reports exact field drift without changing legacy evidence", () => {
  const lyrics = {
    Type: "Line",
    source: "spotify",
    Content: [{ Text: "exact", StartTime: 1, EndTime: 2 }],
  };
  const evidence = ensureSourceEvidence(lyrics)!;
  const validDocument = sourceLyricDocumentFromEvidence(evidence);
  const driftedDocument = {
    ...validDocument,
    lines: [
      {
        ...validDocument.lines[0],
        exactText: "changed",
      },
    ],
  };

  const parity = compareSourceDocumentToEvidence(driftedDocument, evidence);
  assert.equal(parity.valid, false);
  assert.deepEqual(parity.errors, ["line:0:text"]);
  assert.equal(evidence.lines[0].providerText, "exact");
});

test("source document keeps provider-info markers without removing source rows", () => {
  const lyrics = {
    Type: "Line",
    source: "qq",
    Content: [{
      Text: "A Few Good Kids Records",
      StartTime: 1,
      EndTime: 2,
      ProviderInfoKind: "rightsHolder",
    }],
  };

  const { document, parity } = ensureSourceLyricDocument(lyrics);
  assert.equal(parity.valid, true);
  assert.equal(document?.lines.length, 1);
  assert.equal(document?.lines[0].providerInfoKind, "rightsHolder");
  assert.equal(document?.lines[0].exactText, "A Few Good Kids Records");
});
