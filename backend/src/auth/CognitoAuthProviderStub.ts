import { CognitoJwtVerifier } from "aws-jwt-verify";
import { injectable } from "tsyringe";
import { AuthenticatedPrincipal, User, UserRole } from "@scaler/shared-types";
import { UnauthorizedError } from "../domain/errors";
import { IAuthProvider } from "./IAuthProvider";

/**
 * AWS-mode swap-in for IAuthProvider: verifies tokens against a real Cognito
 * User Pool's JWKS (via aws-jwt-verify, which handles JWKS fetching/caching
 * and signature verification correctly) instead of a locally-signed JWT.
 * `login` calls Cognito's InitiateAuth (USER_PASSWORD_AUTH flow) directly
 * over HTTPS -- no AWS SDK credentials are required for this call when the
 * app client has no client secret, which is the standard setup for a
 * browser/SPA-facing app client.
 *
 * Written correctly but never invoked offline/in tests -- the DI container
 * only wires this in when running in AWS mode (see src/di/container.ts).
 * Everything downstream (authMiddleware, routes) depends only on
 * IAuthProvider, so switching from LocalJwtAuthProvider to this class is a
 * one-line change in the container, nothing else.
 */
@injectable()
export class CognitoAuthProviderStub implements IAuthProvider {
  // Read directly from process.env rather than via constructor parameters,
  // so tsyringe never has to resolve a primitive `string` DI token when
  // auto-constructing this class.
  private readonly region: string = process.env.AWS_REGION || "us-east-1";
  private readonly clientId: string = process.env.COGNITO_CLIENT_ID || "";
  private readonly verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID || "",
    tokenUse: "access",
    clientId: process.env.COGNITO_CLIENT_ID || "",
  });

  public async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const response = await fetch(`https://cognito-idp.${this.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: this.clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    });

    if (!response.ok) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const body = (await response.json()) as {
      AuthenticationResult?: { AccessToken?: string; IdToken?: string };
    };
    const accessToken = body.AuthenticationResult?.AccessToken;
    if (!accessToken) {
      throw new UnauthorizedError("Cognito did not return an access token");
    }

    const principal = await this.verify(accessToken);
    const user: User = {
      userId: principal.userId,
      displayName: email,
      email,
      role: principal.role,
    };
    return { token: accessToken, user };
  }

  /**
   * Self-service registration is deliberately not exposed in AWS mode: user
   * creation belongs to Cognito (hosted UI, or an admin's SignUp +
   * ConfirmSignUp flow), where MFA/verification policy lives. Kept as an
   * explicit refusal so the IAuthProvider contract is honoured.
   */
  public async signup(_email: string, _password: string, _displayName: string, _role?: UserRole): Promise<{ token: string; user: User }> {
    throw new UnauthorizedError("Sign-up is managed by AWS Cognito in this environment");
  }

  public async verify(token: string): Promise<AuthenticatedPrincipal> {
    try {
      const payload = await this.verifier.verify(token);
      const role = (payload["custom:role"] as UserRole | undefined) ?? "SUPPORT_AGENT";
      return { userId: String(payload.sub), role };
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
  }
}
