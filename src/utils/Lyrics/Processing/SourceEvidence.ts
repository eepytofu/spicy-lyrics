export const SOURCE_EVIDENCE_SCHEMA_VERSION = 1;

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
    return [{
      id: `lead:${index}`,
      providerText: owner.providerText,
      ...(providerTranslation(lead) !== undefined
        ? { providerTranslation: providerTranslation(lead) }
        : {}),
      startTime: owner.startTime,
      endTime: owner.endTime,
      role: "lead" as const,
      timingOwners: [owner],
    }];
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
  const evidence = value as SourceLyricsEvidence | undefined;
  return evidence?.schemaVersion === SOURCE_EVIDENCE_SCHEMA_VERSION &&
    ["Static", "Line", "Syllable"].includes(evidence.lyricsType) &&
    Array.isArray(evidence.lines);
}

export function ensureSourceEvidence(lyrics: EvidenceLyrics): SourceLyricsEvidence | undefined {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type || "")) {
    return undefined;
  }
  if (isSourceLyricsEvidence(lyrics.SourceEvidence)) {
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
