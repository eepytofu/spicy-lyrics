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
  assert.equal(snapshot?.lines[0]?.readingText, "yuè liàng");
  assert.equal(snapshot?.lines[0]?.id, "lead:0");
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
          { Text: "音", StartTime: 0, EndTime: 1, IsPartOfWord: false },
          { Text: "乐", StartTime: 1, EndTime: 2, IsPartOfWord: true },
        ],
      },
    }],
  });

  assert.equal(snapshot?.lines[0]?.originalText, "音乐");
  assert.equal(snapshot?.lines[0]?.readingText, "yīn yuè");
});
