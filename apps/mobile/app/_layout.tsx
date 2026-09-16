import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts, Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { queryClient, queryPersister } from '../src/lib/query';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { lightTheme } from '../src/theme/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    'Inter-SemiBold': Inter_600SemiBold,
    JetBrainsMono: JetBrainsMono_400Regular,
    'JetBrainsMono-SemiBold': JetBrainsMono_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: 24 * 60 * 60 * 1000 }}
        >
          <ThemeProvider>
            <ErrorBoundary>
              <AuthProvider>
                <StatusBar style="dark" />
                <AuthGate>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: '#FBF8F4' },
                      animation: 'slide_from_right',
                    }}
                  />
                </AuthGate>
              </AuthProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Route guard: while auth status is being resolved, show a splash; then push
 * the user to the auth stack if signed out, or into the tabs if signed in.
 * We drive the router with `useSegments` rather than a redirect component so
 * the guard survives across route changes (a signed-in user tapping a deep
 * link into /auth/sign-in gets bounced back into the tabs, and vice versa).
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const inAuthGroup = segments[0] === 'auth';

  useEffect(() => {
    if (status.kind === 'unknown') return;
    if (status.kind === 'signed-out' && !inAuthGroup) {
      router.replace('/auth/sign-in');
    } else if (status.kind === 'signed-in' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [status.kind, inAuthGroup, router]);

  if (status.kind === 'unknown') return <SplashPlaceholder />;
  return <>{children}</>;
}

function SplashPlaceholder() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: lightTheme.colors.bg.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={lightTheme.colors.accent[700]} />
    </View>
  );
}
