import { createHash } from "node:crypto";

import type {
  ProviderKanaLayer,
  ProviderKanaTime,
  ProviderKanaTiming,
  ProviderKanaUnit,
  ProviderLineReadingLane,
  ProviderLineReadingRow,
  ProviderLayerProvenance,
  ProviderPhoneticLane,
  ProviderReadingEvidence,
  ProviderReadingFinding,
  ProviderId,
  TimedLine,
} from "./types";

type KanaEntry = {
  count: number;
  reading: string;
  timings: ProviderKanaTime[];
  findings: ProviderReadingFinding[];
};

type SourceUnit = ProviderKanaUnit["source"] & {
  tokenText: string;
  baseStartMs: number;
  rawBaseStartMs: number;
  baseDurationMs: number;
};

const KanaReading = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]*$/u;
const AsciiDigit = /^[0-9]$/u;
const DecimalDigit = /^[0-9０-９]$/u;
const BmpHanOrIteration = /^[\u4e00-\u9fff々]$/u;

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function rawKanaLines(value: string): string[] {
  return value.split(/\r?\n/u).filter((line) => line.startsWith("[kana:"));
}

function stripKanaTimings(line: string): string {
  return line.replace(/\(\d+,\d+\)/gu, "");
}

function parseKanaEntries(rawLine: string): {
  entries: KanaEntry[];
  findings: ProviderReadingFinding[];
  rejected: boolean;
} {
  const findings: ProviderReadingFinding[] = [];
  const close = rawLine.lastIndexOf("]");
  if (!rawLine.startsWith("[kana:") || close < 6) {
    return { entries: [], findings: ["malformedTimingGroup"], rejected: true };
  }
  const content = rawLine.slice(6, close);
  const entries: KanaEntry[] = [];
  let cursor = 0;
  let rejected = false;
  while (cursor < content.length) {
    const countText = content[cursor];
    if (!AsciiDigit.test(countText)) {
      findings.push("malformedTimingGroup");
      rejected = true;
      break;
    }
    const count = Number(countText);
    cursor += 1;
    const readingParts: string[] = [];
    const timings: ProviderKanaTime[] = [];
    const entryFindings: ProviderReadingFinding[] = [];
    while (cursor < content.length && !AsciiDigit.test(content[cursor])) {
      if (content[cursor] === "(") {
        const timing = /^\((\d+),(\d+)\)/u.exec(content.slice(cursor));
        if (!timing) {
          entryFindings.push("malformedTimingGroup");
          rejected = true;
          cursor = content.length;
          break;
        }
        timings.push({ startMs: Number(timing[1]), durationMs: Number(timing[2]) });
        cursor += timing[0].length;
        continue;
      }
      const codePoint = String.fromCodePoint(content.codePointAt(cursor)!);
      readingParts.push(codePoint);
      cursor += codePoint.length;
    }
    const reading = readingParts.join("");
    if (count === 0) {
      entryFindings.push("zeroCount");
      rejected = true;
    }
    if (count >= 3) entryFindings.push("oversizeCount");
    if (!reading && count > 1) {
      entryFindings.push("emptyReadingWithGroup");
      rejected = true;
    }
    if (!KanaReading.test(reading)) {
      entryFindings.push("readingContainsNonKana");
      rejected = true;
    }
    entries.push({ count, reading, timings, findings: entryFindings });
    findings.push(...entryFindings);
  }
  return { entries, findings: [...new Set(findings)], rejected };
}

