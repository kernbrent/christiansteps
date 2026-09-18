PRAGMA foreign_keys = ON;

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent_hash TEXT
);

CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE admin_login_attempts (
  key_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX admin_login_attempts_updated_idx ON admin_login_attempts (updated_at);

CREATE TABLE admin_credentials (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-SHA256'),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK (iterations BETWEEN 100000 AND 1000000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);

CREATE TABLE app_settings (
  owner_id TEXT PRIMARY KEY CHECK (owner_id = 'primary'),
  business_name TEXT NOT NULL DEFAULT 'Christian Steps Ministries' CHECK (length(trim(business_name)) BETWEEN 1 AND 180),
  default_tax_year INTEGER NOT NULL CHECK (default_tax_year BETWEEN 2000 AND 2100),
  currency_code TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency_code) = 3),
  mileage_rate REAL NOT NULL DEFAULT 0 CHECK (mileage_rate >= 0),
  contact_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  tax_line TEXT,
  color TEXT NOT NULL DEFAULT '#0d4b73' CHECK (length(color) = 7 AND substr(color, 1, 1) = '#' AND substr(color, 2) NOT GLOB '*[^0-9A-Fa-f]*'),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  company TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  expense_date TEXT NOT NULL,
  vendor TEXT NOT NULL CHECK (length(trim(vendor)) BETWEEN 1 AND 180),
  amount REAL NOT NULL CHECK (amount > 0),
  program TEXT NOT NULL DEFAULT 'ChristianSteps' CHECK (program IN ('ChristianSteps', 'HopeSojourns', 'Shared')),
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT,
  business_purpose TEXT,
  payment_method TEXT,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  reimbursable INTEGER NOT NULL DEFAULT 0 CHECK (reimbursable IN (0, 1)),
  reimbursed INTEGER NOT NULL DEFAULT 0 CHECK (reimbursed IN (0, 1)),
  deductibility_percent REAL NOT NULL DEFAULT 100 CHECK (deductibility_percent BETWEEN 0 AND 100),
  record_status TEXT NOT NULL DEFAULT 'included' CHECK (record_status IN ('included', 'excluded', 'needs_review')),
  cpa_review INTEGER NOT NULL DEFAULT 0 CHECK (cpa_review IN (0, 1)),
  cpa_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (reimbursed = 0 OR reimbursable = 1),
  CHECK (project_id IS NULL OR client_id IS NOT NULL)
);

CREATE TABLE income (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  income_date TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  payer_name TEXT NOT NULL CHECK (length(trim(payer_name)) BETWEEN 1 AND 180),
  invoice_number TEXT,
  invoice_date TEXT,
  due_date TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  program TEXT NOT NULL DEFAULT 'ChristianSteps' CHECK (program IN ('ChristianSteps', 'HopeSojourns', 'Shared')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overdue', 'void')),
  description TEXT,
  payment_method TEXT,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  record_status TEXT NOT NULL DEFAULT 'included' CHECK (record_status IN ('included', 'excluded', 'needs_review')),
  cpa_review INTEGER NOT NULL DEFAULT 0 CHECK (cpa_review IN (0, 1)),
  cpa_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (due_date IS NULL OR invoice_date IS NULL OR due_date >= invoice_date),
  CHECK (project_id IS NULL OR client_id IS NOT NULL)
);

CREATE TABLE income_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  income_id TEXT NOT NULL REFERENCES income(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT,
  reference_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mileage_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  mileage_date TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (length(trim(origin)) BETWEEN 1 AND 240),
  destination TEXT NOT NULL CHECK (length(trim(destination)) BETWEEN 1 AND 240),
  business_purpose TEXT NOT NULL CHECK (length(trim(business_purpose)) BETWEEN 1 AND 500),
  miles REAL NOT NULL CHECK (miles > 0),
  program TEXT NOT NULL DEFAULT 'ChristianSteps' CHECK (program IN ('ChristianSteps', 'HopeSojourns', 'Shared')),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  record_status TEXT NOT NULL DEFAULT 'included' CHECK (record_status IN ('included', 'excluded', 'needs_review')),
  cpa_review INTEGER NOT NULL DEFAULT 0 CHECK (cpa_review IN (0, 1)),
  cpa_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (project_id IS NULL OR client_id IS NOT NULL)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'primary' CHECK (owner_id = 'primary'),
  record_type TEXT NOT NULL CHECK (record_type IN ('expense', 'income')),
  expense_id TEXT REFERENCES expenses(id) ON DELETE CASCADE,
  income_id TEXT REFERENCES income(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 240),
  mime_type TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL,
  CHECK (
    (record_type = 'expense' AND expense_id IS NOT NULL AND income_id IS NULL)
    OR (record_type = 'income' AND income_id IS NOT NULL AND expense_id IS NULL)
  )
);

CREATE INDEX expenses_date_idx ON expenses (expense_date DESC);
CREATE INDEX expenses_vendor_amount_idx ON expenses (lower(vendor), expense_date, amount);
CREATE INDEX expenses_category_idx ON expenses (category_id, expense_date DESC);
CREATE INDEX income_date_idx ON income (income_date DESC);
CREATE INDEX income_invoice_idx ON income (invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX income_client_idx ON income (client_id, income_date DESC);
CREATE INDEX income_payments_income_idx ON income_payments (income_id, payment_date DESC);
CREATE INDEX mileage_date_idx ON mileage_entries (mileage_date DESC);
CREATE INDEX clients_name_idx ON clients (lower(name));
CREATE UNIQUE INDEX categories_name_lower_idx ON categories (lower(name));
CREATE UNIQUE INDEX projects_client_name_lower_idx ON projects (client_id, lower(name));
CREATE INDEX projects_client_idx ON projects (client_id);
CREATE INDEX attachments_record_idx ON attachments (record_type, expense_id, income_id);

CREATE TRIGGER income_payments_insert_status
AFTER INSERT ON income_payments
BEGIN
  UPDATE income
  SET payment_status = CASE
        WHEN payment_status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) <= 0 THEN 'unpaid'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) < amount THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.income_id;
