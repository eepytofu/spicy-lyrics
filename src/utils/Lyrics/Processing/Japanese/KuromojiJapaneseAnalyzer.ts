import * as KuromojiAnalyzer from "../../KuromojiAnalyzer.ts";
import { applyKuromojiReadingOverrides } from "./KuromojiReadingPolicy.ts";
import type {
  JapaneseAnalyzer,
  JapaneseAnalyzerToken,
  JapaneseMorphologyFeature,
  JapanesePartOfSpeech,
} from "./JapaneseAnalyzer.ts";
import { assertJapaneseAnalyzerTokens } from "./JapaneseAnalyzer.ts";
import {
  mayUseKatakanaOkurigana,
  normalizeJapaneseKana,
  projectKatakanaAsHiragana,
} from "./JapaneseKana.ts";

function kanaReading(surface: string, candidate: string): string {
  const reading =
    candidate && candidate !== "*" ? candidate : /^[ぁ-んァ-ンー・]+$/u.test(surface) ? surface : "";
  return normalizeJapaneseKana(reading);
}

function normalizePartOfSpeech(raw: string, detail1: string): JapanesePartOfSpeech {
  if (raw === "代名詞" || (raw === "名詞" && detail1 === "代名詞")) return "pronoun";
  if (raw === "名詞") return "noun";
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
      partOfSpeech: normalizePartOfSpeech(
        rawToken.pos || "",
        rawToken.pos_detail_1 || ""
      ),
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
        dictionaryId: "ipadic-2.7.0-20070801",
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

type KuromojiTokenize = (
  text: string,
) => Promise<readonly KuromojiAnalyzer.KuromojiToken[]>;

const HAN_OR_ITERATION_MARK = /[\p{Script=Han}\u3005]/u;
const KATAKANA_ONLY = /^[\u30a1-\u30f6\u30fc]+$/u;
const NON_WORD = /^[\s\p{P}\p{S}]+$/u;

function nativeWordType(token: KuromojiAnalyzer.KuromojiToken): string {
  return token.verbose?.word_type || token.word_type || "";
}

function analysisPenalty(tokens: readonly KuromojiAnalyzer.KuromojiToken[]): number {
  let penalty = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const surface = token.surface_form || "";
    if (nativeWordType(token) === "UNKNOWN" && surface && !NON_WORD.test(surface)) {
      penalty += 4;
    }
    if (
      HAN_OR_ITERATION_MARK.test(surface)
      && (!token.reading || token.reading === "*")
    ) {
      penalty += 8;
    }
    const next = tokens[index + 1];
    if (
      HAN_OR_ITERATION_MARK.test(surface)
      && token.pos_detail_1 === "接尾"
      && next
      && KATAKANA_ONLY.test(next.surface_form || "")
      && nativeWordType(next) === "UNKNOWN"
    ) {
      penalty += 3;
    }
  }
  return penalty;
}

function hasProjectedOkuriganaEvidence(
  tokens: readonly KuromojiAnalyzer.KuromojiToken[],
): boolean {
  return tokens.some((token) => {
    const surface = token.surface_form || "";
    return HAN_OR_ITERATION_MARK.test(surface) && /[\u3041-\u3096]/u.test(surface);
  });
}

function projectTokensToSource(
  sourceText: string,
  analysisText: string,
  tokens: readonly JapaneseAnalyzerToken[],
): JapaneseAnalyzerToken[] {
  if (sourceText === analysisText) return [...tokens];
  const projected = tokens.map((token) => ({
    ...token,
    surface: sourceText.slice(token.start, token.end),
  }));
  assertJapaneseAnalyzerTokens(sourceText, projected);
  return projected;
}

/**
 * Retry only old-style all-Katakana inflection as Hiragana and keep it only
 * when Kuromoji produces strictly stronger dictionary evidence. Display text
 * and UTF-16 ranges always remain the provider's exact source.
 */
export async function analyzeKuromojiText(
  text: string,
  tokenize: KuromojiTokenize,
): Promise<JapaneseAnalyzerToken[]> {
  const originalRaw = await tokenize(text);
  let analysisText = text;
  let selectedRaw = originalRaw;
  const originalPenalty = analysisPenalty(originalRaw);
  if (originalPenalty > 0 && mayUseKatakanaOkurigana(text)) {
    const projectedText = projectKatakanaAsHiragana(text);
    const projectedRaw = await tokenize(projectedText);
    if (
      hasProjectedOkuriganaEvidence(projectedRaw)
      && analysisPenalty(projectedRaw) < originalPenalty
    ) {
      analysisText = projectedText;
      selectedRaw = projectedRaw;
    }
  }
  return projectTokensToSource(
    text,
    analysisText,
    normalizeKuromojiTokens(analysisText, selectedRaw),
  );
}

export const kuromojiJapaneseAnalyzer: JapaneseAnalyzer = {
  id: "kuromoji",
  applyReadingOverrides: applyKuromojiReadingOverrides,
  async analyze(text) {
    return analyzeKuromojiText(text, KuromojiAnalyzer.parse);
  },
};
