-- Companies mirror src/companies.json (synced on every cron run) plus fetch status.
CREATE TABLE companies (
  key             TEXT PRIMARY KEY,          -- "<ats>:<slug>"
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  ats             TEXT NOT NULL,
  slug            TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error      TEXT,
  open_count      INTEGER NOT NULL DEFAULT 0
);

-- One row per job posting ever seen. Rows are only written when something
-- changes (new, edited, closed, reopened), to stay well inside D1 free-plan
-- write limits.
CREATE TABLE listings (
  id            TEXT PRIMARY KEY,            -- "<ats>:<slug>:<job id>"
  company_key   TEXT NOT NULL REFERENCES companies(key),
  title         TEXT NOT NULL,
  department    TEXT,
  team          TEXT,
  location      TEXT,                        -- primary location
  locations     TEXT,                        -- all locations, " · " separated
  remote        INTEGER NOT NULL DEFAULT 0,  -- 1 if remote is allowed
  workplace     TEXT,                        -- remote | hybrid | onsite
  employment    TEXT,                        -- full-time, intern, ...
  compensation  TEXT,
  url           TEXT NOT NULL,
  published_at  TEXT,                        -- as reported by the job board
  description   TEXT,                        -- plain text, capped
  first_seen_at TEXT NOT NULL,               -- when role-feed first saw it
  updated_at    TEXT NOT NULL,
  closed_at     TEXT                         -- NULL while still listed
);

CREATE INDEX listings_company_open ON listings (company_key, closed_at);
CREATE INDEX listings_first_seen ON listings (first_seen_at DESC);
