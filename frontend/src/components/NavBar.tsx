import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

export function NavBar() {
  const { user, logout } = useAuth();

  return (
    <header className="nav-bar">
      <div className="nav-bar__brand">Scaler</div>

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
        {user && <span className="nav-bar__user">{user.displayName}</span>}
        <button type="button" className="btn btn-secondary btn-small" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}
