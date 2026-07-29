import * as KuromojiAnalyzer from "../../KuromojiAnalyzer.ts";
import { applyKuromojiReadingOverrides } from "./KuromojiReadingPolicy.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
  JapaneseMorphologyFeature,
  JapanesePartOfSpeech,
} from "./JapaneseAnalyzer.ts";
import { assertJapaneseAnalyzerTokens } from "./JapaneseAnalyzer.ts";

const HIRAGANA_VOWEL: Record<string, string> = {
  あ: "あ",
  か: "あ",
  が: "あ",
  さ: "あ",
  ざ: "あ",
  た: "あ",
  だ: "あ",
  な: "あ",
  は: "あ",
  ば: "あ",
  ぱ: "あ",
  ま: "あ",
  や: "あ",
  ら: "あ",
  わ: "あ",
  ぁ: "あ",
  ゃ: "あ",
  い: "い",
  き: "い",
  ぎ: "い",
  し: "い",
  じ: "い",
  ち: "い",
  ぢ: "い",
  に: "い",
  ひ: "い",
  び: "い",
  ぴ: "い",
  み: "い",
  り: "い",
  ゐ: "い",
  ぃ: "い",
  う: "う",
  く: "う",
  ぐ: "う",
  す: "う",
  ず: "う",
  つ: "う",
  づ: "う",
  ぬ: "う",
  ふ: "う",
  ぶ: "う",
  ぷ: "う",
  む: "う",
  ゆ: "う",
  る: "う",
  ゔ: "う",
  ぅ: "う",
  ゅ: "う",
  え: "え",
  け: "え",
  げ: "え",
  せ: "え",
  ぜ: "え",
  て: "え",
  で: "え",
  ね: "え",
  へ: "え",
  べ: "え",
  ぺ: "え",
  め: "え",
  れ: "え",
  ゑ: "え",
  ぇ: "え",
  お: "お",
  こ: "お",
  ご: "お",
  そ: "お",
  ぞ: "お",
  と: "お",
  ど: "お",
  の: "お",
  ほ: "お",
  ぼ: "お",
  ぽ: "お",
  も: "お",
  よ: "お",
  ろ: "お",
  を: "お",
  ぉ: "お",
  ょ: "お",
};

export function normalizeJapaneseKana(text: string): string {
  let output = "";
  const hiragana = (text || "").replace(/[ァ-ン]/gu, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
  for (const char of Array.from(hiragana)) {
    if (char !== "ー") {
      output += char;
      continue;
    }
    const previous = Array.from(output).pop() || "";
    output += HIRAGANA_VOWEL[previous] || "ー";
  }
  return output;
}

function kanaReading(surface: string, candidate: string): string {
  const reading =
    candidate && candidate !== "*" ? candidate : /^[ぁ-んァ-ンー・]+$/u.test(surface) ? surface : "";
  return normalizeJapaneseKana(reading);
}

function normalizePartOfSpeech(raw: string): JapanesePartOfSpeech {
  if (raw === "名詞") return "noun";
  if (raw === "代名詞") return "pronoun";
  if (raw === "動詞") return "verb";
  if (raw === "助動詞") return "auxiliaryVerb";
  if (raw === "助詞") return "particle";
  if (raw === "接尾辞" || raw === "接尾") return "suffix";
  return "other";
}

function normalizeMorphologyFeatures(
  rawPartOfSpeech: string,
  rawDetail1: string,
  rawDetail2: string
): JapaneseMorphologyFeature[] {
  const features: JapaneseMorphologyFeature[] = [];
  if (rawDetail1 === "接続助詞") features.push("conjunctiveParticle");
  if (rawDetail1 === "非自立") features.push("nonIndependent");
  if (
    rawPartOfSpeech === "接尾辞" ||
    rawPartOfSpeech === "接尾" ||
    rawDetail1 === "接尾"
  ) {
    features.push("suffix");
  }
  if (rawPartOfSpeech === "名詞" && rawDetail1 === "数") features.push("numeric");
  if (
    rawPartOfSpeech === "名詞" &&
    rawDetail1 === "接尾" &&
    rawDetail2 === "助数詞"
  ) {
    features.push("counter");
  }
  if (rawDetail2 === "人名") features.push("properName");
  return features;
}

export function normalizeKuromojiTokens(
  text: string,
  rawTokens: readonly KuromojiAnalyzer.KuromojiToken[]
): JapaneseAnalyzerToken[] {
  let cursor = 0;
  const tokens = rawTokens.map((rawToken) => {
    const surface = rawToken.surface_form || "";
    const foundAt = surface ? text.indexOf(surface, cursor) : cursor;
    const start = foundAt >= cursor ? foundAt : cursor;
    const end = start + surface.length;
    const token: JapaneseAnalyzerToken = {
      surface,
      start,
      end,
      readingKana: kanaReading(surface, rawToken.reading || rawToken.pronunciation || ""),
      pronunciationKana: kanaReading(surface, rawToken.pronunciation || rawToken.reading || ""),
      partOfSpeech: normalizePartOfSpeech(rawToken.pos || ""),
      morphologyFeatures: normalizeMorphologyFeatures(
        rawToken.pos || "",
        rawToken.pos_detail_1 || "",
        rawToken.pos_detail_2 || ""
      ),
      baseForm: rawToken.basic_form || "",
      conjugationType: rawToken.conjugated_type || "",
      conjugationForm: rawToken.conjugated_form || "",
      provenance: {
        analyzerId: "kuromoji",
        analyzerVersion: "1.0.0-wrapper",
        dictionaryId: "kuromoji.pkgs.spikerko.org",
        rangeSource: "surfaceAligned",
        ...(rawToken.verbose?.word_id === undefined
          ? {}
          : { nativeWordId: rawToken.verbose.word_id }),
        ...(rawToken.verbose?.word_type === undefined
          ? {}
          : { nativeWordType: rawToken.verbose.word_type }),
        ...(rawToken.verbose?.word_position === undefined
          ? {}
          : { nativeWordPosition: rawToken.verbose.word_position }),
        ...(rawToken.pos ? { rawPartOfSpeech: rawToken.pos } : {}),
        ...(rawToken.pos_detail_1 ? { rawPartOfSpeechDetail1: rawToken.pos_detail_1 } : {}),
        ...(rawToken.pos_detail_2 ? { rawPartOfSpeechDetail2: rawToken.pos_detail_2 } : {}),
      },
    };
    cursor = end;
    return token;
  });
  assertJapaneseAnalyzerTokens(text, tokens);
  return tokens;
}

export const kuromojiJapaneseAnalyzer: JapaneseAnalyzer = {
  id: "kuromoji",
  applyReadingOverrides: applyKuromojiReadingOverrides,
  async analyze(text) {
    return normalizeKuromojiTokens(text, await KuromojiAnalyzer.parse(text));
  },
};
