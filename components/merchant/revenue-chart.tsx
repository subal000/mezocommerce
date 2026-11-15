"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MerchantOverviewDTO } from "@/lib/api-types";
import { musdDisplay } from "@/lib/client/format";

type Day = MerchantOverviewDTO["daily"][number];

/** Chart-only numbers (never used for accounting): display decimal → float for the y axis. */
export function toChartRows(daily: Day[]) {
  return daily.map((d) => ({ date: d.date, value: Number.parseFloat(d.received_display) || 0, display: d.received_display, count: d.count }));
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ReturnType<typeof toChartRows>[number] }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-panel">
      <p className="text-muted-foreground">{dayLabel(p.date)}</p>
      <p className="num mt-0.5 font-medium">{musdDisplay(p.display)} MUSD</p>
      <p className="num text-muted-foreground">
        {p.count} {p.count === 1 ? "payment" : "payments"}
      </p>
    </div>
  );
}

/** 30-day received MUSD (UTC). Text summary for screen readers. */
export function RevenueChart({ daily, height = 220 }: { daily: Day[]; height?: number }) {
  const rows = useMemo(() => toChartRows(daily), [daily]);
  const total = rows.reduce((a, r) => a + r.count, 0);
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.value > b.value ? r : b), null);
  const summary = total
    ? `${total} payments over ${rows.length} days. Best day ${best ? `${dayLabel(best.date)}, ${musdDisplay(best.display)} MUSD` : "none"}.`
    : `No payments in the last ${rows.length || 30} days.`;
  return (
    <figure className="m-0">
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mc-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis width={44} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
            <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} fill="url(#mc-area)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
