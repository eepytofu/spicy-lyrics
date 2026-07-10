# Korean Ruleset Implementation Audit

| Field | Value |
| --- | --- |
| Date | 2026-07-06 |
| Scope | Korean romanization rules in desktop `spicy-lyrics` against mobile docs in `SpotifyPlus-mobilelyrics/docs` |
| Codebase | `/home/eza/Projects/spotify/spicy-lyrics` |
| Source docs | `FEATURES_DEV_SPEC.md`, `ROMANIZATION_GOLDEN_CORPUS.md`, `ROMANIZATION_REAL_CORPUS.md`, `SUBAGENT_HANDOVER_TASKS.md`, `DEFAULT_CONFIG_REFERENCE.md` |

## Summary

Desktop Korean ruleset is mostly implemented and test-backed for documented core behavior:

- Letter-by-letter Hangul romanization.
- Pronunciation-aware G2P.
- Readability spacing for common Korean phrases/endings.
- Line-scoped script gating.
- Processed-cache context key includes Korean mode.
- Translation guard rejects Korean romanization echoes.
- Vietnamese-style learner output as a separate output style (`rr` / `vn`) after spelling or pronunciation processing.
- Checklist G2P hardening for `ㅢ`, `ㄶ/ㅀ` aspiration, and `ㄷ/ㅈ + 히` palatalized aspiration.

The previous syllable-synced display risk has a desktop-side mitigation: Korean syllable lyrics now prefer group-level romanized text so full-line G2P is what the sidecar row displays.

## Implemented Rules

| Rule | Status | Evidence |
| --- | --- | --- |
| Korean spelling / letter-by-letter romanization | Implemented | `src/utils/Lyrics/Fork/Romanization.ts` `romanizeKoreanSpelling()` |
| Korean pronunciation mode | Implemented | `src/utils/Lyrics/Fork/Romanization.ts` `applyKoreanPronunciationRules()` |
| Hangul decomposition table | Implemented | `HANGUL_INITIAL`, `HANGUL_VOWEL`, `HANGUL_FINAL`, `decomposeHangul()` |
| Readable Korean spacing | Implemented | `KOREAN_FIXED_PHRASES`, `KOREAN_SPLIT_SUFFIXES`, `applyKoreanReadabilitySpacing()` |
| Settings option: Letter-by-letter / Pronunciation | Implemented | `src/components/ReactComponents/SettingsPanel/LyricsSection.tsx` |
| Persisted Korean mode | Implemented | `src/utils/uiState.ts`, `src/utils/Lyrics/lyrics.ts` |
| Processing cache key includes Korean mode | Implemented | `src/utils/Lyrics/ProcessingContext.ts` |
| Per-line script gating | Implemented | `src/utils/Lyrics/Fork/TextDetection.ts` `scriptBranchForLine()` |
| Reject romanization with residual Korean script | Implemented | `src/utils/Lyrics/ProcessLyrics.ts`, `RomanizationAcceptance.ts` |
| Translation guard rejects Korean romanization echo | Implemented | `src/utils/Lyrics/Fork/Translation.ts` |
| Korean output style `rr` / `vn` | Implemented | `src/utils/Lyrics/Fork/Romanization.ts`, `src/utils/uiState.ts`, settings UI |
| Cache key includes Korean output style | Implemented | `src/utils/Lyrics/ProcessingContext.ts` |
| `ㅢ` special handling | Implemented | `의사`, `희망`, `무늬`, `나의/너의/우리의` assertions |
| `ㅎ` cluster aspiration | Implemented | `많다`, `싫지` assertions |
| Palatalized aspiration through `히` | Implemented | `닫히다`, `맞히다` assertions |
| Real-song KR-camo coverage | Partial | Core mechanisms tested; several documented real lines are not locked as explicit assertions |

## Source Requirements

| Source | Korean rule |
| --- | --- |
| `SpotifyPlus-mobilelyrics/docs/FEATURES_DEV_SPEC.md` | Letter-by-letter mode, pronunciation G2P, liaison, nasalization, aspiration/elision, representative finals, known morphology limits |
| `SpotifyPlus-mobilelyrics/docs/ROMANIZATION_GOLDEN_CORPUS.md` | Locked cases: `한국어`, `백마`, `안녕하세요`, `해돋이`, `같이` |
| `SpotifyPlus-mobilelyrics/docs/ROMANIZATION_REAL_CORPUS.md` | Real-context cases: `뜻이`, `잃어`, `놓아`, `없지`, `없어`, `없을`, `희` |
| `SpotifyPlus-mobilelyrics/docs/SUBAGENT_HANDOVER_TASKS.md` | Korean spacing port and KR context work marked complete |
| `SpotifyPlus-mobilelyrics/docs/DEFAULT_CONFIG_REFERENCE.md` | Mobile default says Korean romanization default is Pronunciation |

