import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/theme';

export type SpotIllustrationName =
  | 'requests'
  | 'bills'
  | 'vendors'
  | 'events'
  | 'notices'
  | 'approvals';

export type SpotIllustrationProps = {
  name: SpotIllustrationName | (string & {});
  /** Pixel size of the square illustration. Defaults to 96. */
  size?: number;
};

type Palette = {
  backdrop: string;
  soft: string;
  mid: string;
  strong: string;
  accent2: string;
  ink: string;
};

function usePalette(theme: Theme): Palette {
  const colors = theme.colors;
  const ext = colors as unknown as { accent2?: { 300?: string; 500?: string; 700?: string } };
  return {
    backdrop: colors.accent.tint,
    soft: colors.accent[300],
    mid: colors.accent[500],
    strong: colors.accent[700],
    accent2: ext.accent2?.[500] ?? ext.accent2?.[700] ?? colors.accent[700],
    ink: colors.ink[100],
  };
}

/**
 * Small, friendly, flat spot illustrations for empty states. Each scene is
 * drawn on a soft rounded-square backdrop in 2-4 accent-tinted colours and
 * stays legible from ~72px up to ~120px.
 */
export function SpotIllustration({ name, size = 96 }: SpotIllustrationProps): React.JSX.Element {
  const theme = useTheme();
  const p = usePalette(theme);
  const r = theme.radius.xxl * (size / 96);

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Rect x={0} y={0} width={96} height={96} rx={r} fill={p.backdrop} />
      {renderScene(name, p)}
    </Svg>
  );
}

function renderScene(name: SpotIllustrationProps['name'], p: Palette): React.JSX.Element {
  switch (name) {
    case 'requests':
      return <RequestsScene p={p} />;
    case 'bills':
      return <BillsScene p={p} />;
    case 'vendors':
      return <VendorsScene p={p} />;
    case 'events':
      return <EventsScene p={p} />;
    case 'notices':
      return <NoticesScene p={p} />;
    case 'approvals':
      return <ApprovalsScene p={p} />;
    default:
      return <DefaultScene p={p} />;
  }
}

/** Two clasping hands — pooled / shared service requests. */
function RequestsScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Rect x={20} y={44} width={30} height={14} rx={7} fill={p.mid} transform="rotate(-18 20 44)" />
      <Rect x={46} y={44} width={30} height={14} rx={7} fill={p.accent2} transform="rotate(18 46 44)" />
      <Circle cx={48} cy={51} r={7} fill={p.strong} />
      <Circle cx={26} cy={30} r={4} fill={p.soft} />
      <Circle cx={70} cy={30} r={3} fill={p.soft} />
    </>
  );
}

/** Receipt with itemised lines + a coin. */
function BillsScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Path
        d="M30 20 H66 V70 L61 66 L56 70 L51 66 L46 70 L41 66 L36 70 L30 66 Z"
        fill="#FFFFFF"
        stroke={p.strong}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect x={37} y={30} width={22} height={3} rx={1.5} fill={p.soft} />
      <Rect x={37} y={38} width={22} height={3} rx={1.5} fill={p.soft} />
      <Rect x={37} y={46} width={14} height={3} rx={1.5} fill={p.soft} />
      <Circle cx={68} cy={58} r={13} fill={p.mid} />
      <Path d="M63 58 h10 M68 53 v10" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
    </>
  );
}

/** Storefront with a scalloped awning. */
function VendorsScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Rect x={24} y={44} width={48} height={28} rx={3} fill="#FFFFFF" stroke={p.strong} strokeWidth={2} />
      <Path
        d="M22 44 L26 30 H70 L74 44 Z"
        fill={p.mid}
      />
      <Path
        d="M22 44 q4 6 8 0 q4 6 8 0 q4 6 8 0 q4 6 8 0 q4 6 8 0 q4 6 8 0"
        fill="none"
        stroke={p.strong}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Rect x={42} y={56} width={12} height={16} rx={1.5} fill={p.accent2} />
      <Rect x={58} y={50} width={9} height={9} rx={1} fill={p.soft} />
    </>
  );
}

/** Calendar with a highlighted date + confetti. */
function EventsScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Rect x={24} y={28} width={48} height={42} rx={6} fill="#FFFFFF" stroke={p.strong} strokeWidth={2} />
      <Rect x={24} y={28} width={48} height={12} rx={6} fill={p.mid} />
      <Rect x={33} y={20} width={4} height={12} rx={2} fill={p.strong} />
      <Rect x={59} y={20} width={4} height={12} rx={2} fill={p.strong} />
      <Rect x={44} y={48} width={12} height={12} rx={2} fill={p.accent2} />
      <Circle cx={20} cy={22} r={3} fill={p.soft} />
      <Circle cx={78} cy={26} r={2.4} fill={p.strong} />
      <Rect x={74} y={62} width={5} height={5} rx={1} fill={p.mid} transform="rotate(20 76.5 64.5)" />
    </>
  );
}

/** Megaphone with sound arcs — society notices / announcements. */
function NoticesScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Path d="M30 42 L52 30 V62 L30 50 Z" fill={p.mid} />
      <Rect x={24} y={40} width={8} height={12} rx={2} fill={p.strong} />
      <Rect x={34} y={58} width={7} height={14} rx={3} fill={p.accent2} transform="rotate(14 37.5 65)" />
      <Path
        d="M58 34 q7 12 0 24"
        fill="none"
        stroke={p.strong}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <Path
        d="M66 28 q13 18 0 36"
        fill="none"
        stroke={p.soft}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </>
  );
}

/** Shield with a checkmark — approval ladder / sign-off. */
function ApprovalsScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Path
        d="M48 22 L70 30 V50 C70 63 60 70 48 74 C36 70 26 63 26 50 V30 Z"
        fill={p.mid}
        stroke={p.strong}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M38 48 L45 55 L59 39"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

/** Fallback for an unrecognised name: a plain circle-in-square glyph. */
function DefaultScene({ p }: { p: Palette }): React.JSX.Element {
  return (
    <>
      <Rect x={28} y={28} width={40} height={40} rx={10} fill="#FFFFFF" stroke={p.strong} strokeWidth={2} />
      <Circle cx={48} cy={48} r={10} fill={p.mid} />
    </>
  );
}
