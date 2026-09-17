import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AttachedDocument, DocumentType, Ticket } from "@meridian/shared-types";
import { useAuth } from "../context/AuthContext";
import { createTicket, listTickets } from "../api/tickets";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";

const PAGE_SIZE = 10;

/** A metadata-only attachment row being edited in the create-ticket form. */
interface AttachmentDraft {
  fileName: string;
  docType: DocumentType;
}

function toAttachedDocuments(drafts: AttachmentDraft[]): Omit<AttachedDocument, "uploadedAt">[] {
  return drafts
    .filter((d) => d.fileName.trim().length > 0)
    .map((d, index) => ({
      // Real uploads (a future <input type="file"> wiring) would get a real
      // S3 key from the backend; for this metadata-only pass we generate a
      // placeholder client-side key.
      key: `pending/${Date.now()}-${index}-${d.fileName}`,
      docType: d.docType,
      fileName: d.fileName,
    }));
}

export function TicketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // A ticket row opens the same detail screen the Case Summariser uses. The
  // backend's visibility rule lets the creator OR the assignee read it; only
  // the assignee can generate a draft (the detail page hides that control
  // for everyone else).
  function openTicket(ticketId: string) {
    navigate(`/cases/${ticketId}`, { state: { from: "/tickets" } });
  }

  // --- create form state ---
  const [overview, setOverview] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);

  // --- list state ---
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<unknown>(null);

  const loadPage = useCallback(async (cursor: string | undefined) => {
    setListLoading(true);
    setListError(null);
    try {
      const response = await listTickets({ cursor, limit: PAGE_SIZE });
      setTickets(response.items);
      setNextCursor(response.nextCursor);
      setHasMore(response.hasMore);
    } catch (err) {
      setListError(err);
    } finally {
      setListLoading(false);
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

  function addAttachmentRow() {
    setAttachments((prev) => [...prev, { fileName: "", docType: "PDF" }]);
  }

  function updateAttachmentRow(index: number, patch: Partial<AttachmentDraft>) {
    setAttachments((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeAttachmentRow(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createTicket({
        creatorId: user.userId,
        ticketOverview: overview,
        customerId: customerId.trim() || undefined,
        orderId: orderId.trim() || undefined,
        attachedDocuments: toAttachedDocuments(attachments),
      });
      setOverview("");
      setCustomerId("");
      setOrderId("");
      setAttachments([]);
      // Reset to page 1 and refetch so the new ticket shows up.
      setCursorStack([undefined]);
      setPageIndex(0);
      await loadPage(undefined);
    } catch (err) {
      setCreateError(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <section className="card">
        <div className="card__header">
          <div className="card__title">
            <h2>Create a ticket</h2>
            <p className="card__subtitle">
              Capture the customer's complaint. It will be assigned to a support agent automatically.
            </p>
          </div>
        </div>
        <form onSubmit={handleCreate} className="ticket-form">
          <label className="field field--overview">
            <span className="field__label">Ticket overview</span>
            <textarea
              required
              rows={4}
              placeholder="Describe the customer's complaint…"
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
            />
            <span className="field__hint">Write it the way the customer told it to you -- this is what the summariser reads.</span>
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Customer ID</span>
              <input
                type="text"
                placeholder="e.g. cust-1001"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
              <span className="field__hint">Which customer this is about. The summariser will ask for it if left blank.</span>
            </label>
            <label className="field">
              <span className="field__label">Order ID <span className="muted">(optional)</span></span>
              <input
                type="text"
                placeholder="e.g. order-1001"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              />
              <span className="field__hint">Only supplied to the AI if it belongs to this customer.</span>
            </label>
          </div>

          <div className="attachments-editor">
            <div className="attachments-editor__header">
              <span className="field__label">Attached documents (metadata only)</span>
              <button type="button" className="btn btn-secondary btn-small" onClick={addAttachmentRow}>
                + Add attachment
              </button>
            </div>

            {attachments.length === 0 && <p className="muted">No attachments added.</p>}

            {attachments.map((row, index) => (
              <div className="attachment-row" key={index}>
                <input
                  type="text"
                  placeholder="File name"
                  required
                  value={row.fileName}
                  onChange={(e) => updateAttachmentRow(index, { fileName: e.target.value })}
                />
                <select
                  value={row.docType}
                  onChange={(e) => updateAttachmentRow(index, { docType: e.target.value as DocumentType })}
                >
                  <option value="PDF">PDF</option>
                  <option value="IMG">IMG</option>
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => removeAttachmentRow(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <ErrorBanner error={createError} />

          <div className="ticket-form__footer">
            <button type="submit" className="btn btn-primary" disabled={creating || !overview.trim()}>
              {creating ? "Creating…" : "Create ticket"}
            </button>
            {creating && <LoadingSpinner label="Creating ticket…" />}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card__header">
          <div className="card__title">
            <h2>Tickets</h2>
            <p className="card__subtitle">All tickets, newest first.</p>
          </div>
        </div>
        <ErrorBanner error={listError} />
        {listLoading ? (
          <LoadingSpinner label="Loading tickets…" />
        ) : (
          <>
            <div className="table-wrap">
            <table className="data-table data-table--clickable">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Status</th>
                  <th>Creator</th>
                  <th>Created</th>
                  <th>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-empty">
                      No tickets yet.
                    </td>
                  </tr>
                )}
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.ticketId}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ticket ${ticket.ticketId}`}
                    onClick={() => openTicket(ticket.ticketId)}
                    onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTicket(ticket.ticketId);
                      }
                    }}
                  >
                    <td className="cell-id">{ticket.ticketId}</td>
                    <td>
                      <StatusBadge status={ticket.ticketStatus} />
                    </td>
                    <td>{ticket.creatorId}</td>
                    <td className="cell-date">{new Date(ticket.ticketCreationDate).toLocaleString()}</td>
                    <td>{ticket.assigneeId ?? <span className="muted">Unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="list-footer">
              <span className="list-footer__meta">
                Page {pageIndex + 1}
                {tickets.length > 0 ? ` · ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}` : ""}
              </span>
              <Pagination canGoPrev={pageIndex > 0} hasMore={hasMore} onPrev={handlePrev} onNext={handleNext} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
