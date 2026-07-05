/**
 * Context-first Japanese readings.
 *
 * This module owns Japanese token analysis and emits plain data only. Renderers
 * decide how to display it; no ruby/HTML strings leave this file.
 */

import Kuroshiro from "kuroshiro";
import * as KuromojiAnalyzer from "../KuromojiAnalyzer.ts";
import {
  applyContextualReadingOverrides,
  applyPhoneticMerges,
  computeNoSpaceBefore,
  type MergeableEntry,
} from "../Fork/JukujikunMerge.ts";

export type FuriganaSegment = {
  start: number;
  end: number;
  reading: string;
};

export type JapaneseReading = {
  sourceText: string;
  romaji?: string;
  furigana: FuriganaSegment[];
};

export type JapaneseReadable = {
  Text?: string;
  TransliteratedText?: string;
  RomanizedText?: string;
  JapaneseReading?: JapaneseReading;
  RomajiSpaceBefore?: boolean;
};

export type ProcessedTextEntry = JapaneseReadable & {
  Text: string;
  TranslatedText?: string;
};

export type TimedTextEntry = ProcessedTextEntry & {
  StartTime: number;
  EndTime: number;
  OppositeAligned?: boolean;
};

export type TimedSyllableEntry = JapaneseReadable & {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
};

export type TimedSyllableGroup = JapaneseReadable & {
  StartTime: number;
  EndTime: number;
  Syllables: TimedSyllableEntry[];
  TranslatedText?: string;
};

export const JapaneseSourceTextTest = /[぀-ヿ一-鿿]/;
export const JapaneseKanaTextTest = /[ぁ-んァ-ン]/;
export const KanjiTextTest = /[一-鿿々]/;
const KanjiLikeCharTest = /[一-鿿々]/;
const KanjiLikeSequenceTest = /^[一-鿿々]+$/;

const HIRAGANA_VOWEL: Record<string, string> = {
  あ: "あ", か: "あ", が: "あ", さ: "あ", ざ: "あ", た: "あ", だ: "あ", な: "あ", は: "あ", ば: "あ", ぱ: "あ", ま: "あ", や: "あ", ら: "あ", わ: "あ", ぁ: "あ", ゃ: "あ",
  い: "い", き: "い", ぎ: "い", し: "い", じ: "い", ち: "い", ぢ: "い", に: "い", ひ: "い", び: "い", ぴ: "い", み: "い", り: "い", ゐ: "い", ぃ: "い",
  う: "う", く: "う", ぐ: "う", す: "う", ず: "う", つ: "う", づ: "う", ぬ: "う", ふ: "う", ぶ: "う", ぷ: "う", む: "う", ゆ: "う", る: "う", ゔ: "う", ぅ: "う", ゅ: "う",
  え: "え", け: "え", げ: "え", せ: "え", ぜ: "え", て: "え", で: "え", ね: "え", へ: "え", べ: "え", ぺ: "え", め: "え", れ: "え", ゑ: "え", ぇ: "え",
  お: "お", こ: "お", ご: "お", そ: "お", ぞ: "お", と: "お", ど: "お", の: "お", ほ: "お", ぼ: "お", ぽ: "お", も: "お", よ: "お", ろ: "お", を: "お", ぉ: "お", ょ: "お",
};

type TokenFuriganaReading = {
  text: string;
  targetStart: number;
  targetEnd: number;
};

type JapaneseTokenEntry = MergeableEntry & {
  start: number;
  end: number;
  surface: string;
  readingKana: string;
  furigana?: TokenFuriganaReading;
};

type JapaneseTokenContext = {
  tokens: any[];
  entries: JapaneseTokenEntry[];
  noSpaceBefore: boolean[];
};

const tokenPos1 = (token: any): string => token?.pos || token?.part_of_speech || token?.pos_detail_1 || "";

function normalizeHiraganaLongMarks(text: string): string {
  let output = "";
  for (const char of Array.from(text)) {
    if (char !== "ー") {
      output += char;
      continue;
    }
    const previous = Array.from(output).pop() || "";
    output += HIRAGANA_VOWEL[previous] || "ー";
  }
  return output;
}

