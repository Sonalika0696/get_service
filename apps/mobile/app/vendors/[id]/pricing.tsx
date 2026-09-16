import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Info,
  ClockCounterClockwise,
  SealCheck,
  ClipboardText,
  ReceiptX,
  Package,
  Coins,
  Ruler,
  Clock,
  QuestionMark,
} from 'phosphor-react-native';
import type {
  VendorPricingCard,
  PricingLine,
  LabourBasis,
  PricingCardStatus,
} from '@sft/api-client';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Money } from '../../../src/components/Money';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../../src/components/ListState';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import { useVendor } from '../../../src/hooks/useVendors';
import { useVendorPricingCard } from '../../../src/hooks/useVendorPricingCard';
import { formatMinor } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Vendor pricing card — read-only. FRONTEND_PLAN §5.F3:
 * "view a vendor's current card before committing to anything".
 *
 * The card is deliberately terse: header identifies who, what, and which
 * version; the body lists every line the vendor stands by; a small footer
 * covers card-wide GST and notes. Editing is a web-vendor concern; a
 * revision on backend produces a new card version, and older versions
 * remain accessible via /history (screen not implemented yet).
 */
export default function VendorPricing() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string; category?: string }>();
  const params = useLocalSearchParams<{ category?: string }>();
  const category = typeof params.category === 'string' ? params.category : undefined;

  const vendor = useVendor(id);
  const card = useVendorPricingCard(id, category);

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
        {card.isLoading ? <ListLoading label="Loading pricing card" /> : null}

        {card.isError ? (
          <ListError
            message={
              (card.error as { message?: string } | null)?.message ??
              'Could not load this pricing card.'
            }
            onRetry={() => card.refetch()}
          />
        ) : null}

        {card.isSuccess && !card.data ? (
          <ListEmpty
            Icon={ReceiptX}
            title="No pricing card yet"
            body={
              vendor.data
                ? `${vendor.data.name} hasn’t published a card${
                    category ? ` for ${category}` : ''
                  } yet. When they do, you’ll see every line and rate before committing.`
                : 'Pricing cards land with Phase 7 backend.'
            }
          />
        ) : null}

        {card.data ? (
          <CardBody
            vendorName={vendor.data?.name ?? 'Vendor'}
            card={card.data}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CardBody({ vendorName, card }: { vendorName: string; card: VendorPricingCard }) {
  const theme = useTheme();

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusPill status={card.status} />
          <Text variant="overline" weight="semibold" tone="muted">
            {card.category} · v{card.version}
          </Text>
        </View>
        <Text variant="display" weight="semibold">{vendorName}</Text>
        {card.publishedAt ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ClockCounterClockwise size={14} color={theme.colors.ink[60]} weight="duotone" />
            <Text variant="caption" tone="muted">
              Published {new Date(card.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              {card.status === 'PUBLISHED' ? ' · this is the current version' : ''}
            </Text>
          </View>
        ) : null}
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
          card.lines.map((l) => (
            <PricingLineCard key={l.id} line={l} currency={card.currency} defaultGstPct={card.defaultGstRatePct} />
          ))
        )}
      </View>

      {card.notes ? (
        <View>
          <SectionLabel>Notes</SectionLabel>
          <Card padded={theme.spacing.lg}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <ClipboardText size={20} color={theme.colors.accent[700]} weight="duotone" />
              <Text variant="body" tone="secondary" style={{ flex: 1 }}>
                {card.notes}
              </Text>
            </View>
          </Card>
        </View>
      ) : null}

      <View>
        <SectionLabel>Trust note</SectionLabel>
        <View
          style={{
            backgroundColor: theme.colors.accent.tint,
            borderRadius: theme.radius.xl,
            padding: theme.spacing.md,
            flexDirection: 'row',
            gap: theme.spacing.sm,
          }}
        >
          <SealCheck size={20} color={theme.colors.accent[700]} weight="duotone" />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            Published cards are immutable. If this vendor updates their prices, a new version is
            published and this one stays readable — you can always come back to what you agreed to.
          </Text>
        </View>
      </View>
    </>
  );
}

function PricingLineCard({
  line,
  currency,
  defaultGstPct,
}: {
  line: PricingLine;
  currency: string;
  defaultGstPct: number;
}) {
  const theme = useTheme();
  const gst = line.gstRatePct > 0 ? line.gstRatePct : defaultGstPct;

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
              GST {gst}%
            </Text>
          </View>
        </View>

        <Row Icon={Ruler} label="Visit charge" value={formatMinor(line.visitChargeMinor, currency)} />
        <Row
          Icon={labourIcon(line.labour)}
          label="Labour"
          value={formatLabour(line.labour, currency)}
        />
        <Row Icon={Package} label="Materials" value={line.materialsHandling} />
        <Row Icon={Coins} label="Minimum" value={formatMinor(line.minimumChargeMinor, currency)} />

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

function labourIcon(basis: LabourBasis) {
  switch (basis.kind) {
    case 'PER_HOUR': return Clock;
    case 'ON_QUOTE': return QuestionMark;
    default: return Ruler;
  }
}

function formatLabour(basis: LabourBasis, currency: string): string {
  switch (basis.kind) {
    case 'FLAT': return `${formatMinor(basis.flatMinor, currency)} flat`;
    case 'PER_HOUR': return `${formatMinor(basis.ratePerHourMinor, currency)} / hour`;
    case 'PER_UNIT': return `${formatMinor(basis.ratePerUnitMinor, currency)} / ${basis.unit}`;
    case 'ON_QUOTE': return basis.note;
  }
}
