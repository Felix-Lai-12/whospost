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
- 本機也可以用 Node.js 24 執行（`node:sqlite`），和 Worker 共用同一套儲存、API 與查詢流程程式（`server/store-core.mjs`、`server/api.mjs`、`server/scan-runner.mjs`）。
- 前端：React + Vite。
- 資料來源：[Apify](https://apify.com/) 上的 Threads 抓取 actor（公開貼文與本人留言）。
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
- `WHOSPOST_SCANS_ENABLED=0` 可立即暫停新查詢。
- 選用 `ADMIN_TOKEN` 開啟 `POST /api/admin/import`，用 `scripts/export-seed.mjs` 匯出的檔案匯入既有結果（不匯入花費帳本）。
- 用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/scans` 可列出所有查詢紀錄（帳號、狀態、時間、訊號數、Apify 花費），新的排最前面。
- 用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/requests` 可看每次送出查詢的紀錄（帳號、時間、回應），含直接讀保存結果的查詢；只記通過人機驗證與頻率限制的請求，不存 IP。
- 查詢顯示「送出狀態不明」時，先到 Apify 後台確認那次確實沒有開出任務，再用 `ADMIN_TOKEN` 呼叫 `POST /api/admin/scans/<id>/release-dispatch` 釋放預留，就能重新查詢。

## 設定

| 環境變數 | 說明 | 預設 |
| --- | --- | --- |
| `APIFY_TOKEN` | Apify API token | 從 `.env.local` 讀取 |
| `WHOSPOST_ENV_FILE` | 改用其他位置的 env 檔 | `./.env.local` |
| `WHOSPOST_APIFY_LIMIT_USD` | Apify 累計花費上限（美元），超過就拒絕新查詢 | `1` |
| `WHOSPOST_COLLECTION_PROFILE` | 取數規模：`standard`（10 篇貼文／50 則留言）、`standard-25`（10 篇／25 則，正式站目前用這個）或 `acceptance-30-100` | `standard` |
| `WHOSPOST_CROSS_ACCOUNT_SEARCH` | 設為 `1` 開啟付費的跨帳號搜尋；關閉時仍會免費比對資料庫內已查過的帳號 | 關閉 |
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
| `VITE_SPONSOR_SLOTS` | 前端建置時使用：自營贊助版位設定，JSON 陣列。每項有 `slot`（`result_bottom` 結果頁檢查卡片下方／`waiting` 查詢等待畫面）、`campaign`（英數、`-`、`_`）、`href`（https），再加圖片版 `image`（放 `frontend/public/sponsor/`）＋`alt`，或文字版 `text`＋`cta`（與搜尋列同格式）。例如 `[{"slot":"result_bottom","campaign":"acme","image":"/sponsor/acme.png","href":"https://example.com/","alt":"說明"}]`。不載入任何第三方 script。未設定就顯示內建的專案募款卡（連到 whospost.bobaboba.me）；fork 請設成 `[]` 就不顯示任何版位，或換成自己的設定。格式錯誤的項目會被略過 | 內建募款卡 |

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

每個事件另帶 `page_type`（`home`／`result`）與 `entry_source`（首次到站網址的 `from`，分享連結會帶 `from=share`）。不送被查的帳號、查詢 ID、完整網址、IP 或 email；`page_location` 只保留 `utm_*` 參數。

## 費用

每查一個新帳號都會呼叫付費的 Apify actor。以 `standard` 規模、跨帳號搜尋關閉計算，通常約 US$0.12，單次上限 US$0.30。同一帳號再次查詢會沿用快取，不重複扣款。

帳本以 Apify 的最終帳單結算：任務開始前先預留上限。查詢結果會先顯示，帳單在背景確認；確認前仍以上限計算，確認後才釋放未用的部分。請勿刪除資料庫來重設預算。

## 限制

- 只看得到抓取當下的公開內容，不是完整發言歷史；留言的上層貼文有時抓不到。
- 門檻是可解釋的暫定值，尚未用人工標註資料校準。
- 不分析政治立場、特定人名或媒體，也不提供「網軍名單」。本機資料庫只是已觀察的公開紀錄與快取。

## 資料來源與第三方授權

- [benthepythondev/threads-user-posts-scraper](https://apify.com/benthepythondev/threads-user-posts-scraper)：公開貼文與本人留言。
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
