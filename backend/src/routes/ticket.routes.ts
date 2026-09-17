import { Router } from "express";
import { z } from "zod";
import { PaginatedResponse, Ticket } from "@scaler/shared-types";
import { TicketService } from "../services/TicketService";
import { ConfigResolver } from "../config/ConfigResolver";
import { buildAuthMiddleware } from "../auth/authMiddleware";
import { IAuthProvider } from "../auth/IAuthProvider";
import { buildRateLimiter } from "../middleware/rateLimiter";
import { parsePagination } from "../middleware/pagination";
import { ValidationError } from "../domain/errors";
import { requireRouteParam } from "./routeUtils";

const attachedDocumentSchema = z.object({
  key: z.string().min(1),
  docType: z.enum(["IMG", "PDF"]),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
});

const createTicketSchema = z.object({
  creatorId: z.string().min(1),
  ticketOverview: z.string().min(1).max(5000),
  customerId: z.string().max(64).optional(),
  orderId: z.string().max(64).optional(),
  attachedDocuments: z.array(attachedDocumentSchema).optional(),
});

/**
 * Thin adapters over TicketService. No business logic here -- only
 * parsing/validating input, invoking the service, and mapping the result
 * (or a thrown domain error, via `next(err)` -> errorHandler) to an HTTP
 * response.
 */
export function buildTicketRoutes(
  ticketService: TicketService,
  authProvider: IAuthProvider,
  configResolver: ConfigResolver,
): Router {
  const router = Router();
  const authMiddleware = buildAuthMiddleware(authProvider);
  const ticketCreateLimiter = buildRateLimiter(configResolver, "ticketCreate");

  router.post("/", authMiddleware, ticketCreateLimiter, async (req, res, next) => {
    try {
      const parsed = createTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid ticket creation request", parsed.error.flatten());
      }
      const ticket = await ticketService.createTicket(parsed.data);
      res.status(201).json(ticket);
    } catch (err) {
      next(err);
    }
  });

  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const pagination = parsePagination(req, configResolver);
      const page = await ticketService.listTickets(req.principal, pagination);
      const body: PaginatedResponse<Ticket> = page;
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const ticket = await ticketService.getTicketById(requireRouteParam(req.params.id, "id"), req.principal);
      res.status(200).json(ticket);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
