# External-source Worker

This optional Cloudflare Worker connects Spicy Lyrics to AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, and Soda Music. It matches Spotify track metadata against each service and returns data the extension already knows how to parse.

AMLL TTML DB responses stay as TTML. QQ Music, KuGou, NetEase Cloud Music, and Soda Music are converted to native Spicy Lyrics `Static`, `Line`, or `Syllable` JSON so timing, translations, romanization, vocal roles, and available contributor metadata can survive the round trip.

## Deploy your own Worker

Requirements:

- Node.js 22.12 or newer.
- A Cloudflare account with Workers enabled.
- Wrangler authentication for the account that will own the deployment.

```powershell
cd worker
npm ci
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Wrangler prints an origin similar to:

```text
https://spicy-lyrics-external-sources.<your-subdomain>.workers.dev
```

To use another Worker name, edit `name` in `wrangler.toml` before deployment. Custom domains can be attached later through the Cloudflare dashboard.

## Connect the extension

1. Open **Spicy Lyrics Settings → Sources**.
2. Open **Lyrics Sources → Manage Sources**.
3. Paste the Worker origin into **External Sources Worker**. Do not append `/v1/lyrics`.
4. Enable AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, or Soda Music and arrange their priority.

The extension stores the configured origin locally. Do not commit a deployed URL, account identifier, or token to this repository.

## HTTP contract

All lyric routes accept `GET` and have the same shape:

| Provider            | Route                                | Success body |
| ------------------- | ------------------------------------ | ------------ |
| AMLL TTML DB        | `/v1/lyrics/amlldb/:spotifyTrackId`  | TTML         |
| QQ Music            | `/v1/lyrics/qq/:spotifyTrackId`      | Native JSON  |
| KuGou               | `/v1/lyrics/kugou/:spotifyTrackId`   | Native JSON  |
| NetEase Cloud Music | `/v1/lyrics/netease/:spotifyTrackId` | Native JSON  |
| Soda Music          | `/v1/lyrics/soda/:spotifyTrackId`    | Native JSON  |

Required query data:

- `title`
- one or more `artist_name` values, or the legacy comma-separated `artist`
- `duration` in seconds

`album` is optional but improves matching. The extension supplies these parameters automatically.

```text
/v1/lyrics/qq/spotify-id?title=Song&artist_name=Artist&album=Album&duration=240
```

Successful responses include `Cache-Control: public, max-age=3600`. Provider JSON can include `SourceMatch` and `ProviderCredits`. AMLL TTML keeps its body unchanged and exposes match metadata through the URL-encoded `X-Spicy-Lyrics-Match` header.

Expected errors:

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| `400`  | Required metadata or the track ID is malformed.                      |
| `404`  | The route is unknown or no sufficiently close lyric match was found. |
| `502`  | An upstream lyric service failed while handling the request.         |

The Worker allows cross-origin `GET` and `OPTIONS` requests. It does not currently implement authentication or rate limiting. That is acceptable for a personal deployment you understand and monitor; add Cloudflare access or rate controls before operating it as a high-traffic public service.

## Local development

```powershell
npm run dev
```

Wrangler normally serves the Worker at `http://localhost:8787`. The extension accepts HTTP only for localhost, so set **External Sources Worker** to that origin while testing.

Run the offline test and typecheck gates before deployment:

```powershell
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

Live provider tests make real network requests and are opt-in:

```powershell
$env:LIVE_PROVIDER_TESTS = "1"
npm test
```

Provider interfaces are unofficial and may change without warning. Review the applicable service terms and avoid logging response bodies, private deployment details, or user data unnecessarily.

KuGou catalog discovery uses its upstream mobile HTTP endpoint because that hostname does not currently provide a usable HTTPS connection. The request contains only the title, artist, and album search text. Lyric retrieval remains HTTPS, and the Worker never sends Spotify credentials, cookies, or account data to KuGou.

## License and attribution

The Worker is part of the repository's AGPL-3.0-only project. Provider-specific attribution and retained third-party notices are listed in [NOTICE.md](NOTICE.md). The adapted QQ compatibility module also retains its own GPL-3.0 notice and license copy.
