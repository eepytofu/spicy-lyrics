import { RetrievePackage } from "../ImportPackage.ts";
import { createRetryableLazyInitializer } from "./Analyzer/LazyInitializer.ts";

export type KuromojiToken = {
  surface_form?: string;
  reading?: string;
  pronunciation?: string;
  pos?: string;
  pos_detail_1?: string;
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
    await RetrievePackage("Kuromoji", "1.0.0", "js");
    for (let attempt = 0; !(window as any).kuromoji && attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(window as any).kuromoji) throw new Error("Kuromoji package did not initialize");

    Analyzer = await new Promise<any>((resolve, reject) => {
      (window as any).kuromoji
        .builder({
          dicPath: "https://kuromoji.pkgs.spikerko.org",
        })
        .build((error: any, analyzer: any) => {
          if (error) reject(error);
          else resolve(analyzer);
        });
    });
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
