import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import PagerView from 'react-native-pager-view';

/**
 * Native pager: real drag-follow swipe between sections (adjacent pages are
 * physically connected) plus animated jumps when `index` changes from a tab
 * tap or an in-app link. Controlled by `index`; reports swipes via
 * `onIndexChange`. Isolated in a `.native` file because react-native-pager-
 * view can't bundle for web.
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
  const ref = useRef<PagerView>(null);

  useEffect(() => {
    ref.current?.setPage(index);
  }, [index]);

  return (
    <PagerView
      ref={ref}
      style={{ flex: 1 }}
      initialPage={index}
      overdrag
      onPageSelected={(e) => onIndexChange(e.nativeEvent.position)}
    >
      {Array.from({ length: pageCount }).map((_, i) => (
        <View key={i} style={{ flex: 1 }} collapsable={false}>
          {renderPage(i)}
        </View>
      ))}
    </PagerView>
  );
}
