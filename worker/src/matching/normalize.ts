import OpenCC from "opencc-js";

const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const languageTags = new Set(["粤", "粤语", "国", "国语", "普通话", "台", "台语", "闽南语", "日", "日语", "日文", "韩", "韩语", "韩文", "英", "英语", "英文"]);
const versionPatterns: Array<[string, RegExp]> = [
  ["remix", /\bremix(?:ed)?\b|混音|重混/iu],
  ["dj", /(?:^|[^\p{L}\p{N}])dj(?:$|[^\p{L}\p{N}])|dj(?:\p{Script=Han}{0,6})?版/iu],
  ["live", /\blive\b|现场(?:版)?|演唱会版/iu],
  ["instrumental", /\binstrumental\b|伴奏(?:版)?|纯音乐/iu],
  ["karaoke", /\bkaraoke\b|卡拉ok/iu],
  ["acoustic", /\bacoustic\b|不插电/iu],
  ["sped-up", /\bsped\s*up\b|加速版/iu],
  ["slowed", /\bslowed\b|慢速版/iu],
  ["cover", /\bcover\b|翻唱/iu],
  ["demo", /\bdemo\b|小样/iu],
];

export function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function simplify(value: string): string {
  return traditionalToSimplified(value.normalize("NFKC"));
}

export function compact(value: string): string {
  return simplify(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function stripLanguageTags(value: string): string {
  return value.replace(/\(([^)]*)\)|\[([^\]]*)\]|（([^）]*)）|【([^】]*)】/gu, (match, ...groups: string[]) => {
    const tag = groups.find((group) => typeof group === "string") ?? "";
    return languageTags.has(compact(tag)) ? "" : match;
  });
}

export function normalize(value: string): string {
  return compact(stripLanguageTags(value));
}

export function versionTags(value: string): Set<string> {
  const simplified = simplify(value).toLowerCase();
  return new Set(versionPatterns.filter(([, pattern]) => pattern.test(simplified)).map(([tag]) => tag));
}

export function hasInstrumentalVersionConflict(wanted: string, candidate: string): boolean {
  return !versionTags(wanted).has("instrumental") && versionTags(candidate).has("instrumental");
}

const softTitleTag = /\b(?:feat(?:uring)?\.?|ft\.?|with|explicit|deluxe(?:\s+edition)?|special\s+edition|bonus\s+track)\b/iu;

export function stripSoftTitleSuffix(value: string): string {
  let result = simplify(value).trim();
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/\s+(?:-|–|—)\s*(?:feat(?:uring)?\.?|ft\.?|with)\s+.+$/iu, "")
      .replace(/\s*(?:\(|\[|（|【)([^)\]）】]+)(?:\)|\]|）|】)\s*$/u, (match, inner: string) => softTitleTag.test(inner) ? "" : match)
      .trim();
  }
  return result;
}
