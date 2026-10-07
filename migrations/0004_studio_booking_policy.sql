-- Refresh only the old default wording; preserve owner-written policies.
UPDATE settings
SET data = json_set(data, '$.policies', '預約須經店家確認後才正式成立。新客美睫／霧眉預約需酌收 NT$500 訂金，於服務當天折抵。付款以現金或當下匯款為主。預約保留 15 分鐘；逾時可能調整服務或取消預約，恕不退訂金。取消與改期請依店家規則提前聯繫。')
WHERE id = 1
  AND json_extract(data, '$.policies') = '預約須經店家確認後才正式成立。到店以現金付款。取消、改期與遲到規則請於預約前向店家確認。';
