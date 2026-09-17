import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, Receipt, Handshake, Megaphone, User, type IconProps } from 'phosphor-react-native';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Text } from '../../src/components/Text';
import { TabsContext, TAB_NAMES, type TabName } from '../../src/sections/TabsContext';
import { TabsPager } from '../../src/sections/TabsPager';
import HomeSection from '../../src/sections/HomeSection';
import BillsSection from '../../src/sections/BillsSection';
import RequestsSection from '../../src/sections/RequestsSection';
import NoticesSection from '../../src/sections/NoticesSection';
import ProfileSection from '../../src/sections/ProfileSection';

const PAGES = [HomeSection, BillsSection, RequestsSection, NoticesSection, ProfileSection];
const ICONS: React.ComponentType<IconProps>[] = [House, Receipt, Handshake, Megaphone, User];
const LABELS = ['Home', 'Bills', 'Requests', 'Notices', 'Profile'];

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

  useEffect(() => {
    if (typeof params.tab === 'string') {
      const i = TAB_NAMES.indexOf(params.tab as TabName);
      if (i >= 0) setIndex(i);
    }
  }, [params.tab]);

  const goTo = useCallback((name: TabName) => {
    const i = TAB_NAMES.indexOf(name);
    if (i >= 0) setIndex(i);
  }, []);

  const renderPage = useCallback((i: number) => {
    const Page = PAGES[i];
    return <Page />;
  }, []);

  return (
    <TabsContext.Provider value={{ index, goTo }}>
      <View style={{ flex: 1 }}>
        <TabsPager
          index={index}
          onIndexChange={setIndex}
          pageCount={PAGES.length}
          renderPage={renderPage}
        />
        <BottomBar index={index} onSelect={setIndex} />
      </View>
    </TabsContext.Provider>
  );
}

function BottomBar({ index, onSelect }: { index: number; onSelect: (i: number) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.elevated,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.subtle,
        paddingTop: 8,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
      }}
    >
      {ICONS.map((Icon, i) => {
        const active = i === index;
        const color = active ? theme.colors.accent[700] : theme.colors.ink[40];
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(i)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48 }}
          >
            <Icon size={24} color={color} weight={active ? 'fill' : 'regular'} />
            <Text weight="semibold" style={{ fontSize: 11, lineHeight: 14, color }}>
              {LABELS[i]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