function sourceUnits(lines: readonly TimedLine[]): SourceUnit[] {
  const units: SourceUnit[] = [];
  for (const [rowOrdinal, line] of lines.entries()) {
    for (const [tokenOrdinal, word] of line.words.entries()) {
      const text = word.text;
      let utf16Start = 0;
      while (utf16Start < text.length) {
        const codePoint = String.fromCodePoint(text.codePointAt(utf16Start)!);
        if (BmpHanOrIteration.test(codePoint)) {
          units.push({
            rowOrdinal,
            tokenOrdinal,
            utf16Start,
            utf16End: utf16Start + codePoint.length,
            codePointCount: 1,
            exactSourceSlice: codePoint,
            tokenText: text,
            baseStartMs: word.startMs,
            rawBaseStartMs: word.rawStartMs ?? word.startMs,
            baseDurationMs: word.durationMs,
          });
          utf16Start += codePoint.length;
          continue;
        }
        if (DecimalDigit.test(codePoint)) {
          let utf16End = utf16Start + codePoint.length;
          let codePointCount = 1;
          while (utf16End < text.length) {
            const next = String.fromCodePoint(text.codePointAt(utf16End)!);
            if (!DecimalDigit.test(next)) break;
            utf16End += next.length;
            codePointCount += 1;
          }
          units.push({
            rowOrdinal,
            tokenOrdinal,
            utf16Start,
            utf16End,
            codePointCount,
            exactSourceSlice: text.slice(utf16Start, utf16End),
            tokenText: text,
            baseStartMs: word.startMs,
            rawBaseStartMs: word.rawStartMs ?? word.startMs,
            baseDurationMs: word.durationMs,
          });
          utf16Start = utf16End;
          continue;
        }
        utf16Start += codePoint.length;
      }
    }
  }
  return units;
}

function timingForEntry(
  entry: KanaEntry,
  unit: SourceUnit,
  offsetMs: number
): { timing: ProviderKanaTiming; findings: ProviderReadingFinding[] } {
  const findings: ProviderReadingFinding[] = [];
  const rawBaseStartMs = unit.rawBaseStartMs;
  const effectiveKana = entry.timings.map((time) => ({
    startMs: time.startMs + offsetMs,
    durationMs: time.durationMs,
  }));
  const internalGaps = entry.timings.slice(0, -1).flatMap((time, index) => {
    const gapMs = entry.timings[index + 1].startMs - (time.startMs + time.durationMs);
    return gapMs > 0 ? [{ afterKanaIndex: index, gapMs }] : [];
  });
  const timing: ProviderKanaTiming = {
    state: entry.timings.length ? "timingProven" : "timingAbsent",
    offsetMs,
    rawBaseStartMs,
    effectiveBaseStartMs: unit.baseStartMs,
    baseDurationMs: unit.baseDurationMs,
    rawKana: entry.timings.map((time) => ({ ...time })),
    effectiveKana,
    internalGaps,
  };
  if (!entry.timings.length) return { timing, findings };
  const kanaCount = [...entry.reading].length;
  if (entry.timings.length !== kanaCount) findings.push("partialSubTiming");
  if (entry.timings[0]?.startMs !== rawBaseStartMs) findings.push("anchorMismatch");
  const last = entry.timings.at(-1)!;
  const spanEndDeltaMs = last.startMs + last.durationMs - (rawBaseStartMs + unit.baseDurationMs);
  timing.spanEndDeltaMs = spanEndDeltaMs;
  if (Math.abs(spanEndDeltaMs) > 1) findings.push("spanEndOutOfTolerance");
  for (const [index, time] of entry.timings.entries()) {
    if (time.durationMs <= 0) findings.push("zeroDurationTiming");
    const previous = entry.timings[index - 1];
    if (!previous) continue;
    if (time.startMs < previous.startMs) findings.push("nonMonotonicTiming");
    if (time.startMs < previous.startMs + previous.durationMs) findings.push("overlappingTiming");
  }
  if (findings.length) timing.state = "timingRejected";
  return { timing, findings: [...new Set(findings)] };
}

