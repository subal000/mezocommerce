// Typed API errors → ApiError JSON ({ error: { code, message, details? } }).
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in with your wallet first") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);
export const tooMany = (message = "Too many requests, slow down") => new HttpError(429, "rate_limited", message);
export const unavailable = (code: string, message: string) => new HttpError(503, code, message);

const DB_DOWN_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT",
  "57P01", "57P02", "57P03", "53300", "08000", "08001", "08003", "08004", "08006",
]);

/** Marker for "the database could not be reached" (mapped to 503, never 500). */
export class DbUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Database unavailable");
    this.name = "DbUnavailableError";
    this.cause = cause;
  }
}

export function isDbUnavailableError(e: unknown): boolean {
  if (e instanceof DbUnavailableError) return true;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && DB_DOWN_CODES.has(code);
}

/** Postgres unique-violation (both drivers expose SQLSTATE on `.code`). */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "23505";
}
