import { User, UserRole } from "@meridian/shared-types";

export interface UserWithCredentials extends User {
  passwordHash: string;
}

export interface IUserRepository {
  getById(userId: string): Promise<User | undefined>;
  getByEmailWithCredentials(email: string): Promise<UserWithCredentials | undefined>;
  listByRole(role: UserRole): Promise<User[]>;
  create(user: {
    userId: string;
    email: string;
    displayName: string;
    role: UserRole;
    passwordHash: string;
  }): Promise<User>;
}
