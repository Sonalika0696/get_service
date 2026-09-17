import React, { useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PlusCircle, Handshake } from '../icons/phosphor';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { SectionLabel } from '../components/SectionLabel';
import { Segmented } from '../components/Segmented';
import { PollRow } from '../components/PollRow';
import { ListLoading, ListError, ListEmpty } from '../components/ListState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useResidentPolls } from '../hooks/useResidentPolls';
import { useAuth } from '../auth/AuthProvider';
import { useTheme } from '../theme/ThemeProvider';

type Segment = 'open' | 'mine';

/**
 * Requests tab — the core F4 loop. Two segments (Open / Mine) derived from
 * one list request. "Mine" shows the pools this resident *created* (matched
 * on creatorId), and each still-open one carries an inline Edit affordance.
 *
 * Virtualised via FlatList: the header (title, Segmented, SectionLabel)
 * scrolls with the list as ListHeaderComponent, rows only mount on-screen,
 * and an ItemSeparatorComponent recreates the old rows-container `gap` —
 * SectionLabel's own marginBottom already supplies the header-to-first-row
 * spacing, so contentContainerStyle carries no extra gap.
 */
export default function RequestsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { me } = useAuth();
  const [segment, setSegment] = useState<Segment>('open');

  const query = useResidentPolls();
  const polls = query.data ?? [];

  const visible = useMemo(() => {
    if (segment === 'mine') return polls.filter((p) => me && p.creatorId === me.id);
    return polls.filter((p) => p.status === 'OPEN');
  }, [polls, segment, me]);

  const emptyBody =
    segment === 'mine'
      ? "You haven't raised any pooled requests yet. Tap Raise to start one your neighbours can join."
      : 'Nothing open right now. Raise the first request — your neighbours will see it here.';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PollRow
            poll={item}
            onPress={() => router.push(`/requests/${item.id}`)}
            onEdit={
              segment === 'mine' && item.status === 'OPEN'
                ? () => router.push(`/requests/edit/${item.id}`)
                : undefined
            }
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg }}>
            <View>
              <Text variant="display" weight="semibold">Requests</Text>
              <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
                Pool with your neighbours. Better price, one visit.
              </Text>
            </View>

            <Segmented<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'mine', label: 'Mine' },
              ]}
            />

            <SectionLabel>
              {segment === 'open' ? 'Neighbours also need' : 'Requests you joined'}
            </SectionLabel>
          </View>
        }
        ListEmptyComponent={
          query.isLoading ? (
            <ListLoading label="Loading requests" />
          ) : query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'The feed is unreachable. Check your connection and try again.'
              }
              onRetry={() => query.refetch()}
            />
          ) : query.isSuccess && visible.length === 0 ? (
            <ListEmpty
              Icon={Handshake}
              illustration="requests"
              title={segment === 'mine' ? 'Nothing raised yet' : 'No open requests'}
              body={emptyBody}
              action={
                <Button
                  label="Raise a request"
                  variant="secondary"
                  onPress={() => router.push('/requests/new')}
                />
              }
            />
          ) : null
        }
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.hero + theme.spacing.md,
          paddingTop: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
      />
      <Fab
        label="Raise"
        icon={<PlusCircle size={20} color={theme.colors.ink.onAccent} weight="bold" />}
        onPress={() => router.push('/requests/new')}
      />
    </SafeAreaView>
  );
}
