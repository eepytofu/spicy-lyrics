import assert from "node:assert/strict";
import { test } from "node:test";
import { isChineseDocumentPendingReading } from "../src/utils/Lyrics/Processing/PendingReadingPresentation.ts";

const syllableLine = (text: string) => ({
  Lead: {
    Syllables: Array.from(text, (Text) => ({ Text })),
  },
});

test("a Kana island keeps a Chinese-dominant pending document on the Pinyin route", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [
      syllableLine("无大碍"),
      syllableLine("没伤到脑袋"),
      syllableLine("如果我下手太重すみません"),
      syllableLine("习武十载"),
      syllableLine("没下山没谈恋爱"),
    ],
  };

  assert.equal(isChineseDocumentPendingReading(lyrics), true);
});

test("ordinary Japanese pending lyrics do not reserve the Pinyin Above row", () => {
  const lyrics = {
    Type: "Line",
    Content: [
      { Text: "本当にすみません" },
      { Text: "今日は大丈夫" },
      { Text: "私の心は元気です" },
    ],
  };

  assert.equal(isChineseDocumentPendingReading(lyrics), false);
});

test("line-timed backgrounds contribute to pending document routing", () => {
  const lyrics = {
    Type: "Line",
    Content: [{
      Text: "la",
      Background: [{ Text: "无大碍 没伤到脑袋 习武十载" }],
    }],
  };

  assert.equal(isChineseDocumentPendingReading(lyrics), true);
});

test("provider-info and vocal-cue rows do not choose pending reading presentation", () => {
  const lyrics = {
    Type: "Line",
    Content: [
      { Text: "无大碍 没伤到脑袋", ProviderInfoKind: "credit" },
      { Text: "女合：", VocalCue: { Label: "女合", Form: "labelColon" } },
      { Text: "本当にすみません" },
      { Text: "今日は大丈夫" },
    ],
  };

  assert.equal(isChineseDocumentPendingReading(lyrics), false);
});
