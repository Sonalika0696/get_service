import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/components/Text';
import { TabsContext, TAB_NAMES, type TabName } from '../../src/sections/TabsContext';
import { TabsPager } from '../../src/sections/TabsPager';
import { TAB_ICONS } from '../../src/components/icons/TabIcons';
import { useCommunityUnread } from '../../src/realtime/RealtimeProvider';
import HomeSection from '../../src/sections/HomeSection';
import BillsSection from '../../src/sections/BillsSection';
import RequestsSection from '../../src/sections/RequestsSection';
import NoticesSection from '../../src/sections/NoticesSection';
import ProfileSection from '../../src/sections/ProfileSection';

// Memoised so a section never re-renders just because the host re-rendered
// (the active index changes on every scroll frame during a swipe). Each
// section takes no props, so React.memo keeps them stable — they only
// re-render on their own hook/state changes. Keeps the swipe cheap.
const PAGES = [HomeSection, BillsSection, RequestsSection, NoticesSection, ProfileSection].map(
  (P) => React.memo(P),
);
const LABELS = ['Home', 'Bills', 'Requests', 'Community', 'Profile'];
const COMMUNITY_INDEX = TAB_NAMES.indexOf('notices');

/**
 * The five sections hosted in a single PagerView, so swipe is drag-follow
 * (adjacent sections are physically connected) and tab taps animate the
 * page across — no remount, so no tap lag. SDK 57 decoupled expo-router
 * from react-navigation, so this replaces the old Tabs navigator entirely.
 * In-app links to a sibling tab go through TabsContext.goTo (instant);
 * deep links from outside pass `?tab=<name>`.
 */
export default function TabsHost() {
  const [index, setIndex] = useState(0);
  const params = useLocalSearchParams<{ tab?: string }>();
  const { unread: communityUnread, markSeen: markCommunitySeen } = useCommunityUnread();

  useEffect(() => {
    if (typeof params.tab === 'string') {
      const i = TAB_NAMES.indexOf(params.tab as TabName);
      if (i >= 0) setIndex(i);
    }
  }, [params.tab]);

  // Clears the Community badge whenever that tab is the one on screen —
  // whether the user just switched to it or was already there when an
  // update arrived (RealtimeProvider always sets `unread`; this is the only
  // place it gets cleared).
  useEffect(() => {
    if (index === COMMUNITY_INDEX) markCommunitySeen();
  }, [index, markCommunitySeen]);

  const goTo = useCallback((name: TabName) => {
    const i = TAB_NAMES.indexOf(name);
    if (i >= 0) setIndex(i);
  }, []);

  const theme = useTheme();
  const renderPage = useCallback((i: number) => {
    const Page = PAGES[i];
    return <Page />;
  }, []);

  return (
    <TabsContext.Provider value={{ index, goTo }}>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg.primary }}>
        <TabsPager
          index={index}
          onIndexChange={setIndex}
          pageCount={PAGES.length}
          renderPage={renderPage}
        />
        <BottomBar index={index} onSelect={setIndex} communityUnread={communityUnread} />
      </View>
    </TabsContext.Provider>
  );
}

/**
 * Floating, elevated nav bar: a rounded pill detached from the screen edges
 * with a soft shadow, and an accent-tinted pill behind the active tab so the
 * selection reads at a glance (reference-inspired). Also shows a small dot
 * badge on the Community icon when a society-event update hasn't been seen
 * yet — suppressed while that tab is the active one, since opening it (or
 * already being on it) clears the unread state.
 */
function BottomBar({
  index,
  onSelect,
  communityUnread,
}: {
  index: number;
  onSelect: (i: number) => void;
  communityUnread: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingBottom: insets.bottom > 0 ? insets.bottom : theme.spacing.sm,
        paddingTop: theme.spacing.xs,
        backgroundColor: 'transparent',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.colors.bg.elevated,
          borderRadius: theme.radius.xxxl,
          paddingVertical: 8,
          paddingHorizontal: 6,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
          ...theme.shadows.lg.native,
        }}
      >
        {TAB_ICONS.map((Icon, i) => {
          const active = i === index;
          const color = active ? theme.colors.accent[700] : theme.colors.ink[40];
          // Only badge the Community tab, and only while it isn't the one
          // on screen — being on it already implies "seen".
          const showBadge = i === COMMUNITY_INDEX && communityUnread && !active;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={showBadge ? `${LABELS[i]}, new updates` : `${LABELS[i]} tab`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(i)}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  paddingVertical: 7,
                  paddingHorizontal: 2,
                  // A distinct, clearly-rounded pill behind the active tab.
                  // The horizontal margin pulls it in from the cell edges so
                  // it reads as a separated rounded pill rather than a
                  // full-width bar (which looked square edge-to-edge).
                  borderRadius: theme.radius.xl,
                  marginHorizontal: 6,
                  minHeight: 44,
                  alignSelf: 'stretch',
                  backgroundColor: active ? theme.colors.accent.tint : 'transparent',
                }}
              >
                <View style={{ position: 'relative' }}>
                  <Icon size={23} color={color} active={active} />
                  {showBadge && (
                    <View
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -3,
                        width: 9,
                        height: 9,
                        borderRadius: 5,
                        backgroundColor: theme.colors.feedback.danger,
                        borderWidth: 1,
                        borderColor: theme.colors.bg.elevated,
                      }}
                    />
                  )}
                </View>
                <Text
                  weight="semibold"
                  numberOfLines={1}
                  style={{ fontSize: 10, lineHeight: 13, color }}
                >
                  {LABELS[i]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
