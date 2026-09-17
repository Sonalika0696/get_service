import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

export type RealtimeToastState = { id: number; message: string };

/**
 * Ambient banner for realtime domain events (RealtimeProvider). Floats over
 * whatever screen is on top rather than living inside `Screen` like
 * `OfflineBanner` — a socket event can land on any route, not just ones that
 * opted in. Purely presentational: RealtimeProvider owns show/dismiss timing.
 */
export function RealtimeToast({ toast }: { toast: RealtimeToastState | null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!toast) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + theme.spacing.xs,
        left: theme.screenPadding,
        right: theme.screenPadding,
      }}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.bg.elevated,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border.subtle,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
          },
          theme.shadows.md.native,
        ]}
      >
        <Bell size={18} color={theme.colors.accent[700]} weight="fill" />
        <Text variant="caption" weight="semibold" tone="secondary" style={{ flex: 1 }}>
          {toast.message}
        </Text>
      </View>
    </View>
  );
}
