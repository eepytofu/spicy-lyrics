import { isProviderInfoKind, providerInfoKind, type ProviderInfoKind } from "../ProviderInfo.ts";

export const SOURCE_EVIDENCE_SCHEMA_VERSION = 5;

export type SourceTimingOwner = {
  readonly id: string;
  readonly providerText: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly isPartOfWord?: boolean;
};

export type SourceEvidenceLine = {
  readonly id: string;
  readonly providerText: string;
  readonly providerTranslation?: string;
  readonly providerInfoKind?: ProviderInfoKind;
  readonly startTime: number;
  readonly endTime: number;
  readonly role: "lead" | "background";
  readonly timingOwners: readonly SourceTimingOwner[];
};

export type SourceLyricsEvidence = {
  readonly schemaVersion: typeof SOURCE_EVIDENCE_SCHEMA_VERSION;
  readonly lyricsType: "Static" | "Line" | "Syllable";
  readonly providerId?: string;
  readonly providerName?: string;
  readonly lines: readonly SourceEvidenceLine[];
};

type EvidenceLyrics = {
  Type?: string;
  source?: string;
  fetchProvider?: string;
  sourceDisplayName?: string;
  Lines?: any[];
  Content?: any[];
  SourceEvidence?: SourceLyricsEvidence;
};

const numberOrZero = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const providerTranslation = (entry: any): string | undefined => {
  const value = entry?.ProviderTranslatedText ?? entry?.TranslatedText;
  return typeof value === "string" ? value : undefined;
};

function textTimingOwner(
  id: string,
  entry: any,
  fallbackStart = 0,
  fallbackEnd = 0,
): SourceTimingOwner {
  return {
    id,
    providerText: String(entry?.Text ?? ""),
    startTime: numberOrZero(entry?.StartTime ?? fallbackStart),
    endTime: numberOrZero(entry?.EndTime ?? fallbackEnd),
    ...(typeof entry?.IsPartOfWord === "boolean"
      ? { isPartOfWord: entry.IsPartOfWord }
      : {}),
  };
}

function staticEvidence(lines: any[]): SourceEvidenceLine[] {
  return lines.map((line, index) => {
    const owner = textTimingOwner(`lead:${index}:span:0`, line);
    return {
      id: `lead:${index}`,
      providerText: owner.providerText,
      ...(providerTranslation(line) !== undefined
        ? { providerTranslation: providerTranslation(line) }
        : {}),
      ...(providerInfoKind(line) ? { providerInfoKind: providerInfoKind(line) } : {}),
      startTime: 0,
      endTime: 0,
      role: "lead",
      timingOwners: [owner],
    };
  });
}

function lineEvidence(lines: any[]): SourceEvidenceLine[] {
  return lines.flatMap((line, index) => {
    if (line?.Type === "Instrumental") return [];
    const lead = line?.Text !== undefined ? line : line?.Lead ?? line;
    const owner = textTimingOwner(
      `lead:${index}:span:0`,
      lead,
      line?.StartTime,
      line?.EndTime,
    );
    const evidence: SourceEvidenceLine[] = [{
      id: `lead:${index}`,
      providerText: owner.providerText,
      ...(providerTranslation(lead) !== undefined
        ? { providerTranslation: providerTranslation(lead) }
        : {}),
      ...(providerInfoKind(lead) ? { providerInfoKind: providerInfoKind(lead) } : {}),
      startTime: owner.startTime,
      endTime: owner.endTime,
      role: "lead" as const,
      timingOwners: [owner],
    }];
    for (const [backgroundIndex, background] of (line?.Background || []).entries()) {
      const backgroundOwner = textTimingOwner(
        `background:${index}:${backgroundIndex}:span:0`,
        background,
        background?.StartTime,
        background?.EndTime,
      );
      evidence.push({
        id: `background:${index}:${backgroundIndex}`,
        providerText: backgroundOwner.providerText,
        ...(providerTranslation(background) !== undefined
          ? { providerTranslation: providerTranslation(background) }
          : {}),
        ...(providerInfoKind(background)
          ? { providerInfoKind: providerInfoKind(background) }
          : {}),
        startTime: backgroundOwner.startTime,
        endTime: backgroundOwner.endTime,
        role: "background",
        timingOwners: [backgroundOwner],
      });
    }
    return evidence;
  });
}

