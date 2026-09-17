import React from 'react';

/**
 * Type surface for the platform-split TabsPager (TabsPager.native.tsx +
 * TabsPager.web.tsx). Metro resolves the platform file; TypeScript resolves
 * this declaration.
 */
export function TabsPager(props: {
  index: number;
  onIndexChange: (i: number) => void;
  pageCount: number;
  renderPage: (i: number) => React.ReactNode;
}): React.ReactElement;
