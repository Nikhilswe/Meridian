export type UserRole = "SUPPORT_AGENT" | "REVIEWER" | "ADMIN";

export interface User {
  userId: string;
  displayName: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedPrincipal {
  userId: string;
  role: UserRole;
}
