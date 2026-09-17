import type { TicketStatus } from "@scaler/shared-types";

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_REVIEW: "In Review",
  DRAFT_PENDING_REVIEW: "Draft Pending Review",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

// Maps each status to a semantic tone; the actual colors are CSS variables
// defined per status-tone in src/styles/theme.css so a future visual
// restyle only has to touch the stylesheet.
const STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: "neutral",
  ASSIGNED: "info",
  IN_REVIEW: "info",
  DRAFT_PENDING_REVIEW: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export interface StatusBadgeProps {
  status: TicketStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span className="status-badge" data-tone={tone} data-status={status}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
