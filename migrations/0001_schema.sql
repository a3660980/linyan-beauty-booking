CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, friend INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE exceptions (date TEXT PRIMARY KEY, windows TEXT NOT NULL);
CREATE TABLE bookings (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), customer TEXT NOT NULL, phone TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 service_id TEXT NOT NULL, service_name TEXT NOT NULL, spec TEXT NOT NULL, addons TEXT NOT NULL, date TEXT NOT NULL,
 start INTEGER NOT NULL, end INTEGER NOT NULL, price INTEGER NOT NULL CHECK(price>=0), price_confirmed INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled','rejected','expired','no_show')),
 expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 paid INTEGER NOT NULL DEFAULT 0, paid_amount INTEGER, paid_at INTEGER,
 previous_id TEXT, group_code TEXT, companion TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX booking_date ON bookings(date,status);
CREATE INDEX booking_user ON bookings(user_id,created_at);
CREATE TRIGGER no_booking_overlap_insert BEFORE INSERT ON bookings WHEN NEW.status IN ('pending','confirmed') BEGIN
 SELECT RAISE(ABORT,'SLOT_TAKEN') WHERE EXISTS(SELECT 1 FROM bookings b WHERE b.status IN ('pending','confirmed') AND b.start<NEW.end AND NEW.start<b.end);
END;
CREATE TRIGGER no_booking_overlap_update BEFORE UPDATE OF start,end,status ON bookings WHEN NEW.status IN ('pending','confirmed') BEGIN
 SELECT RAISE(ABORT,'SLOT_TAKEN') WHERE EXISTS(SELECT 1 FROM bookings b WHERE b.id<>NEW.id AND b.status IN ('pending','confirmed') AND b.start<NEW.end AND NEW.start<b.end);
END;
CREATE TABLE notifications (id TEXT PRIMARY KEY, booking_id TEXT REFERENCES bookings(id), user_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, error TEXT, lease_until INTEGER NOT NULL DEFAULT 0, UNIQUE(booking_id,kind));
CREATE INDEX notification_queue ON notifications(state,retry_at);
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, booking_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE request_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
