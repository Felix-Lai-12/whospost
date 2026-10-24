# Whospost 留言線索（Chrome 擴充套件，P1＋P2＋P2.5＋P3 上架包，尚未送審）

在 Threads **貼文頁**邊滑邊把可疑回覆讓開：清單命中 ≥3 項的回覆預設收成一列「已收起 N 則 · 原因 · 顯示 · 都信任」（像 Instagram 的「查看更多回覆」），其他線索只在名字旁放一顆小晶片，點晶片才看原因。畫面照 `100_Todo/specs/011-whospost/EXTENSION-UI-REDESIGN-20261023.md`，判斷邏輯照 `EXTENSION-SPEC-20261022.md` §4／§6；本檔只講怎麼用與怎麼改。

| 線索 | 來源 | 連網 | 畫面 |
|---|---|---|---|
| **Whospost 查詢結果** | 整份雜湊清單 `GET /api/list/v1/export/threads-accounts.json`，約每小時下載一次存在本機，比對在記憶體 | 每小時一個請求，不帶 cookie，不送任何帳號資訊 | ≥3 項符合：收起（預設）或變淡＋橘晶片「6 項中 4 項符合」；0–2 項：灰晶片，不收不淡 |
| **本串觀察** | 只讀眼前已載入的回覆，本機計算 | 否 | 同帳號 ≥5 則：灰藍晶片「本串 N 則」；≥10 則才收起；相同內容 ≥3 個帳號：晶片。**本串的標記只掛在該帳號在本串的第一則**（頁面順序最前的那則），後面同帳號的回覆不再重複出現晶片、不變淡、不收起（Felix 10-23） |
| **即時查**（P2.5，規格 §4.3 路 B） | 沒在清單裡的帳號，使用者按了「即時查」才由擴充套件向 Whospost 後端 `POST /api/scans`（免 Turnstile：後端認這個擴充套件的 origin，`WHOSPOST_EXTENSION_IDS`；Origin 是客戶端自己填的，所以這條通道另有跨所有 IP 的全域上限 `EXT_SCAN_RATE_LIMITER`，每分鐘 5 次、只算真的會起跑的新查詢（已存結果、進行中的查詢不扣），超過回 429「即時查太頻繁，請稍後再試。」，擴充套件當一般失敗、可再試一次；沒綁 limiter 就是關閉），再輪詢 `GET /api/scans/:id` | 只在按下時送出那一個帳號名稱；每個安裝每小時最多 10 次（本機計數） | 晶片三態：**查詢中…**（灰、閃點，不擋滑動）→ **快篩 6 項中 N 項符合**（虛線框；後端只看了貼文與回覆頁第一頁，不收起、不變淡）→ 正式「6 項中 N 項符合」（≥3 照清單規則收起）或「查過、沒線索」／「查過、資料不足」；提示列「@xx 查好了」。**失敗＝回到「沒查過」**：沒有晶片、提示列說失敗並給「再試一次」，永遠不會顯示成 0 項 |

- **晶片** 點了開浮層：一句結論（例「留言像機器在發」）→ 原因晶片 → 一行「6 項檢查中 4 項符合、1 項不符合、1 項資料不足。查於 M/D。」→ 一行免責 → 主按鈕「信任這個帳號」＋次按鈕「看完整證據」（開正式站分享頁）。
- **收起列**「顯示」把整組展開成變淡＋晶片；「都信任」一次信任整組，不二次確認，靠提示列復原。
- **提示列** 信任／都信任／顯示／顯示全部後跳底部黑色一行「已信任 @xx，之後不再收起 · 復原」，5 秒內可復原。
- **右下角** 只在有收起時出現「已收起 N 則 · 顯示全部」；清單讀不到時（正式站目前 `WHOSPOST_LIST_ENABLED="0"` 回 404）是一行灰字「清單暫時無法讀取」，本串觀察與信任標記照常，**不會看起來像沒事**；Threads 版面變了就一顆紅藥丸「Threads 版面已變，等待更新」。
- **即時查** 沒查過的帳號 hover 名字才出現一顆小按鈕「即時查」（取代原本的放大鏡），點了就在原地查（上表）；本串觀察晶片的浮層裡也有「即時查」按鈕，浮層下方仍留「到 Whospost 網站查」連結。查完的結果存在本機一小時（`chrome.storage.local.live`，只有雜湊、分數與 scanId），重新整理或另一個分頁都看得到；清單下一次更新後就由清單接手。彈出視窗那一行「這小時還可以即時查 N 次」就是本機計數。
- 信任存在本機（`chrome.storage.local`）並送一次匿名申訴計數；取消信任從浮層按。

### 帳號背景（0.2，規格 §4.4；0.1.0 送審版不含）

