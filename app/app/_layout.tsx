import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from "@expo-google-fonts/ibm-plex-sans-arabic";
import {
  NotoNaskhArabic_400Regular,
  NotoNaskhArabic_700Bold,
} from "@expo-google-fonts/noto-naskh-arabic";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "react-native";
import { colors } from "../src/theme/colors";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    NotoNaskhArabic_400Regular,
    NotoNaskhArabic_700Bold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="goals" options={{ title: "Goals" }} />
        <Stack.Screen name="history" options={{ title: "Mistakes" }} />
        <Stack.Screen name="matn/[id]/index" options={{ title: "Reader" }} />
        <Stack.Screen name="matn/[id]/start" options={{ headerShown: false }} />
        <Stack.Screen name="matn/[id]/recite" options={{ headerShown: false }} />
        <Stack.Screen
          name="matn/[id]/results"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="matn/[id]/listen" options={{ title: "Listen" }} />
      </Stack>
    </>
  );
}
