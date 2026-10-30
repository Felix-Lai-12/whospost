# Chrome Web Store「隱私權規範」分頁填答稿

> 後台「Privacy practices」分頁的每一欄，下面都給一段可直接貼的英文（審核人員看的）與中文對照。依據：`EXTENSION-SPEC-20261022.md` §6.6、正式站 `/privacy` 第 7 節、`extension/manifest.json`（只有 `storage` 一個 permission、三個 host）。改了程式碼要回來同步這份。
>
> **版本：本稿就是 0.1.0 送審版**，含AI 打詐、帳號背景、封鎖助手（Felix 10-25 決定一起送審）；10-26 起只標籤、不收起，彈出視窗沒有功能開關（信任、選舉模式、顯示方式都不再有介面）。帳號背景與封鎖助手的細節與審核可能問的點在第 7、8 節。

## 1. 單一用途（Single purpose description）

**English（貼這段）**

> Shows, beside the replies on a Threads post page, the public behaviour signals that the Whospost site has already published for that account (as small chips by the name saying which checks matched), plus a local count of how often one account replied in the thread you are reading. It makes no judgement about anyone and acts on Threads only when the user asks, for one reply at a time: "Block" clicks Threads' own "⋯ → Block → Block" on that reply; "Report" clicks only "⋯ → Report" and leaves Threads' report window to the user.

中文：在 Threads 貼文頁的回覆旁顯示 Whospost 網站已公開的行為線索（名字旁的原因晶片，不收起、不改動回覆），加上本串觀察。不判定任何人；只在使用者按下時、對那一則回覆動作：「封鎖」替他點 Threads 自己的「⋯ → 封鎖 → 確認」；「檢舉」只點「⋯ → 檢舉」，檢舉視窗交給使用者自己選、自己送。

## 2. 權限理由（Permission justification）

後台會列出 manifest 裡每一個 permission 與 host permission，各要一段理由。

### `storage`

> Keeps the user's settings (on/off, chip thresholds, the API address) in chrome.storage.sync, and in chrome.storage.local the copy of the public hashed list (checked every 10 minutes), the results of checks the user started (kept one hour), the day's anonymous counts, three running totals shown in the popup (AI checks, background lookups the user pressed for, blocks), the account background read from Threads for authors on screen (kept 7 days), the accounts the user blocked with the block helper, an 8-second cooldown time, and the site's remote on/off switches. Nothing about the user's own identity is stored. Of this, only the place and joined month of an account the user pressed "AI check" on is sent to the developer (see the whospost host below and section 7).

中文：設定（開關、晶片門檻、API 位址）存 `chrome.storage.sync`；本機存公開雜湊清單（每 10 分鐘檢查一次）、使用者自己按「AI 打詐」的結果（存一小時）、當天的匿名次數、彈出視窗那三格累計次數（AI 打詐、查詢背景、封鎖）、向 Threads 讀到的畫面上作者的帳號背景（存 7 天）、用封鎖助手封鎖的帳號、8 秒冷卻的時間、Whospost 的遠端開關。不存任何關於使用者本人的身分資料，這些也都不送給開發者。

### Host permissions（一欄填全部）

`https://www.threads.com/*`、`https://www.threads.net/*`、`https://whospost.felixlai.workers.dev/*`

