-- Update the combined service only. Prices, standalone lashes and existing bookings stay unchanged.
UPDATE services SET data=json_set(data,'$.duration',240,'$.specs',json((
 SELECT json_group_array(CASE
 WHEN CAST(REPLACE(substr(json_extract(value,'$.label'),instr(json_extract(value,'$.label'),'・')+1),' 根','') AS INTEGER) IN (100,150,200,300)
 THEN json_set(value,'$.duration',240+(CAST(REPLACE(substr(json_extract(value,'$.label'),instr(json_extract(value,'$.label'),'・')+1),' 根','') AS INTEGER)-100)/50*10)
 ELSE json(value) END)
 FROM json_each(services.data,'$.specs')
))) WHERE id='combo-brows-lashes';

-- Replace the initial description, retaining any description written by the owner.
UPDATE services SET data=json_set(data,'$.description','一次完成眉眼的美好。100 根服務 4 小時，每增加 50 根加 10 分鐘；可選擇睫毛款式與根數。')
WHERE id='combo-brows-lashes' AND json_extract(data,'$.description') IN (
 '一次完成眉眼的美好。服務 4.5 小時；可選擇睫毛款式與根數。',
 '一次完成眉眼的美好。服務 4.5 小時，另保留 30 分鐘整理；可選擇睫毛款式與根數。'
);
