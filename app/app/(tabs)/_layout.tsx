import { Tabs } from "expo-router";
// Expo Router 6 vendors react-navigation; this deep import is type-only.
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { BookIcon, ChartIcon } from "../../src/components/MutoonIcons";
import { colors, tint } from "../../src/theme/colors";
import { fonts } from "../../src/theme/fonts";
import { shadowFloat } from "../../src/theme/shadows";

const EASE = Easing.bezier(0.32, 0.72, 0, 1);

const TAB_META: Record<
  string,
  { label: string; Icon: typeof BookIcon }
> = {
  library: { label: "Library", Icon: BookIcon },
  progress: { label: "Progress", Icon: ChartIcon },
};

function TabItem({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: typeof BookIcon;
  active: boolean;
  onPress: () => void;
}) {
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withTiming(pressed.value ? 0.95 : 1, {
          duration: 220,
          easing: EASE,
        }),
      },
    ],
  }));

  return (
    <Pressable
      style={styles.tabPressable}
      onPress={onPress}
      onPressIn={() => (pressed.value = 1)}
      onPressOut={() => (pressed.value = 0)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Animated.View
        style={[styles.tabItem, active && styles.tabItemActive, pressStyle]}
      >
        <Icon size={19} color={active ? colors.accent : colors.faint} />
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 14) + 10;

  return (
    <View style={[styles.bar, { bottom }]} pointerEvents="box-none">
      {Platform.OS === "ios" ? (
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={styles.barRow}>
        {state.routes.map((route, index) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const active = state.index === index;
          return (
            <TabItem
              key={route.key}
              label={meta.label}
              Icon={meta.Icon}
              active={active}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!active && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="library" />
      <Tabs.Screen name="progress" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.capsule,
    borderWidth: 1,
    borderColor: colors.capsuleBorder,
    overflow: Platform.OS === "ios" ? "hidden" : "visible",
    ...shadowFloat,
  },
  barRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 4,
  },
  tabPressable: {
    flex: 1,
  },
  tabItem: {
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  tabItemActive: {
    backgroundColor: tint(9),
  },
  tabLabel: {
    fontSize: 13.5,
    fontFamily: fonts.uiBold,
    color: colors.faint,
  },
  tabLabelActive: {
    color: colors.accent,
  },
});
