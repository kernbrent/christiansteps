PRAGMA foreign_keys = ON;

CREATE TABLE mileage_rates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  effective_from TEXT NOT NULL CHECK (length(effective_from) = 10),
  effective_to TEXT NOT NULL CHECK (length(effective_to) = 10),
  rate_per_mile REAL NOT NULL CHECK (rate_per_mile >= 0 AND rate_per_mile <= 100),
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (effective_to >= effective_from)
);

CREATE INDEX mileage_rates_range_idx
  ON mileage_rates (effective_from, effective_to);
CREATE INDEX mileage_rates_lookup_idx
  ON mileage_rates (is_active, effective_from, effective_to);

CREATE TRIGGER mileage_rates_no_overlap_insert
BEFORE INSERT ON mileage_rates
WHEN NEW.is_active = 1 AND EXISTS (
  SELECT 1 FROM mileage_rates
  WHERE is_active = 1
    AND NOT (effective_to < NEW.effective_from OR effective_from > NEW.effective_to)
)
BEGIN
  SELECT RAISE(ABORT, 'MILEAGE_RATE_OVERLAP');
END;

CREATE TRIGGER mileage_rates_no_overlap_update
BEFORE UPDATE OF effective_from, effective_to, is_active ON mileage_rates
WHEN NEW.is_active = 1 AND EXISTS (
  SELECT 1 FROM mileage_rates
  WHERE id <> NEW.id
    AND is_active = 1
    AND NOT (effective_to < NEW.effective_from OR effective_from > NEW.effective_to)
)
BEGIN
  SELECT RAISE(ABORT, 'MILEAGE_RATE_OVERLAP');
END;

INSERT INTO mileage_rates (
  id, effective_from, effective_to, rate_per_mile, label, is_active, created_at, updated_at
) VALUES
  (
    'e2bb8715-5cc3-45fd-94d2-f48715625701',
    '2026-01-01', '2026-06-30', 0.725,
    'IRS business rate - Jan through Jun 2026', 1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'e2bb8715-5cc3-45fd-94d2-f48715625702',
    '2026-07-01', '2026-12-31', 0.76,
    'IRS business rate - Jul through Dec 2026', 1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

UPDATE app_settings
SET mileage_rate = 0.76,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE owner_id = 'primary';
