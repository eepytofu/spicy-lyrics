import { ArabicTextTest } from "./TextDetection.ts";

export const ARABIC_ROMANIZATION_ATTEMPT_VERSION = 1;
const ArabicPhrasePattern = /[\p{Script=Arabic}\p{Mark}\s\u200C\u200D]+/gu;

export function collectArabicScriptPhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const match of text.matchAll(ArabicPhrasePattern)) {
    if (!ArabicTextTest.test(match[0])) continue;
    const phrase = match[0].trim();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

/**
 * Replace only Arabic-script phrases with already-resolved readings. Other
 * scripts, punctuation, numbers, and whitespace remain owned by their source
 * processors. Keeping this transform synchronous also prevents render-time
 * network access: the Google data request is batched before processing starts.
 */
export function applyArabicScriptRomanizations(
  text: string,
  readings: ReadonlyMap<string, string>,
): string {
  return text.replace(ArabicPhrasePattern, (run) => {
    if (!ArabicTextTest.test(run)) return run;
    const phrase = run.trim();
    const reading = readings.get(phrase);
    if (!reading) return run;
    const leading = run.match(/^\s*/u)?.[0] || "";
    const trailing = run.match(/\s*$/u)?.[0] || "";
    return `${leading}${reading}${trailing}`;
  });
}
