import { needsSyllableSpaceBefore } from "./SyllableBoundaries.ts";
import type { AboveReadingKind, AboveReadingSegment } from "./Model.ts";
import {
  countHanCodePoints,
  hasChineseOnlyHanForms,
  hasJapaneseOnlyHanForms,
} from "./CjkLanguageEvidence.ts";

export type CjkReadingBranch = "Japanese" | "Chinese";
export type CjkLineRoute = CjkReadingBranch | "MixedChinese";
export type CjkDocumentContext = {
  branch?: CjkReadingBranch;
  bilingual: boolean;
};

export type CjkScriptBranchContext = {
  presentScripts: readonly string[];
  primaryLanguage: string;
  iso2Language?: string;
  cjkDominantBranch?: CjkReadingBranch;
  cjkBilingual?: boolean;
  cjkContextualHanRoutes?: ReadonlyMap<string, CjkContextualHanRoute>;
};

export type CjkContextualHanRoute = {
  route: CjkReadingBranch;
  evidence: "agreeingSequence";
};

const HanTextTest = /\p{Script=Han}/u;
const KanaTextTest = /\p{Script=Hiragana}|\p{Script=Katakana}/u;

const cleanCjkText = (text: string): string =>
  text.replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "");

export const cjkLineKey = (text: string): string => cleanCjkText(text.normalize("NFKC")).trim();

const cjkBranchFromLanguage = (primaryLanguage: string): CjkReadingBranch | undefined => {
  if (primaryLanguage === "jpn") return "Japanese";
  if (primaryLanguage === "cmn" || primaryLanguage === "yue") return "Chinese";
  return undefined;
};

export function resolveCjkDocumentContext(
  text: string,
  primaryLanguage: string,
  _iso2Language?: string,
): CjkDocumentContext {
  const lines = cleanCjkText(text.normalize("NFKC")).split(/\r?\n/u);
  let kanaLines = 0;
  let hanOnlyLines = 0;

  for (const line of lines) {
    const hasKana = KanaTextTest.test(line);
    const hasHan = HanTextTest.test(line);
    if (hasKana) kanaLines += 1;
    else if (hasHan) hanOnlyLines += 1;
  }

  let branch: CjkReadingBranch | undefined;
  if (kanaLines === 0 && hanOnlyLines === 0) {
    branch = undefined;
  } else if (hanOnlyLines >= 2 && hanOnlyLines >= kanaLines * 2) {
    branch = "Chinese";
  } else if (kanaLines >= 2 && kanaLines >= hanOnlyLines) {
    branch = "Japanese";
  } else {
    branch = cjkBranchFromLanguage(primaryLanguage) ??
      (kanaLines > hanOnlyLines ? "Japanese" : "Chinese");
  }

  let distinctKanaLines = 0;
  let chineseEvidenceLines = 0;
  let longHanOnlyLines = 0;
  for (const line of new Set(lines)) {
    if (KanaTextTest.test(line)) {
      distinctKanaLines += 1;
      continue;
    }
    if (!HanTextTest.test(line)) continue;
    const chineseEvidence = hasChineseOnlyHanForms(line);
    if (chineseEvidence) chineseEvidenceLines += 1;
    if (chineseEvidence || (!hasJapaneseOnlyHanForms(line) && countHanCodePoints(line) >= 5)) {
      longHanOnlyLines += 1;
    }
  }

  return {
    branch,
    bilingual: distinctKanaLines >= 2 && chineseEvidenceLines >= 1 && longHanOnlyLines >= 2,
  };
}

export function resolveCjkDocumentBranch(
  text: string,
  primaryLanguage: string,
  iso2Language?: string,
): CjkReadingBranch | undefined {
  return resolveCjkDocumentContext(text, primaryLanguage, iso2Language).branch;
}

type StrongCjkLineEvidence = CjkReadingBranch | "Boundary" | undefined;

const strongLineEvidence = (
  line: string,
  document: CjkDocumentContext,
): StrongCjkLineEvidence => {
  const text = cjkLineKey(line);
  if (!text) return "Boundary";
  const hasKana = KanaTextTest.test(text);
  const hasHan = HanTextTest.test(text);
  if (!hasKana && !hasHan) return "Boundary";
  if (hasKana) return "Japanese";
  if (hasJapaneseOnlyHanForms(text)) return "Japanese";
  if (
    hasChineseOnlyHanForms(text) &&
    (document.branch === "Chinese" || document.bilingual)
  ) return "Chinese";
  return undefined;
};

/**
 * Resolve otherwise ambiguous Han-only lines from agreeing evidence on both
 * sides. Blocks are supplied separately so lead/background lanes and authored
 * section boundaries cannot leak context into one another.
 */
