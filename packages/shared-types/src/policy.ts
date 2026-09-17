/**
 * Stub reference data used as retrieval context by the summarisation harness.
 * In AWS mode these live in their own DynamoDB tables; offline they are plain
 * Postgres tables seeded by backend/migrations.
 */

export interface Policy {
  policyId: string;
  category: string; // e.g. "refunds", "shipping", "account-security"
  title: string;
  body: string;
  version: number;
  effectiveDate: string;
}

export interface Order {
  orderId: string;
  customerId: string;
  itemSummary: string;
  orderDate: string;
  amount: number;
  currency: string;
  status: "PLACED" | "SHIPPED" | "DELIVERED" | "REFUNDED" | "CANCELLED";
  /** ISO-8601. Required by delivery-window policies; absent means "not yet known", never "zero days". */
  deliveredDate?: string;
}
