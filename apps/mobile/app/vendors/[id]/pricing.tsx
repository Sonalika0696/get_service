import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowLeft,
  Info,
  ReceiptX,
  Ruler,
  Clock,
  Package,
  Tag,
  Coins,
} from '../../../src/icons/phosphor';
import type { PricingBasis, PricingCardDetail, PricingLine, PricingCardStatus } from '@sft/api-client';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../../src/components/ListState';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import { useVendor } from '../../../src/hooks/useVendors';
import { vendorPricingCardQueryOptions } from '../../../src/hooks/useVendorPricingCard';
import { formatMajor } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Vendor pricing cards — read-only. FRONTEND_PLAN §5.F3:
 * "view a vendor's current card before committing to anything".
 *
 * A vendor publishes at most one current card per category
 * (GET /pricing-cards/vendors/:vendorId/categories/:category/current), so
 * this screen resolves the vendor's `categories` first, then fetches one
 * card per category and renders every one that exists. There is no "list
 * all versions" endpoint, so history isn't shown here — only the current
 * card per category.
 */
export default function VendorPricing() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const vendor = useVendor(id);
  const categories = vendor.data?.categories ?? [];

  const cardQueries = useQueries({
    queries: categories.map((category) => vendorPricingCardQueryOptions(id, category)),
  });

  const cardsLoading = vendor.isLoading || (categories.length > 0 && cardQueries.some((q) => q.isLoading));
  const firstError = vendor.isError ? vendor.error : cardQueries.find((q) => q.isError)?.error;
  const allSettled = !vendor.isLoading && cardQueries.every((q) => !q.isLoading);
  const publishedCards = cardQueries
    .map((q, i) => ({ category: categories[i], data: q.data }))
    .filter((c): c is { category: string; data: PricingCardDetail } => Boolean(c.data));

  const refetchAll = () => {
    vendor.refetch();
    cardQueries.forEach((q) => q.refetch());
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />

      <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
        <Button
          label="Back"
          variant="ghost"
          leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
          onPress={() => router.back()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="display" weight="semibold">{vendor.data?.name ?? 'Pricing'}</Text>

        {cardsLoading ? <ListLoading label="Loading pricing cards" /> : null}

        {!cardsLoading && firstError ? (
          <ListError
            message={(firstError as { message?: string } | null)?.message ?? 'Could not load pricing cards.'}
            onRetry={refetchAll}
          />
        ) : null}

        {!cardsLoading && !firstError && allSettled && publishedCards.length === 0 ? (
          <ListEmpty
            Icon={ReceiptX}
            title="No pricing card yet"
            body={
              vendor.data
                ? `${vendor.data.name} hasn't published a pricing card yet. When they do, you'll see every line and rate before committing.`
                : 'This vendor hasn’t published a pricing card yet.'
            }
          />
        ) : null}

        {publishedCards.map(({ category, data }) => (
          <PricingCardBody key={category} card={data} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function PricingCardBody({ card }: { card: PricingCardDetail }) {
  const theme = useTheme();
  const gstPct = toNumber(card.gstRatePct);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusPill status={card.status} />
          <Text variant="overline" weight="semibold" tone="muted">
            {card.category} · v{card.version}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="caption" tone="muted">
            {gstPct !== null ? `GST ${gstPct}%` : null}
            {card.publishedAt
              ? `${gstPct !== null ? ' · ' : ''}Published ${new Date(card.publishedAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}`
              : ''}
          </Text>
        </View>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <SectionLabel>Lines</SectionLabel>
        {card.lines.length === 0 ? (
          <Card padded={theme.spacing.lg}>
            <Text variant="body" tone="secondary">
              No lines on this card.
            </Text>
          </Card>
        ) : (
          card.lines.map((l) => <PricingLineCard key={l.id} line={l} />)
        )}
      </View>
    </View>
  );
}

function PricingLineCard({ line }: { line: PricingLine }) {
  const theme = useTheme();
  const minimum = toNumber(line.minimum);

  return (
    <Card padded={theme.spacing.md}>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text variant="body" weight="semibold" style={{ flex: 1, paddingRight: theme.spacing.sm }}>
            {line.label}
          </Text>
          <View
            style={{
              backgroundColor: theme.colors.bg.secondary,
              borderRadius: theme.radius.pill,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text variant="caption" weight="semibold" tone="secondary" mono>
              {basisLabel(line.basis)}
            </Text>
          </View>
        </View>

        <Row Icon={basisIcon(line.basis)} label="Rate" value={formatRate(line)} />
        {minimum !== null ? (
          <Row Icon={Coins} label="Minimum" value={formatMajor(line.minimum)} />
        ) : null}

        {line.conditions ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 6,
              backgroundColor: theme.colors.bg.secondary,
              borderRadius: theme.radius.md,
              padding: theme.spacing.sm,
              marginTop: 4,
            }}
          >
            <Info size={14} color={theme.colors.ink[60]} weight="duotone" />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {line.conditions}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function Row({
  Icon,
  label,
  value,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string; weight?: 'duotone' | 'regular' }>;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Icon size={16} color={theme.colors.ink[60]} weight="duotone" />
      <Text variant="caption" tone="muted" style={{ flex: 1 }}>{label}</Text>
      <Text variant="caption" weight="semibold" tone="secondary" mono>{value}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: PricingCardStatus }) {
  const theme = useTheme();
  const config = {
    PUBLISHED: { bg: theme.colors.feedback.successTint, label: 'Published', tone: 'accent' as const },
    DRAFT: { bg: theme.colors.bg.secondary, label: 'Draft', tone: 'muted' as const },
    SUPERSEDED: { bg: theme.colors.bg.secondary, label: 'Superseded', tone: 'muted' as const },
  }[status];
  return (
    <View
      style={{
        backgroundColor: config.bg,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text variant="caption" weight="semibold" tone={config.tone}>{config.label}</Text>
    </View>
  );
}

function basisLabel(basis: PricingBasis): string {
  switch (basis) {
    case 'PER_VISIT': return 'Per visit';
    case 'PER_HOUR': return 'Per hour';
    case 'PER_UNIT': return 'Per unit';
    case 'PERCENTAGE': return 'Percentage';
    default: return basis;
  }
}

function basisIcon(basis: PricingBasis) {
  switch (basis) {
    case 'PER_HOUR': return Clock;
    case 'PER_UNIT': return Package;
    case 'PERCENTAGE': return Tag;
    default: return Ruler;
  }
}

function formatRate(line: PricingLine): string {
  if (line.basis === 'PERCENTAGE') {
    const pct = toNumber(line.rate);
    return pct !== null ? `${pct}%` : '—';
  }
  return formatMajor(line.rate);
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
