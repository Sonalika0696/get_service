import React from 'react';
import { View, Pressable } from 'react-native';
import { ArrowRight, ClockCounterClockwise } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

type DuesCardProps = {
  amountMinor: number;
  currency?: string;
  dueOn: string | null;
  captions: string[];
  onPressPay: () => void;
  onPressHistory: () => void;
};

/**
 * The hero card on the home screen. Reference-inspired: full-bleed accent
 * surface with the amount in large mono, breakdown captions above, and
 * two secondary chips at the base. The amount is monospaced so decimals
 * line up and the number reads as a value rather than a headline.
 */
export function DuesCard({
  amountMinor,
  currency = 'INR',
  dueOn,
  captions,
  onPressPay,
  onPressHistory,
}: DuesCardProps) {
  const theme = useTheme();
  const amount = formatMinor(amountMinor, currency);

  return (
    <View
      style={{
        backgroundColor: theme.colors.hero.dueBg,
        borderRadius: theme.radius.xxl,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        overflow: 'hidden',
        ...theme.shadows.md.native,
      }}
    >
      {/* Subtle inner tone shift standing in for a gradient (no new deps):
          a soft glow near the top-right fading into the base crimson. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: theme.colors.hero.dueBgTo,
          opacity: 0.45,
        }}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {captions.map((c) => (
          <View
            key={c}
            style={{
              backgroundColor: 'rgba(255,255,255,0.12)',
              borderRadius: theme.radius.pill,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text variant="caption" weight="semibold" tone="onAccent">
              {c}
            </Text>
          </View>
        ))}
      </View>

      <View
        accessible
        accessibilityLabel={`Amount due ${amountSpokenLabel(amountMinor, currency)}${dueOn ? `, due by ${dueOn}` : ''}`}
      >
        <Text variant="caption" tone="onAccent" style={{ opacity: 0.72 }}>
          Amount due
        </Text>
        <Text
          variant="display"
          weight="semibold"
          tone="onAccent"
          mono
          style={{ marginTop: 2 }}
        >
          {amount}
        </Text>
        {dueOn ? (
          <Text variant="caption" tone="onAccent" style={{ opacity: 0.72, marginTop: 4 }}>
            Due by {dueOn}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
        <Pressable
          accessibilityRole="button"
          onPress={onPressPay}
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: theme.radius.pill,
            paddingHorizontal: 18,
            paddingVertical: 12,
            flex: 1,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Text variant="body" weight="semibold" tone="accent">
            Pay now
          </Text>
          <ArrowRight size={16} color={theme.colors.accent[700]} weight="bold" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onPressHistory}
          style={{
            borderRadius: theme.radius.pill,
            paddingHorizontal: 18,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.24)',
          }}
        >
          <ClockCounterClockwise size={16} color="#FFFFFF" weight="regular" />
          <Text variant="body" weight="semibold" tone="onAccent">
            History
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatMinor(minor: number, currency: string): string {
  const value = minor / 100;
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  return formatter.format(value);
}

/**
 * A screen-reader-friendly reading of the amount — "12,450 rupees" instead
 * of a screen reader trying (and often failing) to sound out "₹12,450".
 */
function amountSpokenLabel(minor: number, currency: string): string {
  const value = minor / 100;
  const formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const unit = currency === 'INR' ? 'rupees' : currency;
  return `${formatter.format(value)} ${unit}`;
}