> threads.com and threads.net: the content script runs only there, to read the replies already loaded on the post page the user is looking at and to draw chips and a popover next to them. It reads the page, and for authors on screen it reads the account background Threads itself shows the signed-in user (joined month, the place Threads lists, username changes) from threads.com, at most one account every 2 seconds and 300 an hour, kept on the user's computer for 7 days; only for an account the user pressed "AI check" on are the place and joined month also sent to Whospost (see section 7). When the user presses "Block this user" on one reply, the content script clicks that reply's own "⋯ → Block → Block" on the same page; "Report this user" clicks only "⋯ → Report" and stops at Threads' report window. It stops at the first step whose element it cannot find, never picks a report reason or sends a report, and never follows or likes (see section 8).
> whospost.felixlai.workers.dev: the extension's own backend. Every 10 minutes it checks the public list of hashed account names with their signals (no cookies, no account data sent; an unchanged list answers 304). When the user clicks "AI check" it posts that one account's profile URL to start a check and polls the result by id, and once Threads has shown that account's background it posts the place (as a country code, or Threads' text when there is no code) and the joined month for that check id, which the site publishes in the list. Once the hourly AI checks are used up, the "Background" button posts the same profile URL marked savedOnly, which only returns a result the site already has and starts nothing. Once a day it posts an anonymous tally of counts (pages seen, accounts compared, and how many times the user pressed AI check, background lookup and block, never which accounts) carrying only the extension version and the date.

中文：Threads 兩個網域＝content script 只在那裡跑，讀已載入的回覆、畫晶片與浮層；並在你登入的狀態下讀取 Threads 顯示給你的帳號背景，只存你的電腦（見第 7 節）；使用者按「AI 打詐」時，同樣用你的登入狀態讀被查的那個帳號在 Threads 公開的最近 25 則回覆（就是它個人頁「回覆」分頁第一頁），送回 Whospost 比對（見第 9 節）；使用者按「封鎖此用戶」時，在同一頁那則回覆上替他點「⋯ → 封鎖 → 確認」；按「檢舉此用戶」只點「⋯ → 檢舉」、打開檢舉視窗就停。任何一步找不到就停，不替他選檢舉原因、不送出檢舉、不追蹤、不按讚（見第 8 節）。Whospost 網域＝自家後端：每 10 分鐘檢查公開雜湊清單；使用者按「AI 打詐」才送那一個帳號的個人頁網址並輪詢結果，並把讀到的那個帳號最近 25 則公開回覆送回比對（0.2.0）；每天送一筆只有版本號與日期的匿名次數。

### 沒有的權限（後台不會問，但審核可能看）

沒有 `tabs`、`scripting`、`webRequest`、`activeTab`、`cookies`、`history`、`alarms`。開新分頁用的是頁面上的一般連結（`target=_blank`），不是 `chrome.tabs`；封鎖與檢舉助手在原頁操作，不開分頁。

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
| Authentication information | 否 | 不要密碼、不存也不送任何憑證。帳號背景與留言抓取用的是 Threads 頁面自己的登入狀態（同源請求，瀏覽器自動帶 Threads 的 cookie；`csrftoken` 與頁面 token 只放進送給 Threads 本身的請求），不離開你和 Threads 之間。見第 7、9 節。 |
| Personal communications | 否 | 不讀使用者自己的回覆、私訊或任何只有他看得到的內容。頁面上別人的回覆只在本機讀、不送出；使用者按「AI 打詐」時送出的，是被查的那個公開帳號在 Threads 公開的最近 25 則回覆（任何人登入後都看得到的「回覆」分頁第一頁），算在下面 Website content，不是使用者的通訊。 |
| Location | 否 | 不收使用者的位置：沒有定位；伺服器只看連線 IP 做限流與「一個網路位置一票」，只存加鹽雜湊。送出的「國家」是被查的那個公開帳號在 Threads 上顯示的所在地，不是使用者的位置（算在下面 Website content）。 |
| Web history | 否 | 不記錄使用者看過哪些頁面；每天只送「看了幾頁」的數字。 |
| User activity（使用者活動） | **是** | 每天送一筆匿名次數（看了幾頁、比對幾個帳號，按了幾次 AI 打詐、查詢背景、封鎖，留言送出、被拒、失敗幾次等十三個數字）。不含帳號、網址或安裝 ID；停用擴充套件就不送。 |
| Website content（網站內容） | **是** | 使用者按「AI 打詐」時，送出頁面上那一個帳號的名稱（個人頁網址）給 Whospost 查，並在讀到後送出 Threads 顯示的那個帳號的國家與加入年月（公開在清單）；0.2.0 起同時把那個帳號在 Threads 公開的最近 25 則回覆（文字、時間、網址、上層貼文網址與作者；只在你登入 Threads 時讀得到）送給 Whospost 做同一次查詢的比對，不公開原文、不存超過比對所需（見第 9 節）。AI 打詐用完時按「查詢背景」，同樣送出那個帳號名稱，但只取回現成結果。只在按下時、只送那一個；被動瀏覽不送。 |

