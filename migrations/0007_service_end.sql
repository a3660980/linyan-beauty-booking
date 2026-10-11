-- Keep the occupied end for overlap protection and snapshot the customer service end.
ALTER TABLE bookings ADD COLUMN service_end INTEGER;
UPDATE bookings SET service_end=MAX(start,end-COALESCE(
  (SELECT CAST(json_extract(data,'$.bufferMinutes') AS INTEGER) FROM settings WHERE id=1),30
)*60000);

-- Require at least thirty minutes between clients for all newly created bookings.
UPDATE settings SET data=json_set(data,'$.bufferMinutes',30)
WHERE id=1 AND COALESCE(json_extract(data,'$.bufferMinutes'),0)<30;

-- Only replace the initial description; preserve any description customized by the owner.
UPDATE services SET data=json_set(data,'$.description','一次完成眉眼的美好。服務 4.5 小時；可選擇睫毛款式與根數。')
WHERE id='combo-brows-lashes'
AND json_extract(data,'$.description')='一次完成眉眼的美好。服務 4.5 小時，另保留 30 分鐘整理；可選擇睫毛款式與根數。';
