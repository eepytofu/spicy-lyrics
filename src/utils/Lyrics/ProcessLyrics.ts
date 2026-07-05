import { franc } from "franc-all";
import Kuroshiro from "kuroshiro";
import langs from "langs";
import { RetrievePackage } from "../ImportPackage.ts";
import * as KuromojiAnalyzer from "./KuromojiAnalyzer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";
import Logger from "../Logger.ts";
import { chineseTones, chineseTranslitMode, cyrillicKeepSigns, cyrillicRomanizationMode, koreanRomanizationMode } from "./lyrics.ts";
import {
  ChineseTextTest,
  JapaneseTextTest,
  KoreanTextTest,
  CyrillicTextTest,
  GreekTextTest,
  cleanInvisibles,
} from "./Fork/index.ts";
import {
  romanizationBranchFromLanguage,
  scriptBranchForLine,
  SCRIPT_PRIORITY,
  type RomanizationBranch,
  type ScriptBranchDocContext,
} from "./Fork/TextDetection.ts";
import { buildRomajiFromTokens, pinyinOptionsForToneMode, romanizeCantonese, romanizeCyrillic, romanizeKorean } from "./Fork/Romanization.ts";
import { acceptRomanization } from "./Fork/RomanizationAcceptance.ts";
import {
  annotateJapaneseTextTarget,
  applyJapaneseReadingToSyllables,
  clearLegacyFuriganaFields,
  romanizeJapaneseFromFurigana,
} from "./Reading/JapaneseReading.ts";
import { translateLyrics, clearTranslationCache } from "./Fork/Translation.ts";

export { clearTranslationCache };
export { acceptRomanization };
export const LYRICS_PROCESSING_VERSION = 6;

// Constants
const RomajiConverter = new Kuroshiro();
const RomajiPromise = RomajiConverter.init(KuromojiAnalyzer);

const romanizationLogger = new Logger("Lyrics Romanization");

// Per-item (1-char) presence tests. Once a script is confirmed present in the
// whole song, a single matching character in an item is enough to romanize it.
const ItemJapaneseTest = /[぀-ヿ一-鿿]/;
const ItemChineseTest = /[一-鿿]/;
const ItemKoreanTest = KoreanTextTest;
const ItemCyrillicTest = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;
const ItemGreekTest = GreekTextTest;
const ScriptResidualTests: Record<RomanizationBranch, RegExp> = {
  Japanese: ItemJapaneseTest,
  Chinese: ItemChineseTest,
  Korean: ItemKoreanTest,
  Cyrillic: ItemCyrillicTest,
  Greek: ItemGreekTest,
};

// Any original (non-Latin) romanizable script — used in dev to flag residue.
const ResidualScriptTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;

// Load Packages
RetrievePackage("pinyin", "4.0.0", "mjs").catch(() => {});
RetrievePackage("GreekRomanization", "1.0.0", "js").catch(() => {});

type RomanizationPackages = {
  pinyin?: any;
  greekRomanization?: any;
};

const loadPackagesForScripts = async (
  scripts: RomanizationBranch[]
): Promise<RomanizationPackages> => {
  const packages: RomanizationPackages = {};
  for (const script of scripts) {
    if (script === "Japanese") {
      await RomajiPromise;
    } else if (script === "Chinese" && chineseTranslitMode !== "jyutping") {
      packages.pinyin = await RetrievePackage("pinyin", "4.0.0", "mjs");
    } else if (script === "Greek") {
      packages.greekRomanization = await RetrievePackage("GreekRomanization", "1.0.0", "js");
    }
  }
  return packages;
};

const romanizeJapaneseText = async (text: string): Promise<string> => {
  await RomajiPromise;
  const normalized = text.normalize("NFKC");
  return (await buildRomajiFromTokens(normalized)) ||
    await RomajiConverter.convert(normalized, { to: "romaji", mode: "spaced" });
};

const romanizeChineseText = async (
  text: string,
  pinyin: any,
  primaryLanguage: string
): Promise<string> => {
  if (chineseTranslitMode === "jyutping") {
    return (await romanizeCantonese(text, primaryLanguage, true, chineseTones)) ?? text;
  }
  if (!pinyin) return text;
  const result = pinyin.pinyin(text, pinyinOptionsForToneMode(pinyin, chineseTones));
  return result.join(" ");
};

