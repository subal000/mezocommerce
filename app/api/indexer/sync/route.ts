import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/server/env";
import { HttpError, unauthorized } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { runWorkerPass } from "@/lib/server/worker";

export const maxDuration = 60;

/** One worker pass (cron fallback). Authorization: Bearer $INDEXER_SECRET. */
export const POST = route(async (req, { sql }) => {
  const secret = env.indexerSecret();
  if (!secret) throw new HttpError(503, "not_configured", "INDEXER_SECRET is not set");
  const got = Buffer.from((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw unauthorized("Invalid indexer secret");
  return runWorkerPass(sql, { workerId: "http-sync" });
});
