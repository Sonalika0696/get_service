import React from 'react';
import { View, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  PaintBrush,
  SignOut,
  User,
  ShieldCheck,
  CaretRight,
  Sun,
  Moon,
  Monitor,
  IdentificationCard,
  Bell,
  Translate,
  Lock,
  Question,
  ChatCircle,
  PencilSimple,
} from '../icons/phosphor';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { SectionLabel } from '../components/SectionLabel';
import { useTheme, useThemeControls } from '../theme/ThemeProvider';
import { useAuth } from '../auth/AuthProvider';
import { useApprovals, useIsCommittee } from '../hooks/useApprovals';

const ROLE_LABELS: Record<string, string> = {
  OWNER_OCCUPIER: 'Owner, resident',
  OWNER_ABSENTEE: 'Owner, non-resident',
  TENANT: 'Tenant',
};

function initialsFor(name?: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { me, signOut } = useAuth();
  const isCommittee = useIsCommittee();
  const approvals = useApprovals();
  const awaitingCount = approvals.data?.items.filter((i) => !i.currentUserApproved).length ?? 0;

  const confirmSignOut = () => {
    Alert.alert(
      t('profile.signOutConfirm.title'),
      t('profile.signOutConfirm.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.signOutConfirm.confirm'), style: 'destructive', onPress: () => signOut() },
      ],
    );
  };

  const initials = initialsFor(me?.name);
  const occupancyLabel = me?.occupancyRole ? ROLE_LABELS[me.occupancyRole] ?? me.occupancyRole : undefined;
  const accent = theme.colors.accent[700];

  return (
    <Screen>
      {/* Identity header */}
      <View style={{ alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.lg }}>
        <View>
          <View
            style={{
              width: 92,
              height: 92,
              borderRadius: 999,
              backgroundColor: theme.colors.accent.tint,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.colors.bg.elevated,
              ...theme.shadows.sm.native,
            }}
          >
            {initials ? (
              <Text variant="display" weight="semibold" tone="accent">{initials}</Text>
            ) : (
              <User size={42} color={accent} weight="duotone" />
            )}
          </View>
          <View
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 30,
              height: 30,
              borderRadius: 999,
              backgroundColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.colors.bg.primary,
            }}
          >
            <PencilSimple size={15} color={theme.colors.ink.onAccent} weight="bold" />
          </View>
        </View>

        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="display" weight="semibold" align="center" accessibilityRole="header">{me?.name ?? 'You'}</Text>
          <Text variant="body" tone="muted" align="center">
            {[me?.email, me?.phone].filter(Boolean).join('  ·  ')}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          {me?.roleKinds?.map((r) => <Chip key={r} label={r} tone="accent" />)}
          {occupancyLabel ? <Chip label={occupancyLabel} /> : null}
          {me?.kycTier ? <Chip label={`KYC · ${me.kycTier}`} /> : null}
        </View>
      </View>

      {isCommittee ? (
        <View>
          <SectionLabel>Committee</SectionLabel>
          <CommitteeCard
            awaiting={awaitingCount}
            onPress={() => router.push('/approvals' as never)}
          />
        </View>
      ) : null}

      <View>
        <SectionLabel>{t('profile.sectionLabel.account')}</SectionLabel>
        <Card>
          <Row
            icon={<IdentificationCard size={18} color={accent} weight="duotone" />}
            title="Edit profile information"
            onPress={() => router.push('/account/edit-profile')}
          />
          <Row
            icon={<Bell size={18} color={accent} weight="duotone" />}
            title="Notifications"
            rightValue="On"
            onPress={() => router.push('/account/notifications')}
          />
          <Row
            icon={<Translate size={18} color={accent} weight="duotone" />}
            title="Language"
            rightValue="English"
            onPress={() => router.push('/account/language')}
          />
        </Card>
      </View>

      <View>
        <SectionLabel>{t('profile.sectionLabel.preferences')}</SectionLabel>
        <Card>
          <Row
            icon={<ShieldCheck size={18} color={accent} weight="duotone" />}
            title="Security"
            onPress={() => router.push('/account/security')}
          />
          <ThemeRow />
        </Card>
      </View>

      <View>
        <SectionLabel>{t('profile.sectionLabel.support')}</SectionLabel>
        <Card>
          <Row
            icon={<Question size={18} color={accent} weight="duotone" />}
            title="Help & support"
            onPress={() => router.push('/account/help')}
          />
          <Row
            icon={<ChatCircle size={18} color={accent} weight="duotone" />}
            title="Contact us"
            onPress={() => router.push('/account/contact')}
          />
          <Row
            icon={<Lock size={18} color={accent} weight="duotone" />}
            title="Privacy policy"
            onPress={() => router.push('/account/privacy')}
          />
        </Card>
      </View>

      <View>
        <SectionLabel>{t('profile.sectionLabel.more')}</SectionLabel>
        <Card>
          <Row
            icon={<PaintBrush size={18} color={accent} weight="duotone" />}
            title="Design playground"
            subtitle="Preview shared components"
            onPress={() => router.push('/dev/ui')}
          />
          <Row
            icon={<SignOut size={18} color={theme.colors.feedback.danger} weight="bold" />}
            title="Sign out"
            danger
            showCaret={false}
            onPress={confirmSignOut}
          />
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Theme row in the reference's value-row style: label left, current mode on
 * the right in accent, a leading sun/moon icon reflecting the resolved
 * scheme. Tapping cycles Light → Dark → System.
 */
