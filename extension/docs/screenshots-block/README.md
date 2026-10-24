# 封鎖助手使用截圖（PR #65，0.2 用；0.1.0 送審版不含）

照使用順序排。每張的「來源」欄只有三種寫法：

- **真 threads.com 登入頁面驗過**：Felix 的 Chrome、登入狀態、英文介面，2026-10-24 在 `https://www.threads.com/@zuck` 截的。**擴充套件本體沒有裝進那個 Chrome**（工具沒辦法載入未封裝擴充套件），是把 `lib/block.mjs` 的步驟與結構選擇器、`content.css` 的頂端條樣式原樣注入頁面執行。所以畫面上 Threads 的部分（⋯ 選單、確認視窗、封鎖後的頁面）是真的；頂端黑條是擴充套件同一份程式碼畫的，但不是從已安裝的擴充套件來的。
- **fixture／模擬**：`node tests/extension/e2e/run.mjs --fixture` 跑出來的。Playwright 的 Chromium 真的載入了 `extension/`，貼文頁是存下來的 Threads 未登入頁（帳號換成 user01…），個人頁是照 10-24 實測結構手寫的 `tests/extension/e2e/fixture/profile.html`。擴充套件的行為是真的，Threads 的頁面是假的。
- **未驗證**：沒有截到或沒驗過的畫面。

| # | 檔案 | 畫面 | 來源 |
|---|---|---|---|
| 1 | `01-button-in-popover.png` | 封鎖按鈕的位置：點名字旁的晶片打開浮層，最下面一段是「到 Threads 封鎖 @user03」，下面一行「封鎖是你的決定，Whospost 只替你點，不判定任何人。會開新分頁到對方個人頁……一次一個，每次間隔 8 秒。」收起列、晶片上都沒有這顆按鈕。（底部那條「這小時的即時查用完了」是 e2e 前一段測即時查上限留下的，跟封鎖無關。） | fixture／模擬 |
| 2 | `02-running-menu-open.png` | 封鎖中：新分頁打開對方個人頁後，頂端黑條「Whospost 正替你封鎖 @zuck：⋯ → 封鎖 → 確認」，已替你按了頭像旁的 ⋯，選單最後一組第一項是 Block。 | 真 threads.com 登入頁面驗過（注入執行，見上；只點到 ⋯） |
| 3 | `03-confirm-dialog.png` | 確認步驟：替你點了選單的 Block，Threads 跳出「Block zuck?」確認視窗。擴充套件下一步會按右邊的 Block；**這張截完就按了 Cancel，沒有封鎖**。 | 真 threads.com 登入頁面驗過（注入執行；停在確認前） |
| 4 | `04-done.png` | 完成：確認視窗關上，頂端條「已封鎖 @zuck。Whospost 之後不再標它；要解除請到 Threads 的設定。」Threads 頁面的 Follow 變成 Unblock、貼文變「Content not available」。 | 真 threads.com 登入頁面驗過（10-24 Felix 授權那一次實際封鎖，截完立刻解除，已確認回到 Follow） |
| 5 | `05-failed-layout-changed.png` | 失敗：⋯ 選單裡沒有 Block（模擬 Threads 改版），停在第二步，紅條「Threads 版面已變，請自己按（停在：「⋯」選單裡找不到「封鎖」）。Whospost 沒有再點任何東西。」選單留著讓你自己按；帳號不會進已封鎖清單。 | fixture／模擬 |
| 6 | `06-cooldown.png` | 冷卻：按下後回到原本的貼文頁，浮層的按鈕變灰「8 秒後才能再封鎖」並倒數，底部提示「已開新分頁到 @user03 的個人頁，Whospost 正替你點封鎖」。8 秒內所有分頁的封鎖按鈕都是灰的，按了也不會開。 | fixture／模擬 |
| 7 | `07-popup-blocked-list.png` | 彈出視窗「已封鎖 1 個」：帳號清單、移除；說明「清單只存在這台電腦，不會送出」「移除只是讓 Whospost 重新標這個帳號，不會在 Threads 解除封鎖」。 | fixture／模擬 |

## 未驗證

- **真站上的「浮層按下 → 開新分頁 → 新分頁接手」**：要裝好的擴充套件才跑得到，只在 fixture 驗過（1、6 兩張與 e2e 斷言）。最完整的補法是 Felix 自己載入未封裝擴充套件，在真實貼文頁按一次。
- **真站上的冷卻與彈出視窗**（6、7 張）：同上，只在 fixture。
- **真站上的失敗畫面**（5）：真的 Threads 選單沒壞，沒辦法在真站重現；邏輯在單元測試與 fixture 驗過。
- **中文介面**：真站只在英文介面驗過；中文的「封鎖／解除封鎖」字樣來自參考腳本 threads-report-block，沒在中文介面實測。
- **深色模式、手機寬度**：沒截。

截完第 2、3 張之後已確認 @zuck 沒被封鎖（確認視窗關掉、按鈕仍是 Follow）。之後不再用 Felix 的真帳號對任何人封鎖。
