-- Set while an "Add to Notion" request is creating the page, so a second
-- request for the same listing (another tab, a retry) doesn't create a
-- duplicate. Cleared once notion_url is recorded or the request fails; a
-- claim older than a couple of minutes is treated as abandoned.
ALTER TABLE listings ADD COLUMN notion_claimed_at TEXT;
