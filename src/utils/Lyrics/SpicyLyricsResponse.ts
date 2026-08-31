export type SpicyApiFetchProvider = "spicy" | "apple";

export type NormalizedSpicyApiDocument = {
  lyrics: any;
  fetchProvider: SpicyApiFetchProvider;
  sourceDisplayName: string;
};

function controlText(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function displaySourceIdentity(source: string): string {
  return [...source]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 64);
}

export function isSpicyForcedUpdateControl(data: any): boolean {
  if (data?.Type !== "Static" || !Array.isArray(data?.Lines)) return false;

  let asksForUpdate = false;
  let asksForRestart = false;
  for (const line of data.Lines) {
    const text = controlText(line?.Text);
    if (text === "please update spicy lyrics") asksForUpdate = true;
    if (text.includes("immediately by restarting spotify")) asksForRestart = true;
  }
  return asksForUpdate && asksForRestart;
}

export function normalizeSpicyApiDocument(
  data: any,
): NormalizedSpicyApiDocument | null {
  if (!data || typeof data !== "object" || isSpicyForcedUpdateControl(data)) {
    return null;
  }

  const source = typeof data.source === "string" && data.source.length > 0
    ? data.source
    : "spl";
  if (source === "aml") {
    return {
      lyrics: { ...data, source },
      fetchProvider: "apple",
      sourceDisplayName: "Apple Music",
    };
  }
  if (source === "spl") {
    return {
      lyrics: { ...data, source },
      fetchProvider: "spicy",
      sourceDisplayName: "Spicy Lyrics",
    };
  }

  const identity = displaySourceIdentity(source) || "unknown";
  return {
    lyrics: { ...data, source },
    fetchProvider: "spicy",
    sourceDisplayName: `Spicy Lyrics (${identity})`,
  };
}
