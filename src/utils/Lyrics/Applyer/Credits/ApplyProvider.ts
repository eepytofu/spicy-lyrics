import { resolveLyricsSourceLabel } from "../../LyricsSourcePreferences.ts";

const ProviderMap: Record<string, string> = { spt: "Spotify", aml: "Apple Music", spl: "Spicy Lyrics", ldb: "Local DB" };

export function ApplyLyricsProvider(data: any, LyricsContainer: HTMLElement): void {
  if ((!data?.source && !data?.fetchProvider && !data?.sourceDisplayName) || !LyricsContainer) return;

  const ProviderElement = document.createElement("div");
  ProviderElement.classList.add("LyricsProvider");

  const providerLabel = ProviderMap[data.source] ??
    resolveLyricsSourceLabel(data.source, data.sourceDisplayName, data.fetchProvider) ??
    "Unknown";
  ProviderElement.textContent = `Provided by: ${providerLabel}`;
  LyricsContainer.appendChild(ProviderElement);
}
