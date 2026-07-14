# Spicy Lyrics external-source Worker

One Cloudflare Worker serves AMLL TTML DB, QQ Music, Kugou, and NetEase lyrics. AMLL DB is returned as TTML for Spicy Lyrics' established TTML parser; the other providers return native JSON. Word timings, duet/background-vocal roles, translations, and romanization are preserved when the source supplies them.

## Deploy

Prerequisites: Node.js 20 or newer and a Cloudflare account.

```powershell
cd worker
npm install
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://spicy-lyrics-external-sources.<your-subdomain>.workers.dev
```

To choose another Worker name, change `name` in `wrangler.toml` before deploying. A custom domain can also be attached from Cloudflare Dashboard under **Workers & Pages > your Worker > Settings > Domains & Routes**.

## Connect Spicy Lyrics

1. Open Spicy Lyrics settings.
2. Open **Lyrics > Manage Sources**.
3. Paste the Worker URL into **External Sources Worker URL**. Use only the origin; do not append `/v1/lyrics`.
4. Enable AMLL TTML DB, QQ Music, Kugou, and NetEase, then arrange their priority with the arrow buttons.

The four endpoints are:

```text
GET /v1/lyrics/amlldb/:spotifyTrackId
GET /v1/lyrics/qq/:spotifyTrackId
GET /v1/lyrics/kugou/:spotifyTrackId
GET /v1/lyrics/netease/:spotifyTrackId
```

Spicy Lyrics adds `title`, repeated `artist_name`, `album`, and `duration` (seconds) query parameters automatically. Example:

```text
/v1/lyrics/qq/spotify-id?title=Song&artist_name=Artist&album=Album&duration=240
```

The AMLL DB route returns TTML; QQ, Kugou, and NetEase return native `Static`, `Line`, or `Syllable` Spicy Lyrics JSON. A `404` means no sufficiently close match was found; a `502` means an upstream service failed.

QQ, Kugou, and NetEase include `SourceMatch` metadata for Smart Match. AMLL keeps its TTML body and exposes equivalent URL-encoded JSON through the `X-Spicy-Lyrics-Match` response header. Older Workers and custom servers remain compatible but use neutral match confidence when they provide no metadata.

Native provider JSON may also include a `ProviderCredits` array when contributor metadata is already present in the lyric response. NetEase synced-lyrics and translation entries retain their user IDs for profile links; QQ and Kugou `[by:]` entries remain plain text. This does not make an additional provider request.

## Local development

```powershell
npm run dev
```

Set the extension's Worker URL to `http://localhost:8787`. Live provider tests make real requests and are opt-in:

```powershell
$env:LIVE_PROVIDER_TESTS = "1"
npm test
```

These providers use unofficial upstream endpoints. Availability can change, and you should review the providers' terms before operating a public service.
