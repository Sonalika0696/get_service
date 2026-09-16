import React from 'react';
import { Text } from './Text';
import { formatMinor } from '../lib/money';

/**
 * Display an amount in monospace so decimals align across a list. Every
 * amount in the app must flow through this or `formatMinor` directly —
 * ad-hoc `₹${x}` strings drift alignment and locale.
 */
export function Money({
  minor,
  currency = 'INR',
  variant = 'body',
  weight = 'semibold',
  tone,
  showDecimals = true,
}: {
  minor: number;
  currency?: string;
  variant?: React.ComponentProps<typeof Text>['variant'];
  weight?: 'regular' | 'semibold';
  tone?: React.ComponentProps<typeof Text>['tone'];
  showDecimals?: boolean;
}) {
  return (
    <Text variant={variant} weight={weight} tone={tone} mono>
      {formatMinor(minor, currency, { showDecimals })}
    </Text>
  );
}
