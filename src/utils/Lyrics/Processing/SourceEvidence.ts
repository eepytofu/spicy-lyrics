import { isProviderInfoKind, providerInfoKind, type ProviderInfoKind } from "../ProviderInfo.ts";
import type { ProviderRubyTag } from "../ProviderRuby.ts";
import {
  cloneProviderSidecars,
  isProviderSidecars,
  type ProviderSidecar,
} from "../TtmlSemantics.ts";
import {
  isVocalCue,
  vocalAgentId,
  vocalCue,
  type VocalAgents,
  type VocalCue,
} from "../VocalSemantics.ts";

export const SOURCE_EVIDENCE_SCHEMA_VERSION = 7;

export type SourceTimingOwner = {
  readonly id: string;
  readonly providerText: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly isPartOfWord?: boolean;
  readonly providerRuby?: readonly ProviderRubyTag[];
};

export type SourceEvidenceLine = {
  readonly id: string;
  readonly providerText: string;
  readonly providerTranslation?: string;
  readonly providerTranslations?: readonly ProviderSidecar[];
  readonly providerRomanizations?: readonly ProviderSidecar[];
  readonly providerLineId?: string;
  readonly songPart?: string;
  readonly songPartBlockIndex?: number;
  readonly providerInfoKind?: ProviderInfoKind;
  readonly vocalCue?: VocalCue;
  readonly vocalAgentId?: string;
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
  readonly providerLanguage?: string;
  readonly vocalAgents?: Readonly<VocalAgents>;
  readonly lines: readonly SourceEvidenceLine[];
};

