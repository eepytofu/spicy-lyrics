import type { NativeLyrics, ProviderId, ProviderInfoKind, TrackMetadata } from "./types";

export type ProviderInfoContext = {
  reference: TrackMetadata;
  selected?: {
    title: string;
    titleAliases?: string[];
    artists: string[];
    artistAliases?: string[];
  };
};

export function providerInfoContext(
  reference: TrackMetadata,
  selected: NonNullable<ProviderInfoContext["selected"]>,
  rawMetadata?: string,
): ProviderInfoContext {
  const aliases = rawMetadataAliases(rawMetadata);
  const titleAliases = uniqueAliases(selected.titleAliases, aliases.titles)
    ?.filter((alias) => compact(alias) !== compact(selected.title));
  const selectedArtists = new Set(selected.artists.map(compact));
  const artistAliases = uniqueAliases(selected.artistAliases, aliases.artists)
    ?.filter((alias) => !selectedArtists.has(compact(alias)));
  return {
    reference,
    selected: {
      ...selected,
      ...(titleAliases?.length ? { titleAliases } : {}),
      ...(artistAliases?.length ? { artistAliases } : {}),
    },
  };
}

type ProviderInfoEntry = {
  text: string;
  kind?: ProviderInfoKind;
  setKind: (kind: ProviderInfoKind) => void;
};

type ParsedMetadataRow = {
  anchorCount: number;
};

const METADATA_ROW = /^\s*(?:\d{1,3}\s*[.．、)]\s*)?([^\r\n:：]{1,48})\s*[:：]\s*(\S[^\r\n]{0,239})\s*$/u;
const TRACK_HEADER_ROW = /^\s*(.+)\s+(?:[-–—－])\s+(.+?)\s*$/u;
const COMPACT_TRACK_HEADER_ROW = /^\s*(.+?)\s*(?:[-–—－])\s*(.+?)\s*$/u;
const CJK_ROLE_ANCHOR = /^(?:作?[词詞曲]|[词詞]曲|[编編]曲|制作|製作|混音|录音|錄音|母带|母帶)/u;
const LATIN_ROLE_ANCHOR = /^(?:lyrics?|lyricist|writer|written|songwriter|composer|composed|music|arranger|arranged|producer|produced|production|mix|mixing|mixed|mastering|recording)$/u;

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueAliases(...groups: Array<string[] | string | undefined>): string[] | undefined {
  const values = [...new Set(groups
    .flatMap((group) => Array.isArray(group) ? group : [group])
    .map((value) => value?.trim() ?? "")
    .filter(Boolean))];
  return values.length ? values : undefined;
}

function safeRawAlias(value: string): string | undefined {
  const trimmed = value.trim();
  const normalized = compact(trimmed);
  if (!trimmed || [...trimmed].length > 160 || !/\p{L}/u.test(trimmed)) return undefined;
  if (["unknown", "null", "none", "artist", "title"].includes(normalized)) return undefined;
  return trimmed;
}

function rawMetadataAliases(rawMetadata?: string): { titles: string[]; artists: string[] } {
  const titles: string[] = [];
  const artists: string[] = [];
  if (!rawMetadata) return { titles, artists };
  for (const match of rawMetadata.matchAll(/^\s*\[(ti|ar)\s*:\s*([^\]\r\n]+)\]\s*$/gimu)) {
    const value = safeRawAlias(match[2]);
    if (!value) continue;
    (match[1].toLocaleLowerCase() === "ti" ? titles : artists).push(value);
  }
  return { titles, artists };
}

