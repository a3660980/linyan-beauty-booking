-- Add a combined menu without overwriting existing prices or service durations.
INSERT OR IGNORE INTO services(id,data)
SELECT 'combo-brows-lashes', json_object(
  'id','combo-brows-lashes','name','霧眉＋睫毛','category','combo',
  'description','一次完成眉眼的美好。服務 4.5 小時，另保留 30 分鐘整理；可選擇睫毛款式與根數。',
  'duration',270,'active',json('true'),
  'specs',json_group_array(json_object(
    'label',json_extract(s.data,'$.name')||'・'||json_extract(j.value,'$.label'),
    'price',COALESCE((SELECT json_extract(data,'$.specs[0].price') FROM services WHERE id='brows'),5000)+json_extract(j.value,'$.price')
  ))
)
FROM services s, json_each(s.data,'$.specs') j
WHERE s.id IN ('single','3d','6d','yy')
HAVING count(*)>0;

-- Invitations contain no personal information; only a SHA-256 token digest is stored.
CREATE TABLE booking_invitations (
  token_hash TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_by TEXT REFERENCES users(id),
  claimed_at INTEGER
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  kind TEXT PRIMARY KEY CHECK(kind='review_requested'),
  user_id TEXT NOT NULL REFERENCES users(id)
);