export function parseProviderKanaLayer(
  value: string,
  lines: readonly TimedLine[],
  providerId: "qq" | "kugou",
  container: "qrc" | "krc",
  offsetMs = 0,
  redundantTranslation?: string
): ProviderKanaLayer | undefined {
  const rawLines = rawKanaLines(value);
  if (!rawLines.length) return undefined;
  const rawLine = rawLines[0];
  const parsed = parseKanaEntries(rawLine);
  const findings = [...parsed.findings];
  let rejected = parsed.rejected;
  if (rawLines.length > 1) {
    findings.push("duplicateKanaLine");
    if (rawLines.some((line) => stripKanaTimings(line) !== stripKanaTimings(rawLine)))
      rejected = true;
  }
  const redundantLines = redundantTranslation ? rawKanaLines(redundantTranslation) : [];
  const redundantCopies = redundantLines.length
    ? [
        {
          documentRole: "translation" as const,
          identicalWithoutTimings:
            stripKanaTimings(redundantLines[0]) === stripKanaTimings(rawLine),
        },
      ]
    : [];
  if (redundantCopies.some((copy) => !copy.identicalWithoutTimings)) {
    findings.push("redundantLayerMismatch");
  }

  const resolved = sourceUnits(lines);
  const declaredUnitCount = parsed.entries.reduce((sum, entry) => sum + entry.count, 0);
  if (declaredUnitCount !== resolved.length) {
    findings.push("walkNotClosed");
    findings.push(declaredUnitCount < resolved.length ? "truncatedLine" : "extraEntries");
    rejected = true;
  }

  const units: ProviderKanaUnit[] = [];
  if (!rejected) {
    let unitCursor = 0;
    for (const [entryIndex, entry] of parsed.entries.entries()) {
      const grouped = resolved.slice(unitCursor, unitCursor + entry.count);
      const first = grouped[0];
      const groupFindings: ProviderReadingFinding[] = [];
      if (grouped.some((unit) => unit.rowOrdinal !== first.rowOrdinal))
        groupFindings.push("groupSpansRow");
      if (grouped.some((unit) => unit.tokenOrdinal !== first.tokenOrdinal))
        groupFindings.push("groupSpansToken");
      // `grouped` is a consecutive slice of the document reading-unit walk. Non-unit characters
      // such as okurigana may legitimately occur between its members (`怒れる人` → ラングラー),
      // while the row/token checks above still prevent a provider group from crossing owners.
      if (groupFindings.length) {
        findings.push(...groupFindings);
        rejected = true;
        break;
      }
      const timing = timingForEntry(entry, first, offsetMs);
      const last = grouped.at(-1)!;
      const groupStart = first.utf16Start;
      const groupEnd = last.utf16End;
      const groupSlice = first.tokenText.slice(groupStart, groupEnd);
      const groupId = `${providerId}:kana:${entryIndex}`;
      for (const [groupIndex, source] of grouped.entries()) {
        units.push({
          ordinal: unitCursor + groupIndex,
          groupId,
          groupSize: entry.count,
          groupRole: entry.count === 1 ? "sole" : groupIndex === 0 ? "groupHead" : "groupMember",
          source: {
            rowOrdinal: source.rowOrdinal,
            tokenOrdinal: source.tokenOrdinal,
            utf16Start: source.utf16Start,
            utf16End: source.utf16End,
            codePointCount: source.codePointCount,
            exactSourceSlice: source.exactSourceSlice,
          },
          ...(groupIndex === 0
            ? {
                groupSource: {
                  rowOrdinal: first.rowOrdinal,
                  tokenOrdinal: first.tokenOrdinal,
                  utf16Start: groupStart,
                  utf16End: groupEnd,
                  readingUnitCount: entry.count,
                  codePointCount: [...groupSlice].length,
                  exactSourceSlice: groupSlice,
                },
              }
            : {}),
          coverage: entry.reading ? "covered" : "explicitEmpty",
          ...(entry.reading && groupIndex === 0 ? { reading: entry.reading } : {}),
          timing: {
            ...timing.timing,
            rawKana: timing.timing.rawKana.map((time) => ({ ...time })),
            effectiveKana: timing.timing.effectiveKana.map((time) => ({ ...time })),
            internalGaps: timing.timing.internalGaps.map((gap) => ({ ...gap })),
          },
          findings: [...new Set([...entry.findings, ...timing.findings])],
        });
      }
      unitCursor += entry.count;
    }
  }

  const uniqueFindings = [...new Set(findings)];
  return {
    transport: {
      providerId,
      container,
      documentRole: "primary",
      responseField: "lyric",
      rawLine,
      rawLineSha256: sha256(rawLine),
      rawLineByteLength: Buffer.byteLength(rawLine, "utf8"),
    },
    authorship: { authorshipProvenance: "unknown" },
    derivation: {
      redundantCopies,
      layersDerivedFromThis: [
        {
          documentRole: "romanization",
          relationship: "inferredDerivation",
        },
      ],
    },
    validation: {
      walkState: rejected
        ? uniqueFindings.includes("walkNotClosed")
          ? "walkNotClosed"
          : "layerRejected"
        : "ordinalUnitProven",
      declaredUnitCount,
      resolvedUnitCount: resolved.length,
      findings: uniqueFindings,
    },
    units: rejected ? [] : units,
  };
}