**勾完要在「使用目的」勾的三項聲明（全部勾）**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**資料用途說明（若後台要一段文字）**

> Counts are stored only as daily totals per extension version (no per-user rows). An account name sent by "AI check" is used to run that public check and is published, hashed, in the list; the plain name is not kept beyond the check's result page, which the user asked for. The place and joined month sent for that account are published in the list with it; the site keeps, per account, one row per network address, keyed by a salted hash of the address (never the address itself), so that one address counts once. No data is sold, shared with advertisers or used for anything but showing these signals. Deletion: https://whospost.felixlai.workers.dev/privacy#deletion

中文：次數只存每日、每版本的加總，沒有逐人紀錄。「AI 打詐」送出的帳號名稱只用來跑那次公開查詢，結果以雜湊進清單，之後所有使用者都看得到這個帳號的結果。同時送出的那個帳號的國家與加入年月也一起公開在清單；伺服器每個帳號、每個網路位置存一列，網路位置只存加鹽雜湊，用來讓一個位置只算一票。不賣、不給廣告商、不作他用。刪除申請走隱私頁第 6 節。

## 5. 隱私權政策網址（Privacy policy URL）

https://whospost.felixlai.workers.dev/privacy （第 7 節「瀏覽器擴充套件」就是這個擴充套件；帳號設定頁也要填同一個網址）

## 6. 對照表：擴充套件到底送了什麼（給審核回信用）

| 時機 | 送到哪 | 內容 | 怎麼停 |
|---|---|---|---|
| 每 10 分鐘一次（清單沒變就回 304） | Whospost `GET /api/list/v1/export/threads-accounts.json` | 無（只帶 `If-None-Match`） | 關掉擴充套件就不送 |
| 使用者按「AI 打詐」 | Whospost `POST /api/scans`、`GET /api/scans/:id`、`GET /api/scans/:id/ai` | 那一個帳號的個人頁網址；之後只帶查詢 id（查完再用同一個 id 讀 AI 判讀，最多 3 分鐘） | 不按就不送；Whospost 端也可拒絕 |
| 同上，讀到那個帳號的背景後（10 分鐘內） | Whospost `POST /api/list/v1/profile` | 查詢 id、國家代碼（或 Threads 的地名文字）、加入年月；不含帳號名稱 | 不按 AI 打詐就不送；關掉帳號背景也不送 |
| 同上，拿到查詢 id 後（0.2.0 留言抓取） | Whospost `POST /api/scans/:id/replies` | 查詢 id、那個帳號最近 25 則公開回覆（每則：id、文字、時間、網址、上層貼文網址與作者、是否引用／轉發）；不含使用者自己的任何資料 | 不按 AI 打詐就不送；彈出視窗「留言抓取」關掉就不讀不送；Whospost 可用遠端開關關掉 |
| AI 打詐用完時按「查詢背景」 | Whospost `POST /api/scans`（`savedOnly`） | 那一個帳號的個人頁網址；只取回現成結果，不啟動查詢、不扣次數 | 不按就不送 |
| 每天第一次開 Threads 頁 | Whospost `POST /api/list/v1/telemetry` | 種類、版本號、日期、十三個數字（含 AI 打詐、查詢背景、封鎖的次數，留言送出、被拒、失敗的次數；不含被查或被封鎖的是誰） | 停用擴充套件就不送 |
| Threads 版面讀不到時 | 同上（`dom_broken`） | 版本號、日期 | 同上 |
| 每小時一次（跟清單一起） | Whospost `GET /api/health` | 無；只讀回 `extension.block`、`extension.profileLookup`、`extension.replies` 三個開關，和留言抓取要用的查詢 id 與頁數（`extension.repliesQuery`，兩個數字，不是程式碼） | 關掉擴充套件就不送 |
| 使用者按「封鎖此用戶」或「檢舉此用戶」 | Threads（使用者正在看的貼文頁） | 不送資料；只在那則回覆上點 Threads 自己的「⋯」選單（封鎖點到確認；檢舉只打開檢舉視窗） | Whospost 可用遠端開關關掉按鈕；不按就不點 |
| 畫面上出現有晶片的作者 | Threads（同源） | 該作者的帳號名稱、user id；帶你在 Threads 的登入狀態。讀回來的帳號背景存本機 7 天；只有按過 AI 打詐的帳號會送國家與加入年月給 Whospost（上兩列）。清單上已有別人回報的帳號不再讀 | 停用擴充套件就不讀；Whospost 可用遠端開關整個關掉 |
| 使用者按「AI 打詐」（0.2.0 留言抓取） | Threads（同源） | 那一個帳號的名稱（名字懸停卡，拿 user id）、再用 id 讀它「回覆」分頁第一頁（25 則），帶你的登入狀態；Threads 不給你看上層貼文的那幾則（最多 6 則），改用**不帶登入**的請求讀那則回覆的公開頁。讀到的不存本機，整理成上一列的欄位送出 | 不按就不讀；彈出視窗「留言抓取」關掉；Whospost 遠端開關 |

