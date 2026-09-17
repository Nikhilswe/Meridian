import { Pool } from "pg";

/**
 * Single shared pg.Pool built from DATABASE_URL. Consumers (repositories)
 * receive this via DI (see src/di/container.ts) rather than importing it
 * directly, so tests can substitute an in-memory repository without ever
 * touching a real Pool.
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({ connectionString });
}
