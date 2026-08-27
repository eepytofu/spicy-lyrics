const BASIC = new Map<string, string>([
  ["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"],
  ["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"],
  ["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"],
  ["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"],
  ["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"],
  ["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"],
  ["だ", "da"], ["ぢ", "ji"], ["づ", "zu"], ["で", "de"], ["ど", "do"],
  ["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"],
  ["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"],
  ["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"],
  ["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"],
  ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
  ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
  ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
  ["わ", "wa"], ["ゐ", "wi"], ["ゑ", "we"], ["を", "wo"], ["ん", "n"],
  ["ゔ", "vu"], ["ゟ", "yori"], ["ヿ", "koto"],
]);

const COMPOUND = new Map<string, string>([
  ["きゃ", "kya"], ["きゅ", "kyu"], ["きょ", "kyo"], ["きぇ", "kye"],
  ["ぎゃ", "gya"], ["ぎゅ", "gyu"], ["ぎょ", "gyo"], ["ぎぇ", "gye"],
  ["しゃ", "sha"], ["しゅ", "shu"], ["しょ", "sho"], ["しぇ", "she"],
  ["じゃ", "ja"], ["じゅ", "ju"], ["じょ", "jo"], ["じぇ", "je"],
  ["ぢゃ", "ja"], ["ぢゅ", "ju"], ["ぢょ", "jo"], ["ぢぇ", "je"],
  ["ちゃ", "cha"], ["ちゅ", "chu"], ["ちょ", "cho"], ["ちぇ", "che"],
  ["にゃ", "nya"], ["にゅ", "nyu"], ["にょ", "nyo"], ["にぇ", "nye"],
  ["ひゃ", "hya"], ["ひゅ", "hyu"], ["ひょ", "hyo"], ["ひぇ", "hye"],
  ["びゃ", "bya"], ["びゅ", "byu"], ["びょ", "byo"], ["びぇ", "bye"],
  ["ぴゃ", "pya"], ["ぴゅ", "pyu"], ["ぴょ", "pyo"], ["ぴぇ", "pye"],
  ["みゃ", "mya"], ["みゅ", "myu"], ["みょ", "myo"], ["みぇ", "mye"],
  ["りゃ", "rya"], ["りゅ", "ryu"], ["りょ", "ryo"], ["りぇ", "rye"],
  ["いぇ", "ye"], ["うぁ", "wa"], ["うぃ", "wi"], ["うぇ", "we"], ["うぉ", "wo"],
  ["くぁ", "kwa"], ["くぃ", "kwi"], ["くぇ", "kwe"], ["くぉ", "kwo"],
  ["ぐぁ", "gwa"], ["ぐぃ", "gwi"], ["ぐぇ", "gwe"], ["ぐぉ", "gwo"],
  ["すぃ", "si"], ["ずぃ", "zi"],
  ["つぁ", "tsa"], ["つぃ", "tsi"], ["つぇ", "tse"], ["つぉ", "tso"],
  ["てぃ", "ti"], ["とぅ", "tu"], ["てゅ", "tyu"],
  ["でぃ", "di"], ["どぅ", "du"], ["でゅ", "dyu"],
  ["ふぁ", "fa"], ["ふぃ", "fi"], ["ふぇ", "fe"], ["ふぉ", "fo"], ["ふゅ", "fyu"],
  ["ゔぁ", "va"], ["ゔぃ", "vi"], ["ゔぇ", "ve"], ["ゔぉ", "vo"], ["ゔゅ", "vyu"],
]);