function syllableGroupEvidence(
  id: string,
  group: any,
  role: SourceEvidenceLine["role"],
): SourceEvidenceLine {
  const syllables = Array.isArray(group?.Syllables) ? group.Syllables : [];
  const timingOwners = syllables.map((syllable: any, index: number) =>
    textTimingOwner(
      `${id}:span:${index}`,
      syllable,
      group?.StartTime,
      group?.EndTime,
    )
  );
  return {
    id,
    providerText: timingOwners.map((owner) => owner.providerText).join(""),
    ...(providerTranslation(group) !== undefined
      ? { providerTranslation: providerTranslation(group) }
      : {}),
    ...(providerInfoKind(group) ? { providerInfoKind: providerInfoKind(group) } : {}),
    startTime: numberOrZero(group?.StartTime),
    endTime: numberOrZero(group?.EndTime),
    role,
    timingOwners,
  };
}

function syllableEvidence(lines: any[]): SourceEvidenceLine[] {
  return lines.flatMap((line, index) => {
    if (line?.Type === "Instrumental") return [];
    const evidence: SourceEvidenceLine[] = [
      syllableGroupEvidence(`lead:${index}`, line?.Lead, "lead"),
    ];
    for (const [backgroundIndex, background] of (line?.Background || []).entries()) {
      evidence.push(syllableGroupEvidence(
        `background:${index}:${backgroundIndex}`,
        background,
        "background",
      ));
    }
    return evidence;
  });
}

function deepFreezeEvidence(evidence: SourceLyricsEvidence): SourceLyricsEvidence {
  for (const line of evidence.lines) {
    for (const owner of line.timingOwners) Object.freeze(owner);
    Object.freeze(line.timingOwners);
    Object.freeze(line);
  }
  Object.freeze(evidence.lines);
  return Object.freeze(evidence);
}

function isSourceLyricsEvidence(value: unknown): value is SourceLyricsEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const optionalString = (entry: unknown) => entry === undefined || typeof entry === "string";
  const finiteNumber = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry);
  const timingOwner = (entry: unknown): entry is SourceTimingOwner => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const owner = entry as Record<string, unknown>;
    return typeof owner.id === "string" && owner.id.length > 0
      && typeof owner.providerText === "string"
      && finiteNumber(owner.startTime)
      && finiteNumber(owner.endTime)
      && (owner.isPartOfWord === undefined || typeof owner.isPartOfWord === "boolean");
  };
  const line = (entry: unknown): entry is SourceEvidenceLine => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.id === "string" && candidate.id.length > 0
      && typeof candidate.providerText === "string"
      && optionalString(candidate.providerTranslation)
      && (candidate.providerInfoKind === undefined || isProviderInfoKind(candidate.providerInfoKind))
      && finiteNumber(candidate.startTime)
      && finiteNumber(candidate.endTime)
      && (candidate.role === "lead" || candidate.role === "background")
      && Array.isArray(candidate.timingOwners)
      && candidate.timingOwners.every(timingOwner);
  };
  return evidence.schemaVersion === SOURCE_EVIDENCE_SCHEMA_VERSION
    && ["Static", "Line", "Syllable"].includes(String(evidence.lyricsType))
    && optionalString(evidence.providerId)
    && optionalString(evidence.providerName)
    && Array.isArray(evidence.lines)
    && evidence.lines.every(line);
}

export function ensureSourceEvidence(lyrics: EvidenceLyrics): SourceLyricsEvidence | undefined {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type || "")) {
    return undefined;
  }
  if (isSourceLyricsEvidence(lyrics.SourceEvidence) && lyrics.SourceEvidence.lyricsType === lyrics.Type) {
    return deepFreezeEvidence(lyrics.SourceEvidence);
  }

  const lyricsType = lyrics.Type as SourceLyricsEvidence["lyricsType"];
  const lines = lyricsType === "Static"
    ? staticEvidence(lyrics.Lines || [])
    : lyricsType === "Line"
      ? lineEvidence(lyrics.Content || [])
      : syllableEvidence(lyrics.Content || []);
  const evidence: SourceLyricsEvidence = {
    schemaVersion: SOURCE_EVIDENCE_SCHEMA_VERSION,
    lyricsType,
    ...(lyrics.fetchProvider || lyrics.source
      ? { providerId: String(lyrics.fetchProvider || lyrics.source) }
      : {}),
    ...(lyrics.sourceDisplayName
      ? { providerName: String(lyrics.sourceDisplayName) }
      : {}),
    lines,
  };
  lyrics.SourceEvidence = deepFreezeEvidence(evidence);
  return lyrics.SourceEvidence;
}

export function sourceEvidenceLine(
  lyrics: EvidenceLyrics,
  id: string,
): SourceEvidenceLine | undefined {
  return ensureSourceEvidence(lyrics)?.lines.find((line) => line.id === id);
}
