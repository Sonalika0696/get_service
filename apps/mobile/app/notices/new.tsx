import React, { useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Briefcase, MagnifyingGlass } from 'phosphor-react-native';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { useCreateJobPost } from '../../src/hooks/useJobPosts';
import { useTheme } from '../../src/theme/ThemeProvider';

type Kind = 'SEEKING' | 'HIRING';

export default function ComposeNotice() {
  const theme = useTheme();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('SEEKING');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');

  const mutation = useCreateJobPost();

  const canSubmit =
    title.trim().length >= 3 &&
    body.trim().length >= 1 &&
    (kind === 'SEEKING' || /^\S+@\S+\.\S+$/.test(companyEmail.trim()));

  const submit = () => {
    if (!canSubmit) return;
    const payload =
      kind === 'HIRING'
        ? { kind, title: title.trim(), body: body.trim(), companyEmail: companyEmail.trim() }
        : { kind, title: title.trim(), body: body.trim() };
    mutation.mutate(payload as never, {
      onSuccess: () => {
        if (kind === 'HIRING') {
          Alert.alert(
            'Verify company email',
            'We sent a verification link to your work email. Your post appears once you click it.',
            [{ text: 'Got it', onPress: () => router.back() }],
          );
        } else {
          router.back();
        }
      },
      onError: (err: unknown) => {
        const message =
          (err as { message?: string } | null)?.message ?? 'Could not post. Please try again.';
        Alert.alert('Could not post', message);
      },
    });
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingHorizontal: theme.screenPadding, paddingTop: theme.spacing.sm }}>
          <Button
            label="Cancel"
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
            <Text variant="display" weight="semibold">New post</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              One post per resident per month by default. Committee moderation applies.
            </Text>
          </View>

          <View>
            <SectionLabel>Kind</SectionLabel>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <KindOption
                label="Seeking"
                caption="I want to do work"
                active={kind === 'SEEKING'}
                onPress={() => setKind('SEEKING')}
                Icon={MagnifyingGlass}
              />
              <KindOption
                label="Hiring"
                caption="I need to hire someone"
                active={kind === 'HIRING'}
                onPress={() => setKind('HIRING')}
                Icon={Briefcase}
              />
            </View>
          </View>

          <View>
            <SectionLabel>Title</SectionLabel>
            <FieldInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Weekend electrician wanted"
              maxLength={200}
            />
          </View>

          <View>
            <SectionLabel>Details</SectionLabel>
            <FieldInput
              value={body}
              onChangeText={setBody}
              placeholder="Scope, hours, budget expectations…"
              maxLength={5000}
              multiline
              minHeight={120}
            />
          </View>

          {kind === 'HIRING' ? (
            <View>
              <SectionLabel>Company email</SectionLabel>
              <FieldInput
                value={companyEmail}
                onChangeText={setCompanyEmail}
                placeholder="you@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text variant="caption" tone="muted" style={{ marginTop: 6 }}>
                We send a verification link. Your post appears after you click it.
              </Text>
            </View>
          ) : null}

          <Button
            label={mutation.isPending ? 'Posting' : 'Publish'}
            onPress={submit}
            disabled={!canSubmit}
            loading={mutation.isPending}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function KindOption({
  label,
  caption,
  active,
  onPress,
  Icon,
}: {
  label: string;
  caption: string;
  active: boolean;
  onPress: () => void;
  Icon: React.ComponentType<{ size?: number; color?: string; weight?: 'regular' | 'duotone' | 'fill' | 'bold' }>;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: active ? theme.colors.accent.tint : theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent[700] : theme.colors.border.subtle,
        gap: 6,
      }}
      onTouchEnd={onPress}
    >
      <Icon size={20} color={active ? theme.colors.accent[700] : theme.colors.ink[80]} weight="duotone" />
      <Text variant="body" weight="semibold" tone={active ? 'accent' : 'primary'}>{label}</Text>
      <Text variant="caption" tone="muted">{caption}</Text>
    </View>
  );
}

function FieldInput({
  multiline = false,
  minHeight,
  ...props
}: React.ComponentProps<typeof TextInput> & { minHeight?: number }) {
  const theme = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.ink[40]}
      multiline={multiline}
      style={{
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: minHeight ?? undefined,
        fontFamily: theme.fontFamily.sans,
        fontSize: theme.fontSize.body.size,
        color: theme.colors.ink[100],
        textAlignVertical: multiline ? 'top' : 'auto',
      }}
    />
  );
}
