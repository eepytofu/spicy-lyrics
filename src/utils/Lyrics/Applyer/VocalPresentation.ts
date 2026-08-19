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
};

export type VocalAgentPresentation = {
  agentId?: string;
  label?: string;
  type?: string;
};

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
): void {
  const cue = vocalCue(entry);
  if (cue) {
    lineElement.classList.add("VocalCue");
    lineElement.dataset.vocalCueForm = cue.Form;
    state.previousNamedAgentId = undefined;
    return;
  }

  const presentation = resolveVocalAgentPresentation(
    data,
    entry,
    state.previousNamedAgentId,
  );
  state.previousNamedAgentId = presentation.agentId;
  if (!presentation.label) return;

  const label = document.createElement("span");
  label.classList.add("VocalAgentLabel");
  if (presentation.type) label.dataset.vocalAgentType = presentation.type;
  label.textContent = presentation.label;
  lineElement.appendChild(label);
}
