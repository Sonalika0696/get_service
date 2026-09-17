import React from 'react';
import { View } from 'react-native';
import { Warning } from '../icons/phosphor';
import { Text } from './Text';
import { Button } from './Button';
import { lightTheme } from '../theme/theme';

type State = { error: Error | null };

/**
 * Top-level error boundary. Kept plain (no theming hook) so it renders even
 * if the theme provider is the thing that crashed. Copy avoids blame.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production this ships to Sentry (wired in F0 close-out).
    if (__DEV__) console.error('ErrorBoundary caught', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const t = lightTheme;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.colors.bg.primary,
          padding: t.screenPadding,
          justifyContent: 'center',
          gap: t.spacing.lg,
        }}
      >
        <Warning size={40} color={t.colors.feedback.warning} weight="regular" />
        <Text variant="heading" weight="semibold">
          Something went sideways.
        </Text>
        <Text variant="body" tone="secondary">
          We couldn't render this screen. Try again, and if it happens twice, tell your committee.
        </Text>
        <Button label="Try again" onPress={this.reset} />
      </View>
    );
  }
}
