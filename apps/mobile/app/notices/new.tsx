import React, { useState } from 'react';
import { View, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, LinkSimple } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { useCreateJobPost } from '../../src/hooks/useJobPosts';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Loose "looks like a URL" check for the optional apply link. Doesn't need
 * to be exhaustive — it's a nudge, not a validator; the backend never sees
 * this field structured, it's folded into the free-text body. */
const URL_LIKE = /^https?:\/\/[^\s]+\.[^\s]+$/i;

export default function ComposeNotice() {
  const theme = useTheme();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [applyLink, setApplyLink] = useState('');
  const [succeeded, setSucceeded] = useState(false);

  const mutation = useCreateJobPost();

  const applyLinkTrimmed = applyLink.trim();
  const applyLinkValid = applyLinkTrimmed.length === 0 || URL_LIKE.test(applyLinkTrimmed);

  const canSubmit =
    title.trim().length >= 3 &&
    body.trim().length >= 1 &&
    /^\S+@\S+\.\S+$/.test(companyEmail.trim()) &&
    applyLinkValid;

  const submit = () => {
    if (!canSubmit) return;
    const bodyWithLink =
      applyLinkTrimmed.length > 0 ? `${body.trim()}\n\nApply: ${applyLinkTrimmed}` : body.trim();

    mutation.mutate(
      { kind: 'HIRING', title: title.trim(), body: bodyWithLink, companyEmail: companyEmail.trim() },
      {
        onSuccess: () => {
          setSucceeded(true);
          setTimeout(() => {
            Alert.alert(
              'Verify company email',
              'We sent a verification link to your work email. Your post appears once you click it.',
              [{ text: 'Got it', onPress: () => router.back() }],
            );
          }, 900);
        },
        onError: (err: unknown) => {
          const message =
            (err as { message?: string } | null)?.message ?? 'Could not post. Please try again.';
          Alert.alert('Could not post', message);
        },
      },
    );
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
            <Text variant="display" weight="semibold">New hiring post</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              One hiring post per resident per month by default. Committee moderation applies.
            </Text>
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

          <View>
            <SectionLabel trailing={<Text variant="caption" tone="muted">Optional</Text>}>
              Apply link
            </SectionLabel>
            <FieldInput
              value={applyLink}
              onChangeText={setApplyLink}
              placeholder="https://your-company.com/careers/role"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <LinkSimple size={12} color={theme.colors.ink[60]} weight="bold" />
              <Text variant="caption" tone={applyLinkValid ? 'muted' : 'danger'}>
                {applyLinkValid
                  ? 'A form or careers page link neighbours can tap to apply.'
                  : 'Enter a full link starting with http:// or https://'}
              </Text>
            </View>
          </View>

          <Button
            label={mutation.isPending ? 'Posting' : 'Publish'}
            onPress={submit}
            disabled={!canSubmit}
            loading={mutation.isPending}
            success={succeeded}
            successLabel="Posted"
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
