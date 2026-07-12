// deno-lint-ignore-file no-explicit-any
import { RetrievePackage } from "../ImportPackage.ts";

RetrievePackage("Kuromoji", "1.0.0", "js").catch(() => {});

let Analyzer: any;
let initPromise: Promise<void> | undefined;

export const init = (): Promise<void> => {
  if (Analyzer !== undefined) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await RetrievePackage("Kuromoji", "1.0.0", "js");
    for (let attempt = 0; !(window as any).kuromoji && attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(window as any).kuromoji) throw new Error("Kuromoji package did not initialize");

    Analyzer = await new Promise<any>((resolve, reject) => {
      (window as any).kuromoji.builder({
        dicPath: "https://kuromoji.pkgs.spikerko.org",
      }).build((error: any, analyzer: any) => {
        if (error) reject(error);
        else resolve(analyzer);
      });
    });
  })().catch((error) => {
    initPromise = undefined;
    throw error;
  });
  return initPromise;
};

export const parse = (text = ""): Promise<any> => {
  if (text.trim() === "" || Analyzer === undefined) return Promise.resolve([]);
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
  return Promise.resolve(result);
};
