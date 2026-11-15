// Dashboard read models: overview, intent detail, CSV export, notifications. All queries scoped by merchant_id.
import type { MerchantOverviewDTO, NotificationDTO, PaymentIntentDetailDTO } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import type { IntentStatus, WebhookEventType } from "@/lib/chain/payment-state";
import { musdToDecimalString } from "@/lib/money";
import type { Sql } from "./db";
import { big, int, iso, isoOrNull, str, strOrNull } from "./db/rows";
import { addSeconds, clock } from "./clock";
import { intentDTO, intentDTOs, toAttemptDTO, toIntentRow, toRefundDTO } from "./dto";
import { getIntentForMerchant, intentFilter } from "./intents";
import { toMerchantDTO, type MerchantRow } from "./merchants";

export async function overview(sql: Sql, m: MerchantRow): Promise<MerchantOverviewDTO> {
  const [t] = await sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','partially_refunded','refunded')), 0)::text AS received,
      COALESCE(SUM(amount_refunded) FILTER (WHERE status IN ('paid','partially_refunded','refunded')), 0)::text AS refunded,
      count(*) FILTER (WHERE status IN ('paid','partially_refunded','refunded'))::int AS ok,
      count(*) FILTER (WHERE status IN ('created','awaiting_payment','submitted','confirming') AND (status = 'confirming' OR expires_at > ${clock.now()}))::int AS pending,
      count(*) FILTER (WHERE status = 'expired' OR (status IN ('created','awaiting_payment','submitted') AND expires_at <= ${clock.now()}))::int AS expired,
      count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      count(*) FILTER (WHERE status IN ('partially_refunded','refunded'))::int AS refunded_count
    FROM payment_intents WHERE merchant_id = ${m.id}`;
  const [fa] = await sql`SELECT count(*)::int AS n FROM payment_attempts a JOIN payment_intents i ON i.id = a.payment_intent_id
                         WHERE i.merchant_id = ${m.id} AND a.status = 'failed'`;
  const received = big(t.received);
  const refunded = big(t.refunded);
  const ok = int(t.ok);
  const finals = ok + int(t.expired) + int(t.cancelled);

  const since = addSeconds(clock.now(), -30 * 86400);
  const daily = await sql`
    SELECT to_char(date_trunc('day', paid_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, COALESCE(SUM(amount), 0)::text AS s, count(*)::int AS n
    FROM payments WHERE merchant_id = ${m.id} AND status = 'confirmed' AND paid_at >= ${since} GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(daily.map((r) => [str(r.d), r]));
  const days: MerchantOverviewDTO["daily"] = [];
  for (let k = 29; k >= 0; k--) {
    const d = addSeconds(clock.now(), -k * 86400).toISOString().slice(0, 10);
    const r = byDay.get(d);
    days.push({ date: d, received_display: musdToDecimalString(big(r?.s)), count: int(r?.n) });
  }

  const recent = await sql`SELECT * FROM payment_intents WHERE merchant_id = ${m.id} ORDER BY created_at DESC LIMIT 10`;
  const [keys] = await sql`SELECT count(*)::int AS n FROM api_keys WHERE merchant_id = ${m.id} AND revoked_at IS NULL`;
  const [eps] = await sql`SELECT count(*)::int AS n FROM webhook_endpoints WHERE merchant_id = ${m.id} AND status = 'active'`;
  const [last] = await sql`SELECT d.status FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
                           WHERE e.merchant_id = ${m.id} ORDER BY d.created_at DESC LIMIT 1`;
  const [shop] = await sql`SELECT status FROM shopify_connections WHERE merchant_id = ${m.id}`;

  return {
    merchant: toMerchantDTO(m),
    totals: {
      received: received.toString(),
      received_display: musdToDecimalString(received),
      refunded: refunded.toString(),
      refunded_display: musdToDecimalString(refunded),
      net_display: musdToDecimalString(received - refunded),
      successful_count: ok,
      pending_count: int(t.pending),
      failed_attempts: int(fa?.n),
      expired_count: int(t.expired),
      cancelled_count: int(t.cancelled),
      refunded_count: int(t.refunded_count),
      conversion_rate: finals > 0 ? ok / finals : null,
    },
    daily: days,
    recent: await intentDTOs(sql, recent.map(toIntentRow)),
    integration: {
      api_keys: int(keys?.n),
      webhook_endpoints: int(eps?.n),
      last_webhook_status: last ? (str(last.status) as "delivered" | "failed" | "pending") : null,
      shopify_connected: Boolean(shop && str(shop.status) !== "disconnected"),
      onchain_ready: Boolean(m.onchain_merchant_id) && m.chain_active && m.platform_signer_enabled,
    },
  };
}

export async function intentDetail(sql: Sql, merchantId: string, id: string): Promise<PaymentIntentDetailDTO> {
  const i = await getIntentForMerchant(sql, merchantId, id);
  const dto = await intentDTO(sql, i);
  const attempts = await sql`SELECT * FROM payment_attempts WHERE payment_intent_id = ${i.id} ORDER BY created_at DESC`;
  const refunds = await sql`SELECT * FROM refunds WHERE payment_intent_id = ${i.id} ORDER BY created_at DESC`;
  const events = await sql`SELECT event_type, created_at FROM webhook_events WHERE payment_intent_id = ${i.id} AND merchant_id = ${merchantId} ORDER BY created_at ASC`;
  return {
    ...dto,
    attempts: attempts.map(toAttemptDTO),
    refunds: refunds.map((r) => toRefundDTO(r)),
    events: events.map((e) => ({ type: str(e.event_type) as WebhookEventType, created_at: iso(e.created_at) })),
    explorer_url: dto.payment ? explorerTx(dto.payment.transaction_hash) : null,
  };
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(sql: Sql, merchantId: string, filter: { status?: IntentStatus; q?: string } = {}): Promise<string> {
  const w = intentFilter(sql, merchantId, filter);
  const rows = await sql`
    SELECT i.id, i.merchant_order_id, i.status, i.late, i.amount, i.amount_refunded, i.source, i.created_at, i.expires_at, i.paid_at,
           p.transaction_hash, p.payer_address, p.confirmations
    FROM payment_intents i LEFT JOIN payments p ON p.payment_intent_id = i.id
    WHERE i.id IN (SELECT id FROM payment_intents WHERE ${w}) ORDER BY i.created_at DESC LIMIT 10000`;
  const header = ["id", "merchant_order_id", "status", "late", "amount_musd", "refunded_musd", "source", "created_at", "expires_at", "paid_at", "tx_hash", "payer", "confirmations"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.merchant_order_id,
        r.status,
        r.late ? "true" : "false",
        musdToDecimalString(big(r.amount)),
        musdToDecimalString(big(r.amount_refunded)),
        r.source,
        iso(r.created_at),
        iso(r.expires_at),
        isoOrNull(r.paid_at) ?? "",
        strOrNull(r.transaction_hash) ?? "",
        strOrNull(r.payer_address) ?? "",
        r.confirmations ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export async function listNotifications(sql: Sql, merchantId: string, opts: { unread?: boolean; limit?: number } = {}) {
  const rows = opts.unread
    ? await sql`SELECT * FROM notifications WHERE merchant_id = ${merchantId} AND read_at IS NULL ORDER BY created_at DESC LIMIT ${opts.limit ?? 50}`
    : await sql`SELECT * FROM notifications WHERE merchant_id = ${merchantId} ORDER BY created_at DESC LIMIT ${opts.limit ?? 50}`;
  const [u] = await sql`SELECT count(*)::int AS n FROM notifications WHERE merchant_id = ${merchantId} AND read_at IS NULL`;
  const data: NotificationDTO[] = rows.map((r) => ({
    id: str(r.id),
    kind: str(r.kind),
    title: str(r.title),
    body: str(r.body),
    link: strOrNull(r.link),
    read_at: isoOrNull(r.read_at),
    created_at: iso(r.created_at),
  }));
  return { data, unread: int(u?.n) };
}

export async function markNotificationsRead(sql: Sql, merchantId: string, ids: string[] | undefined): Promise<{ updated: number }> {
  const now = clock.now();
  const rows = ids?.length
    ? await sql`UPDATE notifications SET read_at = ${now} WHERE merchant_id = ${merchantId} AND read_at IS NULL
                AND id IN (${sql.join(ids.map((id) => sql.frag`${id}::uuid`), ", ")}) RETURNING id`
    : await sql`UPDATE notifications SET read_at = ${now} WHERE merchant_id = ${merchantId} AND read_at IS NULL RETURNING id`;
  return { updated: rows.length };
}
