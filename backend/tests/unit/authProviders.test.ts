import "reflect-metadata";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { LocalJwtAuthProvider } from "../../src/auth/LocalJwtAuthProvider";
import { CognitoAuthProviderStub } from "../../src/auth/CognitoAuthProviderStub";
import { buildAuthMiddleware } from "../../src/auth/authMiddleware";
import { IAuthProvider } from "../../src/auth/IAuthProvider";
import { User } from "@scaler/shared-types";
import { IUserRepository, UserWithCredentials } from "../../src/repositories/IUserRepository";
import { ISecretsProvider } from "../../src/secrets/ISecretsProvider";
import { ConflictError, UnauthorizedError } from "../../src/domain/errors";

const mockVerify = jest.fn();
jest.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: mockVerify })) },
}));

const SECRET = "unit-test-signing-secret";

function secrets(values: Record<string, string | undefined>): ISecretsProvider {
  return { get: async (name: string) => values[name] };
}

function userRepo(seed: UserWithCredentials[] = []) {
  const store = new Map(seed.map((u) => [u.userId, u]));
  const repo = {
    getById: jest.fn(async (id: string) => {
      const u = store.get(id);
      if (!u) return undefined;
      const { passwordHash: _h, ...user } = u;
      return user;
    }),
    getByEmailWithCredentials: jest.fn(async (email: string) => [...store.values()].find((u) => u.email === email)),
    listByRole: jest.fn(async () => [] as User[]),
    create: jest.fn(async (u: UserWithCredentials) => {
      store.set(u.userId, u);
      const { passwordHash: _h, ...user } = u;
      return user;
    }),
  };
  return repo as typeof repo & IUserRepository;
}

