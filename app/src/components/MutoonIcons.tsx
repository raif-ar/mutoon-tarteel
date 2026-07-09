import { Ionicons } from "@expo/vector-icons";
import type { StyleProp, TextStyle } from "react-native";
import { colors } from "../theme/colors";

type IconProps = {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
};

export function ChevronLeftIcon({
  size = 18,
  color = colors.textMuted,
  style,
}: IconProps) {
  return (
    <Ionicons name="chevron-back" size={size} color={color} style={style} />
  );
}

export function ChevronRightIcon({
  size = 14,
  color = colors.textMuted,
  style,
}: IconProps) {
  return (
    <Ionicons name="chevron-forward" size={size} color={color} style={style} />
  );
}

export function SearchIcon({
  size = 16,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="search" size={size} color={color} style={style} />;
}

export function MoreIcon({
  size = 20,
  color = colors.textMuted,
  style,
}: IconProps) {
  return (
    <Ionicons name="ellipsis-horizontal" size={size} color={color} style={style} />
  );
}

export function BookmarkIcon({
  size = 18,
  color = colors.textMuted,
  style,
}: IconProps) {
  return (
    <Ionicons name="bookmark-outline" size={size} color={color} style={style} />
  );
}

export function HintIcon({
  size = 17,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="bulb-outline" size={size} color={color} style={style} />;
}

export function EyeIcon({
  size = 17,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="eye-outline" size={size} color={color} style={style} />;
}

export function EyeOffIcon({
  size = 17,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="eye-off-outline" size={size} color={color} style={style} />;
}

export function MicIcon({ size = 18, color = "#fff", style }: IconProps) {
  return <Ionicons name="mic" size={size} color={color} style={style} />;
}

export function StopIcon({ size = 16, color = "#fff", style }: IconProps) {
  return <Ionicons name="stop" size={size} color={color} style={style} />;
}

export function CheckIcon({
  size = 12,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="checkmark" size={size} color={color} style={style} />;
}

export function CloseXIcon({
  size = 11,
  color = colors.error,
  style,
}: IconProps) {
  return <Ionicons name="close" size={size} color={color} style={style} />;
}

export function FlameIcon({
  size = 17,
  color = colors.amber,
  style,
}: IconProps) {
  return <Ionicons name="flame" size={size} color={color} style={style} />;
}

export function BookIcon({
  size = 19,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="book-outline" size={size} color={color} style={style} />;
}

export function ChartIcon({
  size = 19,
  color = colors.textMuted,
  style,
}: IconProps) {
  return (
    <Ionicons name="stats-chart-outline" size={size} color={color} style={style} />
  );
}

export function TargetIcon({
  size = 21,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="locate-outline" size={size} color={color} style={style} />;
}

export function EarIcon({
  size = 21,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="ear-outline" size={size} color={color} style={style} />;
}
