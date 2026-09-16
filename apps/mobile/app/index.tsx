import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';

/**
 * Root redirect. AuthGate in _layout.tsx handles routing across the
 * signed-in/out boundary, but /index still needs a concrete destination for
 * the very first paint before AuthGate's effect fires.
 */
export default function Index() {
  const { isSignedIn } = useAuth();
  return <Redirect href={isSignedIn ? '/(tabs)' : '/auth/sign-in'} />;
}
