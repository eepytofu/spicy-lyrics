export const BUILT_IN_LYRICS_SOURCE_IDS = [
  "spicy",
  "musixmatch",
  "apple",
  "spotify",
  "lrclib",
  "amlldb",
  "qq",
  "kugou",
  "netease",
  "soda",
] as const;

export type BuiltInLyricsSourceId = (typeof BUILT_IN_LYRICS_SOURCE_IDS)[number];
export type LyricsSourceProviderId = BuiltInLyricsSourceId | `custom:${string}`;

export type CustomLyricsServer = {
  id: `custom:${string}`;
  name: string;
  url: string;
};

type LyricsSourceDefinition = { label: string; description: string };

export const DEFAULT_LYRICS_SOURCE_ORDER: LyricsSourceProviderId[] = [
  "spicy", "amlldb", "musixmatch", "apple", "qq", "kugou", "netease", "soda", "spotify", "lrclib",
];

export const DEFAULT_DISABLED_LYRICS_SOURCES: LyricsSourceProviderId[] = [
  "lrclib", "amlldb", "qq", "kugou", "netease", "soda",
];

export const LYRICS_SOURCE_PROVIDER_DEFINITIONS: Record<BuiltInLyricsSourceId, LyricsSourceDefinition> = {
  spicy: { label: "Spicy Lyrics", description: "Community lyrics from the Spicy Lyrics service." },
  musixmatch: { label: "Musixmatch", description: "Synced, word-synced, or plain Musixmatch lyrics." },
  apple: { label: "Apple Music", description: "Apple Music lyrics through the Spicy Lyrics backend." },
  spotify: { label: "Spotify", description: "Lyrics returned by Spotify's native lyrics endpoint." },
  lrclib: { label: "LRCLIB", description: "Open community synced and plain lyrics." },
  amlldb: { label: "AMLL TTML DB", description: "Community TTML with word timing, duet, and background-vocal metadata." },
  qq: { label: "QQ Music", description: "Word-synced QRC lyrics." },
  kugou: { label: "KuGou", description: "Word-synced KRC lyrics." },
  netease: { label: "NetEase Cloud Music", description: "Word-synced YRC or line-synced LRC lyrics." },
  soda: { label: "Soda Music", description: "Soda Music KRC, QRC, YRC, LRC, or plain lyrics." },
};

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
}

export function normalizeLyricsServerUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? "").trim());
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function parseCustomLyricsServers(value: unknown): CustomLyricsServer[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed.flatMap((entry): CustomLyricsServer[] => {
    if (!entry || typeof entry !== "object") return [];
    const id = String((entry as any).id ?? "");
    const name = String((entry as any).name ?? "").trim();
    const url = normalizeLyricsServerUrl((entry as any).url);
    if (!id.startsWith("custom:") || seen.has(id) || !name || !url) return [];
    seen.add(id);
    return [{ id: id as `custom:${string}`, name, url }];
  });
}

export function normalizeLyricsSourceOrder(value: unknown, customServers: CustomLyricsServer[] = []): LyricsSourceProviderId[] {
  const valid = new Set<string>([...BUILT_IN_LYRICS_SOURCE_IDS, ...customServers.map(({ id }) => id)]);
  const normalized = parseStringArray(value).filter((id): id is LyricsSourceProviderId => valid.has(id));
  const deduped = [...new Set(normalized)];
  for (const id of DEFAULT_LYRICS_SOURCE_ORDER) if (!deduped.includes(id)) deduped.push(id);
  for (const { id } of customServers) if (!deduped.includes(id)) deduped.push(id);
  return deduped;
}

export function normalizeDisabledLyricsSourceIds(value: unknown, customServers: CustomLyricsServer[] = []): LyricsSourceProviderId[] {
  const valid = new Set<string>([...BUILT_IN_LYRICS_SOURCE_IDS, ...customServers.map(({ id }) => id)]);
  return [...new Set(parseStringArray(value).filter((id): id is LyricsSourceProviderId => valid.has(id)))];
}

export const stringifyLyricsSourceOrder = (order: LyricsSourceProviderId[]) => JSON.stringify(order);
export const stringifyDisabledLyricsSourceIds = (ids: LyricsSourceProviderId[]) => JSON.stringify(ids);

export function getLyricsSourceDefinition(id: LyricsSourceProviderId, customServers: CustomLyricsServer[]): LyricsSourceDefinition {
  if (id.startsWith("custom:")) {
    const server = customServers.find((entry) => entry.id === id);
    return server ? { label: server.name, description: server.url } : { label: "Custom Server", description: "Unavailable server" };
  }
  return LYRICS_SOURCE_PROVIDER_DEFINITIONS[id];
}

const SOURCE_LABELS: Record<string, string> = {
  spl: "Spicy Lyrics Community", spt: "Spotify", aml: "Apple Music",
  spicy: "Spicy Lyrics", musixmatch: "Musixmatch", apple: "Apple Music",
  spotify: "Spotify", lrclib: "LRCLIB", amlldb: "AMLL TTML DB", qq: "QQ Music", kugou: "KuGou", netease: "NetEase Cloud Music", soda: "Soda Music",
};

const CANONICAL_EXTERNAL_SOURCE_LABELS: Record<string, string> = {
  qq: SOURCE_LABELS.qq,
  kugou: SOURCE_LABELS.kugou,
  netease: SOURCE_LABELS.netease,
  soda: SOURCE_LABELS.soda,
};

export function resolveLyricsSourceLabel(source?: string, displayName?: string, fetchProvider?: string): string | null {
  if (source && CANONICAL_EXTERNAL_SOURCE_LABELS[source]) return CANONICAL_EXTERNAL_SOURCE_LABELS[source];
  if (fetchProvider && CANONICAL_EXTERNAL_SOURCE_LABELS[fetchProvider]) return CANONICAL_EXTERNAL_SOURCE_LABELS[fetchProvider];
  if (displayName?.trim()) return displayName.trim();
  if (source && SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (fetchProvider && SOURCE_LABELS[fetchProvider]) return SOURCE_LABELS[fetchProvider];
  return source?.trim() || fetchProvider?.trim() || null;
}
