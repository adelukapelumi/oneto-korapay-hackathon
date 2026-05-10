import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useThemeMode } from "@/theme/theme-provider";
import {
  getTheme,
  borders,
  radii,
  dimensions,
} from "@/theme/tokens";

interface Props {
  onPress?: () => void;
}

export function BackButton({ onPress }: Props): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        { borderColor: t.border, backgroundColor: t.card },
        pressed && styles.pressed,
      ]}
      onPress={onPress ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
    >
      <Text style={[styles.arrow, { color: t.text }]}>←</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  arrow: {
    fontSize: 18,
    includeFontPadding: false,
    lineHeight: 18,
    textAlign: "center",
  },
});