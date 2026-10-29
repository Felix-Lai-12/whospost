# Whospost

**中文** | [English](README.en.md)

一眼看穿這個 Threads 帳號是不是怪怪的。

- 網站：<https://whospost.felixlai.workers.dev>
- Chrome 擴充套件「Whospost: 假帳號照妖鏡」：[Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/dmnleigohhkcfniapoblagpaecfnoeen)

貼上一個 Threads 公開帳號連結，或直接輸入 `@帳號`，Whospost 會抓它最近的公開貼文與本人留言，整理成六項可以逐條核對的行為線索。每一條線索都連回 Threads 原文，判斷留給你。

> 這不是「網軍機率」，Whospost 也不判定任何人是網軍。粉絲、客服、朋友互動都可能符合幾項；0 項不代表帳號正常，資料不足的項目會標成「資料不足」、不計入。

## 看哪六項

結果頁顯示「可疑跡象 N／6 項」，每出現一項算 1 項：

1. 發文內容重複：一半以上貼文是相同或相似內容。
2. 留言重複或空洞：同一句留言超過 5 次，或八成以上留言在 4 字以內。
3. 回覆對象集中：回覆超過 10 篇不同貼文，且過半留言回覆同一位作者。
4. 單串洗版：同一篇貼文下留言至少 11 則。
5. 互相集中回覆：本帳號和它最常回覆的帳號，彼此都把過半留言給了對方。
6. 短時間連發：同一篇貼文下，相鄰留言間隔 10 秒內至少 3 次。

另有兩項只顯示、不計分：AI 行為判讀（Gemini 依同一批證據寫觀察摘要，Gemini 拒絕時由 Claude Sonnet 接手；正式站開啟，自行部署預設關閉）與 [Cofacts](https://cofacts.tw/) 相關查核。完整門檻與依據見 [SCORING.md](SCORING.md)。

## 擴充套件

裝了擴充套件，在 Threads 貼文頁照常滑就能看：

- **名字旁直接看結果**：被查過的帳號，名字旁標出它符合的規則，例如「留言大量重複」。點一下看判讀，再點「看完整證據」連回原文。
- **沒查過？按「AI 打詐」**：名字旁按一下就查，查好直接標上，每小時 10 次。不管誰查的，結果所有使用者都看得到。
- **封鎖、檢舉不用翻選單**：封鎖幫你按到完成；檢舉只幫你打開 Threads 的檢舉視窗，原因由你選、由你送出。
- **帳號背景**（需登入 Threads）：名字旁顯示所在地國旗和加入多久，新帳號一眼看得出來。
- **自己的戰績**：點瀏覽器上的 Whospost 圖示，看你查了幾個、封鎖了幾個。

平常瀏覽不會送出任何帳號資料，比對在你的電腦裡完成；只有你按「AI 打詐」時，才會送出那一個帳號。開發、測試與打包見 [extension/README.md](extension/README.md)。

## 本機執行

需要 Node 24 以上與一組 Apify API token（需自行付費）。

```sh
npm run setup
python3 scripts/setup-token.py   # 安全輸入 Apify token，寫入 .env.local
npm run build
npm test
npm start
```

開啟 http://127.0.0.1:8788 。token 與金鑰只從環境變數或 `.env.local` 讀取，`.env*` 已在 `.gitignore`，不要放進前端或提交到 Git。

## 部署到 Cloudflare

正式站跑在 Cloudflare Workers，免費方案即可開始：`npx wrangler login`，設好 secret（Apify、AI 金鑰、Turnstile）並建立 R2 bucket，再 `npm run deploy`。完整步驟、所有環境變數、架構、花費上限與頻率限制、每晚備份、管理端點、流量統計、擴充套件用的 API 與費用，都在 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 限制

- 只看得到抓取當下的公開內容，不是完整發言歷史。
- 門檻是可解釋的暫定值，尚未用人工標註資料校準。
- 不分析政治立場、特定人名或媒體，也不提供「網軍名單」。

## 資料來源與授權

資料來自 Apify 上的 Threads 抓取 actor、Cloudflare Browser Rendering、Cofacts、Gemini 與 Claude API、invade 用詞字典等，完整清單與各自授權見 [data/SOURCES.md](data/SOURCES.md) 與 [docs/OPERATIONS.md](docs/OPERATIONS.md#11-資料來源與第三方授權)。

Whospost 自有程式碼採用 [Apache License 2.0](LICENSE)：免費，可使用、修改、fork、再散布與商業使用，也可做閉源變體；再散布須附上授權、保留聲明並標示修改過的檔案。非營利營運是專案方向，不是對使用者的限制。第三方套件與資料來源仍適用各自授權；API key、本機資料庫與原始抓取資料不屬於公開發行內容，自行部署者須自備憑證並負擔費用；本授權不包含 Whospost 名稱與標誌的商標使用權。歡迎用 Issue 提問、用 Pull Request 貢獻，貢獻除另行約定外依 Apache 2.0 處理。
