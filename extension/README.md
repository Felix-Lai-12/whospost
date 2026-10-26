# Whospost 留言線索（Chrome 擴充套件，P1＋P2＋P2.5＋P3 上架包，尚未送審）

在 Threads **貼文頁**邊滑邊看：查過、有疑慮的帳號，名字旁直接放命中規則的原因晶片（≥3 項淡紅、1–2 項淡黃）和所在地國旗，回覆本身**不收起、不變淡**（Felix 10-26 定案：預設只標籤、不給選）；沒查過的帳號名字旁常駐一顆「即時查」；點晶片看 AI 判讀與證據。畫面照 `100_Todo/specs/011-whospost/EXTENSION-UI-REDESIGN-20261023.md`（10-26 改動見 STATUS），判斷邏輯照 `EXTENSION-SPEC-20261022.md` §4／§6；本檔只講怎麼用與怎麼改。

| 線索 | 來源 | 連網 | 畫面 |
|---|---|---|---|
| **Whospost 查詢結果** | 整份雜湊清單 `GET /api/list/v1/export/threads-accounts.json`，約每小時下載一次存在本機，比對在記憶體 | 每小時一個請求，不帶 cookie，不送任何帳號資訊 | ≥3 項（`fadeAt`）：淡紅原因晶片；1–2 項：淡黃原因晶片；0 項：不標，也不給即時查（已有人查過）。收起／變淡的程式還在引擎裡（`mode:'collapse'|'fade'`），但沒有介面，e2e 用 storage 切過去測 |
| **本串觀察** | 只讀眼前已載入的回覆，本機計算 | 否 | 同帳號 ≥5 則：灰藍晶片「本串 N 則」；相同內容 ≥3 個帳號：晶片。**本串的標記只掛在該帳號在本串的第一則**（頁面順序最前的那則），後面同帳號的回覆不再重複出現晶片（Felix 10-23） |
| **即時查**（P2.5，規格 §4.3 路 B） | 沒在清單裡的帳號（清單上的帳號、含 0 項的，一律不給即時查：別人查過的結果每小時隨清單發給所有人，最多約兩小時延遲），使用者按了「即時查」才由擴充套件向 Whospost 後端 `POST /api/scans`（免 Turnstile：後端認這個擴充套件的 origin，`WHOSPOST_EXTENSION_IDS`；Origin 是客戶端自己填的，所以這條通道另有跨所有 IP 的全域上限 `EXT_SCAN_RATE_LIMITER`，每分鐘 5 次、只算真的會起跑的新查詢（已存結果、進行中的查詢不扣），超過回 429「即時查太頻繁，請稍後再試。」，擴充套件當一般失敗、可再試一次；沒綁 limiter 就是關閉），再輪詢 `GET /api/scans/:id` | 只在按下時送出那一個帳號名稱；每個安裝每小時最多 10 次（本機計數） | 晶片兩態：**查詢中…**（灰、閃點，不擋滑動）→ 完整結果（原因晶片，顏色照清單規則）或「查過、沒線索」／「查過、資料不足」；提示列「@xx 查好了」。後端先回的快篩（只看貼文與回覆頁第一頁）**不顯示**（Felix 10-26），晶片一直是「查詢中…」到完整結果；等太久（輪詢上限）就回到「沒查過」、提示列說「還沒查完；結果之後會進清單」。快篩的畫法（虛線）還留在 `label.mjs`／`content.css`，沒有路徑會走到。**失敗＝回到「沒查過」**：沒有晶片、提示列說失敗並給「再試一次」，永遠不會顯示成 0 項 |