export function buildCjkContextualHanRoutes(
  blocks: readonly (readonly string[])[],
  document: CjkDocumentContext,
): ReadonlyMap<string, CjkContextualHanRoute> {
  if (!document.bilingual) return new Map();

  const occurrences = new Map<string, Array<CjkReadingBranch | undefined>>();
  for (const block of blocks) {
    const evidence = block.map((line) => strongLineEvidence(line, document));
    const nearestBefore: StrongCjkLineEvidence[] = [];
    const nearestAfter: StrongCjkLineEvidence[] = [];
    let nearest: StrongCjkLineEvidence;
    for (let index = 0; index < block.length; index += 1) {
      nearestBefore[index] = nearest;
      if (evidence[index] === "Boundary") nearest = undefined;
      else if (evidence[index]) nearest = evidence[index];
    }
    nearest = undefined;
    for (let index = block.length - 1; index >= 0; index -= 1) {
      nearestAfter[index] = nearest;
      if (evidence[index] === "Boundary") nearest = undefined;
      else if (evidence[index]) nearest = evidence[index];
    }

    for (let index = 0; index < block.length; index += 1) {
      const key = cjkLineKey(block[index]);
      if (!key || evidence[index] !== undefined || !HanTextTest.test(key) || KanaTextTest.test(key)) {
        continue;
      }

      const before = nearestBefore[index];
      const after = nearestAfter[index];
      const inferred = before && before === after ? before : undefined;
      const routes = occurrences.get(key) ?? [];
      routes.push(inferred);
      occurrences.set(key, routes);
    }
  }

  const routes = new Map<string, CjkContextualHanRoute>();
  for (const [key, inferred] of occurrences) {
    if (inferred.length > 0 && inferred.every((route) => route === inferred[0]) && inferred[0]) {
      routes.set(key, { route: inferred[0], evidence: "agreeingSequence" });
    }
  }
  return routes;
}

const hanBranchForLine = (docContext: CjkScriptBranchContext): CjkReadingBranch => {
  if (docContext.cjkDominantBranch) return docContext.cjkDominantBranch;
  const hasDocJapanese = docContext.presentScripts.includes("Japanese");
  const hasDocChinese = docContext.presentScripts.includes("Chinese");
  if (hasDocJapanese && !hasDocChinese) return "Japanese";
  if (hasDocChinese && !hasDocJapanese) return "Chinese";
  return cjkBranchFromLanguage(docContext.primaryLanguage) ??
    (hasDocJapanese ? "Japanese" : "Chinese");
};

export function resolveCjkLineRoute(
  lineText: string,
  docContext: CjkScriptBranchContext,
): CjkLineRoute | undefined {
  const text = cleanCjkText(lineText.normalize("NFKC"));
  const hasKana = KanaTextTest.test(text);
  const hasHan = HanTextTest.test(text);
  if (!hasKana) {
    if (!hasHan) return undefined;
    if (hasJapaneseOnlyHanForms(text)) return "Japanese";
    if (
      hasChineseOnlyHanForms(text) &&
      (docContext.cjkDominantBranch === "Chinese" || docContext.cjkBilingual)
    ) return "Chinese";
    const contextualRoute = docContext.cjkContextualHanRoutes?.get(cjkLineKey(text));
    if (contextualRoute) return contextualRoute.route;
    if (docContext.cjkBilingual && countHanCodePoints(text) >= 5) return "Chinese";
    return hanBranchForLine(docContext);
  }
  if (!hasHan || docContext.cjkDominantBranch !== "Chinese") return "Japanese";

  let kanaCount = 0;
  let hanCount = 0;
  let kanaRuns = 0;
  let inKanaRun = false;
  let firstCjk: CjkReadingBranch | undefined;
  let lastCjk: CjkReadingBranch | undefined;

  for (const char of Array.from(text)) {
    if (KanaTextTest.test(char)) {
      kanaCount += 1;
      if (!inKanaRun) kanaRuns += 1;
      inKanaRun = true;
      firstCjk ||= "Japanese";
      lastCjk = "Japanese";
    } else if (HanTextTest.test(char)) {
      hanCount += 1;
      inKanaRun = false;
      firstCjk ||= "Chinese";
      lastCjk = "Chinese";
    }
  }

  const kanaIsInternal = firstCjk === "Chinese" && lastCjk === "Chinese";
  if (kanaRuns >= 2 || kanaIsInternal || kanaCount >= hanCount) return "Japanese";
  return "MixedChinese";
}

export type CjkReadingRunKind = "Han" | "Kana" | "Other";

export type CjkReadingRun = {
  kind: CjkReadingRunKind;
  text: string;
};

type ChineseDominantProcessors = {
  romanizeHan: (text: string) => string | undefined | Promise<string | undefined>;
  romanizeKana: (text: string) => string | undefined | Promise<string | undefined>;
};

export type CjkRunReadingSegment = {
  startCp: number;
  endCp: number;
  reading: string;
  kind: AboveReadingKind;
};

export type CjkRunReadingProjection = {
  text: string;
  segments: readonly CjkRunReadingSegment[];
  valid: boolean;
};

