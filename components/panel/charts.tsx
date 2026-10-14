"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compact, money } from "@/lib/format";
import { Card, CardHeader } from "./ui";

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string; fill?: string }>;
  asMoney?: boolean;
}

function ChartTooltip({ active, payload, label, asMoney = true }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          {p.name}: <span className="font-medium text-foreground">{asMoney ? money(Number(p.value)) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

export interface Serie { key: string; label: string; color: string }

function Legend({ series }: { series: Serie[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function BarCard({
  title, desc, data, xKey, series, height = 280, className,
}: { title: string; desc?: string; data: Record<string, string | number>[]; xKey: string; series: Serie[]; height?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} desc={desc} action={<Legend series={series} />} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={6} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compact} width={44} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--mint-50)" }} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function AreaCard({
  title, desc, data, xKey, dataKey, label, className,
}: { title: string; desc?: string; data: Record<string, string | number>[]; xKey: string; dataKey: string; label: string; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} desc={desc} />
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--chart-2)", stopOpacity: 0.35 }} />
                <stop offset="100%" style={{ stopColor: "var(--chart-2)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compact} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey={dataKey} name={label} stroke="var(--chart-2)" strokeWidth={2.5} fill="url(#areaFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function DonutCard({
  title, desc, data, centerValue, centerLabel, className,
}: { title: string; desc?: string; data: { name: string; value: number }[]; centerValue: string; centerLabel: string; className?: string }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
  return (
    <Card className={className}>
      <CardHeader title={title} desc={desc} />
      <div className="relative mx-auto h-[190px] w-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={3} cornerRadius={6} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip asMoney={false} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between text-[13px]">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: colors[i % colors.length] }} />
              {d.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {d.value} · {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
