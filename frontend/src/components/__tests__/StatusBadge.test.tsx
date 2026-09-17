import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  it("renders the human-friendly label for OPEN", () => {
    render(<StatusBadge status="OPEN" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("renders the human-friendly label and tone for RESOLVED", () => {
    render(<StatusBadge status="RESOLVED" />);
    const badge = screen.getByText("Resolved");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-tone", "success");
  });

  it("renders the human-friendly label for DRAFT_PENDING_REVIEW", () => {
    render(<StatusBadge status="DRAFT_PENDING_REVIEW" />);
    const badge = screen.getByText("Draft Pending Review");
    expect(badge).toHaveAttribute("data-tone", "warning");
  });
});
