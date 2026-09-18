PRAGMA foreign_keys = ON;

CREATE TABLE trip_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  origin TEXT NOT NULL CHECK (length(trim(origin)) BETWEEN 1 AND 240),
  destination TEXT NOT NULL CHECK (length(trim(destination)) BETWEEN 1 AND 240),
  business_purpose TEXT NOT NULL CHECK (length(trim(business_purpose)) BETWEEN 1 AND 500),
  miles REAL NOT NULL CHECK (miles > 0),
  program TEXT NOT NULL DEFAULT 'ChristianSteps' CHECK (program IN ('ChristianSteps', 'HopeSojourns', 'Shared')),
  toll_amount REAL NOT NULL DEFAULT 0 CHECK (toll_amount >= 0),
  toll_vendor TEXT,
  payment_method TEXT,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (project_id IS NULL OR client_id IS NOT NULL)
);

CREATE UNIQUE INDEX trip_templates_name_lower_idx ON trip_templates (lower(name));
CREATE INDEX trip_templates_client_idx ON trip_templates (client_id, project_id);

ALTER TABLE mileage_entries ADD COLUMN trip_batch_id TEXT;
ALTER TABLE mileage_entries ADD COLUMN trip_template_id TEXT REFERENCES trip_templates(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN trip_batch_id TEXT;
ALTER TABLE expenses ADD COLUMN trip_template_id TEXT REFERENCES trip_templates(id) ON DELETE SET NULL;

CREATE INDEX mileage_trip_batch_idx ON mileage_entries (trip_batch_id);
CREATE INDEX expenses_trip_batch_idx ON expenses (trip_batch_id);
