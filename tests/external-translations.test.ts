import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearExternalTranslation,
  projectExternalTranslations,
  submitExternalTranslation,
  synchronizeExternalTranslation,
} from "../src/utils/Lyrics/ExternalTranslations.ts";

const identity = {
  trackUri: "spotify:track:interop",
  lyricRevisionId: "revision-1",
  providerId: "qq",
  sourceCandidateId: "qq:candidate:1",
  lines: [{ id: "lead:0" }],
};

const lyrics = () => ({
  Type: "Line",
  uri: identity.trackUri,
  source: identity.providerId,
  LyricRevision: {
    id: identity.lyricRevisionId,
    providerId: identity.providerId,
    candidateId: identity.sourceCandidateId,
  },
  Content: [{ Text: "source", ProviderTranslatedText: "provider translation" }],
});

afterEach(() => clearExternalTranslation());

test("external translation projects by stable line id without mutating provider data", () => {
  const source = lyrics();
  const original = structuredClone(source);
  assert.deepEqual(submitExternalTranslation(identity, {
    trackUri: identity.trackUri,
    lyricRevisionId: identity.lyricRevisionId,
    providerId: identity.providerId,
    sourceCandidateId: identity.sourceCandidateId,
    targetLanguage: "id",
    lines: [{ id: "lead:0", text: "terjemahan" }],
  }), { ok: true, appliedLines: 1, changed: true });

  const projected = projectExternalTranslations(source);
  assert.equal(projected.Content[0].TranslatedText, "terjemahan");
  assert.equal(projected.Content[0].TranslatedTextLanguage, "id");
  assert.equal(projected.Content[0].ProviderTranslatedText, "provider translation");
  assert.equal(projected.ExternalTranslationShowProvider, false);
  assert.deepEqual(source, original);
});

test("provider sidecars are opt-in while an external lane is active", () => {
  submitExternalTranslation(identity, {
    trackUri: identity.trackUri,
    lyricRevisionId: identity.lyricRevisionId,
    providerId: identity.providerId,
    sourceCandidateId: identity.sourceCandidateId,
    targetLanguage: "id",
    showProviderTranslation: true,
    lines: [{ id: "lead:0", text: "terjemahan" }],
  });
  assert.equal(projectExternalTranslations(lyrics()).ExternalTranslationShowProvider, true);
});

test("identical external submissions do not request another render", () => {
  const submission = {
    trackUri: identity.trackUri,
    lyricRevisionId: identity.lyricRevisionId,
    providerId: identity.providerId,
    sourceCandidateId: identity.sourceCandidateId,
    targetLanguage: "id",
    lines: [{ id: "lead:0", text: "terjemahan" }],
  };

  assert.equal(submitExternalTranslation(identity, submission).ok, true);
  assert.deepEqual(submitExternalTranslation(identity, submission), {
    ok: true,
    appliedLines: 1,
    changed: false,
  });
});

test("stale provider, candidate, revision, and line ids are rejected", () => {
  const submission = {
    trackUri: identity.trackUri,
    lyricRevisionId: identity.lyricRevisionId,
    providerId: identity.providerId,
    sourceCandidateId: identity.sourceCandidateId,
    targetLanguage: "id",
    lines: [{ id: "lead:0", text: "terjemahan" }],
  };
  assert.equal(submitExternalTranslation(identity, { ...submission, providerId: "netease" }).ok, false);
  assert.equal(submitExternalTranslation(identity, { ...submission, sourceCandidateId: "stale" }).ok, false);
  assert.equal(submitExternalTranslation(identity, { ...submission, lyricRevisionId: "stale" }).ok, false);
  assert.equal(submitExternalTranslation(identity, { ...submission, lines: [{ id: "unknown", text: "x" }] }).ok, false);
});

test("source changes clear the active external lane", () => {
  submitExternalTranslation(identity, {
    trackUri: identity.trackUri,
    lyricRevisionId: identity.lyricRevisionId,
    providerId: identity.providerId,
    sourceCandidateId: identity.sourceCandidateId,
    targetLanguage: "id",
    lines: [{ id: "lead:0", text: "terjemahan" }],
  });
  assert.equal(synchronizeExternalTranslation({ ...identity, providerId: "netease" }), true);
  const source = lyrics();
  assert.equal(projectExternalTranslations(source), source);
});
