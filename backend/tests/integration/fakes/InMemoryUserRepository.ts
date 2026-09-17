import { User, UserRole } from "@scaler/shared-types";
import { IUserRepository, UserWithCredentials } from "../../../src/repositories/IUserRepository";

/**
 * In-memory stand-in for PostgresUserRepository. Seeded directly by the
 * integration test's container setup (see setupTestContainer.ts) with known
 * plaintext-password/bcrypt-hash pairs so tests can log in as real users.
 */
export class InMemoryUserRepository implements IUserRepository {
  private readonly usersById = new Map<string, UserWithCredentials>();

  public seed(users: UserWithCredentials[]): void {
    for (const user of users) {
      this.usersById.set(user.userId, user);
    }
  }

  public async getById(userId: string): Promise<User | undefined> {
    const record = this.usersById.get(userId);
    if (!record) return undefined;
    const { passwordHash: _unused, ...user } = record;
    return user;
  }

  public async getByEmailWithCredentials(email: string): Promise<UserWithCredentials | undefined> {
    return Array.from(this.usersById.values()).find((u) => u.email === email);
  }

  public async listByRole(role: UserRole): Promise<User[]> {
    return Array.from(this.usersById.values())
      .filter((u) => u.role === role)
      .map(({ passwordHash: _unused, ...user }) => user)
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }

  public async create(user: {
    userId: string;
    email: string;
    displayName: string;
    role: UserRole;
    passwordHash: string;
  }): Promise<User> {
    this.usersById.set(user.userId, { ...user });
    const { passwordHash: _unused, ...created } = user;
    return created;
  }
}