## Code And Data Flow

1. Korean mode setting persists via `src/utils/uiState.ts` as `$koreanRomanizationMode`.
2. Runtime value mirrors through `src/utils/Lyrics/lyrics.ts` as `koreanRomanizationMode`.
3. Lyrics fetch starts in `src/utils/Lyrics/fetchLyrics.ts`.
4. `hasRomanizationWorkQuick()` detects Hangul through `RomanizableScriptQuickTest`.
5. `ProcessLyrics()` normalizes text through `cleanInvisibles()` and NFKC.
6. `detectPresentScripts()` builds document-level script context.
7. `scriptBranchForLine()` picks romanization branch per line.
8. Korean branch calls `romanizeKorean(text, koreanRomanizationMode)`.
9. `romanizeKorean()` applies readability spacing before romanization.
10. Spelling mode maps decomposed Hangul directly through static tables.
11. Pronunciation mode mutates jamo tuples with liaison, nasalization, lateralization, aspiration/elision, representative-final, and palatalization rules.
12. Output style maps the final jamo state through `rr` or `vn` vowel tables.
13. Output is written to `TransliteratedText` and `RomanizedText`.
14. Renderers append `RomanizedText` / `TransliteratedText` below lyric lines when romanization display is enabled.
15. Korean syllable-synced render prefers group-level romanization to preserve full-line G2P.
16. Processed lyrics cache uses `ProcessingContextKey`; Korean mode and output style changes invalidate stale processed lyrics.

## Korean Logic Details

### Spelling Mode

`romanizeKoreanSpelling()` decomposes each precomposed Hangul syllable and concatenates onset, vowel, and coda romanization.

Locked examples:

- `한국어` -> `hangukeo`
- `학교` -> `hakgyo`
- `백마` -> `baekma`
- `사랑` -> `sarang`

### Pronunciation Mode

`romanizeKoreanPronunciation()` builds contiguous Hangul runs, applies pronunciation rules, then emits romanization.

Covered mechanisms:

- Liaison into null-onset syllables.
- Palatalization before `i`.
- Representative final consonants.
- Nasalization before `n` / `m`.
- Lateralization around `ㄹ`.
- Aspiration/elision with `ㅎ`.

Locked examples:

- `한국어` -> `hangugeo`
- `백마` -> `baengma`
- `해돋이` -> `haedoji`
- `같이` -> `gachi`
- `국물` -> `gungmul`
- `독립` -> `dongnip`
- `신라` -> `silla`
- `종로` -> `jongno`
- `좋고` -> `joko`
- `좋아` -> `joa`

### Readability Spacing

`applyKoreanReadabilitySpacing()` splits long Hangul runs before romanization.

Fixed phrase splits:

- `안녕하세요` -> `안녕 하세요`
- `안녕하십니까` -> `안녕 하십니까`
- `감사합니다` -> `감사 합니다`

Suffix splits include forms such as `합니다`, `하세요`, `하십니까`, `거야`, `거죠`, `싶어`, and related endings.

Locked examples:

- `안녕하세요` -> `annyeong haseyo`
- `감사합니다` -> `gamsa hapnida`
- `텅 빈 말 더는 늘어놓지 말고` -> `teong bin mal deoneun neuleonotji malgo`

### Vietnamese-Style Output

`KoreanOutputStyle` is separate from `KoreanMode`:

- `spelling` / `pronunciation` decides whether G2P rules apply.
- `rr` / `vn` decides how final jamo state is displayed.

VN-style output maps vowels from jamo state, not by replacing existing RR strings:

- `ㅏ` -> `a`
- `ㅐ` -> `e`
- `ㅓ` -> `o`
- `ㅔ` -> `ê`
- `ㅗ` -> `ô`
- `ㅜ` -> `u`
- `ㅡ` -> `ư`
- `ㅣ` -> `i`

Compound vowels use the w/y-preserving style: `wa`, `we`, `wê`, `wo`, `wi`, `ưi`.

Locked examples:

