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
import { useHome } from '../hooks/useHome';
import { useTabs } from './TabsContext';

/**
 * Home. Backed by `GET /me/home` (FRONTEND_PLAN §3.2, shipped) via
 * useHome(): dues amount, overdue/actions counts and the joinable-requests
 * list all come from that one aggregate. Greeting still comes from the live
 * /me identity (F1). useHome() degrades to curated sample data when the
 * real call has nothing usable (see demoData.ts) — the "Sample data"
 * caption below the greeting is the tell.
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

/**
 * No identity field carries the flat/society label yet (MeResponse only has
 * societyId) — kept as a static placeholder until an identity aggregate
 * exposes it, rather than fabricating a fetch for it here.
 */
const FLAT_LABEL = { society: 'Willow Grove', flat: 'A-1204' };

/**
 * Dues-card chips summarising *why* something's due, built from the
 * aggregate's own flags since the home endpoint doesn't break dues down by
 * bill kind (Bills does that).
 */
function duesCaptions(overdueCount: number, actionsNeeded: number, amountDueMinor: number): string[] {
  if (amountDueMinor <= 0) return ['Nothing due'];
  const captions: string[] = [];
  if (overdueCount > 0) captions.push(`${overdueCount} overdue`);
  if (actionsNeeded > 0) captions.push(`${actionsNeeded} action${actionsNeeded > 1 ? 's' : ''} needed`);
  return captions.length > 0 ? captions : ['Due this cycle'];
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { me } = useAuth();
  const { goTo } = useTabs();
  const home = useHome();
  const hello = t(useGreetingKey());

  const firstName = me?.name?.trim().split(/\s+/)[0];

  const amountDueMinor = home.data?.amountDueMinor ?? 0;
  const overdueCount = home.data?.overdueCount ?? 0;
  const actionsNeeded = home.data?.actionsNeeded ?? 0;
  const joinable = home.data?.joinableServiceRequests ?? [];
  const upcomingEventsCount = home.data?.upcomingEvents.length ?? 0;

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.lg }}>
        <Text variant="caption" tone="muted" weight="semibold">
          {FLAT_LABEL.society} · {FLAT_LABEL.flat}
        </Text>
        <Text
          variant="display"
          weight="semibold"
          accessibilityRole="header"
          style={{ marginTop: 4 }}
        >
          {hello}{firstName ? `, ${firstName}` : ''}
        </Text>
        {home.isSample ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Sample data
          </Text>
        ) : null}
      </View>

      <DuesCard
        amountMinor={amountDueMinor}
        // The home aggregate doesn't carry a due date (Bills does, per
        // bill line) — no "Due by" line here rather than a fabricated one.
        dueOn={null}
        captions={duesCaptions(overdueCount, actionsNeeded, amountDueMinor)}
        onPressPay={() => goTo('bills')}
        onPressHistory={() => goTo('bills')}
      />

      <View>
        <SectionLabel>{t('home.atAGlance')}</SectionLabel>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <StatTile
            Icon={Handshake}
            value={String(joinable.length)}
            label={t('home.stats.openRequests')}
            tone="accent"
            onPress={() => goTo('requests')}
          />
          <StatTile
            Icon={CalendarBlank}
            value={String(upcomingEventsCount)}
            label={t('home.stats.upcomingEvents')}
            tone="info"
            onPress={() => router.push('/events')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <StatTile
            Icon={Bell}
            value={String(actionsNeeded)}
            label={t('home.stats.unreadNotices')}
            tone="warning"
            onPress={() => goTo('notices')}
          />
          <StatTile
            Icon={Wrench}
            value={String(overdueCount)}
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
              accessibilityRole="button"
              onPress={() => goTo('requests')}
            >
              {t('common.seeAll')}
            </Text>
          }
        >
          {t('home.neighboursAlsoNeed')}
        </SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          {joinable.slice(0, 3).map((r) => (
            <RequestRow
              key={r.id}
              category={titleCaseStatus(r.status)}
              title={r.title}
              participants={r.participantCount}
              thresholdAt={r.threshold ?? Math.max(r.participantCount, 1)}
              onPress={() => goTo('requests')}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}

/** `status` on a joinable request is a raw backend string (e.g. "OPEN") —
 * this is only ever used as the small overline label above the title. */
function titleCaseStatus(status: string): string {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}
