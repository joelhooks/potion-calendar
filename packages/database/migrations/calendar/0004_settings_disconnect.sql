CREATE TABLE calendar_account_disconnect (
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('reserved', 'stopped', 'removed', 'done')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, account_id)
);
CREATE INDEX calendar_disconnect_reservations ON calendar_account_disconnect (person_id, account_id) WHERE phase <> 'done';
