import { describe, expect, it } from "vitest";
import { markProviderLineSemantics } from "../src/provider-line-semantics";
import type { ProviderLineSemanticContext } from "../src/provider-line-semantics";
import type { NativeLyrics } from "../src/types";

const CONTEXT: ProviderLineSemanticContext = {
  reference: {
    id: "speaker-corpus",
    title: "遥问海棠赴微雨",
    artists: [
      "尚辰",
      "冽冽",
      "大C",
      "Babystop_山竹",
      "糯米Nomi",
      "沈雾敛",
      "江偌绮（傲七爷）",
      "白翎",
      "小爱的妈",
      "尹昔眠",
    ],
    album: "遥问海棠赴微雨",
    durationMs: 240_000,
  },
  selected: {
    title: "遥问海棠赴微雨",
    artists: ["尚辰", "冽冽", "大C", "Babystop_山竹", "糯米Nomi", "沈雾敛", "傲七爷(江偌绮)"],
  },
};

function lineLyrics(texts: string[], source: NativeLyrics["source"] = "netease"): NativeLyrics {
  return {
    Type: "Line",
    source,
    sourceDisplayName: source,
    fetchProvider: source,
    Content: texts.map((Text, index) => ({
      Type: "Vocal",
      Text,
      StartTime: index + 0.125,
      EndTime: index + 0.875,
      OppositeAligned: false,
    })),
  };
}

function syllableLyrics(texts: string[], source: NativeLyrics["source"] = "qq"): NativeLyrics {
  return {
    Type: "Syllable",
    source,
    sourceDisplayName: source,
    fetchProvider: source,
    Content: texts.map((text, index) => ({
      Type: "Vocal",
      OppositeAligned: false,
      Lead: {
        StartTime: index + 0.125,
        EndTime: index + 0.875,
        Syllables: [{ Text: text, StartTime: index + 0.125, EndTime: index + 0.875, IsPartOfWord: false }],
      },
    })),
  };
}

function target(lyrics: NativeLyrics, index: number): Record<string, any> {
  const line = (lyrics.Content as Array<Record<string, any>>)[index];
  return lyrics.Type === "Syllable" ? line.Lead : line;
}

