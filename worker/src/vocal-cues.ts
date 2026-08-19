import type {
  NativeLyrics,
  ProviderId,
  ProviderInfoKind,
  VocalCue,
  VocalCueForm,
} from "./types";
import type { ProviderLineSemanticContext } from "./provider-line-semantics";

type CueEntry = {
  target: Record<string, unknown>;
  text?: string;
  syllables?: Array<{ Text?: unknown }>;
  kind?: ProviderInfoKind;
  cue?: VocalCue;
};

type CueCandidate = {
  entry: CueEntry;
  form: VocalCueForm;
  index: number;
  label: string;
};

const LABEL_COLON_CUE = /^\s*([^\r\n:：]{1,32})\s*[:：]\s*$/u;
const BRACKETED_LABEL_CUE = /^\s*[【[]([^】\]\r\n]{1,32})[】\]]\s*$/u;
const PROVEN_VOICE_LABELS = new Set([
  "念白",
  "合",
  "合唱",
  "女",
  "男",
  "女合",
  "男合",
]);
const STRUCTURAL_LABEL = /^(?:pre[-\s]?chorus|chorus|verse|bridge|intro|outro|refrain|hook|interlude|instrumental|x\s*\d+)$/iu;

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function boundedArtistForms(value: string): string[] {
  const trimmed = value.trim();
  const forms = new Set([compact(trimmed)]);
  const withoutOfficial = trimmed.replace(/official(?:\s*(?:account|channel|music))?\s*$/iu, "");
  forms.add(compact(withoutOfficial));
  for (const part of trimmed.split(/\s*(?:[/／、,，&＆]|\band\b|[_-])\s*/iu)) {
    forms.add(compact(part));
  }
  for (const match of trimmed.matchAll(/[（(【[]([^）)】\]]{1,80})[）)】\]]/gu)) {
    forms.add(compact(match[1]));
  }
  for (const match of trimmed.matchAll(/\p{Script=Han}+|[A-Za-z][A-Za-z0-9]*/gu)) {
    forms.add(compact(match[0]));
  }
  return [...forms].filter(Boolean);
}

function contextArtistForms(context: ProviderLineSemanticContext): string[] {
  return [...new Set([
    ...context.reference.artists,
    ...(context.selected?.artists ?? []),
    ...(context.selected?.artistAliases ?? []),
  ].flatMap(boundedArtistForms))];
}

function matchesArtistIdentity(label: string, artistForms: readonly string[]): boolean {
  const normalized = compact(label);
  return Boolean(normalized) && artistForms.includes(normalized);
}

function entriesForLyrics(lyrics: NativeLyrics): CueEntry[] {
  if (lyrics.Type === "Static") {
    return ((lyrics.Lines as Array<Record<string, unknown>> | undefined) ?? []).map((line) => ({
        target: line,
        text: String(line.Text ?? ""),
        kind: line.ProviderInfoKind as ProviderInfoKind | undefined,
        cue: line.VocalCue as VocalCue | undefined,
      }));
  }

  return ((lyrics.Content as Array<Record<string, unknown>> | undefined) ?? []).flatMap((line) => {
    const target = lyrics.Type === "Syllable"
      ? line.Lead as Record<string, unknown> | undefined
      : line;
    if (!target) return [];
    return [{
      target,
      ...(lyrics.Type === "Syllable"
        ? { syllables: (target.Syllables as Array<{ Text?: unknown }> | undefined) ?? [] }
        : { text: String(target.Text ?? "") }),
      kind: target.ProviderInfoKind as ProviderInfoKind | undefined,
      cue: target.VocalCue as VocalCue | undefined,
    }];
  });
}

function entryText(entry: CueEntry): string {
  if (entry.text === undefined) {
    entry.text = (entry.syllables ?? [])
      .map((syllable) => String(syllable.Text ?? ""))
      .join("");
  }
  return entry.text;
}

function couldBeCue(entry: CueEntry): boolean {
  const text = entry.text ?? String(entry.syllables?.at(-1)?.Text ?? "");
  return hasCueTail(text);
}

function hasCueTail(value: string): boolean {
  let index = value.length - 1;
  while (index >= 0) {
    const code = value.charCodeAt(index);
    const whitespace = code <= 0x20
      || code === 0xa0
      || code === 0x1680
      || (code >= 0x2000 && code <= 0x200a)
      || code === 0x2028
      || code === 0x2029
      || code === 0x202f
      || code === 0x205f
      || code === 0x3000
      || code === 0xfeff;
    if (!whitespace) break;
    index -= 1;
  }
  const tail = value[index];
  return tail === ":" || tail === "：" || tail === "】" || tail === "]";
}

