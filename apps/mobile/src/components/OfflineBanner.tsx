import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { WifiSlash } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Thin banner beneath the header when the device drops connectivity.
 * Queued mutations replay on reconnect (see FRONTEND_PLAN §3.3); the banner
 * exists so the user knows *why* their tap didn't update anything, not to
 * beg them to reconnect.
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

  if (online) return null;

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
        Offline. Your actions will send when you reconnect.
      </Text>
    </View>
  );
}
