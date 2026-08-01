import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyArabicScriptRomanizations,
  collectArabicScriptPhrases,
} from "../src/utils/Lyrics/Fork/ArabicRomanization.ts";
import {
  batchRomanizeArabicScriptPhrases,
  clearGoogleRomanizationCache,
  extractGoogleRomanization,
} from "../src/utils/Lyrics/Fork/GoogleRomanizationClient.ts";
import {
  ArabicTextTest,
  RomanizableScriptTextTest,
  scriptBranchForLine,
} from "../src/utils/Lyrics/Fork/TextDetection.ts";

const arabicScriptContext = {
  presentScripts: ["Arabic"] as const,
  primaryLanguage: "und",
};

const fetchLyricsSource = readFileSync(
  new URL("../src/utils/Lyrics/fetchLyrics.ts", import.meta.url),
  "utf8",
);
const processLyricsSource = readFileSync(
  new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url),
  "utf8",
);

test("Arabic script is routed without claiming an Arabic language or dialect", () => {
  assert.equal(ArabicTextTest.test("سيدي منصور"), true);
  assert.equal(ArabicTextTest.test("من فارسی صحبت می‌کنم"), true);
  assert.equal(ArabicTextTest.test("میں اردو بولتا ہوں"), true);
  assert.deepEqual(scriptBranchForLine("سيدي منصور ya baba", arabicScriptContext), ["Arabic"]);
  assert.deepEqual(scriptBranchForLine("rock'n'roll 2026", arabicScriptContext), []);
});

test("the shared quick gate covers every romanization branch", () => {
  for (const fixture of ["かな", "漢字", "한글", "Привет", "Αγάπη", "سيدي"]) {
    assert.equal(RomanizableScriptTextTest.test(fixture), true, fixture);
  }
  assert.equal(RomanizableScriptTextTest.test("rock'n'roll 2026"), false);
  assert.match(fetchLyricsSource, /function hasRomanizationWorkQuick[\s\S]*?RomanizableScriptTextTest\.test/u);
  assert.doesNotMatch(fetchLyricsSource, /const RomanizableScriptQuickTest/u);
});

test("Arabic phrase ownership preserves surrounding scripts and whitespace", () => {
  const text = "Αγάπη — سلام dunya — من فارسی صحبت می‌کنم";
  assert.deepEqual(collectArabicScriptPhrases(text), ["سلام", "من فارسی صحبت می‌کنم"]);
  const readings = new Map([
    ["سلام", "salam"],
    ["من فارسی صحبت می‌کنم", "man farsi sohbat mikonam"],
  ]);
  assert.equal(
    applyArabicScriptRomanizations(text, readings),
    "Αγάπη — salam dunya — man farsi sohbat mikonam",
  );
});

test("Google romanization response reads the dt=rm lane", () => {
  assert.equal(
    extractGoogleRomanization([[[null, null, null, "biduef 'awaa wa'ana janabah wabasalam ealayh"]]]),
    "biduef 'awaa wa'ana janabah wabasalam ealayh",
  );
  assert.equal(extractGoogleRomanization([[["translation", "source"]]]), "");
});

test("remote romanization requires the existing Romanization setting", () => {
  assert.match(
    processLyricsSource,
    /options\.allowRemoteRomanization === true && arabicPhrases\.length > 0/u,
  );
  assert.match(
    fetchLyricsSource,
    /allowRemoteRomanization:\s*\$romanization\.get\(\)/u,
  );
  assert.match(
    fetchLyricsSource,
    /function hasRemoteRomanizationWorkQuick[\s\S]*?ArabicTextTest\.test[\s\S]*?RemoteRomanizationAttemptVersion/u,
  );
});

test("Google Arabic-script romanization batches markers and caches exact phrases", async () => {
  clearGoogleRomanizationCache();
  let calls = 0;
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    calls += 1;
    const query = new URL(String(input)).searchParams.get("q") || "";
    assert.match(query, /\[\[SPX_000\]\]/u);
    assert.match(query, /\[\[SPX_001\]\]/u);
    return new Response(JSON.stringify([
      [[null, null, null, "[[SPX_000]] biduef 'awaa\n[[SPX_001]] wama qawltalush"]],
    ]));
  };

  const phrases = ["بضعف أوى", "وما قولتلوش"];
  const first = await batchRomanizeArabicScriptPhrases(phrases, { fetchImpl });
  assert.equal(first.get(phrases[0]), "biduef 'awaa");
  assert.equal(first.get(phrases[1]), "wama qawltalush");
  const second = await batchRomanizeArabicScriptPhrases(phrases, { fetchImpl });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});
