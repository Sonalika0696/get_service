import React from 'react';
import { View, ScrollView, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { OfflineBanner } from './OfflineBanner';

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const inner = (
    <View
      style={[
        {
          flex: 1,
          paddingHorizontal: theme.screenPadding,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}
    >
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingTop: theme.spacing.md }}
          showsVerticalScrollIndicator={false}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
