-- Change future slot spacing only; preserve schedules, service settings and bookings.
UPDATE settings SET data=json_set(data,'$.stepMinutes',15) WHERE id=1;
