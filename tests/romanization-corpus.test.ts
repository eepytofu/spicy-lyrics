import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pinyinOptionsForToneMode,
  romanizeCantonese,
  romanizeCyrillic,
  romanizeKorean,
  stripJyutpingTones,
} from "../src/utils/Lyrics/Fork/Romanization.ts";
import { cleanInvisibles, scriptBranchForLine } from "../src/utils/Lyrics/Fork/TextDetection.ts";

const japaneseSongContext = {
  presentScripts: ["Japanese"] as const,
  primaryLanguage: "jpn",
  iso2Language: "ja",
};

const chineseSongContext = {
  presentScripts: ["Chinese"] as const,
  primaryLanguage: "zho",
  iso2Language: "zh",
};

const koreanSongContext = {
  presentScripts: ["Korean"] as const,
  primaryLanguage: "kor",
  iso2Language: "ko",
};

test("invisible lyric markers are cleaned before processing", () => {
  assert.equal(cleanInvisibles("This \u200Bis \u200Ba test"), "This is a test");
  assert.equal(cleanInvisibles("tell \u200Bme"), "tell me");
  assert.equal(cleanInvisibles("\uFEFFhello\u00A0world"), "hello world");
  assert.equal(cleanInvisibles("\u0915\u094D\u200D\u0937"), "\u0915\u094D\u200D\u0937");
});

test("romanization branch selection is line-scoped", () => {
  assert.deepEqual(
    scriptBranchForLine("Алдадыңбы", {
      presentScripts: ["Cyrillic"],
      primaryLanguage: "eng",
      iso2Language: "en",
    }),
    ["Cyrillic"]
  );
  assert.deepEqual(
    scriptBranchForLine("Let's go!", {
      presentScripts: ["Japanese"],
      primaryLanguage: "jpn",
      iso2Language: "ja",
    }),
    []
  );
  assert.deepEqual(
    scriptBranchForLine("全宇宙全世界", {
      presentScripts: ["Japanese"],
      primaryLanguage: "jpn",
      iso2Language: "ja",
    }),
    ["Japanese"]
  );
  assert.deepEqual(
    scriptBranchForLine("텅 빈 말 더는 늘어놓지 말고", {
      presentScripts: ["Korean"],
      primaryLanguage: "kor",
      iso2Language: "ko",
    }),
    ["Korean"]
  );
});

test("real mixed and glued lyric lines select per-line romanization branches", () => {
  assert.deepEqual(scriptBranchForLine("だんだん剥がれてく Fake のゴールドメッキ", japaneseSongContext), ["Japanese"]);
  assert.deepEqual(scriptBranchForLine("说不出的sorry", chineseSongContext), ["Chinese"]);
  assert.deepEqual(scriptBranchForLine("Tonight 이제 너를 놓아줄게", koreanSongContext), ["Korean"]);
});

test("Latin apostrophe and vocable lines do not select a romanization branch", () => {
  assert.deepEqual(scriptBranchForLine("It's fxxking hard to say it, goodbye", japaneseSongContext), []);
  assert.deepEqual(scriptBranchForLine("Hoo, ah, ah", chineseSongContext), []);
  assert.deepEqual(scriptBranchForLine("Whoa, whoa 我在每 夜 徹 夜 狂 想", chineseSongContext), ["Chinese"]);
});

test("Cantonese Jyutping phrase corpus", async () => {
  assert.equal(
    await romanizeCantonese("上堂終於講到分數", "yue", true, true),
    "soeng5 tong4 zung1 jyu1 gong2 dou3 fan1 sou3"
  );
  assert.equal(
    await romanizeCantonese("開會剩低嘅嘢我會搞掂㗎喇", "yue", true, true),
    "hoi1 wui2 zing6 dai1 ge3 je5 ngo5 wui5 gaau2 dim6 gaa3 laa3"
  );
  assert.equal(await romanizeCantonese("香港A", "yue", true, true), "hoeng1 gong2 A");
});

