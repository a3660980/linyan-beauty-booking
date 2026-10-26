-- Lower internal cleanup to ten minutes without changing service start/end times.
DROP TRIGGER valid_change_insert;
DROP TRIGGER hold_overlap_insert;
DROP TRIGGER hold_overlap_update;
DROP TRIGGER invalidate_changes;
-- A proposed move holds the new interval while the original booking remains unchanged.
CREATE TABLE booking_changes_next (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), base_version INTEGER NOT NULL,
 old_date TEXT NOT NULL, old_start INTEGER NOT NULL, old_service_end INTEGER NOT NULL,
 date TEXT NOT NULL, start INTEGER NOT NULL, service_end INTEGER NOT NULL, end INTEGER NOT NULL,
 price INTEGER NOT NULL CHECK(price>=0), reason TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','withdrawn','expired','obsolete')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 responded_at INTEGER, responded_by TEXT,
 CHECK(start<service_end AND end>=service_end+600000)
);

INSERT INTO booking_changes_next SELECT * FROM booking_changes;
DROP TABLE booking_changes;
ALTER TABLE booking_changes_next RENAME TO booking_changes;
UPDATE settings SET data=json_set(data,'$.bufferMinutes',10) WHERE id=1;
UPDATE bookings SET end=service_end+600000,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000,version=version+1
WHERE status IN ('pending','confirmed') AND start>CAST(strftime('%s','now') AS INTEGER)*1000
 AND service_end IS NOT NULL AND end<>service_end+600000;
-- Keep still-valid proposals attached to the same unchanged service appointment.
UPDATE booking_changes SET end=service_end+600000,
 base_version=COALESCE((SELECT version FROM bookings b WHERE b.id=booking_id
  AND b.status IN ('pending','confirmed') AND b.date=old_date AND b.start=old_start
  AND b.service_end=old_service_end AND b.version IN (base_version,base_version+1)),base_version)
WHERE state='pending';
CREATE UNIQUE INDEX one_pending_change ON booking_changes(booking_id) WHERE state='pending';
CREATE INDEX change_holds ON booking_changes(state,date,expires_at);

CREATE TRIGGER valid_change_insert BEFORE INSERT ON booking_changes WHEN NEW.state='pending' BEGIN
 SELECT RAISE(ABORT,'STALE_BOOKING') WHERE NOT EXISTS(
  SELECT 1 FROM bookings b WHERE b.id=NEW.booking_id AND b.version=NEW.base_version
  AND b.status IN ('pending','confirmed') AND b.start>CAST(strftime('%s','now') AS INTEGER)*1000
  AND (b.status='confirmed' OR b.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
 );
 SELECT RAISE(ABORT,'SLOT_TAKEN') WHERE EXISTS(
  SELECT 1 FROM bookings b WHERE b.id<>NEW.booking_id AND b.status IN ('pending','confirmed')
  AND b.start<NEW.end AND NEW.start<b.end
 ) OR EXISTS(
  SELECT 1 FROM booking_changes c WHERE c.state='pending' AND c.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
  AND c.start<NEW.end AND NEW.start<c.end
 );
END;
CREATE TRIGGER hold_overlap_insert BEFORE INSERT ON bookings WHEN NEW.status IN ('pending','confirmed') BEGIN
 SELECT RAISE(ABORT,'SLOT_TAKEN') WHERE EXISTS(
  SELECT 1 FROM booking_changes c WHERE c.booking_id<>NEW.id AND c.state='pending'
  AND c.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND c.start<NEW.end AND NEW.start<c.end
 );
END;
CREATE TRIGGER hold_overlap_update BEFORE UPDATE OF start,end,status ON bookings WHEN NEW.status IN ('pending','confirmed') BEGIN
 SELECT RAISE(ABORT,'SLOT_TAKEN') WHERE EXISTS(
  SELECT 1 FROM booking_changes c WHERE c.booking_id<>NEW.id AND c.state='pending'
  AND c.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND c.start<NEW.end AND NEW.start<c.end
 );
END;
-- Changes to payment, status or binding invalidate proposals based on an older booking version.
CREATE TRIGGER invalidate_changes AFTER UPDATE OF version,status ON bookings BEGIN
 UPDATE booking_changes SET state='obsolete',responded_at=NEW.updated_at
 WHERE booking_id=NEW.id AND state='pending'
 AND (base_version<>NEW.version OR NEW.status NOT IN ('pending','confirmed'));
END;

-- Defense in depth: even a direct update cannot mark a future date as served.
CREATE TRIGGER no_future_completion BEFORE UPDATE OF status ON bookings
WHEN NEW.status='completed' AND NEW.date>strftime('%Y-%m-%d','now','+8 hours') BEGIN
 SELECT RAISE(ABORT,'FUTURE_BOOKING');
END;
