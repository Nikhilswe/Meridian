import type { LoginRequest, LoginResponse, SignupRequest } from "@scaler/shared-types";
import { apiPost } from "./client";

export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/api/auth/login", req);
}

export function signup(req: SignupRequest): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/api/auth/signup", req);
}
