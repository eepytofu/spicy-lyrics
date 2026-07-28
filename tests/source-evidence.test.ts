import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOURCE_EVIDENCE_SCHEMA_VERSION,
  ensureSourceEvidence,
} from "../src/utils/Lyrics/Processing/SourceEvidence.ts";

test("source evidence freezes exact provider text before display mutation", () => {
  const lyrics = {
    Type: "Static",
    source: "spl",
    Lines: [{
      Text: "  ぶち壊してshout   it out loud  ",
      TranslatedText: "shout it out loud",
    }],
  };

  const evidence = ensureSourceEvidence(lyrics)!;
  assert.equal(evidence.schemaVersion, SOURCE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.providerId, "spl");
  assert.equal(evidence.lines[0].providerText, "  ぶち壊してshout   it out loud  ");
  assert.equal(evidence.lines[0].providerTranslation, "shout it out loud");
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.lines), true);
  assert.equal(Object.isFrozen(evidence.lines[0]), true);
  assert.equal(Object.isFrozen(evidence.lines[0].timingOwners[0]), true);

  lyrics.Lines[0].Text = "display mutation";
  assert.equal(ensureSourceEvidence(lyrics), evidence);
  assert.equal(evidence.lines[0].providerText, "  ぶち壊してshout   it out loud  ");
});

test("syllable evidence preserves fragments, timing owners, and background roles", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [{
      Type: "Vocal",
      Lead: {
        StartTime: 1,
        EndTime: 3,
        Syllables: [
          { Text: "ぶち壊して", StartTime: 1, EndTime: 2, IsPartOfWord: true },
          { Text: "shout", StartTime: 2, EndTime: 3, IsPartOfWord: false },
        ],
      },
      Background: [{
        StartTime: 1.5,
        EndTime: 2.5,
        Syllables: [
          { Text: "(声)", StartTime: 1.5, EndTime: 2.5, IsPartOfWord: true },
        ],
      }],
    }],
  };

  const evidence = ensureSourceEvidence(lyrics)!;
  assert.deepEqual(
    evidence.lines.map((line) => [line.id, line.role, line.providerText]),
    [
      ["lead:0", "lead", "ぶち壊してshout"],
      ["background:0:0", "background", "(声)"],
    ],
  );
  assert.deepEqual(evidence.lines[0].timingOwners, [
    {
      id: "lead:0:span:0",
      providerText: "ぶち壊して",
      startTime: 1,
      endTime: 2,
      isPartOfWord: true,
    },
    {
      id: "lead:0:span:1",
      providerText: "shout",
      startTime: 2,
      endTime: 3,
      isPartOfWord: false,
    },
  ]);
});

test("rehydrated cache evidence is frozen again without recapturing display text", () => {
  const cachedEvidence = {
    schemaVersion: SOURCE_EVIDENCE_SCHEMA_VERSION,
    lyricsType: "Line" as const,
    lines: [{
      id: "lead:0",
      providerText: "梦见ては",
      startTime: 0,
      endTime: 4,
      role: "lead" as const,
      timingOwners: [{
        id: "lead:0:span:0",
        providerText: "梦见ては",
        startTime: 0,
        endTime: 4,
      }],
    }],
  };
  const lyrics = {
    Type: "Line",
    Content: [{ Text: "夢見ては", StartTime: 0, EndTime: 4 }],
    SourceEvidence: cachedEvidence,
  };

  const evidence = ensureSourceEvidence(lyrics)!;
  assert.equal(evidence.lines[0].providerText, "梦见ては");
  assert.equal(Object.isFrozen(evidence.lines[0].timingOwners[0]), true);
});
