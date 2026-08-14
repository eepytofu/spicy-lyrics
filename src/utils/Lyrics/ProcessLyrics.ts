import { franc } from "franc-all";
import { transliterate as greekRomanization } from "greek-transliteration";
import langs from "langs";
import Logger from "../Logger.ts";
import { convertChineseLyricsText } from "./ChineseCharacterConversion.ts";
import { $chineseCharacterForm } from "../uiState.ts";
import {
  chineseTones,
  chineseTranslitMode,
  cyrillicKeepSigns,
  cyrillicRomanizationMode,
  joinMandarinWords,
  koreanDisplayMode,
  pinyinPlacement,
} from "./lyrics.ts";
import {
  ChineseTextTest,
  JapaneseTextTest,
  KoreanTextTest,
  CyrillicTextTest,
  GreekTextTest,
  ArabicTextTest,
  RomanizableScriptTextTest,
  cleanInvisibles,
  cleanInvisiblesPreserveEdges,
} from "./Fork/index.ts";
import {
  romanizationBranchFromLanguage,
  scriptBranchForLine,
  SCRIPT_PRIORITY,
  type RomanizationBranch,
  type ScriptBranchDocContext,
} from "./Fork/TextDetection.ts";
import {
  romanizeCantonese,
  buildMandarinWordLayout,
  joinMandarinReadingWords,
  projectMandarinReading,
  romanizeMandarin,
  romanizeCyrillic,
  romanizeKoreanForDisplay,
} from "./Fork/Romanization.ts";
import {
  ARABIC_ROMANIZATION_ATTEMPT_VERSION,
  applyArabicScriptRomanizations,
  collectArabicScriptPhrases,
} from "./Fork/ArabicRomanization.ts";
import { batchRomanizeArabicScriptPhrases } from "./Fork/GoogleRomanizationClient.ts";
import { acceptRomanization } from "./Fork/RomanizationAcceptance.ts";
import { analyzeJapaneseLine, buildJapaneseLineTextMap } from "./Reading/JapaneseReading.ts";
import { translateLyrics, clearTranslationCache } from "./Fork/Translation.ts";
import { buildCanonicalLine } from "./Processing/Canonical.ts";
import { annotateKoreanLine } from "./Processing/Korean/KoreanAnnotationProcessor.ts";
import { buildRenderPlan, validateRenderPlan } from "./Processing/RenderPlan.ts";
import {
  processJapanesePackageLine,
  processJapanesePackageTextTarget,
} from "./Processing/Japanese/JapanesePackageProcessor.ts";
import {
  buildLineFallbackPlan,
  buildTimedContextReadingPlan,
  buildTimedGenericPlan,
} from "./Processing/GenericReadingProcessor.ts";
import {
  buildCjkContextualHanRoutes,
  buildCjkReadingContextText,
  projectChineseDominantCjkReadings,
  resolveCjkDocumentContext,
  resolveCjkLineRoute,
  romanizeChineseDominantCjkText,
  type CjkReadingBranch,
  type CjkRunReadingProjection,
} from "./Processing/CjkLanguageRouting.ts";
import {
  allowsChineseProviderJapaneseRepair,
  ChineseProviderJapaneseTextProjection,
  isChineseProviderJapaneseRepairSource,
} from "./Processing/Japanese/ChineseProviderJapaneseRepair.ts";
import { needsSyllableSpaceBefore } from "./Processing/SyllableBoundaries.ts";
import {
  preserveProviderReading,
  preserveProviderReadingWithoutResidual,
  restoreProviderReading,
  restoreProviderReadingWithoutResidual,
  selectTimedLineReading,
  shouldPreferGeneratedReading,
} from "./Processing/ReadingPrecedence.ts";
import type { AboveReadingSegment, ParsedLine } from "./Processing/Model.ts";
import { ensureSourceLyricDocument } from "./Processing/SourceLyricDocument.ts";
import { isProviderInfoEntry } from "./ProviderInfo.ts";

export { clearTranslationCache };
export { acceptRomanization };
// v69: keep promotional provider notices out of every derived lyric lane.
export const LYRICS_PROCESSING_VERSION = 69;
// v5: render plans can carry canonical above-reading segments.
export const READING_PLAN_SCHEMA_VERSION = 5;

// Constants
const romanizationLogger = new Logger("Lyrics Romanization");

