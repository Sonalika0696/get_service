import React from 'react';
import { View, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Phone,
  EnvelopeSimple,
  MapPin,
  ShieldCheck,
  Star,
  Storefront,
  Receipt,
  CaretRight,
} from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionLabel } from '../../src/components/SectionLabel';
import { ListLoading, ListError } from '../../src/components/ListState';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useVendor } from '../../src/hooks/useVendors';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Vendor detail. Read-only for F2 — rating writes land in F4 once the
 * job-card lifecycle exists, since backend/src/modules/vendors already
 * signals that gating rating on a completed job is the next iteration.
 */
export default function VendorDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useVendor(id);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
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
        showsVerticalScrollIndicator={false}
      >
        {query.isLoading ? <ListLoading label="Loading vendor" /> : null}
        {query.isError ? (
          <ListError
            message={
              (query.error as { message?: string } | null)?.message ?? 'Could not load this vendor.'
            }
            onRetry={() => query.refetch()}
          />
        ) : null}

        {query.data ? <VendorBody vendor={query.data} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function VendorBody({ vendor }: { vendor: NonNullable<ReturnType<typeof useVendor>['data']> }) {
  const theme = useTheme();
  const rating = typeof vendor.ratingAvg === 'string' ? Number(vendor.ratingAvg) : vendor.ratingAvg;

  return (
    <>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Storefront size={32} color={theme.colors.accent[700]} weight="duotone" />
        </View>
        <Text variant="display" weight="semibold">{vendor.name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {vendor.categories.map((c) => (
            <View
              key={c}
              style={{
                backgroundColor: theme.colors.bg.secondary,
                borderRadius: theme.radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text variant="caption" weight="semibold" tone="secondary">{c}</Text>
            </View>
          ))}
        </View>
      </View>

      <Card padded={theme.spacing.md}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted" weight="semibold">Rating</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
              <Star size={16} color={theme.colors.feedback.warning} weight="fill" />
              <Text variant="heading" weight="semibold" mono>
                {vendor.ratingCount > 0 ? rating.toFixed(1) : '—'}
              </Text>
              <Text variant="caption" tone="muted">
                {vendor.ratingCount} rating{vendor.ratingCount === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted" weight="semibold">Verification</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <ShieldCheck
                size={16}
                color={vendor.verificationTier === 'UNVERIFIED' ? theme.colors.ink[40] : theme.colors.accent[700]}
                weight={vendor.verificationTier === 'UNVERIFIED' ? 'regular' : 'fill'}
              />
              <Text variant="body" weight="semibold" tone="secondary">
                {tierLabel(vendor.verificationTier)}
              </Text>
            </View>
          </View>
        </View>
      </Card>

      <View>
        <SectionLabel>Contact</SectionLabel>
        <View style={{ gap: theme.spacing.sm }}>
          {vendor.contactPhone ? (
            <Button
              label={vendor.contactPhone}
              variant="secondary"
              leftIcon={<Phone size={18} color={theme.colors.accent[700]} weight="regular" />}
              onPress={() => Linking.openURL(`tel:${vendor.contactPhone}`)}
              fullWidth
            />
          ) : null}
          {vendor.contactEmail ? (
            <Button
              label={vendor.contactEmail}
              variant="secondary"
              leftIcon={<EnvelopeSimple size={18} color={theme.colors.accent[700]} weight="regular" />}
              onPress={() => Linking.openURL(`mailto:${vendor.contactEmail}`)}
              fullWidth
            />
          ) : null}
          {vendor.latitude && vendor.longitude ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: theme.spacing.sm,
              }}
            >
              <MapPin size={18} color={theme.colors.ink[60]} weight="duotone" />
              <Text variant="caption" tone="secondary" mono>
                {vendor.latitude.toFixed(4)}, {vendor.longitude.toFixed(4)}
                {vendor.radiusKm ? ` · ${vendor.radiusKm} km` : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <PricingCardLink vendorId={vendor.id} />

      <View>
        <SectionLabel>How to engage</SectionLabel>
        <Text variant="body" tone="secondary">
          Raise a request from the Requests tab and pool with your neighbours. The committee assigns
          a vendor from this directory once the participation threshold is reached.
        </Text>
      </View>
    </>
  );
}

function PricingCardLink({ vendorId }: { vendorId: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View>
      <SectionLabel>Pricing card</SectionLabel>
      <View
        onTouchEnd={() => router.push(`/vendors/${vendorId}/pricing` as never)}
        style={{
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
          padding: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <Receipt size={22} color={theme.colors.accent[700]} weight="duotone" />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">Current pricing card</Text>
          <Text variant="caption" tone="muted">
            Visit charge, labour, materials, GST — line by line
          </Text>
        </View>
        <CaretRight size={16} color={theme.colors.ink[40]} weight="bold" />
      </View>
    </View>
  );
}

function tierLabel(tier: string): string {
  switch (tier) {
    case 'SOCIETY_ATTESTED': return 'Society-verified';
    case 'PLATFORM_AUDITED': return 'Platform-audited';
    default: return 'Unverified';
  }
}