- **名字旁**（Felix 10-24、10-26）：查過的帳號只放**原因晶片**＋**國旗**兩樣。原因晶片是命中規則的短名（`SIGNAL_SHORT`，例如「留言大量重複」），一條規則一顆；顏色是警告色：分數 ≥ `fadeAt`（預設 3）淡紅（`--whospost-warn-red*`），以下淡黃（`--whospost-warn-yellow*`），亮暗主題各一組；點了開浮層；名字旁最多兩顆（Felix 10-26，其餘在浮層），兩顆同一行放不下（會換行，或碰到 Threads 的「⋯」）就只留第一顆。「6 項中 N 項符合」那顆不畫；0 分的清單帳號（查過、六項都沒中）放一顆淡綠「暫無疑慮」（Felix 10-26，`.whospost-chip-clear`，不帶圓點）。不是分數的狀態晶片照舊：「查詢中…」「本串 N 則」「N 個帳號貼同一段」。
- **晶片** 點了開浮層（Felix 10-24 版）：原因晶片放在標題同一行右邊。清單那筆有 `ai.summary` 時，標題只寫「@xx」，下一行直接是 AI 全文（≤200 字，沒有小標）＋同一列小字「Gemini 判讀，僅供參考」（照清單的 `ai.version`；備援時「Claude 判讀，僅供參考」，認不得的模型只寫「AI 判讀，僅供參考」；Felix 10-26 把原本兩列併成一列）；即時查的結果查完後另向 `/api/scans/:id/ai` 讀 AI 判讀（每 5 秒、最多 3 分鐘，`lib/live.mjs` `aiFromResponse` 跟清單同樣裁切），不用等每小時的清單；沒有 AI 摘要但有原因晶片時標題也只寫「@xx」（Felix 10-26：晶片就是原因，不再寫「6 項中 N 項符合」）；0 分「暫無疑慮」、資料不足「查過、資料不足」，本串觀察維持「本串 N 則」。**不再有一句結論**（原本的「留言像機器在發」等六句已拿掉），同一條規則只用全名（`SIGNAL_LABELS`）與短名（`SIGNAL_SHORT`）兩套字。沒有 AI 摘要就沒有「僅供參考」那句，標題下直接是按鈕。按鈕（Felix 10-26）：先是白底黑框的「封鎖 @xx」「檢舉 @xx」並排（封鎖助手開著時；見下），黑底「看完整證據」移到最底、帳號背景下面（開正式站分享頁）。原本那句「這不是身分判定…」拿掉了。檢查統計與查詢日期、「信任這個帳號」、「申訴或要求刪除」都不在浮層了：統計與申訴在完整證據頁；信任只剩收起列的「都信任」，預設只標籤時看不到。沒查過、只有本串觀察的帳號照舊：本串說明一行＋「即時查」＋「到 Whospost 網站查」。
- **收起列**（只在 `mode:'collapse'` 出現，預設看不到）「顯示」把整組展開成變淡＋晶片；「都信任」一次信任整組，不二次確認，靠提示列復原。
- **提示列** 即時查好了／失敗、封鎖結果，以及收起模式下的信任／顯示，都在底部黑色一行，可復原的 5 秒內可復原。
- **右下角** 收起模式下有收起時出現「已收起 N 則 · 顯示全部」；清單讀不到時是一行灰字「清單暫時無法讀取」，本串觀察照常，**不會看起來像沒事**；Threads 版面變了就一顆紅藥丸「Threads 版面已變，等待更新」。
- **即時查** 沒查過的帳號名字旁**一直顯示**一顆小按鈕「即時查」（Felix 10-26；原本 hover 才出現），點了就在原地查（上表）；本串觀察晶片的浮層裡也有「即時查」按鈕，浮層下方仍留「到 Whospost 網站查」連結。查完的結果存在本機一小時（`chrome.storage.local.live`，只有雜湊、分數與 scanId），重新整理或另一個分頁都看得到；清單下一次更新後就由清單接手，所有使用者都看得到。彈出視窗「這小時還能用 → 即時查 N/10」就是本機計數。
- 信任（收起模式才有）存在本機（`chrome.storage.local`）並送一次匿名申訴計數；彈出視窗已沒有信任清單，舊資料留在 storage 照樣生效。

### 帳號背景（規格 §4.4；0.1.0 送審版就含，Felix 10-25）

