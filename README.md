# Spicy Lyrics — eepytofu fork

An experimental fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics), based primarily on [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics).

This fork keeps amarinne's lyrics processing and presentation pipeline while adding configurable lyric providers, a self-hosted external-source Worker, custom system-font stacks, and the source-management interface adapted from iPixelGalaxy's fork.

> [!CAUTION]
> **Experimental vibecoded slop.** I'm just a guy with way more ideas than coding experience, using this project to mess around, learn as I go, and hopefully turn some of those ideas into something real. This isn't polished or professionally maintained. A lot of the code is AI-assisted, so there may be questionable decisions, rough edges, regressions, or bugs nobody has found yet. Please read through the code before trusting it, deploying the Worker, or using it with an account or environment you actually care about. Issues, explanations, and cleanup contributions are welcome, but don't expect guaranteed stability or support.

## What this fork adds

### Lyric sources

- Ordered, individually enabled lyric providers:
  - Spicy Lyrics community service
  - Musixmatch
  - Apple Music
  - Spotify
  - LRCLIB
  - QQ Music through the self-hosted Worker
  - Kugou through the self-hosted Worker
  - NetEase through the self-hosted Worker
- Custom lyric-server entries compatible with native Spicy Lyrics JSON, TTML, LRC, and plain text responses.
- Provider-aware caching, credits, timeouts, matching, and quality selection.
- Native Spicy Lyrics mapping for external results so word timing, provider translation, and romanization can be retained.
- A source manager for changing priority, disabling providers, configuring Musixmatch/Apple options, and adding custom servers.

The QQ, Kugou, and NetEase implementations in this repository are independent of iPixelGalaxy's NetEase implementation. Their provider-specific compatibility and parsing behavior is based primarily on ESLyric-LyricsSource and converted to Spicy Lyrics' native data model.

### Lyrics processing

- Japanese furigana and romaji.
- Japanese fallback based on the existing Kuroshiro + Kuromoji pipeline; no unpublished `japanese-lyrics-processor` package is required.
- Chinese Pinyin and Jyutping.
- Korean, Cyrillic, Greek, and Indic-script processing.
- Translation for static, line-synced, and syllable-synced lyrics.
- Preservation of official provider translations and romanizations when available.
- Mixed-language handling and processing-context-aware caching.

### Interface and appearance

- iPixel-style lyric-source cards, priority controls, expandable provider options, and modal navigation.
- Bundled Spicy Lyrics font toggle plus a custom system font-family stack.
- Flat view controls, dark-background option, copy formats, quick translation/romanization controls, and lyrics prefetching.

For a custom font stack, enable **Use System Font** and enter installed font families in fallback order:

```text
Inter, "Noto Sans CJK JP", "Segoe UI", sans-serif
```

## Install the extension

### From a release

When releases are available, download `spicy-lyrics.js` from this fork's [Releases](https://github.com/eepytofu/spicy-lyrics/releases) page.

Find the active Spicetify configuration file:

```powershell
spicetify -c
```

Copy `spicy-lyrics.js` into the `Extensions` directory next to that configuration file, then register and apply it:

```powershell
spicetify config extensions spicy-lyrics.js
spicetify apply
```

### Build from source

Node.js 20 or newer is recommended.

```powershell
git clone https://github.com/eepytofu/spicy-lyrics.git
cd spicy-lyrics
npm install
npm test
npm run build
```

The production bundle is written to `dist/spicy-lyrics.js`. Copy it to the Spicetify `Extensions` directory and run the registration commands above.

## Self-host the external-source Worker

This repository intentionally does **not** provide or embed a shared Worker URL. Anyone enabling QQ Music, Kugou, or NetEase must deploy their own Worker instance.

You need a Cloudflare account and Node.js 20 or newer:

