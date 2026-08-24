PRAGMA foreign_keys = ON;

CREATE TABLE csm_master_donors (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email_normalized TEXT,
  email TEXT,
  phone TEXT,
  address_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX csm_master_donors_email_idx ON csm_master_donors (email_normalized);

CREATE TABLE csm_distribution_outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_record_id TEXT NOT NULL REFERENCES paypal_transactions(id),
  source_transaction_id TEXT NOT NULL,
  source_event_code TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  destination TEXT NOT NULL CHECK (destination IN ('HopeSojourns', 'JoshBeyondBorders')),
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent')),
  display_name TEXT NOT NULL,
  master_donor_id TEXT REFERENCES csm_master_donors(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'received', 'pending', 'needs_match', 'approved', 'denied', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  recipient_inbox_id TEXT,
  recipient_record_id TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((direction = 'received' AND master_donor_id IS NOT NULL) OR (direction = 'sent' AND master_donor_id IS NULL)),
  UNIQUE (source_record_id, destination, source_revision)
);

CREATE INDEX csm_distribution_outbox_status_idx ON csm_distribution_outbox (status, updated_at DESC);
CREATE INDEX csm_distribution_outbox_source_idx ON csm_distribution_outbox (source_record_id, created_at DESC);

CREATE TABLE csm_distribution_attempts (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES csm_distribution_outbox(id),
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'failed')),
  response_status INTEGER,
  response_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (outbox_id, attempt_number)
);

CREATE INDEX csm_distribution_attempts_outbox_idx ON csm_distribution_attempts (outbox_id, attempt_number DESC);
