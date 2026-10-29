# Whospost

[中文](README.md) | **English**

See at a glance whether a Threads account looks off.

- Website: <https://whospost.felixlai.workers.dev>
- Chrome extension "Whospost: 假帳號照妖鏡": [Chrome Web Store](https://chromewebstore.google.com/detail/dmnleigohhkcfniapoblagpaecfnoeen) (published 2026-10-29)

Paste a link to a public Threads account (or type `@username`). Whospost fetches its recent public posts and its own replies, then lays out behavioural clues you can check one by one: whether its content repeats heavily, whether its replies are empty, whether it always replies to the same person, and whether it floods one thread or posts several replies within seconds. Every item comes with the original text as evidence, so you can judge for yourself. With the extension installed, you see these results next to repliers' names on Threads post pages.

> The result is an uncalibrated checklist of rules, not a "troll probability", and it does not mean anyone is operating the account. Fans, customer service accounts and friends chatting can all match some of the checks. Zero signs does not mean an account is normal; a check without enough data is marked "not enough data" and not counted.

The product is built for Taiwanese Threads users, so the interface and most of the documentation are in Traditional Chinese.

## What it checks

Six checks. The result page shows "suspicious signs N / 6": each sign that appears counts as one, and six cells below mark each check as present, absent, or not enough data. Full rules and thresholds are in [SCORING.md](SCORING.md) (Chinese):

1. Repeated posts: half or more of the posts have the same or similar content.
2. Repeated or empty replies: the same reply more than 5 times, or 80% or more of replies are 4 characters or fewer.
3. Focus on one author: replies on more than 10 different posts, with more than half going to the same author.
4. Flooding one thread: at least 11 replies under a single post.
5. Mutual focus: this account and the account it replies to most each give more than half of their replies to the other (both must have been checked).
6. Rapid-fire replies: under the same post, consecutive replies within 10 seconds at least 3 times.

Two more pieces of information are shown but not counted:

- Related fact-checks: [Cofacts](https://cofacts.tw/) is used to see whether posts resemble existing fact-checks. A resemblance does not mean the account spreads misinformation.
- AI behaviour reading (optional, off by default; on in production): Gemini writes an observation summary from the same evidence, and rules block any claim of intent the evidence cannot support. When Gemini refuses before billing (for example, a 429 once the Google console's monthly cap is reached), Claude Sonnet 5.5 can take over the same evidence (`WHOSPOST_AI_FALLBACK_PROVIDER`); the fallback reading is stored separately, goes through the same checks, and counts toward the same cap. A Gemini result that was already billed (including one that failed the checks) is never handed to the fallback.

## Architecture

- Production runs on Cloudflare Workers. One Worker serves the web page and the API. Data (scan results, evidence, cache, spend ledger, hourly quotas) lives in the SQLite of one Durable Object, so every "check the quota and reserve" happens in one place and cannot overspend. Each scan has its own Durable Object that waits for Apify to finish; after an interruption it resumes the same job instead of paying again.
- The preview image for a shared link (`/?scan=<id>`) is drawn as a 1200×630 PNG by another Durable Object using [workers-og](https://github.com/kvnang/workers-og), once per version, and stored in SQLite. Drawing takes about 0.1–0.7 s of CPU, more than the 10 ms of an ordinary Worker request on the free plan but within a Durable Object's limit. If it cannot be drawn, `/og.png` is used instead. The font subset is made by `scripts/og-font-subset.sh`.
- `?u=<username>` on the home page (`@username`, a username, or a profile link) pre-fills the search box without submitting it; the button still has to be pressed. An invalid value is treated as the plain home page. The browser extension opens `/?u=<username>&from=ext`.
- It also runs locally on Node.js 24 (`node:sqlite`), sharing the storage, API and scan flow code with the Worker (`server/store-core.mjs`, `server/api.mjs`, `server/scan-runner.mjs`).
- Frontend: React + Vite.
- The data source is chosen by `WHOSPOST_FETCH_PROVIDER`: `apify` (default) calls Threads scraping actors on [Apify](https://apify.com/); `hybrid` reads posts with Browser Rendering and still gets the account's own replies from the Apify replies job (about US$0.05 per scan, with a full reply sample, so no signal is limited by the logged-out cap); `browser` does everything with Cloudflare Browser Rendering (`@cloudflare/puppeteer`), opening the account's public page and its Replies tab logged out from Cloudflare's network and reading the JSON embedded in the page, about 20–30 s of browser time per scan (about US$0.001). When the browser read fails (no session, timeout, redirected to login, fewer posts than `WHOSPOST_BROWSER_MIN_POSTS`), `WHOSPOST_BROWSER_FALLBACK=apify` runs Apify instead and `fail` fails the scan. Logged out, only the latest 10 posts and about 10 of the account's own replies are visible; the result page's limitations note says how many were obtained.
- The scoring logic is in `shared/signals.mjs`, shared by frontend and backend; old results are rescored with the current rules when read.

## Running locally

You need Node 24 or later and an Apify API token (paid by you).

```sh
npm run setup
python3 scripts/setup-token.py   # enter the Apify token safely; written to .env.local (not echoed)
npm run build
npm test
npm start
```

Open http://127.0.0.1:8788 .

Tokens and keys are read only from backend environment variables or `.env.local`. `.env*` is in `.gitignore`; never put them in the frontend or commit them to Git.

## Deploying to Cloudflare

You need a Cloudflare account (the free plan is enough to start).

```sh
npm run setup
npx wrangler login
npx wrangler secret put APIFY_TOKEN
npx wrangler secret put GEMINI_API_KEY      # when WHOSPOST_AI_PROVIDER=gemini
npx wrangler secret put ANTHROPIC_API_KEY   # when WHOSPOST_AI_PROVIDER=claude, or WHOSPOST_AI_FALLBACK_PROVIDER=claude is set (the default wrangler.jsonc needs both keys)
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TURNSTILE_HOSTNAMES
npx wrangler secret put IP_HASH_SALT
npx wrangler r2 bucket create whospost-backups
npm run deploy
```

Before deploying, create a Turnstile widget in the Cloudflare dashboard with your Worker's domain (for example `whospost.<account>.workers.dev`). The site key, secret and domain are all set as secrets; `TURNSTILE_HOSTNAMES` takes the same domain, comma-separated for several, and should not include localhost in production. New scans stay paused until these are set. To test the Worker locally, copy `.dev.vars.example` to `.dev.vars` and run `npm run dev:worker`.

To deploy automatically whenever `main` changes, connect this repo under the Worker's Settings → Build (Workers Builds):

- Branch: `main`
- Build command: `npm --prefix frontend ci && npm test && npm run build` (no deploy if tests fail)
- Deploy command: `npx wrangler deploy`
- Build variables: `NODE_VERSION=24` (tests use Node's built-in SQLite); optionally `VITE_CONTACT_EMAIL` (the header's "contact the developer" button) and `VITE_SPONSOR_SLOTS` (self-run sponsor slots)
- No preview builds for other branches: Workers with Durable Objects do not support preview URLs, so pull requests are tested by GitHub Actions.

Protections on the public site:

- New scans must pass Turnstile. Each IP may make at most 5 requests a minute and at most `WHOSPOST_IP_HOURLY_SCANS` new scans an hour (counted from its first scan and reset an hour later). IPv6 counts by /64; only a salted hash is stored, never the raw IP. The whole site allows at most `WHOSPOST_GLOBAL_SCAN_RATE` new scans a minute.
- The one exception is the browser extension's "AI 打詐" button: a request from a `chrome-extension://<id>` listed in `WHOSPOST_EXTENSION_IDS` skips Turnstile (an extension page cannot run the challenge); every other gate still applies. `Origin` is whatever the client says, so this channel has its own ceiling shared across all IPs, `EXT_SCAN_RATE_LIMITER` (5 a minute, counting only requests that actually start a scan). Without that limiter bound, the channel answers 503; without `WHOSPOST_EXTENSION_IDS`, it is closed.
- Apify and AI share a daily spend cap, `WHOSPOST_DAILY_LIMIT_USD` (`0` = no daily cap, only the running totals apply), and each has a running-total cap, `WHOSPOST_APIFY_LIMIT_USD` and `WHOSPOST_AI_LIMIT_USD` (either can be `0`, leaving it to the Apify account's monthly limit and the monthly caps set in the Google / Anthropic consoles). When there is not enough budget, a new scan is refused up front, never stopped halfway.
- An account checked before is served from its saved result at no cost. From the website it still passes Turnstile and the per-IP rate limit, but it does not count toward the new-scan quota. Shared links (`GET /api/scans/:id`) are read directly without verification. The AI reading is generated once after a scan finishes and shared by everyone afterwards.
- Reads go through two cache layers. Finished results (`GET /api/scans/:id`) and preview cards (`GET /api/og/:id.png?v=`) first go through the Cloudflare Cache API (`caches.default`, shared by every isolate in one data center; results kept 10 minutes, cards 7 days per URL `v`, a new `v` being a new entry), then each isolate's own 60-second memory cache; only a miss on both reads the Durable Object. Responses carry `X-Whospost-Cache: HIT` / `MISS`. Running and missing scans are not cached; AI readings go through `/api/scans/:id/ai` and skip this layer. The Cache API works on `workers.dev`, but only within one data center, so each region fetches from the origin once.
- Before starting a new scan, the Worker reads the Apify account's actual usage this month (`GET /v2/users/me/limits`, free and read-only, cached 60 seconds per isolate). If what is left cannot cover one scan, it answers 429 `BUDGET_EXCEEDED` and the page shows the donation card; it recovers by itself within about a minute after the quota resets or more credit is added. If Apify cannot be read, the scan is allowed and the site ledger and Apify itself are the gate. `apifyMonthly` in `/api/health` shows this month's usage and limit (no token). `WHOSPOST_APIFY_USAGE_CHECK=0` turns the check off.
- `WHOSPOST_SCANS_ENABLED=0` pauses new scans at once.
- The header's "I will vote" counter (`POST /api/pledge`) has no Turnstile: one count per browser (the frontend keeps a random token; the server stores only its SHA-256, no IP, no user agent), so clearing site data allows one more. Each IP may press it 3 times a minute, the whole site `WHOSPOST_PLEDGE_GLOBAL_PER_MIN` times a minute. The number is encouragement to vote, not a statistic, and never asks who you vote for. The total, `GET /api/pledge`, is cached 60 seconds per isolate.
- An optional `ADMIN_TOKEN` enables `POST /api/admin/import`, which imports saved results exported by `scripts/export-seed.mjs` (spend ledgers are never imported).
- `POST /api/admin/scans` with `ADMIN_TOKEN` lists every scan (account, status, time, signal count, Apify spend), newest first.
- When the extension's AI 打詐 quota is used up, "查詢背景" (look up background) sends `POST /api/scans` with `savedOnly: true`: a saved result or a running scan is answered as usual; otherwise it answers 404 `NOT_SAVED` without starting a scan or spending quota.
- `POST /api/admin/requests` with `ADMIN_TOKEN` shows every scan request (account, time, answer, website or extension), including those answered from a saved result; only requests that passed verification and rate limits are logged, and no IP is stored.
- An empty result saved as "completed" although every fetch failed (older versions did this when the Apify quota ran out, and every later request for that account got the empty result) can be turned into "failed" with one call to `POST /api/admin/scans/fail-empty` with `ADMIN_TOKEN`; it returns how many were changed and their IDs. Those accounts are fetched again on their next request.
- When a scan shows "dispatch status unknown", first confirm in the Apify console that no run was started, then call `POST /api/admin/scans/<id>/release-dispatch` with `ADMIN_TOKEN` to release the reservation; the account can then be scanned again.
- To add an AI reading under the current AI provider to a saved scan (an imported seed, or a comparison after switching `WHOSPOST_AI_PROVIDER`): `POST /api/admin/scans/<id>/ai-start` with `ADMIN_TOKEN`. The public POST on the Worker only reads and never starts a paid reading.

### Nightly backup to R2

All data lives in one Durable Object, so every day at 04:00 Taipei time (cron `0 20 * * *` UTC in `wrangler.jsonc`) the Worker exports every table to the R2 bucket `whospost-backups`:

- Path `backups/YYYY-MM-DD/<table>.jsonl.gz` (Taipei date): gzip-compressed JSON Lines, one row per line, plus a `manifest.json` with each table's row count, sizes before and after compression (`bytes`, `totalBytes`), export time and `schemaVersion`. Exported tables: `scans`, `evidence`, `observations`, `analysis_runs`, `budget`, `scan_requests`, `ip_quota`, `pledges`, `ai_meta`, `ai_jobs`, `ai_attempts`, `appeals`, `ext_telemetry`, `profile_reports`. The cache and per-minute rate buckets are not backed up.
- Export reads 500 rows a page with a rowid cursor, never a whole table at once. Retention: one copy a day for the last 7 days, then only Monday's (Taipei) copy for 4 weeks, about 11 copies in all; other folders are deleted at the end of each backup. R2's free tier is 10 GB and one uncompressed export is about 50 MB and growing, so 30 daily copies are not kept. If Monday's backup fails, that week has no weekly copy.
- Create the bucket before deploying (`npx wrangler r2 bucket create whospost-backups` above); the deploy fails without it.
- To back up now: `POST /api/admin/backup` with `ADMIN_TOKEN` returns that day's manifest (including the old dates it deleted). Running it again the same day overwrites the same folder.
- To see the backups: `npx wrangler r2 object list whospost-backups --prefix backups/` (on an older wrangler without list, use the R2 page in the Cloudflare dashboard). To download: `npx wrangler r2 object get whospost-backups/backups/2026-10-22/scans.jsonl.gz --file scans.jsonl.gz`, then `gunzip scans.jsonl.gz`.
- Restoring (documented only; there is no restore script yet): the columns of `scans`, `evidence`, `observations`, `analysis_runs` and `ai_jobs` match what `POST /api/admin/import` accepts, so collect each jsonl file's lines into an array, build `{scans:[…],evidence:[…],observations:[…],analysis_runs:[…],ai_jobs:[…]}` and import it (`INSERT OR IGNORE`, existing rows are kept). `budget`, `ip_quota`, `scan_requests`, `pledges`, `ai_meta` and `ai_attempts` are ledgers and quotas that import deliberately refuses; restoring them needs a separate script writing into the Durable Object, and a full rebuild can usually skip them.

## Configuration

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `APIFY_TOKEN` | Apify API token | read from `.env.local` |
| `WHOSPOST_ENV_FILE` | Use an env file somewhere else | `./.env.local` |
| `WHOSPOST_APIFY_LIMIT_USD` | Running-total Apify spend cap (USD); new scans are refused beyond it. `0` = no site cap. Production uses `100`, well above the Apify account's monthly quota, as insurance only; the Apify account quota is what actually stops scans | `1` |
| `WHOSPOST_APIFY_USAGE_CHECK` | Worker only: `0` stops reading the Apify account's usage this month and relies on the site ledger alone | on |
| `WHOSPOST_FETCH_PROVIDER` | Worker only: `apify`, `hybrid` (posts by Browser Rendering + replies by Apify) or `browser` (all Browser Rendering); the last two need the `browser` binding in `wrangler.jsonc` | `apify` |
| `WHOSPOST_BROWSER_FALLBACK` | Worker only: when the browser read fails, `apify` (run the Apify posts job instead; needs `APIFY_TOKEN`) or `fail` (fail the scan) | `apify` |
| `WHOSPOST_BROWSER_MIN_POSTS` | Worker only: a browser read with fewer posts than this counts as failed (`0` = no check) | `1` |
| `WHOSPOST_BROWSER_POST_PAGES` | Worker only: how many post pages to open to read other people's replies (at most 3; not scored yet) | `0` |
| `WHOSPOST_COLLECTION_PROFILE` | Sample size: `standard` (10 posts / 50 replies), `standard-25` (10 / 25), `standard-20` (10 / 20, used in production now) or `acceptance-30-100` | `standard` |
| `WHOSPOST_CROSS_ACCOUNT_SEARCH` | `1` turns on the paid cross-account search | off |
| `WHOSPOST_LOCAL_COMPARISON` | `0` turns off "compare with same-period posts of accounts already in the database"; context only, never scored, but it reads thousands of rows per scan. Off in production | on |
| `WHOSPOST_LIST_ENABLED` | Worker only: `1` opens the public account list API for the browser extension (`/api/list/v1/*`, see "Public account list API" below); when off the whole group answers 404 | off |
| `WHOSPOST_EXTENSION_IDS` | Worker only: comma-separated Chrome extension IDs. When set, only these origins may read the list cross-origin and send appeals; when unset, any `chrome-extension://` origin is accepted (development). AI 打詐 (the Turnstile-free `POST /api/scans`) accepts only this list and stays closed when it is unset | — |
| `WHOSPOST_EXTENSION_BLOCK` | Worker only: the remote switch for the extension's block helper, read as `extension.block` in `/api/health`; `0` hides "封鎖此用戶" (block this user) | on |
| `WHOSPOST_SCANS_ENABLED` | Worker only: `0` pauses new scans at once; saved results can still be viewed | on |
| `WHOSPOST_IP_HOURLY_SCANS` | Worker only: new scans per network address (an IPv4 address, an IPv6 /64) per hour, counted from that address's first new scan and reset an hour later | `10` |
| `WHOSPOST_GLOBAL_SCAN_RATE` | Worker only: new scans per minute for the whole site, against rotating IPs to evade the per-IP limit; `0` = off | `20` |
| `WHOSPOST_DAILY_LIMIT_USD` | Worker only: daily spend cap shared by Apify and AI (Taipei date); `0` = none. Production uses `0`, leaving it to the Apify account's monthly quota and the Google / Anthropic consoles' monthly caps | `1` |
| `WHOSPOST_AI_ENABLED` | `1` turns on the AI behaviour reading | off |
| `GEMINI_API_KEY` | Gemini API key (`WHOSPOST_GEMINI_KEY_NAME` reads another variable name) | — |
| `WHOSPOST_AI_PROVIDER` | The model that writes AI readings: `gemini` (Gemini 3.8 Flash) or `claude` (Anthropic Messages API, model set by `WHOSPOST_AI_CLAUDE_MODEL`, default `claude-haiku-5-5`). Each has its own cache key, so old readings are kept after switching | `gemini` |
| `ANTHROPIC_API_KEY` | Anthropic API key, needed only with `WHOSPOST_AI_PROVIDER=claude` or `WHOSPOST_AI_FALLBACK_PROVIDER=claude` | — |
| `WHOSPOST_AI_FALLBACK_PROVIDER` | Worker only: the provider that takes over a reading the main provider refused before billing (Google quota reached → 429, invalid key). Only `claude` for now; the fallback reading is stored separately and shares the same spend cap. Model `WHOSPOST_AI_FALLBACK_MODEL` (default `claude-sonnet-5-5`), output cap `WHOSPOST_AI_FALLBACK_MAX_OUTPUT_TOKENS` (default `2600`; Sonnet is cut off at 1800) | off |
| `WHOSPOST_AI_LIMIT_USD` | Running-total AI spend cap (USD). `0` = no site cap: spend is still recorded and the shared daily cap still applies, but the monthly caps set in Google AI Studio / Anthropic Console decide; at the cap the provider answers 429 and the reading counts as an unbilled refusal (handed to the fallback if there is one). Production uses `0` | `0.10` |
| `WHOSPOST_AI_MAX_OUTPUT_TOKENS` | Output token cap per AI call | `1800` |
| `WHOSPOST_AI_LEDGER` | AI spend ledger path | `runtime/ai-account-ledger.sqlite` |
| `WHOSPOST_AI_BASELINE_LEDGER` | Optional: imports spend from before the ledger existed (JSON); must be readable when set | — |
| `COFACTS_APP_SECRET` | Optional: Cofacts API app secret | — |
| `WHOSPOST_DB` | Scan database path | `data/whospost.sqlite` |
| `PORT` | Backend port | `8788` |
| `GA_MEASUREMENT_ID` | Optional (Worker secret): GA4 Measurement ID such as `G-XXXXXXXXXX`. When unset, Google Analytics is not loaded and no event is sent; forks should use their own ID or leave it empty | — |
| `VITE_CONTACT_EMAIL` | Frontend build time: the header's "contact the developer" address; hidden when unset (see `frontend/.env.example`) | — |
| `VITE_SPONSOR_SLOTS` | Frontend build time: self-run sponsor slots, a JSON array. Each item has `slot` (`result_bottom`: below the share card and above the check cards on the result page / `waiting`: the scan waiting screen), `campaign` (letters, digits, `-`, `_`), `href` (https), plus either an image (`image` in `frontend/public/sponsor/` + `alt`) or text (`text` + `cta`, styled like the search bar). For example `[{"slot":"result_bottom","campaign":"acme","image":"/sponsor/acme.png","href":"https://example.com/","alt":"description"}]`. No third-party script is loaded. When unset, the built-in fundraising card (linking to whospost.bobaboba.me) is shown; forks can set `[]` to show no slot, or use their own. Malformed items are skipped | built-in fundraising card |
| `VITE_VOTE_OPEN_AT` | Frontend build time: the target of the header's election countdown (an ISO time with time zone, when polling stations open). The countdown runs in the browser on the device clock; 08:00–16:00 on election day it shows "polls open until 16:00", after 16:00 "voting has ended", and from 00:00 the next day it hides itself | `2026-11-28T08:00:00+08:00` |
| `VITE_VOTE_COUNTDOWN` | Frontend build time: `0` hides the countdown and the "I will vote" button (for forks) | on |
| `WHOSPOST_PLEDGE_GLOBAL_PER_MIN` | Site-wide "I will vote" presses per minute (`wrangler.jsonc` vars), a backstop beyond the per-IP limit; `0` = off | `300` |

## Traffic analytics (optional)

With the Worker secret `GA_MEASUREMENT_ID` set, the frontend loads GA4 only after reading the ID from `/api/health`; local runs and deployments without it send nothing. Events sent (`frontend/src/analytics.mjs`):

| Event | When | Parameters |
| --- | --- | --- |
| `search_input` | The search box first gets content (once per session) | `method`: `type` / `paste` / `example` |
| `scan_submit` | Every press of submit | `input_type`: `link` / `handle` / `bare`; `outcome`: `started` / `cached` / `rate_limited` / `quota` / `turnstile_failed` / `paused` / `error` / `invalid_input` |
| `result_view` | A finished result is seen (once per result per session) | `cached`, `signals` |
| `share_copy` | Share is pressed | `result`: `success` / `fail` |
| `nav_click` | Header GitHub, contact the developer, sponsor; the sponsor link in the out-of-quota notice | `item`: `github` / `contact` / `sponsor` / `sponsor_budget` |
| `app_error` | Loading failed (once per kind per session) | `kind` |
| `ad_impression` | A sponsor slot first comes into view (once per slot per session; none when `VITE_SPONSOR_SLOTS` is `[]`) | `slot`: `result_bottom` / `waiting`; `campaign` |
| `ad_click` | A sponsor slot is clicked | `slot`, `campaign` |
| `pledge_click` | The header's "I will vote" is pressed and the server answers 200 | `result`: `counted` (first time) / `already` (same browser again) |

Every event also carries `page_type` (`home` / `result`) and `entry_source` (the `from` of the first URL of the visit: shared links carry `from=share`, pages opened by the browser extension `from=ext`). The checked account, the scan ID, the account pre-filled by `?u=`, the full URL, IP and email are never sent; `page_location` keeps only `utm_*` parameters.

## Browser extension (`extension/`)

The Chrome extension "Whospost: 假帳號照妖鏡" 0.1.0 passed review and was [published](https://chromewebstore.google.com/detail/dmnleigohhkcfniapoblagpaecfnoeen) on 2026-10-29. On Threads post pages it shows the list's result next to each replier's name as a reason chip (3 or more signs light red, 1–2 light yellow, 0 light green "no concerns for now", checked but not enough data grey). It reads only what is already on the screen and sends no account information while you just browse:

- **AI 打詐** (AI check): only when you press it on an account not checked yet is that one username sent to the Whospost backend for a scan (see "Protections on the public site" above). 10 per network address per hour, counted from the first press and reset an hour later. When they are used up, the button becomes "查詢背景" (look up background), which only reads the account's background and fetches, for free, a result someone else already got. Results enter the public list within about 20 minutes, for every user to see.
- **Account background**: when you are logged in to Threads, the extension uses your own login to read from Threads when the authors on screen joined and where Threads says they are based, and keeps it on your device for 7 days. Only for the account you pressed AI 打詐 on are the country and joined month reported to Whospost and put on the public list (`POST /api/list/v1/profile`), so other users need not read them again. The remote switch is `extension.profileLookup` in `/api/health`.
- **Block and report helper**: after you press "封鎖此用戶" (block this user) in the popover, the extension clicks that reply's own "⋯ → Block → Confirm" for you, right on the page, one at a time, stopping at any step it cannot find; there is no batch. "檢舉此用戶" (report this user) only goes as far as "⋯ → Report", opening Threads' own report window; you choose the reason and submit it yourself. Whether the buttons appear is controlled by the production remote switch `WHOSPOST_EXTENSION_BLOCK` (`0` turns them off). Apart from these, the extension never presses a button for you.

Usage, files and tests are in [`extension/README.md`](extension/README.md) (Chinese); the spec is `100_Todo/specs/011-whospost/EXTENSION-SPEC-20261022.md`. The store package (listing text, screenshots, icons, privacy form answers) is in `extension/store/`; `npm run pack:extension` builds the zip for review.

## Public account list API (for the browser extension)

With `WHOSPOST_LIST_ENABLED=1` the Worker opens `/api/list/v1/*` for the Threads browser extension to match repliers; when off, the whole group answers 404. The list holds hashes only, never plain usernames:

- `GET /api/list/v1/export/threads-accounts.json`: the whole list, licensed CC BY-SA 4.0. The outer object is `{license, attribution, generated, version:"signals-v2", accounts:[…]}`; each account is one entry `{h, score, hits, assessed, unknown, evidence, ai, scanId, updated, appeals, followers, profile}`. `profile` is the account background reported by extension users who pressed AI 打詐, `{country, place, joined, reports}`, or `null` when none was reported. `h` is `sha256(lowercase username)`; `score` / `hits` / `assessed` / `unknown` come from the same `signalScore` as the result page; `evidence` is `rules` (at least one check hit), `ai` (there is an AI summary, including one flagged by the wording rules, Felix 10-27), `appeal` (someone pressed "trust") or `null`; `ai` keeps only the summary's first sentence with account names removed; `appeals` is only a count and never changes the score; `followers` is the follower count read from the account's public Threads profile during that scan, `null` when it was not read (Apify fetches, old scans), never written as 0 and never scored. Responses carry `ETag` and `Cache-Control: public, max-age=300` and go through the Cache API; a matching `If-None-Match` gets 304. The extension checks every 10 minutes.
- The list is cached 5 minutes in the Durable Object and 5 minutes at the edge (Felix 10-27; it was an hour each). When it expires, the row counts and latest times of four tables (scans, AI, appeals, background reports) are compared first; if nothing changed the old list is kept (same `generated` and ETag), otherwise it is rebuilt.
- `GET /api/list/v1/buckets?p=a1b2,c3d4`: up to 64 four-hex-digit prefixes, answering `{prefix:[entries]}`, also cached 5 minutes.
- `POST /api/list/v1/profile`: body `{scanId, country, place, joined}`; after you press AI 打詐, the extension reports where that account is based (ISO two-letter code, or Threads' place text when it maps to no code) and its joined month (`YYYY-MM`). Extension origins only, at most 5 a minute per IP; stored in `profile_reports` (included in the nightly backup), one row per account per network address (salted hash), the list taking the most-voted value. `POST /api/admin/profile-stats` with `ADMIN_TOKEN` shows how the listed accounts split by country, joined year and joined month (unreadable ones counted apart). The first extension version downloads the whole list and does not use buckets; that switch waits until the list passes about 50,000 entries.
- `POST /api/list/v1/appeal`: body `{h, installHash, reason?}`, the extension's "trust" button. Only `Origin: chrome-extension://<id>` is accepted (only the listed IDs when `WHOSPOST_EXTENSION_IDS` is set), at most 5 a minute per IP (the same limiter as new scans, counted separately), and one count per installation per account; stored in the `appeals` table (included in the nightly backup), shown only as a count and never changes the score.

## Costs

Each new account checked calls paid services; checking the same account again reuses the cache and is not charged again. In production (`standard-20`, `hybrid`, cross-account search off), a completed scan measured in October 2026 costs about US$0.044: about US$0.035 for fetching (almost all Apify replies) plus about US$0.009 for the AI reading (Gemini). When Gemini refuses and Sonnet 5.5 takes over, that reading costs about US$0.04, over 4 times Gemini. With `apify` and the `standard` sample (50 replies), fetching usually costs about US$0.12, at most US$0.30 a scan.

With `WHOSPOST_FETCH_PROVIDER=hybrid`, posts use about 15–25 s of Browser Rendering (US$0.002 reserved) and replies reserve the Apify replies job's `repliesCapUsd` (US$0.08 for standard-20); one scan is about US$0.05 in practice. With `browser`, a scan uses about 20–30 s of Browser Rendering: Workers Paid includes 10 hours and 10 concurrent browsers a month, then US$0.09 an hour; 300 scans a day is about US$6 a month. The ledger stays in the same table: each round reserves US$0.002 and is settled immediately from the actual seconds when it ends; `browser` in `/api/health` shows this month's (Taipei) rounds, seconds and cost. Rounds that fall back to Apify are booked the Apify way. `WHOSPOST_APIFY_LIMIT_USD` is still the running-total cap of this table.

The ledger settles against Apify's final bill: each job first reserves its cap. The scan result is shown first and the bill is confirmed in the background; until then the cap is counted, and only afterwards is the unused part released. Do not delete the database to reset the budget.

## Limitations

- Only public content at fetch time is visible, not the full history; the post a reply answers is sometimes missing.
- The thresholds are explainable provisional values, not yet calibrated against human-labelled data.
- It does not analyse political views, named people or media, and provides no "troll list". The local database is only the public records observed so far and a cache.

## Data sources and third-party licences

- [benthepythondev/threads-user-posts-scraper](https://apify.com/benthepythondev/threads-user-posts-scraper): public posts and the account's own replies (the `apify` source).
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/): the `browser` source, reading the JSON embedded in Threads' public pages logged out. Cloudflare adds a bot-identifying header to every request that cannot be removed, and Meta may block on it, so the Apify fallback is kept.
- [automation-lab/threads-scraper](https://apify.com/automation-lab/threads-scraper): cross-account search (off by default).
- [Cofacts](https://cofacts.tw/): fact-check data under CC BY-SA 4.0; results link back to the original.
- [Gemini API](https://ai.google.dev/) (Google) and [Claude API](https://docs.anthropic.com/) (Anthropic): the AI behaviour reading. When on, the public posts and replies of that scan are sent as evidence to the configured provider to write the summary; which one depends on `WHOSPOST_AI_PROVIDER` and `WHOSPOST_AI_FALLBACK_PROVIDER`. Costs and data handling follow each provider's terms; self-hosted deployments must use their own keys.
- [caris-events/invade](https://github.com/caris-events/invade): wording dictionary, text CC0, code MIT; wording is reference only and never scored.
- [workers-og](https://github.com/kvnang/workers-og): draws the preview images (MIT; includes satori and resvg-wasm, MPL-2.0).
- [Noto Sans TC](https://github.com/notofonts/noto-cjk): preview image font (subset), SIL Open Font License 1.1, see [worker/og/OFL.txt](worker/og/OFL.txt).

See [data/SOURCES.md](data/SOURCES.md) for details.

## Licence and contributing

Whospost's own code is licensed under the [Apache License 2.0](LICENSE). You may use, modify, fork, redistribute and use it commercially, including closed-source variants; redistribution must follow the licence terms, including shipping the licence, keeping applicable notices and marking modified files. Running it non-profit is the project's direction, not a non-commercial restriction on users.

Questions and suggestions are welcome as Issues, and changes as Pull Requests. Contributions submitted for inclusion in this project are handled under Apache 2.0 unless explicitly agreed otherwise.

Third-party packages, quoted content and data sources keep their own licences, which this project's use of Apache 2.0 does not change. API keys, tokens, local databases and raw fetched data are not part of the public release; self-hosters must bring their own service credentials and pay the related costs. This licence grants no trademark rights to the Whospost name or logo.
