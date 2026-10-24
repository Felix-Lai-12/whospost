# AI 判讀 provider 對照：Gemini 3.8 Flash vs Claude Haiku 5.5（2026-10-24）

> 目的：決定要不要把 AI 行為判讀從 Gemini 切到 Claude。本檔記錄本機（`wrangler dev`）對同一批證據跑兩個 provider 的結果與每筆成本。切換方式見 README 的 `WHOSPOST_AI_PROVIDER`。

## 方法

1. 從本機 `data/whospost.sqlite` 匯出三個已完成查詢（`scripts/export-seed.mjs`），連同既有的 Gemini 判讀，匯入本機 Worker（`POST /api/admin/import`）。
2. `wrangler dev --var WHOSPOST_AI_PROVIDER:gemini`：hkj315 直接命中匯入的 Gemini 判讀（快取鍵相同，沒再呼叫模型）；另外兩個帳號用 `POST /api/admin/scans/:id/ai-start`（本 PR 新增的 admin 路由）在本機新產生 Gemini 判讀。
3. `wrangler dev --var WHOSPOST_AI_PROVIDER:claude`：對同三個查詢再排一次判讀。provider 不同、快取鍵不同，Gemini 判讀保留，Claude 另存一筆。
4. token 與費用讀自本機 Durable Object 的 `ai_jobs.usage` 與 `ai_attempts`（Workers Logs 的 `promptTokens` 等欄位目前被 `worker/log.mjs` 的敏感字規則遮成 `[redacted]`，見「待處理」）。

## 結果總表

| 帳號 | Gemini 輸入／輸出 token | Gemini 費用 | Gemini 狀態 | Claude 輸入／輸出 token | Claude 費用 | Claude 狀態 | 耗時（Claude） |
|---|---|---|---|---|---|---|---|
| @hkj315 | 17,844 / 1,044 | $0.0173 | ready | 21,707 / 1,722 | $0.0030 | invalid_output | 11.9 秒 |
| @hkj331155 | 9,677 / 1,112 | $0.0114 | ready | 12,214 / 1,277 | $0.0019 | ready | 6.9 秒 |
| @_ian_xyz_ | 13,342 / 760 | $0.0129 | ready | 17,609 / 1,612 | $0.0026 | ready | 9.4 秒 |

三筆合計：Gemini $0.0416，Claude $0.0075（約 1/6）。Claude 的輸入 token 比 Gemini 多約 2 成到 3 成（tokenizer 不同，同一份證據），輸出多約 5 成到 1 倍；便宜是定價差（$0.10／$0.50 對 $0.75／$3.75 per 1M）壓過來的。

Gemini 定價是 `server/ai/service.mjs` 既有常數；Claude Haiku 5.5 定價在 `server/ai/claude.mjs`，來源與日期寫在檔內。費用是帳本的實際結算值（`ai_attempts.actual`），不是估算。

另外第一輪 Claude 三筆全部 `max_tokens` 截斷：Haiku 5.5 預設會思考，思考 token 計入 `max_tokens`，1800 個 token 全被思考吃掉、正文零字（`output_tokens_details.thinking_tokens: 1800`），三筆花了 $0.0079 沒有產出。之後 transport 改成請求裡帶 `thinking: {type: "disabled"}`（effort low 下允許），上表是改後的第二輪。這一輪也確認了：回傳的 `model` 字串正好是 `claude-haiku-5-5`，`output_config.effort` 在 `anthropic-version: 2023-06-01` 下接受。

## 品質對照

- **@hkj331155、@_ian_xyz_**：兩個 provider 都通過結構與引文檢查、正常顯示。判斷方向一致（見下方原文）。
- **@hkj315**：Claude 的輸出被既有規則 `Ungrounded activity quote` 擋下、不顯示：findings 裡引用了輸入中不存在的證據 ID（例如 `activity:3587`，像是被截斷的 ID）。Gemini 這筆通過。擋下來是對的，代表 Claude 這次有捏造引用的傾向，三筆中一筆。
- **點名**：Claude 在 @hkj315 的 observation 直接寫出被回覆對象的帳號名（「集中在 hkj331155……的串」）；Gemini 同一筆寫「特定對象」。prompt 要求不對一般帳號點名，這點 Claude 較差（這筆雖未顯示，但傾向值得記）。
- **意圖紅線**：三筆 Claude 輸出都沒有觸發 `unsupported_intent_or_operator` 等用詞警告；Gemini 的 @_ian_xyz_ 觸發了一次（只警告、仍顯示）。
- **文風**：Claude 的 conclusion 較長、會把多個引文塞進結論句（「我呸」「哈哈哈」……），Gemini 的結論較精簡。長度對結果頁與擴充套件浮層的版面有影響。

