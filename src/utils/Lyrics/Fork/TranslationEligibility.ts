import { franc } from "franc-all";
import langs from "langs";
import { romanizeCyrillic, romanizeKorean } from "./Romanization.ts";
import {
  BengaliTextTest,
  DevanagariTextTest,
  GurmukhiTextTest,
} from "./TextDetection.ts";

const SCRIPT_TESTS = {
  han: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/,
  kana: /[\u3040-\u30FF]/,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
  devanagari: DevanagariTextTest,
  gurmukhi: GurmukhiTextTest,
  bengali: BengaliTextTest,
};

const latinTargetLanguages = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "sv", "da", "no", "fi", "tr", "id", "ms", "vi",
]);

export function normalizeCompare(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ң/g, "n")
    .replace(/ŋ/g, "n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foldCentralAsianToRussianBase(value: string): string {
  return value
    .replace(/ң/g, "н").replace(/Ң/g, "Н")
    .replace(/ө/g, "о").replace(/Ө/g, "О")
    .replace(/ү/g, "у").replace(/Ү/g, "У")
    .replace(/ә/g, "а").replace(/Ә/g, "А")
    .replace(/ғ/g, "г").replace(/Ғ/g, "Г")
    .replace(/қ/g, "к").replace(/Қ/g, "К")
    .replace(/ұ/g, "у").replace(/Ұ/g, "У")
    .replace(/һ/g, "х").replace(/Һ/g, "Х");
}

export function romanizationCandidates(source: string): string[] {
  const out: string[] = [];
  if (SCRIPT_TESTS.cyrillic.test(source)) {
    out.push(romanizeCyrillic(source, "Russian", false));
    out.push(romanizeCyrillic(source, "Ukrainian", false));
    const folded = foldCentralAsianToRussianBase(source);
    if (folded !== source) out.push(romanizeCyrillic(folded, "Russian", false));
  }
  if (SCRIPT_TESTS.hangul.test(source)) {
    out.push(romanizeKorean(source, "spelling"));
    out.push(romanizeKorean(source, "pronunciation"));
    out.push(romanizeKorean(source, "spelling", "vn"));
    out.push(romanizeKorean(source, "pronunciation", "vn"));
    out.push(romanizeKorean(source, "pronunciation", "rr", true));
    out.push(romanizeKorean(source, "pronunciation", "vn", true));
  }
  return out;
}

export function looksLikeRomanizationEcho(source: string, translated: string): boolean {
  if (!source.trim() || !translated.trim()) return false;
  const output = normalizeCompare(translated);
  if (!output) return false;
  return romanizationCandidates(source).some((candidate) =>
    candidate.trim() && output === normalizeCompare(candidate)
  );
}

export function shouldDisplayTranslation(source: string, translated: string): boolean {
  return !!translated.trim()
    && normalizeCompare(source) !== normalizeCompare(translated)
    && !looksLikeRomanizationEcho(source, translated);
}

function targetAllowsScript(targetLang: string, script: keyof typeof SCRIPT_TESTS): boolean {
  if (script === "han") return targetLang.startsWith("zh") || targetLang === "ja";
  if (script === "kana") return targetLang === "ja";
  if (script === "hangul") return targetLang === "ko";
  if (script === "cyrillic") return ["ru", "uk", "bg", "sr", "mk", "be"].includes(targetLang);
  if (script === "greek") return targetLang === "el";
  if (script === "devanagari") return ["hi", "mr", "ne", "sa"].includes(targetLang);
  if (script === "gurmukhi") return targetLang === "pa";
  if (script === "bengali") return ["bn", "as"].includes(targetLang);
  return false;
}

export function hasObviousNonTargetScript(text: string, targetLang: string): boolean {
  const target = targetLang.toLowerCase();
  return (Object.keys(SCRIPT_TESTS) as Array<keyof typeof SCRIPT_TESTS>).some((script) =>
    SCRIPT_TESTS[script].test(text) && !targetAllowsScript(target, script)
  );
}

function lineLooksNonTargetLatin(text: string, targetLang: string): boolean {
  if (!latinTargetLanguages.has(targetLang)) return false;
  const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
  if (compact.length < 24) return false;
  const detected = franc(compact);
  if (detected === "und") return false;
  const detectedISO2 = langs.where("3", detected)?.["1"];
  return !!detectedISO2 && detectedISO2 !== targetLang;
}

function looksLikeLatinLyricLine(text: string): boolean {
  const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
  return compact.length >= 12 && compact.includes(" ");
}

function sourceMatchesTarget(sourceLang: string, targetLang: string): boolean {
  return langs.where("3", sourceLang)?.["1"] === targetLang || sourceLang === targetLang;
}

export function shouldTranslateLine(text: string, sourceLang: string, targetLang: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "♪") return false;
  if (!sourceMatchesTarget(sourceLang, targetLang)) return true;
  if (hasObviousNonTargetScript(trimmed, targetLang)) return true;
  if (targetLang.toLowerCase() === "en" && looksLikeLatinLyricLine(trimmed)) return true;
  return lineLooksNonTargetLatin(trimmed, targetLang);
}

export function effectiveTranslationSource(
  text: string,
  sourceLang: string,
  targetLang: string,
): string {
  if (!sourceMatchesTarget(sourceLang, targetLang)) return sourceLang;
  return shouldTranslateLine(text, sourceLang, targetLang) ? "und" : sourceLang;
}
