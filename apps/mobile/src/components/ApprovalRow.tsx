import React from 'react';
import { View, Pressable } from 'react-native';
import {
  Vault,
  Wrench,
  Handshake,
  Buildings,
  ClipboardText,
  CheckCircle,
  Circle,
  CaretRight,
  type IconProps,
} from '../icons/phosphor';
import type { ApprovalItem, ApprovalKind } from '@sft/api-client';
import { Text } from './Text';
import { Money } from './Money';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A row in the committee approvals inbox. The visual job is to make three
 * facts obvious at a glance: what kind of decision this is, how many
 * approvers have signed, and whether *you* have already signed.
 */
export function ApprovalRow({
  item,
  onPress,
}: {
  item: ApprovalItem;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = kindIcon(item.kind);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        opacity: pressed ? 0.94 : 1,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        gap: theme.spacing.sm,
      })}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={22} color={theme.colors.accent[700]} weight="duotone" />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="overline" weight="semibold" tone="muted">
              {kindLabel(item.kind)}
            </Text>
            {item.currentUserApproved ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <CheckCircle size={12} color={theme.colors.feedback.success} weight="fill" />
                <Text variant="caption" weight="semibold" tone="secondary">You signed</Text>
              </View>
            ) : null}
          </View>
          <Text variant="body" weight="semibold" numberOfLines={1}>{item.title}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>{item.counterparty}</Text>
        </View>

        {item.amountMinor !== null ? (
          <Money
            minor={item.amountMinor}
            currency={item.currency}
            variant="body"
            weight="semibold"
          />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ApproverProgress
          collected={item.collectedApprovers}
          required={item.requiredApprovers}
        />
        <View style={{ flex: 1 }} />
        <CaretRight size={14} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </Pressable>
  );
}

function ApproverProgress({ collected, required }: { collected: number; required: number }) {
  const theme = useTheme();
  const dots = Array.from({ length: Math.max(1, required) }, (_, i) => i < collected);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {dots.map((filled, i) =>
          filled ? (
            <CheckCircle key={i} size={14} color={theme.colors.accent[700]} weight="fill" />
          ) : (
            <Circle key={i} size={14} color={theme.colors.ink[40]} weight="regular" />
          ),
        )}
      </View>
      <Text variant="caption" tone="muted" mono>
        {collected} / {required} signed
      </Text>
    </View>
  );
}

export function kindIcon(kind: ApprovalKind): React.ComponentType<IconProps> {
  switch (kind) {
    case 'PAYOUT': return Vault;
    case 'MILESTONE': return Wrench;
    case 'RETENTION': return Handshake;
    case 'RATIFICATION': return ClipboardText;
    case 'CORPUS': return Buildings;
  }
}

export function kindLabel(kind: ApprovalKind): string {
  switch (kind) {
    case 'PAYOUT': return 'Payout';
    case 'MILESTONE': return 'Milestone';
    case 'RETENTION': return 'Retention release';
    case 'RATIFICATION': return 'Flat claim';
    case 'CORPUS': return 'Corpus movement';
  }
}