function kataToHira(text: string): string {
  return normalizeHiraganaLongMarks(
    text.replace(/[ァ-ン]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
  );
}

function contextualKanaReading(surface: string, reading: string): string {
  return kataToHira(reading || "");
}

function kanaReadingSegments(surface: string, reading: string): TokenFuriganaReading[] {
  const kana = contextualKanaReading(surface, reading);
  if (!kana || kana === "*") return [];

  const normalizedSurface = kataToHira(surface);
  const chars = Array.from(normalizedSurface);

  if (normalizedSurface.includes("々") && KanjiLikeSequenceTest.test(normalizedSurface)) {
    return [{ text: kana, targetStart: 0, targetEnd: chars.length }];
  }

  if (KanjiLikeSequenceTest.test(normalizedSurface) && chars.length > 1) {
    return [{ text: kana, targetStart: 0, targetEnd: chars.length }];
  }

  const segments: TokenFuriganaReading[] = [];
  let kanaCursor = 0;
  let charIndex = 0;

  while (charIndex < chars.length) {
    const char = chars[charIndex];

    if (/[ぁ-んァ-ンー]/.test(char)) {
      if (kana[kanaCursor] === char) kanaCursor += 1;
      charIndex += 1;
      continue;
    }

    if (!KanjiLikeCharTest.test(char)) {
      charIndex += 1;
      continue;
    }

    const start = charIndex;
    while (charIndex < chars.length && KanjiLikeCharTest.test(chars[charIndex])) charIndex += 1;
    const end = charIndex;
    const nextKana = chars.slice(charIndex).find((c) => /[ぁ-んー]/.test(c));
    const readingStart = kanaCursor;

    if (nextKana) {
      const nextIndex = kana.indexOf(nextKana, kanaCursor);
      kanaCursor = nextIndex >= 0 ? nextIndex : kana.length;
    } else {
      kanaCursor = kana.length;
    }

    const text = kana.slice(readingStart, kanaCursor);
    if (!text) continue;

    segments.push({ text, targetStart: start, targetEnd: end });
  }

  return segments;
}

function kanaReadingForToken(surface: string, reading: string): TokenFuriganaReading | undefined {
  let kana = contextualKanaReading(surface, reading);
  if (!kana || kana === "*") return undefined;

  let normalizedSurface = kataToHira(surface);
  let targetStart = 0;
  let targetEnd = normalizedSurface.length;

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const last = normalizedSurface[normalizedSurface.length - 1];
    if (!/[ぁ-んー]/.test(last) || !kana.endsWith(last)) break;
    normalizedSurface = normalizedSurface.slice(0, -1);
    kana = kana.slice(0, -1);
    targetEnd -= 1;
  }

  while (normalizedSurface.length > 0 && kana.length > 0) {
    const first = normalizedSurface[0];
    if (!/[ぁ-んー]/.test(first) || !kana.startsWith(first)) break;
    normalizedSurface = normalizedSurface.slice(1);
    kana = kana.slice(1);
    targetStart += 1;
  }

  return KanjiLikeCharTest.test(normalizedSurface) && kana
    ? { text: kana, targetStart, targetEnd }
    : undefined;
}

function entryRomaji(entry: JapaneseTokenEntry, token: any, kanaToRomaji: (kana: string) => string): string {
  if (tokenPos1(token) === "助詞") {
    if (entry.surface === "は") return "wa";
    if (entry.surface === "へ") return "e";
    if (entry.surface === "を") return "wo";
  }
  if (!entry.readingKana) return entry.surface;
  const romaji = kanaToRomaji(entry.readingKana);
  return romaji || entry.surface;
}

function furiganaSegmentAt(furigana: FuriganaSegment[], index: number): FuriganaSegment | undefined {
  return furigana.find((segment) => segment.end > segment.start && index >= segment.start && index < segment.end);
}

function readingFromProviderFurigana(
  sourceText: string,
  start: number,
  end: number,
  furigana: FuriganaSegment[]
): string | undefined {
  let reading = "";
  let usedProvider = false;
  let pos = start;
  while (pos < end) {
    const char = sourceText[pos];
    const segment = furiganaSegmentAt(furigana, pos);
    if (KanjiLikeCharTest.test(char) && segment && segment.start <= pos && segment.end > pos) {
      if (pos === segment.start) {
        reading += kataToHira(segment.reading);
        usedProvider = true;
      }
      pos = Math.min(end, segment.end);
      continue;
    }
    if (/[ぁ-んァ-ンー]/.test(char)) reading += kataToHira(char);
    pos += 1;
  }
  return usedProvider ? reading : undefined;
}

function applyProviderFuriganaOverrides(sourceText: string, entries: JapaneseTokenEntry[], furigana: FuriganaSegment[]): void {
  const sorted = [...furigana].sort((a, b) => a.start - b.start);
  for (const entry of entries) {
    const reading = readingFromProviderFurigana(sourceText, entry.start, entry.end, sorted);
    if (reading) entry.readingKana = reading;
  }
}

