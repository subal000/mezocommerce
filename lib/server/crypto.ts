// AES-256-GCM for secrets at rest (Shopify Admin token + API secret). Format: v1:<iv b64>:<tag b64>:<ciphertext b64>.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", env.encryptionKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unsupported ciphertext");
  const d = createDecipheriv("aes-256-gcm", env.encryptionKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
