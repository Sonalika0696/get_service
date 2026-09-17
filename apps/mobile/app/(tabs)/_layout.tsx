import React from 'react';
import { Stack } from 'expo-router';

/**
 * The (tabs) group is now a single host route (index.tsx) that renders the
 * five sections inside a PagerView with its own bottom bar, so this layout
 * is just a headerless Stack. The old expo-router Tabs navigator was
 * removed: SDK 57 decoupled expo-router from react-navigation, and a
 * PagerView gives the drag-follow swipe the Tabs navigator can't.
 */
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