END;

CREATE TRIGGER income_payments_update_status
AFTER UPDATE ON income_payments
BEGIN
  UPDATE income
  SET payment_status = CASE
        WHEN payment_status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) <= 0 THEN 'unpaid'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) < amount THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.income_id;
  UPDATE income
  SET payment_status = CASE
        WHEN payment_status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) <= 0 THEN 'unpaid'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.income_id) < amount THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.income_id;
END;

CREATE TRIGGER income_payments_delete_status
AFTER DELETE ON income_payments
BEGIN
  UPDATE income
  SET payment_status = CASE
        WHEN payment_status = 'void' THEN 'void'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) <= 0 THEN 'unpaid'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = OLD.income_id) < amount THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.income_id;
END;

CREATE TRIGGER income_amount_update_status
AFTER UPDATE OF amount ON income
WHEN NEW.payment_status <> 'void'
BEGIN
  UPDATE income
  SET payment_status = CASE
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.id) <= 0 THEN 'unpaid'
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM income_payments WHERE income_id = NEW.id) < NEW.amount THEN 'partial'
        ELSE 'paid'
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

INSERT INTO app_settings (
  owner_id, business_name, default_tax_year, currency_code, mileage_rate, contact_email, created_at, updated_at
) VALUES (
  'primary', 'Christian Steps Ministries', 2026, 'USD', 0, 'christianstepsministries@gmail.com',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO categories (id, name, tax_line, color, is_active, sort_order, created_at, updated_at) VALUES
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0101', 'Tolls', 'Car and truck expenses', '#6d5b8c', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0102', 'Business Meals & Coffee', 'Meals', '#9a6817', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0103', 'Office Supplies', 'Office expense', '#0d4b73', 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0104', 'Travel - Airfare', 'Travel', '#26735b', 1, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0105', 'Travel - Lodging', 'Travel', '#26735b', 1, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0106', 'Travel - Rental Car', 'Travel', '#26735b', 1, 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0107', 'Travel - Meals', 'Meals', '#9a6817', 1, 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0108', 'Parking & Local Transportation', 'Car and truck expenses', '#6d5b8c', 1, 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0109', 'Software & Subscriptions', 'Other business expenses', '#17699a', 1, 8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0110', 'Professional Services', 'Legal and professional services', '#0d4b73', 1, 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0111', 'Marketing & Advertising', 'Advertising', '#a04444', 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('7ee32db8-9531-4dc9-a501-3ce65fbd0112', 'Other Business Expense', 'Other business expenses', '#667783', 1, 11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
