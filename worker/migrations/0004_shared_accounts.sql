-- End legacy unattributed sessions before shared account activation. Financial
-- ownership stays 'primary' and no finance tables or records are changed.
DELETE FROM admin_sessions;
CREATE TABLE shared_account_activity (
 id TEXT PRIMARY KEY,actor_user_id TEXT NOT NULL,portal TEXT NOT NULL DEFAULT 'csm',
 method TEXT NOT NULL,path TEXT NOT NULL,response_status INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX shared_activity_actor ON shared_account_activity(actor_user_id,created_at);
