import React, { useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Check } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useTheme } from '../../src/theme/ThemeProvider';
import { kv } from '../../src/lib/storage';

const LANGUAGE_KEY = 'gatex.language';

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
] as const;

function readStoredLanguage(): string {
  try {
    const stored = kv.getString(LANGUAGE_KEY);
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    // Best-effort; fall back to English below.
  }
  return 'en';
}

/**
 * Language selection. Only the picker and its persistence are real right
 * now — the app itself still renders in English regardless of choice, so
 * this is a visual/preference screen until localisation ships.
 */
export default function Language() {
  const theme = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState(() => readStoredLanguage());

  const select = (code: string) => {
    setSelected(code);
    try {
      kv.set(LANGUAGE_KEY, code);
    } catch {
      // Best-effort; selection still updates in-session state.
    }
  };

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
          <Text variant="display" weight="semibold">Language</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Pick the language you'd like GateX to use.
          </Text>
        </View>

        <Card padded={0}>
          {LANGUAGES.map((l, i) => (
            <Pressable
              key={l.code}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === l.code }}
              onPress={() => select(l.code)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                minHeight: 44,
                backgroundColor: pressed ? theme.colors.bg.secondary : 'transparent',
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.colors.border.subtle,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text variant="body" weight="semibold">{l.label}</Text>
                <Text variant="caption" tone="muted">{l.native}</Text>
              </View>
              {selected === l.code ? (
                <Check size={20} color={theme.colors.accent[700]} weight="bold" />
              ) : null}
            </Pressable>
          ))}
        </Card>

        <Text variant="caption" tone="muted">
          Full app localisation is in progress — screens currently display in English regardless of this choice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
