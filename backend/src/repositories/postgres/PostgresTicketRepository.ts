import { v4 as uuidv4 } from "uuid";
import { Pool } from "pg";
import { inject, injectable } from "tsyringe";
import { CreateTicketInput, Ticket } from "@scaler/shared-types";
import { ITicketRepository, TicketListPage, UpdateTicketFields } from "../ITicketRepository";
import { mapTicketRow } from "./rowMappers";
import { decodeCursor, encodeCursor } from "./cursorUtil";
import { NotFoundError } from "../../domain/errors";

/**
 * All queries are parameterized ($1, $2, ...) -- never string-concatenated
 * SQL -- to avoid injection.
 */
@injectable()
export class PostgresTicketRepository implements ITicketRepository {
  constructor(@inject("Pool") private readonly pool: Pool) {}

  public async create(input: CreateTicketInput): Promise<Ticket> {
    const ticketId = uuidv4();
    const now = new Date();
    const result = await this.pool.query(
      `INSERT INTO tickets
        ("ticketId", "creatorId", "assigneeId", "ticketStatus", "ticketCreationDate",
         "ticketResolvedDate", "ticketOverview", "attachedDocuments", "caseSummary",
         "draftMessage", "version", "updatedAt")
       VALUES ($1, $2, NULL, 'OPEN', $3, NULL, $4, $5, NULL, NULL, 1, $3)
       RETURNING *`,
      [ticketId, input.creatorId, now, input.ticketOverview, JSON.stringify(input.attachedDocuments ?? [])],
    );
    return mapTicketRow(result.rows[0]);
  }

  public async getById(ticketId: string): Promise<Ticket | undefined> {
    const result = await this.pool.query(`SELECT * FROM tickets WHERE "ticketId" = $1`, [ticketId]);
    return result.rows[0] ? mapTicketRow(result.rows[0]) : undefined;
  }

  public async listPaginatedForAssignee(
    assigneeId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketListPage> {
    return this.listPaginatedWhere(`"assigneeId" = $1`, [assigneeId], cursor, limit);
  }

  public async listPaginatedForCreator(
    creatorId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketListPage> {
    return this.listPaginatedWhere(`"creatorId" = $1`, [creatorId], cursor, limit);
  }

  public async listPaginatedAll(cursor: string | undefined, limit: number): Promise<TicketListPage> {
    return this.listPaginatedWhere(undefined, [], cursor, limit);
  }

  private async listPaginatedWhere(
    whereClause: string | undefined,
    whereParams: unknown[],
    cursor: string | undefined,
    limit: number,
  ): Promise<TicketListPage> {
    const params: unknown[] = [...whereParams];
    const conditions: string[] = [];
    if (whereClause) {
      conditions.push(whereClause);
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      params.push(decoded.ticketCreationDate, decoded.ticketId);
      const dateIdx = params.length - 1;
      const idIdx = params.length;
      conditions.push(
        `("ticketCreationDate", "ticketId") < ($${dateIdx}::timestamptz, $${idIdx})`,
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit + 1);
    const limitIdx = params.length;

    const result = await this.pool.query(
      `SELECT * FROM tickets ${whereSql}
       ORDER BY "ticketCreationDate" DESC, "ticketId" DESC
       LIMIT $${limitIdx}`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(mapTicketRow);

    let nextCursor: string | undefined;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor({
        ticketCreationDate: new Date(last.ticketCreationDate).toISOString(),
        ticketId: last.ticketId,
      });
    }

    return { items, nextCursor, hasMore };
  }

  public async updateStatusAndFields(
    ticketId: string,
    expectedVersion: number,
    fields: UpdateTicketFields,
  ): Promise<Ticket> {
    const setClauses: string[] = [`"version" = "version" + 1`, `"updatedAt" = $1`];
    const params: unknown[] = [new Date()];

    if (fields.assigneeId !== undefined) {
      params.push(fields.assigneeId);
      setClauses.push(`"assigneeId" = $${params.length}`);
    }
    if (fields.ticketStatus !== undefined) {
      params.push(fields.ticketStatus);
      setClauses.push(`"ticketStatus" = $${params.length}`);
    }
    if (fields.caseSummary !== undefined) {
      params.push(fields.caseSummary);
      setClauses.push(`"caseSummary" = $${params.length}`);
    }
    if (fields.draftMessage !== undefined) {
      params.push(fields.draftMessage);
      setClauses.push(`"draftMessage" = $${params.length}`);
    }
    if (fields.ticketResolvedDate !== undefined) {
      params.push(fields.ticketResolvedDate);
      setClauses.push(`"ticketResolvedDate" = $${params.length}`);
    }

    params.push(ticketId, expectedVersion);
    const ticketIdIdx = params.length - 1;
    const versionIdx = params.length;

    const result = await this.pool.query(
      `UPDATE tickets SET ${setClauses.join(", ")}
       WHERE "ticketId" = $${ticketIdIdx} AND "version" = $${versionIdx}
       RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      const existing = await this.getById(ticketId);
      if (!existing) {
        throw new NotFoundError(`Ticket ${ticketId} not found`);
      }
      throw new Error(
        `Optimistic concurrency conflict updating ticket ${ticketId}: expected version ${expectedVersion}, current version ${existing.version}`,
      );
    }

    return mapTicketRow(result.rows[0]);
  }

  public async countDistinctCreators(): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(DISTINCT "creatorId") AS count FROM tickets`);
    return Number(result.rows[0]?.count ?? 0);
  }
}