// Per-item (1-char) presence tests. Once a script is confirmed present in the
// whole song, a single matching character in an item is enough to romanize it.
const ItemJapaneseTest = /[぀-ヿ一-鿿]/;
const ItemChineseTest = /[一-鿿]/;
const ItemKoreanTest = KoreanTextTest;
const ItemCyrillicTest = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;
const ItemGreekTest = GreekTextTest;
const ItemArabicTest = ArabicTextTest;
const ScriptResidualTests: Record<RomanizationBranch, RegExp> = {
  Japanese: ItemJapaneseTest,
  Chinese: ItemChineseTest,
  Korean: ItemKoreanTest,
  Cyrillic: ItemCyrillicTest,
  Greek: ItemGreekTest,
  Arabic: ItemArabicTest,
};

const preserveUsableProviderReading = (
  entry: any,
  scripts: readonly RomanizationBranch[],
): string | undefined => scripts.includes("Arabic")
  ? preserveProviderReadingWithoutResidual(entry, ItemArabicTest)
  : preserveProviderReading(entry);

const restoreUsableProviderReading = (
  entry: any,
  scripts: readonly RomanizationBranch[],
): boolean => scripts.includes("Arabic")
  ? restoreProviderReadingWithoutResidual(entry, ItemArabicTest)
  : restoreProviderReading(entry);

// Any original (non-Latin) romanizable script — used in dev to flag residue.
const ResidualScriptTest = RomanizableScriptTextTest;

const romanizeChineseText = async (text: string, primaryLanguage: string): Promise<string> => {
  if (chineseTranslitMode === "jyutping") {
    return (await romanizeCantonese(text, primaryLanguage, true, chineseTones)) ?? text;
  }
  return romanizeMandarin(text, chineseTones);
};

