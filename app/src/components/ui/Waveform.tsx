import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { colors } from "../../theme/colors";

interface WaveformProps {
  active: boolean;
  color?: string;
  bars?: number;
  height?: number;
  width?: number;
}

function Bar({
  active,
  color,
  height,
  width,
  index,
}: {
  active: boolean;
  color: string;
  height: number;
  width: number;
  index: number;
}) {
  const scale = useSharedValue(0.3);

  useEffect(() => {
    if (active) {
      const duration = (800 + (index % 3) * 250) / 2;
      scale.value = withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration, easing: Easing.inOut(Easing.ease) })
        ),
        -1
      );
    } else {
      scale.value = withTiming(0.3, {
        duration: 400,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
    }
  }, [active, index, scale]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: width,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Live waveform bars while listening — the redesign's M2Waveform. */
export function Waveform({
  active,
  color = colors.accent,
  bars = 5,
  height = 16,
  width = 3,
}: WaveformProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 2.5,
        alignItems: "center",
        height,
      }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <Bar
          key={i}
          active={active}
          color={color}
          height={height}
          width={width}
          index={i}
        />
      ))}
    </View>
  );
}