const romanizeKoreanText = (text: string): string => romanizeKorean(text, koreanRomanizationMode);

const romanizeCyrillicText = (text: string): string =>
  romanizeCyrillic(text, cyrillicRomanizationMode, cyrillicKeepSigns);

const romanizeGreekText = (text: string, greekRomanization: any): string => {
  if (!greekRomanization) return text;
  const result = greekRomanization.default(text);
  return result != null ? result : text;
};

type RomanizeEntry = { target: any; line: any; lineText: string };

const normalizeLyricsText = (target: any): string => {
  if (typeof target?.Text !== "string") return "";
  target.Text = cleanInvisibles(target.Text.normalize("NFKC"));
  return target.Text;
};

const gatherText = (
  lyrics: any
): { francText: string; scriptText: string; entries: RomanizeEntry[] } => {
  const entries: RomanizeEntry[] = [];
  const textLines: string[] = [];
  const bgTextLines: string[] = [];

  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines) {
      const lineText = normalizeLyricsText(line);
      entries.push({ target: line, line, lineText });
      textLines.push(lineText);
    }
  } else if (lyrics.Type === "Line") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal" || vocalGroup.Text) {
        const lineText = normalizeLyricsText(vocalGroup);
        entries.push({ target: vocalGroup, line: vocalGroup, lineText });
        textLines.push(lineText);
      }
    }
  } else if (lyrics.Type === "Syllable") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

      const syllables = vocalGroup.Lead.Syllables;
      if (syllables.length > 0) {
        let text = normalizeLyricsText(syllables[0]);
        const lineEntries: RomanizeEntry[] = [{ target: syllables[0], line: vocalGroup, lineText: "" }];
        for (let index = 1; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          text += `${syllable.IsPartOfWord ? "" : " "}${normalizeLyricsText(syllable)}`;
          lineEntries.push({ target: syllable, line: vocalGroup, lineText: "" });
        }
        for (const entry of lineEntries) entry.lineText = text;
        entries.push(...lineEntries);
        textLines.push(text);
      }

      if (vocalGroup.Background !== undefined) {
        for (const bg of vocalGroup.Background) {
          const bgEntries: RomanizeEntry[] = [];
          const bgText: string[] = [];
          for (const syllable of bg.Syllables) {
            bgText.push(normalizeLyricsText(syllable));
            bgEntries.push({ target: syllable, line: vocalGroup, lineText: "" });
          }
          const lineText = bgText.join(" ");
          for (const entry of bgEntries) entry.lineText = lineText;
          entries.push(...bgEntries);
          bgTextLines.push(lineText);
        }
      }
    }
  }

  const francText = textLines.join("\n");
  const scriptText = bgTextLines.length > 0 ? `${francText}\n${bgTextLines.join("\n")}` : francText;
  return { francText, scriptText, entries };
};

