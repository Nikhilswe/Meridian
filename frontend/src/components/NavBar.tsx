import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function NavBar() {
  const { user, logout } = useAuth();

  return (
    <header className="nav-bar">
      <div className="nav-bar__brand">
        <span className="nav-bar__logo" aria-hidden="true" />
        Scaler
      </div>

      <nav className="nav-bar__tabs">
        <NavLink to="/tickets" className={({ isActive }) => (isActive ? "nav-tab nav-tab--active" : "nav-tab")}>
          Tickets
        </NavLink>
        <NavLink to="/cases" className={({ isActive }) => (isActive ? "nav-tab nav-tab--active" : "nav-tab")}>
          Case Summariser
        </NavLink>
      </nav>

      <div className="nav-bar__end">
        <ThemeToggle />
        {user && (
          <span className="nav-bar__user">
            <span className="nav-bar__avatar" aria-hidden="true">
              {initialsOf(user.displayName)}
            </span>
            {user.displayName}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}
