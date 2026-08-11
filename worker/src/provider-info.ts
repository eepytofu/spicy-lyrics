import type { NativeLyrics, ProviderId, ProviderInfoKind, TrackMetadata } from "./types";
import { normalize, simplify } from "./matching/normalize";

function normalizeLabel(value: string): string {
  return simplify(value).replace(/[\s·・]/gu, "").toLowerCase();
}

// Credit labels are productive compounds, so matching complete labels either
// misses ordinary variants or grows into a brittle provider-specific catalog.
// Account for the role-bearing pieces instead, then require most of every
// compound part to be explained before it may anchor a credit block.
const ROLE_MORPHEMES = new Set([
  "词", "詞", "曲", "作", "填", "编", "編", "写", "寫", "谱", "譜",
  "制作", "製作", "制", "製", "监制", "監製", "混音", "缩混", "縮混",
  "录音", "錄音", "母带", "母帶", "后期", "後期", "和声", "和聲", "调校", "調校",
  "调教", "調教", "工程", "编程", "編程", "programming",
  "演奏", "配器", "指挥", "指揮", "乐器", "樂器", "乐队", "樂隊",
  "吉他", "贝斯", "貝斯", "鼓", "钢琴", "鋼琴", "键盘", "鍵盤",
  "二胡", "小提琴", "大提琴", "提琴", "古筝", "古箏", "琵琶",
  "笛子", "笛", "古琴", "扬琴", "揚琴", "尺八", "唢呐", "嗩吶",
  "弦乐", "弦樂", "管弦", "打击乐", "打擊樂", "合成器", "萨克斯", "薩克斯",
  "出品", "发行", "發行", "策划", "策劃", "统筹", "統籌", "企划", "企劃",
  "lyrics", "lyric", "lyricist", "composer", "composed", "arranger", "arranged",
  "producer", "produced", "production", "mix", "mixing", "mixed", "mastering",
  "recording", "record", "engineer", "engineering", "guitar", "bass", "drums",
  "piano", "keyboard", "violin", "cello", "strings", "percussion", "programming",
].map(normalizeLabel));

const ROLE_COVER_MIN = 2 / 3;
const CREDIT_LABEL_MAX_LENGTH = 20;
const CREDIT_LINE = /^\s*(?:\d{1,3}\s*[.．、)]\s*)?([\p{L}\p{N}][\p{L}\p{N}\s&/・·,，、-]{0,40}?)\s*[:：]\s*(\S.*)$/u;

const GENERIC_RIGHTS_TERMS = ["未经", "许可", "授权", "不得", "请勿", "使用", "版权"];

type ProviderInfoEntry = {
  text: string;
  kind?: ProviderInfoKind;
  setKind: (kind: ProviderInfoKind) => void;
};

function providerInfoEntry(text: string, target: Record<string, unknown>): ProviderInfoEntry {
  const entry: ProviderInfoEntry = {
    text,
    kind: target.ProviderInfoKind as ProviderInfoKind | undefined,
    setKind: (kind) => {
      target.ProviderInfoKind = kind;
      entry.kind = kind;
    },
  };
  return entry;
}

function roleCoverRatio(label: string): number {
  const characters = [...label];
  if (!characters.length) return 0;
  const best = Array<number>(characters.length + 1).fill(0);
  for (let start = 0; start < characters.length; start += 1) {
    if (best[start] > best[start + 1]) best[start + 1] = best[start];
    for (let end = start + 1; end <= characters.length; end += 1) {
      if (!ROLE_MORPHEMES.has(characters.slice(start, end).join(""))) continue;
      best[end] = Math.max(best[end], best[start] + end - start);
    }
  }
  return best[characters.length] / characters.length;
}

function isRoleCreditLine(text: string): boolean {
  const match = CREDIT_LINE.exec(simplify(text));
  if (!match) return false;
  const label = normalizeLabel(match[1]);
  if (!label || [...label].length > CREDIT_LABEL_MAX_LENGTH) return false;
  const parts = label.split(/[&/,，、]/u);
  return parts.every((part) => !!part && roleCoverRatio(part) >= ROLE_COVER_MIN);
}

function isRightsNotice(text: string, provider: ProviderId): boolean {
  const normalized = simplify(text);
  if (
    provider === "qq"
    && /(?:腾讯|tme)/iu.test(normalized)
    && normalized.includes("享有")
    && normalized.includes("翻译")
    && normalized.includes("权")
  ) return true;
  return GENERIC_RIGHTS_TERMS.filter((term) => normalized.includes(term)).length >= 4;
}

function exactTrackHeader(text: string, track?: TrackMetadata): boolean {
  if (!track) return false;
  const title = normalize(track.title);
  const artists = track.artists.map(normalize).filter(Boolean).join("");
  return !!title && !!artists && normalize(text) === `${title}${artists}`;
}

function entriesForLyrics(lyrics: NativeLyrics): ProviderInfoEntry[] {
  if (lyrics.Type === "Static") {
    return ((lyrics.Lines as any[]) ?? []).map((line) =>
      providerInfoEntry(String(line?.Text ?? ""), line));
  }
  if (lyrics.Type === "Line") {
    return ((lyrics.Content as any[]) ?? []).map((line) =>
      providerInfoEntry(String(line?.Text ?? ""), line));
  }
  return ((lyrics.Content as any[]) ?? []).map((line) => providerInfoEntry(
    ((line?.Lead?.Syllables as any[]) ?? []).map((word) => String(word?.Text ?? "")).join(""),
    line.Lead,
  ));
}

export function markEmbeddedProviderInfo(
  lyrics: NativeLyrics,
  provider: ProviderId,
  track?: TrackMetadata,
): NativeLyrics {
  const entries = entriesForLyrics(lyrics);
  for (const entry of entries) {
    if (!entry.kind && isRightsNotice(entry.text, provider)) entry.setKind("rightsNotice");
  }

  let index = 0;
  while (index < entries.length) {
    if (entries[index].kind || !isRoleCreditLine(entries[index].text)) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < entries.length
      && !entries[index].kind
      && isRoleCreditLine(entries[index].text)
    ) index += 1;
    if (index - start < 2) continue;
    for (let creditIndex = start; creditIndex < index; creditIndex += 1) {
      entries[creditIndex].setKind("credit");
    }
    for (const headerIndex of [start - 1, index]) {
      const header = entries[headerIndex];
      if (header && !header.kind && exactTrackHeader(header.text, track)) header.setKind("trackHeader");
    }
  }
  return lyrics;
}
