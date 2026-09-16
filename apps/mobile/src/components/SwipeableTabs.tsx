import React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRouter, type Href } from 'expo-router';

/**
 * Horizontal swipe between the five bottom tabs. expo-router (SDK 57) no
 * longer bundles the react-navigation material-top-tabs swipe pattern, so we
 * add the gesture ourselves: a Pan that only engages once horizontal travel
 * clears the vertical scroll (activeOffsetX / failOffsetY), and on a decisive
 * left/right flick navigates to the adjacent tab.
 *
 * Wrap each tab screen's content in `<SwipeableTabs index={n}>`. The gesture
 * callback is marked `runOnJS` so it can call the router directly.
 */
const TAB_ROUTES: Href[] = [
  '/(tabs)',
  '/(tabs)/bills',
  '/(tabs)/requests',
  '/(tabs)/notices',
  '/(tabs)/profile',
];

const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 350;

export function SwipeableTabs({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const go = (next: number) => {
    if (next < 0 || next >= TAB_ROUTES.length || next === index) return;
    router.navigate(TAB_ROUTES[next]);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-16, 16])
    .runOnJS(true)
    .onEnd((e) => {
      const decisive =
        Math.abs(e.translationX) > SWIPE_DISTANCE || Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (!decisive) return;
      if (e.translationX < 0) go(index + 1);
      else go(index - 1);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}
