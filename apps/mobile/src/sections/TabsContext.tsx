import { createContext, useContext } from 'react';

export type TabName = 'home' | 'bills' | 'requests' | 'notices' | 'profile';

export const TAB_NAMES: TabName[] = ['home', 'bills', 'requests', 'notices', 'profile'];

type TabsContextValue = {
  index: number;
  goTo: (name: TabName) => void;
};

export const TabsContext = createContext<TabsContextValue>({
  index: 0,
  goTo: () => undefined,
});

/**
 * Lets a section switch to a sibling tab through the pager (instant, no
 * remount) instead of a router navigation. Sections that link to another
 * tab call `useTabs().goTo('requests')`.
 */
export function useTabs(): TabsContextValue {
  return useContext(TabsContext);
}
