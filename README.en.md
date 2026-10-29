# Whospost

[中文](README.md) | **English**

See at a glance whether a Threads account looks off.

- Website: <https://whospost.felixlai.workers.dev>
- Chrome extension "Whospost: 假帳號照妖鏡": [Chrome Web Store](https://chromewebstore.google.com/detail/dmnleigohhkcfniapoblagpaecfnoeen)

Paste a public Threads profile link, or type `@handle`. Whospost fetches the account's recent public posts and its own replies, and sorts them into six behavioral clues you can check one by one. Every clue links back to the original Threads post; the judgment is yours.

> This is not a "troll probability", and Whospost never labels anyone a troll or paid account. Fans, support staff and friends chatting can match a few clues; 0 clues does not mean the account is fine. Clues without enough data are marked "not enough data" and not counted.

## The six clues

The result page shows "Suspicious signs N / 6"; each clue present counts as 1:

1. Repeated posts: half or more of the posts are the same or similar.
2. Repeated or empty replies: the same reply more than 5 times, or 80% or more of replies are 4 characters or fewer.
3. Concentrated replies: replies on more than 10 different posts, with over half going to one author.
4. Thread flooding: at least 11 replies under the same post.
5. Mutual concentration: this account and the account it replies to most each give the other over half of their replies.
6. Rapid-fire replies: at least 3 replies under the same post within 10 seconds of each other.

Two more are shown but not scored: an AI behavior reading (Gemini writes an observation summary from the same evidence; Claude Sonnet takes over when Gemini refuses; on for the public site, off by default when self-hosting) and related [Cofacts](https://cofacts.tw/) fact-checks. Full thresholds and rationale: [SCORING.md](SCORING.md) (Chinese).

## Browser extension

With the extension installed, keep scrolling Threads as usual:

- **Results beside names**: accounts Whospost has checked show the clues they match next to their name, e.g. "many repeated replies". Click for the reading, then "see all evidence" to jump to the original posts.
- **Not checked yet? Press "AI 打詐"**: one click beside the name runs a check and labels it when done, 10 per hour. Whoever runs a check, every user sees the result.
- **Block and report without menus**: block is clicked through for you; report only opens Threads' own report dialog, and you pick the reason and submit.
- **Account background** (needs a Threads login): a country flag and how long ago the account joined, so new accounts stand out.
- **Your tally**: click the Whospost icon in the browser to see how many accounts you checked and blocked.

Normal browsing sends no account data; matching happens on your computer. Only pressing "AI 打詐" sends that one account. Development, tests and packaging: [extension/README.md](extension/README.md) (Chinese).

## Run locally

Needs Node 24+ and an Apify API token (paid).

```sh
npm run setup
python3 scripts/setup-token.py   # enter the Apify token securely; written to .env.local
npm run build
npm test
npm start
```

Open http://127.0.0.1:8788 . Tokens and keys are read only from environment variables or `.env.local`; `.env*` is in `.gitignore`. Never put them in the frontend or commit them.

## Deploy to Cloudflare

The public site runs on Cloudflare Workers, and the free plan is enough to start: `npx wrangler login`, set the secrets (Apify, AI keys, Turnstile), create the R2 bucket, then `npm run deploy`. Full steps, every environment variable, architecture, spending caps and rate limits, nightly backups, admin endpoints, analytics, the extension's API and costs are in [docs/OPERATIONS.md](docs/OPERATIONS.md) (Chinese).

## Limitations

- Only the public content visible at fetch time, not the full history.
- Thresholds are explainable provisional values, not yet calibrated against human-labeled data.
- No analysis of political stance, named people or media outlets, and no "troll list".

## Data sources and license

Data comes from a Threads scraper actor on Apify, Cloudflare Browser Rendering, Cofacts, the Gemini and Claude APIs, the invade wording dictionary and more; the full list and each license are in [data/SOURCES.md](data/SOURCES.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md#11-資料來源與第三方授權).

Whospost's own code is licensed under [Apache License 2.0](LICENSE): free to use, modify, fork, redistribute and use commercially, including closed-source variants; redistribution must include the license, keep notices and mark modified files. Non-profit operation is the project's direction, not a restriction on users. Third-party packages and data sources keep their own licenses; API keys, local databases and raw scraped data are not part of the public release, and self-hosters bring their own credentials and pay their own costs; this license grants no trademark rights to the Whospost name or logo. Questions via Issues and contributions via Pull Requests are welcome; contributions are under Apache 2.0 unless agreed otherwise.
