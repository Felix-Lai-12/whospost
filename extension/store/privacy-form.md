# Chrome Web Store「隱私權規範」分頁填答稿

> 後台「Privacy practices」分頁的每一欄，下面都給一段可直接貼的英文（審核人員看的）與中文對照。依據：`EXTENSION-SPEC-20261022.md` §6.6、正式站 `/privacy` 第 7 節、`extension/manifest.json`（只有 `storage` 一個 permission、三個 host）。改了程式碼要回來同步這份。
>
> **版本：本稿就是 0.1.0 送審版**，含即時查、帳號背景、封鎖助手（Felix 10-25 決定一起送審）。帳號背景與封鎖助手的細節與審核可能問的點在第 7、8 節。

## 1. 單一用途（Single purpose description）

**English（貼這段）**

> Shows, beside the replies on a Threads post page, the public behaviour signals that the Whospost site has already published for that account (folded into one row when several signals match, otherwise a small chip by the name), plus a local count of how often one account replied in the thread you are reading. It makes no judgement about anyone and acts on Threads only when the user asks it to block one account: then it opens that profile and clicks Threads' own block menu for the user, one account at a time.

中文：在 Threads 貼文頁的回覆旁顯示 Whospost 網站已公開的行為線索（線索較多的收成一列，其他放名字旁一顆晶片），加上本串觀察。不判定任何人；只在使用者按下時替他點封鎖：開那個帳號的個人頁，替他點 Threads 自己的「⋯ → 封鎖 → 確認」，一次一個。

## 2. 權限理由（Permission justification）

後台會列出 manifest 裡每一個 permission 與 host permission，各要一段理由。

### `storage`

> Keeps the user's settings (display mode, thresholds, election mode, whether to contribute counts) in chrome.storage.sync, and in chrome.storage.local the hourly copy of the public hashed list, the accounts the user chose to trust, the results of checks the user started (kept one hour), the day's anonymous counts, the account background read from Threads for authors on screen (kept 7 days), the accounts the user blocked with the block helper, an 8-second cooldown time, a one-time block instruction handed to the profile tab it opens (valid 30 seconds), and the site's remote on/off switches. Nothing about the user's own identity is stored, and none of this is sent to the developer.

中文：設定存 `chrome.storage.sync`；本機存每小時下載的公開雜湊清單、使用者按過信任的帳號、使用者自己按「即時查」的結果（存一小時）、當天的匿名次數、向 Threads 讀到的畫面上作者的帳號背景（存 7 天）、用封鎖助手封鎖的帳號、8 秒冷卻的時間、交給新分頁的一次性封鎖指令（30 秒內有效）、Whospost 的遠端開關。不存任何關於使用者本人的身分資料，這些也都不送給開發者。

### Host permissions（一欄填全部）

`https://www.threads.com/*`、`https://www.threads.net/*`、`https://whospost.felixlai.workers.dev/*`

> threads.com and threads.net: the content script runs only there, to read the replies already loaded on the post page the user is looking at and to draw chips, folded rows and a popover next to them. It reads the page, and for authors on screen it reads the account background Threads itself shows the signed-in user (joined month, the place Threads lists, username changes) from threads.com, at most one request every 2 seconds and 60 an hour, kept only on the user's computer for 7 days (see section 7). When the user presses "Block @account" for one account, the content script on that account's profile page clicks Threads' own "⋯ → Block → Block" for them; it stops at the first step whose element it cannot find, and never reports, follows or likes (see section 8).
> whospost.felixlai.workers.dev: the extension's own backend. Once an hour it downloads the public list of hashed account names with their signals (no cookies, no account data sent). When the user clicks "Check now" it posts that one account's profile URL to start a check and polls the result by id. When the user clicks "Trust" it posts a hash of that account name (an appeal count). Once a day, if enabled, it posts an anonymous tally of counts carrying only the extension version and the date.

中文：Threads 兩個網域＝content script 只在那裡跑，讀已載入的回覆、畫晶片與收起列；並在你登入的狀態下讀取 Threads 顯示給你的帳號背景，只存你的電腦（見第 7 節）；使用者按「封鎖 @帳號」時，在那個帳號的個人頁替他點「⋯ → 封鎖 → 確認」，任何一步找不到就停，不檢舉、不追蹤、不按讚（見第 8 節）。Whospost 網域＝自家後端：每小時下載公開雜湊清單；使用者按「即時查」才送那一個帳號的個人頁網址並輪詢結果；按「信任」送帳號名稱的雜湊值；開著「回報貢獻」時每天送一筆只有版本號與日期的匿名次數。

