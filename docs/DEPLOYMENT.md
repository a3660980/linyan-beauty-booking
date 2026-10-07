# GitHub / Cloudflare / LINE 部署指南

## 1. 公開 GitHub 專案

建議名稱 `linyan-beauty-booking`，main 為正式分支。先執行 `npm run check:secrets`，確認 `.dev.vars`、備份、客人資料沒有加入 Git。

在 GitHub repository 的 Settings → Environments 建立 `production`，限制正式部署分支為 main。GitHub 免費公開專案可以使用 Actions；實際政策以 GitHub 當前方案為準。

## 2. Cloudflare

使用自己的 Cloudflare 帳號，登入 Wrangler，建立 D1：

```sh
npx wrangler login
npx wrangler d1 create linyan-beauty
```

不要把真實 database ID 寫回受追蹤的 wrangler.jsonc；設定 GitHub variable `CLOUDFLARE_D1_DATABASE_ID`。基礎設定中的全零 ID 只用於本機及 dry-run。

GitHub production environment Secrets：

| 名稱 | 用途 |
|---|---|
| CLOUDFLARE_API_TOKEN | 僅限此 Cloudflare 帳號 Workers Scripts Edit、D1 Edit 等部署所需權限 |
| CLOUDFLARE_ACCOUNT_ID | 指定部署帳號 |

GitHub repository Variables：

| 名稱 | 用途 |
|---|---|
| CLOUDFLARE_D1_DATABASE_ID | 此專案 D1 database ID |
| DEPLOY_ENABLED | 最後設定為 `true` 才啟用 CD |

首次可先部署網站與資料庫，再設定 runtime secrets。尚未設定完成時，正式 API 拒絕登入／預約，不提供預設管理帳密。

## 3. LINE 官方帳號與 Login

1. 建立 LINE 官方帳號並啟用 Messaging API。
2. 在同一個 Provider 建立 LINE Login channel，並連結同一個官方帳號，才能取得相同 LINE user ID 與好友狀態。
3. LINE Login callback URL：`https://你的正式網址/api/auth/line/callback`。
4. Messaging API webhook URL：`https://你的正式網址/api/line/webhook`，開啟 Webhook。
5. 將 channel 設為可供客人使用的公開狀態；不要使用已停用的 LINE Notify。

在 Cloudflare Workers → 該 Worker → Settings → Variables and Secrets，設定以下值。不要填進 GitHub source 或 Vite 前端環境變數。

| Runtime 名稱 | 用途 |
|---|---|
| APP_ORIGIN | 正式網址 origin，不含尾端斜線；設定完成後同步 LINE callback |
| LINE_LOGIN_CHANNEL_ID | LINE Login channel ID |
| LINE_LOGIN_CHANNEL_SECRET | LINE Login channel secret |
| LINE_CHANNEL_ACCESS_TOKEN | Messaging API access token |
| LINE_CHANNEL_SECRET | Messaging API webhook secret |
| LINE_ADD_FRIEND_URL | 官方帳號加好友 https 網址 |
| AUTH_SECRET | 私人產生的至少 32 字元隨機簽章金鑰 |
| ADMIN_LINE_USER_IDS | 管理員 LINE user ID，以逗號分隔；不得放在 Git |

若 LINE 顯示 `Invalid redirect_uri value`，請檢查 LINE Login channel 的 Callback URL 與正式網址完全一致：`https://你的正式網址/api/auth/line/callback`。程式會將 APP_ORIGIN 正規化，避免尾端斜線造成 `//api/auth/line/callback`；LINE Developers 仍需登記單一斜線的正確網址。

管理員首次使用 LINE 登入後，`/#admin` 會顯示本人識別碼，加入 Cloudflare 的管理員白名單後重新載入。**登入本身不自動授予管理權限**。

## 4. 店家設定

在後台初始化服務資料，設定各品項服務分鐘、加購分鐘、整理時間、地址及正式預約規則。營業時間可使用行事曆逐日設定（每天最多 5 段），或選用每週固定排班；指定日期設定優先。空白服務分鐘、未設定開放時間的日期均不會產生可預約時段。

客人選完服務後，系統會查詢開放期間內可容納服務、加購與整理時間的空位，預設選擇最近可預約日。日期列以週一至週日顯示，支援前後週切換；修改日期時日期列同步到該週。重新整理網站時，先確認 LINE 登入狀態再顯示預約或後台；狀態查詢失敗時提供重試。

網站已刊登店家提供的美睫／霧眉前後須知及活動原圖。新客訂金 NT$500、15 分鐘遲到規則、現金或當下匯款，以及可併用的限動／生日優惠，均由店家透過 LINE 或結帳時人工核對；系統不自動收取訂金或套用活動折抵。原價與最終確認金額仍分別保留。

所有已成立預約保留當時的價格與占位時間，不因後續服務設定縮短。排休與營業變更不會自動取消已有預約，店家須先檢查受影響客人。

## 5. 啟用 CI/CD

填妥 GitHub Secrets／Variables 後，將 `DEPLOY_ENABLED` 改成 `true`。push main 或在 Actions 執行 Deploy to Cloudflare。部署前重新測試，D1 migration 套用成功才上傳 Worker。Cloudflare runtime secrets 不由 GitHub Actions 重寫；設定 keep_vars=true，保留在 Cloudflare 後台建立的一般變數。

正式首次啟用時，必須以店家與客人 LINE 帳號驗證登入、好友狀態、審核成功通知、取消通知及提醒。未完成真實 LINE 驗收前，網站設計示範不能當作正式接單成功。
