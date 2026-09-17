import type { LoginRequest, LoginResponse } from "@scaler/shared-types";
import { apiPost } from "./client";

export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/api/auth/login", req);
}
