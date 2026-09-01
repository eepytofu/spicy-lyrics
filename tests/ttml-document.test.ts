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

  const lead = document.Content[0].Lead.Syllables;
  assert.equal(lead[0].Text, "時計");
  assert.equal(lead[2].Text, "二人");
  assert.equal(leadText(document.Content[0]), "時計が二人をhelloworld");

  assert.deepEqual(lead[0].ProviderRuby, [
    { Text: "とけい", StartTime: 1, EndTime: 2 },
  ]);
  assert.deepEqual(lead[2].ProviderRuby, [
    { Text: "ふたり", StartTime: 2.4, EndTime: 3.4 },
  ]);
  assert.ok(lead.every((s: any) => !("JapaneseReading" in s)));
});

test("a background vocal keeps its own group, base text, and translation", () => {
  const [line] = fixture("a-ruby-bg-translation").Content;
  assert.equal(line.Background.length, 1);
  const background = line.Background[0];
  assert.equal(background.Syllables.map((s: any) => s.Text).join(""), "消えない");
  assert.deepEqual(background.Syllables[0].ProviderRuby, [
    { Text: "き", StartTime: 4.2, EndTime: 4.6 },
  ]);
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
  assert.equal(document.ProviderLanguage, "ja");
  assert.equal(document.IncludesTranslation, true);
  assert.equal(document.IncludesRomanization, true);
  assert.equal(document.Content[0].Lead.ProviderTranslatedText, "时钟将两人");
  assert.equal(document.Content[0].Lead.ProviderTranslationLanguage, "zh-Hans");
  assert.equal(document.Content[0].Lead.ProviderRomanizedText, "tokei ga futari wo");
  assert.deepEqual(document.Content[0].Lead.ProviderTranslations, [
    { Text: "时钟将两人", Language: "zh-Hans" },
  ]);
  assert.deepEqual(document.Content[0].Lead.ProviderRomanizations, [
    { Text: "tokei ga futari wo", Language: "ja-Latn" },
  ]);
  assert.equal(document.Content[0].ProviderLineId, "L1");
  assert.equal(document.Content[0].SongPart, "Verse");
  assert.equal(document.Content[0].SongPartBlockIndex, 1);
  assert.equal(document.Content[1].ProviderLineId, "L2");
  assert.equal(document.Content[1].SongPart, "Chorus");
  assert.equal(document.Content[1].SongPartBlockIndex, 2);
});

test("word-level romanization still yields the line-level sidecar fields", () => {
  const lead = fixture("c-word-level-roman").Content[0].Lead;
  assert.equal(lead.Syllables.length, 2);
  assert.equal(lead.Syllables[0].Text, "時計");
  assert.equal(lead.ProviderRomanizedText, "tokei ga");
  assert.equal(lead.RomanizedText, lead.ProviderRomanizedText);
  assert.equal(lead.TransliteratedText, lead.ProviderRomanizedText);
  assert.deepEqual(lead.ProviderTranslations, [{
    Text: "时钟",
    Language: "zh-Hans",
    Words: [{ Text: "时钟", StartTime: 1, EndTime: 2.4, IsPartOfWord: true }],
  }]);
  assert.deepEqual(lead.ProviderRomanizations, [{
    Text: "tokei ga",
    Language: "ja-Latn",
    Words: [
      { Text: "tokei", StartTime: 1, EndTime: 2, IsPartOfWord: false },
      { Text: "ga", StartTime: 2, EndTime: 2.4, IsPartOfWord: true },
    ],
  }]);
});