describe("LocalJwtAuthProvider", () => {
  let seeded: UserWithCredentials;
  beforeAll(async () => {
    seeded = { userId: "agent-1", displayName: "Asha", email: "asha@scaler.local", role: "SUPPORT_AGENT", passwordHash: await bcrypt.hash("AgentDemo!123", 4) };
  });

  it("login() bcrypt-verifies and returns an HS256 token whose claims verify() reads back", async () => {
    const provider = new LocalJwtAuthProvider(userRepo([seeded]), secrets({ JWT_SECRET: SECRET }));
    const { token, user } = await provider.login("asha@scaler.local", "AgentDemo!123");
    expect(user).toEqual({ userId: "agent-1", displayName: "Asha", email: "asha@scaler.local", role: "SUPPORT_AGENT" });
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe("HS256");
    await expect(provider.verify(token)).resolves.toEqual({ userId: "agent-1", role: "SUPPORT_AGENT" });
  });

  it("login() gives the same 401 for unknown email and wrong password (no user enumeration)", async () => {
    const provider = new LocalJwtAuthProvider(userRepo([seeded]), secrets({ JWT_SECRET: SECRET }));
    await expect(provider.login("nobody@x", "pw")).rejects.toThrow(new UnauthorizedError("Invalid email or password"));
    await expect(provider.login("asha@scaler.local", "wrong")).rejects.toThrow(new UnauthorizedError("Invalid email or password"));
  });

  it("verify() rejects tampered/expired tokens and tokens signed with another secret", async () => {
    const provider = new LocalJwtAuthProvider(userRepo(), secrets({ JWT_SECRET: SECRET }));
    await expect(provider.verify("not.a.jwt")).rejects.toBeInstanceOf(UnauthorizedError);
    const foreign = jwt.sign({ userId: "x", role: "ADMIN" }, "other-secret", { algorithm: "HS256" });
    await expect(provider.verify(foreign)).rejects.toBeInstanceOf(UnauthorizedError);
    const expired = jwt.sign({ userId: "x", role: "ADMIN" }, SECRET, { algorithm: "HS256", expiresIn: -10 });
    await expect(provider.verify(expired)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("fails closed when JWT_SECRET is not configured", async () => {
    const provider = new LocalJwtAuthProvider(userRepo([seeded]), secrets({}));
    await expect(provider.login("asha@scaler.local", "AgentDemo!123")).rejects.toThrow("JWT_SECRET is not configured");
  });

  it("honours JWT_EXPIRY and falls back to 8h", async () => {
    const original = process.env.JWT_EXPIRY;
    const provider = new LocalJwtAuthProvider(userRepo([seeded]), secrets({ JWT_SECRET: SECRET }));
    const secondsUntilExpiry = async () => {
      const { token } = await provider.login("asha@scaler.local", "AgentDemo!123");
      const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
      return exp - iat;
    };
    delete process.env.JWT_EXPIRY;
    expect(await secondsUntilExpiry()).toBe(8 * 3600);
    process.env.JWT_EXPIRY = "1h";
    expect(await secondsUntilExpiry()).toBe(3600);
    if (original === undefined) delete process.env.JWT_EXPIRY;
    else process.env.JWT_EXPIRY = original;
  });

  describe("signup()", () => {
    it("creates a SUPPORT_AGENT by default with a normalised email and a bcrypt hash, and logs them straight in", async () => {
      const repo = userRepo([seeded]);
      const provider = new LocalJwtAuthProvider(repo, secrets({ JWT_SECRET: SECRET }));

      const { token, user } = await provider.signup("  New.Agent@Scaler.Local ", "DemoPass!2026", "  New Agent ");

      expect(user.role).toBe("SUPPORT_AGENT");
      expect(user.email).toBe("new.agent@scaler.local");
      expect(user.displayName).toBe("New Agent");
      expect(user.userId).toMatch(/^user-[0-9a-f-]{36}$/);
      const stored = repo.create.mock.calls[0]![0];
      expect(stored.passwordHash).not.toBe("DemoPass!2026");
      expect(await bcrypt.compare("DemoPass!2026", stored.passwordHash)).toBe(true);
      await expect(provider.verify(token)).resolves.toEqual({ userId: user.userId, role: "SUPPORT_AGENT" });
      // ...and a normal login now works for the new account.
      await expect(provider.login("new.agent@scaler.local", "DemoPass!2026")).resolves.toMatchObject({ user: { userId: user.userId } });
    });

    it("accepts an explicit role for admin-driven flows", async () => {
      const provider = new LocalJwtAuthProvider(userRepo(), secrets({ JWT_SECRET: SECRET }));
      const { user } = await provider.signup("r@x.io", "password123", "R", "REVIEWER");
      expect(user.role).toBe("REVIEWER");
    });

    it("returns 409 ConflictError (not 401) for a duplicate email, case-insensitively, without creating anything", async () => {
      const repo = userRepo([seeded]);
      const provider = new LocalJwtAuthProvider(repo, secrets({ JWT_SECRET: SECRET }));
      await expect(provider.signup("ASHA@scaler.local", "password123", "Dup")).rejects.toBeInstanceOf(ConflictError);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});

describe("CognitoAuthProviderStub", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    mockVerify.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.AWS_REGION = "eu-west-1";
    process.env.COGNITO_CLIENT_ID = "client-123";
    process.env.COGNITO_USER_POOL_ID = "eu-west-1_abc";
  });

  it("login() calls InitiateAuth over HTTPS (no SDK credentials) and verifies the returned access token", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ AuthenticationResult: { AccessToken: "cognito-token" } }) });
    mockVerify.mockResolvedValueOnce({ sub: "sub-1", "custom:role": "REVIEWER" });

    const { token, user } = await new CognitoAuthProviderStub().login("a@b.c", "pw");

    expect(token).toBe("cognito-token");
    expect(user).toEqual({ userId: "sub-1", displayName: "a@b.c", email: "a@b.c", role: "REVIEWER" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cognito-idp.eu-west-1.amazonaws.com/");
    expect((init.headers as Record<string, string>)["X-Amz-Target"]).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: "client-123",
      AuthParameters: { USERNAME: "a@b.c", PASSWORD: "pw" },
    });
  });

  it("login() maps a non-2xx and a missing AccessToken to 401", async () => {
    const provider = new CognitoAuthProviderStub();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(provider.login("a@b.c", "pw")).rejects.toBeInstanceOf(UnauthorizedError);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ AuthenticationResult: {} }) });
    await expect(provider.login("a@b.c", "pw")).rejects.toThrow("did not return an access token");
  });

  it("verify() defaults the role to SUPPORT_AGENT when the custom claim is absent, and 401s on failure", async () => {
    const provider = new CognitoAuthProviderStub();
    mockVerify.mockResolvedValueOnce({ sub: 42 });
    await expect(provider.verify("t")).resolves.toEqual({ userId: "42", role: "SUPPORT_AGENT" });
    mockVerify.mockRejectedValueOnce(new Error("bad sig"));
    await expect(provider.verify("t")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("signup() is not self-service in AWS mode (must go through the Cognito console / hosted UI)", async () => {
    await expect(new CognitoAuthProviderStub().signup("a@b.c", "pw", "A")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("falls back to us-east-1 and empty ids when env is unset", async () => {
    delete process.env.AWS_REGION;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.COGNITO_USER_POOL_ID;
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(new CognitoAuthProviderStub().login("a", "b")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).ClientId).toBe("");
  });
});

describe("authMiddleware", () => {
  function run(header: string | undefined, verify: IAuthProvider["verify"]) {
    const req = { headers: { authorization: header } } as unknown as Request;
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    const provider = { verify } as unknown as IAuthProvider;
    return buildAuthMiddleware(provider)(req, res, next).then(() => ({ req, res, next, json }));
  }

  it("401s with a stable body when the header is missing or not a Bearer scheme", async () => {
    for (const header of [undefined, "Basic abc", "bearer lower"]) {
      const { res, json, next } = await run(header, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("attaches req.principal and calls next() on a valid token (trimming whitespace)", async () => {
    const verify = jest.fn(async () => ({ userId: "u1", role: "ADMIN" as const }));
    const { req, next } = await run("Bearer   tok  ", verify);
    expect(verify).toHaveBeenCalledWith("tok");
    expect(req.principal).toEqual({ userId: "u1", role: "ADMIN" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("401s when the provider rejects the token", async () => {
    const { res, json } = await run("Bearer bad", jest.fn(async () => { throw new Error("nope"); }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  });
});
