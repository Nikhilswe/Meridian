import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { SummariseCaseResponse, SummariseCheck, SuppliedFacts, Ticket, Policy } from "@scaler/shared-types";
import { getCase, submitDraft, summariseCase, updateCaseFacts } from "../api/cases";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";

function formatDate(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

/** The record-backed facts the model was (or would be) given -- shown so review is cheap. */
function SuppliedFactsPanel({ facts }: { facts: SuppliedFacts }) {
  return (
    <dl className="facts">
      <dt>Issue record status at generation</dt>
      <dd>
        <StatusBadge status={facts.ticketStatus} />
      </dd>
      <dt>Customer</dt>
      <dd>{facts.customerId ? <code>{facts.customerId}</code> : <span className="muted">not identified</span>}</dd>
      <dt>Referenced order</dt>
      <dd>
        {facts.order ? (
          <>
            <code>{facts.order.orderId}</code> · {facts.order.itemSummary} · {facts.order.status}
            {facts.order.status === "DELIVERED" && <> · delivered {formatDate(facts.order.deliveredDate)}</>}
            {" · "}
            {facts.order.amount} {facts.order.currency}
          </>
        ) : (
          <span className="muted">none</span>
        )}
      </dd>
      <dt>Other orders on file</dt>
      <dd>
        {facts.otherOrders.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul className="facts__list">
            {facts.otherOrders.map((o) => (
              <li key={o.orderId}>
                <code>{o.orderId}</code> · {o.itemSummary} · {o.status}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
  );
}

function SuppliedPoliciesPanel({ policies }: { policies: Policy[] }) {
  if (policies.length === 0) {
    return <p className="muted">No matching policy was supplied.</p>;
  }
  return (
    <ul className="policy-list">
      {policies.map((p) => (
        <li key={p.policyId} className="policy-list__item">
          <div className="policy-list__head">
            <span className="policy-list__title">{p.title}</span>
            <span className="policy-list__meta">
              {p.category} · v{p.version}
            </span>
          </div>
          <p className="policy-list__body">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

function ChecksList({ checks }: { checks: SummariseCheck[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.id} className="check" data-passed={c.passed ? "true" : "false"}>
          <span className="check__mark" aria-hidden="true">
            {c.passed ? "✓" : "✕"}
          </span>
          <span className="check__text">
            <span className="check__desc">{c.description}</span>
            {c.detail && <span className="check__detail">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? "/cases";
  const backLabel = backTo === "/tickets" ? "Back to tickets" : "Back to cases";

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [summarising, setSummarising] = useState(false);
  const [summariseError, setSummariseError] = useState<unknown>(null);
  /** The most recent summarise attempt that did NOT produce a saved draft (NEEDS_INFO / DRAFT_REJECTED). */
  const [lastAttempt, setLastAttempt] = useState<SummariseCaseResponse | null>(null);

  const [factsCustomerId, setFactsCustomerId] = useState("");
  const [factsOrderId, setFactsOrderId] = useState("");
  const [savingFacts, setSavingFacts] = useState(false);
  const [factsError, setFactsError] = useState<unknown>(null);

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
      setFactsCustomerId(data.customerId ?? "");
      setFactsOrderId(data.orderId ?? "");
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
    setLastAttempt(null);
    try {
      const result = await summariseCase(id);
      if (result.outcome === "DRAFTED") {
        // Re-fetch so the persisted suppliedContext (facts, policies, checks)
        // and the new status are all shown from the record, not from memory.
        await loadCase();
      } else {
        setLastAttempt(result);
      }
    } catch (err) {
      setSummariseError(err);
    } finally {
      setSummarising(false);
    }
  }

  async function handleSaveFacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setSavingFacts(true);
    setFactsError(null);
    try {
      const updated = await updateCaseFacts(id, {
        customerId: factsCustomerId.trim(),
        orderId: factsOrderId.trim(),
      });
      setTicket(updated);
      setLastAttempt(null);
      // Retry immediately -- the whole point of supplying the fact is to draft.
      await handleSummarise();
    } catch (err) {
      setFactsError(err);
    } finally {
      setSavingFacts(false);
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
        <Link to={backTo}>{backLabel}</Link>
      </div>
    );
  }

  if (!ticket) {
    return null;
  }

  const hasSummary = Boolean(ticket.caseSummary && ticket.draftMessage);
  // Mirrors SummarisationService's authorisation: only the assignee or a
  // privileged role may generate/submit. Creators can still read the case.
  const canDraft =
    !!user && (user.userId === ticket.assigneeId || user.role === "ADMIN" || user.role === "REVIEWER");
  const isResolved = ticket.ticketStatus === "RESOLVED" || ticket.ticketStatus === "CLOSED";
  const context = ticket.suppliedContext;
  // Facts to display: the persisted context if a draft exists, otherwise
  // whatever the last attempt saw (so NEEDS_INFO shows what IS known).
  const factsToShow = context?.facts ?? lastAttempt?.suppliedFacts;

  const summariseButton = (
    <button
      type="button"
      className={summarising ? "btn btn-primary btn-lg btn--thinking" : hasSummary ? "btn btn-secondary" : "btn btn-primary btn-lg"}
      onClick={handleSummarise}
      disabled={summarising || savingFacts}
    >
      {summarising && (
        // The app's one 3D micro-interaction: three orbiting rings
        // around a pulsing core (static under prefers-reduced-motion).
        <span className="ai-glyph" aria-hidden="true">
          <span className="ai-glyph__orbit" />
          <span className="ai-glyph__orbit" />
          <span className="ai-glyph__orbit" />
          <span className="ai-glyph__core" />
        </span>
      )}
      {summarising ? "Summarising…" : hasSummary ? "Regenerate summary & draft" : "Summarise & Generate Draft"}
    </button>
  );

  return (
    <div className="page">
      <Link to={backTo} className="back-link">
        ← {backLabel}
      </Link>

      <section className="card">
        <div className="case-detail__header">
          <h2>Case {ticket.ticketId}</h2>
          <StatusBadge status={ticket.ticketStatus} />
        </div>
        <p className="case-detail__meta">
          Created {new Date(ticket.ticketCreationDate).toLocaleString()} by {ticket.creatorId}
          {ticket.customerId && (
            <>
              {" · "}customer <code>{ticket.customerId}</code>
            </>
          )}
          {ticket.orderId && (
            <>
              {" · "}order <code>{ticket.orderId}</code>
            </>
          )}
        </p>

        <div className="field">
          <span className="field__label">Ticket overview</span>
          <span className="field__hint">The customer's own words -- a request, not evidence.</span>
          <p className="ticket-overview">{ticket.ticketOverview}</p>
        </div>

        {/* ---- Read-only viewer (creator who isn't the assignee) ---- */}
        {!canDraft && !isResolved && (
          <div className="notice notice--info" role="status">
            <div className="notice__title">Read-only</div>
            <p className="notice__body">
              {ticket.assigneeId
                ? `Only the assigned agent (${ticket.assigneeId}) can generate or submit a draft for this case.`
                : "This ticket has not been assigned to an agent yet."}
            </p>
          </div>
        )}

        {/* ---- Pre-draft: summarise / needs-info / rejected ---- */}
        {!hasSummary && canDraft && (
          <div className="case-detail__actions">
            <ErrorBanner
              error={summariseError}
              fallbackMessage="Summarisation is rate-limited -- please wait a moment and try again."
            />

            {lastAttempt?.outcome === "NEEDS_INFO" && (
              <div className="notice notice--info" role="status">
                <div className="notice__title">More information needed before a draft can be generated</div>
                <p className="notice__body">
                  The AI was <strong>not</strong> called. Supply the missing facts from the order system and retry.
                </p>
                <ul className="notice__list">
                  {lastAttempt.missingInformation.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                <form className="facts-form" onSubmit={handleSaveFacts}>
                  <label className="field">
                    <span className="field__label">Customer ID</span>
                    <input type="text" value={factsCustomerId} onChange={(e) => setFactsCustomerId(e.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Order ID</span>
                    <input type="text" value={factsOrderId} onChange={(e) => setFactsOrderId(e.target.value)} />
                  </label>
                  <ErrorBanner error={factsError} />
                  <button type="submit" className="btn btn-primary" disabled={savingFacts || summarising}>
                    {savingFacts ? "Saving…" : "Save facts & retry"}
                  </button>
                </form>
              </div>
            )}

            {lastAttempt?.outcome === "DRAFT_REJECTED" && (
              <div className="notice notice--warn" role="status">
                <div className="notice__title">Draft rejected by a deterministic check -- nothing was saved</div>
                <p className="notice__body">
                  The model's reply contradicted the record. You can regenerate, or handle the reply manually.
                </p>
                {lastAttempt.draftMessage && (
                  <details className="notice__details">
                    <summary>Show the rejected draft</summary>
                    <p className="draft-message--readonly draft-message--rejected">{lastAttempt.draftMessage}</p>
                  </details>
                )}
              </div>
            )}

            {summariseButton}
            {summarising && (
              <LoadingSpinner label="Generating summary and draft -- this can take a few seconds…" />
            )}
          </div>
        )}

        {/* ---- Evidence: what the model saw + which checks ran ---- */}
        {(factsToShow || lastAttempt) && (
          <>
            <div className="divider" />
            <div className="evidence">
              <div className="evidence__col">
                <span className="field__label">Supplied facts</span>
                <span className="field__hint">From the authoritative records. These decide what is true.</span>
                {factsToShow ? <SuppliedFactsPanel facts={factsToShow} /> : <p className="muted">—</p>}
              </div>
              <div className="evidence__col">
                <span className="field__label">Supplied policy</span>
                <span className="field__hint">Exact policy versions the model was given.</span>
                <SuppliedPoliciesPanel policies={context?.policies ?? lastAttempt?.suppliedPolicies ?? []} />
              </div>
            </div>
            <div className="field">
              <span className="field__label">Checks</span>
              <ChecksList checks={context?.checks ?? lastAttempt?.checks ?? []} />
              {context && (
                <span className="field__hint">
                  Generated {new Date(context.generatedAt).toLocaleString()} via {context.usedProvider}
                  {context.testModeTriggered ? " (test mode)" : ""}
                </span>
              )}
            </div>
          </>
        )}

        {/* ---- Draft: summary + editable reply ---- */}
        {hasSummary && (
          <>
            <div className="divider" />
            <div className="field">
              <span className="field__label">Case summary</span>
              <p className="case-summary">{ticket.caseSummary}</p>
            </div>

            <div className="field">
              <span className="field__label">{isResolved ? "Draft message (submitted)" : "Draft message"}</span>
              {!isResolved && canDraft && (
                <span className="field__hint">Edit the AI draft before submitting -- submitting resolves the case.</span>
              )}
              {isResolved || !canDraft ? (
                <p className="draft-message draft-message--readonly">{ticket.draftMessage}</p>
              ) : (
                <textarea
                  rows={8}
                  value={draftMessage}
                  onChange={(e) => setDraftMessage(e.target.value)}
                />
              )}
            </div>

            {!isResolved && canDraft && (
              <div className="case-detail__actions">
                <ErrorBanner error={submitError} />
                <ErrorBanner
                  error={summariseError}
                  fallbackMessage="Summarisation is rate-limited -- please wait a moment and try again."
                />
                {lastAttempt?.outcome === "DRAFT_REJECTED" && (
                  <div className="notice notice--warn" role="status">
                    <div className="notice__title">Regenerated draft was rejected by a deterministic check</div>
                    <p className="notice__body">Your current draft was kept unchanged.</p>
                  </div>
                )}
                <div className="case-detail__buttons">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSubmitDraft}
                    disabled={submitting || summarising || !draftMessage.trim()}
                  >
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                  {summariseButton}
                </div>
                {submitting && <LoadingSpinner label="Submitting draft…" />}
                {summarising && <LoadingSpinner label="Regenerating -- your edits will be replaced by the new draft…" />}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
