# Whospost 留言線索（Chrome 擴充套件，P1 MVP，尚未上架）

在 Threads **貼文頁**已載入的回覆旁顯示兩種線索，畫面照 Blocky 的三件套（回覆上方一條標籤、回覆本體變淡不隱藏、右下角計數器），引擎照 KillSlop 的骨架（只認結構不認 class、閒置批次掃描、狀態寫在 data 屬性、使用者標記永遠最大）。規格在 `100_Todo/specs/011-whospost/EXTENSION-SPEC-20261022.md`，本檔只講怎麼用與怎麼改。

| 線索 | 來源 | 連網 | 什麼時候出現 |
|---|---|---|---|
| **Whospost 查詢結果** | 整份雜湊清單 `GET /api/list/v1/export/threads-accounts.json`，約每小時下載一次存在本機，比對在記憶體 | 每小時一個請求，不帶 cookie，不送任何帳號資訊 | 作者在清單裡：0–2 項符合出灰藍條，≥3 項變淡（橘條），開折疊且 ≥4 項才折疊 |
| **本串觀察** | 只讀眼前已載入的回覆，本機計算 | 否 | 同帳號在這串 ≥5 則出條、≥10 則變淡；相同內容出現在 ≥3 個帳號出條 |

沒查過也沒命中的作者名旁有一個 14px 灰色放大鏡（可關），點了開新分頁到 `https://whospost.felixlai.workers.dev/?u=<帳號>&from=ext` 預填，查詢要使用者自己按。「信任」存在本機（`chrome.storage.local`）並送一次匿名申訴計數；「顯示」只恢復這一則。清單讀不到時（正式站目前 `WHOSPOST_LIST_ENABLED="0"` 回 404）計數器寫「清單暫時無法讀取」，本串觀察與信任標記照常，**不會看起來像沒事**。

## 載入

1. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個 `extension/` 資料夾。
2. 開任何 `threads.com/@某人/post/…` 頁面，右下角出現 `Whospost · …` 藥丸就是在跑。
3. 門檻、顯示方式、選舉模式、本串觀察開關都在工具列的彈出視窗；設定存 `chrome.storage.sync`。

`lib/signals.mjs` 是 symlink 到 repo 的 `shared/signals.mjs`：正規化（`norm`／`bare`／`common`）與六項規則的名稱跟正式站同一份。Chrome 載入未封裝項目時會跟著 symlink；上架打包前用 `zip -r`（預設跟隨 symlink）或先複製成實體檔。

## 檔案

| 檔 | 做什麼 |
|---|---|
| `manifest.json` | MV3，`permissions:["storage"]`，host 只開 threads.com／threads.net／正式站；無 tabs／scripting／webRequest |
| `content.js` | 入口（classic script）：動態 `import()` 自己的 `lib/engine.mjs`，接 `chrome.storage` 與 background |
| `lib/engine.mjs` | 引擎：MutationObserver＋passive scroll → 一次 `requestIdleCallback`；只重畫 render key 變了的容器；計數器；健康檢查連三次「≥10 個 post 連結但 0 個作者」就停下並標「版面已變」 |
| `lib/parse.mjs` | 解析器：容器 `div[data-pressable-container="true"]`、作者 `a[href^="/@"]`、永久連結 `a[href*="/post/"]`；介面固定「給容器，回 `{username, shortcode, text}`」，之後換資料來源不動引擎 |
| `lib/thread.mjs` | 本串觀察：每帳號留言數、相同內容的帳號數；文字用 `norm`，排除 `common()` 與 ≤4 字 |
| `lib/list.mjs` | 清單快取模型：版本檢查（`signals-v2`）、1 小時 TTL、失敗 5 分鐘後再試、`fresh`／`stale`／`missing` 三態 |
| `lib/state.mjs` | 狀態機：`none`／`info`／`fade`／`collapse`／`trusted`／`stale`，信任永遠最大，「顯示」與選舉模式把 fade／collapse 降成 info |
| `lib/settings.mjs` | 設定合併（帶 `schemaVersion`，整份寫回）、選舉視窗 11/18–11/28（台北） |
| `lib/label.mjs` | 標籤條、為什麼卡、計數器的文字；六項規則名稱直接從 `signalScore` 讀 |
| `lib/hash.mjs` | `sha256(lowercase(username))`，Promise 快取 LRU 一萬筆 |
| `background.js` | 只做訊息路由：下載清單（`If-None-Match`）、申訴、開彈出視窗 |
| `popup.html` / `popup.js` / `popup.css` | 彈出視窗：狀態燈、本頁統計、顯示方式與門檻、本串觀察、選舉模式、清單時間、信任清單、查一個帳號 |

## 測試

```bash
npm test
```

`tests/extension/` 蓋純邏輯：狀態機、本串規則、清單快取三態、設定合併與選舉視窗、解析器（用照 2026-10-23 實測結構寫的假 DOM fixture）、文案、manifest 與權限。真實頁用 Playwright Chromium 載入 `extension/` 打 threads.com 實測（見 PR）。

## 還沒做（P2／P3）

回報貢獻（`dom_broken` 與每日比對次數）、e2e 自動化進 CI、Web Store listing／icon／截圖包、首頁 feed、MAIN world 讀 GraphQL（§6.4 B）。
