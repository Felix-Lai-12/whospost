# AI 判讀 provider 對照：Gemini 3.8 Flash vs Claude Haiku 5.5（2026-10-24）

> 目的：決定要不要把 AI 行為判讀從 Gemini 切到 Claude。本檔記錄本機（`wrangler dev`）對同一批證據跑兩個 provider 的結果與每筆成本。切換方式見 README 的 `WHOSPOST_AI_PROVIDER`。

## 方法

1. 從本機 `data/whospost.sqlite` 匯出三個已完成查詢（`scripts/export-seed.mjs`），連同既有的 Gemini 判讀，匯入本機 Worker（`POST /api/admin/import`）。
2. `wrangler dev --var WHOSPOST_AI_PROVIDER:gemini`：hkj315 直接命中匯入的 Gemini 判讀（快取鍵相同，沒有再呼叫模型）；另外兩個帳號用 `POST /api/admin/scans/:id/ai-start`（本 PR 新增的 admin 路由）在本機新產生 Gemini 判讀。
3. `wrangler dev --var WHOSPOST_AI_PROVIDER:claude`：對同三個查詢再排一次判讀。provider 不同、快取鍵不同，所以 Gemini 判讀保留，Claude 另存一筆。
4. token 與費用讀自本機 Durable Object 的 `ai_jobs.usage` 與 `ai_attempts`（Workers Logs 裡的 `promptTokens` 等欄位目前會被 `worker/log.mjs` 的敏感字過濾成 `[redacted]`，見「待處理」）。

## 結果總表

| 帳號 | Gemini 輸入／輸出 token | Gemini 實際費用 | Claude 輸入／輸出 token | Claude 實際費用 | Claude 狀態 |
|---|---|---|---|---|---|
| @hkj315 | 17,844 / 1,044 | $0.0173 | 未取得 | 未取得（若 token 數與 Gemini 相近，依定價表約 $0.0023，**估算**） | preflight_failed：AI 預檢未完成，可重新嘗試。 |
| @hkj331155 | 9,677 / 1,112 | $0.0114 | 未取得 | 未取得（若 token 數與 Gemini 相近，依定價表約 $0.0015，**估算**） | preflight_failed：AI 預檢未完成，可重新嘗試。 |
| @_ian_xyz_ | 13,342 / 760 | $0.0129 | 未取得 | 未取得（若 token 數與 Gemini 相近，依定價表約 $0.0017，**估算**） | preflight_failed：AI 預檢未完成，可重新嘗試。 |

Gemini 定價 $0.75／$3.75 per 1M token（`server/ai/service.mjs` 既有常數）；Claude Haiku 5.5 定價 $0.10／$0.50 per 1M token（`server/ai/claude.mjs`，來源與日期寫在檔內）。「估算」欄只是把 Gemini 的 token 數套 Claude 定價，Claude 的 tokenizer 與思考 token 都會讓實際數字不同，不能當結論。

## Claude 這一側為什麼沒有結果

`~/.config/felix-agent/.env.local` 裡的 `ANTHROPIC_API_KEY` 直接打 `https://api.anthropic.com/v1/messages/count_tokens` 與 `/v1/messages` 都回 `401 authentication_error: invalid x-api-key`，所以三筆都停在預檢（`preflight_failed`，可重試、未計費）。依任務約定沒有另找其他金鑰。金鑰換成有效的之後，重跑步驟 3 即可：

```sh
# .dev.vars 放 ANTHROPIC_API_KEY（gitignored），再：
npx wrangler dev --port 8811 --var WHOSPOST_AI_PROVIDER:claude --var WHOSPOST_AI_LIMIT_USD:1
curl -X POST -H 'authorization: Bearer <ADMIN_TOKEN>' http://127.0.0.1:8811/api/admin/scans/<scanId>/ai-start   # 三個 scanId 各一次
curl http://127.0.0.1:8811/api/scans/<scanId>/ai
```

