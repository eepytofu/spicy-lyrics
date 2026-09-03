import test from "node:test";
import assert from "node:assert/strict";
import { buildLyricsInteropSnapshot } from "../src/utils/Lyrics/Interop.ts";

test("interop exposes original static text and render-plan romanization separately", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Static",
    uri: "spotify:track:static-reading",
    id: "static-reading",
    Language: "cmn",
    LanguageISO2: "zh",
    Lines: [{
      Text: "月亮",
      ReadingRenderPlan: { joinedDisplayText: "yuè liàng" },
    }],
  });

  assert.equal(snapshot?.lines[0]?.originalText, "月亮");
  assert.equal(snapshot?.lines[0]?.providerText, "月亮");
  assert.equal(snapshot?.lines[0]?.displayText, "月亮");
  assert.equal(snapshot?.lines[0]?.readingText, "yuè liàng");
  assert.equal(snapshot?.lines[0]?.id, "lead:0");
});

test("interop keeps normalized originalText as the version-one compatibility field", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Static",
    uri: "spotify:track:interop-whitespace",
    id: "interop-whitespace",
    Lines: [{
      Text: "  ぶち壊してshout   it\tout loud  ",
      RomanizedText: "buchikowashiteshout it out loud",
    }],
  });

  assert.equal(snapshot?.lines[0]?.originalText, "ぶち壊してshout it out loud");
  assert.equal(
    snapshot?.lines[0]?.providerText,
    "  ぶち壊してshout   it\tout loud  ",
  );
  assert.equal(snapshot?.lines[0]?.displayText, "ぶち壊して shout it out loud");
  assert.equal(snapshot?.lines[0]?.readingText, "buchikowashite shout it out loud");
});

test("interop reads Japanese group readings without requiring syllable RomanizedText", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Syllable",
    uri: "spotify:track:japanese-reading",
    id: "japanese-reading",
    Language: "jpn",
    LanguageISO2: "ja",
    Content: [{
      Type: "Vocal",
      Lead: {
        StartTime: 1,
        EndTime: 3,
        JapaneseReading: { sourceText: "君は", romaji: "kimi wa", furigana: [] },
        ReadingRenderPlan: { joinedDisplayText: "kimi wa" },
        Syllables: [
          { Text: "君", StartTime: 1, EndTime: 2, IsPartOfWord: false },
          { Text: "は", StartTime: 2, EndTime: 3, IsPartOfWord: false },
        ],
      },
      Background: [{
        StartTime: 1,
        EndTime: 2,
        Syllables: [{ Text: "背景", StartTime: 1, EndTime: 2, IsPartOfWord: false }],
      }],
    }, {
      Type: "Instrumental",
      StartTime: 3,
      EndTime: 5,
    }],
  });

  assert.deepEqual(snapshot?.lines.map((line) => line.originalText), ["君は"]);
  assert.equal(snapshot?.lines[0]?.readingText, "kimi wa");
  assert.deepEqual(snapshot?.lines[0]?.words?.map((word) => word.text), ["君", "は"]);
});

test("interop keeps Chinese-provider Japanese source text after display repair", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Syllable",
    uri: "spotify:track:chinese-provider-japanese",
    id: "chinese-provider-japanese",
    Language: "jpn",
    LanguageISO2: "ja",
    Content: [{
      Type: "Vocal",
      Lead: {
        StartTime: 0,
        EndTime: 4,
        JapaneseReading: {
          sourceText: "梦见ては",
          displayText: "夢見ては",
          romaji: "yumemite wa",
          furigana: [],
        },
        ReadingRenderPlan: { joinedDisplayText: "yumemite wa" },
        Syllables: [
          { Text: "梦", StartTime: 0, EndTime: 1, IsPartOfWord: false },
          { Text: "见", StartTime: 1, EndTime: 2, IsPartOfWord: true },
          { Text: "て", StartTime: 2, EndTime: 3, IsPartOfWord: true },
          { Text: "は", StartTime: 3, EndTime: 4, IsPartOfWord: true },
        ],
      },
    }],
  });

  assert.equal(snapshot?.lines[0]?.originalText, "梦见ては");
  assert.equal(snapshot?.lines[0]?.providerText, "梦见ては");
  assert.equal(snapshot?.lines[0]?.displayText, "夢見ては");
  assert.deepEqual(snapshot?.lines[0]?.words?.map((word) => word.text), ["梦", "见", "て", "は"]);
  assert.deepEqual(
    snapshot?.lines[0]?.words?.map((word) => [word.providerText, word.displayText]),
    [
      ["梦", "夢"],
      ["见", "見"],
      ["て", "て"],
      ["は", "は"],
    ],
  );
  assert.equal(snapshot?.lines[0]?.readingText, "yumemite wa");
});

test("interop preserves Chinese word grouping and full-line contextual pinyin", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Syllable",
    uri: "spotify:track:chinese-reading",
    id: "chinese-reading",
    Content: [{
      Type: "Vocal",
      Lead: {
        StartTime: 0,
        EndTime: 2,
        RomanizedText: "yīn yuè",
        Syllables: [
          { Text: "音", StartTime: 0, EndTime: 1, IsPartOfWord: true },
          { Text: "乐", StartTime: 1, EndTime: 2, IsPartOfWord: true },
        ],
      },
    }],
  });

  assert.equal(snapshot?.lines[0]?.originalText, "音乐");
  assert.equal(snapshot?.lines[0]?.readingText, "yīn yuè");
});

