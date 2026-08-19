import { describe, expect, it } from "vitest";
import {
  markEmbeddedProviderInfo,
  providerLineSemanticContext,
} from "../src/provider-info";
import type { ProviderLineSemanticContext } from "../src/provider-line-semantics";
import type { NativeLyrics, ProviderInfoKind } from "../src/types";

const LUO_TIAN_YI: ProviderLineSemanticContext = {
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
    const context: ProviderLineSemanticContext = {
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

  it.each([
    [
      "reported 狐ギツネの乱 credited-vocalist shape",
      "qq",
      "狐ギツネの乱",
      ["まらしぃ", "鏡音リン"],
      "狐ギツネの乱 - 鏡音鈴（鏡音リン）",
      ["詞：まらしぃ", "曲：まらしぃ"],
      "今日もまた孤独にて",
    ],
    [
      "reported 关山酒 original-vocalist shape",
      "kugou",
      "关山酒",
      ["小魂"],
      "关山酒 - 等什么君(邓寓君)",
      ["词：Yoki", "曲：乐金震", "词改编：苏珂", "曲改编：吕宏斌"],
      "first lyric",
    ],
    [
      "reported アマツキツネ credited-vocalist shape",
      "netease",
      "アマツキツネ",
      ["まらしぃ", "鏡音リン"],
      "アマツキツネ - 鏡音鈴（鏡音リン）",
      ["詞：まらしぃ", "曲：まらしぃ"],
      "first lyric",
    ],
  ] as const)("anchors %s by its exact leading title side", (
    _name,
    source,
    title,
    artists,
    header,
    credits,
    firstLyric,
  ) => {
    const context: ProviderLineSemanticContext = {
      reference: {
        id: title,
        title,
        artists: [...artists],
        album: title,
        durationMs: 220_000,
      },
      selected: {
        title,
        artists: [...artists],
      },
    };
    const result = markEmbeddedProviderInfo(syllableLyrics([
      header,
      ...credits,
      firstLyric,
    ], source), source, context);

    expect(kinds(result)).toEqual([
      "trackHeader",
      ...Array<ProviderInfoKind>(credits.length).fill("credit"),
      undefined,
    ]);
  });

  it.each([
    ["reversed mismatched artist", "等什么君 - 关山酒"],
    ["non-exact conflicting version", "关山酒 (Remix) - 等什么君"],
  ])("classifies a structurally proven leading header despite %s", (_name, header) => {
    const context: ProviderLineSemanticContext = {
      reference: {
        id: "关山酒",
        title: "关山酒",
        artists: ["小魂"],
        album: "关山酒",
        durationMs: 220_000,
      },
      selected: {
        title: "关山酒",
        artists: ["小魂"],
      },
    };
    const result = markEmbeddedProviderInfo(lineLyrics([
      header,
      "词：Yoki",
      "曲：乐金震",
      "first lyric",
    ], "kugou"), "kugou", context);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", undefined]);
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
    const context = providerLineSemanticContext(LUO_TIAN_YI.reference, {
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
    const context: ProviderLineSemanticContext = {
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

  it("treats an exact leading title as the header when its credited artist set is partial", () => {
    const context: ProviderLineSemanticContext = {
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

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", undefined]);
  });

  it("recovers 食语人间 through one bounded provider-title annotation", () => {
    const context: ProviderLineSemanticContext = {
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
    const context: ProviderLineSemanticContext = {
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
    const context: ProviderLineSemanticContext = {
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
    const context: ProviderLineSemanticContext = {
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

  it("treats an exact leading title as the header when the credited singer differs", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "乐鸣东方 - another singer",
      "作词：Alice",
      "作曲：Bob",
      "编曲：Carol",
      "first lyric",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", "credit", undefined]);
  });

  it("classifies a first-row header above one proven direct credit", () => {
    const context: ProviderLineSemanticContext = {
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

    expect(kinds(result)).toEqual(["trackHeader", "credit", undefined]);
  });

  it.each(["Studio Song (Live)", "Studio Song (2022Ver.)"])(
    "classifies a structurally proven version-shaped header without catalog-title agreement: %s",
    (header) => {
      const context: ProviderLineSemanticContext = {
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

      expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", undefined]);
    },
  );

  it("marks an exact header and independently anchored block after authoritative leading credits", () => {
    const context: ProviderLineSemanticContext = {
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
    ["one following direct credit", "卦象怎判-洛天依/乐正绫", ["编曲：李兀"]],
  ] as const)("keeps an unmatched header visible while classifying %s", (_name, header, following) => {
    const context: ProviderLineSemanticContext = {
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

    expect(kinds(result)).toEqual([
      "credit",
      "credit",
      undefined,
      ...Array<ProviderInfoKind>(following.length).fill("credit"),
      undefined,
    ]);
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
    const context: ProviderLineSemanticContext = {
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
      "第一句歌词",
      "最后一句歌词",
      "Lyrics: Alice",
      "Composer: Bob",
      "FOH+录音: Carol",
    ]), "kugou", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, undefined, "credit", "credit", "credit"]);
  });

  it("counts stable compound role heads without enumerating the unknown labels they anchor", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "作词/作曲：Alice",
      "PGM：Bob",
      "first lyric",
    ], "qq"), "qq", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["credit", "credit", undefined]);
  });

  it("classifies proven common credit labels independently at any document position", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "开场歌词",
      "开场歌词续句",
      "作词：Alice",
      "第一句歌词",
      "第二句歌词",
      "第三句歌词",
      "制作人：Bob",
      "第四句歌词",
      "第五句歌词",
      "第六句歌词",
      "Lyrics by: Carol",
      "收尾歌词",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([
      undefined,
      undefined,
      "credit",
      undefined,
      undefined,
      undefined,
      "credit",
      undefined,
      undefined,
      undefined,
      "credit",
      undefined,
    ]);
  });

  it.each(["qq", "kugou"] as const)(
    "classifies an exact artist-valued 歌 row as a bounded performance credit for %s",
    (provider) => {
      const context: ProviderLineSemanticContext = {
        reference: {
          id: "spotify-whale",
          title: "クーネル・エンゲイザー",
          artists: ["電ǂ鯨", "琴葉茜・葵", "根音ネネ"],
          album: "クーネル・エンゲイザー",
          durationMs: 240_000,
        },
        selected: {
          title: "クーネル・エンゲイザー",
          artists: ["電ǂ鯨", "琴葉茜・葵", "根音ネネ"],
        },
      };
      const result = markEmbeddedProviderInfo(lineLyrics([
        "first lyric",
        "second lyric",
        "歌：電ǂ鯨",
        "third lyric",
      ], provider), provider, context);

      expect(kinds(result)).toEqual([undefined, undefined, "credit", undefined]);
    },
  );

  it.each([
    "歌：歌",
    "歌：別人",
    "歌：電ǂ鯨と琴葉茜",
    "この歌：電ǂ鯨",
  ])("keeps an unproven 歌-shaped row visible: %s", (text) => {
    const context: ProviderLineSemanticContext = {
      reference: {
        id: "spotify-whale",
        title: "クーネル・エンゲイザー",
        artists: ["電ǂ鯨"],
        album: "クーネル・エンゲイザー",
        durationMs: 240_000,
      },
      selected: { title: "クーネル・エンゲイザー", artists: ["電ǂ鯨"] },
    };
    const result = markEmbeddedProviderInfo(lineLyrics([text]), "netease", context);
    expect(kinds(result)).toEqual([undefined]);
  });

  it("classifies a validated obscure-label island without an exact direct-label seed", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "第一句歌词",
      "第二句歌词",
      "混音&母带：Alice",
      "原作信息如下：",
      "曲绘：Bob",
      "最后一句歌词",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, undefined, "credit", "credit", "credit", undefined]);
  });

  it("classifies a native bare title above a proven leading credit block", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "草木青时",
      "演唱：星尘Infinity",
      "混音：落华",
      "原作信息如下：",
      "制作人：叶萱",
      "第一句歌词",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["trackHeader", "credit", "credit", "credit", "credit", undefined]);
  });

  it.each([
    ["本歌曲来自企划【天依游学记】", "netease"],
    ["「一日还」 原创国风音乐企划", "kugou"],
  ] as const)("classifies a bounded project attribution beside a validated block: %s", (attribution, provider) => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "第一句歌词",
      "最后一句歌词",
      "混音&母带：Alice",
      "录音棚：Studio",
      attribution,
    ]), provider, LUO_TIAN_YI);

    expect(kinds(result)).toEqual([undefined, undefined, "credit", "credit", "credit"]);
  });

  it.each([
    ["platform promotion", ["最后一句歌词", "本歌曲来自〖网易音乐人〗", "10亿现金激励！", "合作：st399@vip.163.com"]],
    ["unanchored project wording", ["本歌曲来自企划【天依游学记】", "第一句歌词"]],
  ] as const)("keeps %s visible", (_name, texts) => {
    const result = markEmbeddedProviderInfo(lineLyrics([...texts]), "netease", LUO_TIAN_YI);
    expect(kinds(result)).toEqual(Array(texts.length).fill(undefined));
  });

  it("keeps three-row gaps visible while retaining independently proven credits", () => {
    const result = markEmbeddedProviderInfo(lineLyrics([
      "作词：Alice",
      "one",
      "two",
      "three",
      "作曲：Bob",
    ]), "netease", LUO_TIAN_YI);

    expect(kinds(result)).toEqual(["credit", undefined, undefined, undefined, "credit"]);
  });

  it.each([
    ["section heading", ["[Chorus]", "sing it again", "first lyric"]],
    ["duet and empty-value cues", ["Alice/Bob：", "Alice：hello", "Bob：world"]],
    ["colon lyric and dialogue", ["喧笑：突然安静", "甲：你好吗", "乙：我很好"]],
    ["unknown unanchored block", ["PGM: Alice", "DJ: Bob", "FOH+录音: Carol", "第一句歌词"]],
    ["loose Lyricify er false positives", ["water: falling", "summer: rain", "第一句歌词"]],
    ["incomplete rights wording", ["最后一句歌词", "版权所有"]],
  ])("abstains from %s", (_name, texts) => {
    const result = markEmbeddedProviderInfo(lineLyrics(texts), "netease", LUO_TIAN_YI);
    expect(kinds(result)).toEqual(Array(texts.length).fill(undefined));
  });
});

