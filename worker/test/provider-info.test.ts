import { describe, expect, it } from "vitest";
import {
  markEmbeddedProviderInfo,
  providerInfoContext,
  type ProviderInfoContext,
} from "../src/provider-info";
import type { NativeLyrics, ProviderInfoKind } from "../src/types";

const LUO_TIAN_YI: ProviderInfoContext = {
  reference: {
    id: "7aSXHJ8djFxfqKLuOs039d",
    title: "乐鸣东方",
    artists: ["洛天依"],
    album: "乐鸣东方",
    durationMs: 240_000,
  },
  selected: {
    title: "乐鸣东方",
    artists: ["洛天依"],
  },
};

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
        StartTime: index * 1_000,
        EndTime: (index + 1) * 1_000,
        Syllables: [{ Text: text, StartTime: index * 1_000, EndTime: (index + 1) * 1_000 }],
      },
    })),
  };
}

function lineLyrics(texts: string[], source: NativeLyrics["source"] = "netease"): NativeLyrics {
  return {
    Type: "Line",
    source,
    sourceDisplayName: source,
    fetchProvider: source,
    Content: texts.map((text, index) => ({
      Type: "Vocal",
      OppositeAligned: false,
      StartTime: index * 1_000,
      EndTime: (index + 1) * 1_000,
      Text: text,
    })),
  };
}

function kinds(lyrics: NativeLyrics): Array<ProviderInfoKind | undefined> {
  return (lyrics.Content as Array<Record<string, unknown>>).map((entry) => {
    if (lyrics.Type === "Syllable") {
      return (entry.Lead as { ProviderInfoKind?: ProviderInfoKind }).ProviderInfoKind;
    }
    return entry.ProviderInfoKind as ProviderInfoKind | undefined;
  });
}

