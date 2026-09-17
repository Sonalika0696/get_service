import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Lightning,
  Drop,
  Info,
  WarningCircle,
  Buildings,
  ScanSmiley,
  Ruler,
} from '../../../src/icons/phosphor';
import type {
  UtilityBillTrace,
  SlabRow,
  WaterSourceBlend,
  UtilityReconciliation,
  MeterReading,
  CommonAreaShare,
} from '@sft/api-client';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Money } from '../../../src/components/Money';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../../src/components/ListState';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import { useUtilityBillTrace } from '../../../src/hooks/useUtilityBillTrace';
import { formatMinor } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Utility bill trace. FRONTEND_PLAN §5.F7:
 * "the flat's bill with its computation trace — the formula and inputs,
 * not just the figure."
 *
 * Seven sections that follow the SDD §4.4 pipeline back to the source:
 * header, consumption, slab breakdown, common-area apportionment,
 * (water only) source blend, reconciliation, grand total.
 */
export default function BillTrace() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useUtilityBillTrace(id);

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
        {query.isLoading ? <ListLoading label="Loading trace" /> : null}
        {query.isError ? (
          <ListError
            message={
              (query.error as { message?: string } | null)?.message ??
              'Could not load this trace.'
            }
            onRetry={() => query.refetch()}
          />
        ) : null}

        {query.isSuccess && !query.data ? (
          <ListEmpty
            Icon={Ruler}
            title="Trace lands with Phase 10 backend"
            body={
              'Once the electricity and water billing pipeline ships, this screen walks you back through the meter reading, the slab, the common-area share, and the bulk-invoice reconciliation.'
            }
          />
        ) : null}

        {query.data ? <TraceBody trace={query.data} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TraceBody({ trace }: { trace: UtilityBillTrace }) {
  const theme = useTheme();
  const Icon = trace.utility === 'ELECTRICITY' ? Lightning : Drop;
  const iconColor =
    trace.utility === 'ELECTRICITY' ? theme.colors.feedback.warning : theme.colors.feedback.info;
  const iconBg =
    trace.utility === 'ELECTRICITY' ? theme.colors.feedback.warningTint : theme.colors.feedback.infoTint;
  const label = trace.utility === 'ELECTRICITY' ? 'Electricity' : 'Water';

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.lg,
            backgroundColor: iconBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={28} color={iconColor} weight="duotone" />
        </View>
        <Text variant="overline" weight="semibold" tone="muted">
          {label} · {formatPeriod(trace.periodStart, trace.periodEnd)}
        </Text>
        <Text variant="display" weight="semibold">Computation trace</Text>
        <Money
          minor={trace.totalMinor}
          currency={trace.currency}
          variant="display"
          weight="semibold"
          tone="accent"
        />
      </View>

      <ReadingBlock reading={trace.reading} />
      <SlabBlock slabs={trace.slabs} totalMinor={trace.slabTotalMinor} unit={trace.reading.unit} />
      {trace.waterBlend ? <WaterBlendBlock blend={trace.waterBlend} /> : null}
      <CommonAreaBlock share={trace.commonArea} />
      {trace.reconciliation ? <ReconciliationBlock rec={trace.reconciliation} /> : null}
      <TotalBlock trace={trace} />
    </>
  );
}

