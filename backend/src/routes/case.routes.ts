import { Router } from "express";
import { z } from "zod";
import { PaginatedResponse, SummariseCaseResponse, Ticket } from "@meridian/shared-types";
import { TicketService } from "../services/TicketService";
import { SummarisationService } from "../services/SummarisationService";
import { ConfigResolver } from "../config/ConfigResolver";
import { buildAuthMiddleware } from "../auth/authMiddleware";
import { IAuthProvider } from "../auth/IAuthProvider";
import { buildRateLimiter } from "../middleware/rateLimiter";
import { parsePagination } from "../middleware/pagination";
import { ValidationError } from "../domain/errors";
import { requireRouteParam } from "./routeUtils";

const summariseBodySchema = z.object({
  testMode: z.boolean().optional(),
});

const submitDraftSchema = z.object({
  draftMessage: z.string().min(1).max(5000),
});

const updateFactsSchema = z
  .object({
    customerId: z.string().max(64).optional(),
    orderId: z.string().max(64).optional(),
  })
  .refine((body) => body.customerId !== undefined || body.orderId !== undefined, {
    message: "Provide at least one of customerId, orderId",
  });

/**
 * Case-summariser screen's routes: the assigned agent's queue, a single
 * case, "summarise & generate draft", and submitting the (possibly edited)
 * draft. Thin adapters over TicketService / SummarisationService -- no
 * business logic here.
 */
export function buildCaseRoutes(
  ticketService: TicketService,
  summarisationService: SummarisationService,
  authProvider: IAuthProvider,
  configResolver: ConfigResolver,
): Router {
  const router = Router();
  const authMiddleware = buildAuthMiddleware(authProvider);
  const summariseLimiter = buildRateLimiter(configResolver, "summarise");

  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const pagination = parsePagination(req, configResolver);
      const page = await ticketService.listCasesForAssignee(req.principal.userId, req.principal, pagination);
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

  router.post("/:id/summarise", authMiddleware, summariseLimiter, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const parsed = summariseBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError("Invalid summarise request", parsed.error.flatten());
      }
      const result: SummariseCaseResponse = await summarisationService.summariseCase(requireRouteParam(req.params.id, "id"), req.principal, {
        testMode: parsed.data.testMode,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Adds the record-backed facts the summariser asked for (NEEDS_INFO), so
   * the agent can supply them and retry rather than being stuck.
   */
  router.patch("/:id/facts", authMiddleware, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const parsed = updateFactsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ValidationError("Invalid facts update request", parsed.error.flatten());
      }
      const ticket: Ticket = await ticketService.updateFacts(
        requireRouteParam(req.params.id, "id"),
        req.principal,
        parsed.data,
      );
      res.status(200).json(ticket);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/draft", authMiddleware, async (req, res, next) => {
    try {
      if (!req.principal) {
        throw new ValidationError("Missing authenticated principal");
      }
      const parsed = submitDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid draft submission request", parsed.error.flatten());
      }
      const ticket = await ticketService.submitDraft({
        ticketId: requireRouteParam(req.params.id, "id"),
        draftMessage: parsed.data.draftMessage,
        submittedBy: req.principal.userId,
      });
      res.status(200).json(ticket);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
