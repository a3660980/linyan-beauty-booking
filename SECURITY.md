# 安全與資料處理

公開專案僅包含程式碼、資料庫結構與已公開的品牌素材。實際客人姓名、電話、LINE ID、營收、匯出、備份和金鑰不得提交。

* GitHub Secrets：Cloudflare API token、account selector。使用僅限指定帳號 Workers 與 D1 的 token。
* Cloudflare runtime secrets：LINE secret/access token、登入簽章金鑰、管理員 LINE ID 白名單。
* 客人登入由伺服器向 LINE 驗證，cookie 為 HttpOnly/SameSite，production 使用 Secure。
* 後台 API 每次檢查管理員白名單；客人查詢與取消只允許自己的紀錄。
* 修改 API 檢查 Origin；Webhook 驗證原始本文的 HMAC 簽章與事件去重。
* D1 trigger 在寫入與更新時防止預約重疊；保留時段涵蓋整理時間。
* 通知以固定 retry key 重試；「API 已受理」不代表客人收到或已讀。
* Demo 僅為瀏覽器記憶體資料，不會呼叫正式寫入 API 或推播 LINE。
* 未填服務時間、未設定營業日、LINE 未驗證或未加入好友時，不接受客人預約。

請勿在公開 Issue 貼出個資或金鑰。若發現外洩，先撤銷／輪替憑證；刪除最新檔案無法清除 Git 歷史。資料匯出檔只下載至私人裝置，禁止放進專案。
