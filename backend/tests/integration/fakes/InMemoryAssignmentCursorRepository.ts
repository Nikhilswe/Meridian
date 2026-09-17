import { IAssignmentCursorRepository } from "../../../src/repositories/IAssignmentCursorRepository";

export class InMemoryAssignmentCursorRepository implements IAssignmentCursorRepository {
  private lastIndex = 0;

  public async incrementAndGet(): Promise<number> {
    this.lastIndex += 1;
    return this.lastIndex;
  }

  public async reset(): Promise<void> {
    this.lastIndex = 0;
  }
}