function roleAnchorCount(label: string): number {
  const normalized = label.trim().normalize("NFKC").toLocaleLowerCase();
  return normalized
    .split(/\s*(?:[/／&+,，、]|\band\b)\s*/u)
    .filter(Boolean)
    .reduce((count, part) => {
      const compactPart = part.replace(/[\s._\\-]+/gu, "");
      if (/^[词詞]曲$/u.test(compactPart)) return count + 2;
      const cjkRuns = part.match(/[\p{Script=Han}]+/gu) ?? [];
      const latinWords = part.match(/[\p{Script=Latin}]+/gu) ?? [];
      return count + (cjkRuns.some((run) => CJK_ROLE_ANCHOR.test(run))
        || latinWords.some((word) => LATIN_ROLE_ANCHOR.test(word)) ? 1 : 0);
    }, 0);
}

function parseMetadataRow(text: string): ParsedMetadataRow | undefined {
  const match = METADATA_ROW.exec(text);
  if (!match) return undefined;
  const normalized = match[1].trim().normalize("NFKC").toLocaleLowerCase();
  if (/^(?:作[词詞]作曲|作曲作[词詞])$/u.test(normalized.replace(/\s+/gu, ""))) {
    return { anchorCount: 2 };
  }
  return { anchorCount: roleAnchorCount(normalized) };
}

function entriesForLyrics(lyrics: NativeLyrics): ProviderInfoEntry[] {
  if (lyrics.Type === "Static") {
    return ((lyrics.Lines as Array<Record<string, unknown>> | undefined) ?? []).map((line) => {
      const entry: ProviderInfoEntry = {
        text: String(line.Text ?? ""),
        kind: line.ProviderInfoKind as ProviderInfoKind | undefined,
        setKind: (kind) => {
          entry.kind = kind;
          line.ProviderInfoKind = kind;
        },
      };
      return entry;
    });
  }

  return ((lyrics.Content as Array<Record<string, unknown>> | undefined) ?? []).flatMap((line) => {
    const target = lyrics.Type === "Syllable"
      ? line.Lead as Record<string, unknown> | undefined
      : line;
    if (!target) return [];
    const text = lyrics.Type === "Syllable"
      ? ((target.Syllables as Array<{ Text?: unknown }> | undefined) ?? [])
        .map((syllable) => String(syllable.Text ?? ""))
        .join("")
      : String(target.Text ?? "");
    const entry: ProviderInfoEntry = {
      text,
      kind: target.ProviderInfoKind as ProviderInfoKind | undefined,
      setKind: (kind: ProviderInfoKind) => {
        entry.kind = kind;
        target.ProviderInfoKind = kind;
      },
    };
    return [entry];
  });
}

