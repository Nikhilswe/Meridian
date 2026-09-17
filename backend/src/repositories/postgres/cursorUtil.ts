/**
 * Opaque cursor encoding for keyset (cursor-based) pagination over tickets,
 * ordered by (ticketCreationDate DESC, ticketId DESC) for a stable sort even
 * when two tickets share the same creation timestamp.
 */
export interface TicketCursor {
  ticketCreationDate: string;
  ticketId: string;
}

export function encodeCursor(cursor: TicketCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

export function decodeCursor(raw: string): TicketCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (typeof parsed.ticketCreationDate !== "string" || typeof parsed.ticketId !== "string") {
      throw new Error("malformed cursor payload");
    }
    return parsed as TicketCursor;
  } catch {
    throw new Error("Invalid pagination cursor");
  }
}
