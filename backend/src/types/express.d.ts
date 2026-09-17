import { AuthenticatedPrincipal } from "@meridian/shared-types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

export {};