const SMALL = new Map<string, string>([
  ["ぁ", "a"], ["ぃ", "i"], ["ぅ", "u"], ["ぇ", "e"], ["ぉ", "o"],
  ["ゃ", "ya"], ["ゅ", "yu"], ["ょ", "yo"], ["ゎ", "wa"],
  ["ㇰ", "ku"], ["ㇱ", "shi"], ["ㇲ", "su"], ["ㇳ", "to"], ["ㇴ", "nu"],
  ["ㇵ", "ha"], ["ㇶ", "hi"], ["ㇷ", "fu"], ["ㇸ", "he"], ["ㇹ", "ho"],
  ["ㇺ", "mu"], ["ㇻ", "ra"], ["ㇼ", "ri"], ["ㇽ", "ru"], ["ㇾ", "re"], ["ㇿ", "ro"],
]);

const VOICED_ITERATION = new Map<string, string>([
  ["か", "が"], ["き", "ぎ"], ["く", "ぐ"], ["け", "げ"], ["こ", "ご"],
  ["さ", "ざ"], ["し", "じ"], ["す", "ず"], ["せ", "ぜ"], ["そ", "ぞ"],
  ["た", "だ"], ["ち", "ぢ"], ["つ", "づ"], ["て", "で"], ["と", "ど"],
  ["は", "ば"], ["ひ", "び"], ["ふ", "ぶ"], ["へ", "べ"], ["ほ", "ぼ"],
]);

function hiragana(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x30a1 && codePoint <= 0x30f6
    ? String.fromCodePoint(codePoint - 0x60)
    : character === "ヽ" ? "ゝ" : character === "ヾ" ? "ゞ" : character;
}

function finalVowel(value: string): string | undefined {
  return /([aeiou])[^aeiou]*$/u.exec(value)?.[1];
}

/** Focused ASCII Modified Hepburn used by the Japanese reading pipeline. */
export function romanizeJapaneseKana(input: string): string {
  const characters = [...input.normalize("NFC").replace(/[ｦ-ﾟ]+/gu, (run) => run.normalize("NFKC"))]
    .map(hiragana);
  let output = "";
  let previousVowel: string | undefined;
  let previousKana: string | undefined;

  for (let index = 0; index < characters.length; ) {
    const character = characters[index];
    if (character === "っ") {
      const following = COMPOUND.get(`${characters[index + 1] ?? ""}${characters[index + 2] ?? ""}`)
        ?? BASIC.get(characters[index + 1] ?? "");
      if (following && !/^[aeiouny]/u.test(following)) {
        output += following.startsWith("ch") ? "t" : following[0];
      } else if (!following) {
        // A tokenizer may isolate sokuon from the Kana it doubles. Preserve
        // the cutoff until the merge stage can either consume it before the
        // following token or retain it at the end of the utterance.
        output += "'";
      }
      index += 1;
      continue;
    }
    if (character === "ん") {
      const following = COMPOUND.get(`${characters[index + 1] ?? ""}${characters[index + 2] ?? ""}`)
        ?? BASIC.get(characters[index + 1] ?? "");
      output += following && /^[aeiouy]/u.test(following) ? "n'" : "n";
      previousVowel = undefined;
      index += 1;
      continue;
    }
    if (character === "ー") {
      output += previousVowel ?? "-";
      index += 1;
      continue;
    }
    if (character === "ゝ" || character === "ゞ") {
      const repeated = character === "ゞ" && previousKana
        ? VOICED_ITERATION.get(previousKana) ?? previousKana
        : previousKana;
      const repeatedRomanized = repeated ? BASIC.get(repeated) : undefined;
      output += repeatedRomanized ?? character;
      previousVowel = repeatedRomanized ? finalVowel(repeatedRomanized) : undefined;
      previousKana = repeated;
      index += 1;
      continue;
    }
    const pair = `${character}${characters[index + 1] ?? ""}`;
    const romanized = COMPOUND.get(pair) ?? BASIC.get(character) ?? SMALL.get(character);
    if (romanized) {
      output += romanized;
      previousVowel = finalVowel(romanized);
      previousKana = character;
      index += COMPOUND.has(pair) ? 2 : 1;
      continue;
    }
    output += character;
    previousVowel = undefined;
    previousKana = undefined;
    index += 1;
  }
  return output;
}
