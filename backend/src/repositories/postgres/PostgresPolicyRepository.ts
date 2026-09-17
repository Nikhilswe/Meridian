import { Pool } from "pg";
import { inject, injectable } from "tsyringe";
import { Policy } from "@meridian/shared-types";
import { IPolicyRepository } from "../IPolicyRepository";
import { mapPolicyRow } from "./rowMappers";

@injectable()
export class PostgresPolicyRepository implements IPolicyRepository {
  constructor(@inject("Pool") private readonly pool: Pool) {}

  public async listAll(): Promise<Policy[]> {
    const result = await this.pool.query(`SELECT * FROM policies ORDER BY "category", "title"`);
    return result.rows.map(mapPolicyRow);
  }

  public async listByCategory(category: string): Promise<Policy[]> {
    const result = await this.pool.query(`SELECT * FROM policies WHERE "category" = $1 ORDER BY "title"`, [
      category,
    ]);
    return result.rows.map(mapPolicyRow);
  }
}
