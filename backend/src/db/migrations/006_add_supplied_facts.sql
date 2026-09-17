-- Items 1-4 of the Meridian gap list: record-backed facts on the ticket, the
-- delivery date on orders (required by delivery-window policies), and the
-- exact context/checks each generated draft was based on.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS "customerId" TEXT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS "orderId" TEXT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS "suppliedContext" JSONB NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets ("customerId");

ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveredDate" TIMESTAMPTZ NULL;
