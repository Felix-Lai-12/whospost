# Whospost 留言線索（Chrome 擴充套件，P1 MVP，尚未上架）

在 Threads **貼文頁**邊滑邊把可疑回覆讓開：清單命中 ≥3 項的回覆預設收成一列「已收起 N 則 · 原因 · 顯示 · 都信任」（像 Instagram 的「查看更多回覆」），其他線索只在名字旁放一顆小晶片，點晶片才看原因。畫面照 `100_Todo/specs/011-whospost/EXTENSION-UI-REDESIGN-20261023.md`，判斷邏輯照 `EXTENSION-SPEC-20261022.md` §4／§6；本檔只講怎麼用與怎麼改。

| 線索 | 來源 | 連網 | 畫面 |
|---|---|---|---|
| **Whospost 查詢結果** | 整份雜湊清單 `GET /api/list/v1/export/threads-accounts.json`，約每小時下載一次存在本機，比對在記憶體 | 每小時一個請求，不帶 cookie，不送任何帳號資訊 | ≥3 項符合：收起（預設）或變淡＋橘晶片「6 項中 4 項符合」；0–2 項：灰晶片，不收不淡 |
| **本串觀察** | 只讀眼前已載入的回覆，本機計算 | 否 | 同帳號 ≥5 則：灰藍晶片「本串 N 則」；≥10 則才收起；相同內容 ≥3 個帳號：晶片。**本串的標記只掛在該帳號在本串的第一則**（頁面順序最前的那則），後面同帳號的回覆不再重複出現晶片、不變淡、不收起（Felix 10-23） |

- **晶片** 點了開浮層：一句結論（例「留言像機器在發」）→ 原因晶片 → 一行「6 項檢查中 4 項符合、1 項不符合、1 項資料不足。查於 M/D。」→ 一行免責 → 主按鈕「信任這個帳號」＋次按鈕「看完整證據」（開正式站分享頁）。
- **收起列**「顯示」把整組展開成變淡＋晶片；「都信任」一次信任整組，不二次確認，靠提示列復原。
- **提示列** 信任／都信任／顯示／顯示全部後跳底部黑色一行「已信任 @xx，之後不再收起 · 復原」，5 秒內可復原。
- **右下角** 只在有收起時出現「已收起 N 則 · 顯示全部」；清單讀不到時（正式站目前 `WHOSPOST_LIST_ENABLED="0"` 回 404）是一行灰字「清單暫時無法讀取」，本串觀察與信任標記照常，**不會看起來像沒事**；Threads 版面變了就一顆紅藥丸「Threads 版面已變，等待更新」。
- **放大鏡** 沒查過的帳號 hover 名字才出現，點了開新分頁到 `https://whospost.felixlai.workers.dev/?u=<帳號>&from=ext` 預填，查詢要使用者自己按。
- 信任存在本機（`chrome.storage.local`）並送一次匿名申訴計數；取消信任從浮層按。

## 載入

1. `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個 `extension/` 資料夾。
2. 開任何 `threads.com/@某人/post/…` 頁面，右下角出現 `Whospost · …` 藥丸就是在跑。
3. 顯示方式（預設收起／只變淡／只標籤）、門檻、選舉模式（11/18–11/28 自動降成只標籤）、本串觀察開關都在工具列的彈出視窗；設定存 `chrome.storage.sync`。

`lib/signals.mjs` 是 symlink 到 repo 的 `shared/signals.mjs`：正規化（`norm`／`bare`／`common`）與六項規則的名稱跟正式站同一份。Chrome 載入未封裝項目時會跟著 symlink；上架打包前用 `zip -r`（預設跟隨 symlink）或先複製成實體檔。

## 檔案

| 檔 | 做什麼 |
|---|---|
| `manifest.json` | MV3，`permissions:["storage"]`，host 只開 threads.com／threads.net／正式站；無 tabs／scripting／webRequest |
| `content.js` | 入口（classic script）：動態 `import()` 自己的 `lib/engine.mjs`，接 `chrome.storage` 與 background |
| `lib/engine.mjs` | 引擎：MutationObserver＋passive scroll → 一次 `requestIdleCallback`；只重畫 render key 變了的容器；連續可疑回覆合成一組（`groupRuns`）由第一則的收起列代表；晶片、浮層、提示列、藥丸；健康檢查連三次「≥10 個 post 連結但 0 個作者」就停下並標「版面已變」 |
| `lib/parse.mjs` | 解析器：容器 `div[data-pressable-container="true"]`、作者 `a[href^="/@"]`、永久連結 `a[href*="/post/"]`；介面固定「給容器，回 `{username, shortcode, text}`」，之後換資料來源不動引擎 |
| `lib/thread.mjs` | 本串觀察：每帳號留言數、相同內容的帳號數；文字用 `norm`，排除 `common()` 與 ≤4 字 |
| `lib/list.mjs` | 清單快取模型：版本檢查（`signals-v2`）、1 小時 TTL、失敗 5 分鐘後再試、`fresh`／`stale`／`missing` 三態 |
| `lib/state.mjs` | 狀態機：`none`／`info`／`fade`／`collapse`／`trusted`／`stale`／`group`，信任永遠最大；`collapse` 是「該收起」的判斷，頁面上連續的 collapse 變成一個 `group`；「顯示」把 collapse 降成 fade，選舉模式把一切降成 info（只晶片） |
| `lib/settings.mjs` | 設定合併（帶 `schemaVersion`，整份寫回）、選舉視窗 11/18–11/28（台北） |
| `lib/label.mjs` | 晶片、收起列、浮層、藥丸、提示列的文字；一句結論照最強的命中項；六項規則名稱直接從 `signalScore` 讀 |
| `lib/hash.mjs` | `sha256(lowercase(username))`，Promise 快取 LRU 一萬筆 |
| `background.js` | 只做訊息路由：下載清單（`If-None-Match`）、申訴、開彈出視窗 |
| `popup.html` / `popup.js` / `popup.css` | 彈出視窗：狀態燈、本頁統計、顯示方式與門檻、本串觀察、選舉模式、清單時間、信任清單、查一個帳號 |

## 測試

```bash
npm test
```

`tests/extension/` 蓋純邏輯：狀態機（含 `group` 的連續合併）、本串規則、清單快取三態、設定合併與選舉視窗、解析器（用照 2026-10-23 實測結構寫的假 DOM fixture）、文案（晶片／浮層／收起列／提示列）、manifest 與權限。真實頁用 `docs/e2e-playwright.mjs`（Playwright Chromium 載入 `extension/` 打 threads.com，截圖在 `docs/`）。

## 還沒做（P2／P3）

回報貢獻（`dom_broken` 與每日比對次數）、e2e 自動化進 CI、Web Store listing／icon／截圖包、首頁 feed、MAIN world 讀 GraphQL（§6.4 B）。
