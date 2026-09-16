import React from 'react';
import { View } from 'react-native';
import { Handshake } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function RequestsScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <Text variant="display" weight="semibold">Requests</Text>
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
        <Handshake size={40} color={theme.colors.accent[700]} weight="duotone" />
        <Text variant="heading" weight="semibold">The core loop lives here in F4</Text>
        <Text variant="body" tone="secondary" align="center">
          Raise a request, join what your neighbours already need, watch the threshold fill.
        </Text>
      </View>
    </Screen>
  );
}
