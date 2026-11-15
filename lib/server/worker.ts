// One worker pass: indexer (+confirmations, reorgs, reconciliation) → expiry sweep → webhook deliveries → Shopify sync,
// each stage under a worker_leases row. Used by worker/run.ts (Render) and POST /api/indexer/sync (cron fallback).
import { randomBytes } from "node:crypto";
import { isDeployed } from "@/lib/chain/config";
import type { Sql } from "./db";
import { getChain, type ChainAdapter } from "./chain";
import { clock } from "./clock";
import { env } from "./env";
import { runIndexerPass, type IndexerPassResult } from "./indexer";
import { sweepExpired } from "./intents";
import { withLease } from "./leases";
import { runShopifySync } from "./shopify";
import { deliverPendingWebhooks, type DeliverDeps } from "./webhooks";

type Stage<T> = T | { skipped: true } | { error: string } | null;

export interface WorkerPassResult {
  ok: boolean;
  indexer: Stage<IndexerPassResult>;
  expiry: Stage<number>;
  webhooks: Stage<{ delivered: number; failed: number; retried: number }>;
  shopify: Stage<{ marked: number; failed: number; retried: number }>;
  ms: number;
}

const errOf = (e: unknown) => ({ error: e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : String(e) });

export async function heartbeat(sql: Sql) {
  await sql`
    INSERT INTO indexer_state (id, last_block, updated_at) VALUES ('worker', 0, ${clock.now()})
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`;
}

export async function workerStatus(sql: Sql): Promise<{ lastRunAt: Date | null; healthy: boolean }> {
  const [row] = await sql<{ updated_at: Date }>`SELECT updated_at FROM indexer_state WHERE id = 'worker'`;
  if (!row) return { lastRunAt: null, healthy: false };
  const last = new Date(row.updated_at);
  const healthy = clock.now().getTime() - last.getTime() < Math.max(3 * env.workerIntervalMs(), 120_000);
  return { lastRunAt: last, healthy };
}

export const defaultWorkerId = () => `worker-${process.pid}-${randomBytes(3).toString("hex")}`;

export async function runWorkerPass(
  sql: Sql,
  deps: { chain?: ChainAdapter; workerId?: string; webhooks?: DeliverDeps } = {},
): Promise<WorkerPassResult> {
  const started = Date.now();
  const chain = deps.chain ?? getChain();
  const holder = deps.workerId ?? defaultWorkerId();
  const out: WorkerPassResult = { ok: true, indexer: null, expiry: null, webhooks: null, shopify: null, ms: 0 };
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<Stage<T>> => {
    try {
      return await withLease(sql, name, holder, fn);
    } catch (e) {
      out.ok = false;
      return errOf(e);
    }
  };
  if (isDeployed || deps.chain) out.indexer = await stage("indexer", () => runIndexerPass(sql, chain));
  out.expiry = await stage("expiry", () => sweepExpired(sql));
  out.webhooks = await stage("webhooks", () => deliverPendingWebhooks(sql, deps.webhooks ?? {}));
  out.shopify = await stage("shopify", () => runShopifySync(sql));
  await heartbeat(sql).catch(() => undefined);
  out.ms = Date.now() - started;
  return out;
}
