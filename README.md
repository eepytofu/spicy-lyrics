# Spicy Lyrics (tofu's fork)

Personal, experimental fork of [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics), itself a fork of [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics). I work on this for fun when I have time, so updates and support aren't guaranteed.

<p align="center">
  <img src="assets/乐鸣东方.avif" alt="TTML lyrics demo for 乐鸣东方" width="45%">
  <img src="assets/一梦红尘.avif" alt="Line-synced lyrics demo for 一梦红尘" width="45%">
</p>

Most of my testing goes into Japanese and Chinese lyrics because that's what I actually listen to. The other romanization modes are still there, but I don't pay as much attention to them.

## Fork stuff

Lyrics:

- More lyric sources: AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, and Soda Music (requires a self-hosted Worker; see [Worker setup](worker/README.md))
- Custom lyric server support
- Translations from Chinese lyric sources, and from other sources when available (kept separate from the optional Google translation)
- Translation extensions can use the original lyrics even when readings are shown
- Contributor credits from the lyric source (when available)
- Three ways to choose lyrics: Smart Match (compares the available results and picks the best match), Sync Type First (prefers syllable, then line, then static lyrics), and Strict Priority (uses the first usable result in source order)
- Enable, disable, and reorder sources, with details about why a result was picked

Readings:

- Local Mandarin Pinyin with Pinyin Pro's complete dictionary for better word coverage and contextual pronunciations
- Switch Chinese lyrics between Simplified and Traditional
- Optional word-based Pinyin spacing, which keeps syllables together when they form one detected Mandarin word
- Better handling for lyrics that mix Chinese and Japanese: readings are chosen per line instead of treating the whole song as one language, and mixed lines can use both Pinyin and Japanese readings
- Japanese character repair for lyrics from Chinese services, so forms such as `梦见ては` display as `夢見ては`
- Japanese lyrics can include reading hints such as `天(そら)`. The parenthetical `そら` is hidden from the main line, then used locally as furigana and as the basis for romaji. Source-provided readings use a different color from inferred ones.

UI:

- Tidier settings, grouped into six sections with search and filters
- Show or hide the Google translation button
- Custom fonts from your system
- Japanese and Chinese versions of the same Han character can look wrong when the wrong regional font is used. This fork picks a matching Japanese, Simplified Chinese, or Traditional Chinese fallback for each lyric line. Read more: [Han unification](https://heistak.github.io/your-code-displays-japanese-wrong/).

To use a custom stack, enable **Use System Font** and enter installed fonts in **Font Family Stack**, from first choice to fallback:

```text
"Inter", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif
```

Replace `Inter` with your preferred installed font. **Fix Han Glyph Variants** keeps that first font, then puts the installed Noto JP/SC/TC fallbacks in the right order for each lyric line.

## Install from source

There are no packaged releases, so install it from source. You need [Spicetify](https://spicetify.app/) and Node.js 20.19+ or 22.12+.

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

After pulling updates, rebuild and copy the extension again.

## External sources

No shared Worker URL is included. Follow [Worker setup](worker/README.md) to deploy your own.

Open **Settings → Sources → Lyrics Sources → Manage Sources**. Paste only the Worker origin into **External Sources Worker**, then enable and arrange the providers. Do not append `/v1/lyrics`.

<details>
<summary><strong>Custom lyric server contract</strong></summary>

Custom servers use the same source panel. Spicy Lyrics sends a `GET` request to:

```text
<configured-base-url>/<spotifyTrackId>?title=...&artist=...&artist_name=...&album=...&duration=...
```

The response can be native Spicy Lyrics JSON, TTML, LRC, or plain text. Native JSON can preserve word timing, translations, duet roles, and background vocals. HTTPS is required except for localhost development.

</details>

<details>
<summary><strong>Development checks</strong></summary>

Extension:

```powershell
npm test
npm run lint
npm run build
```

Worker:

```powershell
cd worker
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

If source changes do not appear, clear the current song caches under **Advanced**. Spotify updates or `spicetify apply` can reset extension settings, so check the Worker URL, source order, source toggles, font stack, and Han glyph setting before debugging.

</details>

## Service, security, and license notes

Some lyric sources use unofficial interfaces and may stop working. Lyrics and metadata can also have their own terms or rights. You are responsible for how you deploy, log, use, or redistribute them.

The optional Worker has open CORS and no built-in authentication or rate limiting. Review the code and add suitable Cloudflare controls before using it for a public, high-traffic deployment. See [SECURITY.md](SECURITY.md) and [worker/NOTICE.md](worker/NOTICE.md) for scope and attribution.

<details>
<summary><strong>Credits and references</strong></summary>

- [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics): original project and renderer.
- [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics): direct fork base and lyrics-processing pipeline.
- [iPixelGalaxy/spicy-lyrics](https://github.com/iPixelGalaxy/spicy-lyrics): source-manager, custom-server, and custom-font references.
- [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource): QQ Music, KuGou, and NetEase Cloud Music compatibility reference.
- [WXRIW/Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper): provider search, matching, retrieval, and timed-lyrics parsing reference for the Worker.
- [MuttonString/Furigana](https://github.com/MuttonString/Furigana) and [Hxjjxg/Furigana-api-fixed](https://github.com/Hxjjxg/Furigana-api-fixed): Japanese character-repair references for lyrics from Chinese services.
- [Kuroshiro](https://github.com/hexenq/kuroshiro), [Kuromoji.js](https://github.com/takuyaa/kuromoji.js), [Pinyin Pro](https://github.com/zh-lx/pinyin-pro), and [OpenCC.js](https://github.com/nk2028/opencc-js): local reading analysis and CJK conversion.
- [amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db): community TTML database.
- [yeahnangua/beautiful-lyrics-reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn): Worker architecture reference.
- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC): acknowledged by retained upstream compatibility code.
- [Spicetify](https://spicetify.app/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/): extension and Worker platforms.

Keep upstream notices when redistributing modified versions.

</details>

## License

[GNU Affero General Public License v3.0](LICENSE). Individually identified derived files keep their retained notices.
