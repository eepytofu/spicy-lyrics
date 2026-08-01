import { createRetryableLazyInitializer } from "./Analyzer/LazyInitializer.ts";
import { buildKuromojiBrowserTokenizer } from "./Analyzer/KuromojiBrowserLoader.ts";

export type KuromojiToken = {
  surface_form?: string;
  reading?: string;
  pronunciation?: string;
  pos?: string;
  pos_detail_1?: string;
  pos_detail_2?: string;
  basic_form?: string;
  conjugated_type?: string;
  conjugated_form?: string;
  word_id?: number;
  word_type?: string;
  word_position?: number;
  verbose?: {
    word_id?: number;
    word_type?: string;
    word_position?: number;
  };
};

let Analyzer: any;
const lazyInitialization = createRetryableLazyInitializer(async () => {
  if (Analyzer === undefined) {
    Analyzer = await buildKuromojiBrowserTokenizer();
  }
});

export const init = (): Promise<void> => lazyInitialization.ensure();

export const parse = async (text = ""): Promise<KuromojiToken[]> => {
  if (text.trim() === "") return [];
  if (Analyzer === undefined) {
    if (typeof window === "undefined") return [];
    await init();
  }
  const result = Analyzer.tokenize(text) as KuromojiToken[];
  for (const token of result) {
    token.verbose = {
      word_id: token.word_id,
      word_type: token.word_type,
      word_position: token.word_position,
    };
    delete token.word_id;
    delete token.word_type;
    delete token.word_position;
  }
  return result;
};