- RR pronunciation: `어떻게` -> `eotteoke`
- VN pronunciation: `어떻게` -> `ottokê`
- RR spelling: `한국어` -> `hangukeo`
- VN spelling: `한국어` -> `hangugo`
- VN pronunciation: `백마` -> `bengma`
- VN pronunciation: `좋고` -> `jôkô`
- VN pronunciation: `좋아` -> `jôa`
- VN pronunciation: `희망` -> `himang`
- VN pronunciation: `나의` -> `nae`
- VN pronunciation: `많다` -> `manta`
- VN pronunciation: `닫히다` -> `dachida`

Note: Some prompt examples used plain `o` for syllables containing `ㅗ`, such as `독립` / `종로`. Implementation follows the explicit vowel table, so those become `dôngnip` and `jôngnô` in VN style.

## Test Evidence

Focused gates run in `/home/eza/Projects/spotify/spicy-lyrics`:

| Command | Result |
| --- | --- |
| `npm run test:romanization` | Pass, 28/28 |
| `npm run test:translation` | Pass, 7/7 |
| `npm run test:processing-context` | Pass, 6/6 |

Only warning observed: Node reparses TS as ESM because `package.json` lacks `"type": "module"`. Not Korean-specific.

## Real-Corpus Probe

Quick Korean pronunciation probe against documented KR-camo lines:

```text
숨겨진 뜻이 난 궁금해서 => sumgyeojin tteusi nan gunggeum haeseo
잃어버린 그 눈빛 => ireobeorin geu nunbi
놓아줄게 => noajulge
없지 => eopji
없어 => eopseo
없을 거야 => eopseul geoya
점점 내 모습이 희미해져 => jeomjeom nae moseubi himihaejyeo
```

These look broadly aligned with intended G2P, but they are not all explicit desktop test assertions.

## Findings

| Severity | Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- | --- |
| Low | Desktop default differs from mobile reference | Mobile `DEFAULT_CONFIG_REFERENCE.md` says Pronunciation; desktop `uiState.ts` defaults to `spelling` | Desktop/mobile parity surprise | Decide if desktop should follow mobile; change default only with migration intent |
| Low | Some real KR-camo lines not locked as desktop tests | `ROMANIZATION_REAL_CORPUS.md` lists more cases than `tests/romanization-corpus.test.ts` asserts | Future changes can regress real-song behavior | Add assertions for `숨겨진 뜻이`, `잃어버린`, `놓아줄게`, `없지/없어/없을`, `희미해져` |
| Low | Known morphology-sensitive limitations remain | Source docs list morphology/pronunciation caveat | Acceptable current scope, not full Korean phonology | Keep documented; add targeted rules only when real corpus exposes a miss |

## Conclusion

Korean ruleset is implemented at logic level and current focused tests pass. VN-style output is implemented as display mapping after the existing G2P layer. Best next hardening step is promoting more KR-camo real lines into assertions.

## 2026-07-07 update: G2P backend swapped to `korean-pronunciation` (g2pK port)

The hand-rolled jamo-level G2P rules and lexical override dictionary in the pronunciation
path were replaced by the `korean-pronunciation` npm package (JS port of Kyubyong/g2pK),
which produces pronounced Hangul before the custom RR/VN mapping and separator layers.
This adds dictionary-backed coverage for ㄴ-insertion (색연필→생년필, 꽃잎→꼰닙) and
lexical tensification that rule-only code could not converge on.

Integration constraints (verified empirically — do not regress these):

- NEVER feed a whole multi-word line to `G2p.convert` — it applies liaison across word
  spaces (호기심은 위험하단 → 호기시므 뉘험하단) and mis-tensifies in long lines (볼 수 → 뽈 수).
  Convert per-word, plus bigram joins for adnominal ㄹ + dependent noun (수/것/거/거야/게/줄/지/데…).
- NEVER feed non-Hangul text — English is transliterated into Hangul (Probably → 프라버블리).
- Do NOT use `{ descriptive: true }` — buggy (나의 → 나이).
- Custom ㅢ handling remains post-G2P (g2pK leaves 나의 unchanged; we want 나에 → nae).
- Construct `G2p` once (module-level lazy singleton); construction loads dictionaries.

RESOLVED same day: the entire `KOREAN_SEPARATOR_WORD_OVERRIDES` per-word display table
was removed. Separator hyphens are now fully rule-derived (marker kr-rule-separators-20260707-3,
LYRICS_PROCESSING_VERSION 18):

