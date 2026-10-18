# Whospost 資料來源（2026-10-17 核對）

- 主貼文／搜尋：[automation-lab/threads-scraper](https://apify.com/automation-lab/threads-scraper)。`mode: posts|profile|search`、`usernames`、`searchQueries`、`maxPosts`（每帳號／query）、`includeProfile`。主 actor 明確不提供留言全文；replyCount 不當成留言內容。
- 本人留言：[benthepythondev/threads-user-posts-scraper](https://apify.com/benthepythondev/threads-user-posts-scraper)。`mode: replies`、`usernames`、`maxResults:50`，辨識 `record_type=reply`、本人 username、`is_reply`；`reply_to_url` 與 `reply_to_author` 是父文線索。實際公開可見數可能少於50。
- 非同步工作與限額：[Apify run API](https://docs.apify.com/api/v2/actors-runs-post)。使用 `maxTotalChargeUsd`、`restartOnError:false`；所有付費 POST 前持久化預留。第一次啟動回應不明時不自動重送。
- 字彙：[caris-events/invade](https://github.com/caris-events/invade)，commit `cbc7bdce2ca76cd971c66bf33666221e4ed665f8`。完整匯入 `database/vocabs` 374 個 YAML `word` 欄位；文字 CC0，來源碼 MIT。`vocabulary.json` 每條保留版本化來源 URL。命中字彙只描述用語，不能推論國籍、立場或幕後組織。
- 查核：[Cofacts GraphQL](https://api.cofacts.tw/)、[原始碼](https://github.com/cofacts/rumors-api)。POST `/graphql`，`ListArticles` + `moreLikeThis`，最多3筆候選；每筆保留查核回應分類、原文、來源 URL。資料 CC BY-SA 4.0，顯示 Cofacts 與協作者署名與授權連結。2026-10-17 無 app-secret 唯讀查詢已成功；官方仍建議申請 app-secret。查核候選不等於該帳號散播假訊息，更不當帳號評分標籤。

## 取得上限

單輪主文10、本人留言50、最多5個長文字查詢，各最多10結果。工作費用封頂分別 $0.15、$0.20、$0.30；總共預留至多 $0.65，必須受 server 持久化 $1 總帳約束。搜尋是有限樣本，取不到不是無風險；剩餘預算不由 provider 自動重試消耗。

## 驗證

`node --test tests/providers/providers.test.mjs`：作者身分與父文、5 queries上限、費用caps、啟動前狀態保存、不明POST不重送、恢復不再啟動工作、Cofacts錯誤與no_match區別、完整bundle與374字詞載入。所有mock資料只存在tests；沒有假冒目標帳號的發文。

真實驗收新增：benthepythondev posts補充（cap .10）；關鍵詞候選搜尋（cap .20）。全部run cap總和 .95；usageTotalUsd 結束當下可能尚未入帳完成，保留完整cap防低估。

## 社群提供的來源紀錄

本專案不收錄任何社群提供的帳號名單。
