# Spicy Lyrics (eepytofu fork)

Experimental personal fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics), based mostly on [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics).

> [!CAUTION]
> Yes, it is vibecoded and might contain some slop. I'm still learning to code and mostly figuring things out by building them, so things may break. Read the code before relying on it or deploying the optional Worker.

## Fork stuff

Lyrics:

- Smart Match weighs track confidence, timing health, lyric agreement, sync detail, and source order. Sync Type First and Strict Priority are still available when you want predictable ordering.
- Enable, disable, and reorder lyric sources.
  - Includes Spicy Lyrics, Musixmatch, Apple Music, Spotify, LRCLIB, and custom servers, plus self-hosted AMLL TTML DB, QQ Music, Kugou, and NetEase.
- Word timing, translations, duet roles, and background vocals are kept when the source provides them.
- Japanese readings, Chinese character conversion and Pinyin/Jyutping, plus Korean, Cyrillic, and Greek romanization.
- Translation for static, line-synced, and syllable-synced lyrics, including supported Indic scripts.

UI and appearance:

- Source manager adapted from [iPixelGalaxy's fork](https://github.com/iPixelGalaxy/spicy-lyrics).
- Custom installed font-family stack.
- Han glyph variant toggle: Japanese, Simplified Chinese, and Traditional Chinese lines prefer `Noto Sans JP`, `Noto Sans SC`, and `Noto Sans TC` respectively (fuck Han unification man).
- Flat controls, Force Dark Background, copy formats, quick reading/translation controls, and next-track lyrics prefetching.

Example font stack:

```text
"SF Pro Display", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Segoe UI", sans-serif
```

Enable **Use System Font** to enter the stack. **Fix Han Glyph Variants** reorders the JP/SC/TC fallbacks for each lyric line without replacing your first font. Chinese lyrics can stay in their original form or be converted locally under **Chinese Character Form**.

## Installation

Requires [Spicetify](https://spicetify.app/). Node.js 22.6 or newer is recommended when building or testing from source.

```powershell
git clone https://github.com/eepytofu/spicy-lyrics.git
cd spicy-lyrics
npm install
npm run build
```

Copy `dist/spicy-lyrics.js` to your Spicetify `Extensions` directory, then run:

```powershell
spicetify config extensions spicy-lyrics.js
spicetify apply
```

## External lyric sources

No shared Worker URL is included. To use AMLL TTML DB, QQ Music, Kugou, or NetEase, deploy your own:

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
Spicy Lyrics Settings -> Lyrics -> Manage Sources -> External Sources Worker
```

Use only the origin. Do not append `/v1/lyrics`. Enable the sources you want and arrange them in the same panel.

See [worker/README.md](worker/README.md) for routes, local development, response formats, and troubleshooting.

Custom lyric servers can also be added under **Manage Sources**. Responses can use native Spicy Lyrics JSON, TTML, LRC, or plain text. Native JSON is recommended for word timing, translations, and vocal roles.

## Development

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

Some integrations rely on unofficial service interfaces and may stop working without warning. Lyrics and metadata may be covered by third-party terms and rights; you are responsible for how you use, deploy, log, or redistribute them.

If you modify and provide the Worker as a network service, review the source-availability and notice requirements. See [LICENSE](LICENSE) and [worker/NOTICE.md](worker/NOTICE.md).

## Credits

- [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics): original project and renderer.
- [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics): primary fork base and lyrics-processing pipeline.
- [iPixelGalaxy/spicy-lyrics](https://github.com/iPixelGalaxy/spicy-lyrics): source manager, custom servers, and custom-font reference.
- [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource): main QQ, Kugou, and NetEase compatibility reference.
- [amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db): community TTML database.
- [yeahnangua/beautiful-lyrics-reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn) and [surfbryce/beautiful-lyrics](https://github.com/surfbryce/beautiful-lyrics): server architecture and project-lineage references.
- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC): acknowledged by retained upstream compatibility code.
- [Spicetify](https://spicetify.app/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/): extension and Worker platforms.

Preserve upstream notices when redistributing modified versions.

## License

[GNU Affero General Public License v3.0](LICENSE). Individually identified derived files remain subject to their retained notices.
