CREATE TABLE IF NOT EXISTS orders (
  "orderId" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "itemSummary" TEXT NOT NULL,
  "orderDate" TIMESTAMPTZ NOT NULL,
  "amount" NUMERIC(12, 2) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('PLACED', 'SHIPPED', 'DELIVERED', 'REFUNDED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders ("customerId");
