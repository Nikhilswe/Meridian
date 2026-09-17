import { Policy } from "@meridian/shared-types";

export interface IPolicyRepository {
  listAll(): Promise<Policy[]>;
  listByCategory(category: string): Promise<Policy[]>;
}
