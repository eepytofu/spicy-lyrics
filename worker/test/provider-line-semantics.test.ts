import { describe, expect, it } from "vitest";
import { hasOrdinaryLyricContent } from "../src/provider-line-semantics";

const providerInfo = { ProviderInfoKind: "credit" };
const vocalCue = { VocalCue: { Label: "合", Form: "labelColon" } };
const ordinary = {};

const documents = (entry: Record<string, unknown>) => [
  {
    Type: "Static",
    Lines: [{ Text: "line", ...entry }],
  },
  {
    Type: "Line",
    Content: [{ Text: "line", StartTime: 1, EndTime: 2, ...entry }],
  },
  {
    Type: "Syllable",
    Content: [{
      Lead: {
        StartTime: 1,
        EndTime: 2,
        Syllables: [{ Text: "line", StartTime: 1, EndTime: 2, IsPartOfWord: false }],
        ...entry,
      },
    }],
  },
].map((lyrics) => ({
  ...lyrics,
  source: "qq",
  fetchProvider: "qq",
  sourceDisplayName: "QQ Music",
}) as any);

describe("provider-line admissible content", () => {
  it("requires ordinary lyric content for every native shape", () => {
    for (const lyrics of documents(providerInfo)) expect(hasOrdinaryLyricContent(lyrics)).toBe(false);
    for (const lyrics of documents(vocalCue)) expect(hasOrdinaryLyricContent(lyrics)).toBe(false);
    for (const lyrics of documents(ordinary)) expect(hasOrdinaryLyricContent(lyrics)).toBe(true);
  });

  it("admits mixed documents without collapsing provider-info and cue semantics", () => {
    for (const [providerDocument, cueDocument, ordinaryDocument] of documents(providerInfo)
      .map((providerDocument, index) => [
        providerDocument,
        documents(vocalCue)[index],
        documents(ordinary)[index],
      ])) {
      const mixed = structuredClone(providerDocument);
      if (mixed.Type === "Static") mixed.Lines.push(cueDocument.Lines[0], ordinaryDocument.Lines[0]);
      else mixed.Content.push(cueDocument.Content[0], ordinaryDocument.Content[0]);
      expect(hasOrdinaryLyricContent(mixed)).toBe(true);
    }
  });
});