function ReadingBlock({ reading }: { reading: MeterReading }) {
  const theme = useTheme();
  return (
    <View>
      <SectionLabel>1 · Meter reading</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Previous</Text>
            <Text variant="body" weight="semibold" mono>
              {reading.prevReading.toLocaleString('en-IN')} {reading.unit}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Current</Text>
            <Text variant="body" weight="semibold" mono>
              {reading.currentReading.toLocaleString('en-IN')} {reading.unit}
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border.subtle, marginVertical: 4 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" weight="semibold">Consumed</Text>
            <Text variant="body" weight="semibold" mono tone="accent">
              {reading.consumedUnits.toLocaleString('en-IN')} {reading.unit}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            Read on {new Date(reading.readingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            {' · meter '}
            <Text variant="caption" mono tone="muted">{reading.meterId}</Text>
          </Text>
          {reading.flags.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 6,
                backgroundColor: theme.colors.feedback.warningTint,
                padding: theme.spacing.sm,
                borderRadius: theme.radius.md,
              }}
            >
              <WarningCircle size={16} color={theme.colors.feedback.warning} weight="fill" />
              <View style={{ flex: 1 }}>
                <Text variant="caption" weight="semibold" tone="secondary">
                  Reading flagged
                </Text>
                {reading.flags.map((f) => (
                  <Text key={f} variant="caption" tone="secondary">· {f}</Text>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

function SlabBlock({
  slabs,
  totalMinor,
  unit,
}: {
  slabs: SlabRow[];
  totalMinor: number;
  unit: string;
}) {
  const theme = useTheme();
  return (
    <View>
      <SectionLabel>2 · Slab breakdown</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ gap: theme.spacing.sm }}>
          {slabs.map((s, i) => (
            <View key={i} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="body" weight="semibold" mono>
                  {formatSlabRange(s, unit)}
                </Text>
                <Text variant="body" weight="semibold" mono>
                  {formatMinor(s.chargeMinor)}
                </Text>
              </View>
              <Text variant="caption" tone="muted">
                {s.consumedInThisSlab.toLocaleString('en-IN')} {unit} ×{' '}
                {formatMinor(s.ratePerUnitMinor, 'INR', { showDecimals: true })}/unit
              </Text>
              {i < slabs.length - 1 ? (
                <View style={{ height: 1, backgroundColor: theme.colors.border.subtle }} />
              ) : null}
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: theme.colors.border.divider, marginTop: 4 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" weight="semibold">Subtotal (usage)</Text>
            <Money minor={totalMinor} variant="body" weight="semibold" tone="accent" />
          </View>
        </View>
      </Card>
    </View>
  );
}

function WaterBlendBlock({ blend }: { blend: WaterSourceBlend }) {
  const theme = useTheme();
  return (
    <View>
      <SectionLabel>3 · Water source blend</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ gap: theme.spacing.sm }}>
          {blend.sources.map((s) => (
            <View key={s.source} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body" tone="secondary">
                {sourceLabel(s.source)}
              </Text>
              <Text variant="body" weight="semibold" mono>
                {s.volumeKL.toLocaleString('en-IN')} kL · {formatMinor(s.costMinor)}
              </Text>
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: theme.colors.border.subtle }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" weight="semibold">Total pool</Text>
            <Text variant="body" weight="semibold" mono>
              {blend.totalVolumeKL.toLocaleString('en-IN')} kL · {formatMinor(blend.totalCostMinor)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" weight="semibold" tone="accent">Blended rate</Text>
            <Money minor={blend.blendedRatePerKLMinor} variant="body" weight="semibold" tone="accent" />
            <Text variant="caption" tone="muted"> per kL</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

function CommonAreaBlock({ share }: { share: CommonAreaShare }) {
  const theme = useTheme();
  const pct = (share.yourFactor * 100).toFixed(2);
  return (
    <View>
      <SectionLabel>{share ? 'Common-area share' : ''}</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
          <Buildings size={22} color={theme.colors.accent[700]} weight="duotone" />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">Common-area pool</Text>
            <Text variant="caption" tone="muted">Basis: {share.basis}</Text>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Total pool</Text>
            <Text variant="body" weight="semibold" mono>{formatMinor(share.totalCommonMinor)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Your factor</Text>
            <Text variant="body" weight="semibold" mono>{pct}%</Text>
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border.subtle, marginVertical: 4 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body" weight="semibold">Your share</Text>
            <Money minor={share.yourShareMinor} variant="body" weight="semibold" tone="accent" />
          </View>
        </View>
      </Card>
    </View>
  );
}

function ReconciliationBlock({ rec }: { rec: UtilityReconciliation }) {
  const theme = useTheme();
  const variancePositive = rec.varianceMinor > 0;
  return (
    <View>
      <SectionLabel>Reconciliation vs bulk invoice</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: theme.spacing.sm }}>
          <ScanSmiley size={22} color={theme.colors.accent[700]} weight="duotone" />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            The variance is published, not absorbed. Every flat sees the same number.
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Society aggregate</Text>
            <Text variant="body" weight="semibold" mono>{formatMinor(rec.societyTotalMinor)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Bulk invoice</Text>
            <Text variant="body" weight="semibold" mono>{formatMinor(rec.bulkInvoiceMinor)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" tone="muted">Variance</Text>
            <Text
              variant="body"
              weight="semibold"
              mono
              tone={variancePositive ? 'danger' : 'accent'}
            >
              {variancePositive ? '+' : ''}{formatMinor(rec.varianceMinor)} ({rec.variancePct.toFixed(2)}%)
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

function TotalBlock({ trace }: { trace: UtilityBillTrace }) {
  const theme = useTheme();
  return (
    <View>
      <SectionLabel>Your total</SectionLabel>
      <View
        style={{
          backgroundColor: theme.colors.accent[800],
          borderRadius: theme.radius.xxl,
          padding: theme.spacing.lg,
          gap: theme.spacing.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Info size={16} color="rgba(255,255,255,0.72)" weight="duotone" />
          <Text variant="caption" tone="onAccent" style={{ opacity: 0.72 }}>
            Usage subtotal + your common-area share
          </Text>
        </View>
        <Money
          minor={trace.totalMinor}
          currency={trace.currency}
          variant="display"
          weight="semibold"
          tone="onAccent"
        />
      </View>
    </View>
  );
}

function formatPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('en-IN', opts)} to ${end.toLocaleDateString('en-IN', { ...opts, year: 'numeric' })}`;
}

function formatSlabRange(s: SlabRow, unit: string): string {
  if (s.toUnits === null) return `${s.fromUnits}+ ${unit}`;
  return `${s.fromUnits}–${s.toUnits} ${unit}`;
}

function sourceLabel(src: 'MUNICIPAL' | 'TANKER' | 'BOREWELL'): string {
  switch (src) {
    case 'MUNICIPAL': return 'Municipal supply';
    case 'TANKER': return 'Tanker top-up';
    case 'BOREWELL': return 'Borewell';
  }
}
