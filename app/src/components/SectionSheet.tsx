import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SectionRange } from "../lib/content/loader";
import { reciteParams } from "../lib/recite/session";
import { colors, tint } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { shadowCard } from "../theme/shadows";
import {
  ChevronRightIcon,
  HeadsetIcon,
  MicIcon,
  TextIcon,
} from "./MutoonIcons";
import { BottomSheet } from "./ui/BottomSheet";
import { Press } from "./ui/Press";

interface SectionSheetProps {
  matnId: string;
  /** The section to offer; null keeps the sheet closed. */
  section: SectionRange | null;
  /** Called when the sheet should close. The parent then clears `section`. */
  onClose: () => void;
}

/** The ways into one section of a matn: recite it, listen to it, or pick a line. */
export function SectionSheet({ matnId, section, onClose }: SectionSheetProps) {
  const router = useRouter();

  // Each option closes the sheet first, so it is already sliding away when
  // the next screen comes in.
  const recite = () => {
    if (!section) return;
    onClose();
    router.push({
      pathname: "/matn/[id]/recite",
      // Spread into a plain object: route params need an index signature,
      // which the helper's interface type does not have.
      params: { ...reciteParams(matnId, section.from, section.to) },
    });
  };

  const listen = () => {
    if (!section) return;
    onClose();
    router.push({
      pathname: "/matn/[id]/listen",
      params: {
        id: matnId,
        start: String(section.from),
        end: String(section.to),
      },
    });
  };

  const pickLine = () => {
    if (!section) return;
    onClose();
    router.push({
      pathname: "/matn/[id]/start",
      params: { id: matnId, at: String(section.from) },
    });
  };

  const count = section ? section.to - section.from + 1 : 0;

  return (
    <BottomSheet visible={section != null} onClose={onClose}>
      {section ? (
        <View>
          <Text style={styles.title} accessibilityRole="header">
            {section.title_ar}
          </Text>
          <Text style={styles.sub}>
            Lines {section.from + 1}–{section.to + 1} · {count}{" "}
            {count === 1 ? "line" : "lines"}
          </Text>

          <View style={styles.options}>
            <Option
              icon={<MicIcon size={18} color={colors.accent} />}
              title="Recite this section"
              sub={`From line ${section.from + 1} to line ${
                section.to + 1
              }, then stop`}
              onPress={recite}
            />
            <Option
              icon={<HeadsetIcon size={18} />}
              title="Listen to it first"
              sub="Hear each line, repeat as often as you like"
              onPress={listen}
            />
            <Option
              icon={<TextIcon size={18} />}
              title="Start from a line"
              sub="Pick the exact line to begin from"
              onPress={pickLine}
              chevron
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

interface OptionProps {
  icon: ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
  /** Marks an option that opens a further screen to choose on. */
  chevron?: boolean;
}

function Option({ icon, title, sub, onPress, chevron = false }: OptionProps) {
  return (
    <Press onPress={onPress} scale={0.98} accessibilityLabel={`${title}. ${sub}`}>
      <View style={styles.option}>
        <View style={styles.optionIcon}>{icon}</View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionSub}>{sub}</Text>
        </View>
        {chevron ? <ChevronRightIcon size={15} color={colors.faint} /> : null}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.arabicBold,
    fontSize: 22,
    lineHeight: 37,
    color: colors.ink,
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  sub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: 16,
  },
  options: { gap: 9 },
  option: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint(10),
  },
  optionBody: { flex: 1, minWidth: 0 },
  optionTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: colors.ink,
  },
  optionSub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
  },
});
