export interface PaginationProps {
  /** True when there is a current page to go back from (i.e. not page 1). */
  canGoPrev: boolean;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  disabled?: boolean;
}

/**
 * Generic cursor-based Prev/Next control, shared by the Tickets list and the
 * Case Summariser list. The caller owns the cursor stack (see TicketsPage /
 * CaseSummariserPage) -- this component just renders the two buttons.
 */
export function Pagination({ canGoPrev, hasMore, onPrev, onNext, disabled }: PaginationProps) {
  return (
    <div className="pagination">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onPrev}
        disabled={disabled || !canGoPrev}
      >
        Prev
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onNext}
        disabled={disabled || !hasMore}
      >
        Next
      </button>
    </div>
  );
}
