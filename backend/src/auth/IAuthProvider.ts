import { AuthenticatedPrincipal, User } from "@scaler/shared-types";

/**
 * Auth seam. Offline: LocalJwtAuthProvider (bcrypt + signed JWT). AWS mode:
 * CognitoAuthProviderStub (verifies a Cognito-issued JWT against the user
 * pool's JWKS). Routes/middleware only ever depend on this interface.
 */
export interface IAuthProvider {
  login(email: string, password: string): Promise<{ token: string; user: User }>;
  verify(token: string): Promise<AuthenticatedPrincipal>;
}
