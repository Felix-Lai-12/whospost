# Whospost

一眼看穿這個 Threads 帳號是不是怪怪的。

貼上一個 Threads 公開帳號連結（或直接輸入 `@帳號`），Whospost 會抓取它最近的公開貼文與本人留言，整理出可以逐條核對的行為線索：內容是否大量重複、留言是否空洞、是否總是回覆同一個人、是否在同一串洗版或數秒內連發。每一項都附上原文證據，讓你自己判斷。

> 分數是未經校準的規則檢查清單，不是「網軍機率」，也不代表帳號背後有人操作。粉絲、客服、朋友互動都可能符合部分條件。資料不足時會顯示「暫不評分」。

## 它會檢查什麼

六項檢查（每項最多 1 分，滿分 6 分），完整規則與門檻見 [SCORING.md](SCORING.md)：

1. 發文內容重複：一半以上貼文屬於相同或相似內容。
2. 留言重複或空洞：同一句留言超過 5 次，或八成以上留言在 4 字以內。
3. 回覆對象集中：過半留言回覆同一位作者。
4. 單串洗版：在同一篇貼文下留言至少 11 則。
5. 互相集中回覆：本帳號和它最常回覆的帳號，彼此都把過半留言給了對方（需兩邊都查過）。
6. 短時間連發：同一篇貼文下，相鄰留言間隔 10 秒內至少 3 次。

另有兩項輔助資訊，不計分：

