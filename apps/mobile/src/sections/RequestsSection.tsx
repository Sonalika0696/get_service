import React, { useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PlusCircle, Handshake } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { SectionLabel } from '../components/SectionLabel';
import { Segmented } from '../components/Segmented';
import { PollRow } from '../components/PollRow';
import { ListLoading, ListError, ListEmpty } from '../components/ListState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useResidentPolls } from '../hooks/useResidentPolls';
import { useTheme } from '../theme/ThemeProvider';

type Segment = 'open' | 'mine';

/**
 * Requests tab — the core F4 loop. Two segments (Open / Mine) derived from
 * one list request; the "Mine" segment reads `hasJoined` off each poll
 * without a second round trip.
 */
export default function RequestsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('open');

  const query = useResidentPolls();
  const polls = query.data ?? [];

  const visible = useMemo(() => {
    if (segment === 'mine') return polls.filter((p) => p.hasJoined);
    return polls.filter((p) => p.status === 'OPEN');
  }, [polls, segment]);

  const emptyBody =
    segment === 'mine'
      ? "You haven't joined any pooled requests yet. Open one from the Open tab."
      : 'Nothing open right now. Raise the first request — your neighbours will see it here.';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.hero + theme.spacing.md,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
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

        <View>
          <SectionLabel>
            {segment === 'open' ? 'Neighbours also need' : 'Requests you joined'}
          </SectionLabel>

          {query.isLoading ? <ListLoading label="Loading requests" /> : null}

          {query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'The feed is unreachable. Check your connection and try again.'
              }
              onRetry={() => query.refetch()}
            />
          ) : null}

          {query.isSuccess && visible.length === 0 ? (
            <ListEmpty
              Icon={Handshake}
              illustration="requests"
              title={segment === 'mine' ? 'Nothing joined yet' : 'No open requests'}
              body={emptyBody}
              action={
                segment === 'open' ? (
                  <Button
                    label="Raise a request"
                    variant="secondary"
                    onPress={() => router.push('/requests/new')}
                  />
                ) : (
                  <Button
                    label="Browse open requests"
                    variant="secondary"
                    onPress={() => setSegment('open')}
                  />
                )
              }
            />
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {visible.map((p) => (
              <PollRow key={p.id} poll={p} onPress={() => router.push(`/requests/${p.id}`)} />
            ))}
          </View>
        </View>
      </ScrollView>
      <Fab
        label="Raise"
        icon={<PlusCircle size={20} color={theme.colors.ink.onAccent} weight="bold" />}
        onPress={() => router.push('/requests/new')}
      />
    </SafeAreaView>
  );
}
