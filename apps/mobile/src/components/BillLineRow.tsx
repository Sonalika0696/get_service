import React from 'react';
import { View, Pressable } from 'react-native';
import type { BillLine, BillKind, BillStatus } from '@sft/api-client';
import {
  Wrench,
  Lightning,
  Drop,
  Handshake,
  CalendarBlank,
  Receipt,
  CaretRight,
  type IconProps,
} from 'phosphor-react-native';
import { Text } from './Text';
import { Money } from './Money';
import { RailBadge } from './RailBadge';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A row on the Bills hub. The visual hierarchy runs: kind icon left,
 * title + basis + rail chip in the middle, amount + due date on the right.
 * The basis text is the "why this amount" one-liner — the resident should
 * be able to trust the number without opening the detail.
 */
export function BillLineRow({
  line,
  onPress,
}: {
  line: BillLine;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = kindIcon(line.kind);
  const iconTone = kindTone(line.kind, theme);

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
        ...theme.shadows.sm.native,
      })}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: iconTone.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={22} color={iconTone.fg} weight="duotone" />
        </View>

        <View style={{ flex: 1, gap: 2, paddingRight: theme.spacing.xs }}>
          <Text variant="body" weight="semibold" numberOfLines={1}>{line.title}</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>{line.basis}</Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Money
            minor={line.amountMinor}
            currency={line.currency}
            variant="body"
            weight="semibold"
            tone={line.status === 'OVERDUE' ? 'danger' : 'primary'}
          />
          <StatusLabel status={line.status} dueOn={line.dueOn} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <RailBadge rail={line.rail} />
        <View style={{ flex: 1 }} />
        <Text variant="caption" tone="muted">See detail</Text>
        <CaretRight size={14} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </Pressable>
  );
}

function StatusLabel({ status, dueOn }: { status: BillStatus; dueOn: string }) {
  const theme = useTheme();
  const due = new Date(dueOn);
  const overdue = status === 'OVERDUE' || (status === 'DUE' && due.getTime() < Date.now());

  if (status === 'PAID') {
    return <Text variant="caption" weight="semibold" tone="accent">Paid</Text>;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <CalendarBlank
        size={12}
        color={overdue ? theme.colors.feedback.danger : theme.colors.ink[60]}
        weight="duotone"
      />
      <Text
        variant="caption"
        weight="semibold"
        tone={overdue ? 'danger' : 'muted'}
      >
        {overdue
          ? 'Overdue'
          : `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
      </Text>
    </View>
  );
}

function kindIcon(kind: BillKind): React.ComponentType<IconProps> {
  switch (kind) {
    case 'MAINTENANCE': return Wrench;
    case 'ELECTRICITY': return Lightning;
    case 'WATER': return Drop;
    case 'BULK_BUY_SHARE': return Handshake;
    case 'EVENT_CHARGE': return CalendarBlank;
    case 'ADJUSTMENT': return Receipt;
  }
}

function kindTone(kind: BillKind, theme: ReturnType<typeof useTheme>): { bg: string; fg: string } {
  switch (kind) {
    case 'ELECTRICITY':
      return { bg: theme.colors.feedback.warningTint, fg: theme.colors.feedback.warning };
    case 'WATER':
      return { bg: theme.colors.feedback.infoTint, fg: theme.colors.feedback.info };
    case 'BULK_BUY_SHARE':
      return { bg: theme.colors.accent.tint, fg: theme.colors.accent[700] };
    default:
      return { bg: theme.colors.bg.secondary, fg: theme.colors.ink[80] };
  }
}
