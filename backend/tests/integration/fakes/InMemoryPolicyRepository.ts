import { Policy } from "@scaler/shared-types";
import { IPolicyRepository } from "../../../src/repositories/IPolicyRepository";

export class InMemoryPolicyRepository implements IPolicyRepository {
  constructor(private readonly policies: Policy[] = []) {}

  public async listAll(): Promise<Policy[]> {
    return [...this.policies];
  }

  public async listByCategory(category: string): Promise<Policy[]> {
    return this.policies.filter((p) => p.category === category);
  }
}
