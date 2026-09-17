import { Pool } from "pg";
import { inject, injectable } from "tsyringe";
import { User, UserRole } from "@scaler/shared-types";
import { IUserRepository, UserWithCredentials } from "../IUserRepository";
import { mapUserRow, mapUserWithCredentialsRow } from "./rowMappers";

@injectable()
export class PostgresUserRepository implements IUserRepository {
  constructor(@inject("Pool") private readonly pool: Pool) {}

  public async getById(userId: string): Promise<User | undefined> {
    const result = await this.pool.query(`SELECT * FROM users WHERE "userId" = $1`, [userId]);
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  public async getByEmailWithCredentials(email: string): Promise<UserWithCredentials | undefined> {
    const result = await this.pool.query(`SELECT * FROM users WHERE "email" = $1`, [email]);
    return result.rows[0] ? mapUserWithCredentialsRow(result.rows[0]) : undefined;
  }

  public async listByRole(role: UserRole): Promise<User[]> {
    const result = await this.pool.query(`SELECT * FROM users WHERE "role" = $1 ORDER BY "displayName"`, [role]);
    return result.rows.map(mapUserRow);
  }

  public async create(user: {
    userId: string;
    email: string;
    displayName: string;
    role: UserRole;
    passwordHash: string;
  }): Promise<User> {
    // Same column list as db/seed.ts. The UNIQUE constraint on "email" is
    // the real duplicate guard; LocalJwtAuthProvider checks first only to
    // give a friendlier 409 than a raw pg unique-violation.
    const result = await this.pool.query(
      `INSERT INTO users ("userId", "displayName", "email", "role", "passwordHash")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.userId, user.displayName, user.email, user.role, user.passwordHash],
    );
    return mapUserRow(result.rows[0]);
  }
}
