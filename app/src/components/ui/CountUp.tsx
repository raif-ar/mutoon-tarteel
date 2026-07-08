import { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

interface CountUpProps {
  to: number;
  decimals?: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

/** Number that eases up from 0 on mount (ease-out-expo) — the redesign's M2CountUp. */
export function CountUp({
  to,
  decimals = 0,
  duration = 1200,
  delay = 0,
  suffix = "",
  style,
}: CountUpProps) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let start: number | undefined;
    const tick = (ts: number) => {
      if (start === undefined) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(to * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    const dt = setTimeout(() => {
      raf.current = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(dt);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [to, duration, delay]);

  return (
    <Text style={[{ fontVariant: ["tabular-nums"] }, style]}>
      {value.toFixed(decimals)}
      {suffix}
    </Text>
  );
}
