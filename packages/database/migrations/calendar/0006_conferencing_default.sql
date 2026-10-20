CREATE TABLE calendar_account_conferencing (person_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, value TEXT NOT NULL CHECK (value IN ('unset', 'none', 'googleMeet')), PRIMARY KEY (person_id, account_id));
CREATE INDEX calendar_account_conferencing_account_idx ON calendar_account_conferencing(account_id);
