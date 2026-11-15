// /api/public/config and /api/health.
import type { HealthResponse, PublicConfigDTO } from "@/lib/api-types";
import { MEZO_TESTNET_ID, ZERO_ADDRESS, contracts, isDeployed } from "@/lib/chain/config";
import { dbKind, getDb } from "./db";
import { getChain, withTimeout, type ChainAdapter } from "./chain";
import { clock } from "./clock";
import { env } from "./env";
import { indexerStatus } from "./indexer";
import { platformSignerAddress } from "./signer";
import { workerStatus } from "./worker";

export function publicConfig(): PublicConfigDTO {
  return {
    chain_id: MEZO_TESTNET_ID,
    processor_address: contracts.processor.toLowerCase(),
    musd_address: contracts.musd.toLowerCase(),
    platform_signer: platformSignerAddress() ?? ZERO_ADDRESS,
    deployed: isDeployed,
    confirmations: env.confirmations(),
    app_url: env.appUrl(),
  };
}

export async function health(chain: ChainAdapter = getChain()): Promise<{ status: number; body: HealthResponse }> {
  const body: HealthResponse = {
    ok: false,
    chain_id: null,
    block_number: null,
    db: dbKind(),
    db_ok: false,
    deployed: isDeployed,
    indexer: { last_block: null, lag_blocks: null, updated_at: null },
    worker: { last_run_at: null, healthy: false },
  };
  let head: bigint | null = null;
  try {
    const [id, bn] = await withTimeout(Promise.all([chain.chainId(), chain.getBlockNumber()]), 4000);
    body.chain_id = id;
    head = bn;
    body.block_number = bn.toString();
  } catch {
    /* RPC down: reported as nulls */
  }
  try {
    const sql = await withTimeout(getDb(), 8000);
    await withTimeout(sql`SELECT 1`, 4000);
    body.db_ok = true;
    const ix = await indexerStatus(sql);
    body.indexer = {
      last_block: ix.lastBlock?.toString() ?? null,
      lag_blocks: ix.lastBlock !== null && head !== null ? Number(head - ix.lastBlock) : null,
      updated_at: ix.updatedAt?.toISOString() ?? null,
    };
    const w = await workerStatus(sql);
    body.worker = { last_run_at: w.lastRunAt?.toISOString() ?? null, healthy: w.healthy };
  } catch {
    body.db_ok = false;
  }
  body.ok = body.db_ok && body.chain_id === MEZO_TESTNET_ID;
  void clock;
  return { status: body.db_ok ? 200 : 503, body };
}
