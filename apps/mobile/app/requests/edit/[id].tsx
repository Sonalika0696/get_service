import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from '../../../src/icons/phosphor';
import { Text } from '../../../src/components/Text';
import { Button } from '../../../src/components/Button';
import { SectionLabel } from '../../../src/components/SectionLabel';
import { ListLoading, ListError } from '../../../src/components/ListState';
import { useResidentPoll, useUpdateResidentPoll } from '../../../src/hooks/useResidentPolls';
import { useTheme } from '../../../src/theme/ThemeProvider';

const CLOSE_OPTIONS = [
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
];

/**
 * Edit a poll the resident created. Title / details are always editable; the
 * close window can be reset from now. Vendor and category are structural and
 * stay fixed. Saving hits PATCH /bulk-buy/polls/:id (see the backend gap note
 * in useResidentPolls).
 */
export default function EditRequest() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useResidentPoll(id);
  const mutation = useUpdateResidentPoll(id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [closeHours, setCloseHours] = useState<number | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Prefill once when the poll arrives.
  useEffect(() => {
    if (query.data && !hydrated) {
      setTitle(query.data.title);
      setDescription(query.data.description ?? '');
      setHydrated(true);
    }
  }, [query.data, hydrated]);

  const canSubmit = hydrated && title.trim().length >= 3 && !mutation.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const body: { title?: string; description?: string | null; closesAt?: string } = {
      title: title.trim(),
      description: description.trim() || null,
    };
    if (closeHours != null) {
      body.closesAt = new Date(Date.now() + closeHours * 3600 * 1000).toISOString();
    }
    mutation.mutate(body, {
      onSuccess: () => {
        setSucceeded(true);
        setTimeout(() => router.back(), 900);
      },
      onError: (err) => {
        const message =
          (err as { message?: string } | null)?.message ??
          'Could not save your changes right now.';
        Alert.alert('Could not save', message);
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
            <Text variant="display" weight="semibold">Edit request</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              Update the title, details, or how long it stays open. The vendor and
              category can't change once it's live.
            </Text>
          </View>

          {query.isLoading ? <ListLoading label="Loading request" /> : null}
          {query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'Could not load this request.'
              }
              onRetry={() => query.refetch()}
            />
          ) : null}

          {hydrated ? (
            <>
              <View>
                <SectionLabel>Title</SectionLabel>
                <FieldInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Deep-clean tank on the roof"
                  maxLength={200}
                />
              </View>

              <View>
                <SectionLabel>Details (optional)</SectionLabel>
                <FieldInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Scope, timing preferences, anything vendors should know…"
                  maxLength={5000}
                  multiline
                  minHeight={100}
                />
              </View>

              <View>
                <SectionLabel trailing={<Text variant="caption" tone="muted">Optional</Text>}>
                  Reset close window
                </SectionLabel>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {CLOSE_OPTIONS.map((o) => (
                    <View key={o.hours} style={{ flex: 1 }}>
                      <CloseChoice
                        label={o.label}
                        active={closeHours === o.hours}
                        onPress={() =>
                          setCloseHours((cur) => (cur === o.hours ? null : o.hours))
                        }
                      />
                    </View>
                  ))}
                </View>
              </View>

              <Button
                label={mutation.isPending ? 'Saving' : 'Save changes'}
                onPress={submit}
                disabled={!canSubmit}
                loading={mutation.isPending}
                success={succeeded}
                successLabel="Saved"
                fullWidth
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CloseChoice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      onTouchEnd={onPress}
      style={{
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: theme.radius.lg,
        backgroundColor: active ? theme.colors.accent.tint : theme.colors.bg.elevated,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent[700] : theme.colors.border.subtle,
      }}
    >
      <Text variant="body" weight="semibold" tone={active ? 'accent' : 'secondary'}>
        {label}
      </Text>
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