describe("structural first-row track headers", () => {
  const header = "国风堂、排骨教主、银临、Winky诗、不才、三无Marblue、KBShinya - 江山行歌";
  const credits = ["作词：慕清明", "作曲：陈致逸/张燕峰", "编曲：闫津"];
  const cityRows = [
    "【北京】排骨教主",
    "【南京】银临",
    "【杭州】Winky诗",
    "【西安】不才",
    "【成都】三无MarBlue",
    "【广州】KBShinya",
  ];
  const reference: ProviderLineSemanticContext["reference"] = {
    id: "7eb16VbQPt3Ii4UAhq8yBY",
    title: "江山行歌",
    artists: ["三无Marblue", "排骨教主", "銀臨", "不才", "KBShinya", "赵景旭（Winky诗）"],
    album: "江山行歌",
    durationMs: 265_000,
  };
  const selected = {
    title: "江山行歌",
    artists: ["排骨教主", "银临", "winky诗", "不才", "三无MarBlue", "KB"],
  };

  it("classifies the reverse KuGou header without selected native artist-group plumbing", () => {
    const context = providerLineSemanticContext(reference, selected);
    const result = markEmbeddedProviderInfo(
      syllableLyrics([header, ...credits, ...cityRows, "柳絮躲四合院里歇脚"], "kugou"),
      "kugou",
      context,
    );

    expect(kinds(result)).toEqual([
      "trackHeader",
      "credit", "credit", "credit",
      ...Array(cityRows.length).fill(undefined),
      undefined,
    ]);
  });

  it.each([
    [
      "QQ 日不落 live header",
      "qq",
      "日不落(Live)-蔡依林(Jolin Tsai)",
      ["词：崔惟楷", "曲：Bard,Alexander Bengt Magnus,Anders Hansson "],
      "日不落",
      "日不落",
    ],
    [
      "KuGou サクラ・ホライズン reverse header",
      "kugou",
      "坂上なち - サクラ・ホライズン",
      ["词：Haruka", "曲：ZUN", "编曲：Masayoshi Minoshima"],
      "サクラ・ホライズン",
      "サクラ・ホライズン feat.nachi (BEATLESS)",
    ],
    [
      "KuGou 舞娘 live header",
      "kugou",
      "舞娘 (Live) - 蔡依林 (Jolin Tsai)",
      ["词：陈镇川", "曲：Miriam Nervo/Liv Nervo/Greg Kursten"],
      "舞娘",
      "舞娘",
    ],
    [
      "NetEase 草木青时 bare header",
      "netease",
      "草木青时",
      ["演唱：星尘Infinity", "调校：早起又是好天气-", "混音：落华", "作词：慕清明"],
      "【星尘Infinity】草木青时【SYNTHESIZER V COVER】",
      "【星尘Infinity】草木青时【SYNTHESIZER V COVER】",
    ],
  ] as const)("classifies the exact corpus shape for %s", (
    _name,
    provider,
    corpusHeader,
    corpusCredits,
    referenceTitle,
    selectedTitle,
  ) => {
    const context = providerLineSemanticContext({
      id: referenceTitle,
      title: referenceTitle,
      artists: ["reference artist"],
      album: referenceTitle,
      durationMs: 240_000,
    }, {
      title: selectedTitle,
      artists: ["selected artist"],
    });
    const texts = [corpusHeader, ...corpusCredits, "first lyric"];
    const result = markEmbeddedProviderInfo(
      provider === "netease" ? lineLyrics(texts, provider) : syllableLyrics(texts, provider),
      provider,
      context,
    );

    expect(kinds(result)).toEqual([
      "trackHeader",
      ...Array<ProviderInfoKind>(corpusCredits.length).fill("credit"),
      undefined,
    ]);
  });

  it.each([
    ["standalone first row", "qq", ["Native Header", "first lyric"], [undefined, undefined]],
    ["first sung line with a later credit", "netease", ["first sung line", "second sung line", "作词：Alice", "last lyric"], [undefined, undefined, "credit", undefined]],
    ["empty-value speaker cue", "qq", ["男：", "作词：Alice", "first lyric"], [undefined, "credit", undefined]],
    ["dialogue row", "netease", ["甲：你好", "作词：Alice", "first lyric"], [undefined, "credit", undefined]],
    ["bracketed section row", "netease", ["[Chorus]", "Lyrics: Alice", "first lyric"], [undefined, "credit", undefined]],
    ["one obscure unproven row", "kugou", ["Native Header", "PGM：Alice", "first lyric"], [undefined, undefined, undefined]],
    ["title-like row outside row zero", "qq", ["first lyric", "Native Header", "Lyrics: Alice", "Composer: Bob", "last lyric"], [undefined, undefined, "credit", "credit", undefined]],
    ["ordinary Soda opening", "soda", ["ordinary opening", "next lyric"], [undefined, undefined]],
  ] as const)("abstains from %s", (_name, provider, texts, expected) => {
    const result = markEmbeddedProviderInfo(lineLyrics([...texts], provider), provider, LUO_TIAN_YI);
    expect(kinds(result)).toEqual(expected);
  });

  it("keeps NetEase sung-title rows ordinary after authoritative leading credits", () => {
    const result = lineLyrics([
      "作词: “hitman”bang",
      "作曲: “hitman”bang",
      "총맞은것처럼",
      "총맞은 것처럼 정말",
      "총맞은것처럼",
    ], "netease");
    for (const line of (result.Content as Array<Record<string, unknown>>).slice(0, 2)) {
      line.ProviderInfoKind = "credit";
    }

    markEmbeddedProviderInfo(result, "netease", {
      reference: {
        id: "spotify-shot",
        title: "총맞은것처럼",
        artists: ["Baek Z Young"],
        album: "Sensibility",
        durationMs: 240_000,
      },
      selected: { title: "총맞은것처럼", artists: ["백지영"] },
    });

    expect(kinds(result)).toEqual(["credit", "credit", undefined, undefined, undefined]);
  });
});
