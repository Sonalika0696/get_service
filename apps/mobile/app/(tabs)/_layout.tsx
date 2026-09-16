import React from 'react';
import { Tabs } from 'expo-router';
import { House, Receipt, Handshake, Megaphone, User } from 'phosphor-react-native';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Five tabs, ordered by daily-use frequency: Home, Bills, Requests, Notices,
 * Profile. Uses expo-router's own Tabs — SDK 56+ decoupled expo-router from
 * react-navigation, so the material-top-tabs `withLayoutContext` swipe
 * pattern no longer bundles. Horizontal swipe between tabs is added at the
 * screen level via the `SwipeableTabs` wrapper. The bar reads the live
 * theme so it follows light/dark.
 */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent[700],
        tabBarInactiveTintColor: theme.colors.ink[40],
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.sansSemibold,
          fontSize: 11,
          letterSpacing: 0.2,
          marginBottom: 4,
        },
        tabBarStyle: {
          backgroundColor: theme.colors.bg.elevated,
          borderTopColor: theme.colors.border.subtle,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <House size={24} color={color as string} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: 'Bills',
          tabBarIcon: ({ color, focused }) => (
            <Receipt size={24} color={color as string} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ color, focused }) => (
            <Handshake size={24} color={color as string} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="notices"
        options={{
          title: 'Notices',
          tabBarIcon: ({ color, focused }) => (
            <Megaphone size={24} color={color as string} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <User size={24} color={color as string} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
    </Tabs>
  );
}