function headerTitles(context: ProviderInfoContext): string[] {
  return [
    context.selected?.title,
    ...(context.selected?.titleAliases ?? []),
    context.reference.title,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function headerArtistGroups(context: ProviderInfoContext): string[][] {
  return [
    context.selected?.artists,
    context.reference.artists,
  ].filter((artists): artists is string[] => Boolean(artists?.length));
}

function splitHeaderArtists(value: string): Set<string> {
  return new Set(value
    .split(/\s*(?:[/／、,，&＆]|\band\b)\s*/u)
    .map(compact)
    .filter(Boolean));
}

function matchesHeaderSides(
  text: string,
  pattern: RegExp,
  titles: string[],
  sideMatchesArtists: (value: string) => boolean,
): boolean {
  const structured = pattern.exec(text);
  if (!structured) return false;
  const leftIsTitle = titles.some((title) => compact(structured[1]) === compact(title));
  const rightIsTitle = titles.some((title) => compact(structured[2]) === compact(title));
  return (leftIsTitle && sideMatchesArtists(structured[2]))
    || (rightIsTitle && sideMatchesArtists(structured[1]));
}

function matchesTrackHeader(text: string, context: ProviderInfoContext): boolean {
  const titles = headerTitles(context);
  const artistGroups = headerArtistGroups(context);
  if (context.selected?.artists.length === 1) {
    artistGroups.push(...(context.selected.artistAliases ?? []).map((alias) => [alias]));
  }

  const normalized = compact(text);
  if (titles.some((title) => normalized === compact(title))) return true;
  if (titles.some((title) => artistGroups.some((artists) =>
    normalized === compact(title) + compact(artists.join(""))))) return true;

  return matchesHeaderSides(text, TRACK_HEADER_ROW, titles, (value) => {
    const normalizedSide = compact(value);
    const headerArtists = splitHeaderArtists(value);
    return artistGroups.some((artists) => {
      const expected = artists.map(compact).filter(Boolean);
      return expected.length > 0
        && (normalizedSide === compact(artists.join(""))
          || expected.every((artist) => headerArtists.has(artist)));
    });
  });
}

function stableProviderArtistForms(value: string): string[] {
  const withoutOfficial = value.replace(/official(?:\s*(?:account|channel|music))?\s*$/iu, "");
  return [...new Set([compact(value), compact(withoutOfficial)].filter(Boolean))];
}

// The compact pattern also accepts a dash without surrounding whitespace, so it
// requires every artist to appear rather than accepting a joined-artist side.
function matchesPostCreditTrackHeader(text: string, context: ProviderInfoContext): boolean {
  if (matchesTrackHeader(text, context)) return true;
  const artistGroups = headerArtistGroups(context);
  return matchesHeaderSides(text, COMPACT_TRACK_HEADER_ROW, headerTitles(context), (value) => {
    const headerArtists = splitHeaderArtists(value);
    return artistGroups.some((artists) => artists.length > 0
      && artists.every((artist) => stableProviderArtistForms(artist)
        .some((form) => headerArtists.has(form))));
  });
}

function scanBoundaryBlock(
  entries: ProviderInfoEntry[],
  boundary: number,
  step: 1 | -1,
  anchoredByHeader = false,
): number[] {
  const indices: number[] = [];
  let current = boundary;
  let sawMetadata = false;

  while (current >= 0 && current < entries.length && !entries[current].kind) {
    const parsed = parseMetadataRow(entries[current].text);
    if (parsed) {
      indices.push(current);
      sawMetadata = true;
      current += step;
      continue;
    }
    if (!sawMetadata) break;

    const bridge: number[] = [];
    let lookahead = current;
    while (bridge.length < 2 && lookahead >= 0 && lookahead < entries.length && !entries[lookahead].kind) {
      if (parseMetadataRow(entries[lookahead].text)) break;
      bridge.push(lookahead);
      lookahead += step;
    }
    if (!bridge.length || lookahead < 0 || lookahead >= entries.length || entries[lookahead].kind
      || !parseMetadataRow(entries[lookahead].text)) break;
    indices.push(...bridge);
    current = lookahead;
  }

  const metadata = indices
    .map((index) => parseMetadataRow(entries[index].text))
    .filter((row): row is ParsedMetadataRow => Boolean(row));
  const requiredAnchors = anchoredByHeader ? 1 : 2;
  const requiredRows = anchoredByHeader ? 1 : 2;
  return metadata.length >= requiredRows
    && metadata.reduce((sum, row) => sum + row.anchorCount, 0) >= requiredAnchors
    ? indices
    : [];
}

function isStrongRightsNotice(text: string, provider: ProviderId): boolean {
  const value = text.normalize("NFKC").toLocaleLowerCase();
  if (/^\s*[【[][^\]\r\n】]*(?:音乐|音樂|歌曲|词曲|詞曲|作品)[^\]\r\n】]*已(?:获得|獲得|取得)?(?:正版)?(?:授权|授權)[^\]\r\n】]*[】\]]\s*$/u.test(value)) return true;
  const trimmed = value.trim();
  if ([...trimmed].length <= 80
    && /^[【[][^\]\r\n】]+[】\]]$/u.test(trimmed)
    && /版权|版權|著作权|著作權/u.test(trimmed)
    && /(?:未经|未經)[^\r\n]{0,24}(?:许可|許可|授权|授權)/u.test(trimmed)
    && /翻版[^\r\n]{0,8}必究/u.test(trimmed)) return true;
  if (provider === "qq"
    && /腾讯|騰訊|tme/u.test(value)
    && value.includes("享有")
    && /翻译|翻譯/u.test(value)
    && /权|權/u.test(value)) return true;
  const concepts = [
    /版权|版權|著作权|著作權/u,
    /未经|未經/u,
    /许可|許可|授权|授權/u,
    /不得|禁止/u,
    /使用|复制|複製|传播|傳播/u,
    /翻译|翻譯/u,
    /腾讯|騰訊|tme/u,
  ];
  return concepts.filter((concept) => concept.test(value)).length >= 4;
}

