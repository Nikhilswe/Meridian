import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Ticket } from "@scaler/shared-types";
import { listCases } from "../api/cases";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";

const PAGE_SIZE = 10;

export function CaseSummariserPage() {
  const navigate = useNavigate();

  const [cases, setCases] = useState<Ticket[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadPage = useCallback(async (cursor: string | undefined) => {
    setLoading(true);
    setError(null);
    try {
      const response = await listCases({ cursor, limit: PAGE_SIZE });
      setCases(response.items);
      setNextCursor(response.nextCursor);
      setHasMore(response.hasMore);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(cursorStack[pageIndex]);
  }, [loadPage, cursorStack, pageIndex]);

  function handlePrev() {
    setPageIndex((prev) => Math.max(0, prev - 1));
  }

  function handleNext() {
    if (!nextCursor) return;
    setCursorStack((prev) => {
      const next = prev.slice(0, pageIndex + 1);
      next.push(nextCursor);
      return next;
    });
    setPageIndex((prev) => prev + 1);
  }

  return (
    <div className="page">
      <section className="card">
        <h2>Case Summariser</h2>
        <p className="muted">Cases currently assigned to you.</p>
        <ErrorBanner error={error} />
        {loading ? (
          <LoadingSpinner label="Loading cases…" />
        ) : (
          <>
            <table className="data-table data-table--clickable">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Status</th>
                  <th>Creator</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No cases assigned to you.
                    </td>
                  </tr>
                )}
                {cases.map((c) => (
                  <tr key={c.ticketId} onClick={() => navigate(`/cases/${c.ticketId}`)}>
                    <td>{c.ticketId}</td>
                    <td>
                      <StatusBadge status={c.ticketStatus} />
                    </td>
                    <td>{c.creatorId}</td>
                    <td>{new Date(c.ticketCreationDate).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination canGoPrev={pageIndex > 0} hasMore={hasMore} onPrev={handlePrev} onNext={handleNext} />
          </>
        )}
      </section>
    </div>
  );
}
