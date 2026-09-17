import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

/**
 * Bespoke GateX tab icons — a cohesive geometric line set authored in Figma
 * (file "GateX Icon Set") and mirrored here as react-native-svg so they
 * render crisp at any size and take the live theme colour. `active` thickens
 * the stroke slightly for the selected tab.
 */
export type TabIconProps = {
  size?: number;
  color: string;
  active?: boolean;
};

function svgProps(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const };
}

export function HomeIcon({ size = 24, color, active }: TabIconProps) {
  const w = active ? 2.4 : 2;
  return (
    <Svg {...svgProps(size)}>
      <Path d="M4 11.4 12 4.5l8 6.9" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.2 10v8.2a1.3 1.3 0 0 0 1.3 1.3h9a1.3 1.3 0 0 0 1.3-1.3V10" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 19.5v-4.3a2 2 0 0 1 4 0v4.3" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function BillsIcon({ size = 24, color, active }: TabIconProps) {
  const w = active ? 2.4 : 2;
  return (
    <Svg {...svgProps(size)}>
      <Path d="M7 3.5h10v16l-2.5-1.4L12 19.5l-2.5-1.4L7 19.5z" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 8h4" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Path d="M10 11.5h4" stroke={color} strokeWidth={w} strokeLinecap="round" />
    </Svg>
  );
}

export function RequestsIcon({ size = 24, color, active }: TabIconProps) {
  const w = active ? 2.4 : 2;
  return (
    <Svg {...svgProps(size)}>
      <Circle cx={9} cy={8} r={3} stroke={color} strokeWidth={w} />
      <Path d="M3.8 19.2a5.2 5.2 0 0 1 10.4 0" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M15.5 5.6a3 3 0 0 1 0 4.8" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20.2 19.2a5.2 5.2 0 0 0-3.4-4.9" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CommunityIcon({ size = 24, color, active }: TabIconProps) {
  const w = active ? 2.4 : 2;
  return (
    <Svg {...svgProps(size)}>
      <Path
        d="M4.5 5.5a1.2 1.2 0 0 1 1.2-1.2h12.6a1.2 1.2 0 0 1 1.2 1.2v9a1.2 1.2 0 0 1-1.2 1.2H9.5l-4 3.3v-3.3H5.7a1.2 1.2 0 0 1-1.2-1.2z"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={10} r={1} fill={color} />
      <Circle cx={12} cy={10} r={1} fill={color} />
      <Circle cx={15} cy={10} r={1} fill={color} />
    </Svg>
  );
}

export function ProfileIcon({ size = 24, color, active }: TabIconProps) {
  const w = active ? 2.4 : 2;
  return (
    <Svg {...svgProps(size)}>
      <Circle cx={12} cy={8} r={3.6} stroke={color} strokeWidth={w} />
      <Path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const TAB_ICONS = [HomeIcon, BillsIcon, RequestsIcon, CommunityIcon, ProfileIcon];
