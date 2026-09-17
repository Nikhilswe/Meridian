import * as bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
import { createPool } from "./pool";

dotenv.config();

/**
 * Seeds demo users (3 support agents + 1 reviewer/admin, plus a dedicated
 * smoke-test user), a handful of policies/orders, and resets the
 * round-robin assignment cursor to 0. Idempotent: re-running upserts rather
 * than duplicating rows.
 *
 * Demo passwords are printed to the console ONCE, here, at seed time --
 * never logged anywhere else in the app.
 */

interface SeedUser {
  userId: string;
  displayName: string;
  email: string;
  role: "SUPPORT_AGENT" | "REVIEWER" | "ADMIN";
  plaintextPassword: string;
}

const SEED_USERS: SeedUser[] = [
  {
    userId: "agent-1",
    displayName: "Asha Kapoor",
    email: "asha.kapoor@scaler.local",
    role: "SUPPORT_AGENT",
    plaintextPassword: "AgentDemo!123",
  },
  {
    userId: "agent-2",
    displayName: "Marco Silva",
    email: "marco.silva@scaler.local",
    role: "SUPPORT_AGENT",
    plaintextPassword: "AgentDemo!123",
  },
  {
    userId: "agent-3",
    displayName: "Wen Zhao",
    email: "wen.zhao@scaler.local",
    role: "SUPPORT_AGENT",
    plaintextPassword: "AgentDemo!123",
  },
  {
    userId: "reviewer-1",
    displayName: "Priya Nair",
    email: "priya.nair@scaler.local",
    role: "REVIEWER",
    plaintextPassword: "ReviewerDemo!123",
  },
  {
    userId: "smoke-test-agent",
    displayName: "Smoke Test Agent",
    email: "smoke-test@scaler.local",
    role: "SUPPORT_AGENT",
    plaintextPassword: process.env.SMOKE_TEST_PASSWORD || "SmokeTest!123",
  },
];

const SEED_POLICIES = [
  {
    policyId: "policy-refunds-1",
    category: "refunds",
    title: "Standard refund window",
    body: "Customers may request a full refund within 30 days of delivery if the item is unused and in its original packaging.",
  },
  {
    policyId: "policy-refunds-2",
    category: "refunds",
    title: "Damaged or defective items",
    body: "Items that arrive damaged or defective are eligible for a full refund or replacement at no cost, regardless of the standard refund window.",
  },
  {
    policyId: "policy-shipping-1",
    category: "shipping",
    title: "Standard shipping timelines",
    body: "Standard shipping typically takes 3-7 business days. Orders delayed beyond 10 business days are eligible for a shipping fee refund.",
  },
  {
    policyId: "policy-shipping-2",
    category: "shipping",
    title: "Lost package procedure",
    body: "If a tracked package shows no movement for 5+ business days, open a carrier investigation and offer the customer a replacement or refund.",
  },
  {
    policyId: "policy-account-security-1",
    category: "account-security",
    title: "Suspicious login response",
    body: "If a customer reports a suspicious login, immediately force a password reset and review recent account activity with them.",
  },
];

const SEED_ORDERS = [
  {
    orderId: "order-1001",
    customerId: "agent-1",
    itemSummary: "Wireless headphones",
    amount: 89.99,
    currency: "USD",
    status: "DELIVERED" as const,
  },
  {
    orderId: "order-1002",
    customerId: "agent-1",
    itemSummary: "USB-C charging cable (2-pack)",
    amount: 14.5,
    currency: "USD",
    status: "SHIPPED" as const,
  },
  {
    orderId: "order-1003",
    customerId: "smoke-test-agent",
    itemSummary: "Mechanical keyboard",
    amount: 129.0,
    currency: "USD",
    status: "DELIVERED" as const,
  },
];

async function seed(): Promise<void> {
  const pool = createPool();

  console.log("Seeding users...");
  const printedCredentials: string[] = [];
  for (const user of SEED_USERS) {
    const passwordHash = await bcrypt.hash(user.plaintextPassword, 10);
    await pool.query(
      `INSERT INTO users ("userId", "displayName", "email", "role", "passwordHash")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("userId") DO UPDATE SET
         "displayName" = EXCLUDED."displayName",
         "email" = EXCLUDED."email",
         "role" = EXCLUDED."role",
         "passwordHash" = EXCLUDED."passwordHash"`,
      [user.userId, user.displayName, user.email, user.role, passwordHash],
    );
    printedCredentials.push(`  ${user.email}  /  ${user.plaintextPassword}  (${user.role})`);
  }

  console.log("Seeding policies...");
  for (const policy of SEED_POLICIES) {
    await pool.query(
      `INSERT INTO policies ("policyId", "category", "title", "body", "version", "effectiveDate")
       VALUES ($1, $2, $3, $4, 1, now())
       ON CONFLICT ("policyId") DO UPDATE SET
         "category" = EXCLUDED."category",
         "title" = EXCLUDED."title",
         "body" = EXCLUDED."body"`,
      [policy.policyId, policy.category, policy.title, policy.body],
    );
  }

  console.log("Seeding orders...");
  for (const order of SEED_ORDERS) {
    await pool.query(
      `INSERT INTO orders ("orderId", "customerId", "itemSummary", "orderDate", "amount", "currency", "status")
       VALUES ($1, $2, $3, now(), $4, $5, $6)
       ON CONFLICT ("orderId") DO UPDATE SET
         "customerId" = EXCLUDED."customerId",
         "itemSummary" = EXCLUDED."itemSummary",
         "amount" = EXCLUDED."amount",
         "currency" = EXCLUDED."currency",
         "status" = EXCLUDED."status"`,
      [order.orderId, order.customerId, order.itemSummary, order.amount, order.currency, order.status],
    );
  }

  console.log("Resetting assignment cursor...");
  await pool.query(
    `INSERT INTO assignment_cursor (id, "lastIndex") VALUES (1, 0)
     ON CONFLICT (id) DO UPDATE SET "lastIndex" = 0`,
  );

  await pool.end();

  console.log("\nSeed complete. Demo login credentials (printed once, here only):");
  for (const line of printedCredentials) {
    console.log(line);
  }
}

seed().catch((err) => {
  console.error("Seed failed:", (err as Error).message);
  process.exit(1);
});
