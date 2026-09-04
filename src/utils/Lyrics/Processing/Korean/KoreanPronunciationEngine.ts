import { G2p } from "korean-pronunciation";

let koreanG2p: G2p | undefined;

function getKoreanG2p(): G2p {
  koreanG2p ??= new G2p();
  return koreanG2p;
}

export function convertKoreanPronunciation(text: string): string {
  return getKoreanG2p().convert(text);
}
