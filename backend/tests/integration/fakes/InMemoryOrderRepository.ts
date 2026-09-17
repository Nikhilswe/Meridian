import { Order } from "@scaler/shared-types";
import { IOrderRepository } from "../../../src/repositories/IOrderRepository";

export class InMemoryOrderRepository implements IOrderRepository {
  constructor(private readonly orders: Order[] = []) {}

  public async listByCustomerId(customerId: string): Promise<Order[]> {
    return this.orders.filter((o) => o.customerId === customerId);
  }
}
