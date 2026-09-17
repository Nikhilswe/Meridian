import { Pool } from "pg";
import { inject, injectable } from "tsyringe";
import { Order } from "@scaler/shared-types";
import { IOrderRepository } from "../IOrderRepository";
import { mapOrderRow } from "./rowMappers";

@injectable()
export class PostgresOrderRepository implements IOrderRepository {
  constructor(@inject("Pool") private readonly pool: Pool) {}

  public async listByCustomerId(customerId: string): Promise<Order[]> {
    const result = await this.pool.query(
      `SELECT * FROM orders WHERE "customerId" = $1 ORDER BY "orderDate" DESC`,
      [customerId],
    );
    return result.rows.map(mapOrderRow);
  }
}
