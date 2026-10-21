CREATE TABLE google_push_unsupported (
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  status INTEGER NOT NULL CHECK (status IN (400, 403)),
  reason_codes TEXT NOT NULL CHECK (json_valid(reason_codes) AND json_type(reason_codes) = 'array' AND json_array_length(reason_codes) > 0),
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, account_id, calendar_id)
);
