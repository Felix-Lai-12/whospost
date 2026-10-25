# 帳號背景：怎麼向 Threads 讀、量過什麼

> EXTENSION-SPEC §4.4、§10.3 #17–20。實測日：**2026-10-24**，用本機已登入 Threads 的 Chrome（繁中介面）。
> 0.1.0 送審版就含這個功能（Felix 10-25 決定）。

## 讀的是什麼

一位作者出現在畫面上、而且他的晶片要顯示時，擴充套件在 threads.com 頁面裡（同源、帶使用者自己的登入狀態）送兩個請求，讀的是 Threads 本來就會顯示給這位使用者的東西：

| 欄位 | 來源 | 畫面上原本在哪 |
|---|---|---|
| user id（請求 2 要用） | 請求 1：名字懸停卡（GraphQL） | 滑過作者名字跳出的卡片 |
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

- 回 `data.user {pk, username, follower_count, text_post_app_is_private, …}`。只用 `pk`：**粉絲數、追蹤數不顯示也不存**（Felix 10-24 決定）；查無此帳號時 `data.user` 是 `null`（記成「Threads 找不到」，不重試）。
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
- 「已加入」後面的 `· #1`、`· 1 億+` 是 Threads 的註冊序號，看起來像人數，容易看錯，所以浮層只顯示年月。

## 量過、沒採用：追蹤數與追蹤名單（10-24）

Felix 10-24 先要加「追蹤中」，看過畫面後改決定：粉絲數、追蹤數、追蹤名單都不顯示，也不送這兩支請求。下面是當天實測的紀錄，留著備查；程式裡沒有這兩支請求，e2e 也斷言它們不會被送出。

### 追蹤中人數

打開個人檔案的粉絲對話框時，頁面先送這個查詢拿兩個數字：

```
POST /graphql/query（header 同請求 1）
doc_id=28576749875360398
fb_api_req_friendly_name=BarcelonaFriendshipsDialogUserQuery
variables={"shouldFetchMutualsCount":false,"userID":"<pk>"}
```

- 回 `data.counts {total_followers_count, total_following_count}`，旁邊是 `data.user {username, id}`。不需要 relay 變數。
- 名字懸停卡（請求 1）沒有追蹤數，只有 `follower_count`，要拿追蹤數就得多這一個請求。
- `shouldFetchMutualsCount:true` 會多一個 `data.mutuals`，對 @zuck 是 `null`；沒用到。

### 追蹤名單

對話框切到「追蹤中」分頁、往下捲時，頁面送的是：

```
第一頁  doc_id=29370968055842812  BarcelonaFriendshipsFollowingTabQuery
        variables={"first":20,"userID":"<pk>", 4 個 __relay_internal__pv__* 布林值}
下一頁  doc_id=28984401214579267  BarcelonaFriendshipsFollowingTabRefetchableQuery
        variables={"after":"20","first":20,"id":"<pk>", 3 個 relay 布林值}
```

- 回 `data.user.following`（第一頁）或 `data.fetch__XDTUserDict.following`（下一頁），裡面是 `edges[].node {pk, username, full_name, profile_pic_url, follower_count, friendship_status, …}` 和 `page_info {end_cursor, has_next_page}`。
- 分頁游標是數字位移（`"20"`、`"40"`），不是不透明字串。
- **第一頁最多 20**：`first` 給 30 或 50 都回 `execution error`。下一頁 `first:20` 回 20、`first:10` 回 10、`first:30` 只回 25。要前 50 個就得 20＋20＋10 三個請求。
- **排序不穩定、分頁會重疊**：同一個 `after:"20"`，兩次請求的第一筆不同；一個追蹤 40 人的帳號，兩頁共 40 筆裡有 3 筆重複。要用的話必須去重，而且讀到的數量會比追蹤數少。
- `friendship_status.following` 是**登入者自己**有沒有追蹤這個人：拿登入者自己的追蹤名單測，20/20 都是 true。
- 每位作者多 1 個（追蹤數）到 4 個（再加名單）請求，每小時 60 個請求的額度會只剩 10–20 位作者。

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
| 只讀畫面上的作者 | 只排在 viewport 裡、晶片要顯示（在名單上或本串命中）、沒被信任的作者 | `engine.mjs` `onScreenChipAuthors` |
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

`profile-1-chip-line.png`、`profile-2-popover.png` 是 #66 那版 `screenshots-0.2/07`、`08` 的副本（#65 重拍整套後，同一類畫面在 `08-background-line.png`、`09-background-popover.png`）：2026-10-24 在本機已登入的 Chrome（淺色模式）開一則公開串，把擴充套件的 engine（同一份程式碼，storage 換成記憶體版）注入頁面跑真實請求。名單項目是假的（為了讓晶片出現），帳號背景是真的讀到的值；作者名字換成 userNN、頭像換成灰色。完整流程與每張的驗證狀態見 `screenshots-0.2/README.md`。