const detectPresentScripts = (
  scriptText: string,
  language: string,
  iso2Language: string | undefined
): RomanizationBranch[] => {
  const present = new Set<RomanizationBranch>();

  if (JapaneseTextTest.test(scriptText)) {
    present.add("Japanese");
  } else if (ChineseTextTest.test(scriptText)) {
    present.add("Chinese");
  }
  if (KoreanTextTest.test(scriptText)) present.add("Korean");
  if (CyrillicTextTest.test(scriptText)) present.add("Cyrillic");
  if (GreekTextTest.test(scriptText)) present.add("Greek");

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
    return lyrics.Lines?.some((line: any) => hasTransliteration(line) || typeof line.RomanizedText === "string") === true;
  }
  if (lyrics.Type === "Line") {
    return lyrics.Content?.some((line: any) => hasTransliteration(line) || typeof line.RomanizedText === "string") === true;
  }
  if (lyrics.Type === "Syllable") {
    return lyrics.Content?.some((group: any) =>
      hasTransliteration(group.Lead) ||
      typeof group.Lead?.RomanizedText === "string" ||
      group.Lead?.Syllables?.some((s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string") === true ||
      group.Background?.some((bg: any) =>
        hasTransliteration(bg) ||
        typeof bg.RomanizedText === "string" ||
        bg.Syllables?.some((s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string") === true
      ) === true
    ) === true;
  }
  return false;
};

const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

const joinSyllables = (syllables: any[], compact = false): string => {
  return syllables.reduce((acc, syl, index) => {
    const text = syl.Text || "";
    if (index === 0) return text;

    if (!compact) return `${acc}${syl.IsPartOfWord ? "" : " "}${text}`;

    const prevText = syllables[index - 1]?.Text || "";
    const shouldPreserveWordSpace = !syl.IsPartOfWord && (LatinWordTextTest.test(prevText) || LatinWordTextTest.test(text));
    return `${acc}${shouldPreserveWordSpace ? " " : ""}${text}`;
  }, "");
};

const romanizeLineText = async (
  text: string,
  docContext: ScriptBranchDocContext,
  packages: RomanizationPackages,
  language: string
): Promise<string | undefined> => {
  const entry: RomanizeEntry = { target: { Text: text }, line: {}, lineText: text };
  const changed = await romanizeEntry(entry, docContext, packages, language, false);
  return changed ? entry.target.TransliteratedText : undefined;
};

const postProcessSyllableRomanization = async (
  lyrics: any,
  docContext: ScriptBranchDocContext,
  packages: RomanizationPackages,
  language: string
) => {
  if (lyrics.Type !== "Syllable") return;

  const isJapaneseSong =
    language === "jpn" ||
    lyrics.Content?.some((group: any) =>
      group.Lead?.Syllables?.some((s: any) => JapaneseTextTest.test(s.Text || ""))
    );
  const isChineseSong =
    language === "cmn" ||
    language === "yue" ||
    lyrics.Content?.some((group: any) =>
      group.Lead?.Syllables?.some((s: any) => ChineseTextTest.test(s.Text || ""))
    );

  for (const vocalGroup of lyrics.Content || []) {
    if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

    const processGroup = async (group: any) => {
      const syllables = group?.Syllables;
      if (!Array.isArray(syllables) || syllables.length === 0) return;

      const lineText = joinSyllables(syllables, isJapaneseSong);
      const fullRomaji = await romanizeLineText(lineText, docContext, packages, language);
      if (!fullRomaji) return;

      group.TransliteratedText = fullRomaji;
      group.RomanizedText = fullRomaji;

      if (isJapaneseSong) {
        for (const syllable of syllables) {
          delete syllable.RomanizedText;
          delete syllable.TransliteratedText;
          delete syllable.RomajiSpaceBefore;
          clearLegacyFuriganaFields(syllable);
          delete syllable.JapaneseReading;
        }
        group.JapaneseReading = await applyJapaneseReadingToSyllables(lineText, fullRomaji, syllables, RomajiPromise);
        for (const syllable of syllables) {
          if (syllable.RomanizedText) {
            syllable.TransliteratedText = syllable.RomanizedText;
          } else {
            delete syllable.TransliteratedText;
          }
        }
      } else {
        for (let index = 0; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          if (syllable.TransliteratedText && !syllable.RomanizedText) {
            syllable.RomanizedText = syllable.TransliteratedText;
          }
          if (isChineseSong && index > 0 && syllable.RomanizedText) {
            syllable.RomajiSpaceBefore = true;
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
  packages: RomanizationPackages,
  primaryLanguage: string,
  annotateJapanese: boolean = true
): Promise<boolean> => {
  const { target, line } = entry;

  if (target.Text) target.Text = cleanInvisibles(target.Text.normalize("NFKC"));
  const lineScripts = scriptBranchForLine(entry.lineText || target.Text || "", docContext);

  if (hasTransliteration(target)) {
    if (annotateJapanese && lineScripts.includes("Japanese") && ItemJapaneseTest.test(target.Text || "")) {
      // Provider romaji can leak Chinese readings for kanji or mishandle particles.
      // If provider furigana is kept, derive romaji from that same ruby so the
      // visible readings cannot disagree.
      const previousRomanized = target.RomanizedText || target.TransliteratedText;
      const providerReading = target.JapaneseReading;
      if (providerReading?.furigana?.length) {
        const providerRomaji = await romanizeJapaneseFromFurigana(target.Text || "", providerReading.furigana, RomajiPromise);
        if (providerRomaji) {
          target.TransliteratedText = providerRomaji;
          target.RomanizedText = providerRomaji;
          providerReading.romaji = providerRomaji;
          return providerRomaji !== previousRomanized;
        }
      }
      const localReading = await annotateJapaneseTextTarget(target, undefined, RomajiPromise);
      if (localReading?.romaji) {
        target.TransliteratedText = localReading.romaji;
        target.RomanizedText = localReading.romaji;
      }
      return (target.RomanizedText || target.TransliteratedText) !== previousRomanized;
    }
    return true;
  }

  let text: string = target.Text;
  let changed = false;

  for (const script of lineScripts) {
    if (script === "Japanese") {
      if (ItemJapaneseTest.test(text)) {
        text = await romanizeJapaneseText(text);
        changed = true;
      }
    } else if (script === "Chinese") {
      if (ItemChineseTest.test(text)) {
        text = await romanizeChineseText(text, packages.pinyin, primaryLanguage);
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
        text = romanizeGreekText(text, packages.greekRomanization);
        changed = true;
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
    if (!acceptRomanization(target.Text || "", text, lineScripts.map((script) => ScriptResidualTests[script]))) {
      return false;
    }
    target.TransliteratedText = text;
    target.RomanizedText = text;
    line.HasTransliterations = true;
    if (annotateJapanese && lineScripts.includes("Japanese") && ItemJapaneseTest.test(target.Text || "")) {
      await annotateJapaneseTextTarget(target, text, RomajiPromise);
    }
  }

  return changed;
};

export const ProcessLyrics = async (
  lyrics: any,
  options: { updatePageClasses?: boolean; awaitTranslation?: boolean } = {}
) => {
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  const updatePageClasses = options.updatePageClasses !== false;
  const awaitTranslation = options.awaitTranslation !== false;
  const hadApiTransliterations = lyrics.HasTransliterations === true;
  const { francText, scriptText, entries } = gatherText(lyrics);

  const language = franc(francText);
  const languageISO2 = langs.where("3", language)?.["1"];
  lyrics.Language = language;
  lyrics.LanguageISO2 = languageISO2;

  const presentScripts = detectPresentScripts(scriptText, language, languageISO2);
  const docContext: ScriptBranchDocContext = {
    presentScripts,
    primaryLanguage: language,
    iso2Language: languageISO2,
  };

  let appliedRomanization = false;
  let packages: RomanizationPackages = {};
  const needsRomanizationOrJapaneseReading = entries.some((entry) =>
    !hasTransliteration(entry.target) ||
    (
      scriptBranchForLine(entry.lineText, docContext).includes("Japanese") &&
      ItemJapaneseTest.test(entry.target.Text || "") &&
      !entry.target.JapaneseReading
    )
  );
  if (presentScripts.length > 0 && needsRomanizationOrJapaneseReading) {
    packages = await loadPackagesForScripts(presentScripts);
    const results = await Promise.all(
      entries.map((entry) => romanizeEntry(entry, docContext, packages, language, lyrics.Type !== "Syllable"))
    );
    appliedRomanization = results.some(Boolean);
  }

  if (presentScripts.length > 0) {
    if (Object.keys(packages).length === 0) packages = await loadPackagesForScripts(presentScripts);
    await postProcessSyllableRomanization(lyrics, docContext, packages, language);
  }

  const hasAnyTransliteration = lyricsHaveAnyTransliteration(lyrics);
  lyrics.IncludesRomanization = hadApiTransliterations || appliedRomanization || hasAnyTransliteration;
  lyrics.HasTransliterations = hadApiTransliterations || appliedRomanization || hasAnyTransliteration;

  if (updatePageClasses) {
    if (lyrics.HasTransliterations === true) {
      PageContainer?.classList.add("Lyrics_RomanizationAvailable");
    } else {
      PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
    }

    const detectedChinese = presentScripts.includes("Chinese");
    lyrics.DetectedChinese = detectedChinese;
    if (detectedChinese) {
      PageContainer?.classList.add("Lyrics_ChineseDetected");
    } else {
      PageContainer?.classList.remove("Lyrics_ChineseDetected");
    }
  }

  if (awaitTranslation) {
    lyrics.DetectedChinese = presentScripts.includes("Chinese");

  await translateLyrics(lyrics);
    if (updatePageClasses) {
      if (lyrics.IncludesTranslation === true) {
        PageContainer?.classList.add("Lyrics_TranslationAvailable");
      } else {
        PageContainer?.classList.remove("Lyrics_TranslationAvailable");
      }
    }
  }
};
