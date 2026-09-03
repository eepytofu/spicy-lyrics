import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");
const chooser = readSource("../src/components/ReactComponents/LyricsChooser.tsx");
const page = readSource("../src/components/Pages/PageView.ts");
const icons = readSource("../src/components/Styling/Icons.ts");
const sources = readSource(
  "../src/components/ReactComponents/SettingsPanel/LyricsSourcesManager.tsx"
);
const sourcesSection = readSource(
  "../src/components/ReactComponents/SettingsPanel/SourcesSection.tsx"
);
const stores = readSource("../src/utils/stores.ts");
const css = readSource("../src/css/settings-panel.css");
const externalSources = readSource("../src/utils/Lyrics/ExternalSources.ts");
const fetchLyrics = readSource("../src/utils/Lyrics/fetchLyrics.ts");
const processedLyricsCache = readSource("../src/utils/Lyrics/ProcessedLyricsCache.ts");

test("chooser exposes compact all-provider metadata search from lyric controls", () => {
  assert.match(page, /id="ChooseLyrics"/);
  assert.match(page, /OpenChooseLyrics/);
  assert.match(icons, /ChooseLyrics:[\s\S]*<circle cx="15\.5" cy="14\.5" r="4\.5"\/>/);
  assert.match(chooser, />Title</);
  assert.match(chooser, />Artist</);
  assert.match(chooser, /requestKind === "search" \? "Searching…" : "Search"/);
  assert.match(chooser, /runCandidateRequest\("search", searchableProviders, overrides\)/);
  assert.doesNotMatch(chooser, /setProvider|provider === "all"/);
  assert.doesNotMatch(chooser, /Selection lifetime|<select/);
  assert.doesNotMatch(chooser, /"Load alternatives"/);
  assert.doesNotMatch(chooser, /sl-chooser-card/);
});

