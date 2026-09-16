import React from 'react';
import { Tabs } from 'expo-router';
import { House, Receipt, Handshake, Megaphone, User } from 'phosphor-react-native';
import { lightTheme } from '../../src/theme/theme';

/**
 * Five tabs — the reference layout. Order chosen for daily-use frequency:
 * Home, Bills, Requests (the core resident loop), Notices, Profile.
 */
export default function TabsLayout() {
  const t = lightTheme;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.accent[700],
        tabBarInactiveTintColor: t.colors.ink[40],
        tabBarLabelStyle: {
          fontFamily: t.fontFamily.sansSemibold,
          fontSize: 11,
          letterSpacing: 0.2,
          marginBottom: 4,
        },
        tabBarStyle: {
          backgroundColor: t.colors.bg.elevated,
          borderTopColor: t.colors.border.subtle,
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
            <House size={24} color={color} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: 'Bills',
          tabBarIcon: ({ color, focused }) => (
            <Receipt size={24} color={color} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ color, focused }) => (
            <Handshake size={24} color={color} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="notices"
        options={{
          title: 'Notices',
          tabBarIcon: ({ color, focused }) => (
            <Megaphone size={24} color={color} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <User size={24} color={color} weight={focused ? 'fill' : 'regular'} />
          ),
        }}
      />
    </Tabs>
  );
}
