CREATE TABLE donation_splits (
 entry_id TEXT PRIMARY KEY REFERENCES paypal_transactions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 allocations_json TEXT NOT NULL CHECK(json_valid(allocations_json) AND json_type(allocations_json)='array'),
 updated_at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE donation_split_history (id INTEGER PRIMARY KEY AUTOINCREMENT,entry_id TEXT NOT NULL,revision INTEGER NOT NULL,allocations_json TEXT NOT NULL,updated_at TEXT NOT NULL,actor TEXT NOT NULL);
CREATE TRIGGER donation_split_validate_insert BEFORE INSERT ON donation_splits BEGIN
 SELECT CASE WHEN json_array_length(NEW.allocations_json)>0 AND (
 json_array_length(NEW.allocations_json) NOT BETWEEN 2 AND 100 OR
 NOT EXISTS(SELECT 1 FROM paypal_transactions WHERE id=NEW.entry_id AND direction='received' AND status='Completed' AND currency='USD' AND gross>0 AND event_code LIKE 'T00%' AND ROUND(gross*100)=(SELECT SUM(json_extract(value,'$.amountCents')) FROM json_each(NEW.allocations_json))) OR
 EXISTS(SELECT 1 FROM json_each(NEW.allocations_json) WHERE json_type(value,'$.amountCents') IS NOT 'integer' OR json_extract(value,'$.amountCents')<=0)
 ) THEN RAISE(ABORT,'Invalid donation split total') END;
 END;
CREATE TRIGGER donation_split_history_insert AFTER INSERT ON donation_splits BEGIN
 INSERT INTO donation_split_history(entry_id,revision,allocations_json,updated_at,actor) VALUES(NEW.entry_id,NEW.revision,NEW.allocations_json,NEW.updated_at,NEW.actor);
 END;
CREATE TRIGGER donation_split_validate_update BEFORE UPDATE ON donation_splits BEGIN
 SELECT CASE WHEN json_array_length(NEW.allocations_json)>0 AND (
 json_array_length(NEW.allocations_json) NOT BETWEEN 2 AND 100 OR
 NOT EXISTS(SELECT 1 FROM paypal_transactions WHERE id=NEW.entry_id AND direction='received' AND status='Completed' AND currency='USD' AND gross>0 AND event_code LIKE 'T00%' AND ROUND(gross*100)=(SELECT SUM(json_extract(value,'$.amountCents')) FROM json_each(NEW.allocations_json))) OR
 EXISTS(SELECT 1 FROM json_each(NEW.allocations_json) WHERE json_type(value,'$.amountCents') IS NOT 'integer' OR json_extract(value,'$.amountCents')<=0)
 ) THEN RAISE(ABORT,'Invalid donation split total') END;
 END;
CREATE TRIGGER donation_split_history_update AFTER UPDATE ON donation_splits BEGIN
 INSERT INTO donation_split_history(entry_id,revision,allocations_json,updated_at,actor) VALUES(NEW.entry_id,NEW.revision,NEW.allocations_json,NEW.updated_at,NEW.actor);
 END;
CREATE TRIGGER donation_split_protect_parent BEFORE UPDATE ON paypal_transactions
 WHEN EXISTS(SELECT 1 FROM donation_splits WHERE entry_id=OLD.id AND json_array_length(allocations_json)>0)
 BEGIN
 SELECT CASE WHEN NOT (NEW.direction='received') OR ROUND(NEW.gross*100) != (SELECT SUM(json_extract(value,'$.amountCents')) FROM donation_splits,json_each(allocations_json) WHERE entry_id=OLD.id) THEN RAISE(ABORT,'Undo donor split before changing its total or type') END;
 END;

CREATE TABLE donation_split_guards(value INTEGER CHECK(value=1));
CREATE TRIGGER donation_split_lock_insert BEFORE INSERT ON donation_splits WHEN EXISTS(SELECT 1 FROM csm_distribution_outbox WHERE source_record_id=NEW.entry_id) BEGIN SELECT RAISE(ABORT,'Edit transferred donation in HS'); END;
CREATE TRIGGER donation_split_lock_update BEFORE UPDATE ON donation_splits WHEN EXISTS(SELECT 1 FROM csm_distribution_outbox WHERE source_record_id=NEW.entry_id) BEGIN SELECT RAISE(ABORT,'Edit transferred donation in HS'); END;
CREATE TRIGGER donation_split_delivery_snapshot BEFORE INSERT ON csm_distribution_outbox WHEN COALESCE(json_extract(NEW.payload_json,'$.donorSplitRevision'),0) != COALESCE((SELECT revision FROM donation_splits WHERE entry_id=NEW.source_record_id),0) BEGIN SELECT RAISE(ABORT,'Donor allocations changed; retry delivery'); END;
