PRAGMA foreign_keys = ON;

-- A read-only accounting projection of the existing CSM PayPal source data.
-- There are deliberately no foreign keys to the operational database because
-- the ledger has its own D1 database and may never mutate PayPal or outbox rows.
CREATE TABLE paypal_ledger_activity (
  id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE,
  transaction_id TEXT NOT NULL,
  reference_transaction_id TEXT,
  event_code TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  status TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent')),
  currency TEXT NOT NULL,
  gross REAL NOT NULL,
  fee REAL NOT NULL,
  net REAL NOT NULL,
  display_name TEXT NOT NULL,
  counterparty_email TEXT,
  item_title TEXT,
  item_id TEXT,
  program TEXT NOT NULL CHECK (program IN ('ChristianSteps', 'HopeSojourns', 'JoshBeyondBorders', 'Unassigned')),
  accounting_class TEXT NOT NULL CHECK (accounting_class IN ('contribution', 'agency_receipt', 'agency_disbursement', 'internal_transfer', 'unassigned')),
  distribution_status TEXT,
  distribution_destination TEXT,
  source_first_seen_at TEXT NOT NULL,
  source_last_seen_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (transaction_id, event_code)
);

CREATE INDEX paypal_ledger_activity_date_idx ON paypal_ledger_activity (transaction_date DESC);
CREATE INDEX paypal_ledger_activity_program_idx ON paypal_ledger_activity (program, transaction_date DESC);
CREATE INDEX paypal_ledger_activity_class_idx ON paypal_ledger_activity (accounting_class, transaction_date DESC);

CREATE TABLE ledger_sync_state (
  id TEXT PRIMARY KEY CHECK (id = 'paypal'),
  last_success_at TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
