import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { getSetting } from "../src/lib/db/database";
import { colors } from "../src/theme/colors";

/** Entry gate: onboarding on first launch, the tabbed app afterwards. */
export default function IndexGate() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    getSetting("onboarded")
      .then((v) => setOnboarded(v === "1"))
      .catch(() => setOnboarded(false));
  }, []);

  if (onboarded === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }
  return <Redirect href={onboarded ? "/library" : "/onboarding"} />;
}
