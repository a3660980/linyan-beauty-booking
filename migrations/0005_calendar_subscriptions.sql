CREATE TABLE calendar_subscriptions (
 admin_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
