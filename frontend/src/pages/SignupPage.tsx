import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { LoadingSpinner } from "../components/LoadingSpinner";

/**
 * Self-service sign-up for a new support agent. Mirrors LoginPage's markup
 * and classes exactly so the two screens stay visually identical; on
 * success the AuthContext already holds the token, so we just navigate.
 */
export function SignupPage() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/tickets" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, displayName);
      navigate("/tickets", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page page-centered">
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
          <span className="auth-card__brand-name">Meridian</span>
        </div>
        <h1>Create your account</h1>
        <p className="auth-card__lede">New accounts join as support agents and start receiving tickets right away.</p>
        <ErrorBanner error={error} fallbackMessage="Sign-up failed. Check the details and try again." />

        <label className="field">
          <span className="field__label">Full name</span>
          <input
            type="text"
            name="displayName"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

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
          <span className="field__hint">At least 8 characters.</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
        {submitting && <LoadingSpinner label="Creating account…" />}

        <p className="auth-card__switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