- **畫面**（Felix 10-24）：名字旁只放所在地的**國旗 emoji**，滑過看地名全文（`lib/country-flag.mjs`：Threads 回的地名有英文也有繁中，對照表收英、繁中名 → ISO 二碼 → 旗幟；對不到就顯示原文字）。國旗後面接一段灰字「多久前加入」（Felix 10-26，`joinedAgo`）：當月「近 1 個月加入」、一年內「N 個月前加入」、之後「N 年前加入」；Threads 只給到月份，分不出「近一週」。放不下時先收原因晶片，再放不下就整段不顯示，不會截成「3 年前」。加入年月本身在浮層。浮層多一段「帳號背景」：加入、所在地點（改名次數照讀、照存，但先不顯示；「由 Threads 顯示，Whospost 不判定」那行拿掉）。不顯示粉絲數、追蹤數。Windows 的 Chrome 不畫國旗 emoji，會顯示成兩個字母（例如 TW）。加入未滿 60 天，且本串則數 ≥ 晶片門檻或在清單上，「多久前加入」那段字色加深，滑過寫「新帳號不等於假帳號」（原本的「新帳號」字樣併進這段）。不進任何分數。截圖：`docs/profile-1-chip-line.png`、`docs/profile-2-popover.png`。
- **來源**：content script 在 threads.com 同源、用使用者自己的登入狀態送兩個請求（名字懸停卡 GraphQL、「關於此個人檔案」Bloks）。細節、doc_id、量測日見 `docs/profile-lookup.md`。
- **守門**：只讀畫面上有晶片的作者；背景 service worker 管每 2 秒最多 1 個帳號、每小時 300 個（Felix 10-26，原本 60 個請求＝30 個帳號；同一帳號的兩次讀取共用一個名額）；結果存 `chrome.storage.local.profiles` 7 天，**只在本機、不送 Whospost**；連 3 次 429／403／讀不懂就停 6 小時，右下角 pill 多一段「帳號背景暫停」。
- **開關**：沒有使用者開關（Felix 10-26：一律開著；`settings.profileLookup` 存的 `false` 仍然算數，只是沒介面）；停用擴充套件就不讀。遠端開關是 `/api/health` 的 `extension.profileLookup`（Worker 變數 `WHOSPOST_PROFILE_LOOKUP`，預設開、設 `"0"` 關），背景每小時讀一次。彈出視窗「帳號背景 N/60」是這小時用了幾次。
- **程式**：`lib/profile.mjs`（純函式：請求、解析、節流、快取、停機）、`lib/profile-runner.mjs`（content 端佇列）、`lib/profile-label.mjs`（文字），跟 `label.mjs` 分開放。

- **封鎖與檢舉助手**（P2.7，規格 §4.5、§10.3 #21；**0.1.0 送審版就含**（Felix 10-25））：浮層白底黑框的「封鎖 @xx」「檢舉 @xx」並排，收起列與晶片上不放；助手關著時兩顆都不出現。Felix 10-26 起**在原頁操作、不開分頁**：按「封鎖」就在那則回覆上點它自己的「⋯ → 封鎖 → 確認」，跑完不跳我們的提示（Threads 自己會跳，Felix 10-27），只有停下時才提示；按「檢舉」只點「⋯ → 檢舉」，等 Threads 的檢舉視窗出現就停，原因與送出交給使用者（`lib/block.mjs` `runBlock`／`runReport`／`threadsReplyDom`，10-26 登入狀態實測：回覆的「⋯」是它唯一的 `[aria-haspopup="menu"]`，選單最後一組是 Mute · Restrict · Block · Report）。每一步用結構選擇器找、要剛好一個，找不到就停在那裡、提示「Threads 版面已變，請自己按（停在：…）」，不猜、不重試、不再點別的。封鎖一次一個；按下就把 `blockCooldownUntil` 設成 8 秒後，所有分頁的封鎖按鈕一起變灰倒數；沒有批次、沒有內建名單。成功後帳號進本機 `blocked`（只存本機、不回傳），之後狀態是 `blocked`：不標；彈出視窗儀表板「已封鎖」只顯示數量，不列名單、不能移除（Felix 10-26）。遠端開關：background 每小時讀 `/api/health` 的 `extension.block`（worker 讀 `WHOSPOST_EXTENSION_BLOCK`，預設 `"1"`）存 `flags`；沒讀到過或是 `false` 按鈕就不出現。
- **回報貢獻**（P2；Felix 10-26 拿掉開關，一律開著；`settings.report` 存的 `false` 仍然算數）：每個貼文頁把「看了幾頁、比對幾個帳號、幾個在清單上、幾個被標、本串觀察幾個、收起幾則、按了幾次信任」累進本機當天（台北時間）的一筆；換天後第一次開 Threads 頁時，前一天那筆以 `POST /api/list/v1/telemetry` 送出（只帶 `kind`、版本號、日期、七個數字），然後歸零。健康檢查判定「版面已變」時另送一次 `dom_broken`（版本號＋日期），一天最多一次。不含帳號、雜湊、網址、安裝 ID。彈出視窗不再顯示「今天累計」那一行；儀表板的「已查詢／已分析」是另一份只存本機的累計（`chrome.storage.local.totals`，`lib/totals.mjs`，background 在即時查成功與每次 tally 時加），不送出。伺服器端只存按（日期、版本、種類）加總的列（`ext_telemetry` 表，進每日備份），看法：`POST /api/admin/ext-telemetry`（Bearer `ADMIN_TOKEN`，body `{"days":14}`）。

