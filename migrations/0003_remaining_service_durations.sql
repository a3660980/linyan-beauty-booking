-- Apply the owner's confirmed durations to already initialized records.
UPDATE services SET data = json_set(data, '$.duration', 180) WHERE id = 'touchup';
UPDATE services SET data = json_set(data, '$.duration', 60) WHERE id = 'color-removal';
UPDATE settings SET data = json_set(data, '$.addonDurations.lower', 30) WHERE id = 1;
