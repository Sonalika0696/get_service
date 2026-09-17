import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';

/**
 * Drag-follow section swiper built on a horizontal, paging ScrollView — the
 * native-thread paging path (works on iOS, Android AND web via
 * react-native-web, unlike react-native-pager-view which has no web build).
 * Adjacent sections are physically connected: the finger drags the content
 * and it snaps to the nearest page with native momentum.
 *
 * Controlled by `index`: a tab tap / in-app link animates `scrollTo`; a
 * swipe reports the settled page via `onIndexChange`. Only the active page
 * and its immediate neighbours mount their content (lazy) so five sections'
 * worth of lists/queries don't all spin up at once.
 */
export function TabsPager({
  index,
  onIndexChange,
  pageCount,
  renderPage,
}: {
  index: number;
  onIndexChange: (i: number) => void;
  pageCount: number;
  renderPage: (i: number) => React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const [mounted, setMounted] = useState<Set<number>>(() => neighbours(0, pageCount));

  // Animate to the controlled index (tab tap / goTo). A swipe already moved
  // the ScrollView, so this is a no-op in that case (same offset).
  useEffect(() => {
    ref.current?.scrollTo({ x: index * width, animated: true });
    setMounted((prev) => union(prev, neighbours(index, pageCount)));
  }, [index, width, pageCount]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) onIndexChange(i);
  };

  return (
    <ScrollView
      ref={ref}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumEnd}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      // Keep the initial page aligned before the first layout pass.
      contentOffset={{ x: index * width, y: 0 }}
    >
      {Array.from({ length: pageCount }).map((_, i) => (
        <View key={i} style={{ width }}>
          {mounted.has(i) ? renderPage(i) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function neighbours(i: number, count: number): Set<number> {
  const s = new Set<number>();
  for (let k = i - 1; k <= i + 1; k++) {
    if (k >= 0 && k < count) s.add(k);
  }
  return s;
}

function union(a: Set<number>, b: Set<number>): Set<number> {
  const s = new Set(a);
  for (const v of b) s.add(v);
  return s;
}
