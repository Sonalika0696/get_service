'use client';

import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { LineChart } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCompact } from '@/lib/format';

export interface CashflowPoint {
  date: string;
  amount: number;
}

/**
 * Cashflow trend. Renders real points when supplied; otherwise an honest
 * empty state. BACKEND GAP: no timeseries endpoint exists yet (e.g.
 * GET /ledger/cashflow?range=30d) — wire it here when the backend agent
 * ships it.
 */
export function CashflowCard({ points }: { points?: CashflowPoint[] }) {
  const hasData = points && points.length > 0;

  return (
    <Card>
      <CardHeader title="Cashflow" />
      <CardBody>
        {hasData ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={points} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F766E" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#0F766E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--ink-40))', fontSize: 11 }} />
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
              />
              <Area type="monotone" dataKey="amount" stroke="#0F766E" strokeWidth={2} fill="url(#cf)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            icon={LineChart}
            title="No cashflow series yet"
            description="A cashflow trend appears here once a dated ledger timeseries endpoint is available."
          />
        )}
      </CardBody>
    </Card>
  );
}
