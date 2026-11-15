"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { StatusBadge } from "@/components/shared/status-badge";
import { MusdDisplay } from "@/components/shared/money";
import { AddressText } from "@/components/shared/address";
import { Separator } from "@/components/ui/separator";

const SAMPLE = {
  store: "Harbor & Pine Supply",
  order: "#1042",
  items: [
    { name: "Waxed canvas tote", qty: 1, price: "34.10" },
    { name: "Brass key ring", qty: 2, price: "7.25" },
  ],
  total: "48.60",
  payout: "0x7a3f52e1b9d04c8a6e2f71d3c5b8a90e4f12c91e",
};

/**
 * Hero visual: the checkout summary built from the same components the dashboard uses, with sample data.
 * The status steps from "Awaiting payment" to "Paid" once, to show what verification looks like.
 */
export function HeroPreview() {
  const reduce = useReducedMotion();
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setPaid(true), 2600);
    return () => clearTimeout(t);
  }, [reduce]);

  return (
    <motion.figure
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md justify-self-center lg:justify-self-end"
    >
      <div className="rounded-xl border bg-card shadow-panel">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{SAMPLE.store}</p>
            <p className="text-[0.8125rem] text-muted-foreground">Order {SAMPLE.order}</p>
          </div>
          <StatusBadge status={paid ? "paid" : "awaiting_payment"} />
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          {SAMPLE.items.map((it) => (
            <div key={it.name} className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate">
                {it.name}
                {it.qty > 1 ? <span className="text-muted-foreground"> x{it.qty}</span> : null}
              </span>
              <MusdDisplay value={it.price} unit={false} className="text-muted-foreground" />
            </div>
          ))}
          <Separator />
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">Total</span>
            <MusdDisplay value={SAMPLE.total} className="text-xl font-semibold tracking-[-0.01em]" />
          </div>
        </div>
        <div className="space-y-2 border-t bg-surface px-5 py-4 text-[0.8125rem] rounded-b-xl">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Pays to</span>
            <AddressText address={SAMPLE.payout} link={false} copy={false} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Network</span>
            <span>Mezo Testnet</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Gas</span>
            <span>Paid in BTC</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Sample checkout. Not a real order.</figcaption>
    </motion.figure>
  );
}
