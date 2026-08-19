import {
  ensureSourceEvidence,
  type SourceEvidenceLine,
  type SourceLyricsEvidence,
} from "./SourceEvidence.ts";
import type { ProviderInfoKind } from "../ProviderInfo.ts";
import type { ProviderRubyTag } from "../ProviderRuby.ts";
import type { ProviderSidecar } from "../TtmlSemantics.ts";
import type { VocalAgents, VocalCue } from "../VocalSemantics.ts";

export const SOURCE_LYRIC_DOCUMENT_SCHEMA_VERSION = 7;

export type SourceDocumentTimingOwner = {
  readonly id: string;
  readonly exactText: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly providerBoundaryAfter?: boolean;
  readonly providerRuby?: readonly ProviderRubyTag[];
};

export type SourceDocumentLine = {
  readonly id: string;
  readonly exactText: string;
  readonly providerTranslation?: string;
  readonly providerTranslations?: readonly ProviderSidecar[];
  readonly providerRomanizations?: readonly ProviderSidecar[];
  readonly providerLineId?: string;
  readonly songPart?: string;
  readonly songPartBlockIndex?: number;
  readonly providerInfoKind?: ProviderInfoKind;
  readonly vocalCue?: VocalCue;
  readonly vocalAgentId?: string;
  readonly role: "lead" | "background";
  readonly startMs: number;
  readonly endMs: number;
  readonly timingOwners: readonly SourceDocumentTimingOwner[];
};

export type SourceLyricDocument = {
  readonly schemaVersion: typeof SOURCE_LYRIC_DOCUMENT_SCHEMA_VERSION;
  readonly normalizedShape: "Static" | "Line" | "Syllable";
  readonly provider?: {
    readonly id?: string;
    readonly name?: string;
  };
  readonly providerLanguage?: string;
  readonly vocalAgents?: Readonly<VocalAgents>;
  readonly lines: readonly SourceDocumentLine[];
  readonly provenance: "sourceEvidenceAdapter";
};

export type SourceDocumentParity = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

const runtimeDocuments = new WeakMap<object, SourceLyricDocument>();

function frozenSidecars(sidecars: readonly ProviderSidecar[] | undefined): readonly ProviderSidecar[] | undefined {
  if (!sidecars) return undefined;
  return Object.freeze(sidecars.map((sidecar) => {
    const Words = sidecar.Words
      ? Object.freeze(sidecar.Words.map((word) => Object.freeze({ ...word })))
      : undefined;
    return Object.freeze({
      Text: sidecar.Text,
      ...(sidecar.Language ? { Language: sidecar.Language } : {}),
      ...(Words ? { Words } : {}),
    });
  }));
}

function documentLine(line: SourceEvidenceLine): SourceDocumentLine {
  const providerTranslations = frozenSidecars(line.providerTranslations);
  const providerRomanizations = frozenSidecars(line.providerRomanizations);
  return {
    id: line.id,
    exactText: line.providerText,
    ...(line.providerTranslation !== undefined
      ? { providerTranslation: line.providerTranslation }
      : {}),
    ...(providerTranslations ? { providerTranslations } : {}),
    ...(providerRomanizations ? { providerRomanizations } : {}),
    ...(line.providerLineId ? { providerLineId: line.providerLineId } : {}),
    ...(line.songPart ? { songPart: line.songPart } : {}),
    ...(line.songPartBlockIndex !== undefined
      ? { songPartBlockIndex: line.songPartBlockIndex }
      : {}),
    ...(line.providerInfoKind ? { providerInfoKind: line.providerInfoKind } : {}),
    ...(line.vocalCue ? { vocalCue: { ...line.vocalCue } } : {}),
    ...(line.vocalAgentId ? { vocalAgentId: line.vocalAgentId } : {}),
    role: line.role,
    startMs: line.startTime,
    endMs: line.endTime,
    timingOwners: line.timingOwners.map((owner) => {
      const providerRuby = owner.providerRuby?.map((tag) => Object.freeze({ ...tag }));
      if (providerRuby) Object.freeze(providerRuby);
      return Object.freeze({
        id: owner.id,
        exactText: owner.providerText,
        startMs: owner.startTime,
        endMs: owner.endTime,
        ...(owner.isPartOfWord !== undefined ? { providerBoundaryAfter: !owner.isPartOfWord } : {}),
        ...(providerRuby ? { providerRuby } : {}),
      });
    }),
  };
}

export function sourceLyricDocumentFromEvidence(
  evidence: SourceLyricsEvidence
): SourceLyricDocument {
  const lines = evidence.lines.map((line) => {
    const adapted = documentLine(line);
    if (adapted.vocalCue) Object.freeze(adapted.vocalCue);
    Object.freeze(adapted.timingOwners);
    return Object.freeze(adapted);
  });
  Object.freeze(lines);

  const provider =
    evidence.providerId || evidence.providerName
      ? Object.freeze({
          ...(evidence.providerId ? { id: evidence.providerId } : {}),
          ...(evidence.providerName ? { name: evidence.providerName } : {}),
        })
      : undefined;

  const vocalAgents = evidence.vocalAgents
    ? Object.freeze(Object.fromEntries(Object.entries(evidence.vocalAgents).map(([id, agent]) => {
        const Names = Object.freeze([...agent.Names]);
        return [id, Object.freeze({ ...(agent.Type ? { Type: agent.Type } : {}), Names })];
      }))) as Readonly<VocalAgents>
    : undefined;

  return Object.freeze({
    schemaVersion: SOURCE_LYRIC_DOCUMENT_SCHEMA_VERSION,
    normalizedShape: evidence.lyricsType,
    ...(provider ? { provider } : {}),
    ...(evidence.providerLanguage ? { providerLanguage: evidence.providerLanguage } : {}),
    ...(vocalAgents ? { vocalAgents } : {}),
    lines,
    provenance: "sourceEvidenceAdapter",
  });
}

