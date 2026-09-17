import { Policy } from "@scaler/shared-types";

export interface IPolicyRepository {
  listAll(): Promise<Policy[]>;
  listByCategory(category: string): Promise<Policy[]>;
}