async function buildJapaneseTokenContext(lineText: string, _fullSpacedRomaji?: string): Promise<JapaneseTokenContext> {
  const tokens = await KuromojiAnalyzer.parse(lineText);
  const KUtil = (Kuroshiro as any).Util;
  const entries: JapaneseTokenEntry[] = [];
  let charPos = 0;

  for (let ti = 0; ti < tokens.length; ti += 1) {
    const surface: string = tokens[ti].surface_form || "";
    const reading: string = tokens[ti].reading || tokens[ti].pronunciation || "";
    const readingKana = contextualKanaReading(surface, reading);
    const entry: JapaneseTokenEntry = {
      start: charPos,
      end: charPos + surface.length,
      romaji: surface,
      surface,
      readingKana,
      furigana: kanaReadingForToken(surface, reading),
      consumed: false,
    };
    entry.romaji = entryRomaji(entry, tokens[ti], (kana) => KUtil.kanaToRomaji(kana));
    entries.push(entry);
    charPos += surface.length;
  }

  applyContextualReadingOverrides(entries, tokens);
  applyPhoneticMerges(entries, tokens);

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].consumed) continue;
    for (let j = i + 1; j < entries.length && entries[j].consumed; j += 1) {
      entries[i].end = entries[j].end;
      if (!entries[i].furigana && entries[j].furigana) entries[i].furigana = entries[j].furigana;
    }
  }

  return {
    tokens,
    entries,
    noSpaceBefore: computeNoSpaceBefore(entries, tokens),
  };
}

export async function romanizeJapaneseFromFurigana(
  text: string,
  furigana: FuriganaSegment[],
  romajiPromise?: Promise<void>
): Promise<string | undefined> {
  const sourceText = (text || "").normalize("NFKC");
  if (!JapaneseSourceTextTest.test(sourceText) || furigana.length === 0) return undefined;

  await romajiPromise;
  const context = await buildJapaneseTokenContext(sourceText);
  const KUtil = (Kuroshiro as any).Util;
  applyProviderFuriganaOverrides(sourceText, context.entries, furigana);
  applyContextualReadingOverrides(context.entries, context.tokens);
  for (let i = 0; i < context.entries.length; i += 1) {
    context.entries[i].romaji = entryRomaji(context.entries[i], context.tokens[i], (kana) => KUtil.kanaToRomaji(kana));
  }
  applyPhoneticMerges(context.entries, context.tokens);
  return buildRomajiFromContext(context);
}

function buildRomajiFromContext(context: JapaneseTokenContext): string | undefined {
  const parts: string[] = [];
  for (let i = 0; i < context.entries.length; i += 1) {
    const entry = context.entries[i];
    if (entry.consumed || !entry.romaji) continue;
    if (parts.length > 0 && !context.noSpaceBefore[i]) parts.push(" ");
    parts.push(entry.romaji);
  }
  const romaji = parts.join("").replace(/\s{2,}/g, " ").trim();
  return romaji || undefined;
}

function buildFuriganaFromContext(lineText: string, context: JapaneseTokenContext): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const seen = new Set<string>();

  for (const entry of context.entries) {
    if (entry.consumed) continue;
    const tokenSegments = kanaReadingSegments(entry.surface, entry.readingKana);
    const fallbackSegments = tokenSegments.length > 0 ? tokenSegments : (entry.furigana ? [entry.furigana] : []);

    for (const segment of fallbackSegments) {
      const start = Math.max(0, Math.min(lineText.length, entry.start + segment.targetStart));
      const end = Math.max(start + 1, Math.min(lineText.length, entry.start + segment.targetEnd));
      const key = `${start}:${end}:${segment.text}`;
      if (!segment.text || seen.has(key)) continue;
      seen.add(key);
      segments.push({ start, end, reading: segment.text });
    }
  }

  return segments.sort((a, b) => a.start - b.start || a.end - b.end);
}

export async function analyzeJapaneseLine(
  text: string,
  fullSpacedRomaji?: string,
  romajiPromise?: Promise<void>
): Promise<JapaneseReading | undefined> {
  const sourceText = (text || "").normalize("NFKC");
  if (!JapaneseSourceTextTest.test(sourceText)) return undefined;

  await romajiPromise;
  const context = await buildJapaneseTokenContext(sourceText, fullSpacedRomaji);
  const romaji = buildRomajiFromContext(context) || fullSpacedRomaji;
  const furigana = KanjiTextTest.test(sourceText) ? buildFuriganaFromContext(sourceText, context) : [];

  return {
    sourceText,
    romaji,
    furigana,
  };
}

