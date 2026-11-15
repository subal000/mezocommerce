import type { ApiError } from "@/lib/api-types";

/** Error thrown for any non-2xx API response; carries the API's error code. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const type = res.headers.get("content-type") ?? "";
  const body: unknown = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const e = (body as ApiError | null)?.error;
    throw new ApiClientError(
      res.status,
      e?.code ?? (res.status === 401 ? "unauthenticated" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "internal"),
      e?.message ?? (typeof body === "string" && body.length < 200 && body ? body : `Request failed (${res.status})`),
      e?.details,
    );
  }
  return body as T;
}

export const isNotFound = (e: unknown) => e instanceof ApiClientError && e.status === 404;
export const isUnauthenticated = (e: unknown) => e instanceof ApiClientError && e.status === 401;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
