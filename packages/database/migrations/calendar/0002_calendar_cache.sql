CREATE TABLE calendar_snapshot (
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  cursor TEXT,
  PRIMARY KEY (person_id, account_id, calendar_id)
);

CREATE TABLE calendar_range (
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  events TEXT NOT NULL CHECK (json_valid(events)),
  PRIMARY KEY (person_id, account_id, calendar_id, version, range_start, range_end)
);

CREATE INDEX calendar_range_expiration ON calendar_range (expires_at);
