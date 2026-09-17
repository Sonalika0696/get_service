import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  // The page the ScrollView is actually showing. Tracked in a ref so the
  // controlled-index effect can tell a swipe (settled === index already)
  // from a programmatic change (tab tap) and only scrollTo for the latter —
  // otherwise the effect would fight the in-progress drag.
  const settled = useRef(index);

  useEffect(() => {
    if (index !== settled.current) {
      settled.current = index;
      ref.current?.scrollTo({ x: index * width, animated: true });
    }
    setMounted((prev) => union(prev, neighbours(index, pageCount)));
  }, [index, width, pageCount]);

  // Update the active tab the instant the swipe crosses a page boundary,
  // rather than waiting for momentum to fully settle (which lagged the
  // highlight by ~1s). Rounding flips at the halfway point, so the icon
  // lights up as the next section takes over the screen.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / width);
      if (page !== settled.current && page >= 0 && page < pageCount) {
        settled.current = page;
        onIndexChange(page);
      }
    },
    [width, pageCount, onIndexChange],
  );

  return (
    <ScrollView
      ref={ref}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
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
