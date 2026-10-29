# Chrome Web Store 商店文案（繁體中文）

> 送審時把下面各欄貼進開發者後台「商店資訊」分頁。名稱與一句話簡介是後台直接從 `manifest.json` 的 `name`／`description` 讀的，這裡只是對照；要改就改 manifest（`tests/extension/store.test.mjs` 會核對兩邊一致）。
>
> **0.2.0（Felix 10-29）**：「看哪六項」改成「看哪七項」，第七項是 AI 判讀；其餘照 0.1.0。
>
> **0.1.0 送審版**：含AI 打詐、帳號背景、封鎖助手三項（Felix 10-25 決定一起送審）；10-26 改成只標籤、不收起，彈出視窗改成三格儀表板、沒有功能開關。

## 名稱（manifest `name`，≤ 75 字元）

Whospost: 假帳號照妖鏡

## 一句話簡介（manifest `description`，≤ 132 字元；目前 89）

在 Threads 貼文頁邊滑邊看，看到有嫌疑的，直接在頭貼旁按「AI 打詐」分析。只要是被 Whospost 查過的帳號，名字旁都會直接標記分析結果，任何用戶都可以直接看結果。

## 詳細說明（後台「說明」欄，≤ 16,000 字元）

Threads 留言區裡，誰在認真討論、誰在帶風向？Whospost 把帳號的行為線索直接標在名字旁邊，你照常滑，不用另外開網站查。

【主要功能】

● 名字旁直接看結果
被 Whospost 查過的帳號，名字旁會標出它符合的規則，例如「留言大量重複」。點一下看判讀說明，再點「看完整證據」，每條線索都連回 Threads 原文。

● 沒查過？按「AI 打詐」當場查
沒查過的帳號，名字旁有「AI 打詐」按鈕，按一下就查，查好直接標上（每小時 10 次）。不管是誰查的，結果所有使用者都看得到。

● 封鎖、檢舉不用翻選單
點開標籤就有「封鎖此用戶」「檢舉此用戶」。封鎖幫你按到完成；檢舉幫你打開 Threads 的檢舉視窗，原因由你選、由你送出。

● 帳號背景（需登入 Threads）
名字旁顯示所在地國旗和「幾年前加入」，新帳號一眼就看得出來。

● 留言抓取（0.2.0 起；需登入 Threads）
你按「AI 打詐」時，順手用你的登入狀態讀那個帳號公開的最近 25 則回覆送回 Whospost，查得更快、更省。只在你按下時讀那一個帳號；可在擴充套件視窗關掉。

● 自己的戰績
點瀏覽器上的 Whospost 圖示，看你查了幾個、封鎖了幾個。

【看哪七項】
貼文內容重複、留言大量重複、半數以上給同一作者、同篇超過 10 次、互相集中回覆、10 秒內連留 3 次，以及 AI 判讀有沒有疑慮（AI 可能判錯，只是一項觀察）。

【原則】
・只列線索、附原文，不判定任何人是網軍，判斷留給你。
・平常瀏覽不會送出任何帳號資料，比對在你的電腦裡完成；只有你按「AI 打詐」時，才會送出那一個帳號（和它公開的最近 25 則回覆）。詳見隱私權政策。
・免費，程式碼開源：https://github.com/Felix-Lai-12/whospost

## 分類

社交與通訊（Social & Communication）

## 語言

中文（繁體）

## 網址

- 官方網站／首頁：https://whospost.felixlai.workers.dev/
- 支援網址：https://whospost.felixlai.workers.dev/
- 隱私權政策：https://whospost.felixlai.workers.dev/privacy

## 其他欄位

- 成人內容：否
- 付費：免費
- 圖示：`extension/icons/icon-128.png`（跟 manifest 同一個檔）
- 截圖：`extension/store/screenshots/01`–`04`（1280×800，24 位元 PNG，無透明）
- 宣傳圖：小型 440×280 `extension/store/promo/promo-small-440x280.png`、大型 1400×560 `extension/store/promo/promo-marquee-1400x560.png`（10-27，24 位元 PNG，見 `promo/README.md`）
- 宣傳影片：只收 YouTube 連結；片子是 whospost-intro-video 的 `WhospostExtWide`（橫式，商店用）與 `WhospostExt`（直式，社群用），上傳 YouTube 後把連結貼進後台
