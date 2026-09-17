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

  return router;
}
