import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { colors } from "../../theme/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

interface RingProps {
  size?: number;
  stroke?: number;
  /** 0–100 */
  pct: number;
  color?: string;
  track?: string;
  /** Extra ms before the ring draws in. */
  delay?: number;
  children?: ReactNode;
}

/** Animated progress ring that draws in on mount — the redesign's M2Ring. */
export function Ring({
  size = 48,
  stroke = 4.5,
  pct,
  color = colors.accent,
  track = "rgba(22,33,30,0.08)",
  delay = 0,
  children,
}: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      120 + delay,
      withTiming(Math.min(pct, 100) / 100, {
        duration: 1200,
        easing: EASE_OUT,
      })
    );
  }, [pct, delay, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - progress.value),
  }));

  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});
