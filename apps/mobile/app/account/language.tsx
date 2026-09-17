import React, { useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useTheme } from '../../src/theme/ThemeProvider';
import { kv } from '../../src/lib/storage';
import { setLanguage, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../src/i18n';

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
] as const satisfies readonly { code: SupportedLanguage; label: string; native: string }[];

function readStoredLanguage(): SupportedLanguage {
  try {
    const stored = kv.getString(LANGUAGE_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as SupportedLanguage;
    }
  } catch {
    // Best-effort; fall back to English below.
  }
  return 'en';
}

/**
 * Language selection. Picking an option calls `setLanguage`, which switches
 * i18next's active language (every screen using `useTranslation` re-renders
 * live) and persists the choice under the same MMKV key this screen has
 * always used.
 */
export default function Language() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SupportedLanguage>(() => readStoredLanguage());

  const select = (code: SupportedLanguage) => {
    setSelected(code);
    setLanguage(code);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
        <Button
          label={t('common.back')}
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
          <Text variant="display" weight="semibold">{t('account.language.title')}</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            {t('account.language.subtitle')}
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
          {t('account.language.disclaimer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
