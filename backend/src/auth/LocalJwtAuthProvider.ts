import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import { randomUUID } from "node:crypto";
import { AuthenticatedPrincipal, User, UserRole } from "@meridian/shared-types";
import { IUserRepository } from "../repositories/IUserRepository";
import { ISecretsProvider } from "../secrets/ISecretsProvider";
import { ConflictError, UnauthorizedError } from "../domain/errors";
import { IAuthProvider } from "./IAuthProvider";

/** Matches db/seed.ts so seeded and signed-up hashes cost the same to verify. */
const BCRYPT_COST = 10;

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

    return this.generateTokenAndUser(record.userId, record.displayName, record.email, record.role);
  }

  /**
   * Self-service registration. Same bcrypt cost as the seed script so a
   * signed-up user and a seeded user are indistinguishable at login time.
   * Duplicate email is a 409 (ConflictError), never a 401 -- the caller is
   * not "unauthorised", the record already exists.
   */
  public async signup(
    email: string,
    password: string,
    displayName: string,
    role: UserRole = "SUPPORT_AGENT",
  ): Promise<{ token: string; user: User }> {
    const normalisedEmail = email.trim().toLowerCase();
    const existing = await this.userRepo.getByEmailWithCredentials(normalisedEmail);
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const created = await this.userRepo.create({
      userId: `user-${randomUUID()}`,
      email: normalisedEmail,
      displayName: displayName.trim(),
      role,
      passwordHash,
    });

    return this.generateTokenAndUser(created.userId, created.displayName, created.email, created.role);
  }

  private async generateTokenAndUser(
    userId: string,
    displayName: string,
    email: string,
    role: AuthenticatedPrincipal["role"],
  ): Promise<{ token: string; user: User }> {
    const secret = await this.getSigningSecret();
    const expiry = process.env.JWT_EXPIRY || "8h";
    const claims: JwtClaims = { userId, role };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: expiry as any });

    const user: User = {
      userId,
      displayName,
      email,
      role,
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
