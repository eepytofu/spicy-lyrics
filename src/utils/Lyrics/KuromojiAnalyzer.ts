// deno-lint-ignore-file no-explicit-any
import { RetrievePackage } from "../ImportPackage.ts";
import { createRetryableLazyInitializer } from "./Analyzer/LazyInitializer.ts";

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

export const parse = async (text = ""): Promise<any> => {
  if (text.trim() === "") return [];
  if (Analyzer === undefined) {
    if (typeof window === "undefined") return [];
    await init();
  }
  const result = Analyzer.tokenize(text) as any[];
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
