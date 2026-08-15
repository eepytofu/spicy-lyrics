import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { resolveLyricBoundary } from "./BoundaryResolver.ts";
import { codePointLength } from "./CodePoint.ts";
import type {
  Boundary,
  CanonicalLine,
  ParsedLine,
} from "./Model.ts";

const normalizeSpan = (text: string): string =>
  cleanInvisiblesPreserveEdges(text || "");
const coreText = (text: string): string => text.replace(/^\s+|\s+$/gu, "");

function appendBoundary(
  text: string,
  boundaries: Boundary[],
  kind: Boundary["kind"],
  semanticKind: Boundary["semanticKind"],
  provenance: string
): string {
  if (!text || /\s$/u.test(text)) return text;
  boundaries.push({
    offsetCp: codePointLength(text),
    kind,
    semanticKind,
    confidence: 1,
    provenance,
  });
  return `${text} `;
}

export function buildCanonicalLine(line: ParsedLine): CanonicalLine {
  let text = "";
  const spanMappings: CanonicalLine["spanMappings"][number][] = [];
  const boundaries: Boundary[] = [];

  line.spans.forEach((span, index) => {
    const normalized = normalizeSpan(span.rawText || span.cleanText);
    const previous = line.spans[index - 1];
    if (index > 0) {
      const previousText = normalizeSpan(previous.rawText || previous.cleanText);
      const resolution = resolveLyricBoundary({
        previousText,
        currentText: normalized,
        previousProviderPartOfWord: previous.providerPartOfWord,
      });
      if (resolution.authoredWhitespace) {
        text = appendBoundary(
          text,
          boundaries,
          "explicitWhitespace",
          "authoredWhitespace",
          "providerTextWhitespace",
        );
      } else if (resolution.providerSemantic) {
        text = appendBoundary(
          text,
          boundaries,
          "inferred",
          "providerSemantic",
          "providerPartOfWord:false",
        );
      }
    }

    const clean = coreText(normalized);
    const startCp = codePointLength(text);
    text += clean;
    spanMappings.push({
      spanId: span.id,
      canonicalRange: { startCp, endCp: codePointLength(text) },
    });
  });

  return { lineId: line.id, text, spanMappings, boundaries };
}
