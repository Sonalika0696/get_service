import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { PaintBrushBroad, Gear, SignOut } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { SectionLabel } from '../../src/components/SectionLabel';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <Text variant="display" weight="semibold">Profile</Text>

      <View
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          gap: theme.spacing.xs,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
        }}
      >
        <Text variant="caption" tone="muted" weight="semibold">
          Willow Grove · A-1204
        </Text>
        <Text variant="heading" weight="semibold">Priya Menon</Text>
        <Text variant="body" tone="secondary">Owner-occupier</Text>
      </View>

      <View>
        <SectionLabel>Developer</SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Open design playground"
            variant="secondary"
            leftIcon={<PaintBrushBroad size={18} color={theme.colors.accent[700]} weight="duotone" />}
            onPress={() => router.push('/dev/ui')}
            fullWidth
          />
          <Button
            label="Settings"
            variant="ghost"
            leftIcon={<Gear size={18} color={theme.colors.accent[700]} weight="duotone" />}
            onPress={() => undefined}
            fullWidth
          />
          <Button
            label="Sign out"
            variant="ghost"
            leftIcon={<SignOut size={18} color={theme.colors.feedback.danger} weight="regular" />}
            onPress={() => undefined}
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}
