export type ProviderReadingFinding =
  | "walkNotClosed"
  | "truncatedLine"
  | "extraEntries"
  | "zeroCount"
  | "oversizeCount"
  | "emptyReadingWithGroup"
  | "groupSpansToken"
  | "groupSpansRow"
  | "readingContainsNonKana"
  | "malformedTimingGroup"
  | "partialSubTiming"
  | "anchorMismatch"
  | "spanEndOutOfTolerance"
  | "nonMonotonicTiming"
  | "overlappingTiming"
  | "zeroDurationTiming"
  | "duplicateKanaLine"
  | "redundantLayerMismatch"
  | "unknownSourceUnit";

export type ProviderKanaLayer = {
  readonly transport: {
    readonly providerId: "qq" | "kugou";
    readonly container: "qrc" | "krc";
    readonly documentRole: "primary";
    readonly responseField: "lyric";
    readonly rawLine: string;
    readonly rawLineSha256: string;
    readonly rawLineByteLength: number;
  };
  readonly authorship: {
    readonly declaredAuthor?: string;
    readonly authorshipProvenance: "unknown";
  };
  readonly derivation: {
    readonly redundantCopies: readonly {
      readonly documentRole: "translation";
      readonly identicalWithoutTimings: boolean;
    }[];
    readonly layersDerivedFromThis: readonly {
      readonly documentRole: "romanization";
      readonly relationship: "inferredDerivation";
    }[];
  };
  readonly validation: {
    readonly walkState: "ordinalUnitProven" | "walkNotClosed" | "layerRejected";
    readonly declaredUnitCount: number;
    readonly resolvedUnitCount: number;
    readonly findings: readonly ProviderReadingFinding[];
  };
  readonly units: readonly {
    readonly ordinal: number;
    readonly groupId: string;
    readonly groupSize: number;
    readonly groupRole: "sole" | "groupHead" | "groupMember";
    readonly source: {
      readonly rowOrdinal: number;
      readonly tokenOrdinal: number;
      readonly utf16Start: number;
      readonly utf16End: number;
      readonly codePointCount: number;
      readonly exactSourceSlice: string;
    };
    readonly groupSource?: {
      readonly rowOrdinal: number;
      readonly tokenOrdinal: number;
      readonly utf16Start: number;
      readonly utf16End: number;
      readonly readingUnitCount: number;
      readonly codePointCount: number;
      readonly exactSourceSlice: string;
    };
    readonly coverage: "covered" | "explicitEmpty";
    readonly reading?: string;
    readonly timing: {
      readonly state: "timingProven" | "timingAbsent" | "timingRejected";
      readonly offsetMs: number;
      readonly rawBaseStartMs: number;
      readonly effectiveBaseStartMs: number;
      readonly baseDurationMs: number;
      readonly rawKana: readonly { readonly startMs: number; readonly durationMs: number }[];
      readonly effectiveKana: readonly { readonly startMs: number; readonly durationMs: number }[];
      readonly spanEndDeltaMs?: number;
      readonly internalGaps: readonly { readonly afterKanaIndex: number; readonly gapMs: number }[];
    };
    readonly findings: readonly ProviderReadingFinding[];
  }[];
};

export type ProviderReadingEvidence = {
  readonly schemaVersion: 1;
  readonly providerId: "qq" | "kugou" | "netease" | "soda";
  readonly layerProvenance?: readonly {
    readonly role: "primary" | "translation" | "romanization";
    readonly revision?: string;
    readonly contributors: readonly {
      readonly kind: "userId" | "uin" | "name";
      readonly exactValue: string;
    }[];
    readonly sourceFlags: readonly {
      readonly name: string;
      readonly exactValue: string | number | boolean;
    }[];
  }[];
  readonly lineReadings?: readonly {
    readonly evidenceId: string;
    readonly providerId: "qq" | "kugou" | "netease" | "soda";
    readonly evidenceKind: "romanization" | "transliteration";
    readonly granularity: "line";
    readonly documentRole: "romanization";
    readonly container: "qrc" | "krc" | "lrc" | "yrc";
    readonly responseField:
      | "roma"
      | "contentroma"
      | "language.content[type=0]"
      | "yromalrc"
      | "romalrc";
    readonly rawProviderKind?: number;
    readonly rawLanguage?: number | null;
    readonly authorshipProvenance:
      | "unknown"
      | "providerDeclaredHuman"
      | "providerDeclaredGenerated";
    readonly derivation: "independent" | "inferredKanaProjection" | "unknown";
    readonly rows: readonly {
      readonly exactValue: string;
      readonly rowOrdinal?: number;
      readonly sourceRowOrdinal?: number;
      readonly rawStartMs?: number;
      readonly effectiveStartMs?: number;
      readonly alignment: "rowOrdinalProven" | "exactTimestamp" | "unmatched" | "ambiguous";
      readonly validationStatus: "usable" | "explicitEmpty";
    }[];
  }[];
  readonly kanaLayers?: readonly ProviderKanaLayer[];
  readonly phoneticLanes?: readonly {
    readonly evidenceId: string;
    readonly providerId: "qq" | "kugou" | "netease" | "soda";
    readonly rawNumericKind: number;
    readonly rawLanguage: number | null;
    readonly evidenceKind: "phonetic";
    readonly targetScript: "Han" | "Latin" | "mixed" | "empty" | "unknown";
    readonly authorshipProvenance: "providerDeclaredGenerated" | "unknown";
    readonly declaredProvenanceText?: string;
    readonly validationStatus: "shapeProven" | "layerRejected";
    readonly validationFindings: readonly ("invalidLanguage" | "invalidRows" | "invalidCells")[];
    readonly rows: readonly {
      readonly rowOrdinal: number;
      readonly cells: readonly string[];
    }[];
  }[];
};

