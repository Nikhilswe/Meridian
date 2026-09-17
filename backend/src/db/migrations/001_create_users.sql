CREATE TABLE IF NOT EXISTS users (
  "userId" TEXT PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "role" TEXT NOT NULL CHECK ("role" IN ('SUPPORT_AGENT', 'REVIEWER', 'ADMIN')),
  "passwordHash" TEXT NOT NULL
);