function lyricsMayContainCue(lyrics: NativeLyrics): boolean {
  const mayContainCue = (target: Record<string, unknown>): boolean => {
    if (target.ProviderInfoKind || target.VocalCue) return false;
    const tail = lyrics.Type === "Syllable"
      ? String((target.Syllables as Array<{ Text?: unknown }> | undefined)?.at(-1)?.Text ?? "")
      : String(target.Text ?? "");
    return hasCueTail(tail);
  };
  if (lyrics.Type === "Static") {
    return ((lyrics.Lines as Array<Record<string, unknown>> | undefined) ?? []).some(mayContainCue);
  }
  for (const line of (lyrics.Content as Array<Record<string, unknown>> | undefined) ?? []) {
    const target = lyrics.Type === "Syllable"
      ? line.Lead as Record<string, unknown> | undefined
      : line;
    if (target && mayContainCue(target)) return true;
  }
  return false;
}

function candidate(entry: CueEntry, provider: ProviderId, index: number): CueCandidate | undefined {
  if (entry.kind || entry.cue) return undefined;
  if (!couldBeCue(entry)) return undefined;
  const text = entryText(entry);
  const colon = LABEL_COLON_CUE.exec(text);
  if (colon) return { entry, form: "labelColon", index, label: colon[1].trim() };
  if (provider !== "netease") return undefined;
  const bracketed = BRACKETED_LABEL_CUE.exec(text);
  return bracketed
    ? { entry, form: "bracketedLabel", index, label: bracketed[1].trim() }
    : undefined;
}

function hasFollowingLyric(entries: readonly CueEntry[], candidate: CueCandidate): boolean {
  const following = entries[candidate.index + 1];
  if (!following || following.kind) return false;
  const text = entryText(following);
  return Boolean(!LABEL_COLON_CUE.test(text) && !BRACKETED_LABEL_CUE.test(text) && text.trim());
}

function mark(candidate: CueCandidate): void {
  const cue = { Label: candidate.label, Form: candidate.form } as const;
  candidate.entry.cue = cue;
  candidate.entry.target.VocalCue = cue;
}

function seededCompositeIdentity(
  label: string,
  seededLabels: ReadonlySet<string>,
): string | undefined {
  const [identity, ...modifierParts] = label.normalize("NFKC").trim().split(/\s+/u);
  const modifier = modifierParts.join(" ");
  const normalizedIdentity = compact(identity ?? "");
  return normalizedIdentity
    && modifier
    && seededLabels.has(normalizedIdentity)
    && !STRUCTURAL_LABEL.test(modifier)
    ? normalizedIdentity
    : undefined;
}

/** Adds speaker semantics without changing source text, timing, order, or provider-info kinds. */
export function markEmbeddedVocalCues(
  lyrics: NativeLyrics,
  provider: ProviderId,
  context: ProviderLineSemanticContext,
): NativeLyrics {
  if (!lyricsMayContainCue(lyrics)) return lyrics;
  const entries = entriesForLyrics(lyrics);
  const candidates = entries
    .map((entry, index) => candidate(entry, provider, index))
    .filter((entry): entry is CueCandidate => Boolean(entry));
  if (!candidates.length) return lyrics;

  const artistForms = contextArtistForms(context);
  const seeded = candidates.filter((entry) =>
    PROVEN_VOICE_LABELS.has(entry.label.normalize("NFKC").trim())
    || matchesArtistIdentity(entry.label, artistForms));
  for (const entry of seeded) mark(entry);

  // A bounded fallback can recover a repeatedly alternating cast name omitted
  // from provider artist metadata, but only inside a document that already has
  // at least two independently proven cue identities.
  const seededLabels = new Set(seeded.map((entry) => compact(entry.label)));
  if (seededLabels.size < 2) return lyrics;
  const firstSeed = Math.min(...seeded.map((entry) => entry.index));
  const lastSeed = Math.max(...seeded.map((entry) => entry.index));

  // Some documents preserve an already-proven identity while appending a
  // performance modifier (for example, `男 Rap：`). Recover that row only
  // inside the bounded, repeated cue sequence; the modifier is never promoted
  // to a document-independent cue token.
  for (const entry of candidates) {
    if (entry.entry.cue || entry.index <= firstSeed || entry.index >= lastSeed) continue;
    const identity = seededCompositeIdentity(entry.label, seededLabels);
    if (!identity || !hasFollowingLyric(entries, entry)) continue;
    const identitySeeds = seeded.filter((seed) => compact(seed.label) === identity);
    if (identitySeeds.some((seed) => seed.index < entry.index)
      && identitySeeds.some((seed) => seed.index > entry.index)) {
      mark(entry);
    }
  }

  const byLabel = new Map<string, CueCandidate[]>();
  for (const entry of candidates) {
    if (entry.entry.cue || entry.index < firstSeed || entry.index > lastSeed) continue;
    const normalized = compact(entry.label);
    const group = byLabel.get(normalized) ?? [];
    group.push(entry);
    byLabel.set(normalized, group);
  }
  for (const group of byLabel.values()) {
    const label = group[0]?.label.normalize("NFKC").trim() ?? "";
    if (group.length < 2 || !label || STRUCTURAL_LABEL.test(label)) continue;
    if (group.every((entry) => hasFollowingLyric(entries, entry))) {
      for (const entry of group) mark(entry);
    }
  }
  return lyrics;
}
