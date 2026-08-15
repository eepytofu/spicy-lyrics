import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { parseTtmlDocument } from "../src/utils/Lyrics/TtmlDocument.ts";

// Node has no DOMParser; the browser supplies its own.
const parse = (ttml: string) => parseTtmlDocument(ttml, new DOMParser() as any) as any;
const fixture = (name: string) =>
  parse(readFileSync(new URL(`./fixtures/ttml/${name}.ttml`, import.meta.url), "utf8"));

const leadText = (entry: any) => (entry.Lead?.Syllables ?? []).map((s: any) => s.Text).join("");
const allText = (document: any) => JSON.stringify(document);

test("a ruby container keeps its base text instead of dropping the whole span", () => {
  const document = fixture("a-ruby-bg-translation");
  assert.equal(document.Type, "Syllable");
  assert.equal(document.Content.length, 2);

  // The defect this replaces rendered 時計が二人を as がを.
  const lead = document.Content[0].Lead.Syllables;
  assert.equal(lead[0].Text, "時計");
  assert.equal(lead[2].Text, "二人");
  assert.equal(leadText(document.Content[0]), "時計が二人をhelloworld");

  // Ruby readings are deliberately not ingested yet, so no reading field appears.
  assert.ok(lead.every((s: any) => !("Ruby" in s) && !("JapaneseReading" in s)));
});

test("a background vocal keeps its own group, base text, and translation", () => {
  const [line] = fixture("a-ruby-bg-translation").Content;
  assert.equal(line.Background.length, 1);
  const background = line.Background[0];
  // Background wrapper parentheses are markers, not lyric text; the replaced server
  // parser stripped them the same way, verified against real AMLL documents.
  assert.equal(background.Syllables.map((s: any) => s.Text).join(""), "消えない");
  assert.equal(background.ProviderTranslatedText, "(不会消失)");
});

test("agent v2 marks the duet side and v1 does not", () => {
  const { Content } = fixture("a-ruby-bg-translation");
  assert.equal(Content[0].OppositeAligned, false);
  assert.equal(Content[1].OppositeAligned, true);
});

test("timing is carried through in seconds", () => {
  const lead = fixture("a-ruby-bg-translation").Content[0].Lead;
  assert.equal(lead.StartTime, 1);
  // The line window covers its background vocal, which runs to 5.2s.
  assert.equal(lead.EndTime, 5.2);
  assert.equal(lead.Syllables[0].StartTime, 1);
  assert.equal(lead.Syllables[0].EndTime, 2);
});

test("an authored trailing space becomes a boundary flag, never literal text", () => {
  const lead = fixture("a-ruby-bg-translation").Content[0].Lead.Syllables;
  const hello = lead.find((s: any) => s.Text === "hello");
  const world = lead.find((s: any) => s.Text === "world");
  assert.equal(hello.IsPartOfWord, false);
  assert.equal(world.IsPartOfWord, true);
  assert.ok(lead.every((s: any) => !/\s/u.test(s.Text)));
});

test("head-sidecar translations and romanizations survive", () => {
  const document = fixture("b-head-sidecar");
  assert.equal(document.IncludesTranslation, true);
  assert.equal(document.IncludesRomanization, true);
  assert.equal(document.Content[0].Lead.ProviderTranslatedText, "时钟将两人");
  assert.equal(document.Content[0].Lead.ProviderTranslationLanguage, "zh-Hans");
  assert.equal(document.Content[0].Lead.ProviderRomanizedText, "tokei ga futari wo");
});

test("word-level romanization still yields the line-level sidecar fields", () => {
  const lead = fixture("c-word-level-roman").Content[0].Lead;
  assert.equal(lead.Syllables.length, 2);
  assert.equal(lead.Syllables[0].Text, "時計");
  assert.equal(lead.ProviderRomanizedText, "tokei ga");
  assert.equal(lead.RomanizedText, lead.ProviderRomanizedText);
  assert.equal(lead.TransliteratedText, lead.ProviderRomanizedText);
});

test("a line-timed document keeps bare text nodes and its duet side", () => {
  const document = fixture("d-line-timed");
  assert.equal(document.Type, "Line");
  assert.equal(document.Content.length, 2);
  // A <p> holding a bare text node is exactly the shape that used to be dropped.
  assert.equal(document.Content[0].Text, "line timed one");
  assert.equal(document.Content[0].ProviderTranslatedText, "逐行一");
  assert.equal(document.Content[1].OppositeAligned, true);
});

test("no fixture emits a zero-width space", () => {
  for (const name of ["a-ruby-bg-translation", "b-head-sidecar", "c-word-level-roman", "d-line-timed"]) {
    assert.ok(!allText(fixture(name)).includes("​"), `${name} contains U+200B`);
  }
});

test("a word-timed document keeps a line that is only a bare text node", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body dur="00:05.000"><div begin="00:01.000" end="00:05.000"><p begin="00:01.000" end="00:02.000" ttm:agent="v1" itunes:key="L1">ああ...</p><p begin="00:02.000" end="00:05.000" ttm:agent="v1" itunes:key="L2"><span begin="00:02.000" end="00:05.000">歌</span></p></div></body></tt>`);
  assert.equal(document.Content.length, 2);
  assert.equal(leadText(document.Content[0]) || document.Content[0].Text, "ああ...");
});

test("lines without itunes:key are still read", () => {
  // AMLL's parser requires that identity; hand-authored TTML often omits it.
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body dur="00:05.000"><div begin="00:01.000" end="00:05.000"><p begin="00:01.000" end="00:02.000" ttm:agent="v1">ああ...</p><p begin="00:02.000" end="00:05.000" ttm:agent="v2">歌</p></div></body></tt>`);
  assert.ok(document);
  assert.equal(document.Content.length, 2);
  assert.equal(document.Content[0].Text ?? leadText(document.Content[0]), "ああ...");
  assert.equal(document.Content[1].OppositeAligned, true);
});

test("a namespace-resetting div is still read", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body dur="00:03.000"><div xmlns="" begin="00:01.000" end="00:03.000"><p begin="00:01.000" end="00:03.000" ttm:agent="v1" itunes:key="L1"><span begin="00:01.000" end="00:03.000">歌</span></p></div></body></tt>`);
  assert.ok(document);
  assert.equal(document.Content.length, 1);
});

test("malformed or empty documents are rejected rather than degraded", () => {
  // The replaced server parser answered these with empty or untimed documents.
  assert.equal(parse(`<tt xmlns="http://www.w3.org/ns/ttml"><body></body></tt>`), null);
  assert.equal(parse(`<foo><bar>hello</bar></foo>`), null);
  assert.equal(parse(""), null);
  assert.equal(parse(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>unclosed`), null);
});
