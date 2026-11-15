import type { IntentStatus } from "@/lib/chain/payment-state";
import { INTENT_STATUS, type Tone } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";

/** Literal class names so Tailwind picks them up. */
const FILL: Record<Tone, string> = { ok: "fill-ok", info: "fill-info", warn: "fill-warn", bad: "fill-bad", idle: "fill-idle" };

const W = 128;
const H = 40;
const BOX: Record<IntentStatus, [number, number]> = {
  created: [16, 30],
  awaiting_payment: [176, 30],
  submitted: [336, 30],
  confirming: [496, 30],
  paid: [656, 30],
  partially_refunded: [656, 140],
  refunded: [656, 250],
  expired: [176, 250],
  cancelled: [336, 250],
};

function Node({ s }: { s: IntentStatus }) {
  const [x, y] = BOX[s];
  const meta = INTENT_STATUS[s];
  return (
    <g>
      <rect x={x} y={y} width={W} height={H} rx={8} className={cn("fill-card", s === "paid" ? "stroke-ok" : "stroke-border")} strokeWidth={s === "paid" ? 1.75 : 1} />
      <circle cx={x + 14} cy={y + H / 2} r={3} className={cn("stroke-none", FILL[meta.tone])} />
      <text x={x + 24} y={y + H / 2 + 4} className="fill-foreground text-[12px] font-medium">
        {meta.label}
      </text>
    </g>
  );
}

function Edge({ d, label, lx, ly, dashed, anchor = "middle" }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean; anchor?: "start" | "middle" | "end" }) {
  return (
    <g>
      <path d={d} fill="none" className="stroke-muted-foreground" strokeWidth={1.25} strokeDasharray={dashed ? "4 4" : undefined} markerEnd="url(#lc-arrow)" />
      {label ? (
        <text x={lx} y={ly} textAnchor={anchor} className="fill-muted-foreground text-[11px]">
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** The intent state machine (lib/chain/payment-state.ts). The table below it is the text alternative. */
export function LifecycleDiagram() {
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-surface p-3">
        <svg viewBox="0 0 830 310" role="img" aria-labelledby="lc-title lc-desc" className="h-auto w-full min-w-[640px]">
          <title id="lc-title">Payment intent lifecycle</title>
          <desc id="lc-desc">
            Created moves to awaiting payment when checkout opens, to submitted when the customer reports a transaction, to confirming when the payment event
            is verified on-chain, and to paid after enough confirmations. Payable intents expire when time runs out or become cancelled when the merchant
            cancels. A replaced block sends confirming back to awaiting payment. A payment that lands after expiry or cancel is recorded as paid and flagged
            late. Refunds move paid to partly refunded and then to refunded.
          </desc>
          <defs>
            <marker id="lc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <Edge d="M144 50H174" />
          <text x={159} y={24} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            opened
          </text>
          <Edge d="M304 50H334" label="tx sent" lx={319} ly={24} />
          <Edge d="M464 50H494" label="event verified" lx={479} ly={24} />
          <Edge d="M624 50H654" label="confirmed" lx={639} ly={24} />
          <Edge d="M720 70V138" label="refund" lx={728} ly={108} anchor="start" />
          <Edge d="M720 180V248" label="refund the rest" lx={728} ly={218} anchor="start" />
          <Edge d="M784 50C818 50 818 270 786 270" label="full refund" lx={824} ly={160} anchor="end" />
          <Edge d="M240 70V248" label="time runs out" lx={232} ly={170} anchor="end" />
          <Edge d="M400 70V248" label="merchant cancels" lx={408} ly={170} anchor="start" />
          <Edge d="M548 70C520 118 300 118 262 72" dashed label="block replaced" lx={470} ly={130} />
          <Edge d="M464 262C540 262 572 140 564 72" dashed label="late payment" lx={548} ly={226} anchor="start" />
          {(Object.keys(BOX) as IntentStatus[]).map((s) => (
            <Node key={s} s={s} />
          ))}
        </svg>
      </div>
      <figcaption className="text-xs text-muted-foreground">Dashed lines are exceptions. The transitions table below lists every allowed move.</figcaption>
    </figure>
  );
}
