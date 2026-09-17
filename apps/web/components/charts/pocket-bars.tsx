'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatRupees, humanizeAccountKind } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

const PALETTE = ['#0F766E', '#0EA5E9', '#F59E0B', '#8B5CF6', '#F43F5E', '#16A34A', '#B45309', '#0369A1'];

export function PocketBars({ balances }: { balances: AccountBalance[] }) {
  const data = balances.map((b, i) => ({
    name: humanizeAccountKind(b.kind),
    value: parseFloat(b.balance) || 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={128}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'rgb(var(--ink-60))', fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: 'rgb(var(--ink-100) / 0.04)' }}
          formatter={(v: number) => [formatRupees(v), 'Balance']}
          contentStyle={{
            borderRadius: 12,
            border: '1px solid var(--border-divider)',
            background: 'rgb(var(--bg-elevated))',
            color: 'rgb(var(--ink-100))',
            boxShadow: '0 12px 24px rgb(var(--ink-100) / 0.08)',
            fontSize: 13,
          }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18} label={{ position: 'right', formatter: (v: number) => formatCompact(v), fill: 'rgb(var(--ink-40))', fontSize: 11 }}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
