import React from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Snowflake,
  Receipt,
  WarningDiamond,
  CheckCircle,
  ChatCircleDots,
} from 'phosphor-react-native';
import type { ChargeSheet, ChargeSheetLine } from '@sft/api-client';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Money } from '../../../src/components/Money';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../../src/components/ListState';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import { formatMinor } from '../../../src/lib/money';
import {
  useChargeSheet,
  useAcknowledgeChargeSheet,
  useDisputeChargeSheet,
} from '../../../src/hooks/useChargeSheet';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Charge sheet vs frozen card. FRONTEND_PLAN §5.F8: "charge sheet displayed
 * beside the frozen card with every out-of-card line flagged; acknowledge
 * or dispute". The resident's job here is to spot what the vendor added
 * beyond the terms they were engaged under, then accept or contest.
 */
export default function ChargeSheetScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useChargeSheet(id);
  const acknowledge = useAcknowledgeChargeSheet();
  const dispute = useDisputeChargeSheet();

  const onDispute = () => {
    if (!id) return;
    // A single-field reason prompt; a richer dispute composer is web's job.
    Alert.prompt?.(
      'Dispute this charge sheet',
      'Briefly, what are you contesting? The committee adjudicates with both documents.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit dispute',
          onPress: (reason?: string) => {
            if (!reason || reason.trim().length === 0) return;
            dispute.mutate(
              { bookingId: id, body: { reason: reason.trim() } },
              {
                onError: (err) =>
                  Alert.alert('Could not submit', (err as { message?: string } | null)?.message ?? 'Try again.'),
              },
            );
          },
        },
      ],
      'plain-text',
    );
    // Alert.prompt is iOS-only; on Android fall back to a straight dispute
    // with a generic reason so the flow still completes during dev.
    if (typeof Alert.prompt !== 'function') {
      dispute.mutate({ bookingId: id, body: { reason: 'Disputed from mobile' } });
    }
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
        {query.isLoading ? <ListLoading label="Loading charge sheet" /> : null}
        {query.isError ? (
          <ListError
            message={(query.error as { message?: string } | null)?.message ?? 'Could not load the charge sheet.'}
            onRetry={() => query.refetch()}
          />
        ) : null}
        {query.isSuccess && !query.data ? (
          <ListEmpty
            Icon={Receipt}
            title="No charge sheet yet"
            body="The vendor submits their itemised charges after the work is done. It'll appear here to review against the frozen card."
          />
        ) : null}

        {query.data ? (
          <ChargeSheetBody
            sheet={query.data}
            acking={acknowledge.isPending}
            disputing={dispute.isPending}
            onAcknowledge={() =>
              id &&
              acknowledge.mutate(id, {
                onError: (err) =>
                  Alert.alert('Could not acknowledge', (err as { message?: string } | null)?.message ?? 'Try again.'),
              })
            }
            onDispute={onDispute}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChargeSheetBody({
  sheet,
  acking,
  disputing,
  onAcknowledge,
  onDispute,
}: {
  sheet: ChargeSheet;
  acking: boolean;
  disputing: boolean;
  onAcknowledge: () => void;
  onDispute: () => void;
}) {
  const theme = useTheme();
  const outOfCard = sheet.lines.filter((l) => !l.withinCard);
  const variance = sheet.totalMinor - sheet.frozenCard.totalMinor;
  const settled = sheet.status === 'ACKNOWLEDGED' || sheet.status === 'SETTLED';
  const disputed = sheet.status === 'DISPUTED';

  return (
    <>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="overline" weight="semibold" tone="muted">Charge sheet · {sheet.vendorName}</Text>
        <Text variant="display" weight="semibold">Review charges</Text>
        <Text variant="body" tone="secondary">
          Submitted {new Date(sheet.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.
          Every line the vendor added beyond the frozen card is flagged.
        </Text>
      </View>

      {outOfCard.length > 0 ? (
        <View
          style={{
            backgroundColor: theme.colors.feedback.warningTint,
            borderRadius: theme.radius.xl,
            padding: theme.spacing.md,
            flexDirection: 'row',
            gap: theme.spacing.sm,
          }}
        >
          <WarningDiamond size={20} color={theme.colors.feedback.warning} weight="fill" />
          <Text variant="body" weight="semibold" tone="secondary" style={{ flex: 1 }}>
            {outOfCard.length} line{outOfCard.length === 1 ? '' : 's'} not on the frozen card.
            Check {outOfCard.length === 1 ? 'it' : 'them'} before you accept.
          </Text>
        </View>
      ) : null}

      <View>
        <SectionLabel>Charged</SectionLabel>
        <Card padded={theme.spacing.md}>
          <View style={{ gap: theme.spacing.sm }}>
            {sheet.lines.map((l) => (
              <ChargeLine key={l.id} line={l} currency={sheet.currency} />
            ))}
            <View style={{ height: 1, backgroundColor: theme.colors.border.divider, marginTop: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body" weight="semibold">Charge sheet total</Text>
              <Money minor={sheet.totalMinor} currency={sheet.currency} variant="body" weight="semibold" />
            </View>
          </View>
        </Card>
      </View>

      <View>
        <SectionLabel>Frozen card · {sheet.frozenCard.category} v{sheet.frozenCard.version}</SectionLabel>
        <Card padded={theme.spacing.md} surface="secondary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: theme.spacing.sm }}>
            <Snowflake size={16} color={theme.colors.feedback.info} weight="duotone" />
            <Text variant="caption" tone="muted">Terms the vendor was engaged under, frozen at confirmation.</Text>
          </View>
          <View style={{ gap: theme.spacing.xs }}>
            {sheet.frozenCard.lines.map((l) => (
              <View key={l.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" tone="secondary" style={{ flex: 1 }}>{l.label}</Text>
                <Text variant="caption" weight="semibold" mono tone="secondary">{formatMinor(l.amountMinor, sheet.currency)}</Text>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: theme.colors.border.subtle, marginVertical: 2 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" weight="semibold">Card total</Text>
              <Text variant="caption" weight="semibold" mono>{formatMinor(sheet.frozenCard.totalMinor, sheet.currency)}</Text>
            </View>
          </View>
        </Card>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.xs,
        }}
      >
        <Text variant="body" weight="semibold">Variance vs card</Text>
        <Text variant="body" weight="semibold" mono tone={variance > 0 ? 'danger' : 'accent'}>
          {variance > 0 ? '+' : ''}{formatMinor(variance, sheet.currency)}
        </Text>
      </View>

      {disputed ? (
        <StatusRow tone="danger" Icon={ChatCircleDots} text={`Disputed. ${sheet.disputeReason ?? 'Awaiting committee adjudication.'}`} />
      ) : settled ? (
        <StatusRow tone="success" Icon={CheckCircle} text="Acknowledged. Settlement proceeds under the approval ladder." />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={acking ? 'Acknowledging' : 'Acknowledge'}
            onPress={onAcknowledge}
            loading={acking}
            disabled={acking || disputing}
            fullWidth
          />
          <Button
            label="Dispute"
            variant="secondary"
            onPress={onDispute}
            disabled={acking || disputing}
            fullWidth
          />
        </View>
      )}
    </>
  );
}

function ChargeLine({ line, currency }: { line: ChargeSheetLine; currency: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: 2,
        ...(line.withinCard
          ? {}
          : {
              backgroundColor: theme.colors.feedback.warningTint,
              borderRadius: theme.radius.md,
              padding: theme.spacing.sm,
              marginHorizontal: -theme.spacing.xs,
            }),
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 }}>
          {!line.withinCard ? (
            <WarningDiamond size={14} color={theme.colors.feedback.warning} weight="fill" />
          ) : null}
          <Text variant="body" weight={line.withinCard ? 'regular' : 'semibold'}>{line.label}</Text>
        </View>
        <Money minor={line.amountMinor} currency={currency} variant="body" weight="semibold" />
      </View>
      {!line.withinCard ? (
        <Text variant="caption" tone="secondary">Not on the frozen card{line.note ? ` · ${line.note}` : ''}</Text>
      ) : line.cardLineLabel ? (
        <Text variant="caption" tone="muted">Matches card line: {line.cardLineLabel}</Text>
      ) : null}
    </View>
  );
}

function StatusRow({
  tone,
  Icon,
  text,
}: {
  tone: 'success' | 'danger';
  Icon: React.ComponentType<{ size?: number; color?: string; weight?: 'fill' }>;
  text: string;
}) {
  const theme = useTheme();
  const bg = tone === 'success' ? theme.colors.feedback.successTint : theme.colors.feedback.dangerTint;
  const color = tone === 'success' ? theme.colors.feedback.success : theme.colors.feedback.danger;
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Icon size={20} color={color} weight="fill" />
      <Text variant="body" weight="semibold" tone="secondary" style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}
