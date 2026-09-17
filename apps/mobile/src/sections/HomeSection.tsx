import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Handshake, CalendarBlank, Bell, Wrench, Storefront } from 'phosphor-react-native';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { SectionLabel } from '../components/SectionLabel';
import { DuesCard } from '../components/DuesCard';
import { StatTile } from '../components/StatTile';
import { RequestRow } from '../components/RequestRow';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../auth/AuthProvider';
import { useTabs } from './TabsContext';

/**
 * Home. Backed by `GET /me/home` (FRONTEND_PLAN §3.2) once the aggregate
 * endpoint ships. Until then, greeting comes from the live /me identity
 * (F1) and the dues + stats + joinable-request cards render preview data
 * shaped like the aggregate will be.
 */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
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
  const { me } = useAuth();
  const { goTo } = useTabs();

  const firstName = me?.name?.trim().split(/\s+/)[0];

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.xs }}>
        <Text variant="caption" tone="muted" weight="semibold">
          {preview.flat.society} · {preview.flat.label}
        </Text>
        <Text variant="display" weight="semibold" style={{ marginTop: 4 }}>
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </Text>
      </View>

      <DuesCard
        amountMinor={preview.amountMinor}
        dueOn={preview.dueOn}
        captions={preview.captions}
        onPressPay={() => goTo('bills')}
        onPressHistory={() => goTo('bills')}
      />

      <View>
        <SectionLabel>At a glance</SectionLabel>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <StatTile
            Icon={Handshake}
            value={preview.stats.openRequests}
            label="Open requests"
            tone="accent"
            onPress={() => goTo('requests')}
          />
          <StatTile
            Icon={CalendarBlank}
            value={preview.stats.upcomingEvents}
            label="Upcoming events"
            tone="info"
            onPress={() => router.push('/events')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <StatTile
            Icon={Bell}
            value={preview.stats.unreadNotices}
            label="Unread notices"
            tone="warning"
            onPress={() => goTo('notices')}
          />
          <StatTile
            Icon={Wrench}
            value={preview.stats.workInFlat}
            label="Work in your flat"
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
              onPress={() => router.push('/vendors')}
            >
              Vendor directory
            </Text>
          }
        >
          Trusted vendors
        </SectionLabel>
        <StatTile
          Icon={Storefront}
          value="Browse"
          label="See all vendors your committee onboarded"
          tone="accent"
          onPress={() => router.push('/vendors')}
        />
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
              See all
            </Text>
          }
        >
          Neighbours also need
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
