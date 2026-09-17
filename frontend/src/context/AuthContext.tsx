import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LoginResponse, SignupRequest } from "@scaler/shared-types";
import { login as loginRequest, signup as signupRequest } from "../api/auth";
import { setAuthToken, setUnauthorizedHandler } from "../api/client";

type AuthUser = LoginResponse["user"];

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Auth state lives in memory only (component state) -- no localStorage /
 * sessionStorage, per this project's browser-storage rules. A page reload
 * therefore logs the user out, which is expected for this baseline.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  // Keep the api client's module-level token in sync with context state.
  // NOTE: login()/logout() also push the token synchronously, because this
  // effect runs AFTER child effects -- a page mounted by the post-login
  // navigation would otherwise fire its first request before the token
  // landed, get a 401, and trip the unauthorized handler (auto-logout).
  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  // Any 401 from the API should log the user out; ProtectedRoute then
  // redirects to /login.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await loginRequest({ email, password });
    setAuthToken(response.token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const req: SignupRequest = { email, password, displayName };
    const response = await signupRequest(req);
    setAuthToken(response.token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      login,
      signup,
      logout,
    }),
    [token, user, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
