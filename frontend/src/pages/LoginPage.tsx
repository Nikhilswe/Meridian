import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { LoadingSpinner } from "../components/LoadingSpinner";

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    const state = location.state as LocationState | null;
    return <Navigate to={state?.from?.pathname ?? "/tickets"} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const state = location.state as LocationState | null;
      navigate(state?.from?.pathname ?? "/tickets", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-centered">
      {/* Ambient 3D decoration -- purely visual, pointer-events:none, and
          its drift is disabled under prefers-reduced-motion (theme.css). */}
      <div className="login-ambient" aria-hidden="true">
        <div className="login-ambient__glow login-ambient__glow--a" />
        <div className="login-ambient__glow login-ambient__glow--b" />
        <div className="login-ambient__scene">
          <div className="login-ambient__stack">
            <div className="login-ambient__plate" />
            <div className="login-ambient__plate" />
            <div className="login-ambient__plate" />
            <div className="login-ambient__plate" />
          </div>
        </div>
      </div>

      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="auth-card__brand">
          <span className="nav-bar__logo" aria-hidden="true" />
          <span className="auth-card__brand-name">Scaler</span>
        </div>
        <h1>Sign in to Scaler</h1>
        <p className="auth-card__lede">Support tickets and AI case summaries, in one place.</p>
        <ErrorBanner error={error} fallbackMessage="Login failed. Check your email and password." />

        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        {submitting && <LoadingSpinner label="Signing in…" />}

        <p className="auth-card__switch">
          Don&apos;t have an account? <Link to="/signup">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
