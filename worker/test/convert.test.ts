import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { attachSidecars, attachTimedSidecars, parseLrc, toLineLyrics, toLineLyricsFromRows, toStaticLyrics, toSyllableLyrics } from "../src/convert";
import { dedupeProviderCredits, extractByCredit, isAutomatedByCredit } from "../src/credits";
import { decryptKrc, parseKrc } from "../src/providers/kugou";
import { parseQrc, qrcContent } from "../src/providers/qq";
import { neteaseProviderCredits, parseNeteaseLrc, parseNeteaseYrc, parseYrc } from "../src/providers/netease";

describe("native syllable-sync conversion", () => {
  it("parses QRC absolute word timings", () => {
    const lines = parseQrc("[1000,1000]你(1000,400)好(1400,600)");
    expect(lines[0].words.map((word) => word.text)).toEqual(["你", "好"]);
    expect(toSyllableLyrics(lines, "qq")?.Type).toBe("Syllable");
  });

  it("preserves zero-duration text and literal token concatenation across structured formats", () => {
    const fixtures = [
      parseQrc("[1000,1000]D(1000,300)/(1300,0)N(1300,300)/(1600,0)A(1600,400)"),
      parseKrc("[1000,1000]<0,300,0>D<300,0,0>/<300,300,0>N<600,0,0>/<600,400,0>A"),
      parseYrc("[1000,1000](1000,300,0)D(1300,0,0)/(1300,300,0)N(1600,0,0)/(1600,400,0)A"),
    ];

    for (const lines of fixtures) {
      expect(lines[0].words.map((word) => word.text).join("")).toBe("D/N/A");
      expect(lines[0].words.filter((word) => word.text === "/").map((word) => word.durationMs)).toEqual([0, 0]);

      const lyrics = toSyllableLyrics(lines, "qq") as any;
      const syllables = lyrics.Content[0].Lead.Syllables;
      expect(syllables.map((word: any) => word.Text).join("")).toBe("D/N/A");
      expect(syllables.every((word: any) => word.IsPartOfWord === true)).toBe(true);
      expect(syllables.filter((word: any) => word.Text === "/").every(
        (word: any) => word.StartTime === word.EndTime,
      )).toBe(true);
    }
  });

  it("maps provider-authored whitespace across formats and scripts without character inference", () => {
    const fixtures = [
      parseQrc("[1000,1000]I (1000,250)used(1250,250)你 (1500,250)好(1750,250)私 (2000,250)の(2250,250)"),
      parseKrc("[1000,1500]<0,250,0>I <250,250,0>used<500,250,0>你 <750,250,0>好<1000,250,0>私 <1250,250,0>の"),
      parseYrc("[1000,1500](1000,250,0)I (1250,250,0)used(1500,250,0)你 (1750,250,0)好(2000,250,0)私 (2250,250,0)の"),
    ];

    for (const lines of fixtures) {
      const syllables = (toSyllableLyrics(lines, "qq") as any).Content[0].Lead.Syllables;
      expect(syllables.map((word: any) => word.Text).join(""))
        .toBe("I used你 好私 の");
      expect(syllables.map((word: any) => word.IsPartOfWord))
        .toEqual([false, true, false, true, false, true]);
    }
  });

  it("preserves structured title and credit rows as ordinary timed lyrics", () => {
    const fixtures = [
      parseQrc(
        "[0,2000]Title - Artist(0,2000)\n[2000,1000]词(2000,300)：(2300,200)Stack(2500,500)\n[3000,1000]曲(3000,300)：(3300,200)ZUN(3500,500)\n[4000,1000]first lyric(4000,1000)",
      ),
      parseKrc(
        "[0,2000]<0,2000,0>Title - Artist\n[2000,1000]<0,300,0>词<300,200,0>：<500,500,0>Stack\n[3000,1000]<0,300,0>曲<300,200,0>：<500,500,0>ZUN\n[4000,1000]<0,1000,0>first lyric",
      ),
      parseYrc(
        "[0,2000](0,2000,0)Title - Artist\n[2000,1000](2000,300,0)词(2300,200,0)：(2500,500,0)Stack\n[3000,1000](3000,300,0)曲(3300,200,0)：(3500,500,0)ZUN\n[4000,1000](4000,1000,0)first lyric",
      ),
    ];

    for (const lines of fixtures) {
      const lyrics = toSyllableLyrics(lines, "qq") as any;
      expect(lyrics.Content.every((line: any) =>
        line.Lead.IsProviderInfo === undefined &&
        line.Lead.IsMetadata === undefined
      )).toBe(true);
      expect(lyrics.Content.map((line: any) =>
        line.Lead.Syllables.map((word: any) => word.Text).join("")))
        .toEqual(["Title - Artist", "词：Stack", "曲：ZUN", "first lyric"]);
      expect(lyrics.Content.slice(0, 3).map((line: any) => [
        line.Lead.StartTime,
        line.Lead.EndTime,
      ])).toEqual([[0, 2], [2, 3], [3, 4]]);
    }
  });

  it("maps the captured QQ title spaces to Spicy's trailing-boundary contract", () => {
    const lyrics = toSyllableLyrics(parseQrc(
      "[0,26309]Shout (0,2391)It (2392,2391)Out (4784,2391)Loud!!! - (7175,2391)暁(9567,9567)Records ((19134,2391)akatsuki (21526,2391)records)(23918,2391)\n"
      + "[26310,7174]词(26310,2391)：(28701,2391)Stack(31093,2391)\n"
      + "[33485,11964]曲(33485,7175)：(40660,2391)ZUN(43052,2397)\n"
      + "[45450,1949]声(45450,513)も(45963,185)上(46148,137)げ(46285,143)ら(46428,143)れ(46571,185)ず(46756,159)に(46915,484)",
    ), "qq") as any;
    const title = lyrics.Content[0].Lead;

    expect(lyrics.Content.every((line: any) =>
      line.Lead.IsProviderInfo === undefined &&
      line.Lead.IsMetadata === undefined
    )).toBe(true);
    expect(title.Syllables.map((word: any) => word.Text).join(""))
      .toBe("Shout It Out Loud!!! - 暁Records (akatsuki records)");
    expect(title.Syllables.map((word: any) => word.IsPartOfWord))
      .toEqual([false, false, false, false, true, true, false, true]);
    expect(title.Syllables.map((word: any) => [word.StartTime, word.EndTime]))
      .toEqual([
        [0, 2.391],
        [2.392, 4.783],
        [4.784, 7.175],
        [7.175, 9.566],
        [9.567, 19.134],
        [19.134, 21.525],
        [21.526, 23.917],
        [23.918, 26.309],
      ]);
  });

  it("does not guess semantic roles from arbitrary QQ label text", () => {
    const lyrics = toSyllableLyrics(parseQrc(
      "[885,3648]晚(885,288)夜(1173,170)微(1343,230)雨(1573,224)问(1797,224)海(2021,248)棠(2269,136) - (2405,136)镜(2541,248)予(2789,280)歌(3069,216)\n"
      + "[4533,744]词(4533,256)：(4789,0)唐(4789,248)酱(5037,240)\n"
      + "[6909,1064]编(6909,216)曲(7125,217)：(7342,0)Mzf(7342,208)小(7550,216)慕(7766,207)\n"
      + "[10661,1024]二(10661,200)胡(10861,208)：(11069,0)辰(11069,200)小(11269,192)弦(11461,224)\n"
      + "[11685,665]混(11685,501)音(12186,32)：(12218,0)圣(12218,33)雨(12251,32)轻(12283,35)纱(12318,32)\n"
      + "[36385,2567]喧(36385,225)笑(36610,1447)：(38056,1)\n"
      + "[38952,2000]那(38952,500)年(39452,500)风(39952,500)吹(40452,500)",
    ), "qq") as any;

    expect(lyrics.Content.every((line: any) =>
      line.Lead.IsProviderInfo === undefined &&
      line.Lead.IsMetadata === undefined
    )).toBe(true);
    expect(lyrics.Content.map((line: any) =>
      line.Lead.Syllables.map((word: any) => word.Text).join("")
    )).toEqual([
      "晚夜微雨问海棠 - 镜予歌",
      "词：唐酱",
      "编曲：Mzf小慕",
      "二胡：辰小弦",
      "混音：圣雨轻纱",
      "喧笑：",
      "那年风吹",
    ]);
  });

  it("does not demote ordinary lyrics when no compact intro-credit block exists", () => {
    const lyrics = toSyllableLyrics(parseQrc(
      "[0,1000]first lyric(0,1000)\n[1000,1000]second lyric(1000,1000)",
    ), "qq") as any;

    expect(lyrics.Content.every((line: any) => line.Lead.IsMetadata === undefined)).toBe(true);
  });

  it("keeps zero-duration punctuation attached while honoring its authored following space", () => {
    const lines = parseYrc(
      "[1000,1000](1000,300,0)Lately(1300,0,0), (1300,300,0)I've(1600,400,0) arrived",
    );
    const syllables = (toSyllableLyrics(lines, "netease") as any).Content[0].Lead.Syllables;

    expect(syllables.map((word: any) => word.Text).join(""))
      .toBe("Lately, I've arrived");
    expect(syllables.map((word: any) => word.IsPartOfWord))
      .toEqual([true, false, false, true]);
    expect(syllables[1]).toMatchObject({ Text: ", ", StartTime: 1.3, EndTime: 1.3 });
  });

  it("keeps TIAN TIAN English boundaries exactly where QRC authored spaces", () => {
    const lines = parseQrc(
      "[1000,3000]I (1000,300)used (1300,400)to (1700,300)think (2000,400)it's (2400,300)not (2700,300)worth (3000,500)it(3500,500)",
    );
    const syllables = (toSyllableLyrics(lines, "qq") as any).Content[0].Lead.Syllables;

    expect(syllables.map((word: any) => word.Text).join("")).toBe("I used to think it's not worth it");
    expect(syllables.map((word: any) => word.IsPartOfWord)).toEqual([
      false, false, false, false, false, false, false, true,
    ]);
  });

  it("represents a standalone timed space as one boundary on the preceding visible fragment", () => {
    const lines = parseQrc("[1000,1000]A(1000,300) (1300,0)B(1300,700)");
    const syllables = (toSyllableLyrics(lines, "qq") as any).Content[0].Lead.Syllables;

    expect(syllables.map((word: any) => word.Text)).toEqual(["A", " ", "B"]);
    expect(syllables.map((word: any) => word.IsPartOfWord)).toEqual([false, true, true]);
  });

  it("preserves source fragment order even when provider timings overlap", () => {
    const lyrics = toSyllableLyrics([{
      startMs: 1000,
      durationMs: 1000,
      words: [
        { text: "A", startMs: 1200, durationMs: 300 },
        { text: "/", startMs: 1100, durationMs: 0 },
        { text: "B", startMs: 1500, durationMs: 500 },
      ],
    }], "qq") as any;

    expect(lyrics.Content[0].Lead.Syllables.map((word: any) => word.Text).join(""))
      .toBe("A/B");
  });

  it("keeps any nonempty instantaneous fragment, not only slash punctuation", () => {
    const lines = parseQrc("[1000,1000]A(1000,300)()(1300,0)- (1300,0)B(1300,700)");

    expect(lines[0].words.map((word) => [word.text, word.durationMs])).toEqual([
      ["A", 300],
      ["()", 0],
      ["- ", 0],
      ["B", 700],
    ]);
  });

  it("preserves parenthetical and XML-sensitive text inside QRC words", () => {
    const wrapped = '<QrcInfos><LyricInfo LyricContent="[1000,1000](whisper &amp; echo) &lt;hi&gt;(1000,1000)" /></QrcInfos>';
    const lines = parseQrc(qrcContent(wrapped) ?? "");

    expect(lines[0].words).toEqual([
      { text: "(whisper & echo) <hi>", startMs: 1000, durationMs: 1000 },
    ]);
  });

  it("preserves literal brackets in all structured formats", () => {
    expect(parseQrc("[1000,1000](demo) hello)(1000,1000)")[0].words[0].text).toBe("(demo) hello)");
    expect(parseKrc("[1000,1000]<0,1000,0>(demo) hello)")[0].words[0].text).toBe("(demo) hello)");
    expect(parseYrc("[1000,1000](1000,1000,0)(demo) hello)")[0].words[0].text).toBe("(demo) hello)");
  });

  it("preserves punctuation and literal markup across timed lyric formats", () => {
    const text = "colon: slash / parens (demo) close) square [hook] angle <tag>";
    expect(parseQrc(`[1000,1000]${text}(1000,1000)`)[0].words[0].text).toBe(text);
    expect(parseKrc(`[1000,1000]<0,1000,7>${text}`)[0].words[0].text).toBe(text);
    expect(parseYrc(`[1000,1000](1000,1000,7)${text}`)[0].words[0].text).toBe(text);
    expect(parseLrc(`[00:01.000]${text}`)).toEqual([{ startMs: 1000, text }]);
  });

  it("preserves literal bracketed LRC text after one or more leading timestamps", () => {
    expect(parseLrc(
      "[ar:Metadata only]\n[00:01.000][00:02.500][Chorus] left / right: (echo)",
    )).toEqual([
      { startMs: 1000, text: "[Chorus] left / right: (echo)" },
      { startMs: 2500, text: "[Chorus] left / right: (echo)" },
    ]);
  });

  it("parses colon-separated LRC centiseconds without changing decimal timestamps", () => {
    expect(parseLrc("[00:23:71]colon fraction\n[00:24.125]decimal fraction")).toEqual([
      { startMs: 23_710, text: "colon fraction" },
      { startMs: 24_125, text: "decimal fraction" },
    ]);
  });

  it("validates the KRC header and strips only an actual UTF-8 BOM", () => {
    const key = Uint8Array.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);
    const compressed = deflateSync(Buffer.from("\uFEFF[1000,1000]<0,1000,0>whole", "utf8"));
    const encrypted = Buffer.from(compressed.map((byte, index) => byte ^ key[index % key.length]));
    const encoded = Buffer.concat([Buffer.from("krc1", "ascii"), encrypted]).toString("base64");

    expect(decryptKrc(encoded)).toBe("[1000,1000]<0,1000,0>whole");
    expect(decryptKrc(Buffer.concat([Buffer.from("bad!", "ascii"), encrypted]).toString("base64"))).toBeUndefined();
  });

  it("applies provider offsets without discarding native syllable timing", () => {
    expect(parseQrc("[offset:250]\n[1000,1000]word(1000,1000)")[0]).toMatchObject({
      startMs: 1250,
      words: [{ text: "word", startMs: 1250, durationMs: 1000 }],
    });
    expect(parseKrc("[offset:-250]\n[1000,1000]<0,1000,0>word")[0]).toMatchObject({
      startMs: 750,
      words: [{ text: "word", startMs: 750, durationMs: 1000 }],
    });
    expect(parseYrc("[offset:250]\n[1000,1000](1000,1000,0)word")[0]).toMatchObject({
      startMs: 1250,
      words: [{ text: "word", startMs: 1250, durationMs: 1000 }],
    });
    expect(parseLrc("[offset:-250]\n[00:01.000]word")).toEqual([{ startMs: 750, text: "word" }]);
  });

  it("aligns native structured sidecars without converting them through LRC", () => {
    const primary = parseQrc("[1000,1000]你(1000,1000)");
    const translation = parseQrc("[1000,1000]you(1000,1000)");
    expect(attachTimedSidecars(primary, translation)[0].translation).toBe("you");
  });

  it("keeps KRC sidecars aligned when an earlier timed row has no words", () => {
    const language = Buffer.from(JSON.stringify({
      content: [
        { type: 1, lyricContent: [["T0"], ["T1"], ["T2"]] },
        { type: 0, lyricContent: [["R0"], ["R1"], ["R2"]] },
      ],
    })).toString("base64");
    const lines = parseKrc([
      `[language:${language}]`,
      "[0,1000]",
      "[1000,1000]<0,1000,0>A",
      "[2000,1000]<0,1000,0>B",
    ].join("\n"));

    expect(lines.map((line) => [
      line.words.map((word) => word.text).join(""),
      line.translation,
      line.romanization,
    ])).toEqual([
      ["A", "T1", "R1"],
      ["B", "T2", "R2"],
    ]);
  });

  it("preserves every token in KuGou language sidecar rows", () => {
    const language = Buffer.from(JSON.stringify({
      content: [
        { type: 1, lyricContent: [["仿佛", "是", "童话故事"]] },
        { type: 0, lyricContent: [["ma  ", "ru  ", "de "]] },
      ],
    })).toString("base64");

    const [line] = parseKrc([
      `[language:${language}]`,
      "[1000,1000]<0,1000,0>まるで御伽の話",
    ].join("\n"));

    expect(line.translation).toBe("仿佛是童话故事");
    expect(line.romanization).toBe("ma  ru  de ");
  });

  it("parses KRC relative word timings", () => {
    const lines = parseKrc("[1000,1000]<0,400,0>你<400,600,0>好");
    expect(lines[0].words[1].startMs).toBe(1400);
  });

  it("parses YRC absolute word timings", () => {
    const lines = parseYrc("[1000,1000](1000,400,0)你(1400,600,0)好");
    expect(lines[0].words[1].startMs).toBe(1400);
  });

  it("keeps translation and romanization on line-timed fallback lyrics", () => {
    const lyrics = toLineLyrics(
      "[00:01.00]original",
      3000,
      "netease",
      "[00:01.00]translation",
      "[00:01.00]romanization",
    ) as any;
    expect(lyrics.Content[0]).toMatchObject({
      ProviderTranslatedText: "translation",
      ProviderRomanizedText: "romanization",
      RomanizedText: "romanization",
    });
    expect(lyrics.Content[0].TranslatedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(true);
    expect(lyrics.HasProviderTranslations).toBe(true);
    expect(lyrics.IncludesRomanization).toBe(true);
  });

  it("does not advertise unmatched sidecars", () => {
    const lyrics = toLineLyrics(
      "[00:01.00]original",
      3000,
      "netease",
      "[00:10.00]too far away",
    ) as any;
    expect(lyrics.Content[0].ProviderTranslatedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(false);
  });

  it("treats a NetEase Cloud Music instrumental sentinel as no usable lyrics", () => {
    expect(toLineLyrics(
      "[00:00.00] 纯音乐，请欣赏。 ",
      180_000,
      "netease",
    )).toBeUndefined();

    expect(toSyllableLyrics([{
      startMs: 0,
      durationMs: 2000,
      words: [
        { text: "纯音乐", startMs: 0, durationMs: 800 },
        { text: ",请欣赏", startMs: 800, durationMs: 1200 },
      ],
    }], "netease")).toBeUndefined();
  });

  it("does not return a document whose typed rows contain no ordinary lyrics", () => {
    expect(toLineLyricsFromRows([
      { startMs: 0, text: "作曲: M2U", providerInfoKind: "credit" },
      { startMs: 1000, text: "人声: Vocalist", providerInfoKind: "credit" },
    ], 180_000, "netease")).toBeUndefined();
  });

  it("does not discard a real NetEase lyric document containing the sentinel text", () => {
    const lyrics = toLineLyrics(
      "[00:00.00]纯音乐，请欣赏\n[00:02.00]actual lyric",
      5000,
      "netease",
    ) as any;
    expect(lyrics.Content.map((line: any) => line.Text)).toEqual(["纯音乐，请欣赏", "actual lyric"]);
  });

  it("removes QQ marker-only lyric lines and sidecars", () => {
    const lines = attachSidecars([
      {
        startMs: 0,
        durationMs: 1000,
        words: [{ text: "//", startMs: 0, durationMs: 1000 }],
      },
      {
        startMs: 1000,
        durationMs: 1000,
        words: [{ text: "Hmm", startMs: 1000, durationMs: 1000 }],
      },
    ], "[00:00.00]translation for removed marker\n[00:01.00] ／／ ", "[00:01.00]//");
    const lyrics = toSyllableLyrics(lines, "qq") as any;

    expect(lyrics.Content).toHaveLength(1);
    expect(lyrics.Content[0].Lead.Syllables.map((word: any) => word.Text).join("")).toBe("Hmm");
    expect(lyrics.Content[0].Lead.ProviderTranslatedText).toBeUndefined();
    expect(lyrics.Content[0].Lead.ProviderRomanizedText).toBeUndefined();
    expect(lyrics.IncludesTranslation).toBe(false);
    expect(lyrics.IncludesRomanization).toBe(false);
  });

  it("preserves QQ lyric text that merely contains slashes", () => {
    const lyrics = toSyllableLyrics([{
      startMs: 0,
      durationMs: 1000,
      words: [{ text: "left // right", startMs: 0, durationMs: 1000 }],
      translation: "translation // note",
    }], "qq") as any;

    expect(lyrics.Content[0].Lead.Syllables[0].Text).toBe("left // right");
    expect(lyrics.Content[0].Lead.ProviderTranslatedText).toBe("translation // note");
  });

  it("preserves distinct NetEase Cloud Music synced-lyrics and translation contributors", () => {
    expect(neteaseProviderCredits({
      lyricUser: { userid: 6493075429, nickname: "Hendrix_u" },
      transUser: { userid: 270201970, nickname: "冰霜暗月" },
      tlyric: { lyric: "[by:冰霜暗月]\n[00:01.00]translation" },
    })).toEqual([
      { role: "syncedLyrics", name: "Hendrix_u", provider: "netease", userId: "6493075429" },
      { role: "translation", name: "冰霜暗月", provider: "netease", userId: "270201970" },
    ]);
  });

  it("uses translation by-tags only when richer contributor metadata is absent", () => {
    expect(neteaseProviderCredits({
      tlyric: { lyric: "[by:community editor]\n[00:01.00]translation" },
    })).toEqual([
      { role: "translation", name: "community editor", provider: "netease" },
    ]);
  });

  it("extracts and de-duplicates plain provider by-tags", () => {
    const credit = extractByCredit("[ti:title]\n[by:  contributor  ]\n[00:01.00]line", "lyrics", "qq");
    expect(dedupeProviderCredits([credit, credit])).toEqual([
      { role: "lyrics", name: "contributor", provider: "qq" },
    ]);
  });

  it("drops known automated by-tags without guessing ordinary contributor names", () => {
    expect(extractByCredit("[by:krc转trans工具]", "translation", "qq")).toBeUndefined();
    expect(extractByCredit("[by:krc转qrc工具]", "lyrics", "qq")).toBeUndefined();
    expect(extractByCredit("[by: 天琴实验室ＡＩ生成ｖ１．０ ]", "lyrics", "kugou")).toBeUndefined();
    expect(isAutomatedByCredit("天琴实验室AI生成v2.1")).toBe(true);
    expect(isAutomatedByCredit("天琴实验室")).toBe(false);
    expect(extractByCredit("[by:AIみどり]", "lyrics", "qq")).toEqual({
      role: "lyrics",
      name: "AIみどり",
      provider: "qq",
    });
  });

  it("aligns each sidecar row at most once", () => {
    const lines = attachSidecars([
      { startMs: 1000, durationMs: 100, words: [{ text: "one", startMs: 1000, durationMs: 100 }] },
      { startMs: 1100, durationMs: 100, words: [{ text: "two", startMs: 1100, durationMs: 100 }] },
    ], "[00:01.05]translation");

    expect(lines.map((line) => line.translation).filter(Boolean)).toEqual(["translation"]);
  });
});

describe("provider-info conversion contract", () => {
  const context = {
    reference: {
      id: "track",
      title: "Title",
      artists: ["Artist"],
      album: "Album",
      durationMs: 5_000,
    },
    selected: { title: "Title", artists: ["Artist"] },
  };

  it("carries markers through QRC, KRC, YRC, LRC, and static conversion", () => {
    const structured = [
      parseQrc("[0,1000]Title - Artist(0,1000)\n[1000,1000]Lyrics:(1000,200) Alice(1200,800)\n[2000,1000]Composer:(2000,200) Bob(2200,800)\n[3000,1000]first lyric(3000,1000)"),
      parseKrc("[0,1000]<0,1000,0>Title - Artist\n[1000,1000]<0,200,0>Lyrics:<200,800,0> Alice\n[2000,1000]<0,200,0>Composer:<200,800,0> Bob\n[3000,1000]<0,1000,0>first lyric"),
      parseYrc("[0,1000](0,1000,0)Title - Artist\n[1000,1000](1000,200,0)Lyrics:(1200,800,0) Alice\n[2000,1000](2000,200,0)Composer:(2200,800,0) Bob\n[3000,1000](3000,1000,0)first lyric"),
    ];
    for (const lines of structured) {
      const lyrics = toSyllableLyrics(lines, "qq", context) as any;
      expect(lyrics.Content.map((line: any) => line.Lead.ProviderInfoKind))
        .toEqual(["trackHeader", "credit", "credit", undefined]);
      expect(lyrics.Content.map((line: any) => line.Lead.Syllables.map((word: any) => word.Text).join("")))
        .toEqual(["Title - Artist", "Lyrics: Alice", "Composer: Bob", "first lyric"]);
    }

    const lrc = toLineLyrics(
      "[00:00.00]Lyrics: Alice\n[00:01.00]Composer: Bob\n[00:02.00]first lyric",
      3_000,
      "netease",
      undefined,
      undefined,
      context,
    ) as any;
    expect(lrc.Content.map((line: any) => line.ProviderInfoKind))
      .toEqual(["credit", "credit", undefined]);

    const plain = toStaticLyrics("Lyrics: Alice\nComposer: Bob\nfirst lyric", "soda", context) as any;
    expect(plain.Lines.map((line: any) => line.ProviderInfoKind))
      .toEqual(["credit", "credit", undefined]);
  });

  it("preserves NetEase YRC JSON credits at any position and exact writer segments", () => {
    const parsed = parseNeteaseYrc([
      JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "Brent Kutzle" }, { tx: "/" }, { tx: "Ryan Tedder" }] }),
      "[1000,1000](1000,1000,0)first lyric",
      JSON.stringify({ t: 2100, c: [{ tx: "编曲: " }, { tx: "Producer" }] }),
      "[3000,1000](3000,1000,0)last lyric",
    ].join("\n"));
    const lyrics = toSyllableLyrics(parsed.lines, "netease") as any;

    expect(parsed.songWriters).toEqual(["Brent Kutzle", "Ryan Tedder"]);
    expect(lyrics.Content.map((line: any) => ({
      text: line.Lead.Syllables.map((word: any) => word.Text).join(""),
      kind: line.Lead.ProviderInfoKind,
      start: line.Lead.StartTime,
      end: line.Lead.EndTime,
    }))).toEqual([
      { text: "作词: Brent Kutzle/Ryan Tedder", kind: "credit", start: 0, end: 0 },
      { text: "first lyric", kind: undefined, start: 1, end: 2 },
      { text: "编曲: Producer", kind: "credit", start: 2.1, end: 2.1 },
      { text: "last lyric", kind: undefined, start: 3, end: 4 },
    ]);
  });

  it("marks NetEase JSON metadata embedded between ordinary LRC rows", () => {
    const parsed = parseNeteaseLrc([
      "[00:01.00]first lyric",
      JSON.stringify({ t: 2000, c: [{ tx: "作词: " }, { tx: "Alice" }] }),
      "[00:03.00]last lyric",
    ].join("\n"));

    expect(parsed.songWriters).toEqual(["Alice"]);
    expect(parsed.lines).toEqual([
      { startMs: 1000, text: "first lyric" },
      { startMs: 2000, text: "作词: Alice", providerInfoKind: "credit" },
      { startMs: 3000, text: "last lyric" },
    ]);
  });

  it("preserves NetEase JSON credits embedded in hybrid LRC without marking the following preface", () => {
    const parsed = parseNeteaseLrc([
      JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "释子" }, { tx: "/" }, { tx: "公子无琊" }] }),
      JSON.stringify({ t: 1000, c: [{ tx: "作曲: " }, { tx: "王韩一淋" }] }),
      "[00:08.705]编曲：向往",
      "[00:10.195]文案故事：康玉婷（网易云音乐用户@糖果超级咸）",
      "[00:11.763]/题记/",
      "[00:13.000]飞雁终渡万重山，远行的儿郎卸甲归家。",
      "[00:16.000]【哦漏】",
      "[00:17.000]first lyric",
    ].join("\n"));

    expect(parsed.songWriters).toEqual(["释子", "公子无琊"]);
    expect(parsed.lines.map((line) => ({ text: line.text, startMs: line.startMs }))).toEqual([
      { text: "作词: 释子/公子无琊", startMs: 0 },
      { text: "作曲: 王韩一淋", startMs: 1000 },
      { text: "编曲：向往", startMs: 8705 },
      { text: "文案故事：康玉婷（网易云音乐用户@糖果超级咸）", startMs: 10195 },
      { text: "/题记/", startMs: 11763 },
      { text: "飞雁终渡万重山，远行的儿郎卸甲归家。", startMs: 13000 },
      { text: "【哦漏】", startMs: 16000 },
      { text: "first lyric", startMs: 17000 },
    ]);
  });

  it("classifies a provider header and anchored block after authoritative hybrid-LRC credits", () => {
    const parsed = parseNeteaseLrc([
      JSON.stringify({ t: -1000, c: [{ tx: "作词: " }, { tx: "盏月陆离" }] }),
      JSON.stringify({ t: -500, c: [{ tx: "作曲: " }, { tx: "盏月陆离" }] }),
      "[00:00.00] 卦象怎判-洛天依/乐正绫",
      "[00:05.47] 编曲：李兀",
      "[00:07.32] 歌姬：洛天依/乐正绫",
      "[00:09.18] 调教：盏月陆离",
      "[00:11.04] 混音：神曦",
      "[00:11.90] 监制：谢墨",
      "[00:12.91] 制作人：祭酒",
      "[00:13.81] 策划：盏月陆离",
      "[00:16.12] 龟甲在烈火里 烧出了裂纹",
    ].join("\n"));
    const lyrics = toLineLyricsFromRows(parsed.lines, 162_000, "netease", undefined, undefined, {
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
    }) as any;

    expect(lyrics.Content.map((line: any) => line.Text)).toEqual([
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
    expect(lyrics.Content.map((line: any) => line.ProviderInfoKind)).toEqual([
      "credit",
      "credit",
      "trackHeader",
      ...Array(7).fill("credit"),
      undefined,
    ]);
  });

  it("marks structured NetEase LRC credits authoritatively at both document edges", () => {
    const parsed = parseNeteaseLrc([
      JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "Alice" }] }),
      "[00:01.000]first lyric",
      JSON.stringify({ t: 3000, c: [{ tx: "人声: " }, { tx: "Bob" }] }),
    ].join("\n"));

    expect(parsed.lines).toEqual([
      { startMs: 0, text: "作词: Alice", providerInfoKind: "credit" },
      { startMs: 1000, text: "first lyric" },
      { startMs: 3000, text: "人声: Bob", providerInfoKind: "credit" },
    ]);
  });

  it("preserves untimed NetEase lyric bodies as an ordered static fallback", () => {
    const parsed = parseNeteaseLrc([
      JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "Ahmad Dhani" }] }),
      "Ku akui tubuhku melunglai",
      "Semakin lama semakin lemah",
    ].join("\n"));

    expect(parsed.lines).toEqual([]);
    expect(parsed.staticLines).toEqual([
      { text: "作词: Ahmad Dhani", providerInfoKind: "credit" },
      { text: "Ku akui tubuhku melunglai" },
      { text: "Semakin lama semakin lemah" },
    ]);
  });
});