test("interop v7 retains provider-info rows and classification", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Static",
    uri: "spotify:track:provider-info",
    id: "provider-info",
    Lines: [
      { Text: "作词：作者", ProviderInfoKind: "credit" },
      { Text: "酷狗国潮音乐企划", ProviderInfoKind: "providerNotice" },
      { Text: "普通歌词" },
    ],
  });

  assert.equal(snapshot?.version, 7);
  assert.deepEqual(snapshot?.lines.map(({ originalText, providerInfoKind }) => ({
    originalText,
    providerInfoKind,
  })), [
    { originalText: "作词：作者", providerInfoKind: "credit" },
    { originalText: "酷狗国潮音乐企划", providerInfoKind: "providerNotice" },
    { originalText: "普通歌词", providerInfoKind: undefined },
  ]);
});

test("interop v7 publishes provider cues and AMLL agents without resolving anonymous IDs", () => {
  const providerSnapshot = buildLyricsInteropSnapshot({
    Type: "Line",
    source: "qq",
    uri: "spotify:track:vocal-cue",
    id: "vocal-cue",
    Content: [
      { Text: "A：", StartTime: 1, EndTime: 2, VocalCue: { Label: "A", Form: "labelColon" } },
    ],
  });
  assert.deepEqual(providerSnapshot?.lines[0].vocalCue, { Label: "A", Form: "labelColon" });

  const amllSnapshot = buildLyricsInteropSnapshot({
    Type: "Line",
    source: "aml",
    uri: "spotify:track:vocal-semantics",
    id: "vocal-semantics",
    VocalAgents: {
      duet: { Type: "group", Names: ["A", "B"] },
      v1: { Type: "person", Names: [] },
    },
    Content: [
      { Text: "line", StartTime: 2, EndTime: 3, VocalAgentId: "duet" },
      { Text: "anonymous", StartTime: 3, EndTime: 4, VocalAgentId: "v1" },
    ],
  });

  assert.deepEqual(amllSnapshot?.vocalAgents, {
    duet: { Type: "group", Names: ["A", "B"] },
    v1: { Type: "person", Names: [] },
  });
  assert.equal(amllSnapshot?.lines[0].vocalAgentId, "duet");
  assert.equal(amllSnapshot?.lines[1].vocalAgentId, "v1");
  assert.equal(amllSnapshot?.lines.some((line) => line.vocalCue), false);
});

test("interop v7 exposes the current lyric revision and source identity", () => {
  const revisionId = "a".repeat(64);
  const contentHash = "b".repeat(64);
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Line",
    source: "qq",
    fetchProvider: "qq",
    uri: "spotify:track:source-identity",
    id: "source-identity",
    LyricRevision: {
      schemaVersion: 4,
      trackUri: "spotify:track:source-identity",
      providerId: "qq",
      candidateId: "qq:candidate:42",
      contentHash,
      id: revisionId,
    },
    Content: [{ Text: "provider text", StartTime: 1, EndTime: 2 }],
  });

  assert.equal(snapshot?.lyricRevisionId, revisionId);
  assert.equal(snapshot?.providerId, "qq");
  assert.equal(snapshot?.sourceCandidateId, "qq:candidate:42");
});

test("interop v7 retains provider identity when a legacy lyric has no valid revision", () => {
  const snapshot = buildLyricsInteropSnapshot({
    Type: "Line",
    source: "netease",
    fetchProvider: "netease",
    SourceCandidateId: "netease:legacy-candidate",
    uri: "spotify:track:legacy-source-identity",
    id: "legacy-source-identity",
    Content: [{ Text: "same provider text", StartTime: 1, EndTime: 2 }],
  });

  assert.equal(snapshot?.lyricRevisionId, undefined);
  assert.equal(snapshot?.providerId, "netease");
  assert.equal(snapshot?.sourceCandidateId, "netease:legacy-candidate");
});

test("interop suppresses synthetic Japanese CJK gaps only for AMLL DB", () => {
  const lyrics = (source: string) => ({
    Type: "Syllable" as const,
    source,
    uri: `spotify:track:${source}`,
    id: source,
    ProviderLanguage: "ja",
    Content: [{
      Type: "Vocal" as const,
      Lead: {
        StartTime: 0,
        EndTime: 2,
        Syllables: [
          { Text: "夢", StartTime: 0, EndTime: 1, IsPartOfWord: false },
          { Text: "見て", StartTime: 1, EndTime: 2, IsPartOfWord: false },
        ],
      },
    }],
  });

  assert.equal(buildLyricsInteropSnapshot(lyrics("amlldb"))?.lines[0].displayText, "夢見て");
  assert.equal(buildLyricsInteropSnapshot(lyrics("local"))?.lines[0].displayText, "夢 見て");
  assert.equal(buildLyricsInteropSnapshot(lyrics("custom-server"))?.lines[0].displayText, "夢 見て");
});