## 載入

1. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個 `extension/` 資料夾。
2. 開任何 `threads.com/@某人/post/…` 頁面（首頁動態不跑），清單上有疑慮的帳號名字旁出現淡紅／淡黃晶片、沒查過的出現「即時查」就是在跑；清單 API 關著時會是一行灰字「清單暫時無法讀取」。
3. 彈出視窗（Felix 10-26）：狀態燈＋「開啟」總開關、「全站累積 N 帳號分析」、三格儀表板（你已查詢／你已分析／你已封鎖）、「這小時還能用」兩條用量（即時查 N/10、帳號背景 N/300）、底部附註「Whospost 不判定誰是假帳號，每項線索都附原文。」、整列的「捐款抖內 →」按鈕（照網站 `.sponsor-cta` 的樣子：蜜桃底、深色框與位移陰影），按鈕下是文字連結「Whospost 網站｜GitHub 開源｜隱私條款」。「查一個帳號」欄已拿掉（Felix 10-26：名字旁就有即時查）。沒有任何設定區（顯示方式、門檻、API 位址、清單立即更新、選舉模式、功能開關、信任與已封鎖清單都沒有介面）；設定照舊存 `chrome.storage.sync`，舊值照樣生效，清單照舊每小時自己更新。
4. 對本機 Worker 開發：彈出視窗不再有 API 位址（Felix 10-26：一般使用者用不到）。到 `chrome://extensions` → 這個擴充套件 →「檢查檢視：service worker」的 console 執行 `chrome.storage.sync.get('settings').then(({settings})=>chrome.storage.sync.set({settings:{...settings,apiBase:'http://localhost:8787'}}))`（只收 https 或本機 http，設 `''` 回正式站；e2e 的 `--api` 也是這樣寫 storage），清單、回報、申訴、即時查都改送那裡，頁面上的連結仍開正式站。Worker 這邊要用 `npx wrangler dev --var WHOSPOST_EXTENSION_IDS:<未封裝擴充套件的 ID> --var WHOSPOST_LIST_ENABLED:1` 起，ID 在 `chrome://extensions` 看得到；正式站的 `WHOSPOST_EXTENSION_IDS` 沒填＝即時查通道關著（POST 回 403）。

`lib/signals.mjs` 是 symlink 到 repo 的 `shared/signals.mjs`：正規化（`norm`／`bare`／`common`）與六項規則的名稱跟正式站同一份。Chrome 載入未封裝項目時會跟著 symlink；打包時 `scripts/pack-extension.mjs` 會把它寫成實體檔（見「怎麼打包」）。

## 檔案

