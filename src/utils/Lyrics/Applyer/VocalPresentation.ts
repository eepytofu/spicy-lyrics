import {
  vocalAgentId,
  vocalCue,
  type VocalAgents,
} from "../VocalSemantics.ts";

type VocalDocument = {
  VocalAgents?: VocalAgents;
};

export type VocalPresentationState = {
  previousNamedAgentId?: string;
  previousSongPartKey?: string;
};

export type VocalPresentationOptions = {
  showSongSections?: boolean;
  showVocalistLabels?: boolean;
};

export type VocalAgentPresentation = {
  agentId?: string;
  label?: string;
  type?: string;
};

export type TtmlLinePresentation = {
  ProviderLineId?: string;
  SongPart?: string;
  SongPartBlockIndex?: number;
  key?: string;
  label?: string;
};

export function resolveTtmlLinePresentation(
  entry: unknown,
  previousSongPartKey?: string,
): TtmlLinePresentation {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  const line = entry as Record<string, unknown>;
  const presentation: TtmlLinePresentation = {
    ...(typeof line.ProviderLineId === "string" ? { ProviderLineId: line.ProviderLineId } : {}),
    ...(typeof line.SongPart === "string" && line.SongPart.trim()
      ? { SongPart: line.SongPart }
      : {}),
    ...(typeof line.SongPartBlockIndex === "number" && Number.isFinite(line.SongPartBlockIndex)
      ? { SongPartBlockIndex: line.SongPartBlockIndex }
      : {}),
  };
  if (!presentation.SongPart) return presentation;
  const key = presentation.SongPartBlockIndex === undefined
    ? presentation.SongPart
    : `${presentation.SongPartBlockIndex}\u0000${presentation.SongPart}`;
  return {
    ...presentation,
    key,
    ...(key !== previousSongPartKey ? { label: presentation.SongPart } : {}),
  };
}

function applyTtmlLinePresentation(
  lineElement: HTMLElement,
  entry: unknown,
  state: VocalPresentationState,
  showSongSections: boolean,
): void {
  const presentation = resolveTtmlLinePresentation(entry, state.previousSongPartKey);
  if (presentation.ProviderLineId) {
    lineElement.dataset.ttmlLineId = presentation.ProviderLineId;
  }
  if (!presentation.SongPart) {
    state.previousSongPartKey = undefined;
    return;
  }

  lineElement.dataset.ttmlSongPart = presentation.SongPart;
  if (presentation.SongPartBlockIndex !== undefined) {
    lineElement.dataset.ttmlSongPartBlock = String(presentation.SongPartBlockIndex);
  }
  if (showSongSections && presentation.label) {
    const label = document.createElement("span");
    label.classList.add("TtmlSongPartLabel");
    label.textContent = presentation.label;
    lineElement.appendChild(label);
  }
  state.previousSongPartKey = presentation.key;
}

export function resolveVocalAgentPresentation(
  data: VocalDocument,
  entry: unknown,
  previousNamedAgentId?: string,
): VocalAgentPresentation {
  const agentId = vocalAgentId(entry);
  const agent = agentId ? data.VocalAgents?.[agentId] : undefined;
  const names = agent?.Names.filter((name) => name.length > 0) ?? [];
  if (!agentId || names.length === 0) return {};
  return {
    agentId,
    ...(agentId !== previousNamedAgentId ? { label: names.join(" / ") } : {}),
    ...(agent?.Type ? { type: agent.Type } : {}),
  };
}

/** Adds semantic presentation without rewriting or removing source lyric text. */
export function applyVocalPresentation(
  lineElement: HTMLElement,
  data: VocalDocument,
  entry: unknown,
  state: VocalPresentationState,
  options: VocalPresentationOptions = {},
): void {
  const showSongSections = options.showSongSections !== false;
  const showVocalistLabels = options.showVocalistLabels !== false;
  applyTtmlLinePresentation(lineElement, entry, state, showSongSections);
  const cue = vocalCue(entry);
  if (cue) {
    lineElement.classList.add("VocalCue");
    lineElement.dataset.vocalCueForm = cue.Form;
    state.previousNamedAgentId = undefined;
    state.previousSongPartKey = undefined;
    return;
  }

  const presentation = resolveVocalAgentPresentation(
    data,
    entry,
    state.previousNamedAgentId,
  );
  state.previousNamedAgentId = presentation.agentId;
  if (presentation.agentId) lineElement.dataset.vocalAgentId = presentation.agentId;
  if (presentation.type) lineElement.dataset.vocalAgentType = presentation.type;
  if (!showVocalistLabels || !presentation.label) return;

  const label = document.createElement("span");
  label.classList.add("VocalAgentLabel");
  if (presentation.type) label.dataset.vocalAgentType = presentation.type;
  label.textContent = presentation.label;
  lineElement.appendChild(label);
}
