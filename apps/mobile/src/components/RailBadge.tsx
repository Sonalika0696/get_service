import React from 'react';
import { View } from 'react-native';
import type { PaymentRail } from '@sft/api-client';
import { Buildings, Vault, Storefront } from '../icons/phosphor';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * "Who holds this money" chip. Compliance invariant I2 (SDD §2.2): the
 * platform never holds funds, so every rail is either the society's own
 * account or the vendor's. The chip's job is to make that legible to the
 * resident before they tap Pay.
 */
export function RailBadge({ rail }: { rail: PaymentRail }) {
  const theme = useTheme();
  const config = {
    SOCIETY_UPI: {
      label: 'Society',
      Icon: Buildings,
      color: theme.colors.feedback.info,
      bg: theme.colors.feedback.infoTint,
    },
    BULK_BUY_ESCROW: {
      label: 'Escrow',
      Icon: Vault,
      color: theme.colors.accent[700],
      bg: theme.colors.accent.tint,
    },
    VENDOR_DIRECT: {
      label: 'Vendor direct',
      Icon: Storefront,
      color: theme.colors.feedback.warning,
      bg: theme.colors.feedback.warningTint,
    },
  }[rail];

  const { Icon } = config;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: config.bg,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Icon size={12} color={config.color} weight="duotone" />
      <Text variant="caption" weight="semibold" tone="secondary">
        {config.label}
      </Text>
    </View>
  );
}
