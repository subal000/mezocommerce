"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IntentStatus } from "@/lib/chain/payment-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MusdDisplay } from "@/components/shared/money";
import { musdDisplay } from "@/lib/client/format";

/** Fixed sample data for the landing page. Never shown as live numbers. */
const DAILY = [
  { d: "Oct 28", v: 112.4 },
  { d: "Oct 29", v: 86.15 },
  { d: "Oct 30", v: 141.9 },
  { d: "Oct 31", v: 97.3 },
  { d: "Nov 1", v: 163.75 },
  { d: "Nov 2", v: 58.2 },
  { d: "Nov 3", v: 74.6 },
  { d: "Nov 4", v: 188.05 },
  { d: "Nov 5", v: 129.4 },
  { d: "Nov 6", v: 151.85 },
  { d: "Nov 7", v: 203.1 },
  { d: "Nov 8", v: 92.7 },
  { d: "Nov 9", v: 117.35 },
  { d: "Nov 10", v: 176.2 },
];

const ROWS: { order: string; amount: string; status: IntentStatus; when: string }[] = [
  { order: "#1047", amount: "62.40", status: "confirming", when: "2 min ago" },
  { order: "#1046", amount: "18.95", status: "paid", when: "14 min ago" },
  { order: "#1045", amount: "124.00", status: "paid", when: "1 hour ago" },
  { order: "#1044", amount: "33.10", status: "expired", when: "3 hours ago" },
  { order: "#1043", amount: "48.60", status: "partially_refunded", when: "Yesterday" },
];

const total = DAILY.reduce((s, x) => s + Math.round(x.v * 100), 0);
const TOTAL_DISPLAY = `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`;

export function DashboardPreview() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-xl border bg-card shadow-panel">
        <div className="grid gap-px bg-border sm:grid-cols-3">
          {[
            { label: "Received, 14 days", value: <MusdDisplay value={TOTAL_DISPLAY} /> },
            { label: "Successful payments", value: <span className="num">37</span> },
            { label: "Conversion", value: <span className="num">81.6%</span> },
          ].map((s) => (
            <div key={s.label} className="bg-card px-5 py-4">
              <p className="text-[0.8125rem] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tracking-[-0.01em]">{s.value}</p>
            </div>
          ))}
        </div>
        <div className="border-t px-2 pt-4 pb-2 sm:px-4">
          <div className="h-44 w-full" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DAILY} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="landing-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="d" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [`${musdDisplay(String(v))} MUSD`, "Received"]}
                />
                <Area type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} fill="url(#landing-fill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="overflow-x-auto border-t">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Sample recent payments</caption>
            <thead>
              <tr className="text-left text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="px-5 py-2.5 font-normal">Order</th>
                <th scope="col" className="px-5 py-2.5 font-normal">Status</th>
                <th scope="col" className="px-5 py-2.5 text-right font-normal">Amount</th>
                <th scope="col" className="hidden px-5 py-2.5 text-right font-normal sm:table-cell">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ROWS.map((r) => (
                <tr key={r.order}>
                  <td className="px-5 py-2.5 font-mono text-[0.8125rem]">{r.order}</td>
                  <td className="px-5 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <MusdDisplay value={r.amount} />
                  </td>
                  <td className="hidden px-5 py-2.5 text-right text-muted-foreground sm:table-cell">{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">Sample data, not live. Your dashboard shows your own payments once you start.</figcaption>
    </figure>
  );
}
