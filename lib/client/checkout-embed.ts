import type { IntentStatus } from "@/lib/chain/payment-state";

/**
 * Embed bridge (checkout iframe → host page). Protocol per docs/ARCHITECTURE.md "Widget protocol":
 *   { source: "mezocommerce", type: "ready"|"resize"|"status"|"success"|"close", paymentIntentId, status, txHash }
 * Messages carry only ids and statuses (not secret), so they are posted with targetOrigin "*": the checkout can be
 * embedded on any merchant site and doesn't know its parent's origin. The widget (public/checkout.js) checks
 * event.origin and event.source on its side.
 * Inbound: the checkout accepts no commands. The only message it recognises is the widget's "close" ack, which
 * changes nothing; everything else is ignored.
 */

export const EMBED_SOURCE = "mezocommerce" as const;
export type EmbedMessageType = "ready" | "resize" | "status" | "success" | "close";

export interface EmbedMessage {
  source: typeof EMBED_SOURCE;
  type: EmbedMessageType;
  paymentIntentId: string;
  status: IntentStatus | null;
  txHash: string | null;
  /** resize only: content height in CSS px */
  height?: number;
}

export function embedMessage(
  type: EmbedMessageType,
  fields: { paymentIntentId: string; status?: IntentStatus | null; txHash?: string | null; height?: number },
): EmbedMessage {
  const m: EmbedMessage = {
    source: EMBED_SOURCE,
    type,
    paymentIntentId: fields.paymentIntentId,
    status: fields.status ?? null,
    txHash: fields.txHash ?? null,
  };
  if (type === "resize" && typeof fields.height === "number" && Number.isFinite(fields.height)) m.height = Math.ceil(fields.height);
  return m;
}

/** Post to the embedding page. No-op when not framed. */
export function postToParent(msg: EmbedMessage, win: Window = window): void {
  if (win.parent === win) return;
  try {
    win.parent.postMessage(msg, "*");
  } catch {
    /* parent gone */
  }
}

/** Returns "close_ack" for the widget's close acknowledgement; null for anything else (ignored). */
export function parseInbound(data: unknown): "close_ack" | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { source?: unknown; type?: unknown };
  return d.source === "mezocommerce-widget" && d.type === "close" ? "close_ack" : null;
}

export function isFramed(win: Window = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true; // cross-origin top access throws → framed
  }
}
