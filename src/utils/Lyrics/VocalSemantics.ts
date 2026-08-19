export type VocalCueForm = "labelColon" | "bracketedLabel";
export type VocalCue = {
  Label: string;
  Form: VocalCueForm;
};

export type VocalAgent = {
  Type?: string;
  Names: string[];
};

export type VocalAgents = Record<string, VocalAgent>;

export function isVocalCue(value: unknown): value is VocalCue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cue = value as Record<string, unknown>;
  return typeof cue.Label === "string"
    && cue.Label.length > 0
    && (cue.Form === "labelColon" || cue.Form === "bracketedLabel");
}

export function vocalCue(entry: any): VocalCue | undefined {
  return isVocalCue(entry?.VocalCue) ? entry.VocalCue : undefined;
}

export function vocalAgentId(entry: any): string | undefined {
  return typeof entry?.VocalAgentId === "string" && entry.VocalAgentId.length > 0
    ? entry.VocalAgentId
    : undefined;
}

export function isVocalCueEntry(entry: any): boolean {
  return vocalCue(entry) !== undefined;
}
