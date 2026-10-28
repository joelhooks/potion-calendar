CREATE TABLE calendar_custom_video_links (
  person_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  link TEXT NOT NULL CHECK (length(link) > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'removed')),
  PRIMARY KEY (person_id, id)
);
CREATE TABLE calendar_account_custom_conferencing (
  person_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  PRIMARY KEY (person_id, account_id),
  FOREIGN KEY (person_id, account_id) REFERENCES calendar_account_conferencing(person_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, link_id) REFERENCES calendar_custom_video_links(person_id, id)
);
CREATE INDEX calendar_account_custom_conferencing_link_idx ON calendar_account_custom_conferencing(person_id, link_id);
