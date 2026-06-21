import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pinyinOptionsForToneMode,
  romanizeCantonese,
  romanizeCyrillic,
  romanizeKorean,
  stripJyutpingTones,
} from "../src/utils/Lyrics/Fork/Romanization.ts";

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