### 沒有的權限（後台不會問，但審核可能看）

沒有 `tabs`、`scripting`、`webRequest`、`activeTab`、`cookies`、`history`、`alarms`。開新分頁用的是頁面上的一般連結（`target=_blank`）與封鎖助手的 `window.open`，不是 `chrome.tabs`。

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
| Authentication information | 否 | 不要密碼、不存也不送任何憑證。帳號背景用的是 Threads 頁面自己的登入狀態（同源請求，瀏覽器自動帶 Threads 的 cookie；`csrftoken` 與頁面 token 只放進送給 Threads 本身的請求），不離開你和 Threads 之間。見第 7 節。 |
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
| 每小時一次（跟清單一起） | Whospost `GET /api/health` | 無；只讀回 `extension.block`、`extension.profileLookup` 兩個開關 | 關掉擴充套件就不送 |
| 使用者按「封鎖 @帳號」 | Threads（使用者自己的分頁） | 不送資料；只在那個帳號的個人頁點 Threads 自己的封鎖選單 | Whospost 可用遠端開關關掉按鈕；不按就不點 |
| 畫面上出現有晶片的作者 | Threads（同源） | 該作者的帳號名稱、user id；帶你在 Threads 的登入狀態。讀回來的帳號背景只存本機 7 天，不送 Whospost | 彈出視窗「讀取帳號背景」可關，關了快取一併清掉 |

送到 Whospost 的請求都是 `credentials: 'omit'`，不帶 cookie；只有讀帳號背景那兩個送給 Threads 本身的請求帶 Threads 的登入狀態。沒有 `uninstall_url`。

## 7. 帳號背景

畫面上有晶片的作者，名字旁多一面所在地的國旗（滑過看地名），浮層多一段「帳號背景」（加入、所在地點）。請求細節見 `extension/docs/profile-lookup.md`。上面第 2 節 Threads 網域那段的理由已經含這項。

**審核可能問的**

- 會用你在 Threads 的登入狀態向 Threads 讀帳號背景（同源請求）。不讀密碼、不存也不送任何憑證給 Whospost。
- 會把畫面上作者的帳號名稱送給 Threads 本身（就像你自己滑過名字、點「關於此個人檔案」），不送 Whospost。
- 資料使用表不用多勾：讀到的東西只在你電腦，沒有傳給開發者或第三方；Authentication information 仍勾「否」（理由見第 4 節表）。審核若認為同源請求也算「使用驗證資訊」，改勾並用第 2 節那段說明。
- 遠端開關：Whospost 的 `/api/health` 回 `extension.profileLookup`，可以在不發新版的情況下整個關掉這個功能。這是一個布林值，不是遠端程式碼。
- 彈出視窗「讀取帳號背景（需登入 Threads）」可關，關了清掉本機快取。

## 8. 封鎖助手

依據 `EXTENSION-SPEC-20261022.md` §4.5、§10.3 #21。權限不變：仍只有 `storage` 與三個 host，開新分頁用 `window.open`（不是 `chrome.tabs`）。上面第 1、2、6 節的單一用途、權限理由與對照表都已含這項。

**審核可能問的**

- 只在使用者按下「封鎖 @帳號」時才動作，一次一個帳號，按過後 8 秒冷卻；沒有批次、沒有內建名單、不做檢舉。
- 每一步都用結構選擇器找、要剛好一個；找不到就停在那裡、頂端紅條寫「Threads 版面已變，請自己按」，不猜、不重試。
- 已封鎖清單只存本機，不送出；遠端開關 `extension.block` 只是讀 `/api/health`，不送任何使用者資料，Whospost 可用它在不發新版的情況下關掉按鈕。
- 資料使用勾法不變。

## 送審前還要做

- ~~`store/screenshots/01–05` 要重拍~~：10-26 已在登入的 threads.com 重拍（新浮層、帳號背景、封鎖助手都在），見 `store/screenshots/README.md`。
