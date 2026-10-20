CREATE TABLE google_push_channel (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('events', 'calendarList')),
  token_hash TEXT NOT NULL,
  resource_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  predecessor_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'stopping', 'stopped', 'orphaned')),
  CHECK ((kind = 'events' AND calendar_id IS NOT NULL) OR (kind = 'calendarList' AND calendar_id IS NULL))
);
CREATE INDEX google_push_person_page ON google_push_channel (person_id, id) WHERE state IN ('pending', 'active', 'stopping');
CREATE INDEX google_push_expiration ON google_push_channel (expires_at, id);
CREATE UNIQUE INDEX google_push_active_resource ON google_push_channel (person_id, account_id, kind, coalesce(calendar_id, '')) WHERE state = 'active';
