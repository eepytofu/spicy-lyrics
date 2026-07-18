# Worker attribution and source notices

This file summarizes project-specific attribution. It does not replace the repository [LICENSE](../LICENSE), dependency license metadata, or notices retained in individual source files.

## ESLyric LyricsSource

The QQ Music QRC compatibility module at `src/crypto/qrc-eslyric.ts` is adapted from [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource) and retains its upstream GPL-3.0 notice. The Worker also used that project as the primary compatibility reference for QQ Music, KuGou, and NetEase Cloud Music behavior.

A copy of GPLv3 is included at [LICENSES/GPL-3.0-only.txt](LICENSES/GPL-3.0-only.txt).

## Lyricify Lyrics Helper

The staged metadata-query ladder and candidate-assessment design in `src/providers/shared.ts`, grouped QQ Music result handling, and KuGou catalog-first hash-bound lyric lookup are adapted from [WXRIW/Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper), Copyright 2023 XY Wang (WXRIW), under the Apache License 2.0. The Spicy Lyrics implementation adds independent scoring, diagnostics, artist splitting, album evidence, version-conflict safeguards, cover-safety gates, and an HTTPS KuGou catalog request.

A copy of Apache License 2.0 is included at [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

## Beautiful Lyrics lineage

The service layout was informed by [Beautiful Lyrics Reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn) and its [Beautiful Lyrics](https://github.com/surfbryce/beautiful-lyrics) lineage. Provider matching, parsing, and conversion in this Worker were implemented for Spicy Lyrics' own data model.

## AMLL TTML Database

The AMLL route retrieves community lyric files from [amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db) and related public mirrors. Lyric files and imported material can have terms or rights separate from this Worker's source-code license. Review the database's current notices and the original material before redistributing fetched content.

## Dependencies and fetched data

Runtime and development dependencies retain their own licenses as recorded by their packages and lockfiles. Lyrics, translations, romanization, contributor names, and other metadata returned by external services are not relicensed by this repository.