export function providerLineReadingLane(
  lane: Omit<ProviderLineReadingLane, "granularity" | "documentRole" | "rows">,
  rows: ProviderLineReadingRow[],
): ProviderLineReadingLane {
  return {
    ...lane,
    granularity: "line",
    documentRole: "romanization",
    rows,
  };
}

type ExactTimedReadingRow = {
  sourceRowOrdinal: number;
  rawStartMs: number;
  startMs: number;
  exactValue: string;
};

function exactTimedReadingRows(value: string): ExactTimedReadingRow[] {
  const rows: ExactTimedReadingRow[] = [];
  const offsetMatch = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/imu.exec(value);
  const offsetMs = Number(offsetMatch?.[1] ?? 0);
  let sourceRowOrdinal = 0;
  for (const row of value.split(/\r?\n/u)) {
    const timestamps: Array<{ minutes: number; seconds: number }> = [];
    let cursor = 0;
    while (cursor < row.length) {
      const timestamp = /^\s*\[(\d+):(\d+)(?:([.:])(\d+))?\]/u.exec(row.slice(cursor));
      if (!timestamp) break;
      timestamps.push({
        minutes: Number(timestamp[1]),
        seconds: Number(timestamp[2]) + (timestamp[4] ? Number(`0.${timestamp[4]}`) : 0),
      });
      cursor += timestamp[0].length;
    }
    if (!timestamps.length) continue;
    const exactValue = row.slice(cursor).replace(/\r$/u, "");
    for (const timestamp of timestamps) {
      rows.push({
        sourceRowOrdinal,
        rawStartMs: Math.round((timestamp.minutes * 60 + timestamp.seconds) * 1000),
        startMs: Math.max(
          0,
          Math.round((timestamp.minutes * 60 + timestamp.seconds) * 1000) + offsetMs
        ),
        exactValue,
      });
    }
    sourceRowOrdinal += 1;
  }
  return rows;
}

export function exactTimedLineReadings(
  targets: readonly { startMs: number }[],
  value: string | undefined,
): ProviderLineReadingRow[] {
  if (!value) return [];
  const sidecars = exactTimedReadingRows(value);
  if (!sidecars.length) return [];
  const targetOrdinals = new Map<number, number[]>();
  for (const [rowOrdinal, target] of targets.entries()) {
    const ordinals = targetOrdinals.get(target.startMs) ?? [];
    ordinals.push(rowOrdinal);
    targetOrdinals.set(target.startMs, ordinals);
  }
  const sidecarCounts = new Map<number, number>();
  for (const sidecar of sidecars)
    sidecarCounts.set(sidecar.startMs, (sidecarCounts.get(sidecar.startMs) ?? 0) + 1);

  return sidecars.map((sidecar): ProviderLineReadingRow => {
    const matches = targetOrdinals.get(sidecar.startMs) ?? [];
    const exact = matches.length === 1 && sidecarCounts.get(sidecar.startMs) === 1;
    const alignment = exact ? "exactTimestamp" : matches.length ? "ambiguous" : "unmatched";
    const rowOrdinal = exact ? matches[0] : undefined;
    return {
      exactValue: sidecar.exactValue,
      ...(rowOrdinal !== undefined ? { rowOrdinal } : {}),
      sourceRowOrdinal: sidecar.sourceRowOrdinal,
      rawStartMs: sidecar.rawStartMs,
      effectiveStartMs: sidecar.startMs,
      alignment,
      validationStatus: sidecar.exactValue ? "usable" : "explicitEmpty",
    };
  });
}

