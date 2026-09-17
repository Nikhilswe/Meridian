import { Pool } from "pg";
import { inject, injectable } from "tsyringe";
import { IAssignmentCursorRepository } from "../IAssignmentCursorRepository";

/**
 * Single fixed row (id = 1) holding the last-used round-robin index.
 * `incrementAndGet` uses an atomic `UPDATE ... RETURNING` so two concurrent
 * ticket-creation events can never both read the same "next" index.
 */
@injectable()
export class PostgresAssignmentCursorRepository implements IAssignmentCursorRepository {
  constructor(@inject("Pool") private readonly pool: Pool) {}

  public async incrementAndGet(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE assignment_cursor SET "lastIndex" = "lastIndex" + 1 WHERE id = 1 RETURNING "lastIndex"`,
    );
    if (result.rows.length === 0) {
      throw new Error("assignment_cursor row (id=1) is missing -- did seed.ts run?");
    }
    return Number(result.rows[0].lastIndex);
  }

  public async reset(): Promise<void> {
    await this.pool.query(`UPDATE assignment_cursor SET "lastIndex" = 0 WHERE id = 1`);
  }
}