- R1: hyphen at oktjs morpheme boundary before Josa/Eomi/PreEomi/Suffix (호기심-은, 너-를, 어떻게-든).
- R2: liaison adjustment — moved coda stays with the stem (모습이→모스비→ môsưb-i, 곳은→ gôs-ưn).
- R3: hyphen before G2P-created tense onset (있게→ it-kkê, 없이→ op-ssi, 없을→ op-ssưl, 없어→ op-sso).
- R4: adnominal ㄹ + dependent-noun bigram joins with `-` (감출 수→ gamchul-ssu); 거야 stays spaced (kkoya).
- R5: no other hyphens — purely aesthetic old forms dropped (da-si→dasi, dôra-gal→dôragal,
  wihomha-dan→wihomhadan, himihejô→himihejo).

`oktjs` (Open Korean Text port) added for morphology; a bare suffix-list heuristic was rejected
because it mis-splits lexical words (나이 would become na-i). oktjs correctly keeps 나이 whole.

Bundle impact: dist grew 1.9 MB → 10.3 MB (3.4 MB gz) with korean-pronunciation + oktjs. ~5 MB is the package's English
CMU dict, unused by us (we never feed English); stub `cmudictData` via bundler alias if
parse time ever becomes a concern.

## 2026-07-07 addition: spelling block mode (learner feature)

`spelling` mode + Korean Separators ON now renders one Latin chunk per written Hangul
block, dash-joined within words (marker kr-blockmode-20260707-4, LYRICS_PROCESSING_VERSION 19):

- 엉키는 마음은 꿈에서 다 잊게 → eong-ki-neun ma-eum-eun kkum-e-seo da it-ge (RR)
- 영원처럼 안아 줘 → yong-won-cho-rom an-a jwo (VN)

Blocks are romanized in isolation to stay faithful to the written block (국 → guk even
before a vowel; 없이 → ops-i, no pronunciation transform). Implemented in
`romanizeKoreanSpellingDisplay` (Romanization.ts); separator toggle previously had no
effect in spelling mode.

## 2026-07-07 settings flattening: Korean display modes

Three layered controls (mode/style/separators) replaced by two dropdowns
(marker kr-displaymodes-20260707-5, LYRICS_PROCESSING_VERSION 20):

- Korean Display: `plain` (default) | `blocks` ("Word-by-word") | `pronunciation` ("Follow pronunciation")
- Korean Notation: `rr` | `vn` (unchanged persisted key)

Rationale: the dash means different things per mode — block boundary in word-by-word vs
liaison/sound link in follow-pronunciation — so a shared "Separators" boolean was
semantically broken. `plain` now applies the pronunciation transform (official RR is
pronunciation-based); the old untransformed spelling display was removed. Modes map onto
the unchanged low-level `romanizeKorean(text, mode, style, separators)`:
plain=(pronunciation,style,false), blocks=(spelling,style,true), pronunciation=(pronunciation,style,true).
Persisted `koreanDisplayMode` migrates from old keys (separators+pronunciation→pronunciation,
separators+spelling→blocks, else plain). Provider transliteration is now replaced
unconditionally for Korean lines.

## 2026-07-07 corpus hardening: NIKL-style ruleset table

Added `Korean NIKL-style pronunciation ruleset corpus` to `tests/romanization-corpus.test.ts`.
The active assertions cover implementation-aligned RR/VN pronunciation outputs from the supplied
rule table; 11 rows are tracked as Node TODO tests because they are accepted variants,
dictionary/morphology-sensitive, or display-policy differences rather than current green behavior.

Known TODO rows now documented in executable form:

- possessive `의` with VN `ㅔ=ê` display (`우리의→uriê`) conflicts with current possessive shortcut (`urie`).
- optional `의→이`, `ㅖ→ㅔ`, and `ㅚ→we/gwe` variants are not enabled globally.
- `앉다→안따`, `맑게→말께`, `갈 곳→갈꼳`, `눈빛→눈삗` remain backend/dictionary or morphology gaps.
- `시/시` display as `shi` is not current RR/VN policy (`시간`, `옷이`).

Fixed current lyric issue `멀리 날아가`: syllable-spaced provider text now rejoins `멀 리` and
`날 아 가` before pronunciation display, so `멀 리 날 아 가` in VN follow-pronunciation mode emits
`molli naraga` instead of leaking tokenizer spacing. Word-by-word mode still shows written block
boundaries (`mol-ri nal-a-ga`) by design.

Latest focused gate:

| Command | Result |
| --- | --- |
| `npm run test:romanization` | Pass, 30 pass / 11 TODO / 0 fail |