- 相關查核：用 [Cofacts](https://cofacts.tw/) 比對貼文是否與既有查核相似。相似不代表該帳號發布假訊息。
- AI 行為判讀（選用，預設關閉）：用 Gemini 依據同一批證據寫出觀察摘要，並以規則擋下無法由證據支持的意圖推論。

## 架構

- 正式站跑在 Cloudflare Workers：一個 Worker 提供網頁與 API；資料（查詢結果、證據、快取、花費帳本、每日額度）存在一個 Durable Object 的 SQLite 裡，所有「檢查額度＋預留」都在同一處完成，不會超支；每筆查詢另有一個 Durable Object 負責等 Apify 跑完，中斷後會接著同一筆任務繼續，不重複付費。
- 分享連結（`/?scan=<id>`）的預覽圖由另一個 Durable Object 用 [workers-og](https://github.com/kvnang/workers-og) 畫成 1200×630 PNG，每個版本只畫一次並存進 SQLite；畫圖約需 0.1–0.7 秒 CPU，超過免費方案一般 Worker 請求的 10 ms，但在 Durable Object 的上限內。畫不出來時改用 `/og.png`。字型子集由 `scripts/og-font-subset.sh` 產生。
- 首頁網址帶 `?u=<帳號>`（`@帳號`、帳號或個人頁連結都可以）會把帳號預填進查詢框，不自動送出，按鈕還是要自己按；無效的值就當一般首頁。瀏覽器擴充套件開的是 `/?u=<帳號>&from=ext`。
- 本機也可以用 Node.js 24 執行（`node:sqlite`），和 Worker 共用同一套儲存、API 與查詢流程程式（`server/store-core.mjs`、`server/api.mjs`、`server/scan-runner.mjs`）。
- 前端：React + Vite。
- 資料來源由 `WHOSPOST_FETCH_PROVIDER` 選：`apify`（預設）呼叫 [Apify](https://apify.com/) 上的 Threads 抓取 actor；`hybrid` 貼文走 Browser Rendering、本人留言仍走 Apify 的 replies job（每次約 US$0.05，留言樣本完整，六項訊號不受不登入上限影響）；`browser` 全部用 Cloudflare Browser Rendering（`@cloudflare/puppeteer`）在 Cloudflare 網路上不登入開帳號的公開頁與「回覆」分頁，讀頁面內嵌的 JSON，每次約 20–30 秒瀏覽器時間（約 US$0.001）。瀏覽器讀取失敗（開不了工作階段、逾時、被導到登入頁、發文少於 `WHOSPOST_BROWSER_MIN_POSTS`）時，`WHOSPOST_BROWSER_FALLBACK=apify` 改跑 Apify，`fail` 則讓查詢失敗。不登入只看得到最近 10 篇發文與約 10 則本人留言，結果頁的限制說明會寫明取得幾則。
- 計分邏輯在 `shared/signals.mjs`，前後端共用，讀舊結果時會以現行規則重算。

## 本機執行

需要 Node 24 以上與一組 Apify API token（需自行付費）。

```sh
npm run setup
python3 scripts/setup-token.py   # 安全輸入 Apify token，寫入 .env.local（不會顯示）
npm run build
npm test
npm start
```

開啟 http://127.0.0.1:8788 。

token 與金鑰只從後端環境變數或 `.env.local` 讀取，`.env*` 已列入 `.gitignore`，請勿放進前端或提交到 Git。

## 部署到 Cloudflare

需要 Cloudflare 帳號（免費方案即可開始）。

```sh
npm run setup
npx wrangler login
npx wrangler secret put APIFY_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TURNSTILE_HOSTNAMES
npx wrangler secret put IP_HASH_SALT
npx wrangler r2 bucket create whospost-backups
npm run deploy
```

部署前在 Cloudflare 後台建立 Turnstile 小工具，網域填你的 Worker 網址（例如 `whospost.<帳號>.workers.dev`）。site key、secret 和網域都用 secret 設定，`TURNSTILE_HOSTNAMES` 填同一個網域、多個用逗號分隔，正式環境不要放 localhost；沒設好之前新查詢會暫停。本機測試 Worker：複製 `.dev.vars.example` 為 `.dev.vars`，執行 `npm run dev:worker`。

之後想讓 `main` 一更新就自動部署，可在 Worker 的 Settings → Build 連接這個 repo（Workers Builds）：

- Branch：`main`
- Build command：`npm --prefix frontend ci && npm test && npm run build`（測試沒過就不部署）
- Deploy command：`npx wrangler deploy`
- Build variables：`NODE_VERSION=24`（測試用到 Node 內建的 SQLite），選用 `VITE_CONTACT_EMAIL`（頁首「聯絡開發者」按鈕）、`VITE_SPONSOR_SLOTS`（自營贊助版位）
- 不開非正式分支預覽：Worker 有 Durable Objects 時不支援預覽網址，PR 由 GitHub Actions 跑測試。

公開站的保護：

- 新查詢要通過 Turnstile 人機驗證，每個 IP 每分鐘最多 5 次請求、每天最多 `WHOSPOST_IP_DAILY_SCANS` 次新查詢（只存加鹽雜湊，不存原始 IP）。
- Apify 與 AI 共用每日花費上限 `WHOSPOST_DAILY_LIMIT_USD`（設 `0` 就不設每日上限，只看累計上限），另各有累計上限 `WHOSPOST_APIFY_LIMIT_USD`、`WHOSPOST_AI_LIMIT_USD`。額度不夠時直接拒絕新查詢，不會做到一半。
- 查過的帳號直接讀保存結果，不驗證、不扣款；AI 判讀在查詢完成後自動產生一次，之後所有人共用。
- 讀取走兩層快取：完成的查詢結果（`GET /api/scans/:id`）與預覽卡圖（`GET /api/og/:id.png?v=`）先經 Cloudflare Cache API（`caches.default`，同一資料中心的所有 isolate 共用；結果存 10 分鐘、卡圖依 URL 的 `v` 存 7 天，`v` 變了就是新的一筆），再經每個 isolate 自己的 60 秒記憶體快取，都沒命中才讀 Durable Object。回應帶 `X-Whospost-Cache: HIT`／`MISS` 可驗證。查詢進行中與找不到的回應不快取；AI 判讀走 `/api/scans/:id/ai`，不經這層。注意 Cache API 在 `workers.dev` 網域可用，但只作用於同一個資料中心，不同地區各自回源一次。
- Worker 開新查詢前會先讀 Apify 帳戶的本月實際用量（`GET /v2/users/me/limits`，免費唯讀，每個 isolate 快取 60 秒）；剩餘額度不夠一次查詢就回 429 `BUDGET_EXCEEDED`，畫面走捐款提示，額度重置或加付款後約一分鐘內自動恢復。Apify 讀不到時放行，交給站內帳本與 Apify 本身把關。`/api/health` 的 `apifyMonthly` 顯示本月用量與上限（不含 token）。`WHOSPOST_APIFY_USAGE_CHECK=0` 可關閉這項檢查。
- `WHOSPOST_SCANS_ENABLED=0` 可立即暫停新查詢。
- 頁首「我會去投票」計數（`POST /api/pledge`）不過 Turnstile：同一瀏覽器只算一次（前端存一個隨機 token，伺服器只存它的 SHA-256，不存 IP、不存 UA），清除網站資料後可再登記一次；每個 IP 每分鐘最多 3 次、全站每分鐘最多 `WHOSPOST_PLEDGE_GLOBAL_PER_MIN` 次。這個數字是鼓勵投票用，不是統計資料，也不問投給誰。總數 `GET /api/pledge` 每個 isolate 快取 60 秒。
- 選用 `ADMIN_TOKEN` 開啟 `POST /api/admin/import`，用 `scripts/export-seed.mjs` 匯出的檔案匯入既有結果（不匯入花費帳本）。
- 用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/scans` 可列出所有查詢紀錄（帳號、狀態、時間、訊號數、Apify 花費），新的排最前面。
- 用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/requests` 可看每次送出查詢的紀錄（帳號、時間、回應），含直接讀保存結果的查詢；只記通過人機驗證與頻率限制的請求，不存 IP。
- 抓取全部失敗卻存成「完成」的空結果（舊版在 Apify 額度用完時會這樣存，之後查同帳號都回這份空結果），用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/scans/fail-empty` 一次改成「失敗」，回傳改了幾筆與 ID；之後再查這些帳號就會重新抓取。
- 查詢顯示「送出狀態不明」時，先到 Apify 後台確認那次確實沒有開出任務，再用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/scans/<id>/release-dispatch` 釋放預留，就能重新查詢。

### 每晚備份到 R2

所有資料只存在一個 Durable Object 裡，所以 Worker 每天台北 04:00（`wrangler.jsonc` 的 cron `0 20 * * *`，UTC）把每張表匯出到 R2 bucket `whospost-backups`：

- 路徑 `backups/YYYY-MM-DD/<table>.jsonl.gz`（日期是台北日期），gzip 壓縮的 JSON Lines，一列一筆；另有 `manifest.json` 記錄各表列數、壓縮前後大小（`bytes`、`totalBytes`）、匯出時間、`schemaVersion`。匯出的表：`scans`、`evidence`、`observations`、`analysis_runs`、`budget`、`scan_requests`、`ip_quota`、`pledges`、`ai_meta`、`ai_jobs`、`ai_attempts`；快取與每分鐘頻率桶不備份。
- 匯出用 rowid 游標一頁 500 列讀，不一次讀整表。保留策略：最近 7 天每天一份，再往前只留每週一（台北）那份、共 4 週，約 11 份；其餘資料夾在每次備份結束時刪除。R2 免費額度 10 GB，一份匯出壓縮前約 50 MB 且每天在長，所以不留 30 天每日份。週一那晚若備份失敗，該週就沒有週份。
- 部署前先建 bucket（上面的 `npx wrangler r2 bucket create whospost-backups`），沒建會部署失敗。
- 想立刻備份：用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/backup`，回傳的就是那天的 manifest（含這次刪掉的舊日期）。同一天重跑會覆蓋同一個資料夾。
- 看有哪些備份：`npx wrangler r2 object list whospost-backups --prefix backups/`（舊版 wrangler 沒有 list 時，到 Cloudflare 後台 R2 看）。下載：`npx wrangler r2 object get whospost-backups/backups/2026-10-22/scans.jsonl.gz --file scans.jsonl.gz`，再 `gunzip scans.jsonl.gz`。
- 還原（目前只有說明，還沒有還原程式）：`scans`、`evidence`、`observations`、`analysis_runs`、`ai_jobs` 這五張表的欄位與 `POST /api/admin/import` 收的格式一致，把 jsonl 每行收成陣列、組成 `{scans:[…],evidence:[…],observations:[…],analysis_runs:[…],ai_jobs:[…]}` 後 import 即可（`INSERT OR IGNORE`，已存在的不覆蓋）。`budget`、`ip_quota`、`scan_requests`、`pledges`、`ai_meta`、`ai_attempts` 是帳本與配額，import 刻意不收，要還原得另寫腳本直接寫進 Durable Object；全站重建時通常可以不還原這幾張。

## 設定

| 環境變數 | 說明 | 預設 |
| --- | --- | --- |
| `APIFY_TOKEN` | Apify API token | 從 `.env.local` 讀取 |
| `WHOSPOST_ENV_FILE` | 改用其他位置的 env 檔 | `./.env.local` |
| `WHOSPOST_APIFY_LIMIT_USD` | Apify 累計花費上限（美元），超過就拒絕新查詢；設 `0` 就不設站內上限；正式站設 `100`，遠高於 Apify 帳戶本月額度，只當保險，實際由 Apify 帳戶額度擋 | `1` |
| `WHOSPOST_APIFY_USAGE_CHECK` | Worker 專用：設為 `0` 就不讀 Apify 帳戶本月用量，只看站內帳本 | 開啟 |
| `WHOSPOST_FETCH_PROVIDER` | Worker 專用：`apify`、`hybrid`（貼文 Browser Rendering＋留言 Apify）或 `browser`（全部 Browser Rendering）；後兩者需 `wrangler.jsonc` 的 `browser` binding | `apify` |
| `WHOSPOST_BROWSER_FALLBACK` | Worker 專用：瀏覽器讀取失敗時 `apify`（發文改跑 Apify posts job，需 `APIFY_TOKEN`）或 `fail`（查詢失敗） | `apify` |
| `WHOSPOST_BROWSER_MIN_POSTS` | Worker 專用：瀏覽器讀到的發文少於這個數就視為失敗（`0` 不檢查） | `1` |
| `WHOSPOST_BROWSER_POST_PAGES` | Worker 專用：另開幾篇貼文頁讀其他人的留言（最多 3，目前不計分） | `0` |
| `WHOSPOST_COLLECTION_PROFILE` | 取數規模：`standard`（10 篇貼文／50 則留言）、`standard-25`（10 篇／25 則）、`standard-20`（10 篇／20 則，正式站目前用這個）或 `acceptance-30-100` | `standard` |
| `WHOSPOST_CROSS_ACCOUNT_SEARCH` | 設為 `1` 開啟付費的跨帳號搜尋 | 關閉 |
| `WHOSPOST_LOCAL_COMPARISON` | 設為 `0` 關閉「跟資料庫內已查過帳號比對同期發文」；只作脈絡、不計分，但每次要讀數千筆紀錄。正式站已關 | 開啟 |
| `WHOSPOST_LIST_ENABLED` | Worker 專用：設為 `1` 開放瀏覽器擴充套件用的公開帳號清單 API（`/api/list/v1/*`，見下方「公開帳號清單 API」）；關閉時整組回 404 | 關閉 |
| `WHOSPOST_EXTENSION_IDS` | Worker 專用：逗號分隔的 Chrome 擴充套件 ID；設了就只讓這些來源跨域讀清單與送申訴，沒設就接受任何 `chrome-extension://` 來源（開發期） | — |
| `WHOSPOST_AI_ENABLED` | 設為 `1` 開啟 AI 行為判讀 | 關閉 |
| `GEMINI_API_KEY` | Gemini API key（可用 `WHOSPOST_GEMINI_KEY_NAME` 改讀其他變數名） | — |
| `WHOSPOST_AI_LIMIT_USD` | AI 累計花費上限（美元） | `0.10` |
| `WHOSPOST_AI_MAX_OUTPUT_TOKENS` | AI 單次輸出 token 上限 | `1800` |
| `WHOSPOST_AI_LEDGER` | AI 花費帳本路徑 | `runtime/ai-account-ledger.sqlite` |
| `WHOSPOST_AI_BASELINE_LEDGER` | 選用：匯入帳本建立前已花費的金額（JSON），設定後必須可讀 | — |
| `COFACTS_APP_SECRET` | 選用：Cofacts API 的 app secret | — |
| `WHOSPOST_DB` | 查詢資料庫路徑 | `data/whospost.sqlite` |
| `PORT` | 後端埠號 | `8788` |
| `GA_MEASUREMENT_ID` | 選用（Worker secret）：GA4 Measurement ID，例如 `G-XXXXXXXXXX`。未設定就不載入 Google Analytics、不送任何事件；fork 部署請用自己的 ID 或留空 | — |
| `VITE_CONTACT_EMAIL` | 前端建置時使用：頁首「聯絡開發者」信箱，未設定就不顯示（見 `frontend/.env.example`） | — |
| `VITE_SPONSOR_SLOTS` | 前端建置時使用：自營贊助版位設定，JSON 陣列。每項有 `slot`（`result_bottom` 結果頁分享卡下方、檢查卡片上方／`waiting` 查詢等待畫面）、`campaign`（英數、`-`、`_`）、`href`（https），再加圖片版 `image`（放 `frontend/public/sponsor/`）＋`alt`，或文字版 `text`＋`cta`（與搜尋列同格式）。例如 `[{"slot":"result_bottom","campaign":"acme","image":"/sponsor/acme.png","href":"https://example.com/","alt":"說明"}]`。不載入任何第三方 script。未設定就顯示內建的專案募款卡（連到 whospost.bobaboba.me）；fork 請設成 `[]` 就不顯示任何版位，或換成自己的設定。格式錯誤的項目會被略過 | 內建募款卡 |
| `VITE_VOTE_OPEN_AT` | 前端建置時使用：頁首大選倒數的目標時刻（含時區的 ISO 時間，投票所開門）。倒數純前端用裝置時鐘計算；投票日 08:00–16:00 顯示「投票所開到 16:00」，16:00 後顯示「投票結束」，隔天 00:00 起整組自動隱藏 | `2026-11-28T08:00:00+08:00` |
| `VITE_VOTE_COUNTDOWN` | 前端建置時使用：設成 `0` 就不顯示倒數與「我會去投票」按鈕（fork 用） | 開啟 |
| `WHOSPOST_PLEDGE_GLOBAL_PER_MIN` | 全站每分鐘「我會去投票」登記上限（`wrangler.jsonc` vars），是每 IP 限制之外的後盾；`0` 關閉 | `300` |

## 流量統計（選用）

設定 Worker secret `GA_MEASUREMENT_ID` 後，前端從 `/api/health` 取得 ID 才載入 GA4；本機與未設定的部署不送任何資料。送出的事件（`frontend/src/analytics.mjs`）：

| 事件 | 時機 | 參數 |
| --- | --- | --- |
| `search_input` | 查詢框第一次有內容（每個瀏覽階段一次） | `method`：`type`／`paste`／`example` |
| `scan_submit` | 每次按下送出 | `input_type`：`link`／`handle`／`bare`；`outcome`：`started`／`cached`／`rate_limited`／`quota`／`turnstile_failed`／`paused`／`error`／`invalid_input` |
| `result_view` | 看到完成的結果（每筆結果每階段一次） | `cached`、`signals` |
| `share_copy` | 按分享 | `result`：`success`／`fail` |
| `nav_click` | 頁首 GitHub、聯絡開發者、小額贊助；額度用完提示裡的贊助連結 | `item`：`github`／`contact`／`sponsor`／`sponsor_budget` |
| `app_error` | 載入失敗（每種每階段一次） | `kind` |
| `ad_impression` | 贊助版位第一次進入畫面（每個版位每階段一次；`VITE_SPONSOR_SLOTS` 設成 `[]` 就不會有） | `slot`：`result_bottom`／`waiting`；`campaign` |
| `ad_click` | 點贊助版位 | `slot`、`campaign` |
| `pledge_click` | 按頁首「我會去投票」且伺服器回 200 | `result`：`counted`（第一次）／`already`（同一瀏覽器再按） |

每個事件另帶 `page_type`（`home`／`result`）與 `entry_source`（首次到站網址的 `from`，分享連結會帶 `from=share`，瀏覽器擴充套件開的頁面帶 `from=ext`）。不送被查的帳號、查詢 ID、`?u=` 預填的帳號、完整網址、IP 或 email；`page_location` 只保留 `utm_*` 參數。

## 瀏覽器擴充套件（`extension/`）

Chrome 擴充套件「Whospost 留言線索」在 Threads 貼文頁的回覆旁顯示清單比對結果與本串觀察，只讀已載入的畫面、不替使用者按任何按鈕、被動瀏覽時不送出任何帳號資訊。用法、檔案與測試見 [`extension/README.md`](extension/README.md)；規格在 `100_Todo/specs/011-whospost/EXTENSION-SPEC-20261022.md`。上架包（商店文案、截圖、icon、隱私表填答稿）在 `extension/store/`，`npm run pack:extension` 打出送審用的 zip；尚未送審。

## 公開帳號清單 API（瀏覽器擴充套件用）

`WHOSPOST_LIST_ENABLED=1` 時 Worker 多開一組 `/api/list/v1/*`，給 Threads 瀏覽器擴充套件比對回覆作者用；關閉時整組回 404。清單只有雜湊，沒有明文帳號：

- `GET /api/list/v1/export/threads-accounts.json`：整份清單，授權 CC BY-SA 4.0。外層 `{license, attribution, generated, version:"signals-v2", accounts:[…]}`；每個帳號一列 `{h, score, hits, assessed, unknown, evidence, ai, scanId, updated, appeals}`：`h` 是 `sha256(小寫帳號)`；`score`／`hits`／`assessed`／`unknown` 跟結果頁同一套 `signalScore`；`evidence` 是 `rules`（至少一項命中）、`ai`（有通過用詞檢查的 AI 摘要）、`appeal`（有人按過「信任」）或 `null`；`ai` 只放摘要首句且帳號名稱已去除；`appeals` 只是計數、不影響分數。回應帶 `ETag` 與 `Cache-Control: public, max-age=3600`，走 Cache API，`If-None-Match` 相符回 304；資料物件每小時最多重算一次。
- `GET /api/list/v1/buckets?p=a1b2,c3d4`：最多 64 個 4 位 hex 前綴，回 `{前綴:[條目]}`，同樣快取 1 小時。第一版擴充套件整份下載、不用這個；清單超過約 5 萬筆再改逐桶查。
- `POST /api/list/v1/appeal`：body `{h, installHash, reason?}`，擴充套件「信任」鈕的回報。只接受 `Origin: chrome-extension://<id>`（設了 `WHOSPOST_EXTENSION_IDS` 就只接受那些 ID），每個 IP 每分鐘最多 5 次（跟新查詢共用同一個限流器、各自計數），同一個安裝對同一帳號只算一次；存進 `appeals` 表（每晚備份含它），只顯示計數、永不改分數。

## 費用

每查一個新帳號都會呼叫付費的 Apify actor。以 `standard` 規模、跨帳號搜尋關閉計算，通常約 US$0.12，單次上限 US$0.30。同一帳號再次查詢會沿用快取，不重複扣款。

`WHOSPOST_FETCH_PROVIDER=hybrid` 時，貼文用約 15–25 秒 Browser Rendering 時間（預留 US$0.002）、留言照 Apify replies job 預留 `repliesCapUsd`（standard-20 為 US$0.08），實際一次約 US$0.05。改用 `browser` 時，一次查詢約用 20–30 秒 Browser Rendering 時間：Workers Paid 每月內含 10 小時與 10 個並發瀏覽器，超過每小時 US$0.09；每天 300 次約每月 US$6。帳本仍記在同一張表：每輪先預留 US$0.002，結束時以實際秒數換算、立即結清；`/api/health` 的 `browser` 顯示本月（台北）輪數、秒數與換算金額。退回 Apify 的那幾次照 Apify 的方式記帳。`WHOSPOST_APIFY_LIMIT_USD` 仍是這張表的累計上限。

帳本以 Apify 的最終帳單結算：任務開始前先預留上限。查詢結果會先顯示，帳單在背景確認；確認前仍以上限計算，確認後才釋放未用的部分。請勿刪除資料庫來重設預算。

## 限制

- 只看得到抓取當下的公開內容，不是完整發言歷史；留言的上層貼文有時抓不到。
- 門檻是可解釋的暫定值，尚未用人工標註資料校準。
- 不分析政治立場、特定人名或媒體，也不提供「網軍名單」。本機資料庫只是已觀察的公開紀錄與快取。

## 資料來源與第三方授權

- [benthepythondev/threads-user-posts-scraper](https://apify.com/benthepythondev/threads-user-posts-scraper)：公開貼文與本人留言（`apify` 來源）。
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/)：`browser` 來源，不登入讀 Threads 公開頁內嵌的 JSON；Cloudflare 會在每個請求加上不可移除的機器人識別 header，Meta 可依此封鎖，所以保留 Apify 退回。
- [automation-lab/threads-scraper](https://apify.com/automation-lab/threads-scraper)：跨帳號搜尋（預設關閉）。
- [Cofacts](https://cofacts.tw/)：查核資料採 CC BY-SA 4.0，結果連回原文。
- [caris-events/invade](https://github.com/caris-events/invade)：用詞字典，文字 CC0、程式 MIT；用詞只作參考，不計分。
- [workers-og](https://github.com/kvnang/workers-og)：畫預覽圖（MIT；內含 satori、resvg-wasm，MPL-2.0）。
- [Noto Sans TC](https://github.com/notofonts/noto-cjk)：預覽圖字型（子集），SIL Open Font License 1.1，見 [worker/og/OFL.txt](worker/og/OFL.txt)。

詳見 [data/SOURCES.md](data/SOURCES.md)。

## 授權與貢獻

Whospost 自有程式碼採用 [Apache License 2.0](LICENSE)。允許使用、修改、自由 fork、再散布與商業使用，亦可開發閉源變體；再散布時須遵守授權條款，包括附上授權、保留適用聲明，以及標示修改過的檔案。非營利營運是專案方向，不是對使用者的非商用限制。

歡迎透過 Issue 提出問題或建議、透過 Pull Request 貢獻修改。提交供本專案納入的貢獻，除明確另行約定外，依 Apache 2.0 授權條款處理。

第三方套件、引用內容與資料來源仍適用各自授權，並不因本專案採用 Apache 2.0 而改變。API key、token、本機資料庫與原始抓取資料不屬於公開發行內容；自行部署者須自備服務憑證並負擔相關費用。本授權不授予 Whospost 名稱或標誌的商標使用權。
