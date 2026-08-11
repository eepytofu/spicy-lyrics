import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { attachSidecars, attachTimedSidecars, parseLrc, toLineLyrics, toStaticLyrics, toSyllableLyrics } from "../src/convert";
import { dedupeProviderCredits, extractByCredit, isAutomatedByCredit } from "../src/credits";
import { decryptKrc, parseKrc } from "../src/providers/kugou";
import { parseQrc, qrcContent } from "../src/providers/qq";
import { neteaseProviderCredits, parseNeteaseYrc, parseYrc } from "../src/providers/netease";

describe("native word-sync conversion", () => {
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

  it("marks a compact structured title and credit block without changing text or timing", () => {
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
      const lyrics = toSyllableLyrics(lines, "qq", {
        id: "track", title: "Title", artists: ["Artist"], album: "", durationMs: 5_000,
      }) as any;
      expect(lyrics.Content.map((line: any) =>
        line.Lead.Syllables.map((word: any) => word.Text).join("")))
        .toEqual(["Title - Artist", "词：Stack", "曲：ZUN", "first lyric"]);
      expect(lyrics.Content.map((line: any) => line.Lead.ProviderInfoKind))
        .toEqual(["trackHeader", "credit", "credit", undefined]);
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
    ), "qq", {
      id: "track",
      title: "Shout It Out Loud!!!",
      artists: ["暁Records (akatsuki records)"],
      album: "",
      durationMs: 48_000,
    }) as any;
    const title = lyrics.Content[0].Lead;

    expect(lyrics.Content.map((line: any) => line.Lead.ProviderInfoKind))
      .toEqual(["trackHeader", "credit", "credit", undefined]);
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

  it("marks reviewed QQ roles while keeping an unknown 喧笑 cue as lyrics", () => {
    const lyrics = toSyllableLyrics(parseQrc(
      "[885,3648]晚(885,288)夜(1173,170)微(1343,230)雨(1573,224)问(1797,224)海(2021,248)棠(2269,136) - (2405,136)镜(2541,248)予(2789,280)歌(3069,216)\n"
      + "[4533,744]词(4533,256)：(4789,0)唐(4789,248)酱(5037,240)\n"
      + "[6909,1064]编(6909,216)曲(7125,217)：(7342,0)Mzf(7342,208)小(7550,216)慕(7766,207)\n"
      + "[10661,1024]二(10661,200)胡(10861,208)：(11069,0)辰(11069,200)小(11269,192)弦(11461,224)\n"
      + "[11685,665]混(11685,501)音(12186,32)：(12218,0)圣(12218,33)雨(12251,32)轻(12283,35)纱(12318,32)\n"
      + "[36385,2567]喧(36385,225)笑(36610,1447)：(38056,1)\n"
      + "[38952,2000]那(38952,500)年(39452,500)风(39952,500)吹(40452,500)",
    ), "qq", {
      id: "track",
      title: "晚夜微雨问海棠",
      artists: ["镜予歌"],
      album: "",
      durationMs: 42_000,
    }) as any;

    expect(lyrics.Content.map((line: any) => line.Lead.ProviderInfoKind)).toEqual([
      "trackHeader", "credit", "credit", "credit", "credit", undefined, undefined,
    ]);
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

  it("uses role coverage and block context instead of complete credit-label matches", () => {
    const lyrics = toStaticLyrics([
      "录音室：Studio A",
      "词/曲：Writer",
      "声嘶力竭：不必回头",
      "海伊：第一句",
      "喧笑：",
      "编曲：standalone credit outside a block",
    ].join("\n"), "netease") as any;

    expect(lyrics.Lines.map((line: any) => line.ProviderInfoKind)).toEqual([
      "credit",
      "credit",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("requires every compound role part to qualify", () => {
    const lyrics = toStaticLyrics([
      "词/曲：Writer",
      "编曲/和声编写：Arranger",
      "作词/张三：not a role compound",
    ].join("\n"), "qq") as any;

    expect(lyrics.Lines.map((line: any) => line.ProviderInfoKind)).toEqual([
      "credit",
      "credit",
      undefined,
    ]);
  });

  it("marks Tencent and strongly evidenced generic rights notices conservatively", () => {
    const lyrics = toStaticLyrics([
      "腾讯音乐娱乐集团享有本翻译作品的著作权",
      "未经版权所有者许可或授权，不得使用",
      "请勿喧笑：",
    ].join("\n"), "qq") as any;

    expect(lyrics.Lines.map((line: any) => line.ProviderInfoKind)).toEqual([
      "rightsNotice",
      "rightsNotice",
      undefined,
    ]);
  });

  it("preserves leading and trailing NetEase YRC JSON credits and extracts writer segments", () => {
    const parsed = parseNeteaseYrc([
      JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "Brent Kutzle" }, { tx: "/" }, { tx: "Ryan Tedder" }] }),
      "[1000,1000](1000,1000,0)first lyric",
      JSON.stringify({ t: 3000, c: [{ tx: "编曲: " }, { tx: "Producer" }] }),
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
      { text: "编曲: Producer", kind: "credit", start: 3, end: 3 },
    ]);
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

  it("validates the KRC header and strips only an actual UTF-8 BOM", () => {
    const key = Uint8Array.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);
    const compressed = deflateSync(Buffer.from("\uFEFF[1000,1000]<0,1000,0>whole", "utf8"));
    const encrypted = Buffer.from(compressed.map((byte, index) => byte ^ key[index % key.length]));
    const encoded = Buffer.concat([Buffer.from("krc1", "ascii"), encrypted]).toString("base64");

    expect(decryptKrc(encoded)).toBe("[1000,1000]<0,1000,0>whole");
    expect(decryptKrc(Buffer.concat([Buffer.from("bad!", "ascii"), encrypted]).toString("base64"))).toBeUndefined();
  });

  it("applies provider offsets without discarding native word timing", () => {
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
