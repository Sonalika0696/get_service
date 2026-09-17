import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts, Sora_400Regular, Sora_600SemiBold } from '@expo-google-fonts/sora';
import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { ThemeProvider, useTheme, useThemeControls } from '../src/theme/ThemeProvider';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { queryClient, queryPersister } from '../src/lib/query';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { RealtimeProvider } from '../src/realtime/RealtimeProvider';
import { BrandLoader } from '../src/components/brand/BrandLoader';
import { lightTheme } from '../src/theme/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Sora: Sora_400Regular,
    'Sora-SemiBold': Sora_600SemiBold,
    JetBrainsMono: JetBrainsMono_400Regular,
    'JetBrainsMono-SemiBold': JetBrainsMono_600SemiBold,
  });

  const fontsSettled = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled]);

  // Native: hold the splash until fonts are ready (fast + reliable there).
  // Web: font loading via @expo-google-fonts can hang without ever
  // resolving or erroring, which would leave a permanent blank screen, so
  // render immediately and let the webfonts swap in when they arrive.
  if (!fontsSettled && Platform.OS !== 'web') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: 24 * 60 * 60 * 1000 }}
          // Mutations paused offline in a *previous* session are restored
          // alongside the query cache but don't resume themselves — kick
          // them once the restore completes. Mutations paused offline in
          // the *current* session already auto-resume via onlineManager
          // (see src/lib/query.ts); this covers the cold-start case.
          onSuccess={() => {
            queryClient.resumePausedMutations().catch(() => undefined);
          }}
        >
          <ThemeProvider>
            <ErrorBoundary>
              <AuthProvider>
                <RealtimeProvider>
                  <ThemedStatusBar />
                  <AuthGate>
                    <ThemedStack />
                  </AuthGate>
                </RealtimeProvider>
              </AuthProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Reflects the resolved theme in the OS status bar: light icons/text on the
 * dark theme's dark surfaces, dark icons/text on the light theme's light
 * ones. Rendered as its own component because `useThemeControls` needs a
 * descendant of `ThemeProvider`, not `RootLayout` itself.
 */
function ThemedStatusBar() {
  const { resolved } = useThemeControls();
  return <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Wraps `Stack` so its `contentStyle` background tracks the resolved theme
 * instead of a hardcoded light-mode hex value. Same rationale as
 * `ThemedStatusBar` above: needs to sit under `ThemeProvider` to read it.
 */
function ThemedStack() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.bg.primary },
        animation: 'slide_from_right',
      }}
    />
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
      <BrandLoader height={56} />
    </View>
  );
}