test("Chinese tone toggle strips only Jyutping tone digits", async () => {
  assert.equal(await romanizeCantonese("你好", "yue", true, true), "nei5 hou2");
  assert.equal(await romanizeCantonese("你好", "yue", true, false), "nei hou");
  assert.equal(stripJyutpingTones("nei5 hou2 remix 2026"), "nei hou remix 2026");
});

test("Chinese tone toggle selects pinyin style when the package exposes constants", () => {
  const pinyin = { STYLE_TONE: 1, STYLE_NORMAL: 0 };
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, true), { segment: true, group: false, style: 1 });
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, false), { segment: true, group: false, style: 0 });
  assert.deepEqual(pinyinOptionsForToneMode({}, true), { segment: true, group: false });
});

test("Korean spelling-mode corpus", () => {
  assert.equal(romanizeKorean("음악", "spelling"), "eumak");
  assert.equal(romanizeKorean("한국어", "spelling"), "hangukeo");
  assert.equal(romanizeKorean("학교", "spelling"), "hakgyo");
  assert.equal(romanizeKorean("백마", "spelling"), "baekma");
  assert.equal(romanizeKorean("안녕하세요", "spelling"), "annyeong haseyo");
  assert.equal(romanizeKorean("사랑", "spelling"), "sarang");
  assert.equal(romanizeKorean("BTS feat. IU", "spelling"), "BTS feat. IU");
});

test("Korean pronunciation-mode corpus", () => {
  assert.equal(romanizeKorean("음악", "pronunciation"), "eumak");
  assert.equal(romanizeKorean("한국어", "pronunciation"), "hangugeo");
  assert.equal(romanizeKorean("강아지", "pronunciation"), "gangaji");
  assert.equal(romanizeKorean("해돋이", "pronunciation"), "haedoji");
  assert.equal(romanizeKorean("같이", "pronunciation"), "gachi");
  assert.equal(romanizeKorean("백마", "pronunciation"), "baengma");
  assert.equal(romanizeKorean("국물", "pronunciation"), "gungmul");
  assert.equal(romanizeKorean("독립", "pronunciation"), "dongnip");
  assert.equal(romanizeKorean("신라", "pronunciation"), "silla");
  assert.equal(romanizeKorean("종로", "pronunciation"), "jongno");
  assert.equal(romanizeKorean("좋고", "pronunciation"), "joko");
  assert.equal(romanizeKorean("좋아", "pronunciation"), "joa");
  assert.equal(romanizeKorean("음악 rock", "pronunciation"), "eumak rock");
});

test("Korean readability spacing", () => {
  assert.equal(romanizeKorean("안녕하세요", "spelling"), "annyeong haseyo");
  assert.equal(romanizeKorean("안녕하세요", "pronunciation"), "annyeong haseyo");
  assert.equal(romanizeKorean("텅 빈 말 더는 늘어놓지 말고", "spelling"), "teong bin mal deoneun neuleonotji malgo");
  assert.equal(romanizeKorean("감사합니다", "spelling"), "gamsa hapnida");
});

test("Korean real-line corpus", () => {
  assert.equal(romanizeKorean("더 이상 기댈 곳은 필요 없어", "spelling"), "deo isang gidael goteun pilyo eopseo");
  assert.equal(romanizeKorean("더 이상 기댈 곳은 필요 없어", "pronunciation"), "deo isang gidael goseun piryo eopseo");

  const repeated = "Had enough? Had enough? Oh";
  assert.equal(romanizeKorean(repeated, "spelling"), "Had enough? Had enough? Oh");
  assert.equal(romanizeKorean(repeated, "spelling"), romanizeKorean(repeated, "spelling"));
});

