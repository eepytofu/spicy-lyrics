import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pinyinOptionsForToneMode,
  romanizeCantonese,
  romanizeCyrillic,
  romanizeKorean,
  stripJyutpingTones,
} from "../src/utils/Lyrics/Fork/Romanization.ts";
import { cleanInvisibles } from "../src/utils/Lyrics/Fork/TextDetection.ts";

test("invisible lyric markers are cleaned before processing", () => {
  assert.equal(cleanInvisibles("This \u200Bis \u200Ba test"), "This is a test");
  assert.equal(cleanInvisibles("tell \u200Bme"), "tell me");
  assert.equal(cleanInvisibles("\uFEFFhello\u00A0world"), "hello world");
  assert.equal(cleanInvisibles("\u0915\u094D\u200D\u0937"), "\u0915\u094D\u200D\u0937");
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
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, true), { segment: false, group: true, style: 1 });
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, false), { segment: false, group: true, style: 0 });
  assert.deepEqual(pinyinOptionsForToneMode({}, true), { segment: false, group: true });
});

test("Korean spelling-mode corpus", () => {
  assert.equal(romanizeKorean("음악", "spelling"), "eumak");
  assert.equal(romanizeKorean("한국어", "spelling"), "hangukeo");
  assert.equal(romanizeKorean("학교", "spelling"), "hakgyo");
  assert.equal(romanizeKorean("백마", "spelling"), "baekma");
  assert.equal(romanizeKorean("안녕하세요", "spelling"), "annyeonghaseyo");
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

test("Cantonese polyphone gaps", async () => {
  assert.equal(await romanizeCantonese("看著電話中短訊", "yue", true, true), "hon3 zyu6 din6 waa6 zung1 dyun2 seon3");
});
