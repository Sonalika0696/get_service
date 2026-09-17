import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Handshake, CalendarBlank, Bell, Wrench } from '../icons/phosphor';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { SectionLabel } from '../components/SectionLabel';
import { DuesCard } from '../components/DuesCard';
import { StatTile } from '../components/StatTile';
import { RequestRow } from '../components/RequestRow';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../auth/AuthProvider';
import { useBillsHub } from '../hooks/useBills';
import { useTabs } from './TabsContext';
import type { BillKind } from '@sft/api-client';

function billKindLabel(kind: BillKind): string {
  switch (kind) {
    case 'MAINTENANCE': return 'Maintenance';
    case 'ELECTRICITY': return 'Electricity';
    case 'WATER': return 'Water';
    case 'BULK_BUY_SHARE': return 'Group buy';
    case 'EVENT_CHARGE': return 'Event';
    case 'ADJUSTMENT': return 'Adjustment';
  }
}

function formatDueOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Home. Backed by `GET /me/home` (FRONTEND_PLAN §3.2) once the aggregate
 * endpoint ships. Until then, greeting comes from the live /me identity
 * (F1) and the dues + stats + joinable-request cards render preview data
 * shaped like the aggregate will be.
 */
type GreetingKey = 'home.greeting.morning' | 'home.greeting.afternoon' | 'home.greeting.evening';

function greetingKey(): GreetingKey {
  const hour = new Date().getHours();
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

/**
 * Live greeting key: recomputes on a one-minute tick so the phrase actually
 * switches (morning → afternoon → evening) while the app stays open across a
 * boundary, instead of freezing at whatever it was when Home first mounted.
 * Translating the key (rather than caching the translated phrase) is what
 * makes the greeting also flip live when the app language changes.
 */
function useGreetingKey(): GreetingKey {
  const [key, setKey] = useState(greetingKey);
  useEffect(() => {
    const id = setInterval(() => {
      setKey((prev) => {
        const next = greetingKey();
        return next === prev ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return key;
}

const preview = {
  flat: { label: 'A-1204', society: 'Willow Grove' },
  amountMinor: 1245000,
  captions: ['Maintenance', 'Water', 'Group buy'],
  dueOn: '25 Sep',
  stats: {
    openRequests: '3',
    upcomingEvents: '2',
    unreadNotices: '5',
    workInFlat: '1',
  },
  joinable: [
    { id: 'r1', category: 'Plumbing', title: 'Kitchen tap leak, block A', participants: 2, thresholdAt: 4 },
    { id: 'r2', category: 'Pest control', title: 'Quarterly common-area treatment', participants: 27, thresholdAt: 30 },
  ],
};

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { me } = useAuth();
  const { goTo } = useTabs();
  const bills = useBillsHub();
  const hello = t(useGreetingKey());

  const firstName = me?.name?.trim().split(/\s+/)[0];

  // Dues on the home hero come from the real bills hub so the dashboard and
  // the Bills tab never disagree. Captions are the distinct bill kinds that
  // are actually due; empty until the aggregate has data.
  const dueLines = (bills.data?.lines ?? []).filter(
    (l) => l.status === 'DUE' || l.status === 'OVERDUE' || l.status === 'PARTIAL',
  );
  const totalDueMinor = bills.data?.totalDueMinor ?? 0;
  const captions = Array.from(new Set(dueLines.map((l) => billKindLabel(l.kind)))).slice(0, 3);
  const nextDueOn = dueLines
    .map((l) => l.dueOn)
    .sort()
    .find(Boolean);

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.xs }}>
        <Text variant="caption" tone="muted" weight="semibold">
          {preview.flat.society} · {preview.flat.label}
        </Text>
        <Text variant="display" weight="semibold" style={{ marginTop: 4 }}>
          {hello}{firstName ? `, ${firstName}` : ''}
        </Text>
      </View>

      <DuesCard
        amountMinor={totalDueMinor}
        dueOn={nextDueOn ? formatDueOn(nextDueOn) : null}
        captions={captions.length > 0 ? captions : ['Nothing due']}
        onPressPay={() => goTo('bills')}
        onPressHistory={() => goTo('bills')}
      />

      <View>
        <SectionLabel>{t('home.atAGlance')}</SectionLabel>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <StatTile
            Icon={Handshake}
            value={preview.stats.openRequests}
            label={t('home.stats.openRequests')}
            tone="accent"
            onPress={() => goTo('requests')}
          />
          <StatTile
            Icon={CalendarBlank}
            value={preview.stats.upcomingEvents}
            label={t('home.stats.upcomingEvents')}
            tone="info"
            onPress={() => router.push('/events')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <StatTile
            Icon={Bell}
            value={preview.stats.unreadNotices}
            label={t('home.stats.unreadNotices')}
            tone="warning"
            onPress={() => goTo('notices')}
          />
          <StatTile
            Icon={Wrench}
            value={preview.stats.workInFlat}
            label={t('home.stats.workInFlat')}
            tone="success"
          />
        </View>
      </View>

      <View>
        <SectionLabel
          trailing={
            <Text
              variant="body"
              weight="semibold"
              tone="accent"
              onPress={() => goTo('requests')}
            >
              {t('common.seeAll')}
            </Text>
          }
        >
          {t('home.neighboursAlsoNeed')}
        </SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          {preview.joinable.map((r) => (
            <RequestRow
              key={r.id}
              category={r.category}
              title={r.title}
              participants={r.participants}
              thresholdAt={r.thresholdAt}
              onPress={() => goTo('requests')}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}
