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

export function SettingsIcon({
  size = 19,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="settings-outline" size={size} color={color} style={style} />;
}

export function HeadsetIcon({
  size = 17,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="headset-outline" size={size} color={color} style={style} />;
}

export function RepeatIcon({
  size = 15,
  color = colors.textMuted,
  style,
}: IconProps) {
  return <Ionicons name="repeat" size={size} color={color} style={style} />;
}

export function VolumeIcon({
  size = 17,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="volume-medium-outline" size={size} color={color} style={style} />;
}

export function LockIcon({
  size = 21,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="lock-closed-outline" size={size} color={color} style={style} />;
}

export function CloudOfflineIcon({
  size = 12,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="cloud-offline-outline" size={size} color={color} style={style} />;
}

export function ShieldCheckIcon({
  size = 20,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="shield-checkmark-outline" size={size} color={color} style={style} />;
}

export function ShareIcon({
  size = 18,
  color = colors.faint,
  style,
}: IconProps) {
  return <Ionicons name="share-outline" size={size} color={color} style={style} />;
}

export function TextIcon({
  size = 18,
  color = colors.accent,
  style,
}: IconProps) {
  return <Ionicons name="text-outline" size={size} color={color} style={style} />;
}

export function PlayIcon({
  size = 20,
  color = "#fff",
  style,
}: IconProps) {
  return <Ionicons name="play" size={size} color={color} style={style} />;
}

export function PauseIcon({
  size = 20,
  color = "#fff",
  style,
}: IconProps) {
  return <Ionicons name="pause" size={size} color={color} style={style} />;
}
