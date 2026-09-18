ALTER TABLE invoice_profiles
ADD COLUMN local_folder_name TEXT
CHECK (
  local_folder_name IS NULL
  OR length(trim(local_folder_name)) BETWEEN 1 AND 240
);
