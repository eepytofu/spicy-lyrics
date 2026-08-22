import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneProviderReadingEvidence,
  cloneProviderReadingEvidenceForProvider,
  isProviderReadingEvidence,
} from "../src/utils/Lyrics/ProviderReadingEvidence.ts";
import { ensureSourceEvidence } from "../src/utils/Lyrics/Processing/SourceEvidence.ts";
import {
  compareSourceDocumentToEvidence,
  sourceLyricDocumentFromEvidence,
} from "../src/utils/Lyrics/Processing/SourceLyricDocument.ts";

const lineEvidence = () => ({
  schemaVersion: 1 as const,
  providerId: "netease" as const,
  lineReadings: [{
    evidenceId: "netease:romanization:romalrc",
    providerId: "netease" as const,
    evidenceKind: "romanization" as const,
    granularity: "line" as const,
    documentRole: "romanization" as const,
    container: "lrc" as const,
    responseField: "romalrc" as const,
    authorshipProvenance: "unknown" as const,
    derivation: "unknown" as const,
    rows: [{
      exactValue: "  ashita  ",
      rowOrdinal: 0,
      sourceRowOrdinal: 0,
      rawStartMs: 1000,
      effectiveStartMs: 1000,
      alignment: "exactTimestamp" as const,
      validationStatus: "usable" as const,
    }],
  }],
});

test("provider reading validation clones and deeply freezes exact evidence", () => {
  const input = lineEvidence();
  const cloned = cloneProviderReadingEvidence(input)!;
  assert.notEqual(cloned, input);
  assert.equal(cloned.lineReadings?.[0].rows[0].exactValue, "  ashita  ");
  assert.equal(Object.isFrozen(cloned), true);
  assert.equal(Object.isFrozen(cloned.lineReadings), true);
  assert.equal(Object.isFrozen(cloned.lineReadings?.[0]), true);
  assert.equal(Object.isFrozen(cloned.lineReadings?.[0].rows), true);
  input.lineReadings[0].rows[0].exactValue = "caller mutation";
  assert.equal(cloned.lineReadings?.[0].rows[0].exactValue, "  ashita  ");
});

test("provider reading validation fails closed without invalidating lyrics", () => {
  assert.equal(isProviderReadingEvidence({ ...lineEvidence(), providerId: "qq" }), false);
  assert.equal(cloneProviderReadingEvidence({ schemaVersion: 1, providerId: "qq" }), undefined);
  assert.equal(cloneProviderReadingEvidenceForProvider(lineEvidence(), "qq"), undefined);

  const lyrics = {
    Type: "Line",
    source: "netease",
    ProviderReadingEvidence: {
      ...lineEvidence(),
      lineReadings: [{
        ...lineEvidence().lineReadings[0],
        rows: [{ ...lineEvidence().lineReadings[0].rows[0], rowOrdinal: 4 }],
      }],
    },
    Content: [{ Text: "明日", StartTime: 1, EndTime: 2 }],
  };
  const evidence = ensureSourceEvidence(lyrics)!;
  assert.equal(evidence.lines[0].providerText, "明日");
  assert.equal(evidence.providerReadings, undefined);
});

test("source evidence and source document carry provider readings unchanged", () => {
  const lyrics = {
    Type: "Line",
    source: "netease",
    ProviderReadingEvidence: lineEvidence(),
    Content: [{
      Text: "明日",
      StartTime: 1,
      EndTime: 2,
      ProviderRomanizedText: "display alias",
    }],
  };
  const evidence = ensureSourceEvidence(lyrics)!;
  const document = sourceLyricDocumentFromEvidence(evidence);
  assert.equal(evidence.providerReadings?.lineReadings?.[0].rows[0].exactValue, "  ashita  ");
  assert.equal(document.providerReadings, evidence.providerReadings);
  assert.equal(compareSourceDocumentToEvidence(document, evidence).valid, true);
  lyrics.Content[0].ProviderRomanizedText = "generated mutation";
  assert.equal(document.providerReadings?.lineReadings?.[0].rows[0].exactValue, "  ashita  ");
});

test("provider readings survive JSON and structured-clone cache boundaries", () => {
  const roundTripped = structuredClone(JSON.parse(JSON.stringify(lineEvidence())));
  const cloned = cloneProviderReadingEvidence(roundTripped)!;
  assert.deepEqual(cloned, lineEvidence());
  assert.equal(Object.isFrozen(cloned.lineReadings?.[0].rows[0]), true);
});
