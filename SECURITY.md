# Security policy

This repository is a personal, experimental fork distributed as source code. It does not operate a public Spicy Lyrics backend or SaaS service. The optional external-source Worker is deployed and controlled by each user.

## Supported code

Security fixes are best effort and target the current `main` branch. Old commits, local modifications, third-party lyric services, Spotify, Spicetify, and user-operated Cloudflare accounts are outside this fork's direct control.

## Reporting

First check whether the issue also exists in the relevant upstream project. If it does, use that project's private security-reporting channel so the maintainers who own the affected code can respond.

For behavior introduced by this fork, use GitHub's **Report a vulnerability** option on this repository if it is available. Otherwise, use an explicitly listed private contact method on the repository owner's GitHub profile. If neither exists, this fork currently has no guaranteed private reporting channel. Do not publish credentials, tokens, private Worker URLs, personal data, or a working exploit in a public message.

Please include the affected commit, component, reproduction conditions, likely impact, and whether the issue is inherited or fork-specific. Remove secrets and unrelated personal data from logs or screenshots.

## In-scope components

- The tracked Spicetify extension source and generated bundle behavior.
- The tracked optional Worker source when deployed from this repository.
- Fork-specific parsing, caching, settings, rendering, and interop behavior.

Provider outages, incorrect third-party lyrics, unsupported Spotify or Spicetify versions, and vulnerabilities in independently operated services should be reported to their respective owners.
