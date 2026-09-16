import React, { useMemo } from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Info,
  CheckCircle,
  Circle,
  User as UserIcon,
  CalendarBlank,
  ShieldCheck,
} from 'phosphor-react-native';
import type { ApprovalItem } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Money } from '../../src/components/Money';
import { SectionLabel } from '../../src/components/SectionLabel';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import {
  useApprovals,
  useAuthoriseApproval,
} from '../../src/hooks/useApprovals';
import { kindIcon, kindLabel } from '../../src/components/ApprovalRow';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Approval detail. Deliberately terse: read the instruction, see the amount
 * and counterparty, tap Approve. Decline UX ("with reason") is a web-only
 * concern per FRONTEND_PLAN F6 — mobile approvers ping the committee chat
 * out-of-band if they want to block something.
 */
export default function ApprovalDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApprovals();
  const authorise = useAuthoriseApproval();

  const item = useMemo(
    () => query.data?.items.find((i) => i.id === id),
    [query.data, id],
  );

  const onApprove = async () => {
    if (!item) return;
    Alert.alert(
      'Sign off?',
      `Once signed, your identity is written to the audit chain and cannot be withdrawn.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign off',
          style: 'default',
          onPress: async () => {
            try {
              await authorise.authorise(item);
              router.back();
            } catch (err) {
              const message =
                (err as { message?: string } | null)?.message ??
                'Could not authorise. Please try again.';
              Alert.alert('Could not authorise', message);
            }
          },
        },
      ],
    );
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
        {query.isLoading ? <ListLoading label="Loading approval" /> : null}
        {query.isError ? (
          <ListError
            message={
              (query.error as { message?: string } | null)?.message ?? 'Could not load approvals.'
            }
            onRetry={() => query.refetch()}
          />
        ) : null}

        {query.isSuccess && !item ? (
          <ListEmpty
            Icon={ShieldCheck}
            title="Approval not found"
            body="Someone may have signed off already, or the item was closed. Try refreshing the inbox."
            action={<Button label="Back to inbox" variant="secondary" onPress={() => router.back()} />}
          />
        ) : null}

        {item ? (
          <>
            <ApprovalHeader item={item} />
            <BasisCard item={item} />
            <LadderCard item={item} />
            <ActionButton
              item={item}
              disabled={item.currentUserApproved || authorise.isPending}
              loading={authorise.isPending}
              onPress={onApprove}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ApprovalHeader({ item }: { item: ApprovalItem }) {
  const theme = useTheme();
  const Icon = kindIcon(item.kind);

  return (
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
        <Icon size={28} color={theme.colors.accent[700]} weight="duotone" />
      </View>
      <Text variant="overline" weight="semibold" tone="muted">
        {kindLabel(item.kind)} · for {roleLabel(item.requiresRole)}
      </Text>
      <Text variant="display" weight="semibold">{item.title}</Text>
      {item.amountMinor !== null ? (
        <Money
          minor={item.amountMinor}
          currency={item.currency}
          variant="display"
          weight="semibold"
          tone="accent"
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <UserIcon size={14} color={theme.colors.ink[60]} weight="duotone" />
        <Text variant="caption" tone="secondary">{item.counterparty}</Text>
      </View>
      {item.dueOn ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <CalendarBlank size={14} color={theme.colors.ink[60]} weight="duotone" />
          <Text variant="caption" tone="muted">
            Due {new Date(item.dueOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function BasisCard({ item }: { item: ApprovalItem }) {
  const theme = useTheme();
  return (
    <Card padded={theme.spacing.lg}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Info size={20} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="body" weight="semibold">Why you're signing this</Text>
          <Text variant="body" tone="secondary">{item.basis}</Text>
        </View>
      </View>
    </Card>
  );
}

function LadderCard({ item }: { item: ApprovalItem }) {
  const theme = useTheme();
  const slots = Array.from({ length: Math.max(1, item.requiredApprovers) }, (_, i) => ({
    filled: i < item.collectedApprovers,
    isYou: item.currentUserApproved && i === item.collectedApprovers - 1,
  }));

  return (
    <View>
      <SectionLabel>Approval ladder</SectionLabel>
      <Card padded={theme.spacing.md}>
        <View style={{ gap: theme.spacing.sm }}>
          {slots.map((s, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
            >
              {s.filled ? (
                <CheckCircle size={20} color={theme.colors.accent[700]} weight="fill" />
              ) : (
                <Circle size={20} color={theme.colors.ink[40]} weight="regular" />
              )}
              <Text variant="body" weight={s.filled ? 'semibold' : 'regular'} tone={s.filled ? 'primary' : 'muted'}>
                Approver {i + 1} of {item.requiredApprovers}
                {s.isYou ? ' · you' : ''}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

function ActionButton({
  item,
  disabled,
  loading,
  onPress,
}: {
  item: ApprovalItem;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  if (item.currentUserApproved) {
    return (
      <View
        style={{
          backgroundColor: theme.colors.feedback.successTint,
          borderRadius: theme.radius.pill,
          paddingVertical: 14,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <CheckCircle size={18} color={theme.colors.feedback.success} weight="fill" />
        <Text variant="body" weight="semibold" tone="secondary">
          You signed this
        </Text>
      </View>
    );
  }

  return (
    <Button
      label={loading ? 'Signing' : 'Sign off'}
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      leftIcon={!loading ? <ShieldCheck size={18} color="#fff" weight="fill" /> : undefined}
      fullWidth
    />
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'TREASURER': return 'treasurer';
    case 'DEPUTY_TREASURER': return 'deputy treasurer';
    case 'COMMITTEE': return 'committee';
    default: return role.toLowerCase();
  }
}
