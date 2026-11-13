-- Inbox-style archiving: set when you archive a listing, NULL otherwise.
-- The poller's upsert never touches this column, so a listing stays archived
-- across edits, closes and reopens.
ALTER TABLE listings ADD COLUMN archived_at TEXT;
