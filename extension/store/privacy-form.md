# Chrome Web Store「隱私權規範」分頁填答稿

> 後台「Privacy practices」分頁的每一欄，下面都給一段可直接貼的英文（審核人員看的）與中文對照。依據：`EXTENSION-SPEC-20261022.md` §6.6、正式站 `/privacy` 第 7 節、`extension/manifest.json`（只有 `storage` 一個 permission、三個 host）。改了程式碼要回來同步這份。

## 1. 單一用途（Single purpose description）

**English（貼這段）**

> Shows, beside the replies on a Threads post page, the public behaviour signals that the Whospost site has already published for that account (folded into one row when several signals match, otherwise a small chip by the name), plus a local count of how often one account replied in the thread you are reading. It makes no judgement about anyone and never acts on Threads for the user.

中文：在 Threads 貼文頁的回覆旁顯示 Whospost 網站已公開的行為線索（線索較多的收成一列，其他放名字旁一顆晶片），加上本串觀察。不判定任何人、不替使用者在 Threads 上做任何動作。

## 2. 權限理由（Permission justification）

後台會列出 manifest 裡每一個 permission 與 host permission，各要一段理由。

### `storage`

> Keeps the user's settings (display mode, thresholds, election mode, whether to contribute counts) in chrome.storage.sync, and in chrome.storage.local the hourly copy of the public hashed list, the accounts the user chose to trust, the results of checks the user started (kept one hour), and the day's anonymous counts. Nothing about the user's own identity is stored.

中文：設定存 `chrome.storage.sync`；本機存每小時下載的公開雜湊清單、使用者按過信任的帳號、使用者自己按「即時查」的結果（存一小時）、當天的匿名次數。不存任何關於使用者本人的身分資料。

### Host permissions（一欄填全部）

`https://www.threads.com/*`、`https://www.threads.net/*`、`https://whospost.felixlai.workers.dev/*`

> threads.com and threads.net: the content script runs only there, to read the replies already loaded on the post page the user is looking at and to draw chips, folded rows and a popover next to them. It reads the page; it sends nothing to Threads and never calls Threads' own endpoints.
> whospost.felixlai.workers.dev: the extension's own backend. Once an hour it downloads the public list of hashed account names with their signals (no cookies, no account data sent). When the user clicks "Check now" it posts that one account's profile URL to start a check and polls the result by id. When the user clicks "Trust" it posts a hash of that account name (an appeal count). Once a day, if enabled, it posts an anonymous tally of counts carrying only the extension version and the date.

中文：Threads 兩個網域＝content script 只在那裡跑，讀已載入的回覆、畫晶片與收起列；只讀、不送、不打 Threads 的 API。Whospost 網域＝自家後端：每小時下載公開雜湊清單；使用者按「即時查」才送那一個帳號的個人頁網址並輪詢結果；按「信任」送帳號名稱的雜湊值；開著「回報貢獻」時每天送一筆只有版本號與日期的匿名次數。

### 沒有的權限（後台不會問，但審核可能看）

沒有 `tabs`、`scripting`、`webRequest`、`activeTab`、`cookies`、`history`、`alarms`。開新分頁用的是頁面上的一般連結（`target=_blank`），不是 `chrome.tabs`。

## 3. 遠端程式碼（Remote code）

**Are you using remote code? → No.**

> All code ships in the package. content.js loads the extension's own lib/engine.mjs with a dynamic import() from the package itself (listed under web_accessible_resources for the Threads origins); no script, module, eval or WebAssembly is fetched from a server.

中文：全部程式碼都在套件裡。`content.js` 用 `import()` 載的是套件自己的 `lib/engine.mjs`（`web_accessible_resources` 只開給 Threads 網域），沒有從任何伺服器抓程式碼、沒有 eval。

## 4. 資料使用（Data usage）

後台問「這個項目會收集或使用哪些使用者資料」，每一類勾或不勾；下面是建議勾法與理由。建議從嚴：有送出就算「收集」。

| 類別 | 勾？ | 理由 |
|---|---|---|
| Personally identifiable information（個人識別資訊） | 否 | 不收使用者的姓名、email、帳號、ID。 |
| Health information | 否 | — |
| Financial and payment information | 否 | — |
| Authentication information | 否 | 不讀 cookie、不讀登入狀態、不要密碼。 |
| Personal communications | 否 | 回覆內容只在本機讀，不送出。 |
| Location | 否 | 沒有定位；伺服器只看連線 IP 做限流，不存。 |
| Web history | 否 | 不記錄使用者看過哪些頁面；每天只送「看了幾頁」的數字。 |
| User activity（使用者活動） | **是** | 開著「回報貢獻」時每天送一筆匿名次數（看了幾頁、比對幾個帳號、收起幾則、按了幾次信任）；按「信任」會送一次雜湊的申訴計數。都不含帳號、網址或安裝 ID，可以關。 |
| Website content（網站內容） | **是** | 使用者按「即時查」時，送出頁面上那一個帳號的名稱（個人頁網址）給 Whospost 查。只在按下時、只送那一個；被動瀏覽不送。 |

**勾完要在「使用目的」勾的三項聲明（全部勾）**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**資料用途說明（若後台要一段文字）**

> Counts are stored only as daily totals per extension version (no per-user rows). An account name sent by "Check now" is used to run that public check and is published, hashed, in the list; the plain name is not kept beyond the check's result page, which the user asked for. Hashed appeal counts are shown on the result page and never change a score. No data is sold, shared with advertisers or used for anything but showing these signals. Deletion: https://whospost.felixlai.workers.dev/privacy#deletion

中文：次數只存每日、每版本的加總，沒有逐人紀錄。「即時查」送出的帳號名稱只用來跑那次公開查詢，結果以雜湊進清單；申訴計數只顯示在結果頁、永不改分數。不賣、不給廣告商、不作他用。刪除申請走隱私頁第 6 節。

## 5. 隱私權政策網址（Privacy policy URL）

https://whospost.felixlai.workers.dev/privacy （第 7 節「瀏覽器擴充套件」就是這個擴充套件；帳號設定頁也要填同一個網址）

## 6. 對照表：擴充套件到底送了什麼（給審核回信用）

| 時機 | 送到哪 | 內容 | 可關？ |
|---|---|---|---|
| 每小時一次 | Whospost `GET /api/list/v1/export/threads-accounts.json` | 無（只帶 `If-None-Match`） | 關掉擴充套件就不送 |
| 使用者按「即時查」 | Whospost `POST /api/scans`、`GET /api/scans/:id` | 那一個帳號的個人頁網址；之後只帶查詢 id | 彈出視窗可關掉「即時查」按鈕 |
| 使用者按「信任」 | Whospost `POST /api/list/v1/appeal` | 帳號名稱的 SHA-256、隨機安裝 ID 的加鹽雜湊 | 不按就不送 |
| 每天第一次開 Threads 頁 | Whospost `POST /api/list/v1/telemetry` | 種類、版本號、日期、七個數字 | 彈出視窗「回報貢獻」可關，關了本機累計一併清掉 |
| Threads 版面讀不到時 | 同上（`dom_broken`） | 版本號、日期 | 同上 |
| 任何時候 | Threads | 無。只讀頁面，不打 Threads 的任何端點 | — |

所有請求 `credentials: 'omit'`，不帶 cookie。沒有 `uninstall_url`。
