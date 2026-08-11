// Han-form evidence is useful only in document context: unified Han code
// points alone do not identify a language. The bounded form checks are adapted
// from Kashiyomi 4872ca1 (AGPL-3.0-only), without its NCM translation rule or
// broad lexical marker list.

import { CustomConverter } from "opencc-js/core";
import JapaneseShinjitaiForms from "opencc-js/dict/JPShinjitaiCharactersRev";
import { convertChineseText } from "../ChineseCharacterConversion.ts";

const traditionalToJapaneseForms = CustomConverter(JapaneseShinjitaiForms);

const japaneseOnlyHan = new Set([
  ...("戦伝転芸覚実対沢帰単変続読駅験廃髪桜楽薬塩満検険剣権観応圧総経絵浄拡" +
    "児図団囲壊焼犠関闘顕歯売栄営蛍労覧豊悪乗証歳処価仮気辺髄渋巻専従" +
    "縦奨繊荘蔵臓滝択逓鉄弐弁黙訳揺様謡頼竜緑隣霊齢暦錬"),
  ..."働込峠畑辻匂凪雫枠榊麿躾塀笹咲栃搾腺",
]);

export function countHanCodePoints(text: string): number {
  let count = 0;
  for (const character of text) {
    if (/\p{Script=Han}/u.test(character)) count += 1;
  }
  return count;
}

/** Chinese-specific simplified or traditional forms, not language proof. */
export function hasChineseOnlyHanForms(text: string): boolean {
  const traditional = convertChineseText(text, "traditional");
  return traditionalToJapaneseForms(traditional) !== text;
}

/** Japanese-specific shinjitai, kokuji, or the Japanese iteration mark. */
export function hasJapaneseOnlyHanForms(text: string): boolean {
  for (const character of text) {
    if (character === "々" || japaneseOnlyHan.has(character)) return true;
  }
  return false;
}
