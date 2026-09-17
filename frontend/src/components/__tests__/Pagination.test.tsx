import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pagination } from "../Pagination";

describe("Pagination", () => {
  it("disables Prev on the first page", () => {
    render(<Pagination canGoPrev={false} hasMore={true} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next when there is no more data", () => {
    render(<Pagination canGoPrev={true} hasMore={false} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("enables both when mid-list", () => {
    render(<Pagination canGoPrev={true} hasMore={true} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