export function compareSourceDocumentToEvidence(
  document: SourceLyricDocument,
  evidence: SourceLyricsEvidence
): SourceDocumentParity {
  const errors: string[] = [];
  if (document.normalizedShape !== evidence.lyricsType) {
    errors.push(`shape:${document.normalizedShape}!=${evidence.lyricsType}`);
  }
  if (document.provider?.id !== evidence.providerId) {
    errors.push(`provider:id:${document.provider?.id ?? ""}!=${evidence.providerId ?? ""}`);
  }
  if (document.provider?.name !== evidence.providerName) {
    errors.push(`provider:name:${document.provider?.name ?? ""}!=${evidence.providerName ?? ""}`);
  }
  if (document.providerLanguage !== evidence.providerLanguage) {
    errors.push(`provider:language:${document.providerLanguage ?? ""}!=${evidence.providerLanguage ?? ""}`);
  }
  if (JSON.stringify(document.vocalAgents) !== JSON.stringify(evidence.vocalAgents)) {
    errors.push("vocal-agents");
  }
  if (document.lines.length !== evidence.lines.length) {
    errors.push(`lines:length:${document.lines.length}!=${evidence.lines.length}`);
  }

  const lineCount = Math.min(document.lines.length, evidence.lines.length);
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const actual = document.lines[lineIndex];
    const expected = evidence.lines[lineIndex];
    const prefix = `line:${lineIndex}`;
    if (actual.id !== expected.id) errors.push(`${prefix}:id`);
    if (actual.exactText !== expected.providerText) errors.push(`${prefix}:text`);
    if (actual.providerTranslation !== expected.providerTranslation) {
      errors.push(`${prefix}:translation`);
    }
    if (JSON.stringify(actual.providerTranslations) !== JSON.stringify(expected.providerTranslations)) {
      errors.push(`${prefix}:translations`);
    }
    if (JSON.stringify(actual.providerRomanizations) !== JSON.stringify(expected.providerRomanizations)) {
      errors.push(`${prefix}:romanizations`);
    }
    if (actual.providerLineId !== expected.providerLineId) {
      errors.push(`${prefix}:provider-line-id`);
    }
    if (actual.songPart !== expected.songPart) errors.push(`${prefix}:song-part`);
    if (actual.songPartBlockIndex !== expected.songPartBlockIndex) {
      errors.push(`${prefix}:song-part-block-index`);
    }
    if (actual.providerInfoKind !== expected.providerInfoKind) {
      errors.push(`${prefix}:provider-info-kind`);
    }
    if (JSON.stringify(actual.vocalCue) !== JSON.stringify(expected.vocalCue)) {
      errors.push(`${prefix}:vocal-cue`);
    }
    if (actual.vocalAgentId !== expected.vocalAgentId) {
      errors.push(`${prefix}:vocal-agent-id`);
    }
    if (actual.role !== expected.role) errors.push(`${prefix}:role`);
    if (actual.startMs !== expected.startTime) errors.push(`${prefix}:start`);
    if (actual.endMs !== expected.endTime) errors.push(`${prefix}:end`);
    if (actual.timingOwners.length !== expected.timingOwners.length) {
      errors.push(`${prefix}:owners:length`);
    }

    const ownerCount = Math.min(actual.timingOwners.length, expected.timingOwners.length);
    for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
      const actualOwner = actual.timingOwners[ownerIndex];
      const expectedOwner = expected.timingOwners[ownerIndex];
      const ownerPrefix = `${prefix}:owner:${ownerIndex}`;
      if (actualOwner.id !== expectedOwner.id) errors.push(`${ownerPrefix}:id`);
      if (actualOwner.exactText !== expectedOwner.providerText) {
        errors.push(`${ownerPrefix}:text`);
      }
      if (actualOwner.startMs !== expectedOwner.startTime) {
        errors.push(`${ownerPrefix}:start`);
      }
      if (actualOwner.endMs !== expectedOwner.endTime) {
        errors.push(`${ownerPrefix}:end`);
      }
      const expectedBoundary =
        expectedOwner.isPartOfWord === undefined ? undefined : !expectedOwner.isPartOfWord;
      if (actualOwner.providerBoundaryAfter !== expectedBoundary) {
        errors.push(`${ownerPrefix}:boundary`);
      }
      if (JSON.stringify(actualOwner.providerRuby) !== JSON.stringify(expectedOwner.providerRuby)) {
        errors.push(`${ownerPrefix}:provider-ruby`);
      }
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export function ensureSourceLyricDocument(lyrics: object): {
  document?: SourceLyricDocument;
  parity: SourceDocumentParity;
} {
  const evidence = ensureSourceEvidence(lyrics);
  if (!evidence) {
    return {
      parity: Object.freeze({
        valid: false,
        errors: Object.freeze(["missing-source-evidence"]),
      }),
    };
  }

  let document = runtimeDocuments.get(lyrics);
  if (!document) {
    document = sourceLyricDocumentFromEvidence(evidence);
    runtimeDocuments.set(lyrics, document);
  }
  return {
    document,
    parity: compareSourceDocumentToEvidence(document, evidence),
  };
}