送到 Whospost 的請求都是 `credentials: 'omit'`，不帶 cookie；只有讀帳號背景那兩個、與留言抓取的懸停卡和「回覆」分頁那兩個送給 Threads 本身的請求帶 Threads 的登入狀態（留言抓取補讀上層貼文的公開頁是 `credentials: 'omit'`）。沒有 `uninstall_url`。

## 7. 帳號背景

畫面上有晶片的作者，名字旁多一面所在地的國旗（滑過看地名）和「多久前加入」，浮層多一段「帳號背景」（加入、所在地點）。請求細節見 `extension/docs/profile-lookup.md`。上面第 2 節 Threads 網域那段的理由已經含這項。

**審核可能問的**

- 會用你在 Threads 的登入狀態向 Threads 讀帳號背景（同源請求）。不讀密碼、不存也不送任何憑證給 Whospost。
- 會把畫面上作者的帳號名稱送給 Threads 本身（就像你自己滑過名字、點「關於此個人檔案」）。
- 送給 Whospost 的只有：使用者按了「AI 打詐」的那個帳號（名稱本來就為了查詢送出），讀到的國家與加入年月，用查詢 id 送，公開在清單；其他帳號的背景不送（Felix 10-27）。
- 清單上已有別人回報的背景，直接顯示、不再向 Threads 讀，浮層寫「其他使用者讀到的」。
- 資料使用表：Website content 已勾，理由寫明了 AI 打詐帳號的國家與加入年月；Authentication information 仍勾「否」（理由見第 4 節表）。審核若認為同源請求也算「使用驗證資訊」，改勾並用第 2 節那段說明。
- 遠端開關：Whospost 的 `/api/health` 回 `extension.profileLookup`，可以在不發新版的情況下整個關掉這個功能。這是一個布林值，不是遠端程式碼。
- 彈出視窗沒有帳號背景的開關（Felix 10-26：功能一律開著）；要停就停用或移除擴充套件，移除時快取跟著清掉。彈出視窗只顯示「這小時還能讀幾次」。（0.2.0 起彈出視窗有一個開關，是第 9 節留言抓取的，不是這項的。）

## 8. 封鎖與檢舉助手

