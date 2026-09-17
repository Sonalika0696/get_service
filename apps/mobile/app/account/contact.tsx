import React from 'react';
import { View, ScrollView, Pressable, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, EnvelopeSimple, Phone, Clock, CaretRight } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionLabel } from '../../src/components/SectionLabel';
import { useTheme } from '../../src/theme/ThemeProvider';

const SUPPORT_EMAIL = 'committee@gatex.app';
const SUPPORT_PHONE = '+91 22 4000 1234';
const SUPPORT_PHONE_DIAL = '+912240001234';

async function openLink(url: string, failureMessage: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Unavailable', failureMessage);
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unavailable', failureMessage);
  }
}

/**
 * Contact options for the society office/committee. Real mailto:/tel: links
 * — no in-app form, since the committee is reached over channels they
 * already monitor.
 */
export default function Contact() {
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
          <Text variant="display" weight="semibold">Contact us</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Reach your society's committee directly.
          </Text>
        </View>

        <View>
          <SectionLabel>Get in touch</SectionLabel>
          <Card padded={0}>
            <ContactRow
              icon={<EnvelopeSimple size={18} color={theme.colors.accent[700]} weight="duotone" />}
              title="Email the committee"
              subtitle={SUPPORT_EMAIL}
              onPress={() => openLink(
                `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('GateX support')}`,
                "Couldn't open your email app.",
              )}
            />
            <ContactRow
              icon={<Phone size={18} color={theme.colors.accent[700]} weight="duotone" />}
              title="Call the office"
              subtitle={SUPPORT_PHONE}
              onPress={() => openLink(
                `tel:${SUPPORT_PHONE_DIAL}`,
                "Couldn't start a call on this device.",
              )}
              last
            />
          </Card>
        </View>

        <Card style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Clock size={20} color={theme.colors.accent[700]} weight="duotone" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">Society office hours</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              Monday to Saturday, 10:00 AM – 6:00 PM. Closed on Sundays and public holidays.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function ContactRow({
  icon,
  title,
  subtitle,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 44,
        backgroundColor: pressed ? theme.colors.bg.secondary : 'transparent',
        borderTopWidth: last ? 1 : 0,
        borderTopColor: theme.colors.border.subtle,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.accent.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semibold">{title}</Text>
        <Text variant="caption" tone="muted">{subtitle}</Text>
      </View>
      <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" />
    </Pressable>
  );
}
