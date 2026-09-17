import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconProps } from '../icons/phosphor';
import { Warning, TrayArrowDown } from '../icons/phosphor';
import { Text } from './Text';
import { Button } from './Button';
import { SpotIllustration, type SpotIllustrationName } from './illustrations/SpotIllustration';
import { useTheme } from '../theme/ThemeProvider';

export function ListLoading({ label }: { label?: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('common.loading');
  return (
    <View
      style={{
        padding: theme.spacing.xxl,
        alignItems: 'center',
        gap: theme.spacing.md,
      }}
    >
      <ActivityIndicator color={theme.colors.accent[700]} />
      <Text variant="caption" tone="muted">{resolvedLabel}</Text>
    </View>
  );
}

export function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={{
        backgroundColor: theme.colors.feedback.dangerTint,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Warning size={20} color={theme.colors.feedback.danger} weight="regular" />
        <Text variant="body" weight="semibold" tone="danger">
          {t('common.couldntLoad')}
        </Text>
      </View>
      <Text variant="caption" tone="secondary">{message}</Text>
      {onRetry ? <Button label={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function ListEmpty({
  Icon = TrayArrowDown,
  title,
  body,
  action,
  illustration,
}: {
  Icon?: React.ComponentType<IconProps>;
  title: string;
  body: string;
  action?: React.ReactNode;
  illustration?: SpotIllustrationName;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.xl,
        alignItems: 'center',
        gap: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
      }}
    >
      {illustration ? (
        <SpotIllustration name={illustration} size={104} />
      ) : (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={28} color={theme.colors.accent[700]} weight="duotone" />
        </View>
      )}
      <Text variant="heading" weight="semibold" align="center">{title}</Text>
      <Text variant="body" tone="secondary" align="center">{body}</Text>
      {action}
    </View>
  );
}
