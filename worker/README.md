# Spicy Lyrics external-source Worker

One Cloudflare Worker serves QQ Music, Kugou, and NetEase lyrics in Spicy Lyrics' native JSON format. Word timings, provider translations, and provider romanization are preserved when the upstream service supplies them.

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
4. Enable QQ Music, Kugou, and NetEase, then arrange their priority with the arrow buttons.

The three endpoints are:

```text
GET /v1/lyrics/qq/:spotifyTrackId
GET /v1/lyrics/kugou/:spotifyTrackId
GET /v1/lyrics/netease/:spotifyTrackId
```

Spicy Lyrics adds `title`, repeated `artist_name`, `album`, and `duration` (seconds) query parameters automatically. Example:

```text
/v1/lyrics/qq/spotify-id?title=Song&artist_name=Artist&album=Album&duration=240
```

Responses are native `Static`, `Line`, or `Syllable` Spicy Lyrics JSON. A `404` means no sufficiently close match was found; a `502` means an upstream service failed.

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
