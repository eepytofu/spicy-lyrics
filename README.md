# Spicy Lyrics (tofu's fork)

A personal, source-only fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics), based mostly on [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics). It keeps the full-screen lyric experience and adds more control over lyric sources, multilingual readings, translations, and layout.

<p align="center">
  <img src="assets/乐鸣东方.avif" alt="TTML lyrics demo for 乐鸣东方" width="45%">
  <img src="assets/一梦红尘.avif" alt="Line-synced lyrics demo for 一梦红尘" width="45%">
</p>

> [!CAUTION]
> Yes, it is vibecoded and may contain some slop. I am learning by building, so read the code before relying on it or deploying the optional Worker. Maintenance happens when curiosity, free time, and the weekly coding limit are all in the same room.
>
> Japanese and Chinese lyrics and readings receive the deepest testing in this fork. Romanization for other languages remains best-effort and may have less fixture coverage.

## What this fork changes

### Added features

- **More lyric sources and explicit selection rules.** Smart Match compares track confidence, timing health, lyric agreement, and sync detail, then uses source order only to break equal-quality ties. Sync Type First and Strict Priority are also available. Every source can be enabled, disabled, and reordered.
- **Local multilingual readings.** Mandarin Pinyin, Cantonese Jyutping, Japanese romaji and furigana, Korean reading modes, and Russian or Ukrainian romanization are available. Mixed Chinese and Japanese tracks are routed line by line.
- **Separate translation lanes.** Translations supplied by the selected lyric source can be shown independently from the optional Google fallback. Google fills only uncovered lines.
- **Fork-specific controls and interop.** The settings panel adds custom installed font stacks, Han glyph variants, source diagnostics, copy formats, quick reading and translation controls, playback offset, next-track prefetching, and layout options. Compatible local extensions can read a sanitized `window.SpicyLyricsInterop` snapshot.

### Compatibility and correctness work

- **Chinese reading context survives provider timing chunks.** Timed fragments are reconstructed into line context before Mandarin conversion with the bundled Pinyin Pro engine. This improves phrase-aware readings, but polyphonic characters still depend on dictionary coverage and can have edge cases.
- **Japanese compound annotations preserve karaoke timing.** Furigana that crosses timed syllables is rendered as one annotation while the original syllables retain their timing and progression.
- **Provider translations remain provider-owned.** Source translations are normalized into their own display lane instead of being overwritten or mislabeled as generated translations.
- **Chinese-service text is normalized conservatively.** Optional Simplified, Traditional, and Japanese-form repair is limited by source and language evidence rather than being applied to every Han character line.

Built-in source support includes Spicy Lyrics, Musixmatch, Apple Music, Spotify, and LRCLIB. A self-hosted Worker adds AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, and Soda Music.

## Install from source

You need a current [Spicetify](https://spicetify.app/) installation and Node.js 22.12 or newer. This fork does not provide packaged releases.

```powershell
git clone https://github.com/eepytofu/spicy-lyrics.git
cd spicy-lyrics
npm ci
npm run build
```

Copy `dist/spicy-lyrics.js` to the Spicetify `Extensions` directory, then enable it:

```powershell
spicetify config extensions spicy-lyrics.js
spicetify apply
```

Run the same build and copy steps again after pulling new changes.

## Configure the fork

The settings panel is split into six sections:

- **Lyrics & Controls:** display modes, quick-control visibility, and copy output.
- **Languages & Readings:** Chinese, Japanese, Korean, and Cyrillic behavior.
- **Translations:** source-provided translations and the optional Google fallback.
- **Sources:** provider selection, ordering, custom servers, and next-track prefetching.
- **Appearance & Layout:** backgrounds, fonts, glyph variants, windows, and control placement.
- **Advanced:** playback offset, cache recovery, build information, and diagnostics.

Fresh settings place the lyrics view controls at the bottom. An existing saved Top or Bottom choice is preserved.

For a custom installed font stack, enable **Use System Font** and list fonts in fallback order:

```text
"SF Pro Display", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Segoe UI", sans-serif
```

**Fix Han Glyph Variants** reorders the JP/SC/TC fallbacks for each lyric line without replacing the first font in your stack.

### Optional external sources

No shared Worker URL is bundled. To use AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, or Soda Music, deploy your own Worker:

```powershell
cd worker
npm ci
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

In Spicy Lyrics, open **Settings → Sources → Lyrics Sources → Manage Sources**. Paste only the Worker origin into **External Sources Worker**, then enable and arrange the five providers. Do not append `/v1/lyrics`.

See [worker/README.md](worker/README.md) for the route contract, local development, caching, and operational caveats.

### Custom lyric servers

Custom servers are managed in the same source panel. Spicy Lyrics sends a `GET` request to:

```text
<configured-base-url>/<spotifyTrackId>?title=...&artist=...&artist_name=...&album=...&duration=...
```

The response may be native Spicy Lyrics JSON, TTML, LRC, or plain text. Native JSON is the best option when the server can preserve word timing, translations, duet roles, or background vocals. HTTPS is required except for localhost development.

## Development

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

If source changes do not appear, clear the current song caches under **Advanced**. Spotify updates or `spicetify apply` can also reset extension settings, so verify the Worker URL, source order, source toggles, font stack, and Han glyph setting before debugging the processing pipeline.

## Service, security, and license notes

Several lyric integrations use unofficial service interfaces and may stop working without warning. Lyrics and metadata can be covered by third-party terms and rights; you are responsible for how you deploy, log, use, or redistribute them.

The optional Worker is a small self-hosted compatibility proxy. It currently has open CORS and no built-in authentication or rate limiting, so review the code and add appropriate Cloudflare controls before exposing a high-traffic public deployment. See [SECURITY.md](SECURITY.md) and [worker/NOTICE.md](worker/NOTICE.md) for scope and attribution.

## Credits

- [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics): original project and renderer.
- [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics): primary fork base and lyrics-processing pipeline.
- [iPixelGalaxy/spicy-lyrics](https://github.com/iPixelGalaxy/spicy-lyrics): source-manager, custom-server, and custom-font references.
- [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource): QQ Music, KuGou, and NetEase Cloud Music compatibility reference.
- [WXRIW/Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper): provider search, matching, retrieval, and timed-lyrics parsing reference for the external-source Worker.
- [MuttonString/Furigana](https://github.com/MuttonString/Furigana) and [Hxjjxg/Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed): Japanese character-repair references for lyrics from Chinese services.
- [Kuroshiro](https://github.com/hexenq/kuroshiro), [Kuromoji.js](https://github.com/takuyaa/kuromoji.js), [Pinyin Pro](https://github.com/zh-lx/pinyin-pro), and [OpenCC.js](https://github.com/nk2028/opencc-js): local reading analysis and CJK conversion.
- [amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db): community TTML database.
- [yeahnangua/beautiful-lyrics-reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn): Worker architecture reference.
- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC): acknowledged by retained upstream compatibility code.
- [Spicetify](https://spicetify.app/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/): extension and Worker platforms.

Preserve upstream notices when redistributing modified versions.

## License

[GNU Affero General Public License v3.0](LICENSE). Individually identified derived files remain subject to their retained notices.