describe("embedded provider-info classification", () => {
  it("marks the complete QQ 乐鸣东方 header and 24-row credit block", () => {
    const texts = [
      "乐鸣东方 - 洛天依",
      "词：元和令/付茂华",
      "曲：李建衡",
      "编曲：A",
      "调校：B",
      "音乐总监：C",
      "吉他：D",
      "和音：E",
      "录音：F",
      "弦乐：G",
      "弦乐监制：H",
      "民族伴唱：I/J",
      "民族伴唱监制：K",
      "音频编辑：L",
      "混音/母带：M",
      "骨笛/竹笛：N",
      "古琴 ：成子",
      "琵琶：O",
      "南音拍板：P",
      "南音洞箫：Q",
      "南音琵琶：R",
      "天琴：S",
      "二胡：T",
      "唢呐：U",
      "古筝：V",
      "穿越过千年的时光",
    ];
    const result = markEmbeddedProviderInfo(syllableLyrics(texts), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([
      "trackHeader",
      ...Array<ProviderInfoKind>(24).fill("credit"),
      undefined,
    ]);
    expect(((result.Content as any[])[16].Lead.Syllables[0]).Text).toBe("古琴 ：成子");
  });

  it("bridges a bounded colonless NetEase continuation inside an anchored leading block", () => {
    const texts = [
      "作词：元和令",
      "作曲：李建衡",
      "编曲：甲",
      "制作人：乙",
      "吉他：丙",
      "贝斯：丁",
      "鼓：戊",
      "弦乐：己",
      "录音：庚",
      "混音：辛",
      "民族伴唱：壬/癸",
      "子/丑",
      "民族伴唱监制：寅",
      "音频编辑：卯",
      "母带：辰",
      "骨笛：巳",
      "古琴：午",
      "琵琶：未",
      "天琴：申",
      "二胡：酉",
      "唢呐：戌",
      "古筝：亥",
      "统筹：甲",
      "出品：乙",
      "发行：丙",
      "穿越过千年的时光",
    ];
    const result = markEmbeddedProviderInfo(lineLyrics(texts), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([
      ...Array<ProviderInfoKind>(25).fill("credit"),
      undefined,
    ]);
    expect(kinds(result).findIndex((kind) => kind === undefined)).toBe(25);
  });

  it("keeps KuGou's shorter same-track boundary provider-specific", () => {
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "乐鸣东方 - 洛天依",
      "词：元和令/付茂华",
      "曲：李建衡",
      "穿越过千年的时光",
    ], "kugou"), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", undefined]);
    expect(kinds(result).findIndex((kind) => kind === undefined)).toBe(3);
  });

  it("uses selected provider metadata and aliases for an exact track header", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "spotify",
        title: "暴风雨 - Live",
        artists: ["Masiwei"],
        album: "Live",
        durationMs: 200_000,
      },
      selected: {
        title: "暴风雨 (Live)",
        titleAliases: ["暴风雨（Live）"],
        artists: ["马思唯"],
        artistAliases: ["Masiwei"],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "暴风雨 (Live) - 马思唯",
      "词：马思唯",
      "曲：马思唯",
      "PGM：A",
      "我说暴风雨就要来了",
    ]), "qq", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", "credit", undefined]);
  });

  it("accepts artist-title and exact title-only headers only beside a validated block", () => {
    const artistTitle = markEmbeddedProviderInfo(syllableLyrics([
      "洛天依 - 乐鸣东方",
      "Written by：元和令",
      "first lyric",
    ]), "qq", LUO_TIAN_YI);
    const titleOnly = markEmbeddedProviderInfo(syllableLyrics([
      "乐鸣东方",
      "作词：元和令",
      "first lyric",
    ]), "qq", LUO_TIAN_YI);
    const standalone = markEmbeddedProviderInfo(syllableLyrics([
      "乐鸣东方",
      "first lyric",
    ]), "qq", LUO_TIAN_YI);

    expect(kinds(artistTitle)).toEqual(["trackHeader", "credit", undefined]);
    expect(kinds(titleOnly)).toEqual(["trackHeader", "credit", undefined]);
    expect(kinds(standalone)).toEqual([undefined, undefined]);
  });

  it("decomposes bilingual role labels without enumerating combined labels", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "词 Lyrics：Alice",
      "制作人Music Producer：Bob",
      "录音棚 Recording studio：Studio C",
      "混音师 Mixing Engineer：Dana",
      "first lyric",
    ], "qq"), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["credit", "credit", "credit", "credit", undefined]);
  });

  it("classifies complete positive authorization boilerplate but not loose authorization text", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "first lyric",
      "【本音乐作品已获得正版授权】",
      "授权：Alice",
    ], "kugou"), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "rightsNotice", undefined]);
  });

  it.each(["qq", "kugou", "netease"] as const)(
    "classifies the complete prohibitive reproduction notice from %s",
    (provider) => {
      const result = markEmbeddedProviderInfo(lineLyrics([
        "first lyric",
        "【版权所有，未经许可，翻版必究】",
        "last lyric",
      ], provider), provider, LUO_TIAN_YI);

      expect(kinds(result)).toEqual([undefined, "rightsNotice", undefined]);
    },
  );

  it.each([
    "版权所有",
    "未经许可",
    "翻版必究",
    "【版权所有，未经许可】",
    "【未经许可，翻版必究】",
    "版权所有，未经许可，翻版必究",
  ])("does not classify incomplete or unstructured reproduction wording: %s", (text) => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "first lyric",
      text,
      "last lyric",
    ], "netease"), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, undefined, undefined]);
  });

  it("marks complete KuGou campaign slogans as provider notices", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "first lyric",
      "酷狗国潮音乐企划",
      "听DJ好歌，上酷狗音乐",
    ], "kugou"), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "providerNotice", "providerNotice"]);
  });

  it("does not classify loose KuGou, DJ, or campaign vocabulary as provider notices", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "听DJ说：今夜不回家",
      "我在酷狗音乐里听见你",
      "酷狗音乐人：Alice",
      "国潮企划写进我的歌",
    ], "kugou"), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("uses safe raw title and artist tags only as post-selection header aliases", () => {
    const context = providerInfoContext(LUO_TIAN_YI.reference, {
      title: "Fate (命运)",
      artists: ["GFRIEND"],
    }, "[ti:Fate]\n[ar:여자친구 GFRIEND]\n[by:1]");
    const result = markEmbeddedProviderInfo(lineLyrics([
      "Fate - 여자친구 GFRIEND",
      "Written by：Alice",
      "first lyric",
    ], "qq"), "qq", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", undefined]);
    expect(context.selected?.titleAliases).toContain("Fate");
    expect(context.selected?.artistAliases).toContain("여자친구 GFRIEND");
  });

  it("accepts extra delimited provider artists only after the complete selected artist set", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "4Be8UHXmXCaKBWTi4OwpU6",
        title: "归家",
        artists: ["KBShinya", "哦漏"],
        album: "归家",
        durationMs: 280_000,
      },
      selected: {
        title: "归家",
        artists: ["KBShinya", "哦漏"],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "归家 - 国风堂/KBShinya/哦漏",
      "词：释子/公子无琊",
      "曲：王韩一淋",
      "编曲：向往",
      "分轨：向往",
      "混音：Mr.曾经",
      "和声：KBShinya",
      "插画：RedMatcha",
      "监制：胡阳小雪",
      "吉他：大牛",
      "企划题字：毫克",
      "设计：马睿",
      "企划：闫倩莹/赵海彤/李喆渊",
      "哦漏：",
      "那时节 芳草萋萋寒鸦日暮",
    ], "kugou"), "kugou", context);

    expect(kinds(result)).toEqual([
      "trackHeader",
      ...Array<ProviderInfoKind>(12).fill("credit"),
      undefined,
      undefined,
    ]);
  });

  it("recovers strict credits without treating a partial selected artist set as a header", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "4Be8UHXmXCaKBWTi4OwpU6",
        title: "归家",
        artists: ["KBShinya", "哦漏"],
        album: "归家",
        durationMs: 280_000,
      },
      selected: {
        title: "归家",
        artists: ["KBShinya", "哦漏"],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "归家 - 国风堂/KBShinya",
      "词：释子/公子无琊",
      "曲：王韩一淋",
      "第一句歌词",
    ], "kugou"), "kugou", context);

    expect(kinds(result)).toEqual([undefined, "credit", "credit", undefined]);
  });

  it("recovers 食语人间 through one bounded provider-title annotation", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "spotify-food-world",
        title: "食语人间",
        artists: ["三无Marblue", "祖娅纳惜"],
        album: "食语人间",
        durationMs: 240_000,
      },
      selected: {
        title: "食语人间",
        artists: ["三无Marblue", "祖娅纳惜"],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "食语人间 (《食物语》手游三周年主题纪念曲) - 三无Marblue/祖娅纳惜",
      "作词：A",
      "作曲：B",
      "编曲：C",
      "first lyric",
    ]), "qq", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", "credit", undefined]);
  });

  it.each([
    "Bounded Track（edition）",
    "Bounded Track[edition]",
    "Bounded Track【edition】",
    "Bounded Track《edition》",
  ])("accepts one supported trailing balanced title annotation: %s", (header) => {
    const context: ProviderInfoContext = {
      reference: {
        id: "bounded-track",
        title: "Bounded Track",
        artists: ["Artist"],
        album: "Bounded Track",
        durationMs: 200_000,
      },
      selected: {
        title: "Bounded Track",
        artists: ["Artist"],
      },
    };
    const result = markEmbeddedProviderInfo(lineLyrics([
      header,
      "Lyrics：Alice",
      "Composer：Bob",
      "first lyric",
    ]), "qq", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", undefined]);
  });

  it("recovers 不谓侠 when a selected artist has one trailing alias annotation", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "netease:473403027",
        title: "不谓侠",
        artists: ["萧忆情Alex"],
        album: "萧音弥漫",
        durationMs: 266_000,
      },
      selected: {
        title: "不谓侠",
        artists: ["萧忆情Alex"],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "不谓侠 - 萧忆情Alex (Alex)",
      "词：迟意",
      "曲：潮汐-tide",
      "编曲：潮汐-tide",
      "first lyric",
    ]), "qq", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", "credit", undefined]);
  });

  it("recovers symmetric base-title and split-header 马步摇 shapes only beside strict blocks", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "netease:2644122969",
        title: "马步摇（《一梦江湖》马步谣变奏欢乐版）",
        artists: ["一梦江湖"],
        album: "《马步谣》欢乐重置版",
        durationMs: 265_000,
      },
      selected: {
        title: "马步摇（《一梦江湖》马步谣变奏欢乐版）",
        artists: ["一梦江湖"],
      },
    };
    const baseTitle = markEmbeddedProviderInfo(lineLyrics([
      "马步摇",
      "原唱：双笙",
      "原曲：《马步谣》",
      "曲：纯白P",
      "词：冉语优",
      "first lyric",
    ]), "qq", context);
    const splitTitle = markEmbeddedProviderInfo(lineLyrics([
      "马步摇",
      "（《一梦江湖》马步谣变奏欢乐版）",
      "原曲：《马步谣》",
      "曲：纯白P",
      "词：冉语优",
      "first lyric",
    ]), "netease", context);

    expect(kinds(baseTitle)).toEqual(["trackHeader", "credit", "credit", "credit", "credit", undefined]);
    expect(kinds(splitTitle)).toEqual([
      "trackHeader",
      "trackHeader",
      "credit",
      "credit",
      "credit",
      undefined,
    ]);
  });

  it("marks a strict credit block after an unknown leading row without granting header identity", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "乐鸣东方 - another singer",
      "作词：Alice",
      "作曲：Bob",
      "编曲：Carol",
      "first lyric",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "credit", "credit", "credit", undefined]);
  });

  it("does not give bounded headers the exact header's relaxed single-credit trust", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "bounded-single-credit",
        title: "食语人间",
        artists: ["三无Marblue"],
        album: "食语人间",
        durationMs: 240_000,
      },
      selected: {
        title: "食语人间",
        artists: ["三无Marblue"],
      },
    };
    const result = markEmbeddedProviderInfo(lineLyrics([
      "食语人间 (纪念曲) - 三无Marblue",
      "作词：Alice",
      "first lyric",
    ]), "qq", context);

    expect(kinds(result)).toEqual([undefined, undefined, undefined]);
  });

  it.each(["Studio Song (Live)", "Studio Song (2022Ver.)"])(
    "keeps a conflicting version-shaped bounded header ordinary while recovering its strict credits: %s",
    (header) => {
      const context: ProviderInfoContext = {
        reference: {
          id: "studio-song",
          title: "Studio Song",
          artists: ["Artist"],
          album: "Studio Song",
          durationMs: 200_000,
        },
        selected: {
          title: "Studio Song",
          artists: ["Artist"],
        },
      };
      const result = markEmbeddedProviderInfo(lineLyrics([
        `${header} - Artist`,
        "Lyrics：Alice",
        "Composer：Bob",
        "first lyric",
      ]), "qq", context);

      expect(kinds(result)).toEqual([undefined, "credit", "credit", undefined]);
    },
  );

  it("marks an exact header and independently anchored block after authoritative leading credits", () => {
    const context: ProviderInfoContext = {
      reference: {
        id: "netease:3348520852",
        title: "卦象怎判",
        artists: ["洛天依Official", "乐正绫"],
        album: "卦象怎判",
        durationMs: 162_000,
      },
      selected: {
        title: "卦象怎判",
        artists: ["洛天依Official", "乐正绫"],
      },
    };
    const lyrics = lineLyrics([
      "作词: 盏月陆离",
      "作曲: 盏月陆离",
      "卦象怎判-洛天依/乐正绫",
      "编曲：李兀",
      "歌姬：洛天依/乐正绫",
      "调教：盏月陆离",
      "混音：神曦",
      "监制：谢墨",
      "制作人：祭酒",
      "策划：盏月陆离",
      "龟甲在烈火里 烧出了裂纹",
    ]);
    for (const line of (lyrics.Content as Array<Record<string, unknown>>).slice(0, 2)) {
      line.ProviderInfoKind = "credit";
    }

    const result = markEmbeddedProviderInfo(lyrics, "netease", context);

    expect(kinds(result)).toEqual([
      "credit",
      "credit",
      "trackHeader",
      ...Array<ProviderInfoKind>(7).fill("credit"),
      undefined,
    ]);
  });

  it.each([
    ["non-matching intervening row", "另一首歌-洛天依/乐正绫", ["编曲：李兀", "混音：神曦"]],
    ["missing selected artist", "卦象怎判-洛天依", ["编曲：李兀", "混音：神曦"]],
    ["insufficient following block", "卦象怎判-洛天依/乐正绫", ["编曲：李兀"]],
  ] as const)("keeps post-credit rows visible for %s", (_name, header, following) => {
    const context: ProviderInfoContext = {
      reference: {
        id: "netease:3348520852",
        title: "卦象怎判",
        artists: ["洛天依Official", "乐正绫"],
        album: "卦象怎判",
        durationMs: 162_000,
      },
      selected: {
        title: "卦象怎判",
        artists: ["洛天依Official", "乐正绫"],
      },
    };
    const texts = ["作词: 盏月陆离", "作曲: 盏月陆离", header, ...following, "first lyric"];
    const lyrics = lineLyrics(texts);
    for (const line of (lyrics.Content as Array<Record<string, unknown>>).slice(0, 2)) {
      line.ProviderInfoKind = "credit";
    }

    const result = markEmbeddedProviderInfo(lyrics, "netease", context);

    expect(kinds(result)).toEqual(["credit", "credit", ...Array(texts.length - 2).fill(undefined)]);
  });

  it.each([
    "暴风雨 (Live)",
    "黑马王子 (Live)",
    "花花公子 (Live)",
  ])("classifies the reviewed QQ paired rights tail for %s", (title) => {
    const result = markEmbeddedProviderInfo(syllableLyrics([
      `最后一句 ${title}`,
      "A Few Good Kids Records",
      "版权声明：未经著作权人书面许可，任何人不得以任何方式使用",
    ]), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "rightsHolder", "rightsNotice"]);
  });

  it("recognizes QQ's strong TME translation-rights wording", () => {
    const result = markEmbeddedProviderInfo(syllableLyrics([
      "最后一句歌词",
      "A Few Good Kids Records",
      "腾讯音乐娱乐集团享有本翻译作品的著作权",
    ]), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "rightsHolder", "rightsNotice"]);
  });

  it.each([
    ["QQ 暴风雨 (Live)", "qq", "暴风雨 (Live)", "马思唯", ["词：马思唯", "曲：马思唯", "PGM：A", "FOH+录音：B"]],
    ["QQ 黑马王子 (Live)", "qq", "黑马王子 (Live)", "马思唯", ["词：马思唯", "曲：马思唯", "DJ：A", "管乐组：B"]],
    ["QQ 花花公子 (Live)", "qq", "花花公子 (Live)", "马思唯", ["词：马思唯", "曲：马思唯", "PGM：A", "DJ：B"]],
    ["KuGou 大東北我的家鄉(DJ何鵬版)", "kugou", "大東北我的家鄉(DJ何鵬版)", "刘晓", ["作词：A", "作曲：B", "DJ：何鹏"]],
    ["KuGou 夜に駆ける", "kugou", "夜に駆ける", "YOASOBI", ["Lyrics: Ayase", "Composer: Ayase"]],
    ["KuGou Bad Apple!!", "kugou", "Bad Apple!!", "nomico", ["Lyrics: Haruka", "Composer: ZUN"]],
    ["NetEase 暴风雨 (Live)", "netease", "暴风雨 (Live)", "马思唯", ["词：马思唯", "曲：马思唯", "PGM：A"]],
    ["NetEase 一梦红尘", "netease", "一梦红尘", "小曲儿", ["作词：A", "作曲：B", "策划：C"]],
    ["NetEase Bad Apple!!", "netease", "Bad Apple!!", "nomico", ["Lyrics: Haruka", "Composer: ZUN"]],
    ["Soda 一梦红尘 static capture", "soda", "一梦红尘", "小曲儿", ["作词：A", "作曲：B", "出品：C"]],
    ["Soda DJ KRC capture", "soda", "DJ Track", "Artist", ["Lyrics: A", "Composer: B", "DJ: C"]],
    ["Soda D/N/A LRC capture", "soda", "D/N/A", "AZARI", ["Lyrics: AZARI", "Composer: AZARI"]],
  ] as const)("classifies the complete bounded block for %s", (_name, source, title, artist, credits) => {
    const context: ProviderInfoContext = {
      reference: { id: title, title, artists: [artist], album: "", durationMs: 200_000 },
      selected: { title, artists: [artist] },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      `${title} - ${artist}`,
      ...credits,
      "first lyric",
    ], source), source, context);

    expect(kinds(result)).toEqual([
      "trackHeader",
      ...Array<ProviderInfoKind>(credits.length).fill("credit"),
      undefined,
    ]);
  });

  it("marks complete anchored trailing blocks", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "最后一句歌词",
      "Lyrics: Alice",
      "Composer: Bob",
      "FOH+录音: Carol",
    ]), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, "credit", "credit", "credit"]);
  });

  it("counts stable compound role heads without enumerating the unknown labels they anchor", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "作词/作曲：Alice",
      "PGM：Bob",
      "first lyric",
    ], "qq"), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["credit", "credit", undefined]);
  });

  it.each([
    ["section heading", ["[Chorus]", "sing it again", "first lyric"]],
    ["duet and empty-value cues", ["Alice/Bob：", "Alice：hello", "Bob：world"]],
    ["title inside a lyric line", ["今晚唱着乐鸣东方", "作词：Alice", "first lyric"]],
    ["colon lyric and dialogue", ["喧笑：突然安静", "甲：你好吗", "乙：我很好"]],
    ["standalone credit", ["作词：Alice", "第一句歌词"]],
    ["unknown unanchored block", ["PGM: Alice", "DJ: Bob", "FOH+录音: Carol", "第一句歌词"]],
    ["middle-song role run", ["第一句歌词", "作词：Alice", "作曲：Bob", "最后一句歌词"]],
    ["loose Lyricify er false positives", ["water: falling", "summer: rain", "第一句歌词"]],
    ["incomplete rights wording", ["最后一句歌词", "版权所有"]],
    ["three-row continuation gap", ["作词：Alice", "one", "two", "three", "作曲：Bob"]],
  ])("abstains from %s", (_name, texts) => {
    const result = markEmbeddedProviderInfo(lineLyrics(texts), "netease", LUO_TIAN_YI);
    expect(kinds(result)).toEqual(Array(texts.length).fill(undefined));
  });
});