依據 `EXTENSION-SPEC-20261022.md` §4.5、§10.3 #21；Felix 10-26 改成在原頁那則回覆的「⋯」選單操作、不開分頁，並加「檢舉」。權限不變：仍只有 `storage` 與三個 host。上面第 1、2、6 節的單一用途、權限理由與對照表都已含這項。

**審核可能問的**

- 只在使用者按下「封鎖此用戶」時才動作，一次一個帳號，按過後 8 秒冷卻；沒有批次、沒有內建名單。
- 「檢舉此用戶」只點「⋯ → 檢舉」打開 Threads 的檢舉視窗就停，原因與送出都由使用者自己來；擴充套件不選原因、不送出檢舉。
- 每一步都用結構選擇器找、要剛好一個；找不到就停在那裡、跳提示「Threads 版面已變，請自己按」，不猜、不重試。
- 已封鎖的帳號只存本機、不送出，彈出視窗只顯示數量、不列名單；遠端開關 `extension.block` 只是讀 `/api/health`，不送任何使用者資料，Whospost 可用它在不發新版的情況下關掉按鈕。
- 資料使用勾法不變。

## 9. 留言抓取（0.2.0）

依據 `100_Todo/specs/011-whospost/plan-extension-replies-20261029.md`（Felix 10-29／10-30 定案）。使用者按「AI 打詐」時，content script 用使用者自己的 Threads 登入狀態讀被查的那個帳號在 Threads 公開的最近 25 則回覆（它個人頁「回覆」分頁第一頁，不翻頁），整理成每則的 id、文字、時間、網址、上層貼文網址與作者，拿到查詢 id 後送給 Whospost 一次（`POST /api/scans/:id/replies`）。Whospost 用它跟自己抓的結果比對（影子模式）；目前不改變查詢結果，之後用它取代一部分伺服器端的抓取。第一次讀之前頁面上會先出現一次說明（讀什麼、用誰的登入狀態、送去哪、哪裡關），彈出視窗有「留言抓取」開關。上面第 1、2、4、6 節都已含這項。

**審核可能問的**

- 讀的是那個帳號**公開**的回覆：任何登入 Threads 的人打開它的「回覆」分頁都看得到的那一頁；不讀私訊、不讀使用者自己的任何內容、不讀只有使用者看得到的東西。
- 會用你在 Threads 的登入狀態向 Threads 讀（同源請求，跟第 7 節一樣）。不讀密碼、不存也不送任何憑證給 Whospost。Threads 因為封鎖關係不給你看上層貼文的那幾則，改用**不帶登入**的請求讀那則回覆的公開頁（最多 6 則；再多就整批不送）。
- 只在使用者按「AI 打詐」時、只讀那一個帳號、只讀一頁、只送一次；平常瀏覽不讀不送。讀到的內容不存本機。
- 送給 Whospost 的請求不帶 cookie，只帶查詢 id 與整理好的欄位；Whospost 只接受同一個查詢 1 小時內、來自這個擴充套件的那一次送出，格式對不上就整批退回，並以不帶登入的方式抽查其中兩則是否真的公開存在。
- 節流與停機跟帳號背景共用：每 2 秒最多 1 個帳號、每小時 300 個，被 Threads 拒絕三次就停 6 小時。
- 三個開關：彈出視窗「留言抓取」（本機）；Whospost `/api/health` 的 `extension.replies`（遠端布林值，關掉等於回到 0.1.0）；停用擴充套件。`extension.repliesQuery` 是 Threads 那個分頁的查詢 id 與頁數兩個數字，讓 Threads 換查詢 id 時不用發新版，不是遠端程式碼。

## 送審前還要做

- 0.2.0 送審：第 1、2、4、6、9 節已改好；後台「隱私權規範」要重填（Website content 理由多了留言）。跟 #91 一起送。

- ~~`store/screenshots/01–05` 要重拍~~：10-26 定案設計（只標籤、淡紅淡黃晶片、AI 打詐常駐、三格儀表板）後在登入的 threads.com 重拍，見 `store/screenshots/README.md`。
