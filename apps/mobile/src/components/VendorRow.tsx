import React from 'react';
import { View, Pressable } from 'react-native';
import { Star, ShieldCheck, Storefront, CaretRight } from '../icons/phosphor';
import type { VendorDetail } from '@sft/api-client';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Vendor row. Category chips, rating (mono for numeric consistency), and
 * a verification badge — SOCIETY_ATTESTED / PLATFORM_AUDITED get an accent
 * shield, UNVERIFIED shows nothing so the trust signal reads as earned.
 */
export function VendorRow({
  vendor,
  onPress,
}: {
  vendor: VendorDetail;
  onPress: () => void;
}) {
  const theme = useTheme();
  const rating = typeof vendor.ratingAvg === 'string' ? Number(vendor.ratingAvg) : vendor.ratingAvg;
  const hasRating = vendor.ratingCount > 0 && rating > 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.bg.elevated,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.md,
        opacity: pressed ? 0.94 : 1,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        gap: theme.spacing.sm,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Storefront size={22} color={theme.colors.accent[700]} weight="duotone" />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
              {vendor.name}
            </Text>
            <TierBadge tier={vendor.verificationTier} />
          </View>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Star size={14} color={theme.colors.feedback.warning} weight="fill" />
              <Text variant="caption" weight="semibold" mono tone="secondary">
                {rating.toFixed(1)}
              </Text>
              <Text variant="caption" tone="muted">
                ({vendor.ratingCount} rating{vendor.ratingCount === 1 ? '' : 's'})
              </Text>
            </View>
          ) : (
            <Text variant="caption" tone="muted">Not yet rated</Text>
          )}
        </View>

        <CaretRight size={18} color={theme.colors.ink[40]} weight="bold" />
      </View>

      {vendor.categories.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {vendor.categories.slice(0, 4).map((c) => (
            <View
              key={c}
              style={{
                backgroundColor: theme.colors.bg.secondary,
                borderRadius: theme.radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              <Text variant="caption" weight="semibold" tone="secondary">{c}</Text>
            </View>
          ))}
          {vendor.categories.length > 4 ? (
            <Text variant="caption" tone="muted">+{vendor.categories.length - 4}</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function TierBadge({ tier }: { tier: VendorDetail['verificationTier'] }) {
  const theme = useTheme();
  if (tier === 'UNVERIFIED') return null;
  const label = tier === 'SOCIETY_ATTESTED' ? 'Society-verified' : 'Platform-audited';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: theme.colors.accent.tint,
        borderRadius: theme.radius.pill,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <ShieldCheck size={12} color={theme.colors.accent[700]} weight="fill" />
      <Text variant="caption" weight="semibold" tone="accent">{label}</Text>
    </View>
  );
}
