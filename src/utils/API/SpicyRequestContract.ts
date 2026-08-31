export const SPICY_API_MODE = "2";
export const SPICY_API_CACHE_VERSION = 1;

export type SpicyApiQuery = {
  operation: string;
  variables?: unknown;
};

export function buildSpicyApiHeaders(
  version: string,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": version,
    "X-mode": SPICY_API_MODE,
    ...extraHeaders,
  };
}

export function buildSpicyApiRequestBody(
  queries: readonly SpicyApiQuery[],
  version: string,
): string {
  return JSON.stringify({
    queries,
    client: { version },
  });
}
