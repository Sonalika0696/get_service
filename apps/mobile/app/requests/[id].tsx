import React from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Users,
  Clock,
  Storefront,
  CheckCircle,
  Handshake,
  SealCheck,
  Receipt,
  CaretRight,
} from '../../src/icons/phosphor';
import type { ResidentPollDetail } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionLabel } from '../../src/components/SectionLabel';
import { StatusPill } from '../../src/components/StatusPill';
import { ListLoading, ListError } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import {
  useResidentPoll,
  useJoinResidentPoll,
} from '../../src/hooks/useResidentPolls';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function RequestDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useResidentPoll(id);
  const join = useJoinResidentPoll();

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
        {query.isLoading ? <ListLoading label="Loading request" /> : null}
        {query.isError ? (
          <ListError
            message={
              (query.error as { message?: string } | null)?.message ??
              'Could not load this request.'
            }
            onRetry={() => query.refetch()}
          />
        ) : null}

        {query.data ? (
          <PollBody
            poll={query.data}
            joining={join.isPending}
            onJoin={() => {
              if (!id) return;
              join.mutate(id, {
                onError: (err) => {
                  const message =
                    (err as { message?: string } | null)?.message ??
                    'Could not join right now.';
                  Alert.alert('Could not join', message);
                },
              });
            }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PollBody({
  poll,
  joining,
  onJoin,
}: {
  poll: ResidentPollDetail;
  joining: boolean;
  onJoin: () => void;
}) {
  const theme = useTheme();
  const threshold = poll.vendorConfirmedMinimum ?? poll.minCommitments ?? 0;
  const progress = threshold > 0 ? Math.min(1, poll.commitmentCount / threshold) : 0;
  const reached = threshold > 0 && poll.commitmentCount >= threshold;
  const canJoin = poll.status === 'OPEN' && !poll.hasJoined;

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {poll.category ? (
            <Text variant="overline" weight="semibold" tone="accent">
              {poll.category}
            </Text>
          ) : null}
          <StatusPill status={poll.status} />
        </View>
        <Text variant="display" weight="semibold" accessibilityRole="header">{poll.title}</Text>
        {poll.description ? (
          <Text variant="body" tone="secondary">{poll.description}</Text>
        ) : null}
      </View>

      <Card padded={theme.spacing.lg}>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Users size={20} color={theme.colors.accent[700]} weight="duotone" />
            <Text variant="heading" weight="semibold" mono>
              {poll.commitmentCount}
              {threshold > 0 ? (
                <Text variant="heading" weight="regular" tone="muted"> / {threshold}</Text>
              ) : null}
            </Text>
            <Text variant="body" tone="secondary">joined</Text>
          </View>

          <View
            style={{
              height: 10,
              backgroundColor: theme.colors.bg.secondary,
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                backgroundColor: reached ? theme.colors.feedback.success : theme.colors.accent[700],
              }}
            />
          </View>

          <Text variant="caption" tone="secondary">
            {reached
              ? 'Threshold reached. The booking will fire once the vendor confirms.'
              : threshold > 0
                ? `${threshold - poll.commitmentCount} more neighbour${threshold - poll.commitmentCount === 1 ? '' : 's'} needed to fire this request.`
                : 'Waiting on the vendor to confirm the minimum headcount.'}
          </Text>
        </View>
      </Card>

      <View>
        <SectionLabel>Timeline</SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          <TimelineRow
            done
            label="Opened by a resident"
            when={new Date(poll.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short' })}
          />
          <TimelineRow
            done={Boolean(poll.vendorConfirmedAt)}
            label={
              poll.vendorConfirmedAt
                ? 'Vendor confirmed terms'
                : poll.vendorDeclinedAt
                  ? 'Vendor declined'
                  : 'Awaiting vendor confirmation'
            }
            when={
              poll.vendorConfirmedAt
                ? new Date(poll.vendorConfirmedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
                : poll.vendorDeclinedAt
                  ? new Date(poll.vendorDeclinedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
                  : undefined
            }
          />
          <TimelineRow
            done={reached}
            label="Threshold reached"
          />
          <TimelineRow
            done={Boolean(poll.firedAt)}
            label={poll.firedAt ? 'Booking fired' : 'Booking will fire'}
            when={
              poll.firedAt
                ? new Date(poll.firedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
                : undefined
            }
          />
        </View>
      </View>

      {poll.taggedVendorId ? (
        <TaggedVendor
          vendorId={poll.taggedVendorId}
          confirmed={Boolean(poll.vendorConfirmedAt)}
        />
      ) : null}

      {poll.bookingId ? <ChargeSheetLink bookingId={poll.bookingId} /> : null}

      {canJoin ? (
        <Button
          label={joining ? 'Joining' : 'I need this too'}
          onPress={onJoin}
          disabled={joining}
          loading={joining}
          leftIcon={!joining ? <Handshake size={18} color="#fff" weight="fill" /> : undefined}
          fullWidth
        />
      ) : poll.hasJoined ? (
        <View
          style={{
            backgroundColor: theme.colors.feedback.successTint,
            borderRadius: theme.radius.pill,
            paddingVertical: 12,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <CheckCircle size={18} color={theme.colors.feedback.success} weight="fill" />
          <Text variant="body" weight="semibold" tone="secondary">You're in</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Clock size={14} color={theme.colors.ink[60]} weight="duotone" />
        <Text variant="caption" tone="muted">
          {poll.status === 'OPEN'
            ? `Closes ${new Date(poll.closesAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : `Closed`}
        </Text>
      </View>
    </>
  );
}

function ChargeSheetLink({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View>
      <SectionLabel>After the work</SectionLabel>
      <View
        accessible
        accessibilityRole="button"
        onTouchEnd={() => router.push(`/bookings/${bookingId}/charge-sheet` as never)}
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
        <Receipt size={22} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">Charge sheet</Text>
          <Text variant="caption" tone="muted">
            Review the vendor's charges against the frozen card
          </Text>
        </View>
        <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </View>
  );
}

function TaggedVendor({ vendorId, confirmed }: { vendorId: string; confirmed: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View>
      <SectionLabel>Tagged vendor</SectionLabel>
      <Button
        label="Open vendor profile"
        variant="secondary"
        leftIcon={<Storefront size={18} color={theme.colors.accent[700]} weight="duotone" />}
        rightIcon={
          confirmed ? (
            <SealCheck size={14} color={theme.colors.feedback.info} weight="fill" />
          ) : undefined
        }
        onPress={() => router.push(`/vendors/${vendorId}`)}
        fullWidth
      />
    </View>
  );
}

function TimelineRow({
  done,
  label,
  when,
}: {
  done: boolean;
  label: string;
  when?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: done ? theme.colors.accent[700] : theme.colors.border.divider,
          backgroundColor: done ? theme.colors.accent[700] : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {done ? <CheckCircle size={12} color="#fff" weight="fill" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight={done ? 'semibold' : 'regular'} tone={done ? 'primary' : 'muted'}>
          {label}
        </Text>
      </View>
      {when ? <Text variant="caption" tone="muted">{when}</Text> : null}
    </View>
  );
}
