import React, { useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { me } = useAuth();
  const [segment, setSegment] = useState<Segment>('open');

  const query = useResidentPolls();
  const polls = query.data ?? [];

  const visible = useMemo(() => {
    if (segment === 'mine') return polls.filter((p) => me && p.creatorId === me.id);
    return polls.filter((p) => p.status === 'OPEN');
  }, [polls, segment, me]);

  const emptyBody = segment === 'mine' ? t('requests.empty.mineBody') : t('requests.empty.openBody');

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
              <Text variant="display" weight="semibold" accessibilityRole="header">{t('requests.title')}</Text>
              <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
                {t('requests.subtitle')}
              </Text>
              {query.isSample ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                  Sample data
                </Text>
              ) : null}
            </View>

            <Segmented<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'open', label: t('requests.segment.open') },
                { value: 'mine', label: t('requests.segment.mine') },
              ]}
            />

            <SectionLabel>
              {segment === 'open' ? t('requests.sectionLabel.open') : t('requests.sectionLabel.mine')}
            </SectionLabel>
          </View>
        }
        ListEmptyComponent={
          query.isLoading ? (
            <ListLoading label={t('requests.loading')} />
          ) : query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                t('requests.errorFallback')
              }
              onRetry={() => query.refetch()}
            />
          ) : query.isSuccess && visible.length === 0 ? (
            <ListEmpty
              Icon={Handshake}
              illustration="requests"
              title={segment === 'mine' ? t('requests.empty.mineTitle') : t('requests.empty.openTitle')}
              body={emptyBody}
              action={
                <Button
                  label={t('requests.raiseButton')}
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