test("chooser auto-loads candidate sources and keeps manual search playback-scoped", () => {
  const loadCandidatesSource = externalSources.match(
    /export async function loadLyricsCandidates[\s\S]*?(?=\nexport async function searchLyricsCandidates)/u
  )?.[0] ?? "";
  const searchCandidatesSource = externalSources.match(
    /export async function searchLyricsCandidates[\s\S]*?(?=\nexport async function fetchLyricsFromProviders)/u
  )?.[0] ?? "";
  const foregroundSource = externalSources.match(
    /export async function fetchLyricsFromProviders[\s\S]*$/u
  )?.[0] ?? "";

  assert.match(
    chooser,
    /current\?\.ManualLyricsSelection === true \|\| localOverride \|\| !next\?\.alternativesLoaded/
  );
  assert.match(chooser, /runCandidateRequest\("initial", activeProviders\)/);
  assert.match(chooser, /manualLyricsSearchProviders/);
  assert.match(chooser, /restoredSearchOverrides\?\.title \?\? spotifyTitle/);
  assert.match(
    chooser,
    /useLyricsCandidate\([\s\S]*?record,[\s\S]*?candidateSession\?\.searchOverrides \?\? null,[\s\S]*?manualSelectionLifetime/
  );
  assert.match(
    chooser,
    /setResultFallback\(\{[\s\S]*?title: overrides\?\.title\?\.trim\(\) \|\| spotifyTitle/
  );
  assert.doesNotMatch(chooser, /const resultFallback = \{[\s\S]*?title: title\.trim\(\)/);
  assert.match(chooser, />Automatic</);
  assert.match(fetchLyrics, /fetchLyricsFromProviders\(uri, providers, session\.signal\)/);
  assert.match(
    foregroundSource,
    /nativeTitleEnrichment:\s*mode !== "strict"/u
  );
  assert.match(
    loadCandidatesSource,
    /nativeTitleEnrichment:\s*\$lyricsSelectionMode\.get\(\) !== "strict"/u
  );
  assert.match(searchCandidatesSource, /overrides:\s*normalizedOverrides/u);
  assert.doesNotMatch(searchCandidatesSource, /nativeTitleEnrichment/u);
  assert.match(externalSources, /trackInfo\(uri, overrides\)/);
  assert.doesNotMatch(sources, /Last Selection/);
});

test("manual selection lifetime is a persisted Sources setting", () => {
  assert.match(
    stores,
    /\$manualLyricsSelectionLifetime = persistAtom<LyricsOverrideLifetime>\([\s\S]*?"manualLyricsSelectionLifetime",[\s\S]*?"persistent"/
  );
  assert.match(sourcesSection, /label="Manual Selection Lifetime"/);
  assert.match(sourcesSection, /options=\{\["temporary", "persistent"\]\}/);
  assert.match(sourcesSection, /labels=\{\["This session", "Persistent"\]\}/);
  assert.match(sourcesSection, /resetLyricsCandidateOverrides\(\)/);
  assert.match(sourcesSection, /Previous manual selections reset to Auto Match/);
  assert.match(sourcesSection, /returnToAutomaticLyrics\(currentUri\)/);
  assert.match(sourcesSection, /\$manualLyricsSelectionLifetime\.set\(next\)/);
  assert.doesNotMatch(sourcesSection, /commitSourceSettingsChange/);
});

test("chooser presents an applied local override without ranking it as a provider candidate", () => {
  assert.match(chooser, /const localOverride = current\?\.LyricsOverrideKind === "local"/);
  assert.match(chooser, />Local Lyrics</);
  assert.match(chooser, /localOverride \|\| !next\?\.alternativesLoaded/);
  assert.match(
    chooser,
    /\(current\?\.ManualLyricsSelection === true \|\| localOverride\)[\s\S]*?resolvedAutomaticRecord/
  );
  assert.match(chooser, /if \(automaticOption\) void handleReturnToAuto\(\)/);
  assert.doesNotMatch(chooser, /Local Lyrics[\s\S]{0,300}confidenceLabel/);
});

test("chooser diagnostics disclose NetEase native-title discovery", () => {
  const chooser = readFileSync("src/components/ReactComponents/LyricsChooser.tsx", "utf8");
  assert.match(chooser, /netease-native-title/);
  assert.match(chooser, /via NetEase native title/);
  assert.match(chooser, /ranking match/);
});

test("chooser uses accessible compact rows instead of a clipped action table", () => {
  assert.match(css, /\.slmodal-lyricsChooser > div\s*\{[\s\S]*?width:\s*min\(664px,/u);
  assert.match(chooser, /className={`sl-chooser-result/);
  assert.match(chooser, /aria-pressed=\{selected\}/);
  assert.match(chooser, /sl-chooser-auto-badge/);
  assert.match(chooser, /candidateSession\?\.recommendedRevisionId/);
  assert.match(chooser, /<span>Current<\/span>/);
  assert.doesNotMatch(chooser, /<table>|sl-chooser-use|>Use</u);
  assert.match(css, /-webkit-line-clamp:\s*2/u);
  assert.match(css, /overflow-x:\s*hidden/u);
  assert.doesNotMatch(css, /\.sl-chooser-results table|sl-chooser-card/u);
  assert.doesNotMatch(css, /sl-chooser[^}]*880px/su);
});

test("chooser delays apply feedback without flashing a spinner", () => {
  assert.match(chooser, /const APPLY_FEEDBACK_DELAY_MS = 300/);
  assert.match(
    chooser,
    /window\.setTimeout\([\s\S]*setVisibleBusyRevisionId\(busyRevisionId\)[\s\S]*APPLY_FEEDBACK_DELAY_MS/
  );
  assert.match(chooser, /const showBusyFeedback = busy && visibleBusyRevisionId === busyRevisionId/);
  assert.match(chooser, /aria-busy=\{busy\}/);
  assert.match(chooser, /busy \? "Applying" : selected/);
  assert.match(chooser, /showBusyFeedback \? \([\s\S]*<span>Applying…<\/span>/);
  assert.doesNotMatch(chooser, /sl-chooser-spinner/);
  assert.doesNotMatch(css, /sl-chooser-spinner|sl-chooser-spin/);
});

test("chooser summarizes selector-owned confidence and gates diagnostics to developer mode", () => {
  assert.match(chooser, /const \{ signals \} = record\.assessment/);
  assert.match(chooser, /function confidenceLabel\(record: LyricsCandidateRecord\)/);
  assert.match(chooser, /record\.assessment\.signals\.confidence/);
  assert.match(chooser, /sl-chooser-confidence--\$\{record\.assessment\.signals\.confidence\}/);
  assert.match(chooser, /title=\{signalSummary\}/);
  assert.doesNotMatch(chooser, /function QualitySignals|sl-chooser-signal/);
  assert.match(chooser, /Healthy timing/);
  assert.match(chooser, /Agrees with other sources/);
  assert.doesNotMatch(chooser, /function SignalIcon|sl-chooser-current/);
  assert.doesNotMatch(chooser, /sl-chooser-actions/);
  assert.match(chooser, /automaticOption \? "Return to Automatic" : "Select"/);
  assert.doesNotMatch(chooser, /<span>Return to Automatic<\/span>/);
  assert.match(chooser, /<span className="sl-chooser-auto-badge">Automatic<\/span>/);
  assert.match(chooser, /if \(automaticOption\) void handleReturnToAuto\(\)/);
  assert.match(chooser, /chooserCandidateRecords\(records, current, resolvedAutomaticRecord\)/);
  assert.match(chooser, /displayRecords\.map\(\(record\)/);
  assert.match(chooser, /const developerMode = useStore\(\$developerMode\)/);
  assert.match(
    chooser,
    /developerMode && \(!!candidateSession\?\.failures\.length \|\| !!displayRecords\.length\)/
  );
  assert.match(chooser, /<summary>Diagnostics<\/summary>/);
  assert.match(chooser, /function groupFailures\(failures: LyricsCandidateFailure\[\]\)/);
  assert.match(chooser, />Saved override</);
  assert.match(chooser, /Restored from cache · auto lookup/);
  assert.match(
    chooser,
    /sl-chooser-diagnostics-failure[\s\S]*group\.providers\.join\(", "\)[\s\S]*group\.label/
  );
  assert.match(chooser, /function LoadingRows\(\)/);
  assert.match(
    chooser,
    /requestKind !== null && displayRecords\.length === 0\s*\?\s*\(\s*<LoadingRows \/>/
  );
  assert.match(css, /grid-template-columns:\s*minmax\(140px, 180px\) minmax\(0, 1fr\)/u);
  assert.match(
    css,
    /sl-chooser-diagnostics-failure[\s\S]*minmax\(220px, 1fr\) minmax\(100px, 140px\)/u
  );
  assert.match(
    css,
    /sl-chooser-diagnostics-failure > span:first-child[\s\S]*white-space:\s*normal/u
  );
  assert.match(css, /\.sl-chooser-footer\s*\{[\s\S]*position:\s*relative[\s\S]*display:\s*block/u);
  assert.match(css, /\.sl-chooser-diagnostics summary\s*\{[\s\S]*margin-left:\s*auto/u);
  assert.match(css, /min-height:\s*62px/u);
  assert.doesNotMatch(css, /\.sl-chooser-actions|\.sl-chooser-signals|\.sl-chooser-signal/u);
});

test("timing labels name the canonical Syllable, Line, and Static tiers", () => {
  assert.match(chooser, /type === "Syllable"\) return "Syllable"/);
  assert.match(chooser, /type === "Line"\) return "Line"/);
  assert.match(chooser, /type === "Static"\) return "Static"/);
  assert.doesNotMatch(chooser, /"(?:Word|Syllable|Line) synced"|"Plain"/u);
  assert.doesNotMatch(sources, /Word Sync|word timing/u);
});

test("manual candidates use revision storage without replacing the automatic track cache", () => {
  assert.match(fetchLyrics, /LyricsRevisionStore\.SetItem\(revision\.id, lyrics\)/);
  assert.match(
    fetchLyrics,
    /if \(options\.persistTrack !== false\) await writeProcessedLyricsCache/,
  );
  assert.match(processedLyricsCache, /processedLyricsStore\.SetItem\(trackId, lyrics\)/);
  assert.match(fetchLyrics, /persistTrack: false,[\s\S]*manualSelection: true/);
  assert.match(page, /lyricRevisionIdFromRaw/);
});
