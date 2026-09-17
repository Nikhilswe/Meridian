CREATE TABLE IF NOT EXISTS policies (
  "policyId" TEXT PRIMARY KEY,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "effectiveDate" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policies_category ON policies ("category");
