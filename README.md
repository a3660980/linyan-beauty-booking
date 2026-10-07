# 琳顏美學 Linyanbeauty｜LINE 預約系統

奶油白、藕粉與深咖啡色的品牌網站。服務包含美睫、卸除、補睫、霧眉及除色；採到店現金付款。客人申請後須由店家確認，才正式成立。

## 已實作

- 手機／桌面品牌首頁、價目表、原始品牌素材、預約須知與資料使用說明。
- 三步驟預約：服務／加購、日期時段、LINE 身分與聯絡資料。
- 可設定的服務時間、緩衝、固定排班、分段營業、特定日期休息／例外。
- D1 寫入 trigger 防止重複與重疊預約；待確認占位與申請逾時釋出。
- LINE OAuth 身分驗證、好友狀態、管理員白名單、客人自己的預約查詢與取消。
- 日／週／月行事曆、預約審核、完成／取消／未到店、手動預約、現金收款與實收統計。
- 客人歷次服務與優惠資格核對；同行霧眉以關聯碼安排兩筆預約。
- LINE 推播佇列、重試、額度查詢、發送狀態與前一天提醒排程。
- CSV 匯出（防試算表公式注入）、操作紀錄、機密掃描、GitHub Actions CI/CD。
- 獨立示範模式：`/#demo-booking`、`/#demo-admin`、`/#demo-my`。資料僅存於當前瀏覽器記憶體，重新整理重置，不會發送 LINE。

## 技術與費用

React + TypeScript + Vite；Cloudflare Worker 同時提供靜態網站與 API；D1 儲存資料。使用 Cloudflare 與台灣 LINE 官方帳號免費額度起步，無須付費網域。LINE 推播每月免費額度有上限；提醒預設關閉，正式上線需監控平台用量。不是無限量免費。

## 本機開發

```sh
npm ci
npm run build
npm run db:local
# 複製 .env.example 為 .dev.vars；只在本機／私人平台填值
npm run worker:dev
```

另開終端執行 `npm run dev`。Vite 把 `/api` 代理到本機 Worker 8787 埠。設計示範不需 LINE 憑證，可直接開啟示範網址。

```sh
npm run check
npm run test:ui
npx wrangler deploy --dry-run --outdir .deploy/worker-check
```

## 正式啟用

請依 [部署指南](docs/DEPLOYMENT.md) 完成 Cloudflare D1、LINE Channel、管理員白名單與 GitHub 設定。服務分鐘、營業時間、地址尚未由店家提供，初始不開放預約。示範中的時段與分鐘數不可作為正式排班。

手動預約未綁定 LINE 身分時，系統保留紀錄與占位，店家須自行聯絡客人。同行優惠需先建立兩位關聯預約才可確認；其中一位取消時由店家處理優惠。補睫依前次已完成服務核對，金額由店家確認。無創除色 NT$2,000–3,000，正式審核時確認價格。

## CI/CD

- `ci.yml`：PR 與 main push 執行機密掃描、核心邏輯與瀏覽器測試、TypeScript／前端建置及 Worker dry-run。
- `deploy.yml`：main push 或手動觸發；僅在 `DEPLOY_ENABLED=true` 時執行。重新通過檢查後套用 migration 與部署，使用 production environment 的 GitHub Secrets。
- 工作流程只讀 repository、釘選 action commit，PR 檢查不注入 production 金鑰。不使用 `pull_request_target` 執行外部程式。
- 套用的 migration 不可修改歷史；後續變更新增 migration。部署失敗不會自動復原已套用的資料庫結構。

## 資料與安全

見 [SECURITY.md](SECURITY.md) 與 [操作手冊](docs/OPERATIONS.md)。`.dev.vars`、`.env`、本機資料庫、匯出、備份、部署設定與私鑰均忽略；請保持 GitHub 公開專案只存程式碼和公開素材。

品牌素材由店家提供，保留原檔，未宣告開源授權。原始碼未指定開源授權；公開可瀏覽不等於授權他人使用品牌或再發佈。