test("ordered sidecar alternatives remain additive while the first nonempty display fields stay stable", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="ja" itunes:timing="Line"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="zh-Hans"><text for="L1">第一</text></translation><translation xml:lang="en"><text for="L1">first</text></translation></translations><transliterations><transliteration xml:lang="ja-Latn"><text for="L1">dai ichi</text></transliteration><transliteration xml:lang="en-Latn"><text for="L1">alternate</text></transliteration></transliterations></iTunesMetadata></metadata></head><body><div itunes:songPart="Verse"><p begin="1s" end="2s" itunes:key="L1">第一</p></div></body></tt>`);
  const line = document.Content[0];
  assert.equal(line.ProviderTranslatedText, "第一");
  assert.equal(line.ProviderRomanizedText, "dai ichi");
  assert.deepEqual(line.ProviderTranslations, [
    { Text: "第一", Language: "zh-Hans" },
    { Text: "first", Language: "en" },
  ]);
  assert.deepEqual(line.ProviderRomanizations, [
    { Text: "dai ichi", Language: "ja-Latn" },
    { Text: "alternate", Language: "en-Latn" },
  ]);
});

test("a line-timed document keeps bare text nodes and its duet side", () => {
  const document = fixture("d-line-timed");
  assert.equal(document.Type, "Line");
  assert.equal(document.Content.length, 2);
  assert.equal(document.Content[0].Text, "line timed one");
  assert.equal(document.Content[0].ProviderTranslatedText, "逐行一");
  assert.equal(document.Content[1].OppositeAligned, true);
});

test("itunes timing None becomes native Static lyrics without timing fields", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="en" itunes:timing="None"><head><metadata><ttm:agent type="person" xml:id="lead"><ttm:name>Lead</ttm:name></ttm:agent></metadata></head><body><div itunes:songPart="Verse"><p itunes:key="L1" ttm:agent="lead">Hello &amp; world<span ttm:role="x-translation" xml:lang="id">Halo dunia</span></p><p itunes:key="L2">Second</p></div></body></tt>`);

  assert.equal(document.Type, "Static");
  assert.deepEqual(document.Lines.map((line: any) => line.Text), ["Hello & world", "Second"]);
  assert.equal(document.Lines[0].ProviderLineId, "L1");
  assert.equal(document.Lines[0].SongPart, "Verse");
  assert.equal(document.Lines[0].VocalAgentId, "lead");
  assert.equal(document.Lines[0].ProviderTranslatedText, "Halo dunia");
  assert.equal(document.IncludesTranslation, true);
  assert.deepEqual(document.VocalAgents, { lead: { Type: "person", Names: ["Lead"] } });
  assert.equal("Content" in document, false);
  assert.equal("StartTime" in document, false);
  assert.equal("EndTime" in document, false);
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
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body dur="00:05.000"><div begin="00:01.000" end="00:05.000"><p begin="00:01.000" end="00:02.000" ttm:agent="v1">ああ...</p><p begin="00:02.000" end="00:05.000" ttm:agent="v2">歌</p></div></body></tt>`);
  assert.ok(document);
  assert.equal(document.Content.length, 2);
  assert.equal(document.Content[0].Text ?? leadText(document.Content[0]), "ああ...");
  assert.equal(document.Content[1].OppositeAligned, true);
  assert.deepEqual(document.Content.map((line: any) => line.ProviderLineId), [undefined, undefined]);
});

test("mixed keyed and unkeyed lines keep every line without key collisions", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line"><body><div><p begin="1s" end="2s" itunes:key="spicy-local-1">first</p><p begin="2s" end="3s">second</p><p begin="3s" end="4s" itunes:key="L3">third</p></div></body></tt>`);
  assert.deepEqual(document.Content.map((line: any) => line.Text), ["first", "second", "third"]);
  assert.deepEqual(document.Content.map((line: any) => line.ProviderLineId), [
    "spicy-local-1",
    undefined,
    "L3",
  ]);
});

test("arbitrary agent identifiers retain stable alternating alignment", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line"><head><metadata><ttm:agent type="person" xml:id="alice"/><ttm:agent type="person" xml:id="bob"/><ttm:agent type="group" xml:id="choir"/></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1" ttm:agent="alice">one</p><p begin="2s" end="3s" itunes:key="L2" ttm:agent="bob">two</p><p begin="3s" end="4s" itunes:key="L3" ttm:agent="bob">three</p><p begin="4s" end="5s" itunes:key="L4" ttm:agent="choir">four</p></div></body></tt>`);
  assert.deepEqual(document.Content.map((line: any) => line.OppositeAligned), [false, true, true, false]);
});

test("an agent typed other starts on the opposite side", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line"><head><metadata><ttm:agent type="other" xml:id="aside"/><ttm:agent type="person" xml:id="lead"/></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1" ttm:agent="aside">one</p><p begin="2s" end="3s" itunes:key="L2" ttm:agent="lead">two</p></div></body></tt>`);
  assert.deepEqual(document.Content.map((line: any) => line.OppositeAligned), [true, false]);
});