function isProviderCampaignNotice(text: string, provider: ProviderId): boolean {
  if (provider !== "kugou") return false;
  const value = text.normalize("NFKC").trim();
  return /^酷狗(?:音乐)?[\p{L}\p{N}]{0,24}(?:企划|企劃|计划|計劃)$/u.test(value)
    || /^听[\p{L}\p{N}]{1,24}[,，]\s*上酷狗音乐$/u.test(value);
}

function markProviderNotices(entries: ProviderInfoEntry[], provider: ProviderId): void {
  for (const entry of entries) {
    if (!entry.kind && isProviderCampaignNotice(entry.text, provider)) {
      entry.setKind("providerNotice");
    }
  }
}

function markRights(entries: ProviderInfoEntry[], provider: ProviderId): void {
  for (const entry of entries) {
    if (isStrongRightsNotice(entry.text, provider)) entry.setKind("rightsNotice");
  }
  if (provider !== "qq" || entries.length < 2) return;
  const notice = entries.at(-1)!;
  const holder = entries.at(-2)!;
  if (notice.kind !== "rightsNotice" || holder.kind || parseMetadataRow(holder.text)) return;
  const holderLength = [...holder.text.trim()].length;
  if (holderLength > 0 && holderLength <= 80) holder.setKind("rightsHolder");
}

export function markEmbeddedProviderInfo(
  lyrics: NativeLyrics,
  provider: ProviderId,
  context: ProviderInfoContext,
): NativeLyrics {
  const entries = entriesForLyrics(lyrics);
  if (!entries.length) return lyrics;

  markProviderNotices(entries, provider);
  markRights(entries, provider);

  const hasHeader = !entries[0].kind && matchesTrackHeader(entries[0].text, context);
  let leadingStart = hasHeader ? 1 : 0;
  let hasAuthoritativeLeadingCredit = false;
  while (entries[leadingStart]?.kind === "credit") {
    hasAuthoritativeLeadingCredit = true;
    leadingStart += 1;
  }
  const postCreditHeader = hasAuthoritativeLeadingCredit
    && entries[leadingStart]
    && !entries[leadingStart]?.kind
    && matchesPostCreditTrackHeader(entries[leadingStart].text, context)
    ? leadingStart
    : undefined;
  if (postCreditHeader !== undefined) leadingStart += 1;
  const leading = scanBoundaryBlock(
    entries,
    leadingStart,
    1,
    postCreditHeader === undefined && (hasHeader || hasAuthoritativeLeadingCredit),
  );
  if (leading.length) {
    for (const index of leading) entries[index].setKind("credit");
    if (hasHeader) entries[0].setKind("trackHeader");
    if (postCreditHeader !== undefined) entries[postCreditHeader].setKind("trackHeader");
  }

  let trailingBoundary = entries.length - 1;
  let hasAuthoritativeTrailingCredit = false;
  while (trailingBoundary >= 0 && entries[trailingBoundary].kind) {
    if (entries[trailingBoundary].kind === "credit") hasAuthoritativeTrailingCredit = true;
    trailingBoundary -= 1;
  }
  const trailing = scanBoundaryBlock(entries, trailingBoundary, -1, hasAuthoritativeTrailingCredit);
  if (trailing.length) {
    for (const index of trailing) entries[index].setKind("credit");
  }

  return lyrics;
}