function targetScript(rows: readonly { cells: string[] }[]): ProviderPhoneticLane["targetScript"] {
  const value = rows.flatMap((row) => row.cells).join("");
  if (!value) return "empty";
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /\p{Script=Latin}/u.test(value);
  if (hasHan && hasLatin) return "mixed";
  if (hasHan) return "Han";
  if (hasLatin) return "Latin";
  return "unknown";
}

export function kugouPhoneticLanes(contentV2: unknown): ProviderPhoneticLane[] {
  const entries = Array.isArray(contentV2)
    ? contentV2
    : typeof contentV2 === "object" &&
        contentV2 !== null &&
        Array.isArray((contentV2 as any).content)
      ? (contentV2 as any).content
      : [];
  return entries.flatMap((entry: any, laneIndex: number): ProviderPhoneticLane[] => {
    const rawNumericKind = Number(entry?.type);
    if (!Number.isInteger(rawNumericKind)) return [];
    const validationFindings: ProviderPhoneticLane["validationFindings"] = [];
    const rawLanguage = Number.isInteger(entry?.language) ? Number(entry.language) : null;
    if (rawLanguage === null) validationFindings.push("invalidLanguage");
    if (!Array.isArray(entry?.lyricContent)) validationFindings.push("invalidRows");
    const rawRows = Array.isArray(entry?.lyricContent) ? entry.lyricContent : [];
    if (rawRows.some((row: unknown) => !Array.isArray(row))) {
      validationFindings.push("invalidRows");
    }
    if (
      rawRows.some(
        (row: unknown) =>
          Array.isArray(row) && row.some((cell: unknown) => typeof cell !== "string")
      )
    ) {
      validationFindings.push("invalidCells");
    }
    const shapeProven = validationFindings.length === 0;
    const rows: Array<{ rowOrdinal: number; cells: string[] }> = shapeProven
      ? rawRows.map((row: string[], rowOrdinal: number) => ({
          rowOrdinal,
          cells: [...row],
        }))
      : [];
    const declaredProvenanceText = rows[0]?.cells.find((cell: string) => cell.length > 0);
    const providerDeclaredGenerated =
      declaredProvenanceText === "以下谐音标注由AI工具生产";
    return [
      {
        evidenceId: `kugou:phonetic:${rawNumericKind}:${laneIndex}`,
        providerId: "kugou",
        rawNumericKind,
        rawLanguage,
        evidenceKind: "phonetic",
        targetScript: targetScript(rows),
        authorshipProvenance: providerDeclaredGenerated
          ? "providerDeclaredGenerated"
          : "unknown",
        ...(declaredProvenanceText ? { declaredProvenanceText } : {}),
        validationStatus: shapeProven ? "shapeProven" : "layerRejected",
        validationFindings: [...new Set(validationFindings)],
        rows,
      },
    ];
  });
}