| 檔 | 做什麼 |
|---|---|
| `manifest.json` | MV3，`permissions:["storage"]`，host 只開 threads.com／threads.net／正式站；無 tabs／scripting／webRequest |
| `content.js` | 入口（classic script）：動態 `import()` 自己的 `lib/engine.mjs`，接 `chrome.storage` 與 background |
| `lib/engine.mjs` | 引擎：MutationObserver＋passive scroll → 一次 `requestIdleCallback`；只重畫 render key 變了的容器；連續可疑回覆合成一組（`groupRuns`）由第一則的收起列代表；晶片、浮層、提示列、藥丸；健康檢查連三次「≥10 個 post 連結但 0 個作者」就停下並標「版面已變」 |
| `lib/parse.mjs` | 解析器：容器 `div[data-pressable-container="true"]`、作者 `a[href^="/@"]`、永久連結 `a[href*="/post/"]`；介面固定「給容器，回 `{username, shortcode, text}`」，之後換資料來源不動引擎 |
| `lib/thread.mjs` | 本串觀察：每帳號留言數、相同內容的帳號數；文字用 `norm`，排除 `common()` 與 ≤4 字 |
| `lib/list.mjs` | 清單快取模型：版本檢查（`signals-v2`）、1 小時 TTL、失敗 5 分鐘後再試、`fresh`／`stale`／`missing` 三態 |
| `lib/state.mjs` | 狀態機：`none`／`info`／`fade`／`collapse`／`trusted`／`stale`／`group`／`blocked`，已封鎖最大、其次信任；`collapse` 是「該收起」的判斷，頁面上連續的 collapse 變成一個 `group`；「顯示」把 collapse 降成 fade，選舉模式與預設 `mode:'label'` 把一切降成 info（只晶片） |
| `lib/settings.mjs` | 設定合併（帶 `schemaVersion`，整份寫回；預設 `mode:'label'`）、選舉視窗 11/18–11/28（台北） |
| `lib/label.mjs` | 晶片、收起列、浮層、藥丸、提示列的文字；不寫總結句：查過的結果只用晶片那句（`scoreText`），六項規則只有全名（直接從 `signalScore` 讀）與短名兩套字 |
| `lib/hash.mjs` | `sha256(lowercase(username))`，Promise 快取 LRU 一萬筆 |
| `lib/report.mjs` | 回報貢獻的純邏輯：每頁只加「比上次多出來的」、按台北日期累計、換天交出前一天那筆、送失敗留著下次再送（最多兩天）、`dom_broken` 一天一次、彈出視窗那一行文字 |
| `lib/live.mjs` | 即時查的純邏輯：每小時 10 次的本機計數、`POST /api/scans` 回應怎麼讀（403＝白名單沒開，不是 Turnstile）、狀態頁 → 查詢中／快篩（`quick.partial`）／完成／失敗、輪詢節奏（前 30 秒每 2 秒、之後 3 秒、4 分鐘停）、本機一小時的結果快取 |
| `lib/block.mjs` | 封鎖與檢舉助手：8 秒冷卻、本機已封鎖清單（讀取中／讀不到／空／清單）、步驟執行器（每步等元素出現、點一次、找不到就停；封鎖到確認、檢舉到視窗出現）、貼文頁回覆「⋯」選單的結構選擇器（10-26 登入狀態實測，寫在檔頭） |
| `lib/flags.mjs` | 正式站的遠端開關（`/api/health` → `extension`）：沒讀到過就算關 |
| `background.js` | 只做訊息路由：下載清單（`If-None-Match`）、申訴、回報貢獻（累計與送出都在這裡，設定存了 `report:false` 就清掉不送；彈出視窗儀表板的本機累計 `countTotals`）、即時查（`liveStart` 送一次帳號名稱並計數、`livePoll` 只帶 scanId 回狀態）、開彈出視窗；所有請求都送到設定裡的 API 位址 |
| `popup.html` / `popup.js` / `popup.css` | 彈出視窗：狀態燈＋開啟、全站累積一行、三格儀表板（`lib/totals.mjs`）、這小時還能用的兩條用量（`lib/meter.mjs`，仿 Claude 用量頁）、查一個帳號、底部連結（網站、捐款、GitHub、隱私） |
| `icons/icon-{16,48,128}.png` | 工具列與商店圖示（橘色對話泡＋晶片的點），由 `scripts/extension-icons.mjs` 從一個 SVG 畫出來；128 那張同時是商店圖示 |
| `store/` | 上架包，不進 zip：`listing.zh-TW.md`／`listing.en.md`（商店文案）、`privacy-form.md`（隱私權規範分頁填答稿）、`screenshots/01–04.png`（1280×800）。見「怎麼打包」 |

