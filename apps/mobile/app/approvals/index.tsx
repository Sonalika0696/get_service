import React, { useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck, ClipboardText } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { Segmented } from '../../src/components/Segmented';
import { ApprovalRow } from '../../src/components/ApprovalRow';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useApprovals, useIsCommittee } from '../../src/hooks/useApprovals';
import { useTheme } from '../../src/theme/ThemeProvider';

type Segment = 'awaiting-me' | 'all';

/**
 * Committee approvals inbox. FRONTEND_PLAN §5.F6 is deliberate about scope:
 * "the one admin surface on mobile. Read the instruction, see the amount
 * and counterparty, approve or decline. Nothing data-dense." So this list
 * is minimal — the ledger, reconciliation, ratification queue live on web.
 */
export default function ApprovalsInbox() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isCommittee = useIsCommittee();
  const [segment, setSegment] = useState<Segment>('awaiting-me');

  const query = useApprovals();
  const items = query.data?.items ?? [];

  const visible = useMemo(() => {
    if (segment === 'awaiting-me') return items.filter((i) => !i.currentUserApproved);
    return items;
  }, [items, segment]);

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
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={20} color={theme.colors.accent[700]} weight="duotone" />
            <Text variant="overline" weight="semibold" tone="muted">Committee</Text>
          </View>
          <Text variant="display" weight="semibold">Approvals</Text>
          <Text variant="body" tone="secondary">
            Payouts, milestones, flat claims, corpus movements. Every sign-off leaves an audit trail.
          </Text>
        </View>

        {!isCommittee ? (
          <ListEmpty
            Icon={ClipboardText}
            title="Not on the committee"
            body="This inbox only shows for committee members. If that's a mistake, ask another officer to fix your role."
          />
        ) : (
          <>
            <Segmented<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'awaiting-me', label: 'Awaiting you' },
                { value: 'all', label: 'All open' },
              ]}
            />

            <View>
              <SectionLabel>
                {segment === 'awaiting-me' ? 'Awaiting your signature' : 'All open items'}
              </SectionLabel>

              {query.isLoading ? <ListLoading label="Loading approvals" /> : null}

              {query.isError ? (
                <ListError
                  message={
                    (query.error as { message?: string } | null)?.message ??
                    'The inbox is unreachable right now.'
                  }
                  onRetry={() => query.refetch()}
                />
              ) : null}

              {query.isSuccess && visible.length === 0 ? (
                <ListEmpty
                  Icon={ShieldCheck}
                  illustration="approvals"
                  title={segment === 'awaiting-me' ? 'Nothing waiting on you' : 'Nothing open'}
                  body={
                    segment === 'awaiting-me'
                      ? "You're caught up. New items appear here as soon as they're raised."
                      : 'When a payout or milestone is raised for authorisation, it lands here.'
                  }
                />
              ) : null}

              <View style={{ gap: theme.spacing.sm }}>
                {visible.map((i) => (
                  <ApprovalRow
                    key={i.id}
                    item={i}
                    onPress={() => router.push(`/approvals/${i.id}` as never)}
                  />
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
