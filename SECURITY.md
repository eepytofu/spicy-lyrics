# Security policy

This is a personal, experimental fork. It does not run a public Spicy Lyrics backend. Each user deploys and controls the optional Worker.

## Supported code

Security fixes are best effort and target the current `main` branch. Spotify, Spicetify, third-party services, old commits, local changes, and user-operated Cloudflare accounts are outside this fork's control.

## Reporting

First check whether the issue also exists upstream. If it does, use that project's private reporting channel.

For fork-specific behavior, use GitHub's **Report a vulnerability** option if it is available. Otherwise, use a private contact method listed on the repository owner's GitHub profile. If neither exists, there is no guaranteed private reporting channel.

Include the affected commit, component, reproduction steps, impact, and whether the issue is inherited. Never post credentials, tokens, private Worker URLs, personal data, or a working exploit publicly.

## In-scope components

- The Spicetify extension and its generated bundle.
- The optional Worker when deployed from this repository.
- Fork-specific parsing, caching, settings, and rendering.

Provider outages, incorrect third-party lyrics, unsupported Spotify or Spicetify versions, and vulnerabilities in independently operated services should be reported to their respective owners.
