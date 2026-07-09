import { useEffect } from "react";
import Svg, { Path } from "react-native-svg";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { colors } from "../../theme/colors";

/**
 * The Whorl — the MatnHifdh mark. A م written in one unbroken stroke, its
 * head spiralling like the core of a fingerprint (design: MatnHifdh Logo v4,
 * variant A "Pure line").
 */
const FULL_PATH =
  "M38 24 A4 4 0 1 0 38 32 A7 7 0 1 0 38 18 A10 10 0 1 0 38 38 A13 13 0 1 0 38 12 A16 16 0 0 0 22 28 L22 52";
const FULL_VIEWBOX = "4 0 64 64";
/** Total stroke length of FULL_PATH (sum of the arcs + tail), for draw-in. */
const FULL_LENGTH = 156;

/** Tiny sizes drop to 1.5 turns so the coil stays legible. */
const TINY_PATH =
  "M38 24 A4 4 0 1 0 38 32 A7 7 0 1 0 38 18 A10 10 0 0 0 28 28 L28 46";
const TINY_VIEWBOX = "7 1 54 54";

interface WhorlMarkProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** "tiny" = 1.5-turn simplified coil; defaults by size (< 28px → tiny). */
  variant?: "full" | "tiny";
}

export function WhorlMark({
  size = 36,
  color = colors.accent,
  strokeWidth,
  variant,
}: WhorlMarkProps) {
  const tiny = variant ? variant === "tiny" : size < 28;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={tiny ? TINY_VIEWBOX : FULL_VIEWBOX}
    >
      <Path
        d={tiny ? TINY_PATH : FULL_PATH}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth ?? (tiny ? 6.5 : 4.2)}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface AnimatedWhorlMarkProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** ms before the stroke starts writing. */
  delay?: number;
  /** ms for the full draw. */
  duration?: number;
}

/** The mark writes itself — like the pen writing the م. */
export function AnimatedWhorlMark({
  size = 96,
  color = colors.accent,
  strokeWidth = 4.2,
  delay = 300,
  duration = 1800,
}: AnimatedWhorlMarkProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration,
        easing: Easing.bezier(0.45, 0, 0.2, 1),
      })
    );
  }, [delay, duration, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: FULL_LENGTH * (1 - progress.value),
  }));

  return (
    <Svg width={size} height={size} viewBox={FULL_VIEWBOX}>
      <AnimatedPath
        d={FULL_PATH}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${FULL_LENGTH}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
