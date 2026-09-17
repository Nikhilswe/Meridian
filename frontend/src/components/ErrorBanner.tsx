import { ApiError } from "../api/client";

export interface ErrorBannerProps {
  error: unknown;
  /** Optional friendly override, e.g. for 429 rate-limit responses. */
  fallbackMessage?: string;
}

function messageFor(error: unknown, fallbackMessage?: string): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return fallbackMessage ?? "You're doing that a bit too often -- please wait a moment and try again.";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage ?? "Something went wrong. Please try again.";
}

export function ErrorBanner({ error, fallbackMessage }: ErrorBannerProps) {
  if (!error) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      {messageFor(error, fallbackMessage)}
    </div>
  );
}
