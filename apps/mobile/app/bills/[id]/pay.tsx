import React, { useMemo, useState } from 'react';
import { View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  ShieldCheck,
  Warning,
  CheckCircle,
  Info,
} from 'phosphor-react-native';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Money } from '../../../src/components/Money';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { RailBadge } from '../../../src/components/RailBadge';
import { ListLoading, ListError } from '../../../src/components/ListState';
import { OfflineBanner } from '../../../src/components/OfflineBanner';
import {
  useBillLine,
  useCreatePaymentOrder,
  makeIdempotencyKey,
} from '../../../src/hooks/useBills';
import { minorToMajor } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme/ThemeProvider';

type Phase =
  | { kind: 'idle' }
  | { kind: 'ordering' }
  | { kind: 'awaiting-webhook'; orderId: string }
  | { kind: 'failed'; message: string };

/**
 * Pay sheet. Two-step:
 *   1) POST /payments/orders — backend creates a Razorpay order + a CREATED
 *      Payment row. Idempotency-Key header guards against double-tap.
 *   2) The resident settles on Razorpay's checkout (opened out-of-app in
 *      F5; a WebView + `expo-linking` return trip lands in F9's polish).
 *      Meanwhile the webhook is the sole ledger-writer — so this screen
 *      polls GET /payments/:id for CAPTURED and surfaces the terminal state.
 */
export default function PaySheet() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { line, isLoading, isError, error } = useBillLine(id);
  const createOrder = useCreatePaymentOrder();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const idempotencyKey = useMemo(() => (id ? makeIdempotencyKey(id) : ''), [id]);

  const start = () => {
    if (!line || !id) return;
    setPhase({ kind: 'ordering' });
    createOrder.mutate(
      {
        body: { amount: minorToMajor(line.amountMinor), purpose: line.title },
        idempotencyKey,
      },
      {
        onSuccess: (r) => setPhase({ kind: 'awaiting-webhook', orderId: r.orderId }),
        onError: (err) => {
          const message =
            (err as { message?: string } | null)?.message ??
            'Could not create a payment order.';
          setPhase({ kind: 'failed', message });
          Alert.alert('Payment did not start', message);
        },
      },
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <OfflineBanner />

      <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
        <Button
          label="Cancel"
          variant="ghost"
          leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
          onPress={() => router.back()}
        />
      </View>

      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.lg,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ gap: theme.spacing.lg }}>
          {isLoading ? <ListLoading label="Loading bill" /> : null}
          {isError ? (
            <ListError
              message={(error as { message?: string } | null)?.message ?? 'Could not load bill.'}
              onRetry={() => undefined}
            />
          ) : null}

          {line ? (
            <>
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="overline" weight="semibold" tone="muted">You are paying</Text>
                <Text variant="heading" weight="semibold">{line.title}</Text>
                <RailBadge rail={line.rail} />
              </View>

              <Card padded={theme.spacing.lg}>
                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="caption" tone="muted">Amount</Text>
                  <Money
                    minor={line.amountMinor}
                    variant="display"
                    weight="semibold"
                    tone="accent"
                  />
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <Info size={14} color={theme.colors.ink[60]} weight="duotone" />
                    <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                      {line.basis}
                    </Text>
                  </View>
                </View>
              </Card>

              <PaymentStatusBlock phase={phase} />
            </>
          ) : null}
        </View>

        {line ? (
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={14} color={theme.colors.accent[700]} weight="duotone" />
              <Text variant="caption" tone="muted">
                Razorpay-secured. The society, not this app, receives the funds.
              </Text>
            </View>
            {phase.kind === 'awaiting-webhook' ? (
              <Button
                label="Back to bills"
                variant="secondary"
                onPress={() => router.replace('/(tabs)?tab=bills')}
                fullWidth
              />
            ) : (
              <Button
                label={phase.kind === 'ordering' ? 'Opening payment' : 'Pay via UPI'}
                onPress={start}
                loading={phase.kind === 'ordering'}
                disabled={phase.kind === 'ordering'}
                fullWidth
              />
            )}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function PaymentStatusBlock({ phase }: { phase: Phase }) {
  const theme = useTheme();

  if (phase.kind === 'idle' || phase.kind === 'ordering') return null;

  if (phase.kind === 'awaiting-webhook') {
    return (
      <Card padded={theme.spacing.lg}>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CheckCircle size={20} color={theme.colors.feedback.success} weight="fill" />
            <Text variant="body" weight="semibold">Order created</Text>
          </View>
          <Text variant="caption" tone="secondary" mono>
            {phase.orderId}
          </Text>
          <Text variant="body" tone="secondary">
            Complete the UPI collect on Razorpay. This bill clears the moment the confirmation lands.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card padded={theme.spacing.lg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Warning size={20} color={theme.colors.feedback.warning} weight="regular" />
        <Text variant="body" weight="semibold" tone="danger">Payment did not start</Text>
      </View>
      <Text variant="caption" tone="secondary" style={{ marginTop: 6 }}>
        {phase.message}
      </Text>
    </Card>
  );
}
