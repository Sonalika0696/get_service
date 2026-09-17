import React, { useMemo, useState } from 'react';
import { View, ScrollView, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, MagnifyingGlass, Storefront } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { FilterChip } from '../../src/components/FilterChip';
import { VendorRow } from '../../src/components/VendorRow';
import { ListLoading, ListError, ListEmpty } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { VENDOR_CATEGORIES } from '../../src/lib/categories';
import { useVendors } from '../../src/hooks/useVendors';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Vendor directory. Category chips in a horizontal strip, free-text search
 * above, list beneath. Debouncing the search input is deferred until F9's
 * polish pass — at directory sizes (dozens per society) the extra requests
 * are cheap.
 */
export default function VendorsIndex() {
  const theme = useTheme();
  const router = useRouter();
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [q, setQ] = useState('');

  const query = useVendors({ category, q: q.trim() || undefined });

  const vendors = query.data ?? [];
  const empty = useMemo(
    () => query.isSuccess && vendors.length === 0,
    [query.isSuccess, vendors.length],
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View
        style={{
          paddingHorizontal: theme.screenPadding,
          paddingTop: theme.spacing.sm,
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button
            label="Back"
            variant="ghost"
            leftIcon={<ArrowLeft size={18} color={theme.colors.accent[700]} weight="bold" />}
            onPress={() => router.back()}
          />
        </View>
        <Text variant="display" weight="semibold">Vendors</Text>
        <Text variant="body" tone="secondary">
          Committee-onboarded for your society. Rate after work; ratings are visible to everyone.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
            backgroundColor: theme.colors.bg.elevated,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.border.subtle,
          }}
        >
          <MagnifyingGlass size={18} color={theme.colors.ink[60]} weight="regular" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name"
            placeholderTextColor={theme.colors.ink[40]}
            style={{
              flex: 1,
              paddingVertical: 12,
              fontFamily: theme.fontFamily.sans,
              fontSize: theme.fontSize.body.size,
              color: theme.colors.ink[100],
            }}
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingVertical: theme.spacing.md,
          gap: 8,
        }}
      >
        <FilterChip label="All" active={!category} onPress={() => setCategory(undefined)} />
        {VENDOR_CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            label={c}
            active={category === c}
            onPress={() => setCategory(category === c ? undefined : c)}
          />
        ))}
      </ScrollView>

      {/* Virtualised: the directory can grow to hundreds in a large society,
          so only on-screen rows mount. Visuals are identical to before. */}
      <FlatList
        data={vendors}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => (
          <VendorRow vendor={item} onPress={() => router.push(`/vendors/${item.id}`)} />
        )}
        contentContainerStyle={{
          paddingHorizontal: theme.screenPadding,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={
          query.isLoading ? (
            <ListLoading label="Loading vendors" />
          ) : query.isError ? (
            <ListError
              message={
                (query.error as { message?: string } | null)?.message ??
                'Vendors aren\'t reachable right now. Check your connection and try again.'
              }
              onRetry={() => query.refetch()}
            />
          ) : empty ? (
            <ListEmpty
              Icon={Storefront}
              illustration="vendors"
              title="No vendors here yet"
              body={
                category
                  ? `No one onboarded under ${category} yet. Try another category, or ask your committee.`
                  : 'Your committee hasn\'t onboarded anyone yet. Ping them from the notices tab.'
              }
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}