function ThemeRow() {
  const theme = useTheme();
  const { scheme, resolved, setScheme } = useThemeControls();
  const next: Record<'light' | 'dark' | 'system', 'light' | 'dark' | 'system'> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
  };
  const valueLabel = scheme === 'system' ? 'System' : scheme === 'dark' ? 'Dark' : 'Light';
  const Icon = scheme === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return (
    <Row
      icon={<Icon size={18} color={theme.colors.accent[700]} weight="duotone" />}
      title="Theme"
      rightValue={valueLabel}
      accentValue
      onPress={() => setScheme(next[scheme])}
    />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.border.divider,
        marginLeft: theme.spacing.md + 36 + theme.spacing.sm,
      }}
    />
  );
}

function Row({
  icon,
  title,
  subtitle,
  rightValue,
  accentValue = false,
  onPress,
  danger = false,
  showCaret = true,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  rightValue?: string;
  accentValue?: boolean;
  onPress?: () => void;
  danger?: boolean;
  showCaret?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 44,
        backgroundColor: pressed ? theme.colors.bg.secondary : 'transparent',
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          backgroundColor: danger ? theme.colors.feedback.dangerTint : theme.colors.accent.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semibold" tone={danger ? 'danger' : 'primary'}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted">{subtitle}</Text> : null}
      </View>
      {rightValue ? (
        <Text variant="body" weight={accentValue ? 'semibold' : 'regular'} tone={accentValue ? 'accent' : 'muted'}>
          {rightValue}
        </Text>
      ) : null}
      {showCaret ? <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" /> : null}
    </Pressable>
  );
}

function CommitteeCard({ awaiting, onPress }: { awaiting: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        padding: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.accent.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ShieldCheck size={20} color={theme.colors.accent[700]} weight="duotone" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semibold">Approvals inbox</Text>
        <Text variant="caption" tone="muted">
          {awaiting > 0
            ? `${awaiting} awaiting your signature`
            : 'Payouts, milestones, corpus movements'}
        </Text>
      </View>
      {awaiting > 0 ? (
        <View
          style={{
            backgroundColor: theme.colors.feedback.danger,
            minWidth: 24,
            height: 24,
            borderRadius: 999,
            paddingHorizontal: 6,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" weight="semibold" tone="onAccent" mono>
            {awaiting > 99 ? '99+' : awaiting}
          </Text>
        </View>
      ) : null}
      <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" />
    </Pressable>
  );
}

function Chip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: tone === 'accent' ? theme.colors.accent.tint : theme.colors.bg.secondary,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text
        variant="caption"
        weight="semibold"
        tone={tone === 'accent' ? 'accent' : 'secondary'}
      >
        {label}
      </Text>
    </View>
  );
}