尚未在真實 API 上驗過的點（單元測試用 mock fetch 蓋過）：Haiku 5.5 回傳的 `model` 字串是否等於 `claude-haiku-5-5`（不等會被 `model_revision_mismatch` 擋成 `invalid_output`，不會誤顯示）；`output_config.effort:"low"` 在 `anthropic-version: 2023-06-01` 下是否被接受；1800 token 的 `max_tokens` 扣掉思考 token 後夠不夠寫完 JSON。

## Gemini 判讀原文（對外顯示的 conclusion 與 findings）

### @hkj315（匯入既有判讀（本機帳本 runtime/ai-account-ledger.sqlite，10-18 產生））

- assessment：`suspicious_behavior_observed`
- conclusion：該帳號在貼文中使用高度固定模板重複發布簡短口號，並在可見留言中高度集中以極短字詞回覆單一特定帳號，呈現值得注意的重複聲援模式。
- **以固定模板反覆發布加油口號：**貼文內容呈現明顯的模板化現象，主要透過置換特定人名或陣營反覆送出簡短聲援口號，這種發文方式偏向單向訊息傳遞，可能增加特定政治名詞與口號的曝光度。
- **集中以簡短感嘆詞回覆特定帳號：**該帳號對特定對象的互動頻率與回覆形式具備高度重複性，缺乏具體討論內容，可能為該特定帳號的貼文增加留言互動次數。

Claude：preflight_failed（AI 預檢未完成，可重新嘗試。）

### @hkj331155（本機 10-24 新產生）

- assessment：`suspicious_behavior_observed`
- conclusion：該帳號在 2026 年 7 月呈現高度模板化的口號連發，並於 2025 年 5 月至 8 月間集中對特定帳號數秒內連續送出「讚讚讚」「棒棒棒」等制式短句，呈現值得檢視的重複聲援模式。
- **使用固定造句模板連續發布政治口號：**貼文在兩天內密集以同一句型套換不同人名發布，且缺乏其他脈絡說明或討論，偏向以模板化短句反覆傳遞特定宣傳口號，可能增加此類政治訊息的曝光。
- **集中回覆單一帳號並在數秒內連續送出重複短語：**在同串數秒內接連送出無實質討論內容的重複短句，且發言對象高度集中在單一帳號，呈現反覆制式聲援的行為特徵，可能增加該特定作者貼文的留言量與互動可見度。

Claude：preflight_failed（AI 預檢未完成，可重新嘗試。）

### @_ian_xyz_（本機 10-24 新產生）

- assessment：`no_clear_suspicious_behavior`
- conclusion：本次可見活動多為個人軟體專案分享、技術討論與遊戲更新維護，互動具備實質情境，未見明確的可疑行為。
- **圍繞個人專案與技術議題進行實質回覆：**發言內容包含針對特定遊戲機制的說明、效能測試請求與功能更新清單，屬於開發者與使用者的自然技術互動，並非脫離情境的制式灌水或重複口號。
- **在不同貼文分享相同開源專案連結：**雖然在短時間內連續提供相同連結，但對照前後文為作者當天開發完成該專案後的推廣與分享，且回覆對象皆有其獨立脈絡，並未呈現大規模無差別洗版或異常放大現象。
- policyWarnings：`unsupported_intent_or_operator`（用詞規則只警告、仍顯示）

Claude：preflight_failed（AI 預檢未完成，可重新嘗試。）

## 待處理

- `worker/log.mjs` 的敏感字規則 `token` 也吃掉 `promptTokens`／`outputTokens`／`thoughtsTokens`，`gemini.generate` 在 Workers Logs 看不到 token 數（費用 `usd` 看得到）。ops-alerts 文件列的這幾個欄位目前實際上是 `[redacted]`。本 PR 沒改，另開處理。
- Claude 側對照待有效金鑰後補齊；補齊前「值不值得換」只能說：定價表上 Haiku 5.5 的輸入便宜 7.5 倍、輸出便宜 7.5 倍，品質未驗。