const KanaRunTest = /[\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;

const projectMandarinRun = (text: string): CjkRunReadingProjection => {
  const projection = projectMandarinReading(text, chineseTones);
  return {
    text: projection.text,
    valid: projection.valid,
    segments: projection.segments.map((segment) => ({
      ...segment,
      kind: "mandarinPinyin" as const,
    })),
  };
};

const projectKanaRun = async (text: string): Promise<CjkRunReadingProjection> => {
  const segments: CjkRunReadingProjection["segments"][number][] = [];
  let output = "";
  let sourceCursorUtf16 = 0;
  let valid = true;

  for (const match of text.matchAll(KanaRunTest)) {
    const matchStartUtf16 = match.index;
    const kana = match[0];
    output += text.slice(sourceCursorUtf16, matchStartUtf16);
    const reading = (await analyzeJapaneseLine(kana))?.romaji?.trim();
    if (!reading || JapaneseTextTest.test(reading)) {
      valid = false;
      output += kana;
    } else {
      const startCp = Array.from(text.slice(0, matchStartUtf16)).length;
      segments.push({
        startCp,
        endCp: startCp + Array.from(kana).length,
        reading,
        kind: "japaneseRomaji",
      });
      output += reading;
    }
    sourceCursorUtf16 = matchStartUtf16 + kana.length;
  }
  output += text.slice(sourceCursorUtf16);

  return { text: output, segments, valid: valid && segments.length > 0 };
};

const projectChineseAboveReading = (text: string) =>
  projectChineseDominantCjkReadings(text, {
    projectHan: projectMandarinRun,
    projectKana: projectKanaRun,
  });

const romanizeKoreanText = (text: string): string =>
  romanizeKoreanForDisplay(text, koreanDisplayMode).display;

const romanizeCyrillicText = (text: string): string =>
  romanizeCyrillic(text, cyrillicRomanizationMode, cyrillicKeepSigns);

const romanizeGreekText = (text: string): string => {
  const result = greekRomanization(text);
  return result != null ? result : text;
};

type RomanizeEntry = { target: any; line: any; lineText: string };

const normalizeLyricsText = (target: any): string => {
  if (typeof target?.Text !== "string") return "";
  target.Text = cleanInvisibles(target.Text.normalize("NFKC"));
  return target.Text;
};

const normalizeSyllableText = (target: any): string => {
  if (typeof target?.Text !== "string") return "";
  target.Text = cleanInvisiblesPreserveEdges(target.Text.normalize("NFKC"));
  return target.Text;
};

const normalizedSyllableLine = (syllables: any[]): string => {
  let text = "";
  for (let index = 0; index < syllables.length; index += 1) {
    const normalized = normalizeSyllableText(syllables[index]);
    if (
      index > 0 &&
      !/\s$/u.test(text) &&
      !/^\s/u.test(normalized) &&
      needsSyllableSpaceBefore(syllables, index)
    ) {
      text += " ";
    }
    text += normalized;
  }
  return text;
};

const gatherText = (
  lyrics: any
): {
  francText: string;
  scriptText: string;
  cjkBlocks: string[][];
  entries: RomanizeEntry[];
} => {
  const entries: RomanizeEntry[] = [];
  const textLines: string[] = [];
  const bgTextLines: string[] = [];

  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines) {
      if (isProviderInfoEntry(line)) continue;
      const lineText = normalizeLyricsText(line);
      entries.push({ target: line, line, lineText });
      textLines.push(lineText);
    }
  } else if (lyrics.Type === "Line") {
    for (const vocalGroup of lyrics.Content) {
      if (isProviderInfoEntry(vocalGroup)) continue;
      if (vocalGroup.Type === "Vocal" || vocalGroup.Text) {
        const lineText = normalizeLyricsText(vocalGroup);
        entries.push({ target: vocalGroup, line: vocalGroup, lineText });
        textLines.push(lineText);
      }
    }
  } else if (lyrics.Type === "Syllable") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;
      if (isProviderInfoEntry(vocalGroup.Lead)) continue;

      const syllables = vocalGroup.Lead.Syllables;
      if (syllables.length > 0) {
        const text = normalizedSyllableLine(syllables);
        const lineEntries: RomanizeEntry[] = syllables.map((syllable: any) => ({
          target: syllable,
          line: vocalGroup,
          lineText: "",
        }));
        for (const entry of lineEntries) entry.lineText = text;
        entries.push(...lineEntries);
        textLines.push(text);
      }

      if (vocalGroup.Background !== undefined) {
        for (const bg of vocalGroup.Background) {
          const lineText = normalizedSyllableLine(bg.Syllables);
          const bgEntries: RomanizeEntry[] = bg.Syllables.map((syllable: any) => ({
            target: syllable,
            line: vocalGroup,
            lineText: "",
          }));
          for (const entry of bgEntries) entry.lineText = lineText;
          entries.push(...bgEntries);
          bgTextLines.push(lineText);
        }
      }
    }
  }

  const francText = textLines.join("\n");
  const scriptText = bgTextLines.length > 0 ? `${francText}\n${bgTextLines.join("\n")}` : francText;
  const cjkBlocks = [textLines, bgTextLines].filter((block) => block.length > 0);
  return { francText, scriptText, cjkBlocks, entries };
};

const detectPresentScripts = (
  scriptText: string,
  language: string,
  iso2Language: string | undefined,
  cjkDominantBranch: CjkReadingBranch | undefined
): RomanizationBranch[] => {
  const present = new Set<RomanizationBranch>();

  if (JapaneseTextTest.test(scriptText)) present.add("Japanese");
  if (ChineseTextTest.test(scriptText)) present.add(cjkDominantBranch || "Chinese");
  if (KoreanTextTest.test(scriptText)) present.add("Korean");
  if (CyrillicTextTest.test(scriptText)) present.add("Cyrillic");
  if (GreekTextTest.test(scriptText)) present.add("Greek");
  if (ArabicTextTest.test(scriptText)) present.add("Arabic");

  const hint = romanizationBranchFromLanguage(language, iso2Language);
  if (hint && !present.has(hint)) {
    if (hint === "Japanese" || hint === "Chinese") {
      if (!present.has("Japanese") && !present.has("Chinese")) present.add(hint);
    } else {
      present.add(hint);
    }
  }

  return SCRIPT_PRIORITY.filter((script) => present.has(script));
};

const hasTransliteration = (entry: any): boolean =>
  typeof entry.TransliteratedText === "string" && entry.TransliteratedText !== "";

