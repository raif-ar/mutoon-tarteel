import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";

interface BottomSheetProps {
  visible: boolean;
  /** Called on a scrim tap, the Android back button and the VoiceOver escape gesture. */
  onClose: () => void;
  children: ReactNode;
}

const EASE = Easing.bezier(0.32, 0.72, 0, 1);
const OPEN_MS = 360;
const CLOSE_MS = 240;

/**
 * Modal bottom sheet: dimmed scrim, grabber, content. Slides up when `visible`
 * turns true and slides away before its content unmounts. Keep it mounted and
 * toggle `visible`; unmounting it while open skips the slide.
 *
 * The sheet owns its padding (10 top, 20 sides, safe area + 14 bottom), so
 * children start at the content itself.
 */
export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // The Modal outlives `visible` by the length of the close slide.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  // Callers often clear the data behind the content in the same update that
  // hides the sheet. Hold on to the last open content so the sheet does not
  // go empty while it slides away.
  const shown = useRef<ReactNode>(children);
  if (visible) shown.current = children;

  /** 0 = closed, 1 = open. */
  const progress = useSharedValue(0);
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = reduceMotion
        ? 1
        : withTiming(1, { duration: OPEN_MS, easing: EASE });
      return;
    }
    const unmount = () => {
      // The next content may be taller, so it must be measured afresh.
      sheetHeight.value = 0;
      setMounted(false);
    };
    if (reduceMotion) {
      progress.value = 0;
      unmount();
      return;
    }
    progress.value = withTiming(0, { duration: CLOSE_MS, easing: EASE });
    // A little past the slide so the last frame is drawn before the unmount.
    const timer = setTimeout(unmount, CLOSE_MS + 40);
    return () => clearTimeout(timer);
  }, [visible, reduceMotion, progress, sheetHeight]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // Until the sheet has been measured, park it a full screen below.
        translateY:
          (1 - progress.value) * (sheetHeight.value || windowHeight),
      },
    ],
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* No taps while it slides away, so a second tap cannot fire an option twice. */}
      <View style={styles.root} pointerEvents={visible ? "auto" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            style={styles.scrim}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + 14,
              maxHeight: windowHeight - insets.top - 12,
            },
            sheetStyle,
          ]}
          onLayout={(e) => {
            sheetHeight.value = e.nativeEvent.layout.height;
          }}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.grabber} />
          {shown.current}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    direction: "ltr",
    justifyContent: "flex-end",
  },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(16,23,26,0.3)",
  },
  sheet: {
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
    shadowColor: "#141E1A",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 16,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(22,33,30,0.14)",
    marginBottom: 14,
  },
});