test("Cyrillic corpus", () => {
  assert.equal(romanizeCyrillic("Елена"), "Yelena");
  assert.equal(romanizeCyrillic("Достоевский"), "Dostoyevskiy");
  assert.equal(romanizeCyrillic("Сергеевна"), "Sergeyevna");
  assert.equal(romanizeCyrillic("ё"), "yo");
  assert.equal(romanizeCyrillic("объект"), "obyekt");
  assert.equal(romanizeCyrillic("мягкий"), "myagkiy");
  assert.equal(romanizeCyrillic("Привет rock'n'roll"), "Privet rock'n'roll");
  assert.equal(romanizeCyrillic("гора", "Ukrainian", false), "hora");
  assert.equal(romanizeCyrillic("Київ", "Ukrainian", false), "Kyyiv");
  assert.equal(romanizeCyrillic("Україна", "Ukrainian", false), "Ukrayina");
  assert.equal(romanizeCyrillic("ґанок", "Ukrainian", false), "ganok");
  assert.equal(romanizeCyrillic("гора", "Russian", false), "gora");
  assert.equal(romanizeCyrillic("день", "Russian", false), "den");
  assert.equal(romanizeCyrillic("день", "Russian", true), "denʹ");
  assert.equal(romanizeCyrillic("объект", "Russian", true), "obʺyekt");
});

test("Cyrillic real-line corpus", () => {
  assert.equal(
    romanizeCyrillic("Я помню каждый миг, что было когда-то между нами,"),
    "Ya pomnyu kazhdyy mig, chto bylo kogda-to mezhdu nami,"
  );
  assert.equal(romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —"), "Ty, ty, ty, ty, ty, ty, ty, ty —");
  assert.equal(
    romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —"),
    romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —")
  );
  assert.equal(romanizeCyrillic("упрёков"), "upryokov");
  assert.equal(romanizeCyrillic("Чёрно-белый"), "Chyorno-belyy");
  assert.equal(romanizeCyrillic("Знаю — временно,"), "Znayu — vremenno,");
});

test("Central-Asian Cyrillic letters (Kyrgyz/Kazakh)", () => {
  assert.equal(romanizeCyrillic("Алдадыңбы"), "Aldadyngby");
  assert.equal(romanizeCyrillic("Чалбадыңбы"), "Chalbadyngby");
  assert.equal(romanizeCyrillic("Калбадыңбы жанымда"), "Kalbadyngby zhanymda");
  assert.equal(romanizeCyrillic("көңүл"), "kongul");
  assert.equal(romanizeCyrillic("Өмүр"), "Omur");
});

// Real-song Cantonese corpus: G.E.M. - Where Did U Go (traditional script, mixed English).
// See SpotifyPlus-mobilelyrics/docs/ROMANIZATION_REAL_CORPUS.md for the full categorized corpus.
test("Cantonese real-line corpus (Han-only lines)", async () => {
  assert.equal(await romanizeCantonese("難 藏 淚 印", "yue", true, true), "naan4 cong4 leoi6 jan3");
  assert.equal(
    await romanizeCantonese("這秒鐘 很掛牽 你 卻 不 可 感 覺 到", "yue", true, true),
    "ze5 miu5 zung1 han2 gwaa3 hin1 nei5 koek3 bat1 ho2 gam2 gok3 dou3"
  );
  // Pre-spaced source characters must not double-space the output.
  assert.equal(
    await romanizeCantonese("曾看著 同 星 空 閒 聊 吹 風", "yue", true, true),
    "cang4 hon3 zyu6 tung4 sing1 hung1 haan4 liu4 ceoi1 fung1"
  );
});

test("Cantonese mixed Latin lines keep English words intact", async () => {
  assert.equal(
    await romanizeCantonese("Where did you go 數數 多久 不 碰 到", "yue", true, true),
    "Where did you go sou2 sou3 do1 gau2 bat1 pung3 dou3"
  );
  assert.equal(
    await romanizeCantonese("Whoa, whoa 我在每 夜 徹 夜 狂 想", "yue", true, true),
    "Whoa, whoa ngo5 zoi6 mui5 je6 cit3 je6 kwong4 soeng2"
  );
});

test("Cantonese fullwidth punctuation real-line corpus", async () => {
  assert.equal(await romanizeCantonese("這秒鐘、很掛牽", "yue", true, true), "ze5 miu5 zung1 、 han2 gwaa3 hin1");
});

test("Cantonese polyphone gaps", async () => {
  assert.equal(await romanizeCantonese("看著電話中短訊", "yue", true, true), "hon3 zyu6 din6 waa6 zung1 dyun2 seon3");
});
