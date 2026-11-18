-- The owner supplied the studio address and navigation location.
-- Only public studio settings change; booking and customer records are untouched.
UPDATE settings SET data=json_set(data,'$.address','63044 雲林縣斗南鎮西岐里文化街14號') WHERE id=1;
