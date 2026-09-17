import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useMutationState } from '@tanstack/react-query';
import { WifiSlash } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Thin banner beneath the header when the device drops connectivity, or
 * while mutations paused offline are still waiting to replay. Queued
 * mutations actually replay on reconnect (see FRONTEND_PLAN §3.3 and
 * src/lib/query.ts's onlineManager wiring) — the banner exists so the user
 * knows *why* their tap didn't update anything, and roughly how much is
 * still queued, not to beg them to reconnect.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const theme = useTheme();

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return () => sub();
  }, []);

  // Paused mutations are the ones actually queued for replay — as opposed
  // to ones merely `pending` (in flight right now). Counting across the
  // whole cache, not just this screen's own hooks, so the number matches
  // "changes will sync" regardless of which screen queued them.
  const pausedCount = useMutationState({
    filters: { predicate: (mutation) => mutation.state.isPaused },
    select: () => true,
  }).length;

  if (online && pausedCount === 0) return null;

  const message = !online
    ? pausedCount > 0
      ? `Offline. ${pausedCount} ${pausedCount === 1 ? 'change' : 'changes'} will sync when you're back online.`
      : "Offline. Your actions will send when you reconnect."
    : `Reconnected. Syncing ${pausedCount} ${pausedCount === 1 ? 'change' : 'changes'}…`;

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: theme.colors.feedback.warningTint,
        paddingVertical: theme.spacing.xs,
        paddingHorizontal: theme.screenPadding,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.subtle,
      }}
    >
      <WifiSlash size={16} color={theme.colors.feedback.warning} weight="regular" />
      <Text variant="caption" weight="semibold" tone="secondary">
        {message}
      </Text>
    </View>
  );
}
