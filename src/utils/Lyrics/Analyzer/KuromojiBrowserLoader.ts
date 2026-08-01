import kuromoji from "kuromoji/build/kuromoji.js";

export const KUROMOJI_DICTIONARY_ROOT = "https://kuromoji.pkgs.spikerko.org/";

const DictionaryFilename = /^(?:base|check|cc|tid|tid_pos|tid_map|unk|unk_pos|unk_map|unk_char|unk_compat|unk_invoke)\.dat\.gz$/u;

export function kuromojiDictionaryUrl(requestedPath: string): string {
  const filename = requestedPath.replace(/\\/gu, "/").split("/").at(-1) || "";
  if (!DictionaryFilename.test(filename)) {
    throw new Error(`Unexpected Kuromoji dictionary filename: ${filename || "<empty>"}`);
  }
  return new URL(filename, KUROMOJI_DICTIONARY_ROOT).toString();
}

export function buildKuromojiBrowserTokenizer(): Promise<any> {
  return new Promise((resolve, reject) => {
    // kuromoji@0.1.2 joins dicPath with Node's path.join, which collapses
    // `https://` to `https:/`. Its browser build does not expose the internal
    // loader, so repair only those fixed dictionary requests while it builds.
    const xhrPrototype = XMLHttpRequest.prototype as any;
    const originalOpen = xhrPrototype.open;
    const patchedOpen = function (this: XMLHttpRequest, method: string, url: string, ...args: any[]) {
      const requestUrl = String(url);
      const dictionaryRequest = /^https:\/{1,2}kuromoji\.pkgs\.spikerko\.org\/[^/?#]+$/u.test(requestUrl);
      return originalOpen.call(
        this,
        method,
        dictionaryRequest ? kuromojiDictionaryUrl(requestUrl) : url,
        ...args
      );
    };
    const restoreOpen = () => {
      if (xhrPrototype.open === patchedOpen) xhrPrototype.open = originalOpen;
    };

    xhrPrototype.open = patchedOpen;
    try {
      kuromoji
        .builder({ dicPath: KUROMOJI_DICTIONARY_ROOT })
        .build((error: unknown, analyzer: unknown) => {
          restoreOpen();
          if (error) reject(error);
          else resolve(analyzer);
        });
    } catch (error) {
      restoreOpen();
      reject(error);
    }
  });
}
