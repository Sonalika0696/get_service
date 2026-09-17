import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="heading" weight="semibold">{title}</Text>
      <Text variant="body" tone="secondary" style={{ lineHeight: theme.fontSize.body.lineHeight }}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Static privacy policy for the society finance app. Content-only screen —
 * nothing here reads live state.
 */
export default function Privacy() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
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
      >
        <View>
          <Text variant="display" weight="semibold">Privacy policy</Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Last updated September 2026
          </Text>
        </View>

        <Section title="Who this covers">
          GateX is used by residents, committee members, treasurers and vendors of a housing
          society to manage bills, service requests, notices and payments. This policy explains
          what information we collect through the app and how it is used.
        </Section>

        <Section title="What we collect">
          To run your account we collect your name, phone number, email address, flat and
          occupancy details, and KYC tier where applicable. When you use the app we also record
          bills raised against your flat, payments and their status, service requests you raise
          or back, polls you vote in, and notices you view — all scoped to your society.
        </Section>

        <Section title="How it's used">
          Your information is used to generate and reconcile your flat's bills, route service
          requests to vendors and neighbours, run committee approvals, send you notices and
          reminders, and verify your identity at sign-in via one-time phone codes. We do not use
          your data for advertising, and we do not sell it to third parties.
        </Section>

        <Section title="Who can see it">
          Your committee and treasurer can see your flat's bills, payments and statement — this
          is necessary for society accounting. Other residents can see your name and unit only
          where the app already shows it, such as a service request you've backed. Vendors see
          only what's needed to fulfil a request you or your society raised with them.
        </Section>

        <Section title="Retention">
          Financial records — bills, payments, approvals — are retained for as long as required
          by your society's accounting and statutory obligations, typically several years after
          the transaction. If you leave the society, your profile is deactivated and your
          transaction history is retained under the same rules rather than deleted immediately.
        </Section>

        <Section title="Your choices">
          You can review and update your name and phone number from Edit profile information, and
          control local notification preferences from the Notifications screen. To request a copy
          of your data, a correction, or deletion where the law allows it, contact your committee
          — see Contact us.
        </Section>

        <Section title="Contact">
          Questions about this policy or how your data is handled can be sent to your society's
          committee at the email address listed under Contact us in this app.
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
