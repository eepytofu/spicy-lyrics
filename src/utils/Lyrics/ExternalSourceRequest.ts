export const EXTERNAL_WORKER_REQUEST_VERSION = 4;

export type ExternalSourceRequestInfo = {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  durationMs: number;
};

export function externalSourceRequestUrl(
  base: string,
  info: ExternalSourceRequestInfo,
  provider?: string,
): string {
  const root = base.trim().replace(/\/+$/, "");
  const url = new URL(provider
    ? `${root}/v1/lyrics/${provider}/${encodeURIComponent(info.id)}`
    : `${root}/${encodeURIComponent(info.id)}`);
  url.searchParams.set("title", info.title);
  url.searchParams.set("artist", info.artist);
  url.searchParams.set("album", info.album);
  url.searchParams.set("duration", String(info.durationMs / 1000));
  info.artists.forEach((artist) => url.searchParams.append("artist_name", artist));
  if (provider) url.searchParams.set("request_version", String(EXTERNAL_WORKER_REQUEST_VERSION));
  return url.toString();
}
