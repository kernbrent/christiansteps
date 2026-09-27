ALTER TABLE income ADD COLUMN income_kind TEXT NOT NULL DEFAULT 'other' CHECK (income_kind IN ('other', 'donation', 'earned'));
ALTER TABLE income ADD COLUMN donor_email TEXT;
ALTER TABLE income ADD COLUMN hs_payload_json TEXT;
ALTER TABLE income ADD COLUMN hs_delivery_status TEXT CHECK (hs_delivery_status IS NULL OR hs_delivery_status IN ('queued', 'pending', 'needs_match', 'approved', 'denied', 'failed'));
ALTER TABLE income ADD COLUMN hs_inbox_id TEXT;
ALTER TABLE income ADD COLUMN hs_record_id TEXT;
ALTER TABLE income ADD COLUMN hs_delivery_error TEXT;
ALTER TABLE income ADD COLUMN hs_sent_at TEXT;
CREATE INDEX income_hs_delivery_status_idx ON income (hs_delivery_status, updated_at DESC);