type EvidenceLyrics = {
  Type?: string;
  source?: string;
  fetchProvider?: string;
  sourceDisplayName?: string;
  Lines?: any[];
  Content?: any[];
  VocalAgents?: VocalAgents;
  ProviderLanguage?: string;
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

const sidecars = (
  entry: any,
  field: "ProviderTranslations" | "ProviderRomanizations",
): ProviderSidecar[] | undefined => cloneProviderSidecars(entry?.[field]);

const lineSemantics = (entry: any): Pick<
  SourceEvidenceLine,
  "providerLineId" | "songPart" | "songPartBlockIndex"
> => ({
  ...(typeof entry?.ProviderLineId === "string"
    ? { providerLineId: entry.ProviderLineId }
    : {}),
  ...(typeof entry?.SongPart === "string" ? { songPart: entry.SongPart } : {}),
  ...(typeof entry?.SongPartBlockIndex === "number" && Number.isFinite(entry.SongPartBlockIndex)
    ? { songPartBlockIndex: entry.SongPartBlockIndex }
    : {}),
});

const sidecarSemantics = (entry: any): Pick<
  SourceEvidenceLine,
  "providerTranslations" | "providerRomanizations"
> => {
  const providerTranslations = sidecars(entry, "ProviderTranslations");
  const providerRomanizations = sidecars(entry, "ProviderRomanizations");
  return {
    ...(providerTranslations ? { providerTranslations } : {}),
    ...(providerRomanizations ? { providerRomanizations } : {}),
  };
};

function providerRuby(entry: any): ProviderRubyTag[] | undefined {
  if (!Array.isArray(entry?.ProviderRuby)) return undefined;
  return entry.ProviderRuby.flatMap((tag: any) =>
    typeof tag?.Text === "string"
      && typeof tag?.StartTime === "number"
      && Number.isFinite(tag.StartTime)
      && typeof tag?.EndTime === "number"
      && Number.isFinite(tag.EndTime)
      ? [{ Text: tag.Text, StartTime: tag.StartTime, EndTime: tag.EndTime }]
      : []
  );
}

function textTimingOwner(
  id: string,
  entry: any,
  fallbackStart = 0,
  fallbackEnd = 0,
): SourceTimingOwner {
  const ruby = providerRuby(entry);
  return {
    id,
    providerText: String(entry?.Text ?? ""),
    startTime: numberOrZero(entry?.StartTime ?? fallbackStart),
    endTime: numberOrZero(entry?.EndTime ?? fallbackEnd),
    ...(typeof entry?.IsPartOfWord === "boolean"
      ? { isPartOfWord: entry.IsPartOfWord }
      : {}),
    ...(ruby ? { providerRuby: ruby } : {}),
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
      ...sidecarSemantics(line),
      ...lineSemantics(line),
      ...(providerInfoKind(line) ? { providerInfoKind: providerInfoKind(line) } : {}),
      ...(vocalCue(line) ? { vocalCue: vocalCue(line) } : {}),
      ...(vocalAgentId(line) ? { vocalAgentId: vocalAgentId(line) } : {}),
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
      ...sidecarSemantics(lead),
      ...lineSemantics(line),
      ...(providerInfoKind(lead) ? { providerInfoKind: providerInfoKind(lead) } : {}),
      ...(vocalCue(lead) ? { vocalCue: vocalCue(lead) } : {}),
      ...(vocalAgentId(line) || vocalAgentId(lead)
        ? { vocalAgentId: vocalAgentId(line) ?? vocalAgentId(lead) }
        : {}),
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
        ...sidecarSemantics(background),
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
  agentId?: string,
  line?: any,
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
    ...sidecarSemantics(group),
    ...(role === "lead" ? lineSemantics(line ?? group) : {}),
    ...(providerInfoKind(group) ? { providerInfoKind: providerInfoKind(group) } : {}),
    ...(vocalCue(group) ? { vocalCue: vocalCue(group) } : {}),
    ...(agentId || vocalAgentId(group)
      ? { vocalAgentId: agentId ?? vocalAgentId(group) }
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
      syllableGroupEvidence(`lead:${index}`, line?.Lead, "lead", vocalAgentId(line), line),
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

function cloneVocalAgents(value: unknown): VocalAgents | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: VocalAgents = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const agent = raw as Record<string, unknown>;
    if (!Array.isArray(agent.Names) || !agent.Names.every((name) => typeof name === "string")) continue;
    output[id] = {
      ...(typeof agent.Type === "string" ? { Type: agent.Type } : {}),
      Names: [...agent.Names],
    };
  }
  return Object.keys(output).length ? output : undefined;
}

function deepFreezeEvidence(evidence: SourceLyricsEvidence): SourceLyricsEvidence {
  for (const line of evidence.lines) {
    for (const sidecar of [
      ...(line.providerTranslations || []),
      ...(line.providerRomanizations || []),
    ]) {
      for (const word of sidecar.Words || []) Object.freeze(word);
      if (sidecar.Words) Object.freeze(sidecar.Words);
      Object.freeze(sidecar);
    }
    if (line.providerTranslations) Object.freeze(line.providerTranslations);
    if (line.providerRomanizations) Object.freeze(line.providerRomanizations);
    for (const owner of line.timingOwners) {
      for (const tag of owner.providerRuby || []) Object.freeze(tag);
      if (owner.providerRuby) Object.freeze(owner.providerRuby);
      Object.freeze(owner);
    }
    if (line.vocalCue) Object.freeze(line.vocalCue);
    Object.freeze(line.timingOwners);
    Object.freeze(line);
  }
  if (evidence.vocalAgents) {
    for (const agent of Object.values(evidence.vocalAgents)) {
      Object.freeze(agent.Names);
      Object.freeze(agent);
    }
    Object.freeze(evidence.vocalAgents);
  }
  Object.freeze(evidence.lines);
  return Object.freeze(evidence);
}

function isSourceLyricsEvidence(value: unknown): value is SourceLyricsEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const optionalString = (entry: unknown) => entry === undefined || typeof entry === "string";
  const finiteNumber = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry);
  const vocalAgents = (entry: unknown): boolean => {
    if (entry === undefined) return true;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return Object.entries(entry).every(([id, raw]) => {
      if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const agent = raw as Record<string, unknown>;
      return (agent.Type === undefined || typeof agent.Type === "string")
        && Array.isArray(agent.Names)
        && agent.Names.every((name) => typeof name === "string");
    });
  };
  const timingOwner = (entry: unknown): entry is SourceTimingOwner => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const owner = entry as Record<string, unknown>;
    const rubyTag = (tag: unknown): tag is ProviderRubyTag => {
      if (typeof tag !== "object" || tag === null || Array.isArray(tag)) return false;
      const ruby = tag as Record<string, unknown>;
      return typeof ruby.Text === "string"
        && finiteNumber(ruby.StartTime)
        && finiteNumber(ruby.EndTime);
    };
    return typeof owner.id === "string" && owner.id.length > 0
      && typeof owner.providerText === "string"
      && finiteNumber(owner.startTime)
      && finiteNumber(owner.endTime)
      && (owner.isPartOfWord === undefined || typeof owner.isPartOfWord === "boolean")
      && (owner.providerRuby === undefined
        || (Array.isArray(owner.providerRuby) && owner.providerRuby.every(rubyTag)));
  };
  const line = (entry: unknown): entry is SourceEvidenceLine => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.id === "string" && candidate.id.length > 0
      && typeof candidate.providerText === "string"
      && optionalString(candidate.providerTranslation)
      && (candidate.providerTranslations === undefined
        || isProviderSidecars(candidate.providerTranslations))
      && (candidate.providerRomanizations === undefined
        || isProviderSidecars(candidate.providerRomanizations))
      && optionalString(candidate.providerLineId)
      && optionalString(candidate.songPart)
      && (candidate.songPartBlockIndex === undefined
        || finiteNumber(candidate.songPartBlockIndex))
      && (candidate.providerInfoKind === undefined || isProviderInfoKind(candidate.providerInfoKind))
      && (candidate.vocalCue === undefined || isVocalCue(candidate.vocalCue))
      && !(candidate.providerInfoKind !== undefined && candidate.vocalCue !== undefined)
      && optionalString(candidate.vocalAgentId)
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
    && optionalString(evidence.providerLanguage)
    && vocalAgents(evidence.vocalAgents)
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
  const vocalAgents = cloneVocalAgents(lyrics.VocalAgents);
  const evidence: SourceLyricsEvidence = {
    schemaVersion: SOURCE_EVIDENCE_SCHEMA_VERSION,
    lyricsType,
    ...(lyrics.fetchProvider || lyrics.source
      ? { providerId: String(lyrics.fetchProvider || lyrics.source) }
      : {}),
    ...(lyrics.sourceDisplayName
      ? { providerName: String(lyrics.sourceDisplayName) }
      : {}),
    ...(typeof lyrics.ProviderLanguage === "string"
      ? { providerLanguage: lyrics.ProviderLanguage }
      : {}),
    ...(vocalAgents ? { vocalAgents } : {}),
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
