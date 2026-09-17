import React, { useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Receipt, ClockCounterClockwise } from 'phosphor-react-native';
import type { PaymentRail } from '@sft/api-client';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { SectionLabel } from '../components/SectionLabel';
import { Segmented } from '../components/Segmented';
import { BillLineRow } from '../components/BillLineRow';
import { ListLoading, ListError, ListEmpty } from '../components/ListState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useBillsHub } from '../hooks/useBills';
import { useTheme } from '../theme/ThemeProvider';

type Segment = 'due' | 'all';

/**
 * Bills hub. Hero card at the top shows total due; segmented filter switches
 * between "Due now" and "All". Sorted by due date within each group.
 */
export default function BillsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('due');

  const hub = useBillsHub();
  const lines = hub.data?.lines ?? [];

  const visible = useMemo(() => {
    const filtered = segment === 'due'
      ? lines.filter((l) => l.status === 'DUE' || l.status === 'OVERDUE' || l.status === 'PARTIAL')
      : lines;
    return [...filtered].sort((a, b) => new Date(a.dueOn).getTime() - new Date(b.dueOn).getTime());
  }, [lines, segment]);

  const railBreakdown = useMemo(() => summariseRails(visible), [visible]);
  const totalDue = hub.data?.totalDueMinor ?? 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text variant="display" weight="semibold">Bills</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Every obligation for your flat, with the number that produced it.
          </Text>
        </View>

        <HeroDueCard
          totalMinor={totalDue}
          railBreakdown={railBreakdown}
          onPressHistory={() => router.push('/bills/history')}
        />

        <Segmented<Segment>
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'due', label: 'Due now' },
            { value: 'all', label: 'All' },
          ]}
        />

        <View>
          <SectionLabel>
            {segment === 'due' ? 'Due now' : 'Every line'}
          </SectionLabel>

          {hub.isLoading ? <ListLoading label="Loading bills" /> : null}

          {hub.isError ? (
            <ListError
              message={
                (hub.error as { message?: string } | null)?.message ??
                'Bills are unreachable right now. Check your connection and try again.'
              }
              onRetry={() => hub.refetch()}
            />
          ) : null}

          {hub.isSuccess && visible.length === 0 ? (
            <ListEmpty
              Icon={Receipt}
              illustration="bills"
              title={segment === 'due' ? 'Nothing due' : 'No bills yet'}
              body={
                segment === 'due'
                  ? "You're all caught up. Anything new lands here as soon as it's issued."
                  : 'Bills appear here as soon as the committee publishes a cycle or a pooled request fires.'
              }
            />
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {visible.map((l) => (
              <BillLineRow key={l.id} line={l} onPress={() => router.push(`/bills/${l.id}`)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroDueCard({
  totalMinor,
  railBreakdown,
  onPressHistory,
}: {
  totalMinor: number;
  railBreakdown: Array<{ rail: PaymentRail; count: number; amountMinor: number }>;
  onPressHistory: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.hero.dueBg,
        borderRadius: theme.radius.xxl,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        overflow: 'hidden',
        ...theme.shadows.md.native,
      }}
    >
      <View>
        <Text variant="caption" tone="onAccent" style={{ opacity: 0.72 }}>
          Total due
        </Text>
        <Money
          minor={totalMinor}
          variant="display"
          weight="semibold"
          tone="onAccent"
          showDecimals={false}
        />
        <Text variant="caption" tone="onAccent" style={{ opacity: 0.72, marginTop: 4 }}>
          {totalMinor > 0
            ? 'Across every rail. Pay each line on its own tap to keep the audit trail clean.'
            : 'You are all clear.'}
        </Text>
      </View>

      {railBreakdown.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {railBreakdown.map((r) => (
            <View
              key={r.rail}
              style={{
                backgroundColor: 'rgba(255,255,255,0.14)',
                borderRadius: theme.radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text variant="caption" weight="semibold" tone="onAccent">
                {railLabel(r.rail)} · {r.count}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <Button
          label="Statement history"
          variant="secondary"
          leftIcon={<ClockCounterClockwise size={16} color={theme.colors.accent[700]} weight="regular" />}
          onPress={onPressHistory}
          fullWidth
        />
      </View>
    </View>
  );
}

function railLabel(rail: PaymentRail): string {
  switch (rail) {
    case 'SOCIETY_UPI': return 'Society';
    case 'BULK_BUY_ESCROW': return 'Escrow';
    case 'VENDOR_DIRECT': return 'Vendor';
  }
}

function summariseRails(
  lines: { rail: PaymentRail; amountMinor: number; status: string }[],
): Array<{ rail: PaymentRail; count: number; amountMinor: number }> {
  const byRail = new Map<PaymentRail, { count: number; amountMinor: number }>();
  for (const l of lines) {
    if (l.status === 'PAID') continue;
    const entry = byRail.get(l.rail) ?? { count: 0, amountMinor: 0 };
    entry.count += 1;
    entry.amountMinor += l.amountMinor;
    byRail.set(l.rail, entry);
  }
  return [...byRail.entries()].map(([rail, e]) => ({ rail, ...e }));
}
