import type { TrackMetadata } from "../types";
import { simplify, stripSoftTitleSuffix, unique } from "./normalize";

export function searchQueries(track: TrackMetadata): string[] {
  const title = track.title.trim();
  const artists = track.artists.map((artist) => artist.trim()).filter(Boolean).join(" ");
  const album = track.album.trim();
  const baseTitle = stripSoftTitleSuffix(title);
  const titleVariants = unique([simplify(title), title]);
  const baseTitleVariants = unique([simplify(baseTitle), baseTitle]);
  const artistVariants = unique([simplify(artists), artists]);
  const albumVariants = unique([simplify(album), album]);
  const queries: string[] = [];
  for (let index = 0; index < titleVariants.length; index += 1) {
    const candidateTitle = titleVariants[index];
    const candidateArtists = artistVariants[Math.min(index, artistVariants.length - 1)] ?? artists;
    const candidateAlbum = albumVariants[Math.min(index, albumVariants.length - 1)] ?? album;
    queries.push(`${candidateTitle} ${candidateArtists} ${candidateAlbum}`);
  }
  for (let index = 0; index < baseTitleVariants.length; index += 1) {
    const candidateArtists = artistVariants[Math.min(index, artistVariants.length - 1)] ?? artists;
    queries.push(`${baseTitleVariants[index]} ${candidateArtists}`);
  }
  queries.push(...baseTitleVariants, ...titleVariants);
  return unique(queries);
}
