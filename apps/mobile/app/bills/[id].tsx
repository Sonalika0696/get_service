import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CaretRight, FileText, Info } from '../../src/icons/phosphor';
import type { EvidenceRef } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Money } from '../../src/components/Money';
import { SectionLabel } from '../../src/components/SectionLabel';
import { RailBadge } from '../../src/components/RailBadge';
import { ListLoading, ListError } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useBillLine } from '../../src/hooks/useBills';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Bill detail. Job here is trust: show the exact number, why it exists, and
 * a way to open the underlying evidence (the poll, the reading, the frozen
 * card). Payment moves to /bills/:id/pay so this screen stays inspectable
 * for already-paid lines too.
 */
export default function BillDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { line, isLoading, isError, error } = useBillLine(id);

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
        {isLoading ? <ListLoading label="Loading bill" /> : null}
        {isError ? (
          <ListError
            message={(error as { message?: string } | null)?.message ?? 'Could not load this bill.'}
            onRetry={() => undefined}
          />
        ) : null}

        {line ? (
          <>
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <RailBadge rail={line.rail} />
                {line.status === 'PAID' ? (
                  <Text variant="caption" weight="semibold" tone="accent">Paid</Text>
                ) : line.status === 'OVERDUE' ? (
                  <Text variant="caption" weight="semibold" tone="danger">Overdue</Text>
                ) : null}
              </View>
              <Text variant="display" weight="semibold" accessibilityRole="header">{line.title}</Text>
              <Money
                minor={line.amountMinor}
                currency={line.currency}
                variant="display"
                weight="semibold"
                tone="accent"
              />
              <Text variant="caption" tone="muted">
                Due {new Date(line.dueOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>

            <Card padded={theme.spacing.lg}>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Info size={20} color={theme.colors.accent[700]} weight="duotone" />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="body" weight="semibold">Why this amount</Text>
                  <Text variant="body" tone="secondary">{line.basis}</Text>
                </View>
              </View>
            </Card>

            {line.kind === 'ELECTRICITY' || line.kind === 'WATER' ? (
              <TraceLink billId={line.id} kind={line.kind} />
            ) : line.evidence ? (
              <EvidenceLink evidence={line.evidence} />
            ) : null}

            {line.status !== 'PAID' ? (
              <Button
                label="Pay this bill"
                onPress={() => router.push(`/bills/${line.id}/pay`)}
                fullWidth
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TraceLink({ billId, kind }: { billId: string; kind: 'ELECTRICITY' | 'WATER' }) {
  const theme = useTheme();
  const router = useRouter();
  const label = kind === 'ELECTRICITY' ? 'Electricity computation trace' : 'Water computation trace';
  return (
    <View>
      <SectionLabel>Computation trace</SectionLabel>
      <View
        accessible
        accessibilityRole="button"
        onTouchEnd={() => router.push(`/bills/${billId}/trace` as never)}
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
          padding: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <FileText size={22} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">{label}</Text>
          <Text variant="caption" tone="muted">
            Meter reading, slab, common-area share, reconciliation
          </Text>
        </View>
        <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </View>
  );
}

function EvidenceLink({ evidence }: { evidence: EvidenceRef }) {
  const theme = useTheme();
  const router = useRouter();

  const { label, hint, href } = describeEvidence(evidence);

  return (
    <View>
      <SectionLabel>Evidence</SectionLabel>
      <View
        accessible={Boolean(href)}
        accessibilityRole={href ? 'button' : undefined}
        onTouchEnd={href ? () => router.push(href as never) : undefined}
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
          padding: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <FileText size={22} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">{label}</Text>
          <Text variant="caption" tone="muted">{hint}</Text>
        </View>
        {href ? <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" /> : null}
      </View>
    </View>
  );
}

function describeEvidence(e: EvidenceRef): { label: string; hint: string; href?: string } {
  switch (e.kind) {
    case 'POLL':
      return {
        label: 'Pooled request',
        hint: 'Open the poll that produced this share',
        href: `/requests/${e.pollId}` as string,
      };
    case 'METER_READING':
      return { label: 'Meter reading', hint: 'Open the reading and slab this bill was computed from' };
    case 'EVENT':
      return { label: 'Event', hint: 'Open the event page' };
    case 'FROZEN_CARD':
      return { label: 'Frozen pricing card', hint: 'Terms the vendor was engaged under' };
    case 'BOOKING':
      return { label: 'Booking', hint: 'The booking and its job cards' };
    case 'JOURNAL':
      return { label: 'Ledger entry', hint: 'Direct link to the journal row' };
  }
}
