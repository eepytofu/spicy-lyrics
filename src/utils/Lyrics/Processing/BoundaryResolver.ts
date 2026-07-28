export type BoundarySemanticKind =
  | "authoredWhitespace"
  | "providerSemantic"
  | "linguistic"
  | "readability";

export type BoundaryResolution = Readonly<{
  kinds: readonly BoundarySemanticKind[];
  authoredWhitespace: boolean;
  providerSemantic: boolean;
  linguistic: boolean;
  readability: boolean;
  needsNormalizedSpace: boolean;
  needsReadingSpace: boolean;
  needsReadabilityGap: boolean;
}>;

export type BoundaryEvidence = Readonly<{
  previousText: string;
  currentText: string;
  previousProviderPartOfWord?: boolean;
  linguisticBoundaryBefore?: boolean;
}>;

const LatinScript = /^\p{Script=Latin}$/u;
const Letter = /^\p{Letter}$/u;

const isLatinLetter = (character: string): boolean =>
  Letter.test(character) && LatinScript.test(character);
const isNonLatinLetter = (character: string): boolean =>
  Letter.test(character) && !LatinScript.test(character);

export function hasMixedScriptReadabilityBoundary(left: string, right: string): boolean {
  const leftCharacters = Array.from(left || "");
  const rightCharacters = Array.from(right || "");
  const previous = leftCharacters.at(-1) || "";
  const next = rightCharacters[0] || "";
  return (
    (isLatinLetter(previous) && isNonLatinLetter(next)) ||
    (isNonLatinLetter(previous) && isLatinLetter(next))
  );
}

export function resolveLyricBoundary(evidence: BoundaryEvidence): BoundaryResolution {
  const authoredWhitespace =
    /\s$/u.test(evidence.previousText) || /^\s/u.test(evidence.currentText);
  const providerSemantic =
    !authoredWhitespace && evidence.previousProviderPartOfWord !== true;
  const linguistic = evidence.linguisticBoundaryBefore === true;
  const readability =
    !authoredWhitespace &&
    !providerSemantic &&
    hasMixedScriptReadabilityBoundary(evidence.previousText, evidence.currentText);

  const kinds: BoundarySemanticKind[] = [];
  if (authoredWhitespace) kinds.push("authoredWhitespace");
  if (providerSemantic) kinds.push("providerSemantic");
  if (linguistic) kinds.push("linguistic");
  if (readability) kinds.push("readability");

  return Object.freeze({
    kinds: Object.freeze(kinds),
    authoredWhitespace,
    providerSemantic,
    linguistic,
    readability,
    needsNormalizedSpace: providerSemantic,
    needsReadingSpace: providerSemantic || linguistic || readability,
    needsReadabilityGap: readability,
  });
}
