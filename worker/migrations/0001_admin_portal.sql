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

CREATE TABLE paypal_transactions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  reference_transaction_id TEXT,
  event_code TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  updated_date TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent')),
  currency TEXT NOT NULL,
  gross REAL NOT NULL,
  fee REAL NOT NULL,
  net REAL NOT NULL,
  counterparty_name TEXT,
  counterparty_email TEXT,
  counterparty_phone TEXT,
  address_status TEXT,
  shipping_name TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country_code TEXT,
  item_title TEXT,
  item_id TEXT,
  item_details_json TEXT NOT NULL DEFAULT '[]',
  product_detected TEXT NOT NULL CHECK (product_detected IN ('HopeSojourns', 'JoshBeyondBorders', 'ChristianSteps', 'Unassigned')),
  product_override TEXT CHECK (product_override IS NULL OR product_override IN ('HopeSojourns', 'JoshBeyondBorders', 'ChristianSteps', 'Unassigned')),
  invoice_number TEXT,
  custom_number TEXT,
  subject TEXT,
  note TEXT,
  ending_balance REAL,
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (transaction_id, event_code)
);

CREATE INDEX paypal_transactions_date_idx ON paypal_transactions (transaction_date DESC);
CREATE INDEX paypal_transactions_direction_idx ON paypal_transactions (direction, transaction_date DESC);
CREATE INDEX paypal_transactions_product_idx ON paypal_transactions (product_detected, product_override, transaction_date DESC);
CREATE INDEX paypal_transactions_email_idx ON paypal_transactions (counterparty_email);

CREATE TABLE paypal_sync_state (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  last_success_at TEXT,
  oldest_synced_at TEXT,
  newest_synced_at TEXT,
  last_scope TEXT,
  last_result_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE paypal_sync_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('recent', 'full')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  searched_from TEXT,
  searched_through TEXT,
  records_found INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_code TEXT
);

CREATE INDEX paypal_sync_runs_started_idx ON paypal_sync_runs (started_at DESC);
