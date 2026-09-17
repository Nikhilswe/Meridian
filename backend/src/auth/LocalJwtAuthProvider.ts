import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import { AuthenticatedPrincipal, User } from "@scaler/shared-types";
import { IUserRepository } from "../repositories/IUserRepository";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { UnauthorizedError } from "../domain/errors";
import { IAuthProvider } from "./IAuthProvider";

interface JwtClaims {
  userId: string;
  role: AuthenticatedPrincipal["role"];
}

/**
 * Offline auth: bcrypt-compares against the `passwordHash` column
 * (users table, see db/migrations) and signs an HS256 JWT. The signing
 * secret is resolved through ISecretsProvider (never hardcoded, never
 * logged) -- only the expiry, a non-secret tunable, comes straight from
 * JWT_EXPIRY.
 */
@injectable()
export class LocalJwtAuthProvider implements IAuthProvider {
  constructor(
    @inject("IUserRepository") private readonly userRepo: IUserRepository,
    @inject("ISecretsProvider") private readonly secrets: ISecretsProvider,
  ) {}

  public async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const record = await this.userRepo.getByEmailWithCredentials(email);
    if (!record) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(password, record.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const secret = await this.getSigningSecret();
    const expiry = process.env.JWT_EXPIRY || "8h";
    const claims: JwtClaims = { userId: record.userId, role: record.role };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: expiry as any });

    const user: User = {
      userId: record.userId,
      displayName: record.displayName,
      email: record.email,
      role: record.role,
    };
    return { token, user };
  }

  public async verify(token: string): Promise<AuthenticatedPrincipal> {
    const secret = await this.getSigningSecret();
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as unknown as JwtClaims;
      return { userId: decoded.userId, role: decoded.role };
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
  }

  private async getSigningSecret(): Promise<string> {
    const secret = await this.secrets.get("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }
    return secret;
  }
}