```powershell
cd worker
npm install
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Wrangler will print an origin similar to:

```text
https://spicy-lyrics-external-sources.<your-subdomain>.workers.dev
```

In Spotify, open:

```text
Spicy Lyrics Settings → Lyrics → Manage Sources
```

Paste only the Worker origin into **External Sources Worker**, then enable and prioritize QQ Music, Kugou, and NetEase. Do not append `/v1/lyrics` to the configured origin.

The Worker exposes:

```text
GET /v1/lyrics/qq/:spotifyTrackId
GET /v1/lyrics/kugou/:spotifyTrackId
GET /v1/lyrics/netease/:spotifyTrackId
```

The extension supplies `title`, repeated `artist_name`, `album`, and `duration` query parameters. Successful responses use native Spicy Lyrics `Static`, `Line`, or `Syllable` JSON.

See [worker/README.md](worker/README.md) for local development, route examples, and troubleshooting.

## Custom lyric servers

Custom servers are configured separately from the bundled Worker providers. The extension requests:

```text
GET <server-origin-or-base-path>/:spotifyTrackId
```

Track metadata is added as query parameters. A server may return:

- Native Spicy Lyrics JSON directly.
- A JSON object containing a `lyrics` value.
- TTML.
- LRC or plain-text lyrics.

Native JSON is recommended when word timing, translations, background vocals, or romanization must be preserved.

## Development and verification

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

Live provider tests make real requests and are opt-in:

```powershell
$env:LIVE_PROVIDER_TESTS = "1"
npm test
```

## Legal, service, and privacy notice

- This software is provided without warranty. The maintainers do not guarantee provider availability, response accuracy, or continued compatibility.
- QQ Music, Kugou, NetEase, Musixmatch, Apple Music, Spotify, and other integrations may use undocumented or unofficial endpoints. Those services can change or block the integrations at any time.
- The Worker contains provider-specific compatibility code for interpreting upstream lyric payloads. Its inclusion does not grant rights to access a service, redistribute lyrics, or violate a provider's terms.
- Before using or operating the Worker, review the applicable laws, service terms, copyright rules, and data-protection requirements in your jurisdiction. You are responsible for how and where you deploy it.
- Song lyrics and associated metadata may be copyrighted by their respective owners. Do not publish, archive, or redistribute content unless you have the necessary permission.
- Enabled providers receive track metadata such as title, artist, album, duration, and Spotify track identifier. A self-hosted Worker operator is responsible for its logs, observability settings, retention, access controls, and privacy disclosures.
- Do not treat this section as legal advice. If you plan to operate a public or commercial service, obtain qualified legal review.

### Source-availability obligations

This repository is licensed under the GNU Affero General Public License v3.0. Some Worker code is adapted from GPLv3-licensed ESLyric-LyricsSource and retains its individual source notice.

If you modify and deploy the Worker for others to use over a network, review the AGPLv3/GPLv3 obligations carefully. In particular, preserve copyright and license notices and make the complete corresponding source for the deployed version available as required by the applicable licenses.

See [LICENSE](LICENSE) and [worker/NOTICE.md](worker/NOTICE.md).

## Credits and lineage

This fork exists because of work from multiple projects:

- [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics) — original Spicy Lyrics project and renderer.
- [amarinne/spicy-lyrics](https://github.com/amarinne/spicy-lyrics) — primary fork base, processing pipeline, romanization, translation, and interface features.
- [iPixelGalaxy/spicy-lyrics](https://github.com/iPixelGalaxy/spicy-lyrics) — external-source orchestration, custom-server work, custom-font concepts, and source-manager interface reference.
- [Robotxm/ESLyric-LyricsSource](https://github.com/Robotxm/ESLyric-LyricsSource) — primary reference for QQ, Kugou, and NetEase provider compatibility and parsing behavior.
- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC) — acknowledged by the retained upstream ESLyric compatibility module.
- [yeahnangua/beautiful-lyrics-reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn) — external lyrics-server architecture reference.
- [surfbryce/beautiful-lyrics](https://github.com/surfbryce/beautiful-lyrics) — upstream Beautiful Lyrics project lineage.
- [Spicetify](https://spicetify.app/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/) — extension and Worker platforms.

Credits describe technical lineage only; they do not imply endorsement of this fork. Please preserve the upstream notices when redistributing modified versions.

## License

[GNU Affero General Public License v3.0](LICENSE). Individually identified derived files remain subject to their retained notices.
