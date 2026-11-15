// Random identifiers. Base62 via rejection sampling (no modulo bias).
import { randomBytes } from "node:crypto";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomBase62(len: number): string {
  let out = "";
  while (out.length < len) {
    const buf = randomBytes(len * 2);
    for (const b of buf) {
      if (b < 248) out += B62[b % 62]; // 248 = 62*4 → unbiased
      if (out.length === len) break;
    }
  }
  return out;
}

export const newIntentId = () => `pi_${randomBase62(24)}`;
export const newEventId = () => `evt_${randomBase62(24)}`;
export const newDemoOrderId = () => `demo_${randomBase62(16)}`;
/** Random bytes32 for the on-chain paymentId. */
export const newPaymentId = () => `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

export const PI_ID_RE = /^pi_[0-9A-Za-z]{24}$/;
export const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
