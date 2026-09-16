import React from 'react';
import { View } from 'react-native';
import { Megaphone } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function NoticesScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <Text variant="display" weight="semibold">Notices</Text>
      <View
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          padding: theme.spacing.xl,
          alignItems: 'center',
          gap: theme.spacing.md,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
        }}
      >
        <Megaphone size={40} color={theme.colors.accent[700]} weight="duotone" />
        <Text variant="heading" weight="semibold">Notice board wires up in F2</Text>
        <Text variant="body" tone="secondary" align="center">
          Already-shipped backend, no wait. This lands as soon as the auth handshake does.
        </Text>
      </View>
    </Screen>
  );
}
