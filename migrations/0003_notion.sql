-- The Notion page a listing was sent to ("Add to Notion"), so the button
-- shows it's already there and doesn't create a duplicate. Like archived_at,
-- the poller's upsert never touches this column.
ALTER TABLE listings ADD COLUMN notion_url TEXT;
