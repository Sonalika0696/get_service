import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Handshake, CalendarBlank, Bell, Wrench } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { SectionLabel } from '../../src/components/SectionLabel';
import { DuesCard } from '../../src/components/DuesCard';
import { StatTile } from '../../src/components/StatTile';
import { RequestRow } from '../../src/components/RequestRow';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Home. Backed by `GET /me/home` (FRONTEND_PLAN §3.2) once F1 lands the
 * auth handshake. For now, static preview data so the design system is
 * visible end-to-end — the same aggregate shape is used, so wiring it up
 * later is a hook swap, not a rewrite.
 */
const preview = {
  flat: { label: 'A-1204', society: 'Willow Grove' },
  greeting: 'Good morning, Priya',
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

  return (
    <Screen>
      <View style={{ marginTop: theme.spacing.xs }}>
        <Text variant="caption" tone="muted" weight="semibold">
          {preview.flat.society} · {preview.flat.label}
        </Text>
        <Text variant="display" weight="semibold" style={{ marginTop: 4 }}>
          {preview.greeting}
        </Text>
      </View>

      <DuesCard
        amountMinor={preview.amountMinor}
        dueOn={preview.dueOn}
        captions={preview.captions}
        onPressPay={() => router.push('/(tabs)/bills')}
        onPressHistory={() => router.push('/(tabs)/bills')}
      />

      <View>
        <SectionLabel>At a glance</SectionLabel>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <StatTile
            Icon={Handshake}
            value={preview.stats.openRequests}
            label="Open requests"
            tone="accent"
            onPress={() => router.push('/(tabs)/requests')}
          />
          <StatTile
            Icon={CalendarBlank}
            value={preview.stats.upcomingEvents}
            label="Upcoming events"
            tone="info"
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <StatTile
            Icon={Bell}
            value={preview.stats.unreadNotices}
            label="Unread notices"
            tone="warning"
            onPress={() => router.push('/(tabs)/notices')}
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
              onPress={() => router.push('/(tabs)/requests')}
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
              onPress={() => router.push('/(tabs)/requests')}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}