test("named AMLL agents preserve every ordered name and resolve on their source lines", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line"><head><metadata><ttm:agent type="person" xml:id="solo"><ttm:name>奏</ttm:name></ttm:agent><ttm:agent type="group" xml:id="duet"><ttm:name>初音ミク</ttm:name><ttm:name>重音テト</ttm:name></ttm:agent><ttm:agent type="person" xml:id="v1"/></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1" ttm:agent="solo">one<span ttm:role="x-translation" xml:lang="zh">【奏】一</span></p><p begin="2s" end="3s" itunes:key="L2" ttm:agent="duet">two</p><p begin="3s" end="4s" itunes:key="L3" ttm:agent="v1">three</p></div></body></tt>`);

  assert.deepEqual(document.VocalAgents, {
    solo: { Type: "person", Names: ["奏"] },
    duet: { Type: "group", Names: ["初音ミク", "重音テト"] },
    v1: { Type: "person", Names: [] },
  });
  assert.deepEqual(document.Content.map((line: any) => line.VocalAgentId), ["solo", "duet", "v1"]);
  assert.deepEqual(document.Content.map((line: any) => [line.Text, line.StartTime, line.EndTime]), [
    ["one", 1, 2],
    ["two", 2, 3],
    ["three", 3, 4],
  ]);
  assert.equal(document.Content[0].ProviderTranslatedText, "【奏】一");
  assert.equal(Object.keys(document.VocalAgents).length, 3);
});

test("line-timed background vocals retain their native line tier", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Line"><body><div><p begin="1s" end="4s" itunes:key="L1">lead<span ttm:role="x-bg" begin="2s" end="3s">background<span ttm:role="x-translation" xml:lang="en">translated</span></span></p></div></body></tt>`);
  assert.equal(document.Type, "Line");
  assert.equal(document.Content[0].Text, "lead");
  assert.equal(document.Content[0].Background[0].Text, "background");
  assert.equal(document.Content[0].Background[0].StartTime, 2);
  assert.equal(document.Content[0].Background[0].EndTime, 3);
  assert.equal(document.Content[0].Background[0].ProviderTranslatedText, "translated");
});

test("a namespace-resetting div is still read", () => {
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body dur="00:03.000"><div xmlns="" begin="00:01.000" end="00:03.000"><p begin="00:01.000" end="00:03.000" ttm:agent="v1" itunes:key="L1"><span begin="00:01.000" end="00:03.000">歌</span></p></div></body></tt>`);
  assert.ok(document);
  assert.equal(document.Content.length, 1);
});

test("malformed or empty documents are rejected rather than degraded", () => {
  assert.equal(parse(`<tt xmlns="http://www.w3.org/ns/ttml"><body></body></tt>`), null);
  assert.equal(parse(`<foo><bar>hello</bar></foo>`), null);
  assert.equal(parse(""), null);
  assert.equal(parse(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>unclosed`), null);
});

test("a long authored document retains every structured ruby annotation", () => {
  const lines = Array.from({ length: 46 }, (_, index) => {
    const start = index + 1;
    const end = start + 0.5;
    return `<p begin="${start}.000" end="${end.toFixed(3)}" ttm:agent="v1" itunes:key="L${index + 1}"><span tts:ruby="container"><span tts:ruby="base">空</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="${start}.000" end="${end.toFixed(3)}">ソラ</span></span></span></p>`;
  }).join("");
  const document = parse(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body dur="50.000"><div>${lines}</div></body></tt>`);

  assert.equal(document.Content.length, 46);
  for (const [index, line] of document.Content.entries()) {
    assert.deepEqual(line.Lead.Syllables[0].ProviderRuby, [
      { Text: "ソラ", StartTime: index + 1, EndTime: index + 1.5 },
    ]);
  }
});
