import { Order } from "@scaler/shared-types";

export interface IOrderRepository {
  listByCustomerId(customerId: string): Promise<Order[]>;
}
