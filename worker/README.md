# External-source Worker

This optional Cloudflare Worker connects Spicy Lyrics to AMLL TTML DB, QQ Music, KuGou, NetEase Cloud Music, and Soda Music.

AMLL responses stay as TTML. The other providers return native Spicy Lyrics JSON with available timing, translations, romanization, and contributor metadata.

## Deploy

You need:

- Node.js 20.19+ or 22.12+.
- A Cloudflare account with Workers enabled.
- Wrangler access to that account.

```powershell
cd worker
npm ci
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Wrangler prints the new Worker origin. To change its name, edit `name` in `wrangler.toml` before deployment.

## Connect Spicy Lyrics

1. Open **Spicy Lyrics Settings → Sources**.
2. Open **Lyrics Sources → Manage Sources**.
3. Paste the Worker origin into **External Sources Worker**. Do not append `/v1/lyrics`.
4. Enable and arrange the Worker providers.

The origin is stored locally. Do not commit a deployed URL, account identifier, or token.

## HTTP contract

All lyric routes use `GET`:

| Provider            | Route                                | Response    |
| ------------------- | ------------------------------------ | ----------- |
| AMLL TTML DB        | `/v1/lyrics/amlldb/:spotifyTrackId`  | TTML        |
| QQ Music            | `/v1/lyrics/qq/:spotifyTrackId`      | Native JSON |
| KuGou               | `/v1/lyrics/kugou/:spotifyTrackId`   | Native JSON |
| NetEase Cloud Music | `/v1/lyrics/netease/:spotifyTrackId` | Native JSON |
| Soda Music          | `/v1/lyrics/soda/:spotifyTrackId`    | Native JSON |

Required query data:

- `title`
- one or more `artist_name` values
- `duration` in seconds
- `request_version=18`

`album` is optional but can improve matching. The extension supplies these values automatically.

```text
/v1/lyrics/qq/spotify-id?request_version=18&title=Song&artist_name=Artist&album=Album&duration=240
```

Successful responses are private and `no-store` in the browser. Cloudflare's edge cache can reuse them for one hour and serve stale data for one day when the origin fails. No-match results, invalid requests, cancellations, timeouts, rate limits, and upstream failures are not cached.

Provider JSON can include `SourceMatch`, `ProviderCredits`, and `SongWriters`. `SourceMatch.discoveryEvidence` separately reports the strongest match for any requested artist and whether the provider's canonical title carries a conflicting version marker. Native lyric rows (`Lines[]`, `Content[]`, or `Content[].Lead`) can also carry an additive `ProviderInfoKind` value of `trackHeader`, `credit`, `rightsHolder`, `rightsNotice`, or `providerNotice`. The marker does not change provider text, timing, order, or source indices. Promotional provider notices are always omitted from display and copied text. Other embedded provider-info rows remain visible by default and can be hidden with the extension's **Hide Embedded Provider Info** setting. AMLL match metadata is URL-encoded in `X-Spicy-Lyrics-Match`.

The Worker returns `400` for invalid metadata, `404` for an unknown route or no safe match, `426` for a stale request contract, `429` when an upstream provider rate-limits the request, `499` after client cancellation, `504` when a provider times out, and `502` when an upstream request or response fails validation.

The Worker allows cross-origin `GET` and `OPTIONS`. It has no built-in authentication or rate limiting. Add Cloudflare controls before using it as a public high-traffic service.

## Local development

```powershell
npm run dev
```

Wrangler normally uses `http://localhost:8787`. The extension accepts HTTP only for localhost.

Before deployment, run:

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

KuGou catalog search uses an upstream HTTP endpoint. Lyric lookup and download remain HTTPS, and the request contains song metadata rather than Spotify credentials.

Provider interfaces are unofficial and can change without warning. Avoid logging response bodies, private deployment details, or user data.

## License and attribution

The Worker is part of this AGPL-3.0-only repository. See [NOTICE.md](NOTICE.md) for provider-specific attribution and retained notices.