## 判讀原文（對外顯示的 conclusion 與 findings）

### @hkj315

**Gemini 3.8 Flash（匯入既有判讀（本機帳本，10-18 產生））**：ready

- assessment：`suspicious_behavior_observed`
- conclusion：該帳號在貼文中使用高度固定模板重複發布簡短口號，並在可見留言中高度集中以極短字詞回覆單一特定帳號，呈現值得注意的重複聲援模式。
- **以固定模板反覆發布加油口號：**貼文內容呈現明顯的模板化現象，主要透過置換特定人名或陣營反覆送出簡短聲援口號，這種發文方式偏向單向訊息傳遞，可能增加特定政治名詞與口號的曝光度。
- **集中以簡短感嘆詞回覆特定帳號：**該帳號對特定對象的互動頻率與回覆形式具備高度重複性，缺乏具體討論內容，可能為該特定帳號的貼文增加留言互動次數。

**Claude Haiku 5.5（本機 10-24）**：invalid_output，AI 輸出未通過檢查，暫不顯示判斷。

### @hkj331155

**Gemini 3.8 Flash（本機 10-24 新產生）**：ready

- assessment：`suspicious_behavior_observed`
- conclusion：該帳號在 2026 年 7 月呈現高度模板化的口號連發，並於 2025 年 5 月至 8 月間集中對特定帳號數秒內連續送出「讚讚讚」「棒棒棒」等制式短句，呈現值得檢視的重複聲援模式。
- **使用固定造句模板連續發布政治口號：**貼文在兩天內密集以同一句型套換不同人名發布，且缺乏其他脈絡說明或討論，偏向以模板化短句反覆傳遞特定宣傳口號，可能增加此類政治訊息的曝光。
- **集中回覆單一帳號並在數秒內連續送出重複短語：**在同串數秒內接連送出無實質討論內容的重複短句，且發言對象高度集中在單一帳號，呈現反覆制式聲援的行為特徵，可能增加該特定作者貼文的留言量與互動可見度。

**Claude Haiku 5.5（本機 10-24）**：ready

- assessment：`suspicious_behavior_observed`
- conclusion：本次可見的 33 則留言與 6 則原創貼文中，有明確的重複口號與對同一作者的集中回覆，值得進一步檢視；但取樣有限，且原串內文缺失，無法判定這些互動的實際意圖或動機。
- **對同一作者的集中回覆：**在同一作者的多個貼文下反覆送出制式、無實質內容的正面短句，可能增加該作者貼文的互動數或可見度。這是一種值得檢視的集中聲援模式，但僅憑短句與集中程度，尚不能確認其為刻意操作。
- **重複的政治口號式貼文：**短期內以同一句型換詞反覆發布，屬於重複傳遞單一口號的形式，可能有助於擴大這類訊息的曝光。是否為刻意的放大行為，需要更完整的發文歷史與情境才能判斷。

### @_ian_xyz_

**Gemini 3.8 Flash（本機 10-24 新產生）**：ready

- assessment：`no_clear_suspicious_behavior`
- conclusion：本次可見活動多為個人軟體專案分享、技術討論與遊戲更新維護，互動具備實質情境，未見明確的可疑行為。
- **圍繞個人專案與技術議題進行實質回覆：**發言內容包含針對特定遊戲機制的說明、效能測試請求與功能更新清單，屬於開發者與使用者的自然技術互動，並非脫離情境的制式灌水或重複口號。
- **在不同貼文分享相同開源專案連結：**雖然在短時間內連續提供相同連結，但對照前後文為作者當天開發完成該專案後的推廣與分享，且回覆對象皆有其獨立脈絡，並未呈現大規模無差別洗版或異常放大現象。
- policyWarnings：`unsupported_intent_or_operator`（用詞規則只警告、仍顯示）

