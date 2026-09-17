CREATE TABLE IF NOT EXISTS assignment_cursor (
  id INTEGER PRIMARY KEY,
  "lastIndex" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO assignment_cursor (id, "lastIndex")
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
