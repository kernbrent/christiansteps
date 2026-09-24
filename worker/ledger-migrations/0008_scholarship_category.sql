PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO categories (
  id,
  owner_id,
  name,
  tax_line,
  color,
  is_active,
  sort_order,
  created_at,
  updated_at
) VALUES (
  '7ee32db8-9531-4dc9-a501-3ce65fbd0113',
  'primary',
  'Scholarship',
  'Scholarships and grants',
  '#26735b',
  1,
  12,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

UPDATE categories
SET is_active = 1,
    tax_line = CASE
      WHEN trim(COALESCE(tax_line, '')) = '' THEN 'Scholarships and grants'
      ELSE tax_line
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE lower(name) = 'scholarship';
