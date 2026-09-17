import React, { useState } from 'react';
import { View, ScrollView, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Question, CaretDown, ChatCircle } from '../../src/icons/phosphor';
import { Text } from '../../src/components/Text';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useTheme } from '../../src/theme/ThemeProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'When is my monthly bill generated?',
    a: 'Bills are raised by your committee at the start of each cycle. You will see it under Bills as soon as it is posted, with the due date and a breakup of charges.',
  },
  {
    q: 'How do I pay a bill?',
    a: 'Open the bill from the Bills tab and tap Pay. You can pay the full amount or, where allowed, a partial amount — the running balance updates instantly.',
  },
  {
    q: "What happens after I raise a service request?",
    a: 'Your request goes to the tagged vendor and to neighbours who can back it. Once enough residents confirm, the vendor is notified to proceed.',
  },
  {
    q: 'Who can see my payment history?',
    a: 'Only you and your society’s committee/treasurer can see your flat’s statement — never other residents.',
  },
  {
    q: "I think there's an error on my bill. What do I do?",
    a: 'Use Contact us to reach your committee directly with the flat number and bill period, and they will review it with you.',
  },
];

/**
 * Static FAQ list with a "Contact the committee" fallback for anything
 * these five answers don't cover.
 */
export default function Help() {
  const theme = useTheme();
  const router = useRouter();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenIndex((prev) => (prev === i ? null : i));
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
      <Stack.Screen options={{ headerShown: false }} />
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
      >
        <View>
          <Text variant="display" weight="semibold">Help & support</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
            Quick answers to the most common questions.
          </Text>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          {FAQS.map((item, i) => {
            const open = openIndex === i;
            return (
              <Card key={item.q} padded={0}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => toggle(i)}
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
                      width: 32,
                      height: 32,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.accent.tint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Question size={16} color={theme.colors.accent[700]} weight="duotone" />
                  </View>
                  <Text variant="body" weight="semibold" style={{ flex: 1 }}>{item.q}</Text>
                  <CaretDown
                    size={16}
                    color={theme.colors.ink[40]}
                    weight="bold"
                    style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
                  />
                </Pressable>
                {open ? (
                  <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}>
                    <Text variant="body" tone="secondary">{item.a}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>

        <View>
          <Text variant="body" tone="secondary" align="center" style={{ marginBottom: theme.spacing.sm }}>
            Didn't find what you're looking for?
          </Text>
          <Button
            label="Contact the committee"
            variant="secondary"
            leftIcon={<ChatCircle size={18} color={theme.colors.accent[700]} weight="bold" />}
            onPress={() => router.push('/account/contact')}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
