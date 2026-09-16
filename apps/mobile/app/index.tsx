import { Redirect } from 'expo-router';

/**
 * Root redirect. Auth branching moves here in F1 — for now the app opens on
 * the tab shell so we can see it running end-to-end.
 */
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
