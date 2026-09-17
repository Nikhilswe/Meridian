import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ErrorBanner } from "../ErrorBanner";
import { LoadingSpinner } from "../LoadingSpinner";
import { StatusBadge } from "../StatusBadge";
import { NavBar } from "../NavBar";
import { ThemeToggle } from "../ThemeToggle";
import { ProtectedRoute } from "../ProtectedRoute";
import { ApiError } from "../../api/client";
import { ThemeProvider, useTheme } from "../../context/ThemeContext";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { LOGIN_OK, mockFetch, renderWithProviders, resetClient } from "../../test/harness";

describe("ErrorBanner", () => {
  it("renders nothing for a falsy error", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the server message for an ApiError, a friendly override for 429, plain Error messages, and a fallback otherwise", () => {
    const { rerender } = render(<ErrorBanner error={new ApiError(409, { error: { code: "CONFLICT", message: "exists" } }, "fb")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("exists");

    rerender(<ErrorBanner error={new ApiError(429, undefined, "x")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/too often/);
    rerender(<ErrorBanner error={new ApiError(429, undefined, "x")} fallbackMessage="slow down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("slow down");

    rerender(<ErrorBanner error={new Error("plain")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("plain");

    rerender(<ErrorBanner error={"string error"} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    rerender(<ErrorBanner error={{}} fallbackMessage="custom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("custom");
  });
});

describe("LoadingSpinner", () => {
  it("is a polite live region with a default and a custom label", () => {
    const { rerender } = render(<LoadingSpinner />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    rerender(<LoadingSpinner label="Summarising…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Summarising…");
  });
});

describe("StatusBadge", () => {
  it("covers every lifecycle status with a label and tone", () => {
    const expected: [string, string, string][] = [
      ["OPEN", "Open", "neutral"],
      ["ASSIGNED", "Assigned", "info"],
      ["IN_REVIEW", "In Review", "info"],
      ["DRAFT_PENDING_REVIEW", "Draft Pending Review", "warning"],
      ["RESOLVED", "Resolved", "success"],
      ["CLOSED", "Closed", "neutral"],
    ];
    for (const [status, label, tone] of expected) {
      const { unmount } = render(<StatusBadge status={status as never} />);
      expect(screen.getByText(label)).toHaveAttribute("data-tone", tone);
      unmount();
    }
  });

  it("falls back to the raw value and neutral tone for an unknown status", () => {
    render(<StatusBadge status={"WEIRD" as never} />);
    expect(screen.getByText("WEIRD")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("ThemeContext + ThemeToggle", () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function stubPrefersDark(matches: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
  }

  it("starts from the OS preference, stamps <html data-theme>, and toggles", async () => {
    stubPrefersDark(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    const button = screen.getByRole("button", { name: "Switch to light mode" });
    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toHaveAttribute("data-theme", "light");
  });

  it("defaults to light when matchMedia is unavailable, and useTheme throws outside a provider", () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");

    function Naked() {
      useTheme();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Naked />)).toThrow("useTheme must be used within a ThemeProvider");
    vi.restoreAllMocks();
  });
});

describe("AuthContext", () => {
  beforeEach(() => resetClient());
  afterEach(() => vi.unstubAllGlobals());

  function Probe() {
    const { isAuthenticated, user, login, signup, logout, token } = useAuth();
    return (
      <div>
        <span data-testid="auth">{isAuthenticated ? `in:${user?.displayName}:${token}` : "out"}</span>
        <button onClick={() => void login("e", "p")}>login</button>
        <button onClick={() => void signup("e", "p", "Name")}>signup</button>
        <button onClick={logout}>logout</button>
      </div>
    );
  }

  it("login()/signup() push the token into the api client synchronously and logout() clears it", async () => {
    const spy = mockFetch({
      "POST /api/auth/login": { body: LOGIN_OK },
      "POST /api/auth/signup": { body: { token: "signup-token", user: { ...LOGIN_OK.user, displayName: "Name" } } },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("auth")).toHaveTextContent("out");

    await userEvent.click(screen.getByText("login"));
    expect(await screen.findByText("in:Asha Kapoor:jwt-token")).toBeInTheDocument();

    await userEvent.click(screen.getByText("logout"));
    expect(screen.getByTestId("auth")).toHaveTextContent("out");

    await userEvent.click(screen.getByText("signup"));
    expect(await screen.findByText("in:Name:signup-token")).toBeInTheDocument();
    expect(spy.calls[1]!.body).toEqual({ email: "e", password: "p", displayName: "Name" });
  });

  it("a 401 from any API call logs the user out via the unauthorized handler", async () => {
    mockFetch({
      "POST /api/auth/login": { body: LOGIN_OK },
      "GET /api/tickets": { status: 401, body: { error: { code: "UNAUTHORIZED", message: "expired" } } },
    });
    function Fetcher() {
      const { isAuthenticated } = useAuth();
      return (
        <div>
          <Probe />
          <button onClick={() => void fetch("http://localhost:4000/api/tickets").then(() => undefined)}>raw</button>
          <span data-testid="flag">{String(isAuthenticated)}</span>
        </div>
      );
    }
    render(
      <AuthProvider>
        <Fetcher />
      </AuthProvider>,
    );
    await userEvent.click(screen.getByText("login"));
    expect(await screen.findByText("true")).toBeInTheDocument();
    // Go through the real client so handleResponse() sees the 401.
    const { apiGet } = await import("../../api/client");
    await act(async () => {
      await apiGet("/api/tickets").catch(() => undefined);
    });
    expect(screen.getByTestId("flag")).toHaveTextContent("false");
  });

  it("useAuth throws outside a provider", () => {
    function Naked() {
      useAuth();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Naked />)).toThrow("useAuth must be used within an AuthProvider");
    vi.restoreAllMocks();
  });
});

describe("NavBar + ProtectedRoute", () => {
  beforeEach(() => resetClient());
  afterEach(() => vi.unstubAllGlobals());

  it("ProtectedRoute redirects anonymous users to /login remembering where they were", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/secret"
          element={
            <ProtectedRoute>
              <div>secret page</div>
            </ProtectedRoute>
          }
        />
      </Routes>,
      "/secret",
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("NavBar shows initials (max two), the active tab, and logs out", async () => {
    mockFetch({ "POST /api/auth/login": { body: { token: "t", user: { userId: "u", displayName: "  jean luc picard ", role: "ADMIN" } } } });
    function Shell() {
      const { isAuthenticated, login } = useAuth();
      if (!isAuthenticated) return <button onClick={() => void login("e", "p")}>go</button>;
      return (
        <>
          <NavBar />
          <Routes>
            <Route path="/cases" element={<div>cases body</div>} />
          </Routes>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/cases"]}>
        <ThemeProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("go"));
    expect(await screen.findByText("JL")).toBeInTheDocument();
    expect(screen.getByText("jean luc picard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Case Summariser" })).toHaveClass("nav-tab--active");
    expect(screen.getByRole("link", { name: "Tickets" })).not.toHaveClass("nav-tab--active");
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByText("go")).toBeInTheDocument();
  });
});