**Claude Haiku 5.5（本機 10-24）**：ready

- assessment：`no_clear_suspicious_behavior`
- conclusion：本次可見活動以技術分享、產品說明與一般社群互動為主，回覆多為簡短、與原文情境相符的寒暄或問答，未見足以判定為可疑協同或刷量的重複模式。
- **短句回覆分散於多個不同作者的貼文：**短句與表情符號的重複屬於社群常見的回應方式，並未在多個串中以相同句型反覆灌入同一訊息。目前沒有證據顯示這些回覆是為了集中放大特定內容或議題。
- **對遊戲與產品問題的密集技術回覆：**在可見範圍內，此段密集回覆有明確的問題與回答對應，內容具實質資訊，符合產品開發者回應使用者回報的情境，不屬於制式、無關內容的重複灌入。
- **推薦與分享自有專案的內容：**同一連結在不同回覆中出現，屬於開發者分享自身專案的常見做法，原串內容也多與相關問題有關（如路易莎 WiFi 重連）。在缺少完整原串內文的情況下，無法確認每次推薦是否均切合原串議題，但目前沒有證據顯示這是無差別的洗版。

Claude 對 @hkj315 被擋下的原文（admin `ai-diagnose`，只給營運者看）：

- 原因：`Ungrounded activity quote`
- conclusion：本次可見活動中，此帳號在其他帳號的回覆串裡反覆使用「我呸」「哈哈哈」「笑死」「加油加油」「罷起來」「夕賀」等極短、高度重複的制式句，且回覆對象集中在少數作者；多數回覆缺乏可對照的原串內文，無法判斷其與原文的關係。這些模式值得進一步檢視，但目前不足以認定其為協同或刻意放大。
- **同一短句在多串重複使用，且無法對應原文：**在不同對象的串中重複貼入相似短句，若缺乏對原文的實質回應，其功能較接近重複訊息或表態，而非針對議題的交流。此形式可能增加這些短句的可見度，但本次資料無法證明作者的意圖。（引用 ID：activity:3283705313668374722, activity:3341389982857733817, activity:3587, activity:3702514378768497436, activity:3611920507110603433）
- **回覆集中於少數作者：**對少數作者的集中回覆，若與短句重複結合，可能呈現反覆聲援同一對象的模式。這種集中使其在特定作者的留言區中持續可見。（引用 ID：activity:3603161212017517368, activity:3645149667278481764, activity:3703769585343276602）
- **原創貼文以固定政治口號為主：**貼文以固定句型、替換人名的方式連續發布，形式上具有重複傳播訊息的特徵。但此形式也常見於一般政治支持者的表態，且政治立場本身不構成可疑。（引用 ID：activity:3787099954822140030, activity:3821378990477766020, activity:3831655473884585513）

## 怎麼補跑

```sh
# .dev.vars 放 ANTHROPIC_API_KEY（gitignored），再：
npx wrangler dev --port 8811 --var WHOSPOST_AI_PROVIDER:claude --var WHOSPOST_AI_LIMIT_USD:1
curl -X POST -H 'authorization: Bearer <ADMIN_TOKEN>' http://127.0.0.1:8811/api/admin/scans/<scanId>/ai-start
curl http://127.0.0.1:8811/api/scans/<scanId>/ai
```

## 待處理

- `worker/log.mjs` 的敏感字規則 `token` 也吃掉 `promptTokens`／`outputTokens`／`thoughtsTokens`，Workers Logs 看不到 token 數（`usd` 看得到）。ops-alerts 列的這幾個欄位目前實際是 `[redacted]`。本 PR 沒改。
- 樣本只有三筆，Claude 一筆捏造引用、一筆點名。要切換前至少再對 10 筆以上有 Gemini 判讀的帳號跑一輪，看捏造引用率。
- transport 的請求參數（thinking、effort）不在快取鍵裡：改了參數不會自動重跑既有 Claude 判讀，本機是手動刪列重跑的。
