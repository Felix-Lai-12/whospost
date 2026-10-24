# 帳號背景：怎麼向 Threads 讀、量過什麼

> EXTENSION-SPEC §4.4、§10.3 #17–20。實測日：**2026-10-24**，用本機已登入 Threads 的 Chrome（繁中介面）。
> 這是 0.2 的功能；**0.1.0 送審版不含**。

## 讀的是什麼

一位作者出現在畫面上、而且他的晶片要顯示時，擴充套件在 threads.com 頁面裡（同源、帶使用者自己的登入狀態）送兩個請求，讀的是 Threads 本來就會顯示給這位使用者的東西：

| 欄位 | 來源 | 畫面上原本在哪 |
|---|---|---|
| 粉絲數、是否私人帳號、user id | 請求 1：名字懸停卡（GraphQL） | 滑過作者名字跳出的卡片 |
| 加入年月、所在地點、改名次數 | 請求 2：「關於此個人檔案」對話框（Bloks） | 個人檔案「⋯」→ 關於此個人檔案 |

讀到的資料只存在使用者電腦（`chrome.storage.local` 的 `profiles`，7 天），**不送給 Whospost**，也不進任何分數。

## 請求 1：名字懸停卡

```
POST https://www.threads.com/graphql/query
Content-Type: application/x-www-form-urlencoded
X-CSRFToken: <csrftoken cookie>
X-IG-App-ID: 238260118697367
X-FB-LSD: <lsd>
X-FB-Friendly-Name: BarcelonaUsernameHovercardImplDirectQuery

doc_id=29110045098632409
fb_api_req_friendly_name=BarcelonaUsernameHovercardImplDirectQuery
fb_api_caller_class=RelayModern
variables={"username":"<帳號>", ...頁面自己帶的 6 個 __relay_internal__pv__* 布林值}
fb_dtsg / lsd / jazoest / __a=1 / __comet_req=29 / __d=www / server_timestamps=true
```

- 回 `data.user {pk, username, follower_count, text_post_app_is_private, …}`；查無此帳號時 `data.user` 是 `null`（記成「Threads 找不到」，不重試）。
- 10-24 量到的必要條件：少了 relay 變數 → 回應裡沒有 user；少了 `X-CSRFToken` → 403。
- `doc_id` 是 Threads 前端打包的查詢編號，改版就會換。換了會回讀不懂的答案 → 算一次「讀不懂」（見下方自動暫停）。

## 請求 2：「關於此個人檔案」

這不是 GraphQL，沒有 doc_id；是 Bloks 的 async action：

```
POST https://www.threads.com/async/wbloks/fetch/?appid=com.bloks.www.text_post_app.about_this_profile_async_action&type=app&__bkv=<WebBloksVersioningID>&hl=zh-tw
Content-Type: application/x-www-form-urlencoded
X-FB-LSD: <lsd>

params={"referer_type":"TextPostAppProfileOverflow","target_user_id":"<請求 1 的 pk>"}
fb_dtsg / lsd / jazoest / __a=1 / __comet_req=29 / __d=www
```

- `params` 改用 `target_username` 會回 500，所以一定要先跑請求 1 拿 pk。
- 回應去掉 `for (;;);` 後是 JSON，畫面樹在 `payload.layout.bloks_payload`：
  - 所在地點：`data[]` 裡 key 結尾 `:about_this_profile_country` 的 `initial`（字串），`…_country_visibility` 是布林（false＝對方沒分享）。
  - 其他列：文字依畫面順序出現，標籤和值之間夾著樣式字串（`14sp`、色碼、粗細），所以取「標籤後面第一個長得像值的字串」。
- 10-24 繁中（`hl=zh-tw`）量到的標籤：`名稱`、`已加入`（值如 `2023年7月 · #1`）、`先前的用戶名稱`（值如 `在 Threads 變更過 1 次`）、`所在地點`、`Meta 驗證`。英文介面對應 `Name`、`Joined`、`Former usernames`、`Based in`、`Verified by Meta`；程式兩種都認。
- 指定 `hl=zh-tw` 是為了讓標籤固定是已知的那幾個，不跟著使用者介面語言跑。
- 沒有「先前的用戶名稱」這列＝沒改過名（記 0）；有這列但讀不到數字＝記「有改過，次數沒讀到」。
- 「已加入」後面的 `· #1`、`· 1 億+` 是 Threads 的註冊序號，跟粉絲數擺在一起容易看錯，所以浮層只顯示年月。

## Token 從哪來

都從目前這頁讀，不另外要：

- `fb_dtsg`：頁內 script `"DTSGInitialData",[],{"token":"…"}`
- `lsd`：`"LSD",[],{"token":"…"}`
- `__bkv`：`"WebBloksVersioningID",[],{"versioningID":"<64 位 hex>"}`
- `jazoest`：`"2"` + fb_dtsg 每個字元碼相加
- `csrftoken` cookie；`ds_user_id` cookie 存在＝已登入。沒登入就不送，畫面寫「登入 Threads 後才會顯示」。

## 守門規則（§4.4）

| 規則 | 怎麼做 | 程式 |
|---|---|---|
| 只讀畫面上的作者 | 只排在 viewport 裡、晶片要顯示（在名單上或本串命中）的作者 | `engine.mjs` `onScreenChipAuthors` |
| 每 2 秒最多 1 個請求、每小時 60 個 | 背景 service worker 記每次送出的時間；一位作者要兩個請求 | `profile.mjs` `slot`／`recordRequest` |
| 7 天本機快取 | 讀到的才存；失敗不存，10 分鐘後再試 | `cacheGet`／`cachePut` |
| 連 3 次 429/403/讀不懂就停 | 停 6 小時；pill 顯示「帳號背景暫停」；彈出視窗關掉再打開可立刻重試 | `noteOutcome`／`paused` |
| 遠端開關 | Worker `/api/health` 回 `extension.profileLookup`（變數 `WHOSPOST_PROFILE_LOOKUP`，預設開，設 `"0"` 關）；背景每小時讀一次 | `worker/app.mjs` `extensionSwitches`、`flagFromHealth` |
| 使用者開關 | 彈出視窗「讀取帳號背景（需登入 Threads）」，預設開；關掉會清空快取 | `popup.js` |

網路錯誤、5xx 不算進「連續失敗」，也不清掉它。

## 已知會壞的地方

- `doc_id`、relay 變數、Bloks appid 都是 Threads 前端的內部細節，改版就可能失效。失效時的樣子：連 3 次讀不懂 → 自動暫停，不會一直打。
- 標籤文字改了（例如「已加入」換字）→ 讀不到加入年月 → 算讀不懂。
- Threads 要求的 header 變多 → 403 → 算被拒絕。

## 截圖怎麼來的

`profile-1-chip-line.png`、`profile-2-popover.png`：2026-10-24 在本機已登入的 Chrome 開一則公開串，把擴充套件的 engine（同一份程式碼，storage 換成記憶體版）注入頁面跑真實請求。名單項目是假的（為了讓晶片出現），帳號背景是真的讀到的值；作者名字換成 userNN、頭像換成灰色。測試用的注入工具沒有進 repo。
