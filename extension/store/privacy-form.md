# Chrome Web Store「隱私權規範」分頁填答稿

> 後台「Privacy practices」分頁的每一欄，下面都給一段可直接貼的英文（審核人員看的）與中文對照。依據：`EXTENSION-SPEC-20261022.md` §6.6、正式站 `/privacy` 第 7 節、`extension/manifest.json`（只有 `storage` 一個 permission、三個 host）。改了程式碼要回來同步這份。
>
> **版本：本稿是 0.2 版（含「帳號背景」）。0.1.0 送審版不含這個功能，送 0.1.0 用 main 上 0.1.0 那一版的本檔。** 0.2 改了哪些欄位集中在第 7 節。

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

> threads.com and threads.net: the content script runs only there, to read the replies already loaded on the post page the user is looking at and to draw chips, folded rows and a popover next to them. It reads the page, and for authors on screen it reads the account background Threads itself shows the signed-in user (joined month, the place Threads lists, username changes) from threads.com, at most one request every 2 seconds and 60 an hour, kept only on the user's computer for 7 days (see section 7).
> whospost.felixlai.workers.dev: the extension's own backend. Once an hour it downloads the public list of hashed account names with their signals (no cookies, no account data sent). When the user clicks "Check now" it posts that one account's profile URL to start a check and polls the result by id. When the user clicks "Trust" it posts a hash of that account name (an appeal count). Once a day, if enabled, it posts an anonymous tally of counts carrying only the extension version and the date.

中文：Threads 兩個網域＝content script 只在那裡跑，讀已載入的回覆、畫晶片與收起列；並在你登入的狀態下讀取 Threads 顯示給你的帳號背景，只存你的電腦（見第 7 節）。Whospost 網域＝自家後端：每小時下載公開雜湊清單；使用者按「即時查」才送那一個帳號的個人頁網址並輪詢結果；按「信任」送帳號名稱的雜湊值；開著「回報貢獻」時每天送一筆只有版本號與日期的匿名次數。

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
| 畫面上出現有晶片的作者（0.2 起） | Threads（同源） | 該作者的帳號名稱、user id；帶你在 Threads 的登入狀態。讀回來的帳號背景只存本機 7 天，不送 Whospost | 彈出視窗「讀取帳號背景」可關，關了快取一併清掉 |

送到 Whospost 的請求都是 `credentials: 'omit'`，不帶 cookie；只有讀帳號背景那兩個送給 Threads 本身的請求帶 Threads 的登入狀態。沒有 `uninstall_url`。

## 7. 帳號背景（0.2 起；0.1.0 送審版不含）

0.2 新增的功能：畫面上有晶片的作者，旁邊多一行「2026-09 加入 · 台灣」，浮層多一段「帳號背景」，註明「由 Threads 顯示，Whospost 不判定」。請求細節見 `extension/docs/profile-lookup.md`。

**Host permission 理由要加的一句（貼在 Threads 網域那段）**

> On threads.com, for authors shown on screen, it reads the account background that Threads itself shows the signed-in user (joined month, the place Threads lists, username changes), using the user's own Threads session. At most one request every 2 seconds and 60 an hour; results stay on the user's computer for 7 days and are never sent to Whospost. It can be switched off in the popup, which also clears them.

中文：在你登入的狀態下讀取 Threads 顯示給你的帳號背景，只存你的電腦。每 2 秒最多一個請求、每小時 60 個；不送 Whospost；彈出視窗可關，關了清掉。

**跟 0.1.0 不同的地方**

- 拿掉「不讀你的登入狀態」：0.2 會用你在 Threads 的登入狀態向 Threads 讀帳號背景。仍然不讀密碼、不存也不送任何憑證給 Whospost。
- Threads 不再是「不送任何東西」：帳號背景會把畫面上作者的帳號名稱送給 Threads 本身（就像你自己滑過名字、點「關於此個人檔案」）。
- 資料使用表不用多勾：讀到的東西只在你電腦，沒有傳給開發者或第三方；Authentication information 仍勾「否」（理由見上表）。審核若認為同源請求也算「使用驗證資訊」，改勾並用上面那段說明。
- 遠端開關：Whospost 的 `/api/health` 回 `extension.profileLookup`，可以在不發新版的情況下整個關掉這個功能。這是一個布林值，不是遠端程式碼。

**上架 0.2 前要一起做**

- 正式站 `/privacy` 第 7 節（`frontend/public/privacy.html`，中英兩段）加上帳號背景、更新生效日；這個 PR 沒動正式站頁面。
- manifest `version` 改 0.2.0、`store/screenshots` 補一張帳號背景。

## 8. 0.2 版改動：封鎖助手（0.1.0 送審版不含）

> 0.1.0 照上面各欄送審。0.2 上架時照這一節改後台各欄；依據 `EXTENSION-SPEC-20261022.md` §4.5、§10.3 #21。權限不變：仍只有 `storage` 與三個 host，開新分頁用 `window.open`（不是 `chrome.tabs`）。

**單一用途**：原文最後一句「never acts on Threads for the user」改成：

> It makes no judgement about anyone and acts on Threads only when the user asks it to block one account: then it opens that profile and clicks Threads' own block menu for the user, one account at a time.

中文：「不替使用者在 Threads 上做任何動作」改成「只在你按下時替你點封鎖」：使用者按了才開那個帳號的個人頁，替他點 Threads 自己的「⋯ → 封鎖 → 確認」，一次一個。

**Host permissions 理由**：threads.com／threads.net 那段加一句：

> When the user presses "Block on Threads" for one account, the content script on that account's profile page clicks Threads' own "⋯ → Block → Block" for them; it stops at the first step whose element it cannot find. It never reports, follows or likes.

中文：使用者按「到 Threads 封鎖」時，content script 在那個帳號的個人頁替他點「⋯ → 封鎖 → 確認」；任何一步找不到元素就停。不檢舉、不追蹤、不按讚。

**storage 理由**：加「使用者透過封鎖助手封鎖的帳號名稱（只存本機）、8 秒冷卻的時間、交給新分頁的一次性封鎖指令（30 秒內有效）、Whospost 的遠端開關」。

**資料使用**：勾法不變。已封鎖清單只存本機，不送出；遠端開關只是讀 `/api/health`，不送任何使用者資料。

**對照表加兩列**：

| 時機 | 送到哪 | 內容 | 可關？ |
|---|---|---|---|
| 每小時一次（跟清單一起） | Whospost `GET /api/health` | 無；只讀回 `extension.block` 開關 | 關掉擴充套件就不送 |
| 使用者按「到 Threads 封鎖 @帳號」 | Threads（使用者自己的分頁） | 不送資料；只在那個帳號的個人頁點 Threads 自己的封鎖選單 | Whospost 可用遠端開關關掉按鈕；不按就不點 |

「任何時候 → Threads → 無。只讀頁面」那列改成「只讀頁面；唯一會按的 Threads 按鈕是使用者按下封鎖助手後的『⋯ → 封鎖 → 確認』」。
