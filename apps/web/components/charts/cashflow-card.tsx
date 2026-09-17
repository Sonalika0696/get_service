'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { LineChart } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { treasury } from '@/lib/endpoints';
import { formatCompact, formatRupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CashflowRange } from '@/lib/types';

const RANGES: { value: CashflowRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '12m', label: '12M' },
];

/** Cashflow trend for the caller's society: dated income/expense/net from GET /ledger/cashflow. */
export function CashflowCard() {
  const [range, setRange] = useState<CashflowRange>('30d');
  const q = useQuery({ queryKey: ['cashflow', range], queryFn: () => treasury.cashflow(range) });

  const points = (q.data?.series ?? []).map((b) => ({
    date: b.date,
    income: parseFloat(b.income) || 0,
    expense: parseFloat(b.expense) || 0,
    net: parseFloat(b.net) || 0,
  }));
  const hasData = points.length > 0 && points.some((p) => p.income !== 0 || p.expense !== 0);

  return (
    <Card>
      <CardHeader
        title="Cashflow"
        action={
          <div className="flex gap-[2px] rounded-lg bg-bg-secondary p-[3px]">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={cn(
                  'rounded-md px-sm py-xxs text-caption font-medium transition-colors',
                  range === r.value ? 'bg-bg-elevated text-ink-100 shadow-sm' : 'text-ink-40 hover:text-ink-80',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <CardBody>
        {q.isLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={points} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="cf-income" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--feedback-success))" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="rgb(var(--feedback-success))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cf-expense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--feedback-danger))" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="rgb(var(--feedback-danger))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--ink-40))', fontSize: 11 }} minTickGap={24} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'rgb(var(--ink-40))', fontSize: 11 }}
                tickFormatter={(v: number) => formatCompact(v)}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--border-divider)',
                  background: 'rgb(var(--bg-elevated))',
                  color: 'rgb(var(--ink-100))',
                  fontSize: 13,
                }}
                formatter={(value: number, name: string) => [formatRupees(value), name === 'income' ? 'Income' : name === 'expense' ? 'Expense' : 'Net']}
              />
              <Area type="monotone" dataKey="income" stroke="rgb(var(--feedback-success))" strokeWidth={2} fill="url(#cf-income)" />
              <Area type="monotone" dataKey="expense" stroke="rgb(var(--feedback-danger))" strokeWidth={2} fill="url(#cf-expense)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            icon={LineChart}
            title="Nothing posted in this window"
            description="Income and expense will chart here once money moves through the ledger in the selected range."
          />
        )}
      </CardBody>
    </Card>
  );
}
