import React from 'react';
import { View } from 'react-native';

/**
 * Web fallback: renders the active section only (no swipe — react-native-
 * pager-view has no web build). Tab taps still switch sections via the
 * controlled `index`. Native uses TabsPager.native with real drag-follow.
 */
export function TabsPager({
  index,
  renderPage,
}: {
  index: number;
  onIndexChange: (i: number) => void;
  pageCount: number;
  renderPage: (i: number) => React.ReactNode;
}) {
  return <View style={{ flex: 1 }}>{renderPage(index)}</View>;
}
