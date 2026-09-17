import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CaretDown,
  Storefront,
  CheckCircle,
} from '../../src/icons/phosphor';
import type { VendorDetail } from '@sft/api-client';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { SectionLabel } from '../../src/components/SectionLabel';
import { FilterChip } from '../../src/components/FilterChip';
import { VENDOR_CATEGORIES } from '../../src/lib/categories';
import { useVendors } from '../../src/hooks/useVendors';
import { useCreateResidentPoll } from '../../src/hooks/useResidentPolls';
import { useTheme } from '../../src/theme/ThemeProvider';

const CLOSE_OPTIONS = [
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
];

export default function ComposeRequest() {
  const theme = useTheme();
  const router = useRouter();

  const [category, setCategory] = useState<string | null>(null);
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [closeHours, setCloseHours] = useState(168);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const vendors = useVendors(category ? { category } : {});
  const vendorList = vendors.data ?? [];
  const mutation = useCreateResidentPoll();

  const canSubmit =
    Boolean(vendor) &&
    Boolean(category) &&
    title.trim().length >= 3;

  const submit = () => {
    if (!canSubmit || !vendor || !category) return;
    const closesAt = new Date(Date.now() + closeHours * 3600 * 1000).toISOString();
    mutation.mutate(
      {
        taggedVendorId: vendor.id,
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        // The resident does not choose the fire threshold — the vendor sets
        // it at confirmation. The backend requires a value here (min 2), so
        // we send the floor as a placeholder it will overwrite.
        proposedMinimum: 2,
        closesAt,
      },
      {
        onSuccess: (created) => {
          setSucceeded(true);
          setTimeout(() => router.replace(`/requests/${created.id}`), 900);
        },
        onError: (err) => {
          const message =
            (err as { message?: string } | null)?.message ??
            'Could not raise this request.';
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
            <Text variant="display" weight="semibold">Raise a request</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              Tag a vendor and describe what you need. The vendor sets how many
              neighbours it takes to fire when they confirm.
            </Text>
          </View>

          <View>
            <SectionLabel>Category</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {VENDOR_CATEGORIES.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  active={category === c}
                  onPress={() => {
                    setCategory(category === c ? null : c);
                    if (vendor && !vendor.categories.includes(c)) setVendor(null);
                  }}
                />
              ))}
            </View>
          </View>

          <View>
            <SectionLabel>Vendor</SectionLabel>
            <VendorPicker
              vendor={vendor}
              category={category}
              open={pickerOpen}
              onToggle={() => setPickerOpen((x) => !x)}
              vendors={vendorList}
              loading={vendors.isLoading}
              onSelect={(v) => {
                setVendor(v);
                setPickerOpen(false);
              }}
            />
          </View>

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
            <SectionLabel>Closes in</SectionLabel>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {CLOSE_OPTIONS.map((o) => (
                <View key={o.hours} style={{ flex: 1 }}>
                  <CloseChoice
                    label={o.label}
                    active={closeHours === o.hours}
                    onPress={() => setCloseHours(o.hours)}
                  />
                </View>
              ))}
            </View>
          </View>

          <Button
            label={mutation.isPending ? 'Raising' : 'Raise this request'}
            onPress={submit}
            disabled={!canSubmit}
            loading={mutation.isPending}
            success={succeeded}
            successLabel="Raised"
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function VendorPicker({
  vendor,
  category,
  open,
  onToggle,
  vendors,
  loading,
  onSelect,
}: {
  vendor: VendorDetail | null;
  category: string | null;
  open: boolean;
  onToggle: () => void;
  vendors: VendorDetail[];
  loading: boolean;
  onSelect: (v: VendorDetail) => void;
}) {
  const theme = useTheme();
  // Attached-dropdown geometry: the open panel is bounded to ~4 rows and
  // scrolls the rest inside the same card, instead of floating a separate
  // card. This is the pattern for every in-form list picker in the app.
  const ROW_HEIGHT = 48;
  const VISIBLE_ROWS = 4;

  return (
    <View
      style={{
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: theme.spacing.md,
          opacity: pressed ? 0.94 : 1,
        })}
      >
        <Storefront size={20} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">
            {vendor ? vendor.name : category ? `Choose a ${category} vendor` : 'Pick a category first'}
          </Text>
          {vendor ? (
            <Text variant="caption" tone="muted">Tap to change</Text>
          ) : null}
        </View>
        <CaretDown
          size={16}
          color={theme.colors.ink[60]}
          weight="bold"
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.subtle }}>
          {loading ? (
            <Text variant="caption" tone="muted" style={{ padding: 14 }}>Loading vendors…</Text>
          ) : vendors.length === 0 ? (
            <Text variant="caption" tone="muted" style={{ padding: 14 }}>
              No vendors onboarded {category ? `under ${category}` : ''} yet. Ping your committee.
            </Text>
          ) : (
            <ScrollView
              style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={vendors.length > VISIBLE_ROWS}
            >
              {vendors.map((v, i) => (
                <Pressable
                  key={v.id}
                  onPress={() => onSelect(v)}
                  style={({ pressed }) => ({
                    height: ROW_HEIGHT,
                    paddingHorizontal: theme.spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: vendor?.id === v.id ? theme.colors.accent.tint : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: theme.colors.border.subtle,
                  })}
                >
                  <Text variant="body" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
                    {v.name}
                  </Text>
                  {vendor?.id === v.id ? (
                    <CheckCircle size={16} color={theme.colors.accent[700]} weight="fill" />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: theme.radius.lg,
        backgroundColor: active ? theme.colors.accent.tint : theme.colors.bg.elevated,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent[700] : theme.colors.border.subtle,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <Text variant="body" weight="semibold" tone={active ? 'accent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
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
