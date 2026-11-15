// MezoCommerce background worker (Render): indexer → reconciliation → expiry sweep → webhook deliveries → Shopify sync,
// every WORKER_INTERVAL_MS, with a heartbeat for /api/health. Safe to run more than one (worker_leases).
//   npm run worker         # loop
//   npm run worker:once    # single pass, then exit (non-zero if a stage failed)

import "./load-env";
import { contracts, isDeployed } from "@/lib/chain/config";
import { closeDb, dbKind, getDb } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { defaultWorkerId, runWorkerPass } from "@/lib/server/worker";

const once = process.argv.includes("--once");
const workerId = defaultWorkerId();
let stopping = false;
let wake: (() => void) | null = null;

function log(msg: string, extra?: Record<string, unknown>) {
  console.log(`${new Date().toISOString()} [worker] ${msg}${extra ? " " + JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`);
}

function onSignal(sig: string) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received — finishing the current pass, then exiting`);
  wake?.();
}
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

async function main() {
  const sql = await getDb();
  log("starting", {
    id: workerId,
    db: dbKind(),
    deployed: isDeployed,
    processor: contracts.processor,
    deployBlock: contracts.deployBlock.toString(),
    intervalMs: env.workerIntervalMs(),
    confirmations: env.confirmations(),
    reconcileEvery: env.reconcileEvery(),
  });
  if (!isDeployed) log("processor not deployed (NEXT_PUBLIC_PROCESSOR_ADDRESS unset) — indexer idle");

  let failures = 0;
  while (!stopping) {
    const r = await runWorkerPass(sql, { workerId }).catch((e) => {
      log("pass crashed", { error: (e as Error).message });
      return null;
    });
    if (r) log("pass", { ...r });
    failures = r?.ok ? 0 : failures + 1;
    if (once) {
      await closeDb();
      process.exit(r?.ok ? 0 : 1);
    }
    // Back off on repeated failures (RPC outage), capped at 2 minutes.
    const delay = Math.min(env.workerIntervalMs() * 2 ** Math.min(failures, 4), 120_000);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
  }
  await closeDb();
  log("stopped");
  process.exit(0);
}

main().catch(async (e) => {
  console.error("[worker] fatal", e);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
