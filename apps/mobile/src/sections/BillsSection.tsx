import React, { useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Receipt, ClockCounterClockwise } from '../icons/phosphor';
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
 *
 * Virtualised via FlatList: the hero card, Segmented and SectionLabel scroll
 * with the list as ListHeaderComponent, bill-line rows only mount on-screen.
 * (The railBreakdown badges inside HeroDueCard stay a plain `.map()` — that
 * list is bounded to the handful of payment rails and lives inside the
 * header, not the growing feed.)
 */
export default function BillsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
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
      <FlatList
        data={visible}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <BillLineRow line={item} onPress={() => router.push(`/bills/${item.id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.md }} />}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg }}>
            <View>
              <Text variant="display" weight="semibold" accessibilityRole="header">{t('bills.title')}</Text>
              <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
                {t('bills.subtitle')}
              </Text>
              {hub.isSample ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                  Sample data
                </Text>
              ) : null}
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
                { value: 'due', label: t('bills.segment.dueNow') },
                { value: 'all', label: t('bills.segment.all') },
              ]}
            />

            <SectionLabel>
              {segment === 'due' ? t('bills.sectionLabel.dueNow') : t('bills.sectionLabel.everyLine')}
            </SectionLabel>
          </View>
        }
        ListEmptyComponent={
          hub.isLoading ? (
            <ListLoading label={t('bills.loading')} />
          ) : hub.isError ? (
            <ListError
              message={
                (hub.error as { message?: string } | null)?.message ??
                t('bills.errorFallback')
              }
              onRetry={() => hub.refetch()}
            />
          ) : hub.isSuccess && visible.length === 0 ? (
            <ListEmpty
              Icon={Receipt}
              illustration="bills"
              title={segment === 'due' ? t('bills.empty.dueTitle') : t('bills.empty.allTitle')}
              body={segment === 'due' ? t('bills.empty.dueBody') : t('bills.empty.allBody')}
            />
          ) : null
        }
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          paddingTop: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
      />
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
  const { t } = useTranslation();
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
      <View
        accessible
        accessibilityLabel={`${t('bills.totalDue')}: ${amountSpokenLabel(totalMinor)}. ${totalMinor > 0 ? t('bills.acrossRails') : t('bills.allClear')}`}
      >
        <Text variant="caption" tone="onAccent" style={{ opacity: 0.72 }}>
          {t('bills.totalDue')}
        </Text>
        <Money
          minor={totalMinor}
          variant="display"
          weight="semibold"
          tone="onAccent"
          showDecimals={false}
        />
        <Text variant="caption" tone="onAccent" style={{ opacity: 0.72, marginTop: 4 }}>
          {totalMinor > 0 ? t('bills.acrossRails') : t('bills.allClear')}
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
          label={t('bills.statementHistory')}
          variant="secondary"
          leftIcon={<ClockCounterClockwise size={16} color={theme.colors.accent[700]} weight="regular" />}
          onPress={onPressHistory}
          fullWidth
        />
      </View>
    </View>
  );
}

/**
 * A screen-reader-friendly reading of the total due — "12,450 rupees"
 * instead of a screen reader trying (and often failing) to sound out
 * "₹12,450".
 */
function amountSpokenLabel(minor: number, currency = 'INR'): string {
  const value = minor / 100;
  const formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const unit = currency === 'INR' ? 'rupees' : currency;
  return `${formatter.format(value)} ${unit}`;
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