## 測試

```bash
npm test
```

`tests/extension/` 蓋純邏輯：狀態機（含 `group` 的連續合併，以及即時查的 scanning／partial／done／failed 四態）、本串規則、清單快取三態、設定合併與選舉視窗（含 API 位址驗證）、解析器（用照 2026-10-23 實測結構寫的假 DOM fixture）、文案（晶片／浮層／收起列／提示列／即時查）、回報貢獻（累計、換天、重送、`dom_broken`）、即時查（`live.test.mjs`：每小時計數、回應判讀、狀態頁三態、輪詢、本機快取）、manifest 與權限。worker 端：回報端點在 `tests/worker/ext-telemetry.test.mjs`，即時查通道（白名單免 Turnstile、全域每分鐘 5 次第 6 次 429、已存結果與進行中的重複請求不扣額度、沒綁 limiter 回 503、preflight、狀態頁 CORS、快篩兩段寫入與失敗清掉）在 `tests/worker/ext-scan.test.mjs`，hybrid provider 的快篩取樣在 `tests/providers/provider-switch.test.mjs`。

### e2e（P2，進 CI）

```bash
npx playwright install chromium          # 一次
node tests/extension/e2e/run.mjs --fixture --out e2e-out   # CI 的閘門，離線
node tests/extension/e2e/run.mjs --live  --out e2e-out    # 真實頁，截圖給人看
```

- `--fixture`：Playwright 的 Chromium 載入 `extension/`，把 `tests/extension/e2e/fixture/post.html` 用 request routing 掛在真的 `threads.com` 網址下，content script 跟裝在使用者瀏覽器裡一模一樣地跑；清單灌進 storage。逐項斷言：本串觀察兩條規則、收起列、晶片、藥丸、浮層、信任／復原／都信任、回報貢獻的累計與開關、即時查（腳本自己在 localhost 起一個假 API：user08 走查詢中→快篩→完整→收起、user17 失敗、每小時上限擋在本機；並檢查 POST 只帶 profile 網址、不帶 cookie、輪詢只帶 scanId）、帳號背景（同一頁的登入版：補 token script 與 `ds_user_id`／`csrftoken` cookie，Threads 的兩個回應用 routing 給單元測試的 fixture；斷言晶片後那一行、user07 的「新帳號」、浮層段落、請求間隔 ≥2 秒、已信任不讀、本機快取、重新整理不重讀、遠端開關關掉不讀、連 3 次 403 出現「帳號背景暫停」、彈出視窗關掉清快取，以及假 Whospost API 完全沒收到任何帳號背景）、版面壞掉的紅藥丸與 `dom_broken`。任何一項不符就 exit 1。`.github/workflows/test.yml` 的 `extension-e2e` job 每個 PR 都跑，截圖留成 artifact。
- `--api <base>`：把擴充套件的 API 位址指到本機 Worker（`wrangler dev` 起的，見「載入」第 4 點）；`--live --api http://localhost:8787` 會在真實頁按一次「即時查」跑一次真的查詢（約 US$0.04），截 `live-1-scanning`／`live-2-quick`／`live-3-done`。沒給 `--api` 的 live 模式不碰即時查（正式站白名單沒填）。
- fixture 是 `capture-fixture.mjs` 從真實未登入貼文頁抓下來的：留 Threads 渲染出來的 DOM 結構與用到的 CSS，帳號全部換成 `user01…`／`opaccount`／`other01…`，shortcode 換成 `FX01…`，回覆內文換成設定好劇情的假文（哪幾則在清單上、哪三則同文、哪個帳號連發五則），圖片換成 data URI，script 全拿掉。Threads 改版時重抓：`node tests/extension/e2e/capture-fixture.mjs [貼文網址]`。
- `--live`：打真實未登入頁（預設 @zuck 一篇公開貼文），清單灌三個頁上帳號的假條目、本串門檻調到 2，產出 `docs/` 那五張 `ui2-*.png`；只有引擎判定「版面已變」才 exit 1，其他不符只印警告。`.github/workflows/extension-live.yml` 每天 09:00（台北）跑一次、也可手動跑，是版面壞掉時最先變紅的地方。
- `--fake-api`（live 用）：真實頁配腳本自己的假 API，即時查不打 Worker 也不花錢；`--viewport WxH`：頁面大小（預設 1280x900）；`--mask`：截圖前把頁上帳號換成假名與灰頭像。三個都是商店截圖在用，見「怎麼打包」。
- 正式站清單 API 已開（10-24），擴充套件安裝瞬間會先向正式站抓一次清單；腳本在設定 API 位址後會丟掉那份、從指定的位址重抓，fixture 才會看到「清單讀不到」那一態。
- Chrome stable 137 起不能 `--load-extension`，所以用 Playwright 自帶的 Chromium（新版 headless）；Claude 的 Browser pane 打不開 `chrome://` 也載不了擴充套件。

