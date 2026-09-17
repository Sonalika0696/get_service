'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS: Record<string, string> = {
  ACTIVE: '#16A34A',
  ONBOARDING: '#F59E0B',
  ARCHIVED: '#8B9198',
};

export function StatusDonut({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
            {data.map((d) => (
              <Cell key={d.name} fill={COLORS[d.name] ?? '#0F766E'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, n: string) => [`${v}`, n.charAt(0) + n.slice(1).toLowerCase()]}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--border-divider)',
              background: 'rgb(var(--bg-elevated))',
              color: 'rgb(var(--ink-100))',
              fontSize: 13,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-display font-semibold text-ink-100">{total}</span>
        <span className="text-caption text-ink-40">Societies</span>
      </div>
    </div>
  );
}