- **畫面**：有晶片的作者，晶片後面一行灰字「2026-09 加入 · 台灣」（只放讀到的；不顯示粉絲數、追蹤數，Felix 10-24）；浮層多一段「帳號背景」：加入、所在地點、改名，最後一行「由 Threads 顯示，Whospost 不判定」。加入未滿 60 天，且本串則數 ≥ 晶片門檻或在清單上，晶片裡多一個灰色「新帳號」，說明寫「新帳號不等於假帳號」。不進任何分數。截圖：`docs/profile-1-chip-line.png`、`docs/profile-2-popover.png`。
- **來源**：content script 在 threads.com 同源、用使用者自己的登入狀態送兩個請求（名字懸停卡 GraphQL、「關於此個人檔案」Bloks）。細節、doc_id、量測日見 `docs/profile-lookup.md`。
- **守門**：只讀畫面上有晶片的作者；背景 service worker 管每 2 秒最多 1 個、每小時 60 個；結果存 `chrome.storage.local.profiles` 7 天，**只在本機、不送 Whospost**；連 3 次 429／403／讀不懂就停 6 小時，右下角 pill 多一段「帳號背景暫停」。
- **開關**：彈出視窗「讀取帳號背景（需登入 Threads）」預設開，關掉清快取；遠端開關是 `/api/health` 的 `extension.profileLookup`（Worker 變數 `WHOSPOST_PROFILE_LOOKUP`，預設開、設 `"0"` 關），背景每小時讀一次。
- **程式**：`lib/profile.mjs`（純函式：請求、解析、節流、快取、停機）、`lib/profile-runner.mjs`（content 端佇列）、`lib/profile-label.mjs`（文字），跟 `label.mjs` 分開放。

- **封鎖助手**（P2.7，規格 §4.5、§10.3 #21；**0.1.0 送審版不含，0.2 再上**）：浮層最下面一顆「到 Threads 封鎖 @xx」，收起列與晶片上不放。按了把帳號寫進 `chrome.storage.local.blockIntent`（30 秒內有效、用一次就刪），用 `window.open` 開該帳號個人頁的新分頁（不用 `chrome.tabs`、權限不變；選新分頁是為了不打斷你正在滑的那串）；新分頁的 content script 讀到指令才替你點「⋯ → 封鎖 → 確認」（`lib/block.mjs`），每一步用結構選擇器找、要剛好一個，找不到就停在那裡、頂端紅條寫「Threads 版面已變，請自己按（停在：…）」，不猜、不重試、不再點別的。一次一個；按下與跑完都把 `blockCooldownUntil` 設成 8 秒後，所有分頁的封鎖按鈕一起變灰倒數；沒有批次、沒有內建名單、不做檢舉。成功後帳號進本機 `blocked`（只存本機、不回傳），之後狀態是 `blocked`：不標、不收起；彈出視窗「已封鎖」看數量與清單、可移除（移除不會在 Threads 解除封鎖）。遠端開關：background 每小時讀 `/api/health` 的 `extension.block`（worker 讀 `WHOSPOST_EXTENSION_BLOCK`，預設 `"1"`）存 `flags`；沒讀到過或是 `false` 按鈕就不出現。
- **回報貢獻**（P2，彈出視窗可關，預設開）：每個貼文頁把「看了幾頁、比對幾個帳號、幾個在清單上、幾個被標、本串觀察幾個、收起幾則、按了幾次信任」累進本機當天（台北時間）的一筆；換天後第一次開 Threads 頁時，前一天那筆以 `POST /api/list/v1/telemetry` 送出（只帶 `kind`、版本號、日期、七個數字），然後歸零。健康檢查判定「版面已變」時另送一次 `dom_broken`（版本號＋日期），一天最多一次。不含帳號、雜湊、網址、安裝 ID；關掉時本機累計一併清掉。彈出視窗那一行「今天累計：…」就是會送出的內容。伺服器端只存按（日期、版本、種類）加總的列（`ext_telemetry` 表，進每日備份），看法：`POST /api/admin/ext-telemetry`（Bearer `ADMIN_TOKEN`，body `{"days":14}`）。

## 載入

1. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個 `extension/` 資料夾。
2. 開任何 `threads.com/@某人/post/…` 頁面，有可疑回覆時右下角出現「已收起 N 則 · 顯示全部」就是在跑；清單 API 關著時會是一行灰字「清單暫時無法讀取」。
3. 顯示方式（預設收起／只變淡／只標籤）、門檻、選舉模式（11/18–11/28 自動降成只標籤）、本串觀察開關都在工具列的彈出視窗；設定存 `chrome.storage.sync`。
4. 對本機 Worker 開發：彈出視窗「清單 → 進階：API 位址」填 `http://localhost:8787`（只收 https 或本機 http），清單、回報、申訴、即時查都改送那裡，頁面上的連結仍開正式站。Worker 這邊要用 `npx wrangler dev --var WHOSPOST_EXTENSION_IDS:<未封裝擴充套件的 ID> --var WHOSPOST_LIST_ENABLED:1` 起，ID 在 `chrome://extensions` 看得到；正式站的 `WHOSPOST_EXTENSION_IDS` 沒填＝即時查通道關著（POST 回 403）。

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
| `lib/state.mjs` | 狀態機：`none`／`info`／`fade`／`collapse`／`trusted`／`stale`／`group`／`blocked`，已封鎖最大、其次信任；`collapse` 是「該收起」的判斷，頁面上連續的 collapse 變成一個 `group`；「顯示」把 collapse 降成 fade，選舉模式把一切降成 info（只晶片） |
| `lib/settings.mjs` | 設定合併（帶 `schemaVersion`，整份寫回）、選舉視窗 11/18–11/28（台北） |
| `lib/label.mjs` | 晶片、收起列、浮層、藥丸、提示列的文字；一句結論照最強的命中項；六項規則名稱直接從 `signalScore` 讀 |
| `lib/hash.mjs` | `sha256(lowercase(username))`，Promise 快取 LRU 一萬筆 |
| `lib/report.mjs` | 回報貢獻的純邏輯：每頁只加「比上次多出來的」、按台北日期累計、換天交出前一天那筆、送失敗留著下次再送（最多兩天）、`dom_broken` 一天一次、彈出視窗那一行文字 |
| `lib/live.mjs` | 即時查的純邏輯：每小時 10 次的本機計數、`POST /api/scans` 回應怎麼讀（403＝白名單沒開，不是 Turnstile）、狀態頁 → 查詢中／快篩（`quick.partial`）／完成／失敗、輪詢節奏（前 30 秒每 2 秒、之後 3 秒、4 分鐘停）、本機一小時的結果快取 |
| `lib/block.mjs` | 封鎖助手：8 秒冷卻、跨分頁的一次性指令、本機已封鎖清單（讀取中／讀不到／空／清單）、步驟執行器（每步等元素出現、點一次、找不到就停）、Threads 個人頁的結構選擇器（10-24 登入狀態實測，寫在檔頭） |
| `lib/block-page.mjs` | 封鎖助手在個人頁那一半：讀指令、跑步驟、頂端一條結果、成功記進已封鎖、重設冷卻 |
| `lib/flags.mjs` | 正式站的遠端開關（`/api/health` → `extension`）：沒讀到過就算關 |
| `background.js` | 只做訊息路由：下載清單（`If-None-Match`）、申訴、回報貢獻（累計與送出都在這裡，開關關著就清掉不送）、即時查（`liveStart` 送一次帳號名稱並計數、`livePoll` 只帶 scanId 回狀態）、開彈出視窗；所有請求都送到設定裡的 API 位址 |
| `popup.html` / `popup.js` / `popup.css` | 彈出視窗：狀態燈、本頁統計、顯示方式與門檻、本串觀察、選舉模式、回報貢獻開關（＋今天累計那一行）、清單時間、信任清單、查一個帳號 |
| `icons/icon-{16,48,128}.png` | 工具列與商店圖示（橘色對話泡＋晶片的點），由 `scripts/extension-icons.mjs` 從一個 SVG 畫出來；128 那張同時是商店圖示 |
| `store/` | 上架包，不進 zip：`listing.zh-TW.md`／`listing.en.md`（商店文案）、`privacy-form.md`（隱私權規範分頁填答稿）、`screenshots/01–05.png`（1280×800）。見「怎麼打包」 |

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
node scripts/store-screenshots.mjs                    # 真實未登入頁 → extension/store/screenshots/01–05.png
node scripts/store-screenshots.mjs --from e2e-out     # 用跑過的 e2e 資料夾，不再打頁面
```

跑的是 `tests/extension/e2e/run.mjs --live --viewport 1280x800 --fake-api --mask`：清單灌假條目、即時查由腳本自己的假 API 回答（真實頁、沒有真的查詢、不碰正式站）；`--mask` 在每張截圖前把頁上所有帳號換成 `user01…` 與灰色頭像（含擴充套件自己的晶片、收起列、提示列、浮層），因為清單是假的，公開的商店圖不該把真實帳號擺在假線索旁邊。第五張是彈出視窗疊在頁面右上。icon 重畫：`node scripts/extension-icons.mjs`。

送審是 Felix 用自己的 Chrome 開發者帳號做，步驟清單在開 P3 的 PR 說明裡；上架後把正式 ID 填進正式站的 `WHOSPOST_EXTENSION_IDS`，即時查通道才會開。

## 還沒做

英文介面（`_locales`，`store/listing.en.md` 先備著）、首頁 feed、MAIN world 讀 GraphQL（§6.4 B）。
