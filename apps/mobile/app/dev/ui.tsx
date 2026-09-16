import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Sparkle, CheckCircle, WarningCircle } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionLabel } from '../../src/components/SectionLabel';
import { DuesCard } from '../../src/components/DuesCard';
import { StatTile } from '../../src/components/StatTile';
import { RequestRow } from '../../src/components/RequestRow';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * /dev/ui — the token-verification playground FRONTEND_PLAN F0 asks for.
 * Every primitive and every colour token renders here, on both mobile and
 * web builds, so a token change is visually acceptance-tested.
 */
export default function UIPlayground() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <Button
            label="Back"
            variant="ghost"
            leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
            onPress={() => router.back()}
          />
        </View>

        <View>
          <Text variant="overline" weight="semibold" tone="muted">
            Design system
          </Text>
          <Text variant="display" weight="semibold">Playground</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Every primitive that the resident app is built from.
          </Text>
        </View>

        <View>
          <SectionLabel>Colour · accent scale</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['50','100','200','300','400','500','600','700','800','900'] as const).map((k) => (
              <View
                key={k}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent[k],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="caption" weight="semibold" tone={Number(k) >= 500 ? 'onAccent' : 'primary'}>
                  {k}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View>
          <SectionLabel>Colour · ink</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['100','80','60','40','20'] as const).map((k) => (
              <View
                key={k}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.ink[k],
                }}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionLabel>Typography</SectionLabel>
          <Card>
            <Text variant="display" weight="semibold">Display 32/38</Text>
            <Text variant="heading" weight="semibold">Heading 22/28</Text>
            <Text variant="body">Body 16/24 — the workhorse.</Text>
            <Text variant="caption" tone="muted">Caption 13/18</Text>
            <Text variant="overline" weight="semibold" tone="muted">Overline 12/16</Text>
            <Text variant="body" mono weight="semibold">Mono 16/24 · ₹12,450.00</Text>
          </Card>
        </View>

        <View>
          <SectionLabel>Buttons</SectionLabel>
          <View style={{ gap: theme.spacing.sm }}>
            <Button label="Primary" onPress={() => undefined} fullWidth
              leftIcon={<Sparkle size={16} color="#fff" weight="fill" />} />
            <Button label="Secondary" variant="secondary" onPress={() => undefined} fullWidth />
            <Button label="Ghost" variant="ghost" onPress={() => undefined} fullWidth />
            <Button label="Destructive" variant="danger" onPress={() => undefined} fullWidth />
            <Button label="Loading" loading onPress={() => undefined} fullWidth />
            <Button label="Disabled" disabled onPress={() => undefined} fullWidth />
          </View>
        </View>

        <View>
          <SectionLabel>Cards · elevation</SectionLabel>
          <View style={{ gap: theme.spacing.sm }}>
            <Card elevation="sm"><Text variant="body">Elevation sm</Text></Card>
            <Card elevation="md"><Text variant="body">Elevation md (default)</Text></Card>
            <Card elevation="lg"><Text variant="body">Elevation lg</Text></Card>
          </View>
        </View>

        <View>
          <SectionLabel>Hero dues card</SectionLabel>
          <DuesCard
            amountMinor={1245000}
            dueOn="25 Sep"
            captions={['Maintenance', 'Water', 'Group buy']}
            onPressPay={() => undefined}
            onPressHistory={() => undefined}
          />
        </View>

        <View>
          <SectionLabel>Stat tiles</SectionLabel>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <StatTile Icon={CheckCircle} value="3" label="Open requests" tone="accent" />
            <StatTile Icon={WarningCircle} value="5" label="Unread notices" tone="warning" />
          </View>
        </View>

        <View>
          <SectionLabel>Request row</SectionLabel>
          <RequestRow
            category="Plumbing"
            title="Kitchen tap leak, block A"
            participants={2}
            thresholdAt={4}
            onPress={() => undefined}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