const lyricsHaveAnyTransliteration = (lyrics: any): boolean => {
  if (lyrics.Type === "Static") {
    return (
      lyrics.Lines?.some(
        (line: any) =>
          !isProviderInfoEntry(line) && (
            hasTransliteration(line) ||
            typeof line.RomanizedText === "string" ||
            line.ReadingRenderPlan != null
          )
      ) === true
    );
  }
  if (lyrics.Type === "Line") {
    return (
      lyrics.Content?.some(
        (line: any) =>
          !isProviderInfoEntry(line) && (
            hasTransliteration(line) ||
            typeof line.RomanizedText === "string" ||
            line.ReadingRenderPlan != null
          )
      ) === true
    );
  }
  if (lyrics.Type === "Syllable") {
    return (
      lyrics.Content?.some(
        (group: any) =>
          !isProviderInfoEntry(group.Lead) && (
            hasTransliteration(group.Lead) ||
            typeof group.Lead?.RomanizedText === "string" ||
            group.Lead?.Syllables?.some(
              (s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string"
            ) === true ||
            group.Lead?.ReadingRenderPlan != null ||
            group.Background?.some(
              (bg: any) =>
                hasTransliteration(bg) ||
                typeof bg.RomanizedText === "string" ||
                bg.Syllables?.some(
                  (s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string"
                ) === true ||
                bg.ReadingRenderPlan != null
            ) === true
          )
      ) === true
    );
  }
  return false;
};

const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

const joinSyllables = (syllables: any[], compact = false): string => {
  return syllables.reduce((acc, syl, index) => {
    const text = syl.Text || "";
    if (index === 0) return text;

    if (!compact) return `${acc}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${text}`;

    const prevText = syllables[index - 1]?.Text || "";
    const shouldPreserveWordSpace =
      needsSyllableSpaceBefore(syllables, index) &&
      (LatinWordTextTest.test(prevText) || LatinWordTextTest.test(text));
    return `${acc}${shouldPreserveWordSpace ? " " : ""}${text}`;
  }, "");
};

const romanizeLineText = async (
  text: string,
  docContext: ScriptBranchDocContext,
  language: string,
  arabicReadings: ReadonlyMap<string, string>,
): Promise<{ text: string; aboveReadingSegments?: AboveReadingSegment[] } | undefined> => {
  const entry: RomanizeEntry = { target: { Text: text }, line: {}, lineText: text };
  const changed = await romanizeEntry(entry, docContext, language, arabicReadings, false);
  return changed
    ? {
        text: entry.target.TransliteratedText,
        ...(entry.target.AboveReadingSegments
          ? { aboveReadingSegments: entry.target.AboveReadingSegments }
          : {}),
      }
    : undefined;
};

const postProcessSyllableRomanization = async (
  lyrics: any,
  docContext: ScriptBranchDocContext,
  language: string,
  arabicReadings: ReadonlyMap<string, string>,
  allowChineseProviderJapaneseRepair: boolean
) => {
  if (lyrics.Type !== "Syllable") return;

  for (const vocalGroup of lyrics.Content || []) {
    if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;
    if (isProviderInfoEntry(vocalGroup.Lead)) continue;

    const processGroup = async (group: any) => {
      const syllables = group?.Syllables;
      if (!Array.isArray(syllables) || syllables.length === 0) return;
      preserveProviderReading(group);
      for (const syllable of syllables) preserveProviderReading(syllable);

      const spacedLineText = joinSyllables(syllables);
      const cjkLineRoute = resolveCjkLineRoute(spacedLineText, docContext);
      const isJapaneseLine = cjkLineRoute === "Japanese";
      const isChineseLine = cjkLineRoute === "Chinese" || cjkLineRoute === "MixedChinese";
      if (isJapaneseLine) group.ReadingPrimaryScript = "Japanese";
      else if (isChineseLine) group.ReadingPrimaryScript = "Chinese";

      const lineText = isChineseLine
        ? buildCjkReadingContextText(syllables)
        : isJapaneseLine
          ? joinSyllables(syllables, true)
          : spacedLineText;
      const groupHasKorean = syllables.some((s: any) => KoreanTextTest.test(s.Text || ""));
      const japaneseMap =
        isJapaneseLine && !groupHasKorean ? buildJapaneseLineTextMap(syllables) : undefined;
      const effectiveLineText = japaneseMap?.lineText ?? lineText;
      const isArabicLine = ItemArabicTest.test(effectiveLineText);
      const repairJapaneseDisplay =
        allowChineseProviderJapaneseRepair &&
        allowsChineseProviderJapaneseRepair(effectiveLineText);
      if (groupHasKorean) {
        const parsed: ParsedLine = {
          id: `korean-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
          displayText: effectiveLineText,
          paragraphProvenance: "unavailable",
          spans: syllables.map((syllable: any, index: number) => ({
            id: String(index),
            rawText: syllable.Text || "",
            cleanText: syllable.Text || "",
            startMs: Number(syllable.StartTime || 0),
            endMs: Number(syllable.EndTime || 0),
            providerPartOfWord: syllable.IsPartOfWord === true,
          })),
        };
        const canonical = buildCanonicalLine(parsed);
        const plan = buildRenderPlan(parsed, canonical, [
          annotateKoreanLine(canonical, koreanDisplayMode),
        ]);
        if (validateRenderPlan(plan).valid) {
          group.ReadingRenderPlan = plan;
          delete group.RomanizedText;
          delete group.TransliteratedText;
          for (const syllable of syllables) {
            delete syllable.RomanizedText;
            delete syllable.TransliteratedText;
            delete syllable.RomajiSpaceBefore;
          }
          return;
        }
      }
      if (isJapaneseLine && !groupHasKorean && japaneseMap) {
        try {
          const packageResult = await processJapanesePackageLine(
            effectiveLineText,
            syllables,
            japaneseMap.spans,
            syllables,
            {
              textProjection: repairJapaneseDisplay
                ? ChineseProviderJapaneseTextProjection
                : undefined,
            }
          );
          for (const syllable of syllables) {
            delete syllable.RomanizedText;
            delete syllable.TransliteratedText;
            delete syllable.RomajiSpaceBefore;
            delete syllable.JapaneseRomajiTiming;
          }
          group.JapaneseReading = {
            sourceText: effectiveLineText,
            ...(packageResult.displayText !== effectiveLineText
              ? { displayText: packageResult.displayText }
              : {}),
            romaji: packageResult.romaji,
            furigana: packageResult.furigana,
          };
          group.ReadingRenderPlan = packageResult.plan;
          delete group.RomanizedText;
          delete group.TransliteratedText;
        } catch (error) {
          delete group.JapaneseReading;
          delete group.ReadingRenderPlan;
          for (const syllable of syllables) {
            delete syllable.JapaneseRomajiTiming;
          }
          const restoredGroup = restoreProviderReading(group);
          const restoredSyllables = syllables.map(restoreProviderReading).some(Boolean);
          if (!restoredGroup && !restoredSyllables) throw error;
          romanizationLogger.warn("Japanese local reading failed; using provider fallback", error);
        }
        return;
      }
      const providerGroupReading = isArabicLine
        ? preserveProviderReadingWithoutResidual(group, ItemArabicTest)
        : undefined;
      const providerSyllableReadings = isArabicLine
        ? syllables.map((syllable: any) =>
          preserveProviderReadingWithoutResidual(syllable, ItemArabicTest)
        )
        : [];
      const hasProviderSyllableReading = providerSyllableReadings.some(Boolean);
      const providerSyllableReading = hasProviderSyllableReading
        ? syllables.reduce((output: string, syllable: any, index: number) => {
          const reading = providerSyllableReadings[index] || syllable.Text || "";
          if (index === 0) return reading;
          return `${output}${needsSyllableSpaceBefore(syllables, index) ? " " : ""}${reading}`;
        }, "")
        : undefined;
      const generatedLineProjection = await romanizeLineText(
        effectiveLineText,
        docContext,
        language,
        arabicReadings,
      );
      const reading = selectTimedLineReading(
        isArabicLine,
        generatedLineProjection?.text,
        providerGroupReading,
        providerSyllableReading,
      );
      if (!reading) return;
      const fullRomaji = reading.text;

      group.TransliteratedText = fullRomaji;
      group.RomanizedText = fullRomaji;

      {
        for (let index = 0; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          if (syllable.TransliteratedText && !syllable.RomanizedText) {
            syllable.RomanizedText = syllable.TransliteratedText;
          }
          if (isChineseLine && index > 0 && syllable.RomanizedText) {
            syllable.RomajiSpaceBefore = true;
          }
        }
        const mandarinWordLayout =
          cjkLineRoute === "Chinese" &&
            chineseTranslitMode === "pinyin" &&
            pinyinPlacement === "below" &&
            joinMandarinWords
            ? buildMandarinWordLayout(effectiveLineText)
            : undefined;
        const aboveReadingSegments =
          pinyinPlacement === "above" &&
            chineseTranslitMode === "pinyin" &&
            reading.provenance === "local" &&
            reading.text === generatedLineProjection?.text
            ? generatedLineProjection?.aboveReadingSegments
            : undefined;
        const plan = isArabicLine && reading.usesLineContext
          ? buildTimedContextReadingPlan(group, fullRomaji, "Arabic", reading.provenance)
          : buildTimedGenericPlan(
            group,
            fullRomaji,
            isChineseLine ? "Chinese" : "Generic",
            {
              mandarinWordLayout,
              provenance: reading.provenance,
              aboveReadingSegments,
              aboveReadingSourceText: effectiveLineText,
            },
          );
        if (plan) {
          group.ReadingRenderPlan = plan;
          delete group.RomanizedText;
          delete group.TransliteratedText;
          for (const syllable of syllables) {
            delete syllable.RomanizedText;
            delete syllable.TransliteratedText;
            delete syllable.RomajiSpaceBefore;
          }
        }
      }
    };

    await processGroup(vocalGroup.Lead);
    for (const bg of vocalGroup.Background || []) {
      await processGroup(bg);
    }
  }
};

const romanizeEntry = async (
  entry: RomanizeEntry,
  docContext: ScriptBranchDocContext,
  primaryLanguage: string,
  arabicReadings: ReadonlyMap<string, string>,
  annotateJapanese: boolean = true,
  allowChineseProviderJapaneseRepair: boolean = false
): Promise<boolean> => {
  const { target, line } = entry;

  if (target.Text) {
    const normalized = target.Text.normalize("NFKC");
    target.Text = annotateJapanese
      ? cleanInvisibles(normalized)
      : cleanInvisiblesPreserveEdges(normalized);
  }
  const cjkLineRoute = resolveCjkLineRoute(entry.lineText || target.Text || "", docContext);
  const targetDocContext =
    cjkLineRoute === "Japanese"
      ? { ...docContext, cjkDominantBranch: "Japanese" as const }
      : docContext;
  const targetScripts = scriptBranchForLine(target.Text || "", targetDocContext);
  const preferGeneratedReading = shouldPreferGeneratedReading(
    target.Text || "",
    targetScripts
  );
  const providerReading = preserveUsableProviderReading(target, targetScripts);
  const repairJapaneseDisplay =
    allowChineseProviderJapaneseRepair &&
    allowsChineseProviderJapaneseRepair(entry.lineText || target.Text || "");

  if (providerReading && !preferGeneratedReading) {
    restoreUsableProviderReading(target, targetScripts);
    return true;
  }

  let text: string = target.Text;
  let changed = false;

  if (
    annotateJapanese &&
    cjkLineRoute === "Japanese" &&
    targetScripts.includes("Japanese") &&
    ItemJapaneseTest.test(target.Text || "")
  ) {
    const packageRomaji = await processJapanesePackageTextTarget(target, {
      textProjection: repairJapaneseDisplay
        ? ChineseProviderJapaneseTextProjection
        : undefined,
    });
    if (
      packageRomaji &&
      acceptRomanization(target.Text || "", packageRomaji, [ScriptResidualTests.Japanese])
    ) {
      line.HasTransliterations = true;
      return true;
    }
  }

  const chineseDominantCjk =
    docContext.cjkDominantBranch === "Chinese" &&
    cjkLineRoute !== "Japanese" &&
    (ItemChineseTest.test(text) || JapaneseTextTest.test(text));
  if (chineseDominantCjk) {
    if (chineseTranslitMode === "pinyin" && pinyinPlacement === "above") {
      const projection = await projectChineseAboveReading(text);
      if (projection.valid && projection.aboveReadingSegments.length > 0) {
        text = projection.text;
        target.AboveReadingSegments = projection.aboveReadingSegments;
      } else {
        delete target.AboveReadingSegments;
        text = await romanizeChineseDominantCjkText(text, {
          romanizeHan: (run) => romanizeChineseText(run, primaryLanguage),
          romanizeKana: async (run) => (await analyzeJapaneseLine(run))?.romaji,
        });
      }
    } else {
      delete target.AboveReadingSegments;
      text = await romanizeChineseDominantCjkText(text, {
        romanizeHan: (run) => romanizeChineseText(run, primaryLanguage),
        romanizeKana: async (run) => (await analyzeJapaneseLine(run))?.romaji,
      });
    }
    changed = text !== target.Text;
  }

  for (const script of targetScripts) {
    if (chineseDominantCjk && (script === "Japanese" || script === "Chinese")) {
      continue;
    } else if (script === "Japanese") {
      continue;
    } else if (script === "Chinese") {
      if (ItemChineseTest.test(text)) {
        text = await romanizeChineseText(text, primaryLanguage);
        changed = true;
      }
    } else if (script === "Korean") {
      if (ItemKoreanTest.test(text)) {
        text = romanizeKoreanText(text);
        changed = true;
      }
    } else if (script === "Cyrillic") {
      if (ItemCyrillicTest.test(text)) {
        text = romanizeCyrillicText(text);
        changed = true;
      }
    } else if (script === "Greek") {
      if (ItemGreekTest.test(text)) {
        text = romanizeGreekText(text);
        changed = true;
      }
    } else if (script === "Arabic") {
      if (ItemArabicTest.test(text)) {
        const romanized = applyArabicScriptRomanizations(text, arabicReadings);
        if (romanized !== text) {
          text = romanized;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    if (ResidualScriptTest.test(text)) {
      romanizationLogger.warn("Incomplete romanization (original-script characters remain)", {
        original: target.Text,
        romanized: text,
      });
    }
    if (
      !acceptRomanization(
        target.Text || "",
        text,
        targetScripts.map((script) => ScriptResidualTests[script])
      )
    ) {
      return restoreUsableProviderReading(target, targetScripts);
    }
    target.TransliteratedText = text;
    target.RomanizedText = text;
    line.HasTransliterations = true;
  }

  return changed || restoreUsableProviderReading(target, targetScripts);
};

type ProcessLyricsOptions = {
  awaitTranslation?: boolean;
  signal?: AbortSignal;
  allowRemoteRomanization?: boolean;
};

export const ProcessLyrics = async (
  lyrics: any,
  options: ProcessLyricsOptions = {}
) => {
  const sourceDocument = ensureSourceLyricDocument(lyrics);
  if (!sourceDocument.parity.valid) {
    romanizationLogger.warn(
      "SourceLyricDocument dual-run parity mismatch; retaining legacy source evidence",
      sourceDocument.parity.errors
    );
  }
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  const awaitTranslation = options.awaitTranslation !== false;
  const hadApiTransliterations = lyrics.HasTransliterations === true;
  let gathered = gatherText(lyrics);

  const detectedLanguage = franc(gathered.francText);
  const detectedLanguageISO2 = langs.where("3", detectedLanguage)?.["1"];
  const cjkDocumentContext = resolveCjkDocumentContext(
    gathered.scriptText,
    detectedLanguage,
    detectedLanguageISO2
  );
  const cjkDominantBranch = cjkDocumentContext.branch;
  const language =
    cjkDominantBranch === "Japanese"
      ? "jpn"
      : cjkDominantBranch === "Chinese"
        ? detectedLanguage === "yue"
          ? "yue"
          : "cmn"
        : detectedLanguage;
  const languageISO2 = langs.where("3", language)?.["1"];
  lyrics.Language = language;
  lyrics.LanguageISO2 = languageISO2;

  const presentScripts = detectPresentScripts(
    gathered.scriptText,
    language,
    languageISO2,
    cjkDominantBranch
  );
  const docContext: ScriptBranchDocContext = {
    presentScripts,
    primaryLanguage: language,
    iso2Language: languageISO2,
    cjkDominantBranch,
    cjkBilingual: cjkDocumentContext.bilingual,
    cjkContextualHanRoutes: buildCjkContextualHanRoutes(
      gathered.cjkBlocks,
      cjkDocumentContext,
    ),
  };
  const allowChineseProviderJapaneseRepair =
    isChineseProviderJapaneseRepairSource(lyrics);
  const chineseCharacterForm = $chineseCharacterForm.get();
  lyrics.ChineseCharacterForm = chineseCharacterForm;
  if (
    chineseCharacterForm !== "original" &&
    language !== "jpn" &&
    presentScripts.includes("Chinese")
  ) {
    convertChineseLyricsText(
      lyrics,
      chineseCharacterForm,
      (text) =>
        ItemChineseTest.test(text) && scriptBranchForLine(text, docContext).includes("Chinese")
    );
    gathered = gatherText(lyrics);
    docContext.cjkContextualHanRoutes = buildCjkContextualHanRoutes(
      gathered.cjkBlocks,
      cjkDocumentContext,
    );
  }
  const entries = gathered.entries;
  for (const entry of entries) {
    const entryScripts = scriptBranchForLine(entry.lineText || entry.target?.Text || "", docContext);
    preserveUsableProviderReading(entry.target, entryScripts);
    const cjkLineRoute = resolveCjkLineRoute(
      entry.lineText || entry.target?.Text || "",
      docContext
    );
    if (cjkLineRoute === "Japanese") entry.target.ReadingPrimaryScript = "Japanese";
    else if (cjkLineRoute === "Chinese" || cjkLineRoute === "MixedChinese") {
      entry.target.ReadingPrimaryScript = "Chinese";
    }
  }

  let arabicPhrases: string[] = [];
  if (presentScripts.includes("Arabic")) {
    const sourceTexts = lyrics.Type === "Syllable"
      ? new Set(entries.map((entry) => entry.lineText))
      : new Set(entries.map((entry) => entry.target?.Text || ""));
    arabicPhrases = Array.from(
      new Set(Array.from(sourceTexts).flatMap(collectArabicScriptPhrases)),
    );
  }
  const shouldRequestRemoteRomanization =
    options.allowRemoteRomanization === true && arabicPhrases.length > 0;
  const arabicReadings = shouldRequestRemoteRomanization
    ? await batchRomanizeArabicScriptPhrases(arabicPhrases, { signal: options.signal })
    : new Map<string, string>();
  if (shouldRequestRemoteRomanization) {
    lyrics.RemoteRomanizationAttemptVersion = ARABIC_ROMANIZATION_ATTEMPT_VERSION;
  }

  let appliedRomanization = false;
  const needsRomanizationOrJapaneseReading = entries.some(
    (entry) =>
      shouldPreferGeneratedReading(
        entry.target?.Text || "",
        scriptBranchForLine(entry.lineText || entry.target?.Text || "", docContext)
      ) ||
      !entry.target?.ProviderRomanizedText ||
      (scriptBranchForLine(entry.lineText, docContext).includes("Japanese") &&
        ItemJapaneseTest.test(entry.target.Text || "") &&
        !entry.target.JapaneseReading)
  );
  if (presentScripts.length > 0 && needsRomanizationOrJapaneseReading) {
    const results = await Promise.all(
      entries.map((entry) =>
        romanizeEntry(
          entry,
          docContext,
          language,
          arabicReadings,
          lyrics.Type !== "Syllable",
          allowChineseProviderJapaneseRepair
        )
      )
    );
    appliedRomanization = results.some(Boolean);
  }

  if (presentScripts.length > 0) {
    await postProcessSyllableRomanization(
      lyrics,
      docContext,
      language,
      arabicReadings,
      allowChineseProviderJapaneseRepair
    );
    if (lyrics.Type !== "Syllable") {
      entries.forEach((entry, index) => {
        let display = entry.target.RomanizedText || entry.target.TransliteratedText;
        if (!display) return;
        const cjkLineRoute = resolveCjkLineRoute(
          entry.lineText || entry.target.Text || "",
          docContext
        );
        if (
          joinMandarinWords &&
          chineseTranslitMode === "pinyin" &&
          pinyinPlacement === "below" &&
          cjkLineRoute === "Chinese"
        ) {
          display = joinMandarinReadingWords(entry.target.Text || "", display);
        }
        entry.target.ReadingRenderPlan = buildLineFallbackPlan(
          entry.target.Text || "",
          display,
          `line-${index}`,
          entry.target.AboveReadingSegments,
        );
        delete entry.target.RomanizedText;
        delete entry.target.TransliteratedText;
      });
    }
  }

  for (const entry of entries) {
    delete entry.target.AboveReadingSegments;
  }

  const hasAnyTransliteration = lyricsHaveAnyTransliteration(lyrics);
  lyrics.IncludesRomanization =
    hadApiTransliterations || appliedRomanization || hasAnyTransliteration;
  lyrics.HasTransliterations =
    hadApiTransliterations || appliedRomanization || hasAnyTransliteration;

  lyrics.DetectedChinese = presentScripts.includes("Chinese");

  if (awaitTranslation) {
    await translateLyrics(lyrics);
  }
};
