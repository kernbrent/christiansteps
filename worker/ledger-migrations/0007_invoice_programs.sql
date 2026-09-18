PRAGMA foreign_keys = ON;

ALTER TABLE invoice_profiles
  ADD COLUMN program TEXT NOT NULL DEFAULT 'HopeSojourns'
  CHECK (program IN ('ChristianSteps', 'HopeSojourns'));

ALTER TABLE invoices
  ADD COLUMN program TEXT NOT NULL DEFAULT 'HopeSojourns'
  CHECK (program IN ('ChristianSteps', 'HopeSojourns'));