const Findings = new Set<ProviderReadingFinding>([
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
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validKanaLayer(
  value: unknown,
  providerId: ProviderReadingEvidence["providerId"]
): boolean {
  if (
    !record(value) ||
    !record(value.transport) ||
    !record(value.authorship) ||
    !record(value.derivation) ||
    !record(value.validation)
  )
    return false;
  const transport = value.transport;
  const validation = value.validation;
  const validTime = (time: unknown) =>
    record(time) && finite(time.startMs) && finite(time.durationMs) && time.durationMs >= 0;
  const validTiming = (timing: unknown) =>
    record(timing) &&
    ["timingProven", "timingAbsent", "timingRejected"].includes(String(timing.state)) &&
    finite(timing.offsetMs) &&
    finite(timing.rawBaseStartMs) &&
    finite(timing.effectiveBaseStartMs) &&
    finite(timing.baseDurationMs) &&
    Array.isArray(timing.rawKana) &&
    timing.rawKana.every(validTime) &&
    Array.isArray(timing.effectiveKana) &&
    timing.effectiveKana.every(validTime) &&
    (timing.spanEndDeltaMs === undefined || finite(timing.spanEndDeltaMs)) &&
    Array.isArray(timing.internalGaps) &&
    timing.internalGaps.every(
      (gap) =>
        record(gap) && nonNegativeInteger(gap.afterKanaIndex) && finite(gap.gapMs) && gap.gapMs > 0
    );
  const validUnit = (unit: unknown) =>
    record(unit) &&
    record(unit.source) &&
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
      (record(unit.groupSource) &&
        nonNegativeInteger(unit.groupSource.rowOrdinal) &&
        nonNegativeInteger(unit.groupSource.tokenOrdinal) &&
        nonNegativeInteger(unit.groupSource.utf16Start) &&
        nonNegativeInteger(unit.groupSource.utf16End) &&
        unit.groupSource.utf16End > unit.groupSource.utf16Start &&
        nonNegativeInteger(unit.groupSource.readingUnitCount) &&
        unit.groupSource.readingUnitCount > 0 &&
        nonNegativeInteger(unit.groupSource.codePointCount) &&
        typeof unit.groupSource.exactSourceSlice === "string" &&
        unit.groupSource.exactSourceSlice.length ===
          unit.groupSource.utf16End - unit.groupSource.utf16Start &&
        [...unit.groupSource.exactSourceSlice].length === unit.groupSource.codePointCount)) &&
    ((unit.groupRole === "groupMember") === (unit.groupSource === undefined)) &&
    (unit.groupSource === undefined ||
      (unit.groupSource.rowOrdinal === unit.source.rowOrdinal &&
        unit.groupSource.tokenOrdinal === unit.source.tokenOrdinal &&
        unit.groupSource.readingUnitCount === unit.groupSize &&
        unit.groupSource.utf16Start <= unit.source.utf16Start &&
        unit.groupSource.utf16End >= unit.source.utf16End)) &&
    ["covered", "explicitEmpty"].includes(String(unit.coverage)) &&
    (unit.reading === undefined || typeof unit.reading === "string") &&
    validTiming(unit.timing) &&
    Array.isArray(unit.findings) &&
    unit.findings.every((finding) => Findings.has(finding));
  return (
    transport.providerId === providerId &&
    ["qq", "kugou"].includes(String(transport.providerId)) &&
    ["qrc", "krc"].includes(String(transport.container)) &&
    transport.documentRole === "primary" &&
    transport.responseField === "lyric" &&
    typeof transport.rawLine === "string" &&
    typeof transport.rawLineSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(transport.rawLineSha256) &&
    nonNegativeInteger(transport.rawLineByteLength) &&
    new TextEncoder().encode(transport.rawLine).byteLength === transport.rawLineByteLength &&
    value.authorship.authorshipProvenance === "unknown" &&
    (value.authorship.declaredAuthor === undefined ||
      typeof value.authorship.declaredAuthor === "string") &&
    Array.isArray(value.derivation.redundantCopies) &&
    value.derivation.redundantCopies.every(
      (copy) =>
        record(copy) &&
        copy.documentRole === "translation" &&
        typeof copy.identicalWithoutTimings === "boolean"
    ) &&
    Array.isArray(value.derivation.layersDerivedFromThis) &&
    value.derivation.layersDerivedFromThis.every(
      (derived) =>
        record(derived) &&
        derived.documentRole === "romanization" &&
        derived.relationship === "inferredDerivation"
    ) &&
    ["ordinalUnitProven", "walkNotClosed", "layerRejected"].includes(
      String(validation.walkState)
    ) &&
    nonNegativeInteger(validation.declaredUnitCount) &&
    nonNegativeInteger(validation.resolvedUnitCount) &&
    Array.isArray(validation.findings) &&
    validation.findings.every((finding) => Findings.has(finding)) &&
    Array.isArray(value.units) &&
    value.units.every(validUnit)
  );
}

export function isProviderReadingEvidence(value: unknown): value is ProviderReadingEvidence {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !["qq", "kugou", "netease", "soda"].includes(String(value.providerId)) ||
    (value.layerProvenance !== undefined && !Array.isArray(value.layerProvenance)) ||
    (value.lineReadings !== undefined && !Array.isArray(value.lineReadings)) ||
    (value.kanaLayers !== undefined && !Array.isArray(value.kanaLayers)) ||
    (value.phoneticLanes !== undefined && !Array.isArray(value.phoneticLanes))
  )
    return false;
  return (
    (value.layerProvenance ?? []).every(
      (layer) =>
        record(layer) &&
        ["primary", "translation", "romanization"].includes(String(layer.role)) &&
        (layer.revision === undefined || typeof layer.revision === "string") &&
        Array.isArray(layer.contributors) &&
        layer.contributors.every(
          (contributor) =>
            record(contributor) &&
            ["userId", "uin", "name"].includes(String(contributor.kind)) &&
            typeof contributor.exactValue === "string"
        ) &&
        Array.isArray(layer.sourceFlags) &&
        layer.sourceFlags.every(
          (flag) =>
            record(flag) &&
            typeof flag.name === "string" &&
            ["string", "number", "boolean"].includes(typeof flag.exactValue)
        )
    ) &&
    (value.lineReadings ?? []).every(
      (entry) =>
        record(entry) &&
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
        (entry.rawLanguage === undefined || entry.rawLanguage === null
          || nonNegativeInteger(entry.rawLanguage)) &&
        ["unknown", "providerDeclaredHuman", "providerDeclaredGenerated"].includes(
          String(entry.authorshipProvenance)
        ) &&
        ["independent", "inferredKanaProjection", "unknown"].includes(String(entry.derivation)) &&
        Array.isArray(entry.rows) &&
        entry.rows.length > 0 &&
        entry.rows.every((row) =>
          record(row) &&
          typeof row.exactValue === "string" &&
          (row.rowOrdinal === undefined || nonNegativeInteger(row.rowOrdinal)) &&
          (row.sourceRowOrdinal === undefined || nonNegativeInteger(row.sourceRowOrdinal)) &&
          (row.rawStartMs === undefined || finite(row.rawStartMs)) &&
          (row.effectiveStartMs === undefined || finite(row.effectiveStartMs)) &&
          ["rowOrdinalProven", "exactTimestamp", "unmatched", "ambiguous"].includes(
            String(row.alignment)
          ) &&
          (["rowOrdinalProven", "exactTimestamp"].includes(String(row.alignment))
            ? nonNegativeInteger(row.rowOrdinal)
            : row.rowOrdinal === undefined) &&
          ["usable", "explicitEmpty"].includes(String(row.validationStatus))
        )
    ) &&
    (value.kanaLayers ?? []).every((layer) =>
      validKanaLayer(layer, value.providerId as ProviderReadingEvidence["providerId"])
    ) &&
    (value.phoneticLanes ?? []).every(
      (lane) =>
        record(lane) &&
        typeof lane.evidenceId === "string" &&
        lane.providerId === value.providerId &&
        nonNegativeInteger(lane.rawNumericKind) &&
        (lane.rawLanguage === null || nonNegativeInteger(lane.rawLanguage)) &&
        lane.evidenceKind === "phonetic" &&
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
            record(row) &&
            nonNegativeInteger(row.rowOrdinal) &&
            Array.isArray(row.cells) &&
            row.cells.every((cell) => typeof cell === "string")
        )
    ) &&
    Boolean(
      value.layerProvenance?.length ||
        value.lineReadings?.length ||
        value.kanaLayers?.length ||
        value.phoneticLanes?.length
    )
  );
}

function cloneAndFreeze(value: unknown): any {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (record(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry)]))
    );
  }
  return value;
}

export function cloneProviderReadingEvidence(value: unknown): ProviderReadingEvidence | undefined {
  return isProviderReadingEvidence(value) ? cloneAndFreeze(value) : undefined;
}

export function cloneProviderReadingEvidenceForProvider(
  value: unknown,
  providerId: string,
): ProviderReadingEvidence | undefined {
  const evidence = cloneProviderReadingEvidence(value);
  return evidence?.providerId === providerId ? evidence : undefined;
}