export function clearLegacyFuriganaFields(target: JapaneseReadable): void {
  const legacy = target as any;
  delete legacy.FuriganaHtml;
  delete legacy.FuriganaText;
  delete legacy.FuriganaAnnotations;
  delete legacy.FuriganaTargetStart;
  delete legacy.FuriganaTargetEnd;
  delete legacy.FuriganaSegments;
}

export function assignJapaneseReading(target: JapaneseReadable, reading: JapaneseReading | undefined): void {
  clearLegacyFuriganaFields(target);
  if (reading && (reading.romaji || reading.furigana.length > 0)) {
    target.JapaneseReading = reading;
  } else {
    delete target.JapaneseReading;
  }
}

export async function annotateJapaneseTextTarget(
  target: JapaneseReadable,
  fullSpacedRomaji?: string,
  romajiPromise?: Promise<void>
): Promise<JapaneseReading | undefined> {
  const text = target.Text?.normalize("NFKC") || "";
  if (target.Text) target.Text = text;
  const reading = await analyzeJapaneseLine(text, fullSpacedRomaji, romajiPromise);
  assignJapaneseReading(target, reading);
  return reading;
}

export async function applyJapaneseReadingToSyllables(
  lineText: string,
  fullSpacedRomaji: string | undefined,
  syllables: JapaneseReadable[],
  romajiPromise?: Promise<void>
): Promise<JapaneseReading | undefined> {
  const reading = await analyzeJapaneseLine(lineText, fullSpacedRomaji, romajiPromise);
  if (!reading) {
    for (const syllable of syllables) {
      clearLegacyFuriganaFields(syllable);
      delete syllable.JapaneseReading;
      delete syllable.RomanizedText;
      delete syllable.TransliteratedText;
      delete syllable.RomajiSpaceBefore;
    }
    return undefined;
  }

  const context = await buildJapaneseTokenContext(reading.sourceText, reading.romaji || fullSpacedRomaji);
  let syllPos = 0;
  let prevLastIdx = -1;

  for (let si = 0; si < syllables.length; si += 1) {
    const syllable = syllables[si];
    const text = syllable.Text || "";
    while (syllPos < reading.sourceText.length && /\s/.test(reading.sourceText[syllPos])) syllPos += 1;
    const syllStart = syllPos;
    const syllEnd = syllStart + text.length;
    syllPos = syllEnd;

    clearLegacyFuriganaFields(syllable);
    delete syllable.JapaneseReading;
    delete syllable.RomanizedText;
    delete syllable.TransliteratedText;
    delete syllable.RomajiSpaceBefore;

    const romajiParts: string[] = [];
    let firstIdx = -1;
    let lastIdx = -1;

    for (let ei = 0; ei < context.entries.length; ei += 1) {
      const entry = context.entries[ei];
      if (entry.consumed) continue;
      if (entry.start >= syllStart && entry.start < syllEnd) {
        if (romajiParts.length > 0 && !context.noSpaceBefore[ei]) romajiParts.push(" ");
        romajiParts.push(entry.romaji);
        if (firstIdx === -1) firstIdx = ei;
        lastIdx = ei;
      }
    }

    if (si > 0 && firstIdx !== -1 && firstIdx !== prevLastIdx && !context.noSpaceBefore[firstIdx]) {
      syllable.RomajiSpaceBefore = true;
    }
    if (lastIdx !== -1) prevLastIdx = lastIdx;

    const syllableRomaji = romajiParts.length > 0 ? romajiParts.join("") : undefined;
    if (syllableRomaji) {
      syllable.RomanizedText = syllableRomaji;
      syllable.TransliteratedText = syllableRomaji;
    }

    const localFurigana = reading.furigana
      .filter((segment) => segment.start >= syllStart && segment.start < syllEnd)
      .map((segment) => ({
        start: segment.start - syllStart,
        end: Math.max(segment.end - syllStart, segment.start - syllStart + 1),
        reading: segment.reading,
      }));

    if (localFurigana.length > 0 || syllableRomaji) {
      syllable.JapaneseReading = {
        sourceText: text,
        romaji: syllableRomaji,
        furigana: localFurigana,
      };
    }
  }

  return reading;
}