`docs/live-*.png`：10-23 的即時查截圖。`live-1-scanning` 與 `live-3-done` 是真實頁（@zuck 貼文下的一個帳號）打本機 `wrangler dev`（hybrid＋Apify）的結果；`live-2-quick-fixture`、`live-4-done-folded-fixture` 來自 fixture 假 API——本機那次 Apify 6.5 秒就回、本機瀏覽器那輪 13.7 秒才完，快篩只存在約 1 秒（worker log 有 `scan.quick`），2 秒一次的輪詢沒抓到；正式站瀏覽器那輪通常比 Apify 快，快篩會先出現。

## 怎麼打包（上架用）

```bash
npm run pack:extension                 # → dist/whospost-extension-<manifest 版本>.zip
node scripts/pack-extension.mjs --out /tmp/x.zip   # 指定輸出
```

- 只裝瀏覽器會載的東西：`manifest.json`、`background.js`、`content.js`、`content.css`、`popup.*`、`lib/*.mjs`、`icons/`；`docs/`、`store/`、`README.md`、任何 `*.test.*`／`e2e`／dotfile 都不進去。`lib/signals.mjs` 進去的是實體檔（跟隨 symlink），套件自己能站。
- 固定時間戳、檔名排序，同一棵樹打出來的 zip 位元組相同。打包前會先確認 manifest 指到的每個檔都在。
- `tests/extension/store.test.mjs` 每次 `npm test` 都會實際打一次包到暫存目錄，核對內容；也核對 `store/` 的文案跟 manifest 一致、截圖 1280×800 無透明、icon 尺寸。
- 版本號只改 `manifest.json` 的 `version`（第一次送審是 `0.1.0`；之後每次送審都要比商店上的大）。簡介改 `manifest.json` 的 `description`，`store/listing.zh-TW.md` 的「一句話簡介」要跟著改，測試會擋。

商店截圖重產：

```bash
node scripts/store-screenshots.mjs                    # 真實未登入頁 → extension/store/screenshots/01–04.png
node scripts/store-screenshots.mjs --from e2e-out     # 用跑過的 e2e 資料夾，不再打頁面
```

跑的是 `tests/extension/e2e/run.mjs --live --viewport 1280x800 --fake-api --mask`：清單灌假條目、即時查由腳本自己的假 API 回答（真實頁、沒有真的查詢、不碰正式站）；`--mask` 在每張截圖前把頁上所有帳號換成 `user01…` 與灰色頭像（含擴充套件自己的晶片、收起列、提示列、浮層），因為清單是假的，公開的商店圖不該把真實帳號擺在假線索旁邊。第五張是彈出視窗疊在頁面右上。icon 重畫：`node scripts/extension-icons.mjs`。

**0.1.0 送審那組（10-26）不是用這支產的**：帳號背景要登入才讀得到，這支跑的是未登入頁，所以改在已登入的 Chrome 注入 engine 拍，做法與每張的真假見 [`store/screenshots/README.md`](store/screenshots/README.md)。

送審是 Felix 用自己的 Chrome 開發者帳號做，步驟清單在開 P3 的 PR 說明裡；上架後把正式 ID 填進正式站的 `WHOSPOST_EXTENSION_IDS`，即時查通道才會開。

## 還沒做

英文介面（`_locales`，`store/listing.en.md` 先備著）、首頁 feed、MAIN world 讀 GraphQL（§6.4 B）。
