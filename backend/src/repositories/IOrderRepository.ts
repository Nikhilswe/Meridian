import { Order } from "@scaler/shared-types";

export interface IOrderRepository {
  listByCustomerId(customerId: string): Promise<Order[]>;
  getById(orderId: string): Promise<Order | undefined>;
}
