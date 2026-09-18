PRAGMA foreign_keys = ON;

CREATE TABLE client_artifacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  linked_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('contract', 'mou', 'logo', 'invoice', 'signature', 'other')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 240),
  storage_path TEXT UNIQUE,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes > 0),
  source_url TEXT,
  notes TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (storage_path IS NOT NULL OR source_url IS NOT NULL)
);

CREATE TABLE invoice_profiles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  contract_name TEXT NOT NULL CHECK (length(trim(contract_name)) BETWEEN 1 AND 240),
  summary_template TEXT,
  payment_terms TEXT,
  payment_instructions TEXT,
  purchase_order TEXT,
  include_client_logo INTEGER NOT NULL DEFAULT 0 CHECK (include_client_logo IN (0, 1)),
  client_logo_artifact_id TEXT REFERENCES client_artifacts(id) ON DELETE SET NULL,
  summary_source_artifact_id TEXT REFERENCES client_artifacts(id) ON DELETE SET NULL,
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  profile_id TEXT REFERENCES invoice_profiles(id) ON DELETE SET NULL,
  income_id TEXT NOT NULL UNIQUE REFERENCES income(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL CHECK (length(trim(invoice_number)) BETWEEN 1 AND 100),
  created_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  due_date TEXT,
  contract_name TEXT NOT NULL CHECK (length(trim(contract_name)) BETWEEN 1 AND 240),
  purchase_order TEXT,
  summary TEXT,
  payment_terms TEXT,
  payment_instructions TEXT,
  include_client_logo INTEGER NOT NULL DEFAULT 0 CHECK (include_client_logo IN (0, 1)),
  client_logo_artifact_id TEXT REFERENCES client_artifacts(id) ON DELETE SET NULL,
  summary_source_artifact_id TEXT REFERENCES client_artifacts(id) ON DELETE SET NULL,
  total_amount REAL NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'void')),
  local_folder_name TEXT,
  notes TEXT,
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (period_end >= period_start),
  CHECK (due_date IS NULL OR due_date >= created_date)
);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  billing_type TEXT NOT NULL CHECK (billing_type IN ('fixed', 'hourly')),
  cadence TEXT CHECK (cadence IS NULL OR cadence IN ('one_time', 'weekly', 'monthly')),
  work_type TEXT NOT NULL CHECK (length(trim(work_type)) BETWEEN 1 AND 240),
  description TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_rate REAL NOT NULL CHECK (unit_rate >= 0),
  line_total REAL NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((billing_type = 'hourly' AND cadence IS NULL) OR (billing_type = 'fixed' AND cadence IS NOT NULL))
);

CREATE UNIQUE INDEX invoice_profiles_client_name_lower_idx
  ON invoice_profiles (client_id, lower(name));
CREATE UNIQUE INDEX invoices_number_lower_idx ON invoices (lower(invoice_number));
CREATE INDEX invoices_client_created_idx ON invoices (client_id, created_date DESC);
CREATE INDEX invoices_income_idx ON invoices (income_id);
CREATE INDEX invoice_items_invoice_sort_idx ON invoice_items (invoice_id, sort_order);
CREATE INDEX client_artifacts_client_type_idx ON client_artifacts (client_id, artifact_type, created_at DESC);
CREATE INDEX client_artifacts_invoice_idx ON client_artifacts (linked_invoice_id, created_at DESC);

CREATE TRIGGER invoice_payment_insert_status
AFTER INSERT ON income_payments
BEGIN
  UPDATE invoices
  SET status = CASE
        WHEN status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) <= 0
          THEN CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 'overdue' ELSE 'pending' END
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) < total_amount THEN 'partial'
        ELSE 'paid'
      END,
      paid_at = CASE
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) >= total_amount
          THEN COALESCE(paid_at, NEW.payment_date || 'T12:00:00.000Z')
        ELSE NULL
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE income_id = NEW.income_id;
END;

CREATE TRIGGER invoice_payment_update_status
AFTER UPDATE ON income_payments
BEGIN
  UPDATE invoices
  SET status = CASE
        WHEN status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) <= 0
          THEN CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 'overdue' ELSE 'pending' END
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) < total_amount THEN 'partial'
        ELSE 'paid'
      END,
      paid_at = CASE
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) >= total_amount
          THEN COALESCE(paid_at, OLD.payment_date || 'T12:00:00.000Z')
        ELSE NULL
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE income_id = OLD.income_id;

  UPDATE invoices
  SET status = CASE
        WHEN status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) <= 0
          THEN CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 'overdue' ELSE 'pending' END
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) < total_amount THEN 'partial'
        ELSE 'paid'
      END,
      paid_at = CASE
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) >= total_amount
          THEN COALESCE(paid_at, NEW.payment_date || 'T12:00:00.000Z')
        ELSE NULL
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE income_id = NEW.income_id;
END;

CREATE TRIGGER invoice_payment_delete_status
AFTER DELETE ON income_payments
BEGIN
  UPDATE invoices
  SET status = CASE
        WHEN status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) <= 0
          THEN CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 'overdue' ELSE 'pending' END
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) < total_amount THEN 'partial'
        ELSE 'paid'
      END,
      paid_at = CASE
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) >= total_amount
          THEN paid_at
        ELSE NULL
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE income_id = OLD.income_id;
END;
