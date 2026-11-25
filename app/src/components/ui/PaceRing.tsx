import type { ReactNode } from "react";
import { colors, tint } from "../../theme/colors";
import { Ring } from "./Ring";

interface PaceRingProps {
  /** Share of today's pace done, 0 to 1. Values outside that range are clamped. */
  fraction: number;
  size?: number;
  stroke?: number;
  /** Centered inside the ring, e.g. a percentage. */
  children?: ReactNode;
}

/** Ring for today's pace: accent arc on a light accent track. */
export function PaceRing({
  fraction,
  size = 46,
  stroke = 5,
  children,
}: PaceRingProps) {
  // A pace of zero minutes or a value still loading would otherwise reach the
  // ring as NaN.
  const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;

  return (
    <Ring
      size={size}
      stroke={stroke}
      pct={safe * 100}
      color={colors.accent}
      track={tint(14)}
    >
      {children}
    </Ring>
  );
}
