import React from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Uppercase small-caps section header — the "MY DUES / DOCUMENTS / NOTICE
 * BOARD" pattern from the reference. Optional trailing action (e.g. "See all")
 * renders on the right in accent-toned body text.
 */
export function SectionLabel({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
        marginTop: spacing.xs,
      }}
    >
      <Text variant="overline" weight="semibold" tone="muted">
        {children}
      </Text>
      {trailing}
    </View>
  );
}
