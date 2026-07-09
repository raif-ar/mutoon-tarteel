import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";

interface PressProps {
  children: ReactNode;
  onPress?: () => void;
  /** Scale while pressed (springs back on release). */
  scale?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  accessibilityLabel?: string;
}

const EASE = Easing.bezier(0.32, 0.72, 0, 1);

/** Press wrapper: scales down on touch and springs back — the redesign's M2Press. */
export function Press({
  children,
  onPress,
  scale = 0.97,
  disabled,
  style,
  hitSlop,
  accessibilityLabel,
}: PressProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withTiming(pressed.value ? scale : 1, {
          duration: 220,
          easing: EASE,
        }),
      },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => (pressed.value = 1)}
      onPressOut={() => (pressed.value = 0)}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}
