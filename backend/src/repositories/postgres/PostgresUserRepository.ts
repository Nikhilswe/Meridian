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
}