export function providerReadingEvidence(
  providerId: ProviderId,
  kanaLayer?: ProviderKanaLayer,
  phoneticLanes: ProviderPhoneticLane[] = [],
  additionalLineReadings: ProviderLineReadingLane[] = [],
  layerProvenance: ProviderLayerProvenance[] = []
): ProviderReadingEvidence | undefined {
  const lineReadings = [...additionalLineReadings];
  if (!lineReadings.length && !kanaLayer && !phoneticLanes.length) return undefined;
  return {
    schemaVersion: 1,
    providerId,
    ...(layerProvenance.length ? { layerProvenance } : {}),
    ...(lineReadings.length ? { lineReadings } : {}),
    ...(kanaLayer ? { kanaLayers: [kanaLayer] } : {}),
    ...(phoneticLanes.length ? { phoneticLanes } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function readingFinding(value: unknown): value is ProviderReadingFinding {
  return (
    typeof value === "string" &&
    new Set<ProviderReadingFinding>([
      "walkNotClosed",
      "truncatedLine",
      "extraEntries",
      "zeroCount",
      "oversizeCount",
      "emptyReadingWithGroup",
      "groupSpansToken",
      "groupSpansRow",
      "readingContainsNonKana",
      "malformedTimingGroup",
      "partialSubTiming",
      "anchorMismatch",
      "spanEndOutOfTolerance",
      "nonMonotonicTiming",
      "overlappingTiming",
      "zeroDurationTiming",
      "duplicateKanaLine",
      "redundantLayerMismatch",
      "unknownSourceUnit",
    ]).has(value as ProviderReadingFinding)
  );
}

function providerKanaLayer(value: unknown, providerId: ProviderId): value is ProviderKanaLayer {
  if (
    !isRecord(value) ||
    !isRecord(value.transport) ||
    !isRecord(value.authorship) ||
    !isRecord(value.derivation) ||
    !isRecord(value.validation)
  )
    return false;
  const transport = value.transport;
  const validation = value.validation;
  const validTime = (time: unknown): boolean =>
    isRecord(time) &&
    finiteNumber(time.startMs) &&
    finiteNumber(time.durationMs) &&
    time.durationMs >= 0;
  const validTiming = (timing: unknown): boolean =>
    isRecord(timing) &&
    ["timingProven", "timingAbsent", "timingRejected"].includes(String(timing.state)) &&
    finiteNumber(timing.offsetMs) &&
    finiteNumber(timing.rawBaseStartMs) &&
    finiteNumber(timing.effectiveBaseStartMs) &&
    finiteNumber(timing.baseDurationMs) &&
    Array.isArray(timing.rawKana) &&
    timing.rawKana.every(validTime) &&
    Array.isArray(timing.effectiveKana) &&
    timing.effectiveKana.every(validTime) &&
    (timing.spanEndDeltaMs === undefined || finiteNumber(timing.spanEndDeltaMs)) &&
    Array.isArray(timing.internalGaps) &&
    timing.internalGaps.every(
      (gap) =>
        isRecord(gap) &&
        nonNegativeInteger(gap.afterKanaIndex) &&
        finiteNumber(gap.gapMs) &&
        gap.gapMs > 0
    );
  const validUnit = (unit: unknown): boolean =>
    isRecord(unit) &&
    isRecord(unit.source) &&
    nonNegativeInteger(unit.ordinal) &&
    typeof unit.groupId === "string" &&
    unit.groupId.length > 0 &&
    nonNegativeInteger(unit.groupSize) &&
    (unit.groupSize as number) > 0 &&
    ["sole", "groupHead", "groupMember"].includes(String(unit.groupRole)) &&
    nonNegativeInteger(unit.source.rowOrdinal) &&
    nonNegativeInteger(unit.source.tokenOrdinal) &&
    nonNegativeInteger(unit.source.utf16Start) &&
    nonNegativeInteger(unit.source.utf16End) &&
    (unit.source.utf16End as number) > (unit.source.utf16Start as number) &&
    nonNegativeInteger(unit.source.codePointCount) &&
    typeof unit.source.exactSourceSlice === "string" &&
    unit.source.exactSourceSlice.length ===
      (unit.source.utf16End as number) - (unit.source.utf16Start as number) &&
    [...unit.source.exactSourceSlice].length === unit.source.codePointCount &&
    (unit.groupSource === undefined ||
      (isRecord(unit.groupSource) &&
        nonNegativeInteger(unit.groupSource.rowOrdinal) &&
        nonNegativeInteger(unit.groupSource.tokenOrdinal) &&
        nonNegativeInteger(unit.groupSource.utf16Start) &&
        nonNegativeInteger(unit.groupSource.utf16End) &&
        (unit.groupSource.utf16End as number) >
          (unit.groupSource.utf16Start as number) &&
        nonNegativeInteger(unit.groupSource.readingUnitCount) &&
        unit.groupSource.readingUnitCount > 0 &&
        nonNegativeInteger(unit.groupSource.codePointCount) &&
        typeof unit.groupSource.exactSourceSlice === "string" &&
        unit.groupSource.exactSourceSlice.length ===
          (unit.groupSource.utf16End as number) -
            (unit.groupSource.utf16Start as number) &&
        [...unit.groupSource.exactSourceSlice].length === unit.groupSource.codePointCount)) &&
    ((unit.groupRole === "groupMember") === (unit.groupSource === undefined)) &&
    (unit.groupSource === undefined ||
      (unit.groupSource.rowOrdinal === unit.source.rowOrdinal &&
        unit.groupSource.tokenOrdinal === unit.source.tokenOrdinal &&
        unit.groupSource.readingUnitCount === unit.groupSize &&
        (unit.groupSource.utf16Start as number) <= unit.source.utf16Start &&
        (unit.groupSource.utf16End as number) >= unit.source.utf16End)) &&
    ["covered", "explicitEmpty"].includes(String(unit.coverage)) &&
    (unit.reading === undefined || typeof unit.reading === "string") &&
    validTiming(unit.timing) &&
    Array.isArray(unit.findings) &&
    unit.findings.every(readingFinding);
  return (
    transport.providerId === providerId &&
    (transport.providerId === "qq" || transport.providerId === "kugou") &&
    (transport.container === "qrc" || transport.container === "krc") &&
    transport.documentRole === "primary" &&
    transport.responseField === "lyric" &&
    typeof transport.rawLine === "string" &&
    typeof transport.rawLineSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(transport.rawLineSha256) &&
    sha256(transport.rawLine) === transport.rawLineSha256 &&
    nonNegativeInteger(transport.rawLineByteLength) &&
    Buffer.byteLength(transport.rawLine, "utf8") === transport.rawLineByteLength &&
    value.authorship.authorshipProvenance === "unknown" &&
    (value.authorship.declaredAuthor === undefined ||
      typeof value.authorship.declaredAuthor === "string") &&
    Array.isArray(value.derivation.redundantCopies) &&
    value.derivation.redundantCopies.every(
      (copy) =>
        isRecord(copy) &&
        copy.documentRole === "translation" &&
        typeof copy.identicalWithoutTimings === "boolean"
    ) &&
    Array.isArray(value.derivation.layersDerivedFromThis) &&
    value.derivation.layersDerivedFromThis.every(
      (derived) =>
        isRecord(derived) &&
        derived.documentRole === "romanization" &&
        derived.relationship === "inferredDerivation"
    ) &&
    ["ordinalUnitProven", "walkNotClosed", "layerRejected"].includes(
      String(validation.walkState)
    ) &&
    nonNegativeInteger(validation.declaredUnitCount) &&
    nonNegativeInteger(validation.resolvedUnitCount) &&
    Array.isArray(validation.findings) &&
    validation.findings.every(readingFinding) &&
    Array.isArray(value.units) &&
    value.units.every(validUnit)
  );
}

export function isProviderReadingEvidence(value: unknown): value is ProviderReadingEvidence {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !["qq", "kugou", "netease", "soda"].includes(String(value.providerId)) ||
    (value.layerProvenance !== undefined && !Array.isArray(value.layerProvenance)) ||
    (value.lineReadings !== undefined && !Array.isArray(value.lineReadings)) ||
    (value.kanaLayers !== undefined && !Array.isArray(value.kanaLayers)) ||
    (value.phoneticLanes !== undefined && !Array.isArray(value.phoneticLanes))
  )
    return false;
  const layerProvenance = (layer: unknown): boolean =>
    isRecord(layer) &&
    ["primary", "translation", "romanization"].includes(String(layer.role)) &&
    (layer.revision === undefined || typeof layer.revision === "string") &&
    Array.isArray(layer.contributors) &&
    layer.contributors.every(
      (contributor) =>
        isRecord(contributor) &&
        ["userId", "uin", "name"].includes(String(contributor.kind)) &&
        typeof contributor.exactValue === "string"
    ) &&
    Array.isArray(layer.sourceFlags) &&
    layer.sourceFlags.every(
      (flag) =>
        isRecord(flag) &&
        typeof flag.name === "string" &&
        ["string", "number", "boolean"].includes(typeof flag.exactValue)
    );
  const lineReading = (entry: unknown): boolean => {
    if (!isRecord(entry) || !Array.isArray(entry.rows)) return false;
    const row = (candidate: unknown): boolean =>
      isRecord(candidate) &&
      typeof candidate.exactValue === "string" &&
      (candidate.rowOrdinal === undefined || nonNegativeInteger(candidate.rowOrdinal)) &&
      (candidate.sourceRowOrdinal === undefined || nonNegativeInteger(candidate.sourceRowOrdinal)) &&
      (candidate.rawStartMs === undefined || finiteNumber(candidate.rawStartMs)) &&
      (candidate.effectiveStartMs === undefined || finiteNumber(candidate.effectiveStartMs)) &&
      ["rowOrdinalProven", "exactTimestamp", "unmatched", "ambiguous"].includes(
        String(candidate.alignment)
      ) &&
      (["rowOrdinalProven", "exactTimestamp"].includes(String(candidate.alignment))
        ? nonNegativeInteger(candidate.rowOrdinal)
        : candidate.rowOrdinal === undefined) &&
      ["usable", "explicitEmpty"].includes(String(candidate.validationStatus));
    return (
      typeof entry.evidenceId === "string" &&
      entry.providerId === value.providerId &&
      ["romanization", "transliteration"].includes(String(entry.evidenceKind)) &&
      entry.granularity === "line" &&
      entry.documentRole === "romanization" &&
      ["qrc", "krc", "lrc", "yrc"].includes(String(entry.container)) &&
      ["roma", "contentroma", "language.content[type=0]", "yromalrc", "romalrc"].includes(
        String(entry.responseField)
      ) &&
      (entry.rawProviderKind === undefined || nonNegativeInteger(entry.rawProviderKind)) &&
      (entry.rawLanguage === undefined || entry.rawLanguage === null || nonNegativeInteger(entry.rawLanguage)) &&
      ["unknown", "providerDeclaredHuman", "providerDeclaredGenerated"].includes(
        String(entry.authorshipProvenance)
      ) &&
      ["independent", "inferredKanaProjection", "unknown"].includes(String(entry.derivation)) &&
      entry.rows.length > 0 &&
      entry.rows.every(row)
    );
  };
  const phoneticLane = (lane: unknown): boolean =>
    isRecord(lane) &&
    typeof lane.evidenceId === "string" &&
    lane.evidenceKind === "phonetic" &&
    lane.providerId === value.providerId &&
    nonNegativeInteger(lane.rawNumericKind) &&
    (lane.rawLanguage === null || nonNegativeInteger(lane.rawLanguage)) &&
    ["Han", "Latin", "mixed", "empty", "unknown"].includes(String(lane.targetScript)) &&
    ["providerDeclaredGenerated", "unknown"].includes(String(lane.authorshipProvenance)) &&
    (lane.declaredProvenanceText === undefined ||
      typeof lane.declaredProvenanceText === "string") &&
    (lane.authorshipProvenance !== "providerDeclaredGenerated" ||
      lane.declaredProvenanceText === "以下谐音标注由AI工具生产") &&
    ["shapeProven", "layerRejected"].includes(String(lane.validationStatus)) &&
    Array.isArray(lane.validationFindings) &&
    lane.validationFindings.every((finding) =>
      ["invalidLanguage", "invalidRows", "invalidCells"].includes(String(finding))
    ) &&
    Array.isArray(lane.rows) &&
    lane.rows.every(
      (row) =>
        isRecord(row) &&
        nonNegativeInteger(row.rowOrdinal) &&
        Array.isArray(row.cells) &&
        row.cells.every((cell) => typeof cell === "string")
    );
  return (
    (value.layerProvenance ?? []).every(layerProvenance) &&
    (value.lineReadings ?? []).every(lineReading) &&
    (value.kanaLayers ?? []).every((layer) =>
      providerKanaLayer(layer, value.providerId as ProviderId)
    ) &&
    (value.phoneticLanes ?? []).every(phoneticLane) &&
    Boolean(
      value.layerProvenance?.length ||
        value.lineReadings?.length ||
        value.kanaLayers?.length ||
        value.phoneticLanes?.length
    )
  );
}
