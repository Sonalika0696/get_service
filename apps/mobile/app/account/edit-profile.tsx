import React, { useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, User, EnvelopeSimple, Phone } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/auth/AuthProvider';
import { api } from '../../src/lib/api';

/**
 * Edit profile information. The only screen under /account that writes to
 * the backend — PATCH /me accepts { name?, phone? }. Email is read-only:
 * sign-in is phone/email-bound and changing it is out of scope here.
 */
export default function EditProfile() {
  const theme = useTheme();
  const router = useRouter();
  const { me, refreshMe } = useAuth();

  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length >= 2 && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api('/me', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          phone: phone.trim() || undefined,
        },
      });
      await refreshMe();
      router.back();
    } catch (err) {
      const message =
        (err as { message?: string } | null)?.message ??
        'Could not save your changes. Please try again.';
      Alert.alert('Could not save', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          <View>
            <Text variant="display" weight="semibold">Edit profile</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              Keep your name and phone number current so the committee and vendors can reach you.
            </Text>
          </View>

          <View>
            <SectionLabel>Name</SectionLabel>
            <FieldInput
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              autoCapitalize="words"
              icon={<User size={18} color={theme.colors.ink[40]} weight="regular" />}
            />
          </View>

          <View>
            <SectionLabel>Phone</SectionLabel>
            <FieldInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+91XXXXXXXXXX"
              keyboardType="phone-pad"
              icon={<Phone size={18} color={theme.colors.ink[40]} weight="regular" />}
            />
          </View>

          <View>
            <SectionLabel>Email</SectionLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: theme.colors.bg.secondary,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border.subtle,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <EnvelopeSimple size={18} color={theme.colors.ink[40]} weight="regular" />
              <Text variant="body" tone="muted" style={{ flex: 1 }}>{me?.email ?? '—'}</Text>
            </View>
            <Text variant="caption" tone="muted" style={{ marginTop: 6 }}>
              Email is tied to your sign-in and can't be changed here.
            </Text>
          </View>

          <Button
            label={saving ? 'Saving' : 'Save changes'}
            onPress={onSave}
            disabled={!canSave}
            loading={saving}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldInput({
  icon,
  ...props
}: React.ComponentProps<typeof TextInput> & { icon?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        paddingHorizontal: 14,
      }}
    >
      {icon}
      <TextInput
        {...props}
        placeholderTextColor={theme.colors.ink[40]}
        style={{
          flex: 1,
          paddingVertical: 12,
          minHeight: 44,
          fontFamily: theme.fontFamily.sans,
          fontSize: theme.fontSize.body.size,
          color: theme.colors.ink[100],
        }}
      />
    </View>
  );
}