type ChineseDominantProjectionProcessors = {
  projectHan: (text: string) => CjkRunReadingProjection | Promise<CjkRunReadingProjection>;
  projectKana: (text: string) => CjkRunReadingProjection | Promise<CjkRunReadingProjection>;
};

export type ChineseDominantReadingProjection = {
  text: string;
  aboveReadingSegments: readonly AboveReadingSegment[];
  valid: boolean;
};

type TimedReadingTextUnit = {
  Text?: string;
  IsPartOfWord?: boolean;
};

const HanCharTest = /\p{Script=Han}/u;
const KanaCharTest = /\p{Script=Hiragana}|\p{Script=Katakana}/u;
const LatinCharTest = /\p{Script=Latin}/u;

export function buildCjkReadingContextText(syllables: TimedReadingTextUnit[]): string {
  return syllables.reduce((lineText, syllable, index) => {
    const text = syllable.Text || "";
    if (index === 0) return text;

    const previousText = syllables[index - 1]?.Text || "";
    const preserveAuthoredWordSpace = needsSyllableSpaceBefore(syllables, index) &&
      (LatinCharTest.test(previousText) || LatinCharTest.test(text));
    return `${lineText}${preserveAuthoredWordSpace ? " " : ""}${text}`;
  }, "");
}

function runKind(char: string): CjkReadingRunKind {
  if (HanCharTest.test(char)) return "Han";
  if (KanaCharTest.test(char)) return "Kana";
  return "Other";
}

export function partitionCjkReadingRuns(text: string): CjkReadingRun[] {
  const runs: CjkReadingRun[] = [];
  for (const char of Array.from(text.normalize("NFKC"))) {
    const kind = runKind(char);
    const previous = runs[runs.length - 1];
    // Provider word boundaries and punctuation are neutral. Keep them with the
    // preceding language region so a timed Chinese line is not sent through
    // the Pinyin processor once per provider word.
    if (kind === "Other" && previous) previous.text += char;
    else if (previous?.kind === kind) previous.text += char;
    else runs.push({ kind, text: char });
  }
  return runs;
}

export async function romanizeChineseDominantCjkText(
  text: string,
  processors: ChineseDominantProcessors
): Promise<string> {
  const runs = partitionCjkReadingRuns(text);
  let output = "";
  let previousKind: CjkReadingRunKind | undefined;

  for (const run of runs) {
    let transformed = run.text;
    if (run.kind === "Han") transformed = (await processors.romanizeHan(run.text)) || run.text;
    else if (run.kind === "Kana") transformed = (await processors.romanizeKana(run.text)) || run.text;

    const crossesReadableScriptBoundary =
      (previousKind === "Han" || previousKind === "Kana") &&
      (run.kind === "Han" || run.kind === "Kana") &&
      previousKind !== run.kind;
    if (crossesReadableScriptBoundary && output && !/\s$/u.test(output) && !/^\s/u.test(transformed)) {
      output += " ";
    }
    output += transformed;
    previousKind = run.kind;
  }

  return output;
}

export async function projectChineseDominantCjkReadings(
  text: string,
  processors: ChineseDominantProjectionProcessors,
): Promise<ChineseDominantReadingProjection> {
  const runs = partitionCjkReadingRuns(text);
  const aboveReadingSegments: AboveReadingSegment[] = [];
  let output = "";
  let sourceCursorCp = 0;
  let previousKind: CjkReadingRunKind | undefined;
  // The existing run partition normalizes for analyzer compatibility. Above
  // readings need exact source coordinates, so fail closed if normalization
  // changed the authored text rather than guessing at a range projection.
  let valid = runs.map((run) => run.text).join("") === text;

  for (const run of runs) {
    let projection: CjkRunReadingProjection = { text: run.text, segments: [], valid: true };
    if (run.kind === "Han") projection = await processors.projectHan(run.text);
    else if (run.kind === "Kana") projection = await processors.projectKana(run.text);

    const runLengthCp = Array.from(run.text).length;
    valid &&= projection.valid && projection.segments.every((segment) =>
      segment.reading.length > 0 &&
      segment.startCp >= 0 &&
      segment.endCp > segment.startCp &&
      segment.endCp <= runLengthCp
    );
    for (const segment of projection.segments) {
      aboveReadingSegments.push({
        canonicalRange: {
          startCp: sourceCursorCp + segment.startCp,
          endCp: sourceCursorCp + segment.endCp,
        },
        reading: segment.reading,
        kind: segment.kind,
        provenance: "local",
      });
    }

    const transformed = projection.text || run.text;
    const crossesReadableScriptBoundary =
      (previousKind === "Han" || previousKind === "Kana") &&
      (run.kind === "Han" || run.kind === "Kana") &&
      previousKind !== run.kind;
    if (crossesReadableScriptBoundary && output && !/\s$/u.test(output) && !/^\s/u.test(transformed)) {
      output += " ";
    }
    output += transformed;
    sourceCursorCp += runLengthCp;
    previousKind = run.kind;
  }

  return { text: output, aboveReadingSegments, valid };
}
