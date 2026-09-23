CREATE TABLE personal_gifts (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL, donor_json TEXT NOT NULL,
 received_by TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('Personal Venmo','Personal Zelle','Personal PayPal')),
 gift_date TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT NOT NULL, designation TEXT NOT NULL DEFAULT 'Hope Sojourns', note TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, voided INTEGER NOT NULL DEFAULT 0,
 payload_json TEXT, delivery_status TEXT NOT NULL DEFAULT 'not_sent',
 request_json TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
 UNIQUE(method,received_by,reference)
);
CREATE TABLE personal_gift_movements (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES personal_gifts(id),
 kind TEXT NOT NULL CHECK(kind IN ('transfer','expense','fee')),
 movement_date TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT NOT NULL, description TEXT NOT NULL, cleared_date TEXT,
 reversed INTEGER NOT NULL DEFAULT 0, request_json TEXT NOT NULL,
 created_at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE personal_gift_files (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES personal_gifts(id),
 object_key TEXT NOT NULL, file_name TEXT NOT NULL, media_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE personal_gift_history (
 id TEXT PRIMARY KEY,gift_id TEXT NOT NULL REFERENCES personal_gifts(id),
 action TEXT NOT NULL,details_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE personal_gift_guards(value INTEGER CHECK(value=1));
CREATE TRIGGER personal_gift_limit BEFORE INSERT ON personal_gift_movements WHEN
 NOT EXISTS(SELECT 1 FROM personal_gifts WHERE id=NEW.gift_id AND voided=0 AND payload_json IS NULL)
 OR NEW.amount_cents+(SELECT COALESCE(SUM(amount_cents),0) FROM personal_gift_movements WHERE gift_id=NEW.gift_id AND reversed=0)>(SELECT amount_cents FROM personal_gifts WHERE id=NEW.gift_id)
 BEGIN SELECT RAISE(ABORT,'Gift changed or movement exceeds funds held'); END;
CREATE INDEX personal_gift_movements_gift ON personal_gift_movements(gift_id);
