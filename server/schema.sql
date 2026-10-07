PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'company'))
);

CREATE TABLE IF NOT EXISTS grp (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grp_member (
  group_id TEXT NOT NULL REFERENCES grp(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, persona_id)
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'x', 'github', 'instagram', 'tiktok', 'youtube', 'reddit')),
  handle TEXT NOT NULL,
  url TEXT NOT NULL,
  display_name TEXT,
  avatar_file TEXT,
  avatar_updated_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (platform, handle)
);

-- Append-only: one row per observation of an account.
CREATE TABLE IF NOT EXISTS account_snapshot (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS account_snapshot_by_time ON account_snapshot (account_id, taken_at);

CREATE TABLE IF NOT EXISTS post (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  url TEXT,
  posted_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'post',
  text TEXT,
  media TEXT,
  tier TEXT NOT NULL DEFAULT 'active' CHECK (tier IN ('active', 'warm', 'cooling', 'stale')),
  next_check_at TEXT,
  last_checked_at TEXT,
  UNIQUE (account_id, platform_post_id)
);
CREATE INDEX IF NOT EXISTS post_due ON post (account_id, tier, next_check_at);

-- Append-only: one row per observation of a post.
CREATE TABLE IF NOT EXISTS post_snapshot (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  views INTEGER,
  bookmarks INTEGER,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS post_snapshot_by_time ON post_snapshot (post_id, taken_at);

CREATE TABLE IF NOT EXISTS github_day (
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  contributions INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  account_id INTEGER REFERENCES account(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error', 'skipped')),
  items INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  actor_id TEXT,
  apify_run_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS run_by_job ON run (job, account_id, started_at);

-- Raw responses, gzipped, so parsing can be redone later without paying again.
CREATE TABLE IF NOT EXISTS raw_payload (
  run_id INTEGER PRIMARY KEY REFERENCES run(id) ON DELETE CASCADE,
  body BLOB NOT NULL
);

-- GitHub's events feed (last 90 days, 300 events max per read), kept so history outlives that window.
CREATE TABLE IF NOT EXISTS github_event (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  action TEXT,
  repo TEXT,
  title TEXT,
  url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS github_event_by_time ON github_event (account_id, created_at);

-- Typed daily GitHub counts from the contributions collection (last year, re-read every run).
CREATE TABLE IF NOT EXISTS github_activity_day (
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('commits', 'prs_opened', 'prs_merged', 'reviews', 'issues_opened')),
  n INTEGER NOT NULL,
  PRIMARY KEY (account_id, day, kind)
);

-- LinkedIn impressions are private to the author; they come from LinkedIn's own analytics
-- export (.xlsx) dropped into data/imports/linkedin/.
CREATE TABLE IF NOT EXISTS post_impression (
  post_id INTEGER NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  members_reached INTEGER,
  source TEXT NOT NULL,
  PRIMARY KEY (post_id, taken_at)
);

CREATE TABLE IF NOT EXISTS account_day (
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  impressions INTEGER,
  engagements INTEGER,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS import_file (
  path TEXT PRIMARY KEY,
  mtime TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  note TEXT
);

-- Per-day counts for a GitHub repository. Stars are exact (from star timestamps); the rest
-- are the daily change in the repository's totals.
CREATE TABLE IF NOT EXISTS github_repo_day (
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (account_id, day, kind)
);
