# Spicy Lyrics (tofu's fork)

A personal, experimental fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics), based mostly on [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics). It keeps the full-screen lyric experience while extending source selection, multilingual readings, translations, and display controls.

<p align="center">
  <img src="assets/乐鸣东方.avif" alt="TTML lyrics demo for 乐鸣东方" width="49%">
  <img src="assets/一梦红尘.avif" alt="Line-synced lyrics demo for 一梦红尘" width="49%">
</p>

> [!CAUTION]
> Yes, it is vibecoded and may contain some slop. I am still learning by building, so read the code before relying on it or deploying the optional Worker. Maintained whenever curiosity and available time happen to overlap.

## What this fork changes

- **More lyric sources and smarter selection.** Smart Match compares track confidence, timing health, lyric agreement, sync detail, and source order. Sync Type First and Strict Priority remain available. Sources can be enabled, disabled, reordered, or added as compatible custom servers.
- **Context-aware local readings.** Mandarin uses Pinyin Pro with whole-line context reconstructed across provider timing boundaries. Japanese supports romaji, furigana, and timed compound ruby without sacrificing karaoke timing. Mixed Chinese/Japanese tracks route readings per line; Chinese form conversion, Cantonese Jyutping, Korean modes, and Cyrillic or Greek romanization are also available.
- **Translations stay in separate lanes.** Translations supplied with lyrics can be displayed independently from the optional Google fallback. Google fills only uncovered lines, while language metadata keeps appropriate glyph forms. Static, line-synced, syllable-synced, and supported Indic-script lyrics share the same translation path.
- **Provider detail is preserved.** Word timing, duet roles, background vocals, translations, and contributor metadata survive when the selected source provides them. NetEase contributors may link to their profiles; QQ Music and KuGou `[by:]` credits remain plain text.
- **Fork-specific display controls.** The settings panel includes custom installed font stacks, per-line Han glyph variants, background options, flat controls, copy formats, quick reading and translation controls, playback offset, and next-track prefetching. A read-only `window.SpicyLyricsInterop` snapshot is available for compatible local extensions.

Built-in source support includes Spicy Lyrics, Musixmatch, Apple Music, Spotify, and LRCLIB. A self-hosted Worker adds AMLL TTML DB, QQ Music, KuGou, and NetEase Cloud Music.

## Installation

Requires [Spicetify](https://spicetify.app/). Node.js 22.6 or newer is recommended when building from source.

```powershell
git clone https://github.com/eepytofu/spicy-lyrics.git
cd spicy-lyrics
npm install
npm run build
```

Copy `dist/spicy-lyrics.js` to the Spicetify `Extensions` directory, then run:

```powershell
spicetify config extensions spicy-lyrics.js
spicetify apply
```

## Settings guide

The panel is grouped around what each setting changes:

- **Lyrics & Controls:** display modes, quick-control visibility, and copy output.
- **Languages & Readings:** Chinese, Japanese, Korean, and Cyrillic behavior.
- **Translations:** source-provided translations and the optional Google fallback.
- **Sources:** provider management and next-track prefetching.
- **Appearance & Layout:** backgrounds, fonts, glyph variants, windows, and control placement.
- **Advanced:** playback offset, cache recovery, and diagnostics.

For a custom installed font stack, enable **Use System Font** and enter fonts in fallback order, for example:

```text
"SF Pro Display", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Segoe UI", sans-serif
```

**Fix Han Glyph Variants** reorders the JP/SC/TC fallbacks for each lyric line without replacing the first font. Chinese lyrics can stay in their original form or be converted locally.

<details>
<summary><strong>Optional external lyric sources</strong></summary>

No shared Worker URL is included. To use AMLL TTML DB, QQ Music, KuGou, or NetEase Cloud Music, deploy your own:

```powershell
cd worker
npm install
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Paste the resulting `workers.dev` origin into:

```text
Spicy Lyrics Settings -> Sources -> Lyrics Sources -> Manage Sources -> External Sources Worker
```

Use only the origin; do not append `/v1/lyrics`. Enable and arrange the providers in the same source manager. See [worker/README.md](worker/README.md) for routes, local development, response formats, and troubleshooting.

Compatible custom lyric servers can also be added in **Manage Sources**. Responses may use native Spicy Lyrics JSON, TTML, LRC, or plain text. Native JSON is recommended when preserving word timing, translations, and vocal roles.

</details>

<details>
<summary><strong>Development and troubleshooting</strong></summary>

Extension checks:

```powershell
npm test
npm run lint
npm run build
```

Worker checks:

```powershell
cd worker
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

If source or Worker changes do not appear, clear the current song caches under **Advanced**. Spotify or `spicetify apply` may also reset extension settings, so verify the Worker URL, source order, source toggles, font stack, and Han glyph setting before debugging the processing pipeline.

</details>

## Service and license notes

Some integrations use unofficial service interfaces and may stop working without warning. Lyrics and metadata may be covered by third-party terms and rights; you are responsible for how you deploy, log, use, or redistribute them.

If you modify and provide the Worker as a network service, review the source-availability and notice requirements in [LICENSE](LICENSE) and [worker/NOTICE.md](worker/NOTICE.md).

## Credits

- [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics): original project and renderer.
- [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics): primary fork base and lyrics-processing pipeline.
- [iPixelGalaxy/spicy-lyrics](https://github.com/iPixelGalaxy/spicy-lyrics): source-manager, custom-server, and custom-font references.
- [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource): QQ Music, KuGou, and NetEase Cloud Music compatibility reference.
- [MuttonString/Furigana](https://github.com/MuttonString/Furigana) and [Hxjjxg/Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed): Japanese character-repair behavior references for lyrics hosted by Chinese services.
- [Kuroshiro](https://github.com/hexenq/kuroshiro), [Kuromoji.js](https://github.com/takuyaa/kuromoji.js), [Pinyin Pro](https://github.com/zh-lx/pinyin-pro), and [OpenCC.js](https://github.com/nk2028/opencc-js): local reading analysis and CJK character-form normalization.
- [amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db): community TTML database.
- [yeahnangua/beautiful-lyrics-reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn): server architecture reference.
- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC): acknowledged by retained upstream compatibility code.
- [Spicetify](https://spicetify.app/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/): extension and Worker platforms.

Preserve upstream notices when redistributing modified versions.

## License

[GNU Affero General Public License v3.0](LICENSE). Individually identified derived files remain subject to their retained notices.
