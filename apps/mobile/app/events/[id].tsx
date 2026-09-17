import React from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarBlank,
  Users,
  Clock,
  ArrowClockwise,
  Tag,
  CheckCircle,
  Hourglass,
} from 'phosphor-react-native';
import type { EventDetail } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Money } from '../../src/components/Money';
import { SectionLabel } from '../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useEvent, useOptInEvent } from '../../src/hooks/useEvents';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function EventDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useEvent(id);
  const optIn = useOptInEvent();

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
        {query.isLoading ? <ListLoading label="Loading event" /> : null}
        {query.isError ? (
          <ListError
            message={(query.error as { message?: string } | null)?.message ?? 'Could not load this event.'}
            onRetry={() => query.refetch()}
          />
        ) : null}
        {query.isSuccess && !query.data ? (
          <ListEmpty
            Icon={CalendarBlank}
            title="Event not found"
            body="It may have been cancelled or closed. Head back to the events list."
            action={<Button label="Back to events" variant="secondary" onPress={() => router.back()} />}
          />
        ) : null}

        {query.data ? (
          <EventBody
            event={query.data}
            pending={optIn.isPending}
            onOptIn={() => {
              if (!id) return;
              optIn.mutate(id, {
                onError: (err) =>
                  Alert.alert(
                    'Could not opt in',
                    (err as { message?: string } | null)?.message ?? 'Please try again.',
                  ),
              });
            }}
            onPay={() => router.push('/(tabs)?tab=bills')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function EventBody({
  event,
  pending,
  onOptIn,
  onPay,
}: {
  event: EventDetail;
  pending: boolean;
  onOptIn: () => void;
  onPay: () => void;
}) {
  const theme = useTheme();
  const starts = new Date(event.startsAt);
  const full = event.capacity !== null && event.optedInCount >= event.capacity;

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CalendarBlank size={28} color={theme.colors.accent[700]} weight="duotone" />
        </View>
        <Text variant="display" weight="semibold">{event.title}</Text>
        {event.description ? (
          <Text variant="body" tone="secondary">{event.description}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Clock size={14} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="muted">
            {starts.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            {', '}
            {starts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>

      <Card padded={theme.spacing.lg}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ gap: 2 }}>
            <Text variant="caption" tone="muted">Per-flat charge</Text>
            <Money minor={event.perFlatMinor} currency={event.currency} variant="heading" weight="semibold" tone="accent" />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Users size={14} color={theme.colors.ink[60]} weight="duotone" />
              <Text variant="body" weight="semibold" mono>
                {event.optedInCount}{event.capacity !== null ? ` / ${event.capacity}` : ''}
              </Text>
            </View>
            <Text variant="caption" tone="muted">opted in</Text>
            {event.waitlistCount > 0 ? (
              <Text variant="caption" tone="muted">{event.waitlistCount} on waitlist</Text>
            ) : null}
          </View>
        </View>
      </Card>

      {event.concessions.length > 0 ? (
        <View>
          <SectionLabel>Concessions</SectionLabel>
          <Card padded={theme.spacing.md}>
            <View style={{ gap: theme.spacing.sm }}>
              {event.concessions.map((c) => (
                <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Tag size={16} color={theme.colors.accent[700]} weight="duotone" />
                  <Text variant="body" tone="secondary" style={{ flex: 1 }}>{c.label}</Text>
                  <Text variant="body" weight="semibold" mono tone="accent">
                    -{'₹'}{(c.amountOffMinor / 100).toFixed(0)}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {event.refundPolicy ? (
        <View>
          <SectionLabel>Refund policy</SectionLabel>
          <View
            style={{
              backgroundColor: theme.colors.bg.secondary,
              borderRadius: theme.radius.xl,
              padding: theme.spacing.md,
              flexDirection: 'row',
              gap: theme.spacing.sm,
            }}
          >
            <ArrowClockwise size={20} color={theme.colors.ink[80]} weight="duotone" />
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="semibold">{event.refundPolicy.label}</Text>
              <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {event.refundPolicy.detail}
              </Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                Fixed when the event was created. It won't change after you opt in.
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      <OptInAction event={event} full={full} pending={pending} onOptIn={onOptIn} onPay={onPay} />
    </>
  );
}

function OptInAction({
  event,
  full,
  pending,
  onOptIn,
  onPay,
}: {
  event: EventDetail;
  full: boolean;
  pending: boolean;
  onOptIn: () => void;
  onPay: () => void;
}) {
  const theme = useTheme();
  const optIn = event.myOptIn;

  if (optIn.state === 'OPTED_IN') {
    if (!optIn.paid) {
      return (
        <View style={{ gap: theme.spacing.sm }}>
          <StatusBanner
            tone="warning"
            Icon={CheckCircle}
            text="You're opted in. Pay the charge to confirm your place."
          />
          <Button label="Pay the charge" onPress={onPay} fullWidth />
        </View>
      );
    }
    return (
      <StatusBanner tone="success" Icon={CheckCircle} text="You're going. Charge paid." />
    );
  }

  if (optIn.state === 'WAITLISTED') {
    return (
      <StatusBanner
        tone="warning"
        Icon={Hourglass}
        text={`You're #${optIn.position} on the waitlist. We'll move you up automatically if a place opens.`}
      />
    );
  }

  return (
    <Button
      label={pending ? 'Opting in' : full ? 'Join the waitlist' : 'Opt in'}
      onPress={onOptIn}
      loading={pending}
      disabled={pending || event.status === 'CLOSED' || event.status === 'CANCELLED'}
      fullWidth
    />
  );
}

function StatusBanner({
  tone,
  Icon,
  text,
}: {
  tone: 'success' | 'warning';
  Icon: React.ComponentType<{ size?: number; color?: string; weight?: 'fill' }>;
  text: string;
}) {
  const theme = useTheme();
  const bg = tone === 'success' ? theme.colors.feedback.successTint : theme.colors.feedback.warningTint;
  const color = tone === 'success' ? theme.colors.feedback.success : theme.colors.feedback.warning;
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
