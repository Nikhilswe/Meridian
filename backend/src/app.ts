import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { container } from "./di/container";
import { ConfigResolver } from "./config/ConfigResolver";
import { IAuthProvider } from "./auth/IAuthProvider";
import { TicketService } from "./services/TicketService";
import { SummarisationService } from "./services/SummarisationService";
import { buildAuthRoutes } from "./routes/auth.routes";
import { buildTicketRoutes } from "./routes/ticket.routes";
import { buildCaseRoutes } from "./routes/case.routes";
import { errorHandler } from "./middleware/errorHandler";

/**
 * Builds the express app WITHOUT calling `.listen()`, so tests can import
 * this and drive it with supertest without binding a real port. Assumes
 * `configureContainer()` (src/di/container.ts) has already run -- normally
 * from server.ts, or from a test's own setup that registers in-memory
 * fakes into the same tsyringe container before calling this. Every route
 * and service here is pulled from that container; nothing is a bare
 * `new X()`.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const configResolver = container.resolve(ConfigResolver);
  const authProvider = container.resolve<IAuthProvider>("IAuthProvider");
  const ticketService = container.resolve(TicketService);
  const summarisationService = container.resolve(SummarisationService);

  app.use("/api/auth", buildAuthRoutes(authProvider));
  app.use("/api/tickets", buildTicketRoutes(ticketService, authProvider, configResolver));
  app.use("/api/cases", buildCaseRoutes(ticketService, summarisationService, authProvider, configResolver));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(errorHandler);

  return app;
}
