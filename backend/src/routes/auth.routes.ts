import { Router } from "express";
import { z } from "zod";
import { LoginResponse } from "@scaler/shared-types";
import { IAuthProvider } from "../auth/IAuthProvider";
import { ValidationError } from "../domain/errors";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Self-service sign-up always creates a SUPPORT_AGENT. A `role` in the body
 * is deliberately NOT honoured here -- letting an anonymous caller pick
 * ADMIN would be a privilege-escalation hole. Promoting a user is an admin
 * action, not a registration option.
 */
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().trim().min(1, "Display name is required").max(120),
});

/**
 * Thin adapter: parse/validate -> call IAuthProvider -> respond. No auth
 * logic lives here.
 */
export function buildAuthRoutes(authProvider: IAuthProvider): Router {
  const router = Router();

  router.post("/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid login request", parsed.error.flatten());
      }

      const { token, user } = await authProvider.login(parsed.data.email, parsed.data.password);
      const body: LoginResponse = {
        token,
        user: { userId: user.userId, displayName: user.displayName, role: user.role },
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post("/signup", async (req, res, next) => {
    try {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid signup request", parsed.error.flatten());
      }

      const { token, user } = await authProvider.signup(
        parsed.data.email,
        parsed.data.password,
        parsed.data.displayName,
        "SUPPORT_AGENT",
      );
      const body: LoginResponse = {
        token,
        user: { userId: user.userId, displayName: user.displayName, role: user.role },
      };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
