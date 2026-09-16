import React from 'react';
import { View } from 'react-native';
import { Receipt } from 'phosphor-react-native';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function BillsScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <Text variant="display" weight="semibold">Bills</Text>
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
        <Receipt size={40} color={theme.colors.accent[700]} weight="duotone" />
        <Text variant="heading" weight="semibold">Bills hub arrives in F5</Text>
        <Text variant="body" tone="secondary" align="center">
          Maintenance, water, electricity and group-buy contributions land here as a single list,
          each with the reading, formula and frozen card that produced it.
        </Text>
      </View>
    </Screen>
  );
}
