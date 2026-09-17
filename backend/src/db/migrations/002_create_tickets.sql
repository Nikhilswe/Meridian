CREATE TABLE IF NOT EXISTS tickets (
  "ticketId" TEXT PRIMARY KEY,
  "creatorId" TEXT NOT NULL,
  "assigneeId" TEXT NULL,
  "ticketStatus" TEXT NOT NULL CHECK (
    "ticketStatus" IN ('OPEN', 'ASSIGNED', 'IN_REVIEW', 'DRAFT_PENDING_REVIEW', 'RESOLVED', 'CLOSED')
  ),
  "ticketCreationDate" TIMESTAMPTZ NOT NULL,
  "ticketResolvedDate" TIMESTAMPTZ NULL,
  "ticketOverview" TEXT NOT NULL,
  "attachedDocuments" JSONB NOT NULL DEFAULT '[]',
  "caseSummary" TEXT NULL,
  "draftMessage" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON tickets ("assigneeId");
CREATE INDEX IF NOT EXISTS idx_tickets_creator_id ON tickets ("creatorId");
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets ("ticketStatus");
CREATE INDEX IF NOT EXISTS idx_tickets_creation_date ON tickets ("ticketCreationDate" DESC, "ticketId" DESC);
