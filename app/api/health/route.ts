import { json } from "@/lib/server/http";
import { health } from "@/lib/server/platform";

export const dynamic = "force-dynamic";

/** HealthResponse; 503 when the database is unreachable. No auth. */
export async function GET(): Promise<Response> {
  const h = await health();
  return json(h.body, { status: h.status });
}
