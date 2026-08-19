export type ProviderSidecarWord = {
  readonly Text: string;
  readonly StartTime: number;
  readonly EndTime: number;
  readonly IsPartOfWord: boolean;
};

export type ProviderSidecar = {
  readonly Text: string;
  readonly Language?: string;
  readonly Words?: readonly ProviderSidecarWord[];
};

export type ProviderLineSemantics = {
  ProviderLineId?: string;
  SongPart?: string;
  SongPartBlockIndex?: number;
  ProviderTranslations?: ProviderSidecar[];
  ProviderRomanizations?: ProviderSidecar[];
};

export function cloneProviderSidecars(value: unknown): ProviderSidecar[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sidecars = value.flatMap((raw): ProviderSidecar[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.Text !== "string") return [];
    const words = Array.isArray(entry.Words)
      ? entry.Words.flatMap((rawWord): ProviderSidecarWord[] => {
          if (!rawWord || typeof rawWord !== "object" || Array.isArray(rawWord)) return [];
          const word = rawWord as Record<string, unknown>;
          return typeof word.Text === "string" &&
            typeof word.StartTime === "number" &&
            Number.isFinite(word.StartTime) &&
            typeof word.EndTime === "number" &&
            Number.isFinite(word.EndTime) &&
            typeof word.IsPartOfWord === "boolean"
            ? [
                {
                  Text: word.Text,
                  StartTime: word.StartTime,
                  EndTime: word.EndTime,
                  IsPartOfWord: word.IsPartOfWord,
                },
              ]
            : [];
        })
      : undefined;
    return [
      {
        Text: entry.Text,
        ...(typeof entry.Language === "string" ? { Language: entry.Language } : {}),
        ...(words?.length ? { Words: words } : {}),
      },
    ];
  });
  return sidecars.length ? sidecars : undefined;
}

export function isProviderSidecars(value: unknown): value is readonly ProviderSidecar[] {
  if (!Array.isArray(value)) return false;
  return value.every((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string, unknown>;
    return (
      typeof entry.Text === "string" &&
      (entry.Language === undefined || typeof entry.Language === "string") &&
      (entry.Words === undefined ||
        (Array.isArray(entry.Words) &&
          entry.Words.every((rawWord) => {
            if (!rawWord || typeof rawWord !== "object" || Array.isArray(rawWord)) return false;
            const word = rawWord as Record<string, unknown>;
            return (
              typeof word.Text === "string" &&
              typeof word.StartTime === "number" &&
              Number.isFinite(word.StartTime) &&
              typeof word.EndTime === "number" &&
              Number.isFinite(word.EndTime) &&
              typeof word.IsPartOfWord === "boolean"
            );
          })))
    );
  });
}
