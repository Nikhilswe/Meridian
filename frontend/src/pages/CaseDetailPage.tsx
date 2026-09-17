import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Ticket } from "@scaler/shared-types";
import { getCase, submitDraft, summariseCase } from "../api/cases";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [summarising, setSummarising] = useState(false);
  const [summariseError, setSummariseError] = useState<unknown>(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const loadCase = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getCase(id);
      setTicket(data);
      setDraftMessage(data.draftMessage ?? "");
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  async function handleSummarise() {
    if (!id) return;
    setSummarising(true);
    setSummariseError(null);
    try {
      const result = await summariseCase(id);
      setDraftMessage(result.draftMessage);
      // Merge the summary/draft into local state immediately so the UI
      // updates without waiting on a refetch; a full re-fetch still happens
      // after the eventual draft submission.
      setTicket((prev) =>
        prev
          ? {
              ...prev,
              caseSummary: result.caseSummary,
              draftMessage: result.draftMessage,
            }
          : prev,
      );
    } catch (err) {
      setSummariseError(err);
    } finally {
      setSummarising(false);
    }
  }

  async function handleSubmitDraft() {
    if (!id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitDraft(id, draftMessage);
      await loadCase();
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !ticket) {
    return (
      <div className="page">
        <LoadingSpinner label="Loading case…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBanner error={loadError} />
        <Link to="/cases">Back to cases</Link>
      </div>
    );
  }

  if (!ticket) {
    return null;
  }

  const hasSummary = Boolean(ticket.caseSummary && ticket.draftMessage);
  const isResolved = ticket.ticketStatus === "RESOLVED" || ticket.ticketStatus === "CLOSED";

  return (
    <div className="page">
      <Link to="/cases" className="back-link">
        ← Back to cases
      </Link>

      <section className="card">
        <div className="case-detail__header">
          <h2>Case {ticket.ticketId}</h2>
          <StatusBadge status={ticket.ticketStatus} />
        </div>

        <div className="field">
          <span className="field__label">Ticket overview</span>
          <p className="ticket-overview">{ticket.ticketOverview}</p>
        </div>

        {!hasSummary && (
          <div className="case-detail__actions">
            <ErrorBanner
              error={summariseError}
              fallbackMessage="Summarisation is rate-limited -- please wait a moment and try again."
            />
            <button type="button" className="btn btn-primary" onClick={handleSummarise} disabled={summarising}>
              {summarising ? "Summarising…" : "Summarise & Generate Draft"}
            </button>
            {summarising && (
              <LoadingSpinner label="Generating summary and draft -- this can take a few seconds…" />
            )}
          </div>
        )}

        {hasSummary && (
          <>
            <div className="field">
              <span className="field__label">Case summary</span>
              <p className="case-summary">{ticket.caseSummary}</p>
            </div>

            <div className="field">
              <span className="field__label">Draft message</span>
              {isResolved ? (
                <p className="draft-message draft-message--readonly">{ticket.draftMessage}</p>
              ) : (
                <textarea
                  rows={8}
                  value={draftMessage}
                  onChange={(e) => setDraftMessage(e.target.value)}
                />
              )}
            </div>

            {!isResolved && (
              <div className="case-detail__actions">
                <ErrorBanner error={submitError} />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitDraft}
                  disabled={submitting || !draftMessage.trim()}
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
                {submitting && <LoadingSpinner label="Submitting draft…" />}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
