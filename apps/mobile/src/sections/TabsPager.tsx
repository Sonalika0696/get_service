import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';

/**
 * Drag-follow section swiper on a horizontal, paging ScrollView — native-
 * thread paging that works on iOS, Android and web (unlike react-native-
 * pager-view, which has no web build). Adjacent sections are physically
 * connected: the finger drags the content and it snaps to the nearest page.
 *
 * Highlight timing + no feedback loop: the active index is only derived from
 * the scroll position WHILE the user is dragging (`dragging` ref set by
 * onScrollBeginDrag). A programmatic scroll from a tab tap does NOT trigger
 * onScrollBeginDrag, so onScroll ignores it — that's what stops a fast
 * double-tap from bouncing the pager left/right forever. The `fromScroll`
 * ref tells the controlled-index effect when an index change came from a
 * swipe (don't re-scroll) vs a tap (scroll to it).
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

  const settled = useRef(index);
  const dragging = useRef(false);
  const fromScroll = useRef(false);

  useEffect(() => {
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    if (index !== settled.current) {
      settled.current = index;
      ref.current?.scrollTo({ x: index * width, animated: true });
    }
    setMounted((prev) => union(prev, neighbours(index, pageCount)));
  }, [index, width, pageCount]);

  const reportPage = useCallback(
    (offsetX: number) => {
      const page = Math.round(offsetX / width);
      if (page !== settled.current && page >= 0 && page < pageCount) {
        settled.current = page;
        fromScroll.current = true;
        onIndexChange(page);
      }
    },
    [width, pageCount, onIndexChange],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Only follow the scroll for the highlight while the USER is dragging;
      // ignore programmatic (tab-tap) scrolls so they can't feed back.
      if (!dragging.current) return;
      reportPage(e.nativeEvent.contentOffset.x);
    },
    [reportPage],
  );

  const onBeginDrag = useCallback(() => {
    dragging.current = true;
  }, []);

  const onSettle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      dragging.current = false;
      reportPage(e.nativeEvent.contentOffset.x);
    },
    [reportPage],
  );

  return (
    <ScrollView
      ref={ref}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      onScrollBeginDrag={onBeginDrag}
      onScrollEndDrag={onSettle}
      onMomentumScrollEnd={onSettle}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
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
