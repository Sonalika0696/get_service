import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Two-to-three-way segmented control. Native-feeling: selected pill glides
 * behind text (via a solid accent background), unselected reads muted.
 * Not a horizontal scroller — meant for small option sets like Open / Mine.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.secondary,
        borderRadius: theme.radius.pill,
        padding: 4,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.colors.bg.elevated : 'transparent',
              ...(active ? theme.shadows.sm.native : {}),
            }}
          >
            <Text variant="body" weight="semibold" tone={active ? 'accent' : 'muted'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