describe("embedded vocal cue semantics", () => {
  it("marks exact, bounded alias, and proven ensemble labels without changing rows", () => {
    const texts = [
      "尚辰：", "first",
      "山竹：", "second",
      "糯米：", "third",
      "傲七爷：", "fourth",
      "三无：", "fifth",
      "合：", "sixth",
      "女合：", "seventh",
    ];
    const lyrics = lineLyrics(texts, "kugou");
    const before = structuredClone(lyrics.Content);
    const result = markProviderLineSemantics(lyrics, "kugou", {
      ...CONTEXT,
      reference: { ...CONTEXT.reference, artists: [...CONTEXT.reference.artists, "三无Marblue"] },
    });

    expect([0, 2, 4, 6, 8, 10, 12].map((index) => target(result, index).VocalCue)).toEqual([
      { Label: "尚辰", Form: "labelColon" },
      { Label: "山竹", Form: "labelColon" },
      { Label: "糯米", Form: "labelColon" },
      { Label: "傲七爷", Form: "labelColon" },
      { Label: "三无", Form: "labelColon" },
      { Label: "合", Form: "labelColon" },
      { Label: "女合", Form: "labelColon" },
    ]);
    expect((result.Content as any[]).map((line) => [line.Text, line.StartTime, line.EndTime]))
      .toEqual((before as any[]).map((line) => [line.Text, line.StartTime, line.EndTime]));
  });

  it("marks NetEase bracketed performer cues but leaves rights and section rows alone", () => {
    const lyrics = lineLyrics([
      "【尚辰】", "first",
      "【版权所有,未经许可,翻版必究】",
      "[Chorus]",
      "{Refrain:}",
      "{x4}",
      "(rap loop)",
    ]);
    const result = markProviderLineSemantics(lyrics, "netease", CONTEXT);

    expect(target(result, 0).VocalCue).toEqual({ Label: "尚辰", Form: "bracketedLabel" });
    expect(target(result, 2).ProviderInfoKind).toBe("rightsNotice");
    for (const index of [2, 3, 4, 5, 6]) expect(target(result, index).VocalCue).toBeUndefined();
  });

  it("keeps provider-info precedence over empty-colon cue syntax", () => {
    const context: ProviderLineSemanticContext = {
      ...CONTEXT,
      reference: { ...CONTEXT.reference, title: "草木青时" },
      selected: { ...CONTEXT.selected!, title: "草木青时" },
    };
    const result = markProviderLineSemantics(lineLyrics([
      "作词：Alice",
      "原作信息如下：",
      "作曲：Bob",
      "尚辰：",
      "first lyric",
    ]), "netease", context);

    expect(target(result, 1).ProviderInfoKind).toBe("credit");
    expect(target(result, 1).VocalCue).toBeUndefined();
    expect(target(result, 3).VocalCue).toEqual({ Label: "尚辰", Form: "labelColon" });
  });

  it("stores syllable cue metadata on Lead and preserves every timed token", () => {
    const lyrics = syllableLyrics(["合：", "first lyric"]);
    const before = structuredClone((lyrics.Content as any[])[0].Lead);
    const result = markProviderLineSemantics(lyrics, "qq", CONTEXT);

    expect(target(result, 0).VocalCue).toEqual({ Label: "合", Form: "labelColon" });
    expect(target(result, 0).Syllables).toEqual(before.Syllables);
    expect(target(result, 0).StartTime).toBe(before.StartTime);
    expect(target(result, 0).EndTime).toBe(before.EndTime);
  });

  it("uses repeated cast structure only between multiple proven speaker identities", () => {
    const result = markProviderLineSemantics(lineLyrics([
      "尚辰：", "one",
      "角色甲：", "two",
      "角色甲：", "three",
      "冽冽：", "four",
    ]), "netease", CONTEXT);

    expect(target(result, 2).VocalCue).toEqual({ Label: "角色甲", Form: "labelColon" });
    expect(target(result, 4).VocalCue).toEqual({ Label: "角色甲", Form: "labelColon" });
  });

  it.each([
    ["one proven identity", ["尚辰：", "one", "角色甲：", "two", "角色甲：", "three"]],
    ["single unknown label", ["尚辰：", "one", "角色甲：", "two", "冽冽：", "three"]],
    ["structural headings", ["尚辰：", "one", "Chorus：", "two", "冽冽：", "three", "Chorus：", "four"]],
    ["nonempty dialogue", ["尚辰：hello", "冽冽：world"]],
    ["arbitrary artist suffix", ["糯：", "one"]],
  ])("abstains from %s", (_name, texts) => {
    const result = markProviderLineSemantics(lineLyrics(texts), "netease", CONTEXT);
    const unknowns = (result.Content as any[]).filter((line) => /角色甲|Chorus|：hello|：world|^糯：/u.test(line.Text));
    expect(unknowns.every((line) => line.VocalCue === undefined)).toBe(true);
  });

  it("recovers a bounded QQ composite cue without promoting its modifier", () => {
    const lyrics = syllableLyrics([
      "女：", "one",
      "男：", "two",
      "女：", "three",
      "男 Rap：", "four",
      "男：", "five",
      "女：", "six",
    ]);
    const cue = target(lyrics, 6);
    cue.StartTime = 81.925;
    cue.EndTime = 82.925;
    cue.Syllables[0].StartTime = 81.925;
    cue.Syllables[0].EndTime = 82.925;

    const result = markProviderLineSemantics(lyrics, "qq", CONTEXT);
    expect(target(result, 6).VocalCue).toEqual({ Label: "男 Rap", Form: "labelColon" });
    expect(target(result, 6).ProviderInfoKind).toBeUndefined();
    expect(target(result, 6).StartTime).toBe(81.925);
    expect(target(result, 6).EndTime).toBe(82.925);
    expect(target(result, 6).Syllables).toEqual([
      { Text: "男 Rap：", StartTime: 81.925, EndTime: 82.925, IsPartOfWord: false },
    ]);
    expect(target(result, 6).RomanizedText).toBeUndefined();
  });

  it.each([
    ["isolated modifier", ["Rap：", "one"]],
    ["unseeded composite identity", ["女：", "one", "角色 Rap：", "two", "男：", "three"]],
    ["structural composite modifier", ["男：", "one", "男 Verse：", "two", "男：", "three", "女：", "four"]],
    ["unbounded composite identity", ["男：", "one", "男 Rap：", "two", "女：", "three"]],
    ["brace and loop syntax", ["男：", "one", "{rap}", "(rap loop)", "女：", "two"]],
  ])("does not generalize contextual composite recovery to %s", (_name, texts) => {
    const result = markProviderLineSemantics(syllableLyrics(texts), "qq", CONTEXT);
    const ambiguous = (result.Content as any[])
      .map((line) => line.Lead)
      .filter((line) => /Rap|Verse|\{rap\}|rap loop/iu.test(line.Syllables[0].Text));
    expect(ambiguous.every((line) => line.VocalCue === undefined)).toBe(true);
  });
});
