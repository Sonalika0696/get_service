import React, { useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, House, Buildings, Key } from '../../src/icons/phosphor';
import type { OccupancyRole } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';

type RoleOption = { value: OccupancyRole; label: string; caption: string; Icon: React.ComponentType<{ size?: number; color?: string; weight?: 'duotone' | 'fill' }> };

const ROLES: RoleOption[] = [
  { value: 'OWNER_OCCUPIER', label: 'Owner, live here', caption: 'You own and live in the flat', Icon: House },
  { value: 'OWNER_ABSENTEE', label: 'Owner, not resident', caption: 'You own but live elsewhere', Icon: Buildings },
  { value: 'TENANT', label: 'Tenant', caption: 'You rent the flat', Icon: Key },
];

/**
 * Claim-a-flat signup. Called out of the sign-in flow when the phone
 * number is unknown to the backend. Society and flat identifiers are
 * asked for as opaque codes handed out by the committee (backend has no
 * public "list societies / list flats" endpoint yet — DECISIONS_V2_SCOPE
 * has the committee onboarding those from a CSV).
 */
export default function SignUp() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const params = useLocalSearchParams<{ phone?: string }>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [societyId, setSocietyId] = useState('');
  const [flatId, setFlatId] = useState('');
  const [role, setRole] = useState<OccupancyRole | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    name.trim().length >= 1 &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    societyId.trim().length > 0 &&
    flatId.trim().length > 0 &&
    role !== null;

  const submit = async () => {
    if (!canSubmit || !role) return;
    const phone = params.phone;
    setBusy(true);
    try {
      await auth.signUp({
        name: name.trim(),
        email: email.trim(),
        phone,
        societyId: societyId.trim(),
        flatId: flatId.trim(),
        role,
      });
      // Signup already sends the first OTP; route to verify with the phone
      // identifier so the same code lands us straight into home.
      router.replace({ pathname: '/auth/verify', params: { phone } });
    } catch (err) {
      const apiErr = err as { status?: number; message?: string };
      Alert.alert('Could not create account', apiErr?.message ?? 'Please check the details and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
          <Button
            label="Back"
            variant="ghost"
            leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
            onPress={() => router.back()}
          />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.screenPadding,
            paddingBottom: theme.spacing.xxxl,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="display" weight="semibold">Claim your flat</Text>
            <Text variant="body" tone="secondary">
              Your committee handed out a society code and a flat code. Enter them here to join.
            </Text>
          </View>

          <View>
            <SectionLabel>Your name</SectionLabel>
            <FieldInput value={name} onChangeText={setName} placeholder="Full name" maxLength={200} />
          </View>

          <View>
            <SectionLabel>Email</SectionLabel>
            <FieldInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View>
            <SectionLabel>Society code</SectionLabel>
            <FieldInput
              value={societyId}
              onChangeText={setSocietyId}
              placeholder="From your committee"
              autoCapitalize="none"
            />
          </View>

          <View>
            <SectionLabel>Flat code</SectionLabel>
            <FieldInput
              value={flatId}
              onChangeText={setFlatId}
              placeholder="From your committee"
              autoCapitalize="none"
            />
          </View>

          <View>
            <SectionLabel>Your role in this flat</SectionLabel>
            <View style={{ gap: theme.spacing.sm }}>
              {ROLES.map((r) => (
                <RoleCard
                  key={r.value}
                  option={r}
                  active={role === r.value}
                  onPress={() => setRole(r.value)}
                />
              ))}
            </View>
          </View>

          <Button
            label={busy ? 'Creating account' : 'Continue'}
            onPress={submit}
            disabled={!canSubmit || busy}
            loading={busy}
            rightIcon={!busy ? <ArrowRight size={16} color="#fff" weight="bold" /> : undefined}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleCard({
  option,
  active,
  onPress,
}: {
  option: RoleOption;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { Icon } = option;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? theme.colors.accent.tint : theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent[700] : theme.colors.border.subtle,
        padding: theme.spacing.md,
        flexDirection: 'row',
        gap: theme.spacing.sm,
        alignItems: 'center',
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: active ? theme.colors.accent[700] : theme.colors.bg.secondary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={20} color={active ? '#fff' : theme.colors.ink[80]} weight="duotone" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="semibold" tone={active ? 'accent' : 'primary'}>{option.label}</Text>
        <Text variant="caption" tone="muted">{option.caption}</Text>
      </View>
    </Pressable>
  );
}

function FieldInput(props: React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.ink[40]}
      style={{
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontFamily: theme.fontFamily.sans,
        fontSize: theme.fontSize.body.size,
        color: theme.colors.ink[100],
      }}
    />
  );
}
