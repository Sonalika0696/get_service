import React from 'react';
import { View } from 'react-native';
import type { PollStatus } from '@sft/api-client';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Status chip for a resident poll. Colour maps to lifecycle:
 *   OPEN       - accent (default working state)
 *   FIRED      - success (converted into a booking)
 *   EXPIRED    - muted ink
 *   CLOSED     - muted ink (closed early)
 *   CANCELLED  - danger (vendor declined)
 */
export function StatusPill({ status }: { status: PollStatus }) {
  const theme = useTheme();
  const config: Record<PollStatus, { bg: string; text: 'accent' | 'secondary' | 'danger' | 'muted'; label: string }> = {
    OPEN:      { bg: theme.colors.accent.tint,       text: 'accent',    label: 'Open' },
    FIRED:     { bg: theme.colors.feedback.successTint, text: 'secondary', label: 'Firing' },
    EXPIRED:   { bg: theme.colors.bg.secondary,      text: 'muted',     label: 'Expired' },
    CLOSED:    { bg: theme.colors.bg.secondary,      text: 'muted',     label: 'Closed' },
    CANCELLED: { bg: theme.colors.feedback.dangerTint, text: 'danger',   label: 'Cancelled' },
  };
  const c = config[status];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text variant="caption" weight="semibold" tone={c.text}>{c.label}</Text>
    </View>
  );
}
